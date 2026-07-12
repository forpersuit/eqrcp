package chathttp

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"eqt/pkg/chat/v2/diag"
	"eqt/pkg/chat/v2/protocol"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func TestHandlerHealth(t *testing.T) {
	logger := &diag.MemoryLogger{}
	handler := NewHandler(Config{BasePath: "/chat-v2", Logger: logger, DisableSystemMessages: true})
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

func TestHandlerRootServesHarness(t *testing.T) {
	handler := NewHandler(Config{BasePath: "/chat-v2", DisableSystemMessages: true})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/chat-v2/test-token", nil)

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "Chat v2 Test Harness") {
		t.Fatalf("body does not contain harness title: %q", body)
	}
}

func TestHandlerDoesNotCatchLegacyChatRoute(t *testing.T) {
	handler := NewHandler(Config{BasePath: "/chat-v2", DisableSystemMessages: true})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/chat/test-token/health", nil)

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

func TestHandlerMethodErrorUsesJSONPayload(t *testing.T) {
	logger := &diag.MemoryLogger{}
	handler := NewHandler(Config{BasePath: "/chat-v2", Logger: logger, DisableSystemMessages: true})
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

func TestHandlerWebSocketRoute(t *testing.T) {
	handler := NewHandler(Config{BasePath: "/chat-v2", DisableSystemMessages: true})
	server := httptest.NewServer(handler)
	defer server.Close()

	ctx := context.Background()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/chat-v2/test-token/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "done")

	var hello protocol.EventEnvelope
	if err := wsjson.Read(ctx, conn, &hello); err != nil {
		t.Fatal(err)
	}
	if hello.Type != protocol.EventHello {
		t.Fatalf("hello event = %#v", hello)
	}
}

func TestHandlerDownloadAndChatConcurrency(t *testing.T) {
	handler := NewHandler(Config{BasePath: "/chat-v2", DisableSystemMessages: true})
	server := httptest.NewServer(handler)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// 1. Connect Alice via WS
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/chat-v2/test-token/ws"
	connAlice, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connAlice.Close(websocket.StatusNormalClosure, "done")

	// Read initial hello
	var helloA protocol.EventEnvelope
	if err := wsjson.Read(ctx, connAlice, &helloA); err != nil {
		t.Fatal(err)
	}

	// Send connect Command
	err = wsjson.Write(ctx, connAlice, protocol.CommandEnvelope{
		Type:      protocol.CommandConnect,
		CommandID: "conn-alice",
		Client: protocol.ClientInfo{
			Label: "Alice",
			Peer:  "peer-alice",
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	// Read hello confirmation
	if err := wsjson.Read(ctx, connAlice, &helloA); err != nil {
		t.Fatal(err)
	}

	// 2. Connect Bob via WS
	connBob, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connBob.Close(websocket.StatusNormalClosure, "done")

	var helloB protocol.EventEnvelope
	if err := wsjson.Read(ctx, connBob, &helloB); err != nil {
		t.Fatal(err)
	}

	err = wsjson.Write(ctx, connBob, protocol.CommandEnvelope{
		Type:      protocol.CommandConnect,
		CommandID: "conn-bob",
		Client: protocol.ClientInfo{
			Label: "Bob",
			Peer:  "peer-bob",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := wsjson.Read(ctx, connBob, &helloB); err != nil {
		t.Fatal(err)
	}

	// Flush A's presence events to avoid test pollution
	// Alice will receive her own presence event and Bob's presence event
	for i := 0; i < 2; i++ {
		var pres protocol.EventEnvelope
		if err := wsjson.Read(ctx, connAlice, &pres); err != nil {
			t.Fatal(err)
		}
	}
	// Flush Bob's presence event
	var presB protocol.EventEnvelope
	if err := wsjson.Read(ctx, connBob, &presB); err != nil {
		t.Fatal(err)
	}

	// 3. Alice triggers HTTP file download in a separate goroutine
	downloadURL := server.URL + "/chat-v2/test-token/files/file-123?mock_size=102400&clientId=peer-alice&messageId=msg-1&filename=test.bin"
	errChan := make(chan error, 1)
	go func() {
		resp, err := http.Get(downloadURL)
		if err != nil {
			errChan <- err
			return
		}
		defer resp.Body.Close()

		// Consume body
		_, err = io.Copy(io.Discard, resp.Body)
		errChan <- err
	}()

	// 4. Bob sends a text message while download is running
	time.Sleep(10 * time.Millisecond)

	err = wsjson.Write(ctx, connBob, protocol.CommandEnvelope{
		Type:      protocol.CommandSendText,
		CommandID: "txt-from-bob",
		Text:      "Hi Alice",
	})
	if err != nil {
		t.Fatal(err)
	}

	// 5. Alice reads WebSocket events and checks concurrency
	var gotQueued, gotStarted, gotProgress, gotCompleted, gotMessage bool

	for !gotCompleted || !gotMessage {
		var ev protocol.EventEnvelope
		if err := wsjson.Read(ctx, connAlice, &ev); err != nil {
			t.Fatal(err)
		}

		switch ev.Type {
		case protocol.EventTransferQueued:
			gotQueued = true
			if !strings.HasPrefix(ev.Transfer.ID, "dl-file-123") {
				t.Fatalf("expected transfer ID starting with dl-file-123, got = %s", ev.Transfer.ID)
			}
		case protocol.EventTransferStarted:
			gotStarted = true
		case protocol.EventTransferProgress:
			gotProgress = true
			if ev.Transfer.Percent < 0 || ev.Transfer.Percent > 100 {
				t.Fatalf("invalid percentage: %d", ev.Transfer.Percent)
			}
		case protocol.EventTransferCompleted:
			gotCompleted = true
		case protocol.EventMessageAdded:
			gotMessage = true
			if ev.Message.Text != "Hi Alice" || ev.Message.Sender != "Bob" {
				t.Fatalf("unexpected message: %#v", ev.Message)
			}
		}
	}

	// Check download thread exit
	if err := <-errChan; err != nil {
		t.Fatal(err)
	}

	if !gotQueued || !gotStarted || !gotProgress || !gotCompleted {
		t.Fatalf("missing transfer lifecycle events: queued=%t, started=%t, progress=%t, completed=%t",
			gotQueued, gotStarted, gotProgress, gotCompleted)
	}

	if !gotMessage {
		t.Fatalf("WebSocket text channel was not responsive or Bob's message was starved during download!")
	}
}

func TestFileNotificationToBypassDevice(t *testing.T) {
	handler := NewHandler(Config{BasePath: "/chat-v2", DisableSystemMessages: true})
	server := httptest.NewServer(handler)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/chat-v2/test-token/ws"

	// 1. Connect Alice (Peer A)
	connAlice, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connAlice.Close(websocket.StatusNormalClosure, "done")
	var helloA protocol.EventEnvelope
	_ = wsjson.Read(ctx, connAlice, &helloA)
	_ = wsjson.Write(ctx, connAlice, protocol.CommandEnvelope{
		Type:      protocol.CommandConnect,
		CommandID: "conn-alice",
		Client: protocol.ClientInfo{
			Label: "Alice",
			Peer:  "peer-A",
		},
	})
	_ = wsjson.Read(ctx, connAlice, &helloA)

	// 2. Connect Desktop (B)
	connDesktop, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connDesktop.Close(websocket.StatusNormalClosure, "done")
	var helloD protocol.EventEnvelope
	_ = wsjson.Read(ctx, connDesktop, &helloD)
	_ = wsjson.Write(ctx, connDesktop, protocol.CommandEnvelope{
		Type:      protocol.CommandConnect,
		CommandID: "conn-desktop",
		Client: protocol.ClientInfo{
			Label: "Desktop",
			Peer:  "desktop",
		},
	})
	_ = wsjson.Read(ctx, connDesktop, &helloD)

	// 3. Connect Charlie (Bypass Client C)
	connCharlie, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connCharlie.Close(websocket.StatusNormalClosure, "done")
	var helloC protocol.EventEnvelope
	_ = wsjson.Read(ctx, connCharlie, &helloC)
	_ = wsjson.Write(ctx, connCharlie, protocol.CommandEnvelope{
		Type:      protocol.CommandConnect,
		CommandID: "conn-charlie",
		Client: protocol.ClientInfo{
			Label: "Charlie",
			Peer:  "peer-C",
		},
	})
	_ = wsjson.Read(ctx, connCharlie, &helloC)

	// Flush Charlie's presence events to avoid noise
	for {
		var ev protocol.EventEnvelope
		if err := wsjson.Read(ctx, connCharlie, &ev); err != nil {
			t.Fatal(err)
		}
		if ev.Type == protocol.EventPresenceChanged {
			break
		}
	}

	// 4. Alice initializes file upload via POST /upload/init
	initBody := `{"fileName":"test-file.txt","size":100,"sender":"Alice","peer":"peer-A"}`
	resp, err := http.Post(server.URL+"/chat-v2/test-token/upload/init", "application/json", strings.NewReader(initBody))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("upload/init failed status=%d body=%s", resp.StatusCode, string(body))
	}
	var msgInit protocol.Message
	if err := json.NewDecoder(resp.Body).Decode(&msgInit); err != nil {
		t.Fatal(err)
	}
	msgID := msgInit.ID

	// 5. Charlie should NOT receive EventMessageAdded (uploading: true) for the file.
	charlieReceivedMessage := false
	ch := make(chan protocol.EventEnvelope, 100)
	go func() {
		for {
			var ev protocol.EventEnvelope
			if err := wsjson.Read(ctx, connCharlie, &ev); err != nil {
				return
			}
			ch <- ev
		}
	}()

	select {
	case ev := <-ch:
		if ev.Type == protocol.EventMessageAdded && ev.Message != nil && ev.Message.ID == msgID {
			charlieReceivedMessage = true
		}
	case <-time.After(100 * time.Millisecond):
		// No event, good
	}
	if charlieReceivedMessage {
		t.Fatal("Charlie should NOT receive file message added event during upload initialization")
	}

	// 6. Alice uploads file data via POST /upload
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, _ := writer.CreateFormFile("file", "test-file.txt")
	_, _ = part.Write([]byte("hello world this is a test file"))
	_ = writer.WriteField("messageId", msgID)
	_ = writer.WriteField("sender", "Alice")
	_ = writer.WriteField("peer", "peer-A")
	_ = writer.Close()

	respUpload, err := http.Post(server.URL+"/chat-v2/test-token/upload", writer.FormDataContentType(), &buf)
	if err != nil {
		t.Fatal(err)
	}
	defer respUpload.Body.Close()
	if respUpload.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(respUpload.Body)
		t.Fatalf("upload failed status=%d body=%s", respUpload.StatusCode, string(body))
	}

	// Charlie should receive EventMessageUpdated indicating downloaded=true immediately upon upload completion!
	var targetEvent protocol.EventEnvelope
	found := false
	for !found {
		select {
		case ev := <-ch:
			if (ev.Type == protocol.EventMessageAdded || ev.Type == protocol.EventMessageUpdated) && ev.Message != nil && ev.Message.ID == msgID {
				targetEvent = ev
				found = true
			}
		case <-time.After(500 * time.Millisecond):
			t.Fatal("timeout waiting for Charlie to receive file message event after upload completion")
		}
	}

	if !targetEvent.Message.Downloaded {
		t.Fatalf("expected message to be marked downloaded, got downloaded=%v", targetEvent.Message.Downloaded)
	}
}

func TestReconnectionAfterSeqLeakFix(t *testing.T) {
	handler := NewHandler(Config{BasePath: "/chat-v2", DisableSystemMessages: true})
	server := httptest.NewServer(handler)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/chat-v2/test-token/ws"

	// 1. Connect Alice
	connAlice, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connAlice.Close(websocket.StatusNormalClosure, "done")

	var helloA protocol.EventEnvelope
	_ = wsjson.Read(ctx, connAlice, &helloA) // initial raw Hello
	
	// Send Connect Command
	err = wsjson.Write(ctx, connAlice, protocol.CommandEnvelope{
		Type:      protocol.CommandConnect,
		CommandID: "conn-alice",
		Client: protocol.ClientInfo{
			Label: "Alice",
			Peer:  "peer-alice",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = wsjson.Read(ctx, connAlice, &helloA) // connection Handshake Hello

	// Alice sends an init message to push seq above 0
	err = wsjson.Write(ctx, connAlice, protocol.CommandEnvelope{
		Type:      protocol.CommandSendText,
		CommandID: "alice-init-msg",
		Text:      "Alice init",
	})
	if err != nil {
		t.Fatal(err)
	}
	var aliceInitEvent protocol.EventEnvelope
	for {
		err = wsjson.Read(ctx, connAlice, &aliceInitEvent)
		if err != nil {
			t.Fatal(err)
		}
		if aliceInitEvent.Type == protocol.EventMessageAdded && aliceInitEvent.Message != nil && aliceInitEvent.Message.Text == "Alice init" {
			break
		}
	}

	// Connect Bob
	connBob, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connBob.Close(websocket.StatusNormalClosure, "done")
	var helloB protocol.EventEnvelope
	_ = wsjson.Read(ctx, connBob, &helloB)
	_ = wsjson.Write(ctx, connBob, protocol.CommandEnvelope{
		Type:      protocol.CommandConnect,
		CommandID: "conn-bob",
		Client: protocol.ClientInfo{
			Label: "Bob",
			Peer:  "peer-bob",
		},
	})
	_ = wsjson.Read(ctx, connBob, &helloB)

	// Keep track of Hello's Seq
	lastSeqBeforeDisconnect := aliceInitEvent.Seq
	t.Logf("[DEBUG TEST] lastSeqBeforeDisconnect (Alice init message seq) = %d", lastSeqBeforeDisconnect)

	// 2. Alice disconnects
	connAlice.Close(websocket.StatusNormalClosure, "disconnecting Alice")

	// Give the server a small moment to unregister
	time.Sleep(10 * time.Millisecond)

	// 3. Bob sends an offline message during Alice's disconnect state
	err = wsjson.Write(ctx, connBob, protocol.CommandEnvelope{
		Type:      protocol.CommandSendText,
		CommandID: "bob-msg-1",
		Text:      "Offline message for Alice",
	})
	if err != nil {
		t.Fatal(err)
	}

	// Wait for Bob's message to register and get seq
	time.Sleep(10 * time.Millisecond)

	// 4. Alice reconnects.
	// We simulate the sequence leak scenario:
	// First reconnect (simulating immediate connection and drop where Hello seq is sent but not consumed by watermark)
	connAliceTemp, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	var helloTemp protocol.EventEnvelope
	_ = wsjson.Read(ctx, connAliceTemp, &helloTemp) // initial hello
	
	// Send Connect Command
	err = wsjson.Write(ctx, connAliceTemp, protocol.CommandEnvelope{
		Type:      protocol.CommandConnect,
		CommandID: "conn-alice-temp",
		Client: protocol.ClientInfo{
			Label: "Alice",
			Peer:  "peer-alice",
		},
		AfterSeq: lastSeqBeforeDisconnect, // normal last seq
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = wsjson.Read(ctx, connAliceTemp, &helloTemp) // Handshake Hello
	t.Logf("[DEBUG TEST] helloTemp.Seq (first reconnect) = %d", helloTemp.Seq)
	
	connAliceTemp.Close(websocket.StatusNormalClosure, "immediate drop")
	time.Sleep(10 * time.Millisecond)

	// Now Alice reconnects for the second time.
	// Under the fix, since it excluded 'hello' type from updating watermark on client-side, 
	// Alice STILL sends lastSeqBeforeDisconnect!
	connAliceReal, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connAliceReal.Close(websocket.StatusNormalClosure, "done")
	
	_ = wsjson.Read(ctx, connAliceReal, &helloA) // initial hello
	
	err = wsjson.Write(ctx, connAliceReal, protocol.CommandEnvelope{
		Type:      protocol.CommandConnect,
		CommandID: "conn-alice-real",
		Client: protocol.ClientInfo{
			Label: "Alice",
			Peer:  "peer-alice",
		},
		AfterSeq: lastSeqBeforeDisconnect, // Still sending the correct un-leaked lastSeqBeforeDisconnect
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = wsjson.Read(ctx, connAliceReal, &helloA) // Handshake Hello
	t.Logf("[DEBUG TEST] helloReal.Seq (second reconnect) = %d", helloA.Seq)

	// 5. Alice MUST receive the offline message during Replay!
	var gotOfflineMessage bool
	t.Logf("[DEBUG TEST] Starting to read events for Alice Real. lastSeqBeforeDisconnect = %d", lastSeqBeforeDisconnect)
	for {
		var ev protocol.EventEnvelope
		err = wsjson.Read(ctx, connAliceReal, &ev)
		if err != nil {
			t.Logf("[DEBUG TEST] Read error: %v", err)
			t.Fatal(err)
		}
		t.Logf("[DEBUG TEST] Received Event: Type=%s, Seq=%d, Msg=%+v", ev.Type, ev.Seq, ev.Message)
		if ev.Type == protocol.EventMessageAdded && ev.Message != nil && ev.Message.Text == "Offline message for Alice" {
			gotOfflineMessage = true
			break
		}
	}

	if !gotOfflineMessage {
		t.Fatal("expected offline message from Bob during replay, but it was not received")
	}
}

