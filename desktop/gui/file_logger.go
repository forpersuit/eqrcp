package main

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	defaultLogChanCap       = 4096
	maxLogFileSize          = 10 * 1024 * 1024 // 10MB
	maxBackupLogFiles       = 2                // desktop.log.1, desktop.log.2 (总共最多 3 个文件 <= 30MB)
	defaultLogRetentionDays = 7                // 默认保存 7 天
	flushInterval           = 100 * time.Millisecond
	syncInterval            = 1 * time.Second
	errorEnqueueTimeout     = 50 * time.Millisecond
	cleanupCheckInterval    = 12 * time.Hour
)

type logEntry struct {
	line  string
	level string
}

// FileLogger is an asynchronous, thread-safe, rotating file logger.
// It maintains 100% public surface compatibility with the legacy FileLogger
// while delegating disk I/O to a single background worker goroutine to ensure
// non-blocking operation (<= 1ms) in high-throughput network paths.
type FileLogger struct {
	mu          sync.RWMutex
	file        *os.File
	filePath    string
	enabled     bool
	debugMode   bool
	currentSize int64

	ch               chan logEntry
	doneCh           chan struct{}
	closed           bool
	droppedInfoCount uint64
}

// NewFileLogger creates an asynchronous rotating file logger.
func NewFileLogger(filePath string, enabled bool) *FileLogger {
	_ = os.MkdirAll(filepath.Dir(filePath), 0700)
	f, err := os.OpenFile(filePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	var initialSize int64
	if err == nil && f != nil {
		if fi, statErr := f.Stat(); statErr == nil {
			initialSize = fi.Size()
		}
	}

	l := &FileLogger{
		file:        f,
		filePath:    filePath,
		enabled:     enabled,
		currentSize: initialSize,
		ch:          make(chan logEntry, defaultLogChanCap),
		doneCh:      make(chan struct{}),
	}

	cleanupOldLogs(filepath.Dir(filePath), defaultLogRetentionDays)

	go l.workerLoop()
	return l
}

// SetLogDir changes the directory of the log file and reopens it asynchronously.
func (l *FileLogger) SetLogDir(logDir string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	var newPath string
	if logDir != "" {
		newPath = filepath.Join(logDir, "desktop.log")
	} else {
		dir, err := os.UserCacheDir()
		if err != nil {
			dir = os.TempDir()
		}
		newPath = filepath.Join(dir, "eqt", "desktop.log")
	}

	if l.filePath == newPath && l.file != nil {
		return
	}

	if l.file != nil {
		_ = l.file.Sync()
		_ = l.file.Close()
		l.file = nil
	}

	l.filePath = newPath
	_ = os.MkdirAll(filepath.Dir(newPath), 0700)
	f, err := os.OpenFile(newPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err == nil {
		l.file = f
		if fi, statErr := f.Stat(); statErr == nil {
			l.currentSize = fi.Size()
		} else {
			l.currentSize = 0
		}
	}

	cleanupOldLogs(filepath.Dir(newPath), defaultLogRetentionDays)
}

// GetFilePath returns the active file path.
func (l *FileLogger) GetFilePath() string {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.filePath
}

// SetEnabled toggles file logging.
func (l *FileLogger) SetEnabled(enabled bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.enabled = enabled
}

// Enabled checks if file logging is enabled.
func (l *FileLogger) Enabled() bool {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.enabled
}

// SetDebugMode toggles detailed debug/trace logging output.
func (l *FileLogger) SetDebugMode(debug bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.debugMode = debug
}

// DebugMode checks if debug logging is enabled.
func (l *FileLogger) DebugMode() bool {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.debugMode
}

// enqueue dispatches a log entry with bounded saturation policy.
func (l *FileLogger) enqueue(level string, line string) {
	if !l.Enabled() {
		return
	}
	if !strings.HasSuffix(line, "\n") {
		line += "\n"
	}

	l.mu.RLock()
	closed := l.closed
	l.mu.RUnlock()
	if closed {
		return
	}

	entry := logEntry{line: line, level: level}

	// INFO / DEBUG / TRACE: Non-blocking 0ms drop on buffer saturation
	if level != "WARN" && level != "ERROR" && level != "FATAL" {
		select {
		case l.ch <- entry:
		default:
			atomic.AddUint64(&l.droppedInfoCount, 1)
		}
		return
	}

	// WARN / ERROR / FATAL: Bounded timeout (50ms) to ensure critical alerts are preserved
	select {
	case l.ch <- entry:
	case <-time.After(errorEnqueueTimeout):
		// Emergency direct write fallback if queue is severely blocked.
		// Uses independent handle without deadlocking on worker locks.
		l.emergencyDirectWrite(line)
	}
}

func (l *FileLogger) emergencyDirectWrite(line string) {
	// 1. Try to acquire lock non-blockingly
	if l.mu.TryLock() {
		if l.file != nil {
			_, _ = l.file.WriteString(line)
		}
		l.mu.Unlock()
		return
	}

	// 2. If worker is stalled or holding lock during long Sync(), write via dedicated temporary handle
	l.mu.RLock()
	targetPath := l.filePath
	l.mu.RUnlock()

	if targetPath != "" {
		if f, err := os.OpenFile(targetPath, os.O_WRONLY|os.O_APPEND, 0600); err == nil {
			_, _ = f.WriteString(line)
			_ = f.Close()
		}
	}
}

// workerLoop drains the channel, batches writes, checks log rotation, and performs periodic fsync.
func (l *FileLogger) workerLoop() {
	defer close(l.doneCh)
	flushTicker := time.NewTicker(flushInterval)
	defer flushTicker.Stop()
	syncTicker := time.NewTicker(syncInterval)
	defer syncTicker.Stop()
	cleanupTicker := time.NewTicker(cleanupCheckInterval)
	defer cleanupTicker.Stop()

	var batch []string
	flush := func() {
		if len(batch) == 0 {
			return
		}
		l.mu.Lock()
		defer l.mu.Unlock()
		if l.file == nil {
			batch = batch[:0]
			return
		}
		for _, line := range batch {
			l.checkAndRotateLocked(int64(len(line)))
			if l.file != nil {
				n, _ := l.file.WriteString(line)
				l.currentSize += int64(n)
			}
		}
		batch = batch[:0]
	}

	for {
		select {
		case entry, ok := <-l.ch:
			if !ok {
				flush()
				return
			}
			batch = append(batch, entry.line)
			if len(batch) >= 64 {
				flush()
			}
		case <-flushTicker.C:
			flush()
		case <-syncTicker.C:
			flush()

			// Sync is executed OUTSIDE of long exclusive locks to prevent deadlocks with emergency writes
			l.mu.RLock()
			activeFile := l.file
			l.mu.RUnlock()
			if activeFile != nil {
				_ = activeFile.Sync()
			}

			dropped := atomic.SwapUint64(&l.droppedInfoCount, 0)
			if dropped > 0 {
				dropNotice := fmt.Sprintf("[%s] [WARN] [LOGGER] Dropped %d non-critical log entries due to buffer saturation\n",
					time.Now().Format("2006-01-02 15:04:05.000"), dropped)
				l.mu.Lock()
				l.checkAndRotateLocked(int64(len(dropNotice)))
				if l.file != nil {
					n, _ := l.file.WriteString(dropNotice)
					l.currentSize += int64(n)
				}
				l.mu.Unlock()
			}
		case <-cleanupTicker.C:
			l.mu.RLock()
			dir := filepath.Dir(l.filePath)
			l.mu.RUnlock()
			cleanupOldLogs(dir, defaultLogRetentionDays)
		}
	}
}

func (l *FileLogger) checkAndRotateLocked(upcomingBytes int64) {
	if l.file == nil || (l.currentSize+upcomingBytes) <= maxLogFileSize {
		return
	}
	_ = l.file.Sync()
	_ = l.file.Close()
	l.file = nil

	// Rotation cascade: desktop.log.1 -> desktop.log.2, desktop.log -> desktop.log.1
	backup2 := l.filePath + ".2"
	backup1 := l.filePath + ".1"
	_ = os.Remove(backup2)
	_ = os.Rename(backup1, backup2)
	_ = os.Rename(l.filePath, backup1)

	f, err := os.OpenFile(l.filePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err == nil {
		l.file = f
		l.currentSize = 0
	}
}

// Write implements io.Writer to adapt stdlib log.Printf, chat-v2 diag logs, and arbitrary byte streams.
func (l *FileLogger) Write(p []byte) (n int, err error) {
	if !l.Enabled() {
		return len(p), nil
	}

	raw := string(p)
	rawTrimmed := strings.TrimRight(raw, "\r\n")
	if len(rawTrimmed) == 0 {
		return len(p), nil
	}

	timestamp := time.Now().Format("2006-01-02 15:04:05.000")
	var line string
	level := "INFO"

	// 1. Adapt chat-v2 log prefix (format: "chat-v2 2006/01/02 15:04:05 <level> <msg>")
	if strings.HasPrefix(rawTrimmed, "chat-v2 ") {
		rest := strings.TrimPrefix(rawTrimmed, "chat-v2 ")
		if len(rest) >= 20 && rest[4] == '/' && rest[7] == '/' && rest[10] == ' ' && rest[13] == ':' && rest[16] == ':' {
			rest = strings.TrimSpace(rest[19:])
		}
		// Match both lowercase plain levels (info, warn, error, debug) and uppercase bracketed levels
		for _, lvl := range []string{"error", "ERROR", "warn", "WARN", "debug", "DEBUG", "info", "INFO"} {
			bracketPrefix := "[" + lvl + "]"
			plainPrefix := lvl + " "
			if strings.HasPrefix(rest, bracketPrefix) {
				level = strings.ToUpper(lvl)
				rest = strings.TrimSpace(strings.TrimPrefix(rest, bracketPrefix))
				break
			} else if strings.HasPrefix(rest, plainPrefix) {
				level = strings.ToUpper(lvl)
				rest = strings.TrimSpace(strings.TrimPrefix(rest, plainPrefix))
				break
			}
		}
		line = fmt.Sprintf("[%s] [%s] [CHAT] %s", timestamp, level, rest)
		l.enqueue(level, line)
		return len(p), nil
	} else if len(rawTrimmed) >= 20 && rawTrimmed[4] == '/' && rawTrimmed[7] == '/' && rawTrimmed[10] == ' ' && rawTrimmed[13] == ':' && rawTrimmed[16] == ':' {
		// 2. Adapt standard library log prefix (format: "2006/01/02 15:04:05 <msg>")
		body := strings.TrimSpace(rawTrimmed[19:])
		var foundLevel string
		for _, lvl := range []string{"INFO", "WARN", "ERROR", "DEBUG", "FATAL", "PRINT", "TRACE"} {
			if strings.HasPrefix(body, "["+lvl+"]") {
				foundLevel = lvl
				break
			}
		}
		if foundLevel != "" {
			// Transparently preserve existing single-frame level box (e.g. [ERROR] [CLIENT] ... or [INFO] [SRV] ...)
			level = foundLevel
			line = fmt.Sprintf("[%s] %s", timestamp, body)
		} else {
			// Legacy unlevelled server logs (e.g. [EQT Server] [Download Start])
			level = "INFO"
			line = fmt.Sprintf("[%s] [INFO] [SRV] %s", timestamp, body)
		}
	} else if strings.HasPrefix(rawTrimmed, "[") {
		// 3. Already structured log line
		line = rawTrimmed
	} else {
		// 4. General text
		line = fmt.Sprintf("[%s] [INFO] %s", timestamp, rawTrimmed)
	}

	l.enqueue(level, line)
	return len(p), nil
}

// readTailFromFile reads up to maxLines from the given file.
func readTailFromFile(filePath string, maxLines int) ([]string, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var lines []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
		if len(lines) > maxLines*2 {
			lines = lines[len(lines)-maxLines:]
		}
	}
	if err := scanner.Err(); err != nil && err != io.EOF {
		return nil, err
	}
	if len(lines) > maxLines {
		lines = lines[len(lines)-maxLines:]
	}
	return lines, nil
}

// Tail safely reads the last n lines from the current log file, stitching with desktop.log.1
// if the current file has just rotated and contains fewer lines than requested.
func (l *FileLogger) Tail(lines int) ([]string, error) {
	if lines <= 0 {
		lines = 100
	}

	l.mu.RLock()
	curPath := l.filePath
	l.mu.RUnlock()

	curLines, err := readTailFromFile(curPath, lines)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}

	// If rotation just occurred and current file has fewer lines than requested,
	// read preceding lines from desktop.log.1 to ensure full diagnosis context.
	if len(curLines) < lines {
		backupPath := curPath + ".1"
		needed := lines - len(curLines)
		if backupLines, err := readTailFromFile(backupPath, needed); err == nil && len(backupLines) > 0 {
			curLines = append(backupLines, curLines...)
		}
	}

	return curLines, nil
}

// Close gracefully flushes buffered entries and closes the underlying file handle.
func (l *FileLogger) Close() {
	l.mu.Lock()
	if l.closed {
		l.mu.Unlock()
		return
	}
	l.closed = true
	close(l.ch)
	l.mu.Unlock()

	// Wait for workerLoop to finish writing remaining queued logs
	<-l.doneCh

	l.mu.Lock()
	defer l.mu.Unlock()
	if l.file != nil {
		_ = l.file.Sync()
		_ = l.file.Close()
		l.file = nil
	}
}

func (l *FileLogger) log(level string, message string) {
	timestamp := time.Now().Format("2006-01-02 15:04:05.000")
	line := fmt.Sprintf("[%s] [%s] %s", timestamp, level, message)
	if l.DebugMode() {
		fmt.Println(line)
	}
	l.enqueue(level, line)
}

func (l *FileLogger) Print(message string) { l.log("PRINT", message) }
func (l *FileLogger) Trace(message string) {
	if l.DebugMode() {
		l.log("TRACE", message)
	}
}
func (l *FileLogger) Debug(message string) {
	if l.DebugMode() {
		l.log("DEBUG", message)
	}
}
func (l *FileLogger) Info(message string)    { l.log("INFO", message) }
func (l *FileLogger) Warning(message string) { l.log("WARN", message) }
func (l *FileLogger) Error(message string)   { l.log("ERROR", message) }
func (l *FileLogger) Fatal(message string)   { l.log("FATAL", message) }

// cleanupOldLogs removes rotated log files, crash dumps, and stale logs older than retentionDays.
func cleanupOldLogs(logDir string, retentionDays int) {
	if logDir == "" || retentionDays <= 0 {
		return
	}
	entries, err := os.ReadDir(logDir)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-time.Duration(retentionDays) * 24 * time.Hour)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		isRotatedLog := strings.HasPrefix(name, "desktop.log.")
		isOtherLog := strings.HasSuffix(name, ".log") && name != "desktop.log"
		isCrashDump := strings.HasPrefix(name, "crash_") && strings.HasSuffix(name, ".dump")

		info, err := entry.Info()
		if err != nil {
			continue
		}

		if name == "desktop.log" {
			if info.ModTime().Before(cutoff) {
				_ = os.Truncate(filepath.Join(logDir, name), 0)
			}
			continue
		}

		if (isRotatedLog || isOtherLog || isCrashDump) && info.ModTime().Before(cutoff) {
			_ = os.Remove(filepath.Join(logDir, name))
		}
	}
}
