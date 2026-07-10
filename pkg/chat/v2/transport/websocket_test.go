package transport

import (
	"context"
	"net/http/httptest"
	"os"
	"path/filepath"
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

func TestWebSocketCommandLog(t *testing.T) {
	logger := &diag.MemoryLogger{}
	handler := NewWebSocketHandler(WebSocketConfig{Logger: logger})
	server := httptest.NewServer(handler)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, wsURL(server.URL)+"/room-token/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "done")

	var hello protocol.EventEnvelope
	if err := wsjson.Read(ctx, conn, &hello); err != nil {
		t.Fatal(err)
	}

	// 1. Perform connect handshake to establish client peer identity
	err = wsjson.Write(ctx, conn, protocol.CommandEnvelope{
		Type:      protocol.CommandConnect,
		CommandID: "conn-log-test",
		Client: protocol.ClientInfo{
			Label: "LogTester",
			Peer:  "test-log-peer",
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	var helloConn protocol.EventEnvelope
	if err := wsjson.Read(ctx, conn, &helloConn); err != nil {
		t.Fatal(err)
	}

	// 2. Send log command
	logText := "Hello from client test-log-peer to server logger"
	err = wsjson.Write(ctx, conn, protocol.CommandEnvelope{
		Type:      protocol.CommandLog,
		CommandID: "log-1",
		Text:      logText,
	})
	if err != nil {
		t.Fatal(err)
	}

	// Give a small amount of time for the async log writing thread to process if necessary
	time.Sleep(50 * time.Millisecond)

	// 3. Verify the file exists and has correct content
	dir, err := os.UserCacheDir()
	if err != nil {
		dir = os.TempDir()
	}
	logFilePath := filepath.Join(dir, "eqt", "device-test-log-peer.log")
	defer os.Remove(logFilePath) // clean up

	content, err := os.ReadFile(logFilePath)
	if err != nil {
		t.Fatalf("Failed to read log file: %v", err)
	}

	if !strings.Contains(string(content), logText) {
		t.Fatalf("Expected log file to contain %q, but got %q", logText, string(content))
	}
}

func TestWebSocketTwoClientsExchangeText(t *testing.T) {
	logger := &diag.MemoryLogger{}
	handler := NewWebSocketHandler(WebSocketConfig{Logger: logger})
	server := httptest.NewServer(handler)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// A client connects
	connA, _, err := websocket.Dial(ctx, wsURL(server.URL)+"/room-token/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connA.Close(websocket.StatusNormalClosure, "done")

	// B client connects
	connB, _, err := websocket.Dial(ctx, wsURL(server.URL)+"/room-token/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connB.Close(websocket.StatusNormalClosure, "done")

	// Read initial hello for both
	var helloA protocol.EventEnvelope
	if err := wsjson.Read(ctx, connA, &helloA); err != nil {
		t.Fatal(err)
	}
	var helloB protocol.EventEnvelope
	if err := wsjson.Read(ctx, connB, &helloB); err != nil {
		t.Fatal(err)
	}

	// Send connect for A
	err = wsjson.Write(ctx, connA, protocol.CommandEnvelope{
		Type:      protocol.CommandConnect,
		CommandID: "conn-a",
		Client: protocol.ClientInfo{
			Label: "Alice",
			Peer:  "peer-alice",
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	// Read connect hello for A
	var helloConnA protocol.EventEnvelope
	if err := wsjson.Read(ctx, connA, &helloConnA); err != nil {
		t.Fatal(err)
	}
	if helloConnA.Type != protocol.EventHello || helloConnA.CommandID != "conn-a" {
		t.Fatalf("A helloConn = %#v", helloConnA)
	}

	// Send connect for B
	err = wsjson.Write(ctx, connB, protocol.CommandEnvelope{
		Type:      protocol.CommandConnect,
		CommandID: "conn-b",
		Client: protocol.ClientInfo{
			Label: "Bob",
			Peer:  "peer-bob",
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	// Read connect hello for B
	var helloConnB protocol.EventEnvelope
	if err := wsjson.Read(ctx, connB, &helloConnB); err != nil {
		t.Fatal(err)
	}
	if helloConnB.Type != protocol.EventHello || helloConnB.CommandID != "conn-b" {
		t.Fatalf("B helloConn = %#v", helloConnB)
	}

	// Read A presence changed (A self joins)
	var presA1 protocol.EventEnvelope
	if err := wsjson.Read(ctx, connA, &presA1); err != nil {
		t.Fatal(err)
	}
	if presA1.Type != protocol.EventPresenceChanged {
		t.Fatalf("presA1 = %#v", presA1)
	}

	// Read A presence changed (B joins)
	var presA2 protocol.EventEnvelope
	if err := wsjson.Read(ctx, connA, &presA2); err != nil {
		t.Fatal(err)
	}
	if presA2.Type != protocol.EventPresenceChanged || len(presA2.Presence.Devices) != 2 {
		t.Fatalf("presA2 = %#v", presA2)
	}

	// Read B presence changed (B sees both A and B)
	var presB1 protocol.EventEnvelope
	if err := wsjson.Read(ctx, connB, &presB1); err != nil {
		t.Fatal(err)
	}
	if presB1.Type != protocol.EventPresenceChanged || len(presB1.Presence.Devices) != 2 {
		t.Fatalf("presB1 = %#v", presB1)
	}

	// A sends text message
	err = wsjson.Write(ctx, connA, protocol.CommandEnvelope{
		Type:      protocol.CommandSendText,
		CommandID: "send-text-1",
		Text:      "Hello from Alice",
	})
	if err != nil {
		t.Fatal(err)
	}

	// A reads its own message event
	var msgA protocol.EventEnvelope
	if err := wsjson.Read(ctx, connA, &msgA); err != nil {
		t.Fatal(err)
	}
	if msgA.Type != protocol.EventMessageAdded || msgA.Message.Text != "Hello from Alice" {
		t.Fatalf("A msgA = %#v", msgA)
	}

	// B reads Alice's message event
	var msgB protocol.EventEnvelope
	if err := wsjson.Read(ctx, connB, &msgB); err != nil {
		t.Fatal(err)
	}
	if msgB.Type != protocol.EventMessageAdded || msgB.Message.Text != "Hello from Alice" {
		t.Fatalf("B msgB = %#v", msgB)
	}
}

func TestWebSocketReconnectRecovery(t *testing.T) {
	handler := NewWebSocketHandler(WebSocketConfig{})
	server := httptest.NewServer(handler)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// A client connects
	connA1, _, err := websocket.Dial(ctx, wsURL(server.URL)+"/recovery-token/ws", nil)
	if err != nil {
		t.Fatal(err)
	}

	var hA1 protocol.EventEnvelope
	if err := wsjson.Read(ctx, connA1, &hA1); err != nil {
		t.Fatal(err)
	}

	// Send connect for A
	err = wsjson.Write(ctx, connA1, protocol.CommandEnvelope{
		Type:      protocol.CommandConnect,
		CommandID: "conn-a1",
		Client: protocol.ClientInfo{
			Label: "Alice",
			Peer:  "peer-a",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := wsjson.Read(ctx, connA1, &hA1); err != nil {
		t.Fatal(err)
	}

	// Read A presence changed
	var pA1 protocol.EventEnvelope
	if err := wsjson.Read(ctx, connA1, &pA1); err != nil {
		t.Fatal(err)
	}
	seqOfPresence := pA1.Seq

	// A sends text message
	err = wsjson.Write(ctx, connA1, protocol.CommandEnvelope{
		Type:      protocol.CommandSendText,
		CommandID: "txt-1",
		Text:      "message 1",
	})
	if err != nil {
		t.Fatal(err)
	}

	var mA1 protocol.EventEnvelope
	if err := wsjson.Read(ctx, connA1, &mA1); err != nil {
		t.Fatal(err)
	}
	seqOfMessage := mA1.Seq

	// Disconnect A1
	connA1.Close(websocket.StatusNormalClosure, "disconnect")

	// Connect A2 with afterSeq
	connA2, _, err := websocket.Dial(ctx, wsURL(server.URL)+"/recovery-token/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connA2.Close(websocket.StatusNormalClosure, "done")

	var hA2 protocol.EventEnvelope
	if err := wsjson.Read(ctx, connA2, &hA2); err != nil {
		t.Fatal(err)
	}

	err = wsjson.Write(ctx, connA2, protocol.CommandEnvelope{
		Type:      protocol.CommandConnect,
		CommandID: "conn-a2",
		Client: protocol.ClientInfo{
			Label: "Alice",
			Peer:  "peer-a",
		},
		AfterSeq: seqOfPresence,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := wsjson.Read(ctx, connA2, &hA2); err != nil {
		t.Fatal(err)
	}

	// Expect mA1 message (seq = seqOfMessage) replayed
	var mA2 protocol.EventEnvelope
	if err := wsjson.Read(ctx, connA2, &mA2); err != nil {
		t.Fatal(err)
	}
	if mA2.Seq != seqOfMessage || mA2.Type != protocol.EventMessageAdded || mA2.Message.Text != "message 1" {
		t.Fatalf("mA2 = %#v, expected seq = %d", mA2, seqOfMessage)
	}
}
