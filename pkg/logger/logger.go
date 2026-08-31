package logger

import (
	"fmt"
	"io"
	"sync"
	"time"
)

// Level defines log verbosity.
type Level int

const (
	LevelDebug Level = iota
	LevelInfo
	LevelWarn
	LevelError
	LevelQuiet
)

// Logger provides thread-safe, structured, leveled diagnostic logging.
type Logger struct {
	quiet   bool
	level   Level
	prefix  string
	traceID string
	w       io.Writer
	mu      *sync.Mutex
}

// New creates a new Logger with default stdout output.
func New(quiet bool) Logger {
	return Logger{
		quiet: quiet,
		level: LevelInfo,
		mu:    &sync.Mutex{},
	}
}

// NewWithWriter creates a Logger writing to a custom io.Writer.
func NewWithWriter(quiet bool, w io.Writer) Logger {
	return Logger{
		quiet: quiet,
		level: LevelInfo,
		w:     w,
		mu:    &sync.Mutex{},
	}
}

// WithPrefix returns a child logger with an additional prefix (e.g. "[E2EE]").
func (l Logger) WithPrefix(prefix string) Logger {
	newPrefix := prefix
	if l.prefix != "" {
		newPrefix = l.prefix + " " + prefix
	}
	return Logger{
		quiet:   l.quiet,
		level:   l.level,
		prefix:  newPrefix,
		traceID: l.traceID,
		w:       l.w,
		mu:      l.mu,
	}
}

// WithTraceID returns a child logger tagged with a specific request/transfer trace ID.
func (l Logger) WithTraceID(traceID string) Logger {
	return Logger{
		quiet:   l.quiet,
		level:   l.level,
		prefix:  l.prefix,
		traceID: traceID,
		w:       l.w,
		mu:      l.mu,
	}
}

// SetLevel updates the minimum logging level.
func (l *Logger) SetLevel(level Level) {
	l.level = level
}

func (l Logger) formatMessage(msg string) string {
	if l.traceID != "" && l.prefix != "" {
		return fmt.Sprintf("[%s] %s %s", l.traceID, l.prefix, msg)
	}
	if l.traceID != "" {
		return fmt.Sprintf("[%s] %s", l.traceID, msg)
	}
	if l.prefix != "" {
		return fmt.Sprintf("%s %s", l.prefix, msg)
	}
	return msg
}

func (l Logger) write(tag, msg string) {
	timestamp := time.Now().Format("2006-01-02 15:04:05.000")
	formattedMsg := l.formatMessage(msg)
	fullLine := fmt.Sprintf("[%s] [%s] %s\n", timestamp, tag, formattedMsg)

	if !l.quiet {
		fmt.Print(fullLine)
	}

	if l.w != nil {
		if l.mu != nil {
			l.mu.Lock()
			defer l.mu.Unlock()
		}
		_, _ = io.WriteString(l.w, fullLine)
	}
}

// Print prints its argument if quiet is false.
func (l Logger) Print(args ...interface{}) {
	msg := fmt.Sprint(args...)
	if !l.quiet {
		fmt.Println(msg)
	}
	if l.w != nil {
		if l.mu != nil {
			l.mu.Lock()
			defer l.mu.Unlock()
		}
		timestamp := time.Now().Format("2006-01-02 15:04:05.000")
		_, _ = fmt.Fprintf(l.w, "[%s] [PRINT] %s\n", timestamp, l.formatMessage(msg))
	}
}

// Printf prints formatted output if quiet is false.
func (l Logger) Printf(format string, args ...interface{}) {
	msg := fmt.Sprintf(format, args...)
	if !l.quiet {
		fmt.Print(msg)
	}
	if l.w != nil {
		if l.mu != nil {
			l.mu.Lock()
			defer l.mu.Unlock()
		}
		timestamp := time.Now().Format("2006-01-02 15:04:05.000")
		_, _ = fmt.Fprintf(l.w, "[%s] [PRINT] %s\n", timestamp, l.formatMessage(msg))
	}
}

// Infof prints formatted info log with timestamp.
func (l Logger) Infof(format string, args ...interface{}) {
	if l.level > LevelInfo {
		return
	}
	l.write("INFO", fmt.Sprintf(format, args...))
}

// Warnf prints formatted warning log with timestamp.
func (l Logger) Warnf(format string, args ...interface{}) {
	if l.level > LevelWarn {
		return
	}
	l.write("WARN", fmt.Sprintf(format, args...))
}

// Errorf prints formatted error log with timestamp.
func (l Logger) Errorf(format string, args ...interface{}) {
	if l.level > LevelError {
		return
	}
	l.write("ERROR", fmt.Sprintf(format, args...))
}

// Debugf prints formatted debug log with timestamp.
func (l Logger) Debugf(format string, args ...interface{}) {
	if l.level > LevelDebug {
		return
	}
	l.write("DEBUG", fmt.Sprintf(format, args...))
}

// Tracef prints formatted debug trace log tagged with a trace ID.
func (l Logger) Tracef(traceID string, format string, args ...interface{}) {
	child := l.WithTraceID(traceID)
	child.Debugf(format, args...)
}
