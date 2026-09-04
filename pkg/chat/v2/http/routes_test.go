package chathttp

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
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

func TestSinglePassStreamingUploadQueryAndForm(t *testing.T) {
	handler := NewHandler(Config{BasePath: "/chat-v2", DisableSystemMessages: true})
	server := httptest.NewServer(handler)
	defer server.Close()

	token := "stream-upload-token"

	// 1. Upload with pre-init (upload/init) and verify BytesTotal is preserved, not cleared to 0 (P1)
	{
		initPayload := `{"fileName":"stream-doc.pdf","size":55,"sender":"Tester","peer":"peer-stream"}`
		initResp, err := http.Post(fmt.Sprintf("%s/chat-v2/%s/upload/init", server.URL, token), "application/json", strings.NewReader(initPayload))
		if err != nil {
			t.Fatal(err)
		}
		defer initResp.Body.Close()

		var initMsg protocol.Message
		if err := json.NewDecoder(initResp.Body).Decode(&initMsg); err != nil {
			t.Fatal(err)
		}
		msgID := initMsg.ID

		preJob, err := handler.transfer.GetJob("ul-" + msgID)
		if err != nil || preJob.BytesTotal != 55 {
			t.Fatalf("expected pre-init job to have BytesTotal=55, got: %+v (err: %v)", preJob, err)
		}

		var buf bytes.Buffer
		writer := multipart.NewWriter(&buf)
		part, err := writer.CreateFormFile("file", "stream-doc.pdf")
		if err != nil {
			t.Fatal(err)
		}
		testContent := []byte("streaming upload content without intermediary /tmp file") // 55 bytes
		_, _ = part.Write(testContent)
		_ = writer.Close()

		uploadURL := fmt.Sprintf("%s/chat-v2/%s/upload?messageId=%s&sender=Tester&peer=peer-stream", server.URL, token, msgID)
		resp, err := http.Post(uploadURL, writer.FormDataContentType(), &buf)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			b, _ := io.ReadAll(resp.Body)
			t.Fatalf("expected 200, got %d: %s", resp.StatusCode, string(b))
		}

		// Verify Job BytesTotal is STILL 55, NOT zeroed out!
		postJob, err := handler.transfer.GetJob("ul-" + msgID)
		if err != nil {
			t.Fatal(err)
		}
		if postJob.BytesTotal != 55 {
			t.Fatalf("expected postJob.BytesTotal to remain 55, got %d", postJob.BytesTotal)
		}

		sess := handler.sessions.GetOrCreate(token)
		filePath := sess.GetAttachment(msgID)
		if filePath == "" {
			t.Fatalf("attachment not registered for msgID %s", msgID)
		}
		content, err := os.ReadFile(filePath)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(content, testContent) {
			t.Fatalf("content mismatch: got %q, want %q", string(content), string(testContent))
		}

		// 2. Verify attachment download complies with SKILL.md §6.1 (private, no-transform)
		downloadURL := fmt.Sprintf("%s/chat-v2/%s/files/%s?filename=stream-doc.pdf", server.URL, token, msgID)
		dlResp, err := http.Get(downloadURL)
		if err != nil {
			t.Fatal(err)
		}
		dlResp.Body.Close()
		if dlResp.Header.Get("Cache-Control") != "private, no-transform" {
			t.Fatalf("expected Cache-Control 'private, no-transform' per SKILL.md §6.1, got %q", dlResp.Header.Get("Cache-Control"))
		}

		// 3. Verify inline download supports ETag + 304 without creating ghost jobs (P2)
		inlineURL := fmt.Sprintf("%s/chat-v2/%s/files/%s?filename=stream-doc.pdf&inline=1", server.URL, token, msgID)
		inlineResp, err := http.Get(inlineURL)
		if err != nil {
			t.Fatal(err)
		}
		inlineResp.Body.Close()
		if inlineResp.Header.Get("Content-Type") != "application/pdf" {
			t.Fatalf("expected Content-Type 'application/pdf' for inline pdf, got %q", inlineResp.Header.Get("Content-Type"))
		}
		if inlineResp.Header.Get("Content-Security-Policy") != "default-src 'none'; sandbox" {
			t.Fatalf("expected Content-Security-Policy 'default-src 'none'; sandbox', got %q", inlineResp.Header.Get("Content-Security-Policy"))
		}
		if inlineResp.Header.Get("X-Content-Type-Options") != "nosniff" {
			t.Fatalf("expected X-Content-Type-Options 'nosniff', got %q", inlineResp.Header.Get("X-Content-Type-Options"))
		}
		etag := inlineResp.Header.Get("ETag")
		if etag == "" {
			t.Fatal("expected non-empty ETag for inline download")
		}

		// 3b. Verify inline download without filename query param resolves MIME type from message metadata
		inlineNoQueryURL := fmt.Sprintf("%s/chat-v2/%s/files/%s?inline=1", server.URL, token, msgID)
		noQueryResp, err := http.Get(inlineNoQueryURL)
		if err != nil {
			t.Fatal(err)
		}
		noQueryResp.Body.Close()
		if noQueryResp.Header.Get("Content-Type") != "application/pdf" {
			t.Fatalf("expected Content-Type 'application/pdf' via message metadata resolution, got %q", noQueryResp.Header.Get("Content-Type"))
		}
		if !strings.Contains(noQueryResp.Header.Get("Content-Disposition"), "stream-doc.pdf") {
			t.Fatalf("expected Content-Disposition to retain message fileName, got %q", noQueryResp.Header.Get("Content-Disposition"))
		}

		// 3c. Verify inline request (200 OK) NEVER creates a transfer job to prevent room event jitter (F2')
		inlineJobURL := fmt.Sprintf("%s/chat-v2/%s/files/%s?filename=stream-doc.pdf&inline=1&clientId=client-inline-200", server.URL, token, msgID)
		inlineJobResp, err := http.Get(inlineJobURL)
		if err != nil {
			t.Fatal(err)
		}
		inlineJobResp.Body.Close()
		if _, err := handler.transfer.GetJob("dl-" + msgID + "-client-inline-200"); err == nil {
			t.Fatal("inline streaming must not create transfer job!")
		}

		// 3d. Verify 304 Not Modified also does not create a transfer job
		req304, _ := http.NewRequest(http.MethodGet, inlineURL+"&clientId=client-304-check", nil)
		req304.Header.Set("If-None-Match", etag)
		resp304, err := http.DefaultClient.Do(req304)
		if err != nil {
			t.Fatal(err)
		}
		resp304.Body.Close()
		if resp304.StatusCode != http.StatusNotModified {
			t.Fatalf("expected 304, got %d", resp304.StatusCode)
		}
		if _, err := handler.transfer.GetJob("dl-" + msgID + "-client-304-check"); err == nil {
			t.Fatal("304 response must not create dangling transfer job!")
		}

		// 3e. Verify SVG is strictly forced to attachment to prevent stored-XSS execution vectors (F1')
		svgURL := fmt.Sprintf("%s/chat-v2/%s/files/%s?filename=malicious.svg&inline=1", server.URL, token, msgID)
		svgResp, err := http.Get(svgURL)
		if err != nil {
			t.Fatal(err)
		}
		svgResp.Body.Close()
		if !strings.HasPrefix(svgResp.Header.Get("Content-Disposition"), "attachment;") {
			t.Fatalf("expected attachment disposition for SVG even when inline=1 was requested, got %q", svgResp.Header.Get("Content-Disposition"))
		}
		if svgResp.Header.Get("Cache-Control") != "private, no-transform" {
			t.Fatalf("expected private, no-transform cache control for SVG, got %q", svgResp.Header.Get("Cache-Control"))
		}
	}

	// 4. Direct fallback upload without messageId
	{
		var buf bytes.Buffer
		writer := multipart.NewWriter(&buf)
		_ = writer.WriteField("sender", "DirectUser")
		part, err := writer.CreateFormFile("file", "direct.txt")
		if err != nil {
			t.Fatal(err)
		}
		directContent := []byte("direct fallback file content")
		_, _ = part.Write(directContent)
		_ = writer.Close()

		uploadURL := fmt.Sprintf("%s/chat-v2/%s/upload", server.URL, token)
		resp, err := http.Post(uploadURL, writer.FormDataContentType(), &buf)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			b, _ := io.ReadAll(resp.Body)
			t.Fatalf("expected 200 for direct upload, got %d: %s", resp.StatusCode, string(b))
		}

		var res protocol.Message
		if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if res.FileName != "direct.txt" || res.Size != int64(len(directContent)) {
			t.Fatalf("unexpected message: %+v", res)
		}
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

