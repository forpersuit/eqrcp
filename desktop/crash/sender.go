package crash

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// defaultCrashServer 声明见 env_defaults.go(生产默认值)与 env_defaults_dev.go
// (//go:build eqtdev 构建时覆盖为测试 Worker)。运行时仍可用 EQT_CRASH_SERVER 覆盖。

// getCrashServer returns the crash report server URL, overridable via EQT_CRASH_SERVER env var.
func getCrashServer() string {
	if s := os.Getenv("EQT_CRASH_SERVER"); s != "" {
		return strings.TrimRight(s, "/")
	}
	return defaultCrashServer
}

// Submit sends a crash report to the server and returns the report ID.
func Submit(report Report) (string, error) {
	body, err := json.Marshal(report)
	if err != nil {
		return "", fmt.Errorf("failed to marshal crash report: %w", err)
	}

	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest("POST", getCrashServer(), bytes.NewBuffer(body))
	if err != nil {
		return "", fmt.Errorf("failed to create crash report request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	SetTraceIDHeader(req)
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to submit crash report: %w", err)
	}
	defer resp.Body.Close()

	respData, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read crash report response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("crash report server returned status %d: %s", resp.StatusCode, string(respData))
	}

	var result struct {
		Status   string `json:"status"`
		ReportID string `json:"report_id"`
	}
	if err := json.Unmarshal(respData, &result); err != nil {
		return "", fmt.Errorf("failed to parse crash report response: %w", err)
	}

	if result.Status != "received" {
		return "", fmt.Errorf("crash report server returned unexpected status: %s", result.Status)
	}

	return result.ReportID, nil
}

// SubmitAndClean submits a crash report and removes the dump file on success.
// Returns the report ID and any error.
func SubmitAndClean(report Report) (string, error) {
	reportID, err := Submit(report)
	if err != nil {
		return "", err
	}

	// Mark as uploaded (don't fail if this errors)
	_ = MarkUploaded()

	return reportID, nil
}

// ReadLogTail reads the last N lines from a log file.
// Returns empty string if the file doesn't exist or can't be read.
func ReadLogTail(logPath string, n int) string {
	if logPath == "" {
		return ""
	}

	data, err := os.ReadFile(logPath)
	if err != nil {
		return ""
	}

	lines := strings.Split(string(data), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}

	return strings.Join(lines, "\n")
}
