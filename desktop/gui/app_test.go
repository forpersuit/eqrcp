package main

import (
	"archive/zip"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"eqt/pkg/cert"
	"eqt/pkg/server"
)

func TestParseDesktopIntegrationStatus(t *testing.T) {
	status := parseDesktopIntegrationStatus("Windows desktop integration status\n- summary: 6 installed, 0 needs repair, 0 not installed")
	if !status.Supported || !status.Enabled || status.NeedsRepair {
		t.Fatalf("status = %#v, want supported enabled clean", status)
	}

	status = parseDesktopIntegrationStatus("Windows desktop integration status\n- summary: 4 installed, 1 needs repair, 1 not installed")
	if !status.Supported || status.Enabled || !status.NeedsRepair {
		t.Fatalf("status = %#v, want supported repair state", status)
	}

	status = parseDesktopIntegrationStatus("Desktop integration status is not implemented for linux yet.")
	if status.Supported || status.Enabled || status.NeedsRepair {
		t.Fatalf("status = %#v, want unsupported", status)
	}
}

func TestDesktopIntegrationCommands(t *testing.T) {
	oldInstallInt := cmdInstallDesktopIntegration
	oldUninstallInt := cmdUninstallDesktopIntegration
	oldIntStatus := cmdDesktopIntegrationStatus

	defer func() {
		cmdInstallDesktopIntegration = oldInstallInt
		cmdUninstallDesktopIntegration = oldUninstallInt
		cmdDesktopIntegrationStatus = oldIntStatus
	}()

	var calls []string
	cmdInstallDesktopIntegration = func() error {
		calls = append(calls, "InstallDesktopIntegration")
		return nil
	}
	cmdUninstallDesktopIntegration = func() error {
		calls = append(calls, "UninstallDesktopIntegration")
		return nil
	}
	cmdDesktopIntegrationStatus = func() (string, error) {
		calls = append(calls, "DesktopIntegrationStatus")
		return "Windows desktop integration status\n- summary: 6 installed, 0 needs repair, 0 not installed", nil
	}

	app := NewApp()
	if status, err := app.SetRightClickIntegrationEnabled(true); err != nil || !status.Enabled {
		t.Fatalf("SetRightClickIntegrationEnabled(true) = %#v, %v", status, err)
	}
	if _, err := app.SetRightClickIntegrationEnabled(false); err != nil {
		t.Fatalf("SetRightClickIntegrationEnabled(false) error = %v", err)
	}

	got := strings.Join(calls, "\n")
	for _, want := range []string{
		"InstallDesktopIntegration",
		"UninstallDesktopIntegration",
		"DesktopIntegrationStatus",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("calls = %q, want to contain %q", got, want)
		}
	}
}

func TestAppClearPendingUpdate(t *testing.T) {
	app := NewApp()
	if err := app.ClearPendingUpdate(); err != nil {
		t.Fatalf("ClearPendingUpdate failed: %v", err)
	}
}

func TestAppQuitApp(t *testing.T) {
	app := NewApp()
	// QuitApp should safely invoke cleanup without panics
	app.QuitApp()
	if !app.forceQuit {
		t.Fatalf("expected forceQuit to be true after QuitApp")
	}
}