// TestHistoryPaginationLoadOlder verifies connect only delivers the newest page
// and load_history returns older messages without pre-join leakage.
func TestHistoryPaginationLoadOlder(t *testing.T) {
	handler := NewHandler(Config{BasePath: "/chat-v2", DisableSystemMessages: true})
	server := httptest.NewServer(handler)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/chat-v2/hist-page-token/ws"

	connHost, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connHost.Close(websocket.StatusNormalClosure, "done")
	var hello protocol.EventEnvelope
	_ = wsjson.Read(ctx, connHost, &hello)
	_ = wsjson.Write(ctx, connHost, protocol.CommandEnvelope{
		Type:      protocol.CommandConnect,
		CommandID: "conn-host",
		Client:    protocol.ClientInfo{Label: "Host", Peer: "peer-host"},
	})
	_ = wsjson.Read(ctx, connHost, &hello)

	// Produce more than one history page of messages.
	const total = 120
	for i := 0; i < total; i++ {
		if err := wsjson.Write(ctx, connHost, protocol.CommandEnvelope{
			Type:      protocol.CommandSendText,
			CommandID: fmt.Sprintf("m-%d", i),
			Text:      fmt.Sprintf("msg-%03d", i),
		}); err != nil {
			t.Fatal(err)
		}
	}
	// Drain host until last message seen
	for {
		var ev protocol.EventEnvelope
		if err := wsjson.Read(ctx, connHost, &ev); err != nil {
			t.Fatal(err)
		}
		if ev.Type == protocol.EventMessageAdded && ev.Message != nil && ev.Message.Text == fmt.Sprintf("msg-%03d", total-1) {
			break
		}
	}

	connMobile, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connMobile.Close(websocket.StatusNormalClosure, "done")
	_ = wsjson.Read(ctx, connMobile, &hello)
	// Cold-start style rehydrate from joinSeq=0 floor via afterSeq=0 joinSeq=1
	// (joinSeq>0, afterSeq=0 → startSeq=joinSeq).
	if err := wsjson.Write(ctx, connMobile, protocol.CommandEnvelope{
		Type:      protocol.CommandConnect,
		CommandID: "conn-mobile",
		Client:    protocol.ClientInfo{Label: "Mobile", Peer: "peer-mobile"},
		AfterSeq:  0,
		JoinSeq:   1,
	}); err != nil {
		t.Fatal(err)
	}
	_ = wsjson.Read(ctx, connMobile, &hello)

	firstPage := map[string]bool{}
	var hist *protocol.HistoryPage
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && hist == nil {
		readCtx, readCancel := context.WithTimeout(ctx, 300*time.Millisecond)
		var ev protocol.EventEnvelope
		err := wsjson.Read(readCtx, connMobile, &ev)
		readCancel()
		if err != nil {
			continue
		}
		if ev.Type == protocol.EventMessageAdded && ev.Message != nil {
			firstPage[ev.Message.Text] = true
		}
		if ev.Type == protocol.EventHistoryPage {
			hist = ev.History
		}
	}
	if hist == nil {
		t.Fatal("expected history_page on connect")
	}
	if !hist.HasMore {
		t.Fatal("expected hasMore on first page")
	}
	if !firstPage[fmt.Sprintf("msg-%03d", total-1)] {
		t.Fatal("first page missing newest message")
	}
	if firstPage["msg-000"] {
		t.Fatal("first page should not include oldest message")
	}
	oldest := hist.OldestSeq
	if oldest <= 0 {
		t.Fatalf("invalid oldestSeq %d", oldest)
	}

	if err := wsjson.Write(ctx, connMobile, protocol.CommandEnvelope{
		Type:      protocol.CommandLoadHistory,
		CommandID: "hist-1",
		JoinSeq:   1,
		BeforeSeq: oldest,
		Limit:     100,
	}); err != nil {
		t.Fatal(err)
	}

	older := map[string]bool{}
	var hist2 *protocol.HistoryPage
	deadline2 := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline2) && hist2 == nil {
		readCtx, readCancel := context.WithTimeout(ctx, 300*time.Millisecond)
		var ev protocol.EventEnvelope
		err := wsjson.Read(readCtx, connMobile, &ev)
		readCancel()
		if err != nil {
			continue
		}
		if ev.Type == protocol.EventMessageAdded && ev.Message != nil {
			older[ev.Message.Text] = true
		}
		if ev.Type == protocol.EventHistoryPage && ev.CommandID == "hist-1" {
			hist2 = ev.History
		}
	}
	if hist2 == nil {
		t.Fatal("expected history_page for load_history")
	}
	if !older["msg-000"] {
		t.Fatalf("older page missing msg-000: count=%d", len(older))
	}
	if older[fmt.Sprintf("msg-%03d", total-1)] {
		t.Fatal("older page must not re-include newest")
	}
}

