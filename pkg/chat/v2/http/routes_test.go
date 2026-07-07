package chathttp

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"eqt/pkg/chat/v2/diag"
	"eqt/pkg/chat/v2/protocol"
)

func TestHandlerHealth(t *testing.T) {
	logger := &diag.MemoryLogger{}
	handler := NewHandler(Config{BasePath: "/chat-v2", Logger: logger})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/chat-v2/test-token/health", nil)

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %q", rec.Code, http.StatusOK, rec.Body.String())
	}

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["version"] != Version || body["token"] != "test-token" || body["status"] != "skeleton" {
		t.Fatalf("health body = %#v", body)
	}

	events := logger.Events()
	if len(events) != 2 {
		t.Fatalf("log events = %d, want 2", len(events))
	}
	if events[1].Message != "health response sent" {
		t.Fatalf("last log event = %#v", events[1])
	}
}

func TestHandlerRootIsExplicitlyNotImplemented(t *testing.T) {
	handler := NewHandler(Config{BasePath: "/chat-v2"})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/chat-v2/test-token", nil)

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotImplemented)
	}
}

func TestHandlerDoesNotCatchLegacyChatRoute(t *testing.T) {
	handler := NewHandler(Config{BasePath: "/chat-v2"})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/chat/test-token/health", nil)

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

func TestHandlerMethodErrorUsesJSONPayload(t *testing.T) {
	logger := &diag.MemoryLogger{}
	handler := NewHandler(Config{BasePath: "/chat-v2", Logger: logger})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/chat-v2/test-token/health", nil)

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}

	var body struct {
		Error protocol.ErrorPayload `json:"error"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Error.Code != protocol.ErrorBadCommand || body.Error.Message != "method not allowed" {
		t.Fatalf("body = %#v", body)
	}

	events := logger.Events()
	if len(events) != 2 {
		t.Fatalf("log events = %d, want 2", len(events))
	}
	if events[1].Level != diag.LevelWarn || events[1].Message != "request failed" {
		t.Fatalf("last log event = %#v", events[1])
	}
}