func TestGetLogTailAndBuildDiagnosticsZip(t *testing.T) {
	tempDir := t.TempDir()
	logPath := filepath.Join(tempDir, "desktop.log")
	linesData := "line 1\nline 2\nline 3\nline 4\nline 5\n"
	if err := os.WriteFile(logPath, []byte(linesData), 0644); err != nil {
		t.Fatalf("failed to write test log file: %v", err)
	}

	app := NewApp()
	logger := NewFileLogger(logPath, true)
	app.logger = logger
	defer logger.Close()

	// 1. Verify GetLogTail
	tails, err := app.GetLogTail(3)
	if err != nil {
		t.Fatalf("GetLogTail failed: %v", err)
	}
	if len(tails) != 3 {
		t.Fatalf("expected 3 lines, got %d: %v", len(tails), tails)
	}
	if tails[len(tails)-1] != "line 5" {
		t.Fatalf("expected last line to be 'line 5', got %q", tails[len(tails)-1])
	}

	// 2. Pre-create rotated log files (e.g. desktop.log.1, desktop.log.2)
	rotPath1 := filepath.Join(tempDir, "desktop.log.1")
	rotPath2 := filepath.Join(tempDir, "desktop.log.2")
	_ = os.WriteFile(rotPath1, []byte("rotated log 1 content\n"), 0644)
	_ = os.WriteFile(rotPath2, []byte("rotated log 2 content\n"), 0644)

	// 3. Verify buildDiagnosticsZip with main log, rotated logs, and crash dump
	zipPath := filepath.Join(tempDir, "diag.zip")
	info := AppInfo{
		Product: "EQT Test",
		Version: "v1.36.35",
		OS:      "linux",
		Arch:    "amd64",
	}
	rawDump := map[string]any{"reason": "test-panic"}

	if err := buildDiagnosticsZip(zipPath, tempDir, info, rawDump); err != nil {
		t.Fatalf("buildDiagnosticsZip failed: %v", err)
	}

	// Read and verify zip contents
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		t.Fatalf("zip.OpenReader failed: %v", err)
	}
	defer r.Close()

	foundLog := false
	foundRot1 := false
	foundRot2 := false
	foundCrash := false
	foundEnv := false
	for _, f := range r.File {
		if f.Name == "logs/desktop.log" {
			foundLog = true
		}
		if f.Name == "logs/desktop.log.1" {
			foundRot1 = true
		}
		if f.Name == "logs/desktop.log.2" {
			foundRot2 = true
		}
		if f.Name == "crash-dump.json" {
			foundCrash = true
		}
		if f.Name == "environment.json" {
			foundEnv = true
		}
	}
	if !foundLog {
		t.Errorf("expected logs/desktop.log in zip")
	}
	if !foundRot1 {
		t.Errorf("expected logs/desktop.log.1 in zip")
	}
	if !foundRot2 {
		t.Errorf("expected logs/desktop.log.2 in zip")
	}
	if !foundCrash {
		t.Errorf("expected crash-dump.json in zip")
	}
	if !foundEnv {
		t.Errorf("expected environment.json in zip")
	}

	// 4. Verify buildDiagnosticsZip on empty log directory without crash dump
	emptyDir := t.TempDir()
	emptyZipPath := filepath.Join(emptyDir, "empty-diag.zip")
	if err := buildDiagnosticsZip(emptyZipPath, emptyDir, info, nil); err != nil {
		t.Fatalf("buildDiagnosticsZip on empty directory failed: %v", err)
	}
	rEmpty, err := zip.OpenReader(emptyZipPath)
	if err != nil {
		t.Fatalf("zip.OpenReader on empty zip failed: %v", err)
	}
	defer rEmpty.Close()

	emptyHasEnv := false
	emptyHasLog := false
	for _, f := range rEmpty.File {
		if f.Name == "environment.json" {
			emptyHasEnv = true
		}
		if strings.HasPrefix(f.Name, "logs/") {
			emptyHasLog = true
		}
	}
	if !emptyHasEnv {
		t.Errorf("expected environment.json in empty zip")
	}
	if emptyHasLog {
		t.Errorf("expected no logs/ entries in empty zip")
	}

	// 5. Verify GetLogTail on missing/non-existent log file
	missingApp := NewApp()
	missingLogger := NewFileLogger(filepath.Join(emptyDir, "nonexistent.log"), true)
	missingApp.logger = missingLogger
	defer missingLogger.Close()

	emptyTails, err := missingApp.GetLogTail(10)
	if err != nil {
		t.Fatalf("GetLogTail on non-existent file returned error: %v", err)
	}
	if len(emptyTails) != 0 {
		t.Fatalf("expected 0 lines from non-existent log, got %d", len(emptyTails))
	}
}

