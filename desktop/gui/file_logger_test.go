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

func TestFileLogger_BasicAndStdlibAdapter(t *testing.T) {
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

	log.Printf("[EQT Server] [Download Start] clientID=c8f12a, File=test.mp4")

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
	// 核验标准库适配器是否补全了 [INFO] [SRV] 并剔除了原先的裸格式
	if !strings.Contains(content, "[INFO] [SRV] [EQT Server] [Download Start] clientID=c8f12a, File=test.mp4") {
		t.Errorf("expected adapted stdlib schema line in log, got:\n%s", content)
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

	// 人工缩小 currentSize 阈值来模拟 10MB 触发轮转
	logger.mu.Lock()
	logger.currentSize = maxLogFileSize - 50 // 只需写入 100 字节即可触发轮转
	logger.mu.Unlock()

	logger.Info("Line that triggers first rotation to desktop.log.1")
	time.Sleep(150 * time.Millisecond)

	// 再次制造阈值触发第二次轮转
	logger.mu.Lock()
	logger.currentSize = maxLogFileSize - 50
	logger.mu.Unlock()

	logger.Info("Line that triggers second rotation to desktop.log.2")
	time.Sleep(150 * time.Millisecond)

	logger.Close()

	// 检查备份文件是否存在
	if _, err := os.Stat(logPath); os.IsNotExist(err) {
		t.Errorf("expected active log file to exist")
	}
	if _, err := os.Stat(logPath + ".1"); os.IsNotExist(err) {
		t.Errorf("expected backup log .1 to exist")
	}
}

func TestFileLogger_DisabledDropsWrites(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "eqt-logger-disabled-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	logPath := filepath.Join(tempDir, "desktop.log")
	logger := NewFileLogger(logPath, false) // 禁用状态

	logger.Info("This line should be dropped completely")
	logger.Close()

	fi, err := os.Stat(logPath)
	if err == nil && fi.Size() > 0 {
		t.Errorf("expected empty log file when disabled, but size is %d", fi.Size())
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

	// 填满 channel 模拟极高突发并发
	for i := 0; i < defaultLogChanCap+100; i++ {
		logger.Info(fmt.Sprintf("Flood info message %d", i))
	}

	// 此时 channel 已满，发送 ERROR，验证 50ms 有界等待或紧急兜底落盘
	start := time.Now()
	logger.Error("Critical error during saturation")
	elapsed := time.Since(start)

	// 有界等待应当在合理范围内（<= 200ms），绝不永久死锁
	if elapsed > 200*time.Millisecond {
		t.Errorf("Error logging took too long (%v), expected bounded timeout <= 200ms", elapsed)
	}

	logger.Close()

	// 验证落盘内容中必须包含 Critical error
	contentBytes, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("failed to read log: %v", err)
	}
	content := string(contentBytes)
	if !strings.Contains(content, "Critical error during saturation") {
		t.Errorf("critical error was dropped during saturation! Content:\n%s", content)
	}
}