// TestColdStartHistoryRehydrate simulates a mobile page discard:
// Alice has a high afterSeq watermark but empty UI, so connect uses afterSeq=joinSeq
// and must receive post-join messages again without pre-join leakage.
func TestColdStartHistoryRehydrate(t *testing.T) {
	handler := NewHandler(Config{BasePath: "/chat-v2", DisableSystemMessages: true})
	server := httptest.NewServer(handler)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/chat-v2/cold-start-token/ws"

	// Host joins first and posts a pre-join secret.
	connHost, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connHost.Close(websocket.StatusNormalClosure, "done")
	var hello protocol.EventEnvelope
	if err := wsjson.Read(ctx, connHost, &hello); err != nil {
		t.Fatal(err)
	}
	if err := wsjson.Write(ctx, connHost, protocol.CommandEnvelope{
		Type:      protocol.CommandConnect,
		CommandID: "conn-host",
		Client:    protocol.ClientInfo{Label: "Host", Peer: "peer-host"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := wsjson.Read(ctx, connHost, &hello); err != nil {
		t.Fatal(err)
	}
	if err := wsjson.Write(ctx, connHost, protocol.CommandEnvelope{
		Type:      protocol.CommandSendText,
		CommandID: "pre-join",
		Text:      "before-join-secret",
	}); err != nil {
		t.Fatal(err)
	}
	// Wait until host sees its own pre-join message so store is populated.
	for {
		var ev protocol.EventEnvelope
		if err := wsjson.Read(ctx, connHost, &ev); err != nil {
			t.Fatal(err)
		}
		if ev.Type == protocol.EventMessageAdded && ev.Message != nil && ev.Message.Text == "before-join-secret" {
			break
		}
	}

	// Mobile first join: capture joinSeq from handshake hello.
	connMobile, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wsjson.Read(ctx, connMobile, &hello); err != nil {
		t.Fatal(err)
	}
	if err := wsjson.Write(ctx, connMobile, protocol.CommandEnvelope{
		Type:      protocol.CommandConnect,
		CommandID: "conn-mobile",
		Client:    protocol.ClientInfo{Label: "Mobile", Peer: "peer-mobile"},
		AfterSeq:  0,
		JoinSeq:   0,
	}); err != nil {
		t.Fatal(err)
	}
	var joinHello protocol.EventEnvelope
	if err := wsjson.Read(ctx, connMobile, &joinHello); err != nil {
		t.Fatal(err)
	}
	joinSeq := joinHello.Seq
	if joinSeq <= 0 {
		t.Fatalf("expected positive joinSeq from hello, got %d", joinSeq)
	}

	// Host sends post-join messages while mobile is connected.
	for _, text := range []string{"hello-after-join-1", "hello-after-join-2"} {
		if err := wsjson.Write(ctx, connHost, protocol.CommandEnvelope{
			Type:      protocol.CommandSendText,
			CommandID: "post-" + text,
			Text:      text,
		}); err != nil {
			t.Fatal(err)
		}
	}

	// Mobile consumes both post-join messages and tracks high watermark.
	var afterSeq int64
	seen := map[string]bool{}
	for len(seen) < 2 {
		var ev protocol.EventEnvelope
		if err := wsjson.Read(ctx, connMobile, &ev); err != nil {
			t.Fatal(err)
		}
		if ev.Seq > afterSeq {
			afterSeq = ev.Seq
		}
		if ev.Type == protocol.EventMessageAdded && ev.Message != nil {
			seen[ev.Message.Text] = true
		}
	}
	if !seen["hello-after-join-1"] || !seen["hello-after-join-2"] {
		t.Fatalf("mobile did not receive live post-join messages: %v", seen)
	}
	if afterSeq <= joinSeq {
		t.Fatalf("expected afterSeq > joinSeq, afterSeq=%d joinSeq=%d", afterSeq, joinSeq)
	}

	// Simulate process kill / tab discard.
	_ = connMobile.Close(websocket.StatusNormalClosure, "mobile background kill")
	time.Sleep(20 * time.Millisecond)

	// Cold start: empty UI → connect with afterSeq=joinSeq (not high watermark).
	connCold, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connCold.Close(websocket.StatusNormalClosure, "done")
	if err := wsjson.Read(ctx, connCold, &hello); err != nil {
		t.Fatal(err)
	}
	if err := wsjson.Write(ctx, connCold, protocol.CommandEnvelope{
		Type:      protocol.CommandConnect,
		CommandID: "conn-mobile-cold",
		Client:    protocol.ClientInfo{Label: "Mobile", Peer: "peer-mobile"},
		AfterSeq:  joinSeq, // cold-start rehydrate watermark
		JoinSeq:   joinSeq,
	}); err != nil {
		t.Fatal(err)
	}
	if err := wsjson.Read(ctx, connCold, &hello); err != nil {
		t.Fatal(err)
	}

	// Must rehydrate post-join history; must not leak pre-join secret.
	coldSeen := map[string]bool{}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && !(coldSeen["hello-after-join-1"] && coldSeen["hello-after-join-2"]) {
		readCtx, readCancel := context.WithTimeout(ctx, 200*time.Millisecond)
		var ev protocol.EventEnvelope
		err := wsjson.Read(readCtx, connCold, &ev)
		readCancel()
		if err != nil {
			continue
		}
		if ev.Type == protocol.EventMessageAdded && ev.Message != nil {
			coldSeen[ev.Message.Text] = true
		}
	}
	if coldSeen["before-join-secret"] {
		t.Fatal("cold-start rehydrate leaked pre-join history")
	}
	if !coldSeen["hello-after-join-1"] || !coldSeen["hello-after-join-2"] {
		t.Fatalf("cold-start missing history: got %v (joinSeq=%d afterSeqWas=%d)", coldSeen, joinSeq, afterSeq)
	}

	// Control: high afterSeq warm reconnect must NOT re-send consumed chat.
	connWarm, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connWarm.Close(websocket.StatusNormalClosure, "done")
	if err := wsjson.Read(ctx, connWarm, &hello); err != nil {
		t.Fatal(err)
	}
	if err := wsjson.Write(ctx, connWarm, protocol.CommandEnvelope{
		Type:      protocol.CommandConnect,
		CommandID: "conn-mobile-warm",
		Client:    protocol.ClientInfo{Label: "Mobile", Peer: "peer-mobile"},
		AfterSeq:  afterSeq,
		JoinSeq:   joinSeq,
	}); err != nil {
		t.Fatal(err)
	}
	if err := wsjson.Read(ctx, connWarm, &hello); err != nil {
		t.Fatal(err)
	}
	warmSeen := map[string]bool{}
	warmDeadline := time.Now().Add(300 * time.Millisecond)
	for time.Now().Before(warmDeadline) {
		readCtx, readCancel := context.WithTimeout(ctx, 50*time.Millisecond)
		var ev protocol.EventEnvelope
		err := wsjson.Read(readCtx, connWarm, &ev)
		readCancel()
		if err != nil {
			continue
		}
		if ev.Type == protocol.EventMessageAdded && ev.Message != nil {
			warmSeen[ev.Message.Text] = true
		}
	}
	if warmSeen["hello-after-join-1"] || warmSeen["hello-after-join-2"] {
		t.Fatalf("warm reconnect must not rehydrate consumed history: %v", warmSeen)
	}
}

func TestHandlerDownloadCancellation(t *testing.T) {
	handler := NewHandler(Config{BasePath: "/chat-v2", DisableSystemMessages: true})
	server := httptest.NewServer(handler)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
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

	// Flush Alice's presence events to avoid test pollution
	var pres protocol.EventEnvelope
	if err := wsjson.Read(ctx, connAlice, &pres); err != nil {
		t.Fatal(err)
	}

	// 2. Alice triggers HTTP file download in a separate goroutine
	// Use large mock size (10MB) so it takes time and we can cancel it midway
	downloadURL := server.URL + "/chat-v2/test-token/files/file-cancel?mock_size=10485760&clientId=peer-alice&messageId=msg-cancel&filename=test.bin"
	errChan := make(chan error, 1)

	// Track download completion or failure state
	var readBytes int64
	go func() {
		resp, err := http.Get(downloadURL)
		if err != nil {
			errChan <- err
			return
		}
		defer resp.Body.Close()

		buf := make([]byte, 32*1024)
		for {
			n, err := resp.Body.Read(buf)
			readBytes += int64(n)
			if err != nil {
				errChan <- err
				return
			}
		}
	}()

	// 3. Wait for download progress to start
	var gotProgress bool
	var gotCancelled bool

	for {
		var ev protocol.EventEnvelope
		if err := wsjson.Read(ctx, connAlice, &ev); err != nil {
			t.Fatal(err)
		}

		if ev.Type == protocol.EventTransferProgress {
			gotProgress = true
			// Download is actively running, now trigger cancel Command from Alice
			err = wsjson.Write(ctx, connAlice, protocol.CommandEnvelope{
				Type:       protocol.CommandCancelTransfer,
				CommandID:  "cancel-tx",
				TransferID: "dl-file-cancel-peer-alice",
			})
			if err != nil {
				t.Fatal(err)
			}
		} else if ev.Type == protocol.EventTransferCancelled {
			gotCancelled = true
			break
		}
	}

	// 4. Ensure download thread exited with error due to user cancel aborting write stream
	select {
	case downloadErr := <-errChan:
		if downloadErr == nil {
			t.Fatal("expected download stream to fail due to active cancel, but it finished successfully")
		}
		t.Logf("Download aborted successfully with error: %v", downloadErr)
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for HTTP GET connection to terminate after cancel")
	}

	if !gotProgress || !gotCancelled {
		t.Fatalf("lifecycle mismatch: gotProgress=%t, gotCancelled=%t", gotProgress, gotCancelled)
	}

	// 5. Verify backend job status is indeed cancelled, and NOT failed
	job, err := handler.transfer.GetJob("dl-file-cancel-peer-alice")
	if err != nil {
		t.Fatal(err)
	}
	if job.GetState() != protocol.TransferCancelled {
		t.Fatalf("expected job state to remain TransferCancelled, got = %s (Error: %s)", job.GetState(), job.Error)
	}
}

func TestHandleZipDownload(t *testing.T) {
	logger := &diag.MemoryLogger{}
	handler := NewHandler(Config{BasePath: "/chat-v2", Logger: logger, DisableSystemMessages: true})

	server := httptest.NewServer(handler)
	defer server.Close()

	sess := handler.sessions.GetOrCreate("test-token")
	sess.MessageStore.Add(protocol.EventEnvelope{
		Type: protocol.EventMessageAdded,
		Message: &protocol.Message{
			ID:       "msg-zip-1",
			Type:     "file",
			FileName: "doc1.pdf",
			Size:     1024,
		},
	})
	sess.MessageStore.Add(protocol.EventEnvelope{
		Type: protocol.EventMessageAdded,
		Message: &protocol.Message{
			ID:       "msg-zip-2",
			Type:     "file",
			FileName: "doc2.pdf",
			Size:     2048,
		},
	})

	zipURL := server.URL + "/chat-v2/test-token/files/zip?ids=msg-zip-1,msg-zip-2&mock_size=512&clientId=peer-alice"
	resp, err := http.Get(zipURL)
	if err != nil {
		t.Fatalf("failed to request zip download: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200 OK, got %d", resp.StatusCode)
	}

	if ct := resp.Header.Get("Content-Type"); ct != "application/zip" {
		t.Fatalf("expected Content-Type application/zip, got %s", ct)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("failed to read zip response body: %v", err)
	}

	zipReader, err := zip.NewReader(bytes.NewReader(bodyBytes), int64(len(bodyBytes)))
	if err != nil {
		t.Fatalf("failed to parse zip content: %v", err)
	}

	if len(zipReader.File) != 2 {
		t.Fatalf("expected 2 files in zip archive, got %d", len(zipReader.File))
	}

	names := []string{zipReader.File[0].Name, zipReader.File[1].Name}
	if names[0] != "doc1.pdf" || names[1] != "doc2.pdf" {
		t.Fatalf("unexpected file names in zip archive: %v", names)
	}

	// Verify uncompressed bytes content match mock size
	for _, f := range zipReader.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("failed to open zip file entry %s: %v", f.Name, err)
		}
		data, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			t.Fatalf("failed to read zip file entry %s: %v", f.Name, err)
		}
		if len(data) != 512 {
			t.Fatalf("expected file entry %s content length 512, got %d", f.Name, len(data))
		}
	}

	// Test missing file scenario: requested missing ID should be skipped in zip and marked failed in transfer manager
	zipMissingURL := server.URL + "/chat-v2/test-token/files/zip?ids=msg-zip-1,msg-nonexistent&mock_size=512&clientId=peer-alice"
	respMissing, err := http.Get(zipMissingURL)
	if err != nil {
		t.Fatalf("failed to request zip download with missing file: %v", err)
	}
	defer respMissing.Body.Close()

	missingBodyBytes, err := io.ReadAll(respMissing.Body)
	if err != nil {
		t.Fatalf("failed to read missing zip response body: %v", err)
	}

	missingZipReader, err := zip.NewReader(bytes.NewReader(missingBodyBytes), int64(len(missingBodyBytes)))
	if err != nil {
		t.Fatalf("failed to parse missing zip content: %v", err)
	}

	if len(missingZipReader.File) != 1 {
		t.Fatalf("expected 1 file in missing zip archive (skipping nonexistent), got %d", len(missingZipReader.File))
	}
	if missingZipReader.File[0].Name != "doc1.pdf" {
		t.Fatalf("expected doc1.pdf in missing zip archive, got %s", missingZipReader.File[0].Name)
	}

	failedJob, err := handler.transfer.GetJob("dl-msg-nonexistent-peer-alice")
	if err != nil {
		t.Fatalf("expected transfer job for missing file to exist, got error: %v", err)
	}
	if failedJob.State != protocol.TransferFailed {
		t.Fatalf("expected job state for missing file to be TransferFailed, got %s", failedJob.State)
	}

	// Verify job progress was tracked for valid zip entries
	job1, err := handler.transfer.GetJob("dl-msg-zip-1-peer-alice")
	if err != nil {
		t.Fatalf("expected transfer job dl-msg-zip-1-peer-alice to exist: %v", err)
	}
	if job1.State != protocol.TransferCompleted {
		t.Fatalf("expected job1 state to be TransferCompleted, got %s", job1.State)
	}
	if job1.BytesDone != 512 || job1.BytesTotal != 1024 {
		t.Fatalf("expected job1 progress BytesDone=512, BytesTotal=1024, got BytesDone=%d, BytesTotal=%d", job1.BytesDone, job1.BytesTotal)
	}

	// Test pre-created running job guard: Ensure handleZipDownload does not override running job to queued
	existingJob := handler.transfer.CreateJob("test-token", "dl-msg-precreated-peer-alice", "msg-precreated", "peer-alice", "doc-pre.pdf", 512)
	_ = handler.transfer.StartJob("dl-msg-precreated-peer-alice")
	sess.MessageStore.Add(protocol.EventEnvelope{
		Type: protocol.EventMessageAdded,
		Message: &protocol.Message{
			ID:       "msg-precreated",
			Type:     "file",
			FileName: "doc-pre.pdf",
			Size:     512,
		},
	})

	var queuedEventCount int
	handler.transfer.RegisterCallback(func(token string, eventType protocol.EventType, event protocol.TransferEvent) {
		if event.ID == "dl-msg-precreated-peer-alice" && eventType == protocol.EventTransferQueued {
			queuedEventCount++
		}
	})

	zipPreURL := server.URL + "/chat-v2/test-token/files/zip?ids=msg-precreated&mock_size=512&clientId=peer-alice"
	respPre, err := http.Get(zipPreURL)
	if err != nil {
		t.Fatalf("failed to request zip download with precreated job: %v", err)
	}
	_ = respPre.Body.Close()

	if queuedEventCount > 0 {
		t.Fatalf("expected 0 EventTransferQueued for precreated running job, got %d", queuedEventCount)
	}
	if existingJob.State != protocol.TransferCompleted {
		t.Fatalf("expected precreated job state to be TransferCompleted, got %s", existingJob.State)
	}
}