func TestDevProvisionDeviceTLSCert_FreeUserBlocked(t *testing.T) {
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)
	t.Setenv("EQT_CONFIG_DIR", filepath.Join(tempHome, "eqt_conf"))

	app := NewApp()
	app.logger = NewFileLogger(filepath.Join(tempHome, "desktop.log"), true)
	defer app.logger.Close()

	// When EQT_TESTING is not set and user is not paid, provisioning must be blocked
	success, err := app.DevProvisionDeviceTLSCert()
	if success {
		t.Fatalf("expected success=false for free tier user, got true")
	}
	if err == nil || !strings.Contains(err.Error(), "PLUS exclusive") {
		t.Fatalf("expected error mentioning PLUS exclusive, got: %v", err)
	}
}

func TestDevProvisionDeviceTLSCert(t *testing.T) {
	t.Setenv("EQT_TESTING", "true")
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)
	t.Setenv("EQT_CONFIG_DIR", filepath.Join(tempHome, "eqt_conf"))

	// Mock Gateway returning 429 rate limit
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error":       "Certificate issuance rate limit exceeded (maximum 3 requests per 24 hours)",
			"reason_key":  "rate_limited",
			"retry_after": 86400,
		})
	}))
	defer server.Close()

	t.Setenv("EQT_PROVISION_ENDPOINT", server.URL)

	app := NewApp()
	app.logger = NewFileLogger(filepath.Join(tempHome, "desktop.log"), true)
	defer app.logger.Close()

	// 1. DevProvisionDeviceTLSCert triggers provisioning with dedicated 45s client
	success, err := app.DevProvisionDeviceTLSCert()
	if success {
		t.Fatalf("expected success=false when mock server returns 429 rate limited, got true")
	}
	if err == nil {
		t.Fatalf("expected non-nil error when gateway returns rate limit, got nil")
	}
	if !strings.Contains(err.Error(), "rate limit") && !strings.Contains(err.Error(), "rate_limited") {
		t.Errorf("expected error to mention rate limit, got: %v", err)
	}
}

func TestDevProvisionDeviceTLSCert_ToleratesServerLatencyAboveFiveSeconds(t *testing.T) {
	t.Setenv("EQT_TESTING", "true")
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)
	t.Setenv("EQT_CONFIG_DIR", filepath.Join(tempHome, "eqt_conf"))

	// Server sleeps 5.5s (longer than the old 5s timeout, but well within 45s)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(5500 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error":       "Certificate issuance rate limit exceeded",
			"reason_key":  "rate_limited",
			"retry_after": 86400,
		})
	}))
	defer server.Close()

	t.Setenv("EQT_PROVISION_ENDPOINT", server.URL)

	app := NewApp()
	app.logger = NewFileLogger(filepath.Join(tempHome, "desktop.log"), true)
	defer app.logger.Close()

	success, err := app.DevProvisionDeviceTLSCert()
	if success {
		t.Fatalf("expected success=false, got true")
	}
	if err == nil {
		t.Fatalf("expected rate limit error, got nil")
	}
	// Must NOT be context deadline exceeded / Client.Timeout exceeded
	if strings.Contains(err.Error(), "Client.Timeout exceeded") {
		t.Fatalf("provisioning client timed out at 5 seconds! Error: %v", err)
	}
	if !strings.Contains(err.Error(), "rate limit") {
		t.Errorf("expected rate limit error after 5.5s server latency, got: %v", err)
	}
}

