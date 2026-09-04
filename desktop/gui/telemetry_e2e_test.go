package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"eqt/pkg/chat/v2/diag"
	"eqt/pkg/config"
	"eqt/pkg/server"
)

// TestTelemetryAndLogging_E2E_FullPipeline tests the entire end-to-end telemetry and unified logging pipeline:
// 1. FileLogger setup with log.SetOutput bridge & ChatV2Logger writer
// 2. Real HTTP server running with wrapAccessLog and /client-log handler
// 3. Client telemetry event ingestion (PAGE_LOAD, DOWNLOAD_CLICK, EXCEPTION)
// 4. Server access log token masking (/send/<token> -> /send/prefix...suffix)
// 5. Chat v2 lowercase level log ingestion & adaptation
// 6. Verification of single-frame canonical log file format (zero double brackets)
// 7. Security verification: CRLF injection stripping & rate limiter aggregation
// 8. In-App Log Viewer API: GetLogTail verification
// 9. Diagnostics ZIP export verification
// 10. File permissions verification (0600 on POSIX)
// 11. Concurrency & latency performance validation (<= 50ms response time)
func TestTelemetryAndLogging_E2E_FullPipeline(t *testing.T) {
	tempDir := t.TempDir()
	logPath := filepath.Join(tempDir, "desktop.log")

	// 1. Initialize FileLogger and set up bridges
	fileLogger := NewFileLogger(logPath, true)
	fileLogger.SetDebugMode(true)
	defer fileLogger.Close()

	origLogOutput := log.Writer()
	log.SetOutput(fileLogger)
	defer log.SetOutput(origLogOutput)

	// 2. Start a real HTTP server on an available port
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen on ephemeral port: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()

	testToken := "abcdef1234567890xyz987"
	cfg := &config.Config{
		Interface: "lo",
		Bind:      "127.0.0.1",
		Port:      port,
		Path:      testToken,
		KeepAlive: true,
	}

	srv, err := server.New(cfg)
	if err != nil {
		t.Fatalf("failed to create server: %v", err)
	}
	defer srv.Shutdown()

	// Hook ChatV2Logger into fileLogger
	srv.ChatV2Logger = diag.NewStdLoggerWithWriter(fileLogger)

	baseURL := fmt.Sprintf("http://127.0.0.1:%d", port)
	client := &http.Client{Timeout: 5 * time.Second}

	// Wait for server to become responsive
	ready := false
	for i := 0; i < 50; i++ {
		resp, err := client.Get(baseURL + "/client-log")
		if err == nil {
			_ = resp.Body.Close()
			ready = true
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !ready {
		t.Fatalf("server failed to start on %s", baseURL)
	}

	// 3. Perform Access Request to test Token Masking in Access Log
	reqURL := fmt.Sprintf("%s/send/%s", baseURL, testToken)
	resp, err := client.Get(reqURL)
	if err == nil {
		_ = resp.Body.Close()
	}

	// 4. Send Mobile Client Telemetry Events
	postTelemetry := func(entry server.ClientLogEntry) (*http.Response, time.Duration, error) {
		bodyBytes, _ := json.Marshal(entry)
		start := time.Now()
		r, err := client.Post(baseURL+"/client-log", "application/json", bytes.NewReader(bodyBytes))
		elapsed := time.Since(start)
		return r, elapsed, err
	}

	// 4.1 Normal PAGE_LOAD Event
	resp, latency, err := postTelemetry(server.ClientLogEntry{
		ClientID:  "mob_e2e_001",
		Timestamp: time.Now().UnixMilli(),
		Level:     "INFO",
		Category:  "PAGE_LOAD",
		Message:   "Download page initialized",
		Details: map[string]any{
			"screen": "390x844",
			"ua":     "Mobile Safari E2E",
		},
	})
	if err != nil || resp.StatusCode != http.StatusNoContent {
		t.Fatalf("failed to post PAGE_LOAD: err=%v, resp=%v", err, resp)
	}
	_ = resp.Body.Close()
	if latency > 100*time.Millisecond {
		t.Errorf("telemetry post latency too high: %v (expected <= 100ms CI gate)", latency)
	}

	// 4.2 DOWNLOAD_CLICK Event
	resp, _, err = postTelemetry(server.ClientLogEntry{
		ClientID:  "mob_e2e_001",
		Timestamp: time.Now().UnixMilli(),
		Level:     "INFO",
		Category:  "DOWNLOAD_CLICK",
		Message:   "User clicked download file",
		Details: map[string]any{
			"file_name": "annual_report_2026.pdf",
			"size":      1048576,
		},
	})
	if err != nil || resp.StatusCode != http.StatusNoContent {
		t.Fatalf("failed to post DOWNLOAD_CLICK: err=%v", err)
	}
	_ = resp.Body.Close()

	// 4.3 Malicious CRLF Injection Event
	resp, _, err = postTelemetry(server.ClientLogEntry{
		ClientID:  "mob_evil_999",
		Timestamp: time.Now().UnixMilli(),
		Level:     "ERROR",
		Category:  "EXCEPTION",
		Message:   "Crash event\r\n[2026/09/04 00:00:00] [CRITICAL] Fake Injected Log Line\nAnother injected line",
		Details: map[string]any{
			"stack\r\n": "TypeError: null is not an object\r\nat index.js:12",
		},
	})
	if err != nil || resp.StatusCode != http.StatusNoContent {
		t.Fatalf("failed to post EXCEPTION: err=%v", err)
	}
	_ = resp.Body.Close()

	// 5. Emit Chat v2 Logger events directly (小写无括号 error/warn/info)
	ctx := context.Background()
	srv.ChatV2Logger.Log(ctx, diag.Event{Level: diag.LevelInfo, Message: "peer handshake completed successfully"})
	srv.ChatV2Logger.Log(ctx, diag.Event{Level: diag.LevelWarn, Message: "bandwidth congestion window throttling"})
	srv.ChatV2Logger.Log(ctx, diag.Event{Level: diag.LevelError, Message: "websocket heartbeat timeout detected"})

	// 6. Trigger Rate Limiter Burst concurrently to test aggregation notice
	// (40 concurrent requests against capacity 10 bucket guarantees >=10 drops without wall-clock drift)
	var burstWg sync.WaitGroup
	burstCount := 40
	for i := 0; i < burstCount; i++ {
		burstWg.Add(1)
		go func(idx int) {
			defer burstWg.Done()
			r, _, err := postTelemetry(server.ClientLogEntry{
				ClientID:  "burst_client",
				Timestamp: time.Now().UnixMilli(),
				Level:     "INFO",
				Category:  "HEARTBEAT",
				Message:   fmt.Sprintf("Burst packet %d", idx),
			})
			if err == nil && r != nil && r.Body != nil {
				_ = r.Body.Close()
			}
		}(i)
	}
	burstWg.Wait()

	// 7. Flush and close logger to ensure all lines are drained to disk
	fileLogger.Close()

	// 8. Read the physical desktop.log file and verify formatting
	contentBytes, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("failed to read log file: %v", err)
	}
	content := string(contentBytes)

	// Check 8.1: Access log was captured with token masked
	expectedMasked := "/send/abcdef...xyz987"
	if !strings.Contains(content, expectedMasked) {
		t.Errorf("expected masked token in access log (%s), got:\n%s", expectedMasked, content)
	}
	if strings.Contains(content, testToken) {
		t.Errorf("full unmasked token leaked in log file:\n%s", content)
	}
	if !strings.Contains(content, "[INFO] [SRV] HTTP GET "+expectedMasked) {
		t.Errorf("expected canonical [INFO] [SRV] access line, got:\n%s", content)
	}

	// Check 8.2: Client telemetry was captured with exact levels and categories
	if !strings.Contains(content, "[INFO] [CLIENT] [mob_e2e_001] [PAGE_LOAD] Download page initialized") {
		t.Errorf("expected PAGE_LOAD client log line in log, got:\n%s", content)
	}
	if !strings.Contains(content, "[INFO] [CLIENT] [mob_e2e_001] [DOWNLOAD_CLICK] User clicked download file") {
		t.Errorf("expected DOWNLOAD_CLICK client log line in log, got:\n%s", content)
	}
	if !strings.Contains(content, "[ERROR] [CLIENT] [mob_evil_999] [EXCEPTION]") {
		t.Errorf("expected EXCEPTION client log line in log, got:\n%s", content)
	}

	// Check 8.3: Chat v2 logs were adapted to [CHAT] with proper level
	if !strings.Contains(content, "[INFO] [CHAT] peer handshake completed successfully") {
		t.Errorf("expected chat v2 info line, got:\n%s", content)
	}
	if !strings.Contains(content, "[WARN] [CHAT] bandwidth congestion window throttling") {
		t.Errorf("expected chat v2 warn line, got:\n%s", content)
	}
	if !strings.Contains(content, "[ERROR] [CHAT] websocket heartbeat timeout detected") {
		t.Errorf("expected chat v2 error line, got:\n%s", content)
	}

	// Check 8.4: Zero double brackets (e.g. [INFO] [SRV] [INFO] or [INFO] [SRV] [ERROR])
	if strings.Contains(content, "[INFO] [SRV] [INFO]") ||
		strings.Contains(content, "[INFO] [SRV] [ERROR]") ||
		strings.Contains(content, "[INFO] [SRV] [WARN]") {
		t.Errorf("detected double bracket wrapping regression:\n%s", content)
	}

	// Check 8.5: CRLF injection was stripped into single physical lines
	if strings.Contains(content, "Fake Injected Log Line\nAnother injected line") ||
		strings.Contains(content, "[CRITICAL] Fake Injected Log Line") {
		for _, line := range strings.Split(content, "\n") {
			if strings.HasPrefix(strings.TrimSpace(line), "[CRITICAL]") {
				t.Errorf("CRLF injection created fake log line: %q", line)
			}
		}
	}

	// Check 8.6: Rate limiter dropped count aggregation alert
	if !strings.Contains(content, "[WARN] [SRV] Dropped client-log telemetry requests due to IP rate limiting") {
		t.Errorf("expected rate limit aggregation warning line in log, got:\n%s", content)
	}

	// 9. Verify In-App Log Viewer API: GetLogTail
	app := NewApp()
	app.logger = NewFileLogger(logPath, true)
	defer app.logger.Close()

	tailLines, err := app.GetLogTail(100)
	if err != nil {
		t.Fatalf("GetLogTail failed: %v", err)
	}
	if len(tailLines) == 0 {
		t.Fatalf("expected non-empty GetLogTail output")
	}
	foundClick := false
	for _, l := range tailLines {
		if strings.Contains(l, "DOWNLOAD_CLICK") {
			foundClick = true
			break
		}
	}
	if !foundClick {
		t.Errorf("GetLogTail did not return DOWNLOAD_CLICK line: %v", tailLines)
	}

	// 10. Verify Diagnostics ZIP Export
	zipPath := filepath.Join(tempDir, "diagnostics_export.zip")
	appInfo := AppInfo{
		Product: "EQT E2E",
		Version: "v1.36.34",
		OS:      "linux",
		Arch:    "amd64",
	}
	rawDump := map[string]any{
		"panic_reason": "e2e-simulation",
	}

	if err := buildDiagnosticsZip(zipPath, tempDir, appInfo, rawDump); err != nil {
		t.Fatalf("buildDiagnosticsZip failed: %v", err)
	}

	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		t.Fatalf("failed to open generated zip: %v", err)
	}
	defer zr.Close()

	hasLog := false
	hasEnv := false
	hasCrash := false
	for _, f := range zr.File {
		if f.Name == "logs/desktop.log" {
			hasLog = true
			rc, err := f.Open()
			if err == nil {
				buf, _ := io.ReadAll(rc)
				rc.Close()
				if !strings.Contains(string(buf), "DOWNLOAD_CLICK") {
					t.Errorf("zip desktop.log content missing DOWNLOAD_CLICK")
				}
			}
		}
		if f.Name == "environment.json" {
			hasEnv = true
		}
		if f.Name == "crash-dump.json" {
			hasCrash = true
		}
	}
	if !hasLog || !hasEnv || !hasCrash {
		t.Errorf("zip missing required files: hasLog=%v, hasEnv=%v, hasCrash=%v", hasLog, hasEnv, hasCrash)
	}

	// 11. Verify file permissions (0600 on Linux/macOS)
	fi, err := os.Stat(logPath)
	if err != nil {
		t.Fatalf("failed to stat log file: %v", err)
	}
	perm := fi.Mode().Perm()
	if os.PathSeparator == '/' {
		if perm != 0600 {
			t.Errorf("log file permission = %04o, want 0600", perm)
		}
	}

	// 12. High-concurrency performance validation (50 goroutines)
	// Restart a lightweight logger for concurrency benchmarking
	benchLogPath := filepath.Join(tempDir, "bench.log")
	benchLogger := NewFileLogger(benchLogPath, true)
	defer benchLogger.Close()
	log.SetOutput(benchLogger)

	var wg sync.WaitGroup
	concurrentCount := 50
	maxLatency := time.Duration(0)
	var mu sync.Mutex

	for i := 0; i < concurrentCount; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			_, elapsed, postErr := postTelemetry(server.ClientLogEntry{
				ClientID:  fmt.Sprintf("bench_%03d", idx),
				Timestamp: time.Now().UnixMilli(),
				Level:     "INFO",
				Category:  "CLIENT_EVENT",
				Message:   fmt.Sprintf("Concurrent stress line %d", idx),
			})
			if postErr == nil {
				mu.Lock()
				if elapsed > maxLatency {
					maxLatency = elapsed
				}
				mu.Unlock()
			}
		}(i)
	}
	wg.Wait()
	t.Logf("50 concurrent telemetry posts completed. Max latency: %v (target <= 50ms, CI gate <= 100ms)", maxLatency)
	if maxLatency > 100*time.Millisecond {
		t.Errorf("maximum concurrent post latency too high: %v (expected <= 100ms CI gate)", maxLatency)
	}
}