func TestIsChatStaticToken(t *testing.T) {
	tests := []struct {
		token string
		want  bool
	}{
		{"assets", true},
		{"favicon.png", true},
		{"favicon.svg", true},
		{"icons.svg", true},
		{"index.js", true},
		{"style.css", true},
		{"manifest.json", true},
		{"app.ico", true},
		{"font.woff2", true},
		{"test-token", false},
		{"chat-session-123", false},
		{"random-name", false},
	}

	for _, tt := range tests {
		got := isChatStaticToken(tt.token)
		if got != tt.want {
			t.Errorf("isChatStaticToken(%q) = %v, want %v", tt.token, got, tt.want)
		}
	}
}

func TestInlineSecurityAndJobSuppression(t *testing.T) {
	logger := &diag.MemoryLogger{}
	handler := NewHandler(Config{BasePath: "/chat-v2", Logger: logger, DisableSystemMessages: true})
	server := httptest.NewServer(handler)
	defer server.Close()

	token := "token-inline-sec"
	sess := handler.sessions.GetOrCreate(token)

	// Register test files in session
	sess.MessageStore.Add(protocol.EventEnvelope{
		Type: protocol.EventMessageAdded,
		Message: &protocol.Message{
			ID:       "msg-svg-xss",
			Type:     "file",
			FileName: "exploit.svg",
			MimeType: "image/svg+xml",
			Size:     1024,
		},
	})
	sess.MessageStore.Add(protocol.EventEnvelope{
		Type: protocol.EventMessageAdded,
		Message: &protocol.Message{
			ID:       "msg-html-xss",
			Type:     "file",
			FileName: "phishing.html",
			MimeType: "text/html",
			Size:     2048,
		},
	})
	sess.MessageStore.Add(protocol.EventEnvelope{
		Type: protocol.EventMessageAdded,
		Message: &protocol.Message{
			ID:       "msg-safe-png",
			Type:     "file",
			FileName: "diagram.png",
			MimeType: "image/png",
			Size:     4096,
		},
	})

	var jobBroadcastCount int
	handler.transfer.RegisterCallback(func(token string, eventType protocol.EventType, event protocol.TransferEvent) {
		jobBroadcastCount++
	})

	// 1. SVG requesting inline=1 MUST be forced to attachment with private cache
	respSvg, err := http.Get(fmt.Sprintf("%s/chat-v2/%s/files/msg-svg-xss?inline=1&mock_size=1024", server.URL, token))
	if err != nil {
		t.Fatal(err)
	}
	respSvg.Body.Close()
	if !strings.HasPrefix(respSvg.Header.Get("Content-Disposition"), "attachment;") {
		t.Fatalf("SVG must be forced to attachment, got: %s", respSvg.Header.Get("Content-Disposition"))
	}
	if respSvg.Header.Get("Cache-Control") != "private, no-transform" {
		t.Fatalf("SVG attachment must use private cache, got: %s", respSvg.Header.Get("Cache-Control"))
	}

	// 2. HTML requesting inline=1 MUST be forced to attachment
	respHtml, err := http.Get(fmt.Sprintf("%s/chat-v2/%s/files/msg-html-xss?inline=1&mock_size=2048", server.URL, token))
	if err != nil {
		t.Fatal(err)
	}
	respHtml.Body.Close()
	if !strings.HasPrefix(respHtml.Header.Get("Content-Disposition"), "attachment;") {
		t.Fatalf("HTML must be forced to attachment, got: %s", respHtml.Header.Get("Content-Disposition"))
	}

	// 3. Safe PNG requesting inline=1:
	// - Content-Disposition must be inline
	// - Must set CSP default-src 'none'; sandbox
	// - Must set X-Content-Type-Options: nosniff
	// - Must NOT create any transfer job and NOT broadcast transfer events
	initialBroadcasts := jobBroadcastCount
	respPng, err := http.Get(fmt.Sprintf("%s/chat-v2/%s/files/msg-safe-png?inline=1&mock_size=4096&clientId=test-client-png", server.URL, token))
	if err != nil {
		t.Fatal(err)
	}
	respPng.Body.Close()

	if !strings.HasPrefix(respPng.Header.Get("Content-Disposition"), "inline;") {
		t.Fatalf("PNG should be inline, got: %s", respPng.Header.Get("Content-Disposition"))
	}
	if respPng.Header.Get("Content-Security-Policy") != "default-src 'none'; sandbox" {
		t.Fatalf("Inline PNG must include CSP sandbox, got: %s", respPng.Header.Get("Content-Security-Policy"))
	}
	if respPng.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("Inline PNG must include X-Content-Type-Options: nosniff, got: %s", respPng.Header.Get("X-Content-Type-Options"))
	}
	if _, err := handler.transfer.GetJob("dl-msg-safe-png-test-client-png"); err == nil {
		t.Fatal("Inline PNG streaming must NOT create a transfer job!")
	}
	if jobBroadcastCount != initialBroadcasts {
		t.Fatalf("Inline PNG streaming must NOT broadcast transfer events, got %d new broadcasts", jobBroadcastCount-initialBroadcasts)
	}
}

