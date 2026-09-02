package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientLogHandler(t *testing.T) {
	srv := &Server{}

	t.Run("SingleEntry", func(t *testing.T) {
		entry := ClientLogEntry{
			ClientID:  "test-client-123456",
			SessionID: "sess-abc",
			Timestamp: 1725324567890,
			Level:     "INFO",
			Category:  "PAGE_LOAD",
			Message:   "iPhone Safari page loaded",
			Details: map[string]any{
				"isSecureContext": false,
				"hasShare":        false,
			},
			UserAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)",
		}
		body, _ := json.Marshal(entry)
		req := httptest.NewRequest(http.MethodPost, "/client-log", bytes.NewReader(body))
		w := httptest.NewRecorder()

		srv.handleClientLog(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}
	})

	t.Run("BatchEntries", func(t *testing.T) {
		entries := []ClientLogEntry{
			{
				ClientID: "test-client-123456",
				Level:    "INFO",
				Category: "ACTION",
				Message:  "User clicked download button",
			},
			{
				ClientID: "test-client-123456",
				Level:    "WARN",
				Category: "SAVE",
				Message:  "navigator.share rejected",
				Details: map[string]any{
					"errorName": "NotAllowedError",
				},
			},
		}
		body, _ := json.Marshal(entries)
		req := httptest.NewRequest(http.MethodPost, "/client-log", bytes.NewReader(body))
		w := httptest.NewRecorder()

		srv.handleClientLog(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}
	})

	t.Run("PreflightOptions", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodOptions, "/client-log", nil)
		w := httptest.NewRecorder()

		srv.handleClientLog(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}
	})
}