func TestDevProvisionDeviceTLSCert_Gateway500ErrorSetsLastTLSError(t *testing.T) {
	t.Setenv("EQT_TESTING", "true")
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)
	t.Setenv("EQT_CONFIG_DIR", filepath.Join(tempHome, "eqt_conf"))

	// Mock Gateway returning 500 internal_error (reproducing user scenario)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error":      "An unexpected error occurred while issuing the certificate",
			"reason_key": "internal_error",
		})
	}))
	defer server.Close()

	t.Setenv("EQT_PROVISION_ENDPOINT", server.URL)

	app := NewApp()
	app.logger = NewFileLogger(filepath.Join(tempHome, "desktop.log"), true)
	defer app.logger.Close()

	success, err := app.DevProvisionDeviceTLSCert()
	if success {
		t.Fatalf("expected success=false when gateway returns 500, got true")
	}
	if err == nil {
		t.Fatalf("expected non-nil error when gateway returns 500, got nil")
	}
	if !strings.Contains(err.Error(), "HTTP 500") {
		t.Errorf("expected error to mention HTTP 500, got: %v", err)
	}

	// Verify app.GetLastTLSError captures the failure
	lastErr := app.GetLastTLSError()
	if !strings.Contains(lastErr, "HTTP 500") {
		t.Errorf("expected GetLastTLSError to contain HTTP 500, got: %s", lastErr)
	}

	// Verify AppInfo() surfaces the error when certificate is not valid
	info := app.AppInfo()
	if info.HasValidTLSCert {
		t.Errorf("expected HasValidTLSCert=false")
	}
	if !strings.Contains(info.TLSError, "HTTP 500") {
		t.Errorf("expected AppInfo.TLSError to contain HTTP 500, got: %s", info.TLSError)
	}
}

func TestSilentProvisionDeviceTLSCert_SkipsWhenTLSDisabled(t *testing.T) {
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)
	t.Setenv("EQT_CONFIG_DIR", filepath.Join(tempHome, "eqt_conf"))

	// Create a mock server that fails the test if any request is received
	requestReceived := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestReceived = true
		t.Errorf("unsolicited network request received by provisioner endpoint: %s %s", r.Method, r.URL.Path)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	t.Setenv("EQT_PROVISION_ENDPOINT", server.URL)

	app := NewApp()
	app.agent = newDesktopAgent(nil)
	// Explicitly ensure EnableTLS is false
	settings, _ := app.agent.readSettings()
	settings.EnableTLS = false
	_, _ = app.agent.writeSettings(settings)

	// Call silentProvisionDeviceTLSCert directly; it must immediately return without sleeping or sending requests
	start := time.Now()
	app.silentProvisionDeviceTLSCert()
	elapsed := time.Since(start)

	if requestReceived {
		t.Fatalf("expected NO network request when EnableTLS is false, but request was sent!")
	}
	if elapsed > 1*time.Second {
		t.Fatalf("silentProvisionDeviceTLSCert took %v, expected near-instant return (<1s) when TLS is disabled", elapsed)
	}
}

func TestDevProvisionDeviceTLSCert_NodeKeyMismatchAutoDisablesTLS(t *testing.T) {
	t.Setenv("EQT_TESTING", "true")
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)
	t.Setenv("EQT_CONFIG_DIR", filepath.Join(tempHome, "eqt_conf"))

	// Mock Gateway returning 403 node_key_mismatch
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error":      "node public key does not match cloud registration",
			"reason_key": "node_key_mismatch",
		})
	}))
	defer server.Close()

	t.Setenv("EQT_PROVISION_ENDPOINT", server.URL)

	app := NewApp()
	app.logger = NewFileLogger(filepath.Join(tempHome, "desktop.log"), true)
	defer app.logger.Close()

	app.agent = newDesktopAgent(nil)
	settings, err := app.agent.readSettings()
	if err != nil {
		t.Fatalf("readSettings failed: %v", err)
	}
	settings.EnableTLS = true
	if _, err := app.agent.writeSettings(settings); err != nil {
		t.Fatalf("writeSettings failed: %v", err)
	}

	// 验证初始状态 EnableTLS 为 true
	verifySettings, err := app.agent.readSettings()
	if err != nil || !verifySettings.EnableTLS {
		t.Fatalf("expected EnableTLS=true initially, got: %v", verifySettings.EnableTLS)
	}

	// 执行置备（内部自愈重试一次后仍 403，触发 ErrNodeKeyMismatch）
	success, err := app.DevProvisionDeviceTLSCert()
	if success {
		t.Fatalf("expected success=false for node_key_mismatch, got true")
	}
	if err == nil {
		t.Fatalf("expected non-nil error, got nil")
	}
	if !errors.Is(err, cert.ErrNodeKeyMismatch) {
		t.Fatalf("expected error to wrap cert.ErrNodeKeyMismatch, got: %v", err)
	}

	// 第一性原理：断言磁盘设置上的 EnableTLS 已被同步原子重置为 false！
	finalSettings, err := app.agent.readSettings()
	if err != nil {
		t.Fatalf("failed to read settings after provision failure: %v", err)
	}
	if finalSettings.EnableTLS {
		t.Fatalf("R34-1 regression: EnableTLS was not persisted as false on ErrNodeKeyMismatch!")
	}
}

