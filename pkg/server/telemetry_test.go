package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMaskTokenInPath(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"/send/1234567890abcdef", "/send/123456...abcdef"},
		{"/receive/abcdef1234567890xyz", "/receive/abcdef...890xyz"},
		{"/chat/session1234567890end", "/chat/sessio...890end"},
		{"/send/1234567890abcdef/download", "/send/123456...abcdef/download"},
		{"/send/short", "/send/short"}, // 12字符以内不打断
		{"/status", "/status"},
		{"/assets/logo.png", "/assets/logo.png"},
	}

	for _, tc := range tests {
		got := MaskTokenInPath(tc.input)
		if got != tc.expected {
			t.Errorf("MaskTokenInPath(%q) = %q, expected %q", tc.input, got, tc.expected)
		}
	}
}

func TestHandleClientLog_SanitizationAndAntiInjection(t *testing.T) {
	s := &Server{
		telemetryLimiter: NewTelemetryRateLimiter(10, 10),
	}

	// 构造含恶意 \r\n 注入攻击、非法 Level、非法 Category 及超长字符的 Payload
	evilPayload := ClientLogEntry{
		ClientID:  "evil_client_1234567890",
		Timestamp: 123456789,
		Level:     "UNOFFICIAL_SUPER_ROOT",
		Category:  "MALICIOUS_INJECTION",
		Message:   "Normal Msg\r\n[2026-09-04 00:00:00] [CRITICAL] Fake Admin Log Injected!\nLine2\t" + strings.Repeat("A", 300),
		Details: map[string]any{
			"evil_key\r\n": "evil_val\r\nwith_newlines",
			"normal_key":   "ok",
		},
	}

	bodyBytes, err := json.Marshal(evilPayload)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/client-log", bytes.NewReader(bodyBytes))
	req.RemoteAddr = "192.168.1.50:54321"
	w := httptest.NewRecorder()

	s.HandleClientLog(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("expected status 204 No Content, got %d", resp.StatusCode)
	}

	// 验证内部 sanitize 逻辑
	cleanLvl := sanitizeLevel(evilPayload.Level)
	if cleanLvl != "INFO" {
		t.Errorf("expected level fallback to INFO, got %s", cleanLvl)
	}

	cleanCat := sanitizeCategory(evilPayload.Category)
	if cleanCat != "CLIENT_EVENT" {
		t.Errorf("expected category fallback to CLIENT_EVENT, got %s", cleanCat)
	}

	cleanMsg := sanitizeString(evilPayload.Message, 256)
	if strings.Contains(cleanMsg, "\r") || strings.Contains(cleanMsg, "\n") {
		t.Errorf("sanitized message still contains CRLF characters: %q", cleanMsg)
	}
	if len(cleanMsg) > 256 {
		t.Errorf("sanitized message exceeds 256 bytes: %d", len(cleanMsg))
	}
}

func TestHandleClientLog_RateLimiting(t *testing.T) {
	s := &Server{
		telemetryLimiter: NewTelemetryRateLimiter(5, 0.1), // 容量 5，恢复极慢
	}

	payload := ClientLogEntry{
		ClientID: "test-client",
		Level:    "INFO",
		Category: "PAGE_LOAD",
		Message:  "Page loaded successfully",
	}
	bodyBytes, _ := json.Marshal(payload)

	// 连续发送 8 次
	successCount := 0
	rateLimitedCount := 0
	for i := 0; i < 8; i++ {
		req := httptest.NewRequest(http.MethodPost, "/client-log", bytes.NewReader(bodyBytes))
		req.RemoteAddr = "10.0.0.1:12345"
		w := httptest.NewRecorder()

		s.HandleClientLog(w, req)
		resp := w.Result()
		if resp.StatusCode == http.StatusNoContent {
			successCount++
		} else if resp.StatusCode == http.StatusTooManyRequests {
			rateLimitedCount++
		}
	}

	if successCount != 5 {
		t.Errorf("expected 5 successful requests, got %d", successCount)
	}
	if rateLimitedCount != 3 {
		t.Errorf("expected 3 rate-limited requests, got %d", rateLimitedCount)
	}
	if s.droppedClientLogCount != 3 {
		t.Errorf("expected droppedClientLogCount to be 3, got %d", s.droppedClientLogCount)
	}
}

func TestHandleClientLog_PayloadSizeLimit(t *testing.T) {
	s := &Server{
		telemetryLimiter: NewTelemetryRateLimiter(10, 10),
	}

	// 构造超出 32KB 的超大请求体
	hugePayload := strings.Repeat("X", 35*1024)
	req := httptest.NewRequest(http.MethodPost, "/client-log", strings.NewReader(hugePayload))
	req.RemoteAddr = "10.0.0.2:12345"
	w := httptest.NewRecorder()

	s.HandleClientLog(w, req)
	resp := w.Result()
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("expected 413 Request Entity Too Large, got %d", resp.StatusCode)
	}
}

func TestWrapAccessLog(t *testing.T) {
	s := &Server{}
	handlerCalled := false
	dummyHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handlerCalled = true
		w.WriteHeader(http.StatusOK)
	})

	wrapped := s.wrapAccessLog(dummyHandler)

	req := httptest.NewRequest(http.MethodGet, "/send/1234567890abcdef", nil)
	req.RemoteAddr = "192.168.1.100:1234"
	w := httptest.NewRecorder()

	wrapped.ServeHTTP(w, req)

	if !handlerCalled {
		t.Errorf("expected next handler to be called")
	}
	if w.Result().StatusCode != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Result().StatusCode)
	}
}