func TestInlineBandwidthThrottlingOnFreeSession(t *testing.T) {
	logger := &diag.MemoryLogger{}
	handler := NewHandler(Config{
		BasePath:              "/chat-v2",
		Logger:                logger,
		DisableSystemMessages: true,
		IsPaidOrUnrestricted:  func() bool { return false }, // Free degraded session
	})
	server := httptest.NewServer(handler)
	defer server.Close()

	token := "token-throttle-test"
	sess := handler.sessions.GetOrCreate(token)
	sess.MessageStore.Add(protocol.EventEnvelope{
		Type: protocol.EventMessageAdded,
		Message: &protocol.Message{
			ID:       "msg-large-img",
			Type:     "file",
			FileName: "large-photo.jpg",
			MimeType: "image/jpeg",
			Size:     10240,
		},
	})

	// Request inline download on free session
	resp, err := http.Get(fmt.Sprintf("%s/chat-v2/%s/files/msg-large-img?inline=1&mock_size=10240&clientId=free-client", server.URL, token))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if len(body) != 10240 {
		t.Fatalf("expected 10240 bytes, got %d", len(body))
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
}

func TestRendezvousTimeoutReturns504BeforeHeaders(t *testing.T) {
	logger := &diag.MemoryLogger{}
	handler := NewHandler(Config{
		BasePath:              "/chat-v2",
		Logger:                logger,
		DisableSystemMessages: true,
		RendezvousTimeout:     30 * time.Millisecond, // Short timeout for unit test
	})
	server := httptest.NewServer(handler)
	defer server.Close()

	token := "token-rdv-timeout"
	sess := handler.sessions.GetOrCreate(token)
	sess.MessageStore.Add(protocol.EventEnvelope{
		Type: protocol.EventMessageAdded,
		Message: &protocol.Message{
			ID:       "msg-no-streamer",
			Type:     "file",
			FileName: "remote.png",
			MimeType: "image/png",
			Size:     2048,
		},
	})

	// 1. Inline request waiting for streamer that never connects
	respInline, err := http.Get(fmt.Sprintf("%s/chat-v2/%s/files/msg-no-streamer?inline=1", server.URL, token))
	if err != nil {
		t.Fatal(err)
	}
	defer respInline.Body.Close()

	if respInline.StatusCode != http.StatusGatewayTimeout {
		t.Fatalf("expected 504 Gateway Timeout on inline rendezvous timeout, got %d", respInline.StatusCode)
	}

	// 2. Interactive download request waiting for streamer that never connects
	respInteractive, err := http.Get(fmt.Sprintf("%s/chat-v2/%s/files/msg-no-streamer?clientId=timeout-client", server.URL, token))
	if err != nil {
		t.Fatal(err)
	}
	defer respInteractive.Body.Close()

	if respInteractive.StatusCode != http.StatusGatewayTimeout {
		t.Fatalf("expected 504 Gateway Timeout on interactive rendezvous timeout, got %d", respInteractive.StatusCode)
	}
}