func TestDevProvisionDeviceTLSCert_PersistsBeforeBroadcastAndTracksRateLimit(t *testing.T) {
	t.Setenv("EQT_TESTING", "true")
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)
	t.Setenv("EQT_CONFIG_DIR", filepath.Join(tempHome, "eqt_conf"))

	reqCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqCount++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error":       "certificate issuance rate limit exceeded",
			"reason_key":  "rate_limited",
			"retry_after": 3600,
		})
	}))
	defer server.Close()

	t.Setenv("EQT_PROVISION_ENDPOINT", server.URL)

	app := NewApp()
	app.logger = NewFileLogger(filepath.Join(tempHome, "desktop.log"), true)
	defer app.logger.Close()

	app.agent = newDesktopAgent(nil)
	settings, err := app.agent.readSettings()
	if err != nil {
		t.Fatalf("readSettings failed: %v", err)
	}
	settings.EnableTLS = true
	if _, err := app.agent.writeSettings(settings); err != nil {
		t.Fatalf("writeSettings failed: %v", err)
	}

	hookCalled := false
	app.testHookBeforeFailBroadcast = func() {
		hookCalled = true
		diskSettings, err := app.agent.readSettings()
		if err != nil {
			t.Fatalf("hook failed to read disk settings: %v", err)
		}
		if diskSettings.EnableTLS {
			t.Fatalf("INVARIANT VIOLATION: EnableTLS must be written to disk as false BEFORE broadcasting failure event! got true")
		}
	}

	// 第一次调用：向 mock server 请求并触发 429
	success, err := app.DevProvisionDeviceTLSCert()
	if success {
		t.Fatalf("expected success=false for rate limit, got true")
	}
	if err == nil {
		t.Fatalf("expected non-nil error, got nil")
	}
	if !hookCalled {
		t.Fatalf("testHookBeforeFailBroadcast was not called!")
	}

	// 验证统计信息与冷却保护状态
	stats := app.GetTLSIssuanceStats()
	if stats.RateLimitCount != 1 {
		t.Fatalf("expected RateLimitCount=1, got %d", stats.RateLimitCount)
	}
	if !stats.IsRateLimitedActive {
		t.Fatalf("expected IsRateLimitedActive=true, got false")
	}
	if stats.RemainingCoolingSec <= 0 {
		t.Fatalf("expected RemainingCoolingSec > 0, got %d", stats.RemainingCoolingSec)
	}

	// 第二次调用：应当触发主动冷却拦截，直接短路（不再向 server 发送请求）
	hookCalled = false
	currentReqCount := reqCount
	success2, err2 := app.DevProvisionDeviceTLSCert()
	if success2 {
		t.Fatalf("expected success2=false during active cooldown, got true")
	}
	if err2 == nil || !strings.Contains(err2.Error(), "cooldown") {
		t.Fatalf("expected cooldown error, got: %v", err2)
	}
	if reqCount != currentReqCount {
		t.Fatalf("expected no new HTTP request during cooldown, but reqCount changed from %d to %d", currentReqCount, reqCount)
	}
	if !hookCalled {
		t.Fatalf("testHookBeforeFailBroadcast was not called on cooldown short-circuit!")
	}
}

