package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestFileLogger_BasicAndAdapters(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "eqt-logger-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	logPath := filepath.Join(tempDir, "desktop.log")
	logger := NewFileLogger(logPath, true)

	// 1. 测试常规结构化调用
	logger.Info("GUI agent initialized successfully")
	logger.Warning("Testing warning message")

	// 2. 测试 Go 标准库 log.Printf 适配器挂接
	origOutput := log.Writer()
	log.SetOutput(logger)
	defer log.SetOutput(origOutput)

	// 2.1 传统无级别服务端日志
	log.Printf("[EQT Server] [Download Start] clientID=c8f12a, File=test.mp4")

	// 2.2 Phase 2 遥测客户端日志与访问日志（自嵌级别与来源框）
	log.Printf("[ERROR] [CLIENT] [c8f12a] [EXCEPTION] Uncaught TypeError in main.js | IP=192.168.1.5")
	log.Printf("[INFO] [SRV] HTTP GET /send/a1b2c3...x8y9z0 from 192.168.1.5")

	// 3. 测试 Chat v2 diag.NewStdLoggerWithWriter 真实输出（小写无括号 error/warn/info）
	_, _ = logger.Write([]byte("chat-v2 2026/09/04 15:04:05 info client connected\n"))
	_, _ = logger.Write([]byte("chat-v2 2026/09/04 15:04:05 error session handshake failed\n"))
	_, _ = logger.Write([]byte("chat-v2 2026/09/04 15:04:05 warn bandwidth limit exceeded\n"))

	// 优雅停机并等待 drain 完成
	logger.Close()

	// 读取落盘文件核验
	contentBytes, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("failed to read log file: %v", err)
	}
	content := string(contentBytes)

	if !strings.Contains(content, "[INFO] GUI agent initialized successfully") {
		t.Errorf("expected info line in log, got:\n%s", content)
	}
	if !strings.Contains(content, "[WARN] Testing warning message") {
		t.Errorf("expected warn line in log, got:\n%s", content)
	}
	// 核验标准库适配器是否对传统日志补全了 [INFO] [SRV]
	if !strings.Contains(content, "[INFO] [SRV] [EQT Server] [Download Start] clientID=c8f12a, File=test.mp4") {
		t.Errorf("expected adapted stdlib schema line in log, got:\n%s", content)
	}
	// 核验 Phase 2 自嵌级别行是否单帧真级别透传，杜绝双框！
	if !strings.Contains(content, "[ERROR] [CLIENT] [c8f12a] [EXCEPTION] Uncaught TypeError in main.js | IP=192.168.1.5") {
		t.Errorf("expected single-frame client error line, got:\n%s", content)
	}
	if !strings.Contains(content, "[INFO] [SRV] HTTP GET /send/a1b2c3...x8y9z0 from 192.168.1.5") {
		t.Errorf("expected single-frame access log line, got:\n%s", content)
	}
	if strings.Contains(content, "[INFO] [SRV] [ERROR]") || strings.Contains(content, "[INFO] [SRV] [INFO] [SRV]") {
		t.Errorf("detected double-bracket wrapping regression:\n%s", content)
	}

	// 核验 Chat v2 真实小写级别是否正确提取并映射为 [CHAT]
	if !strings.Contains(content, "[INFO] [CHAT] client connected") {
		t.Errorf("expected adapted chat-v2 info line, got:\n%s", content)
	}
	if !strings.Contains(content, "[ERROR] [CHAT] session handshake failed") {
		t.Errorf("expected adapted chat-v2 error line, got:\n%s", content)
	}
	if !strings.Contains(content, "[WARN] [CHAT] bandwidth limit exceeded") {
		t.Errorf("expected adapted chat-v2 warn line, got:\n%s", content)
	}
	if strings.Contains(content, "chat-v2 2026/09/04") || strings.Contains(content, "[INFO] [CHAT] error") {
		t.Errorf("detected raw chat-v2 prefix or unextracted lowercase level:\n%s", content)
	}
}

