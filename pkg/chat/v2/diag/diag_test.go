package diag

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"eqt/pkg/chat/v2/protocol"
)

func TestNormalizeErrorPreservesDiagnosticDetails(t *testing.T) {
	cause := errors.New("disk full")
	err := WrapError(protocol.ErrorInternal, http.StatusInsufficientStorage, "save failed", cause)

	got := NormalizeError(err)

	if got.Code != protocol.ErrorInternal || got.Status != http.StatusInsufficientStorage {
		t.Fatalf("normalized error = %#v", got)
	}
	if !errors.Is(got, cause) {
		t.Fatalf("normalized error does not unwrap cause")
	}
	if got.Payload().Message != "save failed" {
		t.Fatalf("payload = %#v", got.Payload())
	}
}

func TestNormalizeErrorHandlesNil(t *testing.T) {
	got := NormalizeError(nil)
	if got == nil {
		t.Fatal("NormalizeError(nil) returned nil")
	}
	if got.Code != protocol.ErrorInternal || got.Status != http.StatusInternalServerError {
		t.Fatalf("normalized nil error = %#v", got)
	}
}

func TestWriteErrorEmitsJSONAndLog(t *testing.T) {
	logger := &MemoryLogger{}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/chat-v2/test/health", nil)
	err := NewError(protocol.ErrorBadCommand, http.StatusBadRequest, "bad command")

	WriteError(rec, req, logger, err, F("route", "/chat-v2/test/health"))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	var body struct {
		Error protocol.ErrorPayload `json:"error"`
	}
	if decodeErr := json.NewDecoder(rec.Body).Decode(&body); decodeErr != nil {
		t.Fatal(decodeErr)
	}
	if body.Error.Code != protocol.ErrorBadCommand || body.Error.Message != "bad command" {
		t.Fatalf("body = %#v", body)
	}

	events := logger.Events()
	if len(events) != 1 {
		t.Fatalf("events = %d, want 1", len(events))
	}
	if events[0].Level != LevelWarn || events[0].Message != "request failed" {
		t.Fatalf("event = %#v", events[0])
	}
}

func TestMemoryLoggerCopiesFields(t *testing.T) {
	logger := &MemoryLogger{}
	fields := []Field{F("token", "abc")}

	Emit(context.Background(), logger, LevelInfo, "connected", nil, fields...)
	fields[0] = F("token", "mutated")

	events := logger.Events()
	if len(events) != 1 {
		t.Fatalf("events = %d, want 1", len(events))
	}
	if events[0].Fields[0].Value != "abc" {
		t.Fatalf("field mutated through caller slice: %#v", events[0].Fields[0])
	}
}