func TestDevProvisionDeviceTLSCert_ParsesServerRetryAfter86400(t *testing.T) {
	t.Setenv("EQT_TESTING", "true")
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)
	t.Setenv("EQT_CONFIG_DIR", filepath.Join(tempHome, "eqt_conf"))

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error":       "Certificate issuance rate limit exceeded (maximum 3 requests per 24 hours)",
			"reason_key":  "rate_limited",
			"retry_after": 86400,
		})
	}))
	defer server.Close()

	t.Setenv("EQT_PROVISION_ENDPOINT", server.URL)

	app := NewApp()
	app.logger = NewFileLogger(filepath.Join(tempHome, "desktop.log"), true)
	defer app.logger.Close()

	app.agent = newDesktopAgent(nil)
	settings, err := app.agent.readSettings()
	if err != nil {
		t.Fatalf("readSettings failed: %v", err)
	}
	settings.EnableTLS = true
	if _, err := app.agent.writeSettings(settings); err != nil {
		t.Fatalf("writeSettings failed: %v", err)
	}

	success, err := app.DevProvisionDeviceTLSCert()
	if success {
		t.Fatalf("expected success=false for rate limit, got true")
	}
	if err == nil {
		t.Fatalf("expected non-nil error, got nil")
	}

	stats := app.GetTLSIssuanceStats()
	if stats.RateLimitCount != 1 {
		t.Fatalf("expected RateLimitCount=1, got %d", stats.RateLimitCount)
	}
	if !stats.IsRateLimitedActive {
		t.Fatalf("expected IsRateLimitedActive=true, got false")
	}
	// R36-3: Server specified retry_after: 86400; must not be hardcoded to 3600!
	if stats.RemainingCoolingSec < 80000 {
		t.Fatalf("expected RemainingCoolingSec close to 86400, got %d (hardcoded 3600 defect)", stats.RemainingCoolingSec)
	}
}

func TestDevProvisionDeviceTLSCert_NonRateLimitQuotaErrorDoesNotTriggerCooldown(t *testing.T) {
	t.Setenv("EQT_TESTING", "true")
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)
	t.Setenv("EQT_CONFIG_DIR", filepath.Join(tempHome, "eqt_conf"))

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error":      "user storage quota exceeded",
			"reason_key": "quota_error",
		})
	}))
	defer server.Close()

	t.Setenv("EQT_PROVISION_ENDPOINT", server.URL)

	app := NewApp()
	app.logger = NewFileLogger(filepath.Join(tempHome, "desktop.log"), true)
	defer app.logger.Close()

	app.agent = newDesktopAgent(nil)
	settings, err := app.agent.readSettings()
	if err != nil {
		t.Fatalf("readSettings failed: %v", err)
	}
	settings.EnableTLS = true
	if _, err := app.agent.writeSettings(settings); err != nil {
		t.Fatalf("writeSettings failed: %v", err)
	}

	success, err := app.DevProvisionDeviceTLSCert()
	if success {
		t.Fatalf("expected success=false for error, got true")
	}
	if err == nil {
		t.Fatalf("expected non-nil error, got nil")
	}

	// R36-2: Non-rate-limit error containing "quota" must NOT increment RateLimitCount or activate cooldown!
	stats := app.GetTLSIssuanceStats()
	if stats.RateLimitCount != 0 {
		t.Fatalf("expected RateLimitCount=0 for non-rate-limit quota error, got %d (R36-2 defect)", stats.RateLimitCount)
	}
	if stats.FailureCount != 1 {
		t.Fatalf("expected FailureCount=1, got %d", stats.FailureCount)
	}
	if stats.IsRateLimitedActive {
		t.Fatalf("expected IsRateLimitedActive=false for non-rate-limit quota error, got true (R36-2 defect)")
	}
	if stats.RemainingCoolingSec != 0 {
		t.Fatalf("expected RemainingCoolingSec=0, got %d", stats.RemainingCoolingSec)
	}
}