func TestFileLogger_DebugModeGate(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "eqt-logger-debug-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	logPath := filepath.Join(tempDir, "desktop.log")
	logger := NewFileLogger(logPath, true)
	logger.SetDebugMode(false) // 默认常态化关闭 debug

	logger.Debug("Hidden debug message")
	logger.Trace("Hidden trace message")
	logger.Info("Visible info message")

	logger.SetDebugMode(true) // 开启 debug
	logger.Debug("Visible debug message")

	logger.Close()

	contentBytes, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("failed to read log: %v", err)
	}
	content := string(contentBytes)

	if strings.Contains(content, "Hidden debug message") || strings.Contains(content, "Hidden trace message") {
		t.Errorf("debug/trace should be filtered when debugMode is false")
	}
	if !strings.Contains(content, "Visible info message") {
		t.Errorf("info message should always be visible")
	}
	if !strings.Contains(content, "Visible debug message") {
		t.Errorf("debug message should be visible when debugMode is true")
	}
}

func TestFileLogger_TailRotationStitching(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "eqt-logger-stitch-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	logPath := filepath.Join(tempDir, "desktop.log")
	// 预先写入备份文件 desktop.log.1
	backupPath := logPath + ".1"
	_ = os.WriteFile(backupPath, []byte("Old line 1\nOld line 2\nOld line 3\n"), 0644)

	// 新建 logger（当前文件 desktop.log 只有 1 行）
	logger := NewFileLogger(logPath, true)
	logger.Info("New line 1")
	logger.Close()

	// 请求 3 行，验证缝合能力
	tail, err := logger.Tail(3)
	if err != nil {
		t.Fatalf("Tail failed: %v", err)
	}
	if len(tail) < 3 {
		t.Fatalf("expected at least 3 lines stitched from .1, got %d: %v", len(tail), tail)
	}
	if !strings.Contains(tail[len(tail)-1], "New line 1") {
		t.Errorf("last line should be from active file, got: %s", tail[len(tail)-1])
	}
}

func TestFileLogger_TailThreadSafety(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "eqt-logger-tail-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	logPath := filepath.Join(tempDir, "desktop.log")
	logger := NewFileLogger(logPath, true)

	var wg sync.WaitGroup
	// 启动写协程持续快速写入
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 200; i++ {
			logger.Info(fmt.Sprintf("Concurrent log line %d", i))
			time.Sleep(1 * time.Millisecond)
		}
	}()

	// 启动读协程并发安全调用 Tail
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 20; i++ {
			lines, err := logger.Tail(10)
			if err != nil && !os.IsNotExist(err) {
				t.Errorf("Tail returned unexpected error: %v", err)
			}
			if len(lines) > 10 {
				t.Errorf("Tail returned more lines than requested: %d", len(lines))
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()

	wg.Wait()
	logger.Close()

	finalLines, err := logger.Tail(20)
	if err != nil {
		t.Fatalf("Tail failed: %v", err)
	}
	if len(finalLines) == 0 {
		t.Errorf("expected non-empty Tail output")
	}
}

func TestFileLogger_Rotation(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "eqt-logger-rotate-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	logPath := filepath.Join(tempDir, "desktop.log")
	logger := NewFileLogger(logPath, true)

	logger.mu.Lock()
	logger.currentSize = maxLogFileSize - 50
	logger.mu.Unlock()

	logger.Info("Line that triggers first rotation to desktop.log.1")
	time.Sleep(150 * time.Millisecond)

	logger.mu.Lock()
	logger.currentSize = maxLogFileSize - 50
	logger.mu.Unlock()

	logger.Info("Line that triggers second rotation to desktop.log.2")
	time.Sleep(150 * time.Millisecond)

	logger.Close()

	if _, err := os.Stat(logPath); os.IsNotExist(err) {
		t.Errorf("expected active log file to exist")
	}
	if _, err := os.Stat(logPath + ".1"); os.IsNotExist(err) {
		t.Errorf("expected backup log .1 to exist")
	}
}

func TestFileLogger_SaturationAndEmergencyWrite(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "eqt-logger-sat-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	logPath := filepath.Join(tempDir, "desktop.log")
	logger := NewFileLogger(logPath, true)

	// 填满 channel 模拟突发
	for i := 0; i < defaultLogChanCap+100; i++ {
		logger.Info(fmt.Sprintf("Flood info message %d", i))
	}

	start := time.Now()
	logger.Error("Critical error during saturation")
	elapsed := time.Since(start)

	if elapsed > 200*time.Millisecond {
		t.Errorf("Error logging took too long (%v), expected bounded timeout <= 200ms", elapsed)
	}

	logger.Close()

	contentBytes, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("failed to read log: %v", err)
	}
	content := string(contentBytes)
	if !strings.Contains(content, "Critical error during saturation") {
		t.Errorf("critical error was dropped during saturation! Content:\n%s", content)
	}
}
