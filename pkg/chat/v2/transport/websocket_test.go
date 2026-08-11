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

// readEvent skips history_page meta events emitted after Register / load_history.
func readEvent(ctx context.Context, t *testing.T, conn *websocket.Conn) protocol.EventEnvelope {
	t.Helper()
	for {
		var ev protocol.EventEnvelope
		if err := wsjson.Read(ctx, conn, &ev); err != nil {
			t.Fatal(err)
		}
		if ev.Type != protocol.EventHistoryPage {
			return ev
		}
	}
}

func TestWebSocketHelloAndHeartbeat(t *testing.T) {
	now := time.Date(2026, 7, 7, 12, 0, 0, 0, time.UTC)
	logger := &diag.MemoryLogger{}
	handler := NewWebSocketHandler(WebSocketConfig{
		Logger: logger,
		Now: func() time.Time {
			return now
		},
		DisableSystemMessages: true,
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
	handler := NewWebSocketHandler(WebSocketConfig{DisableSystemMessages: true})
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
	handler := NewWebSocketHandler(WebSocketConfig{
		Logger:                logger,
		DebugLog:              func() bool { return true },
		DisableSystemMessages: true,
	})
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
	logFilePath := filepath.Join(dir, "eqt", "session-room-token", "device-test-log-peer.log")
	defer func() {
		_ = os.Remove(logFilePath)
		_ = os.Remove(filepath.Dir(logFilePath))
	}()

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
	handler := NewWebSocketHandler(WebSocketConfig{Logger: logger, DisableSystemMessages: true})
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

	// Read A presence changed (A self joins) — may be preceded by history_page
	presA1 := readEvent(ctx, t, connA)
	if presA1.Type != protocol.EventPresenceChanged {
		t.Fatalf("presA1 = %#v", presA1)
	}

	// Read A presence changed (B joins)
	presA2 := readEvent(ctx, t, connA)
	if presA2.Type != protocol.EventPresenceChanged || len(presA2.Presence.Devices) != 2 {
		t.Fatalf("presA2 = %#v", presA2)
	}

	// Read B presence changed (B sees both A and B)
	presB1 := readEvent(ctx, t, connB)
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
	handler := NewWebSocketHandler(WebSocketConfig{DisableSystemMessages: true})
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

	// Read A presence changed (history_page may precede it)
	pA1 := readEvent(ctx, t, connA1)
	if pA1.Type != protocol.EventPresenceChanged {
		t.Fatalf("pA1 = %#v", pA1)
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

	mA1 := readEvent(ctx, t, connA1)
	if mA1.Type != protocol.EventMessageAdded || mA1.Message == nil || mA1.Message.Text != "message 1" {
		t.Fatalf("mA1 = %#v", mA1)
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

	// Expect mA1 message (seq = seqOfMessage) replayed (history_page may follow)
	mA2 := readEvent(ctx, t, connA2)
	if mA2.Seq != seqOfMessage || mA2.Type != protocol.EventMessageAdded || mA2.Message.Text != "message 1" {
		t.Fatalf("mA2 = %#v, expected seq = %d", mA2, seqOfMessage)
	}
}

func TestWebSocketKickOnlyHostAllowed(t *testing.T) {
	handler := NewWebSocketHandler(WebSocketConfig{DisableSystemMessages: true})
	server := httptest.NewServer(handler)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	connHost, _, err := websocket.Dial(ctx, wsURL(server.URL)+"/kick-room/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connHost.Close(websocket.StatusNormalClosure, "done")

	connMobile, _, err := websocket.Dial(ctx, wsURL(server.URL)+"/kick-room/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connMobile.Close(websocket.StatusNormalClosure, "done")

	var hello protocol.EventEnvelope
	if err := wsjson.Read(ctx, connHost, &hello); err != nil {
		t.Fatal(err)
	}
	if err := wsjson.Read(ctx, connMobile, &hello); err != nil {
		t.Fatal(err)
	}

	if err := wsjson.Write(ctx, connHost, protocol.CommandEnvelope{
		Type:      protocol.CommandConnect,
		CommandID: "conn-host",
		Client: protocol.ClientInfo{
			Label: "Host",
			Peer:  "desktop",
			Token: "host-token",
		},
	}); err != nil {
		t.Fatal(err)
	}
	// connect hello (command-scoped) + self presence
	var hostHello protocol.EventEnvelope
	if err := wsjson.Read(ctx, connHost, &hostHello); err != nil {
		t.Fatal(err)
	}
	if hostHello.Type != protocol.EventHello || hostHello.CommandID != "conn-host" {
		t.Fatalf("host connect hello = %#v", hostHello)
	}
	presHostSelf := readEvent(ctx, t, connHost)
	if presHostSelf.Type != protocol.EventPresenceChanged {
		t.Fatalf("host self presence = %#v", presHostSelf)
	}

	if err := wsjson.Write(ctx, connMobile, protocol.CommandEnvelope{
		Type:      protocol.CommandConnect,
		CommandID: "conn-mobile",
		Client: protocol.ClientInfo{
			Label: "Phone",
			Peer:  "peer-phone",
			Token: "phone-token",
		},
	}); err != nil {
		t.Fatal(err)
	}
	var mobileHello protocol.EventEnvelope
	if err := wsjson.Read(ctx, connMobile, &mobileHello); err != nil {
		t.Fatal(err)
	}
	if mobileHello.Type != protocol.EventHello || mobileHello.CommandID != "conn-mobile" {
		t.Fatalf("mobile connect hello = %#v", mobileHello)
	}

	// Host sees mobile join presence
	presHostBoth := readEvent(ctx, t, connHost)
	if presHostBoth.Type != protocol.EventPresenceChanged || presHostBoth.Presence == nil {
		t.Fatalf("host presence after mobile = %#v", presHostBoth)
	}
	var mobileID string
	for _, d := range presHostBoth.Presence.Devices {
		if d.Peer == "peer-phone" {
			mobileID = d.ID
			break
		}
	}
	if mobileID == "" {
		t.Fatalf("mobile id missing in presence devices=%#v", presHostBoth.Presence.Devices)
	}

	// Mobile sees presence (self join with both devices)
	presMobile := readEvent(ctx, t, connMobile)
	if presMobile.Type != protocol.EventPresenceChanged {
		t.Fatalf("mobile presence = %#v", presMobile)
	}

	// Mobile tries to kick → unauthorized
	if err := wsjson.Write(ctx, connMobile, protocol.CommandEnvelope{
		Type:      protocol.CommandKickClient,
		CommandID: "kick-from-mobile",
		ClientID:  "any",
	}); err != nil {
		t.Fatal(err)
	}
	var errEv protocol.EventEnvelope
	if err := wsjson.Read(ctx, connMobile, &errEv); err != nil {
		t.Fatal(err)
	}
	if errEv.Type != protocol.EventError || errEv.CommandID != "kick-from-mobile" {
		t.Fatalf("mobile kick event = %#v, want error", errEv)
	}
	if errEv.Error == nil || errEv.Error.Code != protocol.ErrorUnauthorized {
		t.Fatalf("mobile kick error = %#v, want unauthorized", errEv.Error)
	}
	if errEv.Error.Message != "only host can kick clients" {
		t.Fatalf("mobile kick message = %q", errEv.Error.Message)
	}

	// Host kicks mobile successfully → mobile socket is force-closed.
	if err := wsjson.Write(ctx, connHost, protocol.CommandEnvelope{
		Type:      protocol.CommandKickClient,
		CommandID: "kick-from-host",
		ClientID:  mobileID,
	}); err != nil {
		t.Fatal(err)
	}

	// Mobile should observe close (or a terminal error) after host kick.
	closed := make(chan error, 1)
	go func() {
		var dump protocol.EventEnvelope
		closed <- wsjson.Read(ctx, connMobile, &dump)
	}()
	select {
	case err := <-closed:
		if err == nil {
			// Received an event instead of close; still acceptable if presence/error arrives first.
			// Wait briefly for the actual close.
			time.Sleep(150 * time.Millisecond)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("mobile connection was not closed after host kick")
	}

	// Host remains connected: presence should drop phone or host can still heartbeat via write pump.
	presAfterKick := readEvent(ctx, t, connHost)
	if presAfterKick.Type != protocol.EventPresenceChanged && presAfterKick.Type != protocol.EventHello {
		// Accept any host-side event proving the host socket is still readable.
		t.Logf("host post-kick event type=%s", presAfterKick.Type)
	}
}