func TestAppInfo_IsTestEnvironment(t *testing.T) {
	app := &App{ctx: context.Background()}

	// Case 1: EQT_ENV=test
	t.Setenv("EQT_ENV", "test")
	if !app.isTestEnvironment() {
		t.Errorf("expected isTestEnvironment()=true when EQT_ENV=test")
	}

	// Case 2: EQT_TESTING=1
	t.Setenv("EQT_ENV", "")
	t.Setenv("EQT_TESTING", "1")
	if !app.isTestEnvironment() {
		t.Errorf("expected isTestEnvironment()=true when EQT_TESTING=1")
	}
}

func TestLocateFileCommand(t *testing.T) {
	tempFile := filepath.Join(t.TempDir(), "test.zip")
	if err := os.WriteFile(tempFile, []byte("dummy zip content"), 0644); err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}

	cmd, err := locateFileCommand(tempFile)
	if err != nil {
		t.Fatalf("locateFileCommand failed: %v", err)
	}
	if cmd == nil {
		t.Fatalf("expected non-nil cmd")
	}

	app := NewApp()
	if err := app.LocateFile(""); err == nil {
		t.Fatalf("expected error for empty path, got nil")
	}
}

func TestValidateChatDownloadURL(t *testing.T) {
	ctx := context.Background()
	agent := newDesktopAgent(ctx)
	agent.chat = &TaskRecord{
		PageURL: "http://127.0.0.1:18081/chat-v2/token123",
	}
	app := &App{
		ctx:   ctx,
		agent: agent,
	}

	// 1. Valid local chat zip download URL
	validZipURL := "http://127.0.0.1:18081/chat-v2/token123/files/zip?ids=msg1,msg2&clientId=c1&filename=test.zip"
	parsed, err := app.validateChatDownloadURL(validZipURL)
	if err != nil {
		t.Fatalf("expected valid zip URL to pass, got err: %v", err)
	}
	if parsed == nil || parsed.Query().Get("download") != "1" {
		t.Fatalf("expected parsed URL with download=1 query, got %v", parsed)
	}

	// 2. Valid localhost alias on same port
	validLocalhostURL := "http://localhost:18081/chat-v2/token123/files/file1"
	if _, err := app.validateChatDownloadURL(validLocalhostURL); err != nil {
		t.Fatalf("expected localhost alias to pass, got err: %v", err)
	}

	// 3. Untrusted external host must be rejected
	maliciousURLs := []string{
		"https://attacker.com/chat-v2/token123/files/zip?ids=1",
		"http://attacker.com:18081/chat-v2/token123/files/zip",
		"https://evil.com/malware.zip",
		"http://127.0.0.1:9999/chat-v2/token123/files/zip", // wrong port
		"http://127.0.0.1:18081/not-chat-path/malware.zip", // invalid path
		"ftp://127.0.0.1:18081/chat-v2/token123/files/zip", // unsupported scheme
		"", // empty
	}

	for _, malURL := range maliciousURLs {
		if _, err := app.validateChatDownloadURL(malURL); err == nil {
			t.Errorf("expected URL %q to be rejected, but it passed", malURL)
		}
	}
}

