package transport

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"eqt/pkg/chat/v2/diag"
	"eqt/pkg/chat/v2/protocol"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func TestWebSocketHelloAndHeartbeat(t *testing.T) {
	now := time.Date(2026, 7, 7, 12, 0, 0, 0, time.UTC)
	logger := &diag.MemoryLogger{}
	handler := NewWebSocketHandler(WebSocketConfig{
		Logger: logger,
		Now: func() time.Time {
			return now
		},
	})
	server := httptest.NewServer(handler)
	defer server.Close()

	ctx := context.Background()
	conn, _, err := websocket.Dial(ctx, wsURL(server.URL), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "done")

	var hello protocol.EventEnvelope
	if err := wsjson.Read(ctx, conn, &hello); err != nil {
		t.Fatal(err)
	}
	if hello.Type != protocol.EventHello || !hello.Time.Equal(now) {
		t.Fatalf("hello = %#v", hello)
	}

	if err := wsjson.Write(ctx, conn, protocol.CommandEnvelope{
		Type:      protocol.CommandHeartbeat,
		CommandID: "hb-1",
	}); err != nil {
		t.Fatal(err)
	}

	var heartbeat protocol.EventEnvelope
	if err := wsjson.Read(ctx, conn, &heartbeat); err != nil {
		t.Fatal(err)
	}
	if heartbeat.Type != protocol.EventHeartbeat || heartbeat.CommandID != "hb-1" {
		t.Fatalf("heartbeat = %#v", heartbeat)
	}

	events := logger.Events()
	if len(events) < 3 {
		t.Fatalf("log events = %d, want at least 3", len(events))
	}
	if events[0].Message != "websocket connected" {
		t.Fatalf("first event = %#v", events[0])
	}
}

func TestWebSocketUnsupportedCommandReturnsProtocolError(t *testing.T) {
	handler := NewWebSocketHandler(WebSocketConfig{})
	server := httptest.NewServer(handler)
	defer server.Close()

	ctx := context.Background()
	conn, _, err := websocket.Dial(ctx, wsURL(server.URL), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "done")

	var hello protocol.EventEnvelope
	if err := wsjson.Read(ctx, conn, &hello); err != nil {
		t.Fatal(err)
	}

	if err := wsjson.Write(ctx, conn, protocol.CommandEnvelope{
		Type:      protocol.CommandType("not_real"),
		CommandID: "bad-1",
	}); err != nil {
		t.Fatal(err)
	}

	var got protocol.EventEnvelope
	if err := wsjson.Read(ctx, conn, &got); err != nil {
		t.Fatal(err)
	}
	if got.Type != protocol.EventError || got.CommandID != "bad-1" {
		t.Fatalf("event = %#v", got)
	}
	if got.Error == nil || got.Error.Code != protocol.ErrorBadCommand || got.Error.Message != "unsupported command" {
		t.Fatalf("error payload = %#v", got.Error)
	}
}

func wsURL(httpURL string) string {
	return "ws" + strings.TrimPrefix(httpURL, "http")
}