func TestDiagnoseDeviceTLS_NoCert(t *testing.T) {
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)
	t.Setenv("EQT_CONFIG_DIR", filepath.Join(tempHome, "eqt_conf"))
	t.Setenv("EQT_TESTING", "true")

	app := NewApp()
	logPath := filepath.Join(tempHome, "desktop.log")
	app.logger = NewFileLogger(logPath, true)
	defer app.logger.Close()

	res, err := app.DiagnoseDeviceTLS()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.OK {
		t.Fatalf("expected res.OK=false when no cert exists, got true")
	}
	if res.CertValid {
		t.Fatalf("expected res.CertValid=false when no cert exists, got true")
	}
	if res.Status != "error" {
		t.Fatalf("expected status=error, got: %s", res.Status)
	}
	if !strings.Contains(res.Message, "未检测到本地设备证书") {
		t.Fatalf("expected message about missing cert, got: %s", res.Message)
	}

	// Verify log file captured diagnosis tags
	app.logger.Close()
	logBytes, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("failed to read log file: %v", err)
	}
	if !strings.Contains(string(logBytes), "[LAN-TLS-DIAG]") {
		t.Fatalf("expected log to contain [LAN-TLS-DIAG], got:\n%s", string(logBytes))
	}
}

func TestDiagnoseDeviceTLS_WithValidCert(t *testing.T) {
	t.Setenv("EQT_TESTING", "true")
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)
	t.Setenv("EQT_CONFIG_DIR", filepath.Join(tempHome, "eqt_conf"))

	app := NewApp()
	logPath := filepath.Join(tempHome, "desktop.log")
	app.logger = NewFileLogger(logPath, true)
	defer app.logger.Close()

	nodeID := server.GetDeviceNodeID()
	if nodeID == "" {
		nodeID = "9be192a9efff"
	}

	// 1. Generate a self-signed CA
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate CA key: %v", err)
	}
	caTemplate := x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Test LAN-TLS Root CA"},
		NotBefore:             time.Now().Add(-1 * time.Hour),
		NotAfter:              time.Now().Add(365 * 24 * time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, &caTemplate, &caTemplate, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatalf("failed to create CA cert: %v", err)
	}
	caCert, _ := x509.ParseCertificate(caDER)

	// 2. Ensure cert directory exists and key is generated for nodeID
	leafKey, err := cert.LoadOrGenerateDeviceKey(nodeID)
	if err != nil {
		t.Fatalf("failed to create leaf key: %v", err)
	}

	nodeDomain := cert.GetNodeDomain(nodeID)
	leafTemplate := x509.Certificate{
		SerialNumber: big.NewInt(1001),
		Subject: pkix.Name{
			CommonName: nodeDomain,
		},
		NotBefore: time.Now().Add(-1 * time.Hour),
		NotAfter:  time.Now().Add(90 * 24 * time.Hour),
		DNSNames: []string{
			nodeDomain,
			"*." + nodeDomain,
		},
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, &leafTemplate, caCert, &leafKey.PublicKey, caKey)
	if err != nil {
		t.Fatalf("failed to create leaf cert: %v", err)
	}

	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leafDER})
	certPEM = append(certPEM, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})...)

	testPool := x509.NewCertPool()
	testPool.AddCert(caCert)
	cert.SetCustomRootPoolForTesting(testPool)
	defer cert.SetCustomRootPoolForTesting(nil)

	if err := cert.SaveDeviceCertificate(nodeID, certPEM); err != nil {
		t.Fatalf("failed to save device cert: %v", err)
	}

	res, err := app.DiagnoseDeviceTLS()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !res.CertValid {
		t.Fatalf("expected res.CertValid=true, got false: %s", res.Message)
	}
	if !res.Handshake {
		t.Fatalf("expected res.Handshake=true, got false: %s", res.Message)
	}
	if res.DaysLeft <= 0 {
		t.Fatalf("expected positive DaysLeft, got %d", res.DaysLeft)
	}
	if !res.OK {
		t.Fatalf("expected res.OK=true, got false: %s", res.Message)
	}

	// Verify log file captured diagnosis tags
	app.logger.Close()
	logBytes, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("failed to read log file: %v", err)
	}
	logStr := string(logBytes)
	if !strings.Contains(logStr, "[LAN-TLS-DIAG]") {
		t.Fatalf("expected log to contain [LAN-TLS-DIAG]")
	}
	if !strings.Contains(logStr, "本地 TLS 握手测试通过") {
		t.Fatalf("expected log to contain handshake success, got:\n%s", logStr)
	}
}
