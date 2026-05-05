package server

import (
	"bytes"
	"encoding/json"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"strings"
	"testing"
	"time"

	"eqrcp/pages"
)

func TestChatStatusHookUpdatesEveryMessageAndAttachment(t *testing.T) {
	var snapshots []ChatStatusSnapshot
	session := &chatSession{
		attachments:     map[string]chatAttachment{},
		subscribers:     map[chan struct{}]struct{}{},
		dir:             t.TempDir(),
		attachmentRoute: "/attachments",
		startedAt:       time.Now(),
		lastActivity:    time.Now(),
		statusHook: func(snapshot ChatStatusSnapshot) {
			snapshots = append(snapshots, snapshot)
		},
	}

	session.addTextMessage("mobile", "mobile-token", "one")
	session.addTextMessage("desktop", "desktop-token", "two")
	if _, err := session.saveAttachment("mobile", "mobile-token", "note.txt", "text/plain", 4, strings.NewReader("file")); err != nil {
		t.Fatal(err)
	}

	if len(snapshots) != 3 {
		t.Fatalf("status hook calls = %d, want 3", len(snapshots))
	}
	for index, wantCount := range []int{1, 2, 3} {
		if snapshots[index].State != "active" || snapshots[index].MessageCount != wantCount {
			t.Fatalf("snapshot[%d] = %#v, want active count %d", index, snapshots[index], wantCount)
		}
	}
}

func TestChatStatusHookTracksConnectedDevices(t *testing.T) {
	var snapshots []ChatStatusSnapshot
	session := &chatSession{
		attachments: map[string]chatAttachment{},
		subscribers: map[chan struct{}]struct{}{},
		clients:     map[string]int{},
		startedAt:   time.Now(),
		state:       "waiting",
		statusHook: func(snapshot ChatStatusSnapshot) {
			snapshots = append(snapshots, snapshot)
		},
	}

	desktopDone := session.registerClient("desktop-token", "")
	mobileDone := session.registerClient("mobile-token", "")
	mobileDone()
	desktopDone()

	if len(snapshots) != 4 {
		t.Fatalf("status hook calls = %d, want 4", len(snapshots))
	}
	if snapshots[0].DeviceCount != 1 || snapshots[0].State != "waiting" {
		t.Fatalf("snapshot[0] = %#v, want one waiting device", snapshots[0])
	}
	if snapshots[1].DeviceCount != 2 || snapshots[1].State != "active" {
		t.Fatalf("snapshot[1] = %#v, want two active devices", snapshots[1])
	}
	if snapshots[2].DeviceCount != 1 {
		t.Fatalf("snapshot[2] = %#v, want one device after mobile disconnect", snapshots[2])
	}
	if snapshots[3].DeviceCount != 0 {
		t.Fatalf("snapshot[3] = %#v, want no connected devices", snapshots[3])
	}
}

func TestChatPageMergesIncrementalSSEUpdates(t *testing.T) {
	if !strings.Contains(pages.Chat, "mergeMessages(JSON.parse(event.data) || [])") {
		t.Fatal("chat SSE onmessage should merge incoming messages via mergeMessages()")
	}
	if !strings.Contains(pages.Chat, "afterSeq=") {
		t.Fatal("chat SSE reconnects should pass the current event sequence cursor")
	}
	if !strings.Contains(pages.Chat, "token=") {
		t.Fatal("chat SSE connects should identify the client token for presence")
	}
}

func TestChatQRImageRouteReturnsPNG(t *testing.T) {
	server := newTestChatServer(t)
	defer os.RemoveAll(server.chatDir)

	req := httptest.NewRequest(http.MethodGet, "/chat/test/qr/image", nil)
	resp := httptest.NewRecorder()
	server.mux.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("qr image status = %d, want %d", resp.Code, http.StatusOK)
	}
	if got := resp.Header().Get("Content-Type"); got != "image/png" {
		t.Fatalf("Content-Type = %q, want image/png", got)
	}
	if _, err := png.Decode(bytes.NewReader(resp.Body.Bytes())); err != nil {
		t.Fatalf("qr image is not valid png: %v", err)
	}
}

func TestChatMessagesAfterSeqStartsAtJoinBoundaryAndIncludesVisibleRecall(t *testing.T) {
	session := &chatSession{
		attachments:     map[string]chatAttachment{},
		subscribers:     map[chan struct{}]struct{}{},
		dir:             t.TempDir(),
		attachmentRoute: "/attachments",
		startedAt:       time.Now(),
		lastActivity:    time.Now(),
	}

	beforeJoin := session.addTextMessage("Desk", "desk-token", "before")
	joinSeq := session.currentEventSeq()
	afterJoin := session.addTextMessage("Mobile", "mobile-token", "after")
	if _, ok := session.recallMessage(beforeJoin.ID, "Desk", "desk-token"); !ok {
		t.Fatal("recall before-join message failed")
	}
	updates, currentSeq := session.snapshotAfterSeq(joinSeq, joinSeq)
	if len(updates) != 1 {
		t.Fatalf("updates after pre-join recall = %#v, want only after-join message", updates)
	}
	if updates[0].ID != afterJoin.ID || updates[0].Text != "after" {
		t.Fatalf("update = %#v, want after-join message %#v", updates[0], afterJoin)
	}

	recalled, ok := session.recallMessage(afterJoin.ID, "Mobile", "mobile-token")
	if !ok {
		t.Fatal("recall after-join message failed")
	}

	updates, currentSeq = session.snapshotAfterSeq(joinSeq, currentSeq)
	if currentSeq <= joinSeq {
		t.Fatalf("current seq = %d, want > join seq %d", currentSeq, joinSeq)
	}
	if len(updates) != 1 {
		t.Fatalf("updates = %#v, want recalled after-join message", updates)
	}
	if updates[0].ID != afterJoin.ID || !updates[0].Recalled || updates[0].Seq != recalled.Seq {
		t.Fatalf("update = %#v, want recalled after-join message %#v", updates[0], recalled)
	}
	if history := messagesAfterSeq(session.snapshot(), joinSeq, currentSeq); len(history) != 0 {
		t.Fatalf("messagesAfterSeq(currentSeq) = %#v, want no history leak", history)
	}
}

func TestChatRecallRequiresOwnerToken(t *testing.T) {
	server := newTestChatServer(t)
	defer os.RemoveAll(server.chatDir)

	message := postChatMessage(t, server, "Desk One", "owner-token", "secret")

	forged := httptest.NewRecorder()
	server.mux.ServeHTTP(forged, httptest.NewRequest(http.MethodDelete, "/chat/test/messages/"+message.ID, strings.NewReader(`{"sender":"Desk One","token":"attacker-token"}`)))
	if forged.Code != http.StatusNotFound {
		t.Fatalf("forged recall status = %d, want %d", forged.Code, http.StatusNotFound)
	}

	owner := httptest.NewRecorder()
	server.mux.ServeHTTP(owner, httptest.NewRequest(http.MethodDelete, "/chat/test/messages/"+message.ID, strings.NewReader(`{"sender":"Other Name","token":"owner-token"}`)))
	if owner.Code != http.StatusOK {
		t.Fatalf("owner recall status = %d, want %d; body = %q", owner.Code, http.StatusOK, owner.Body.String())
	}
}

func TestChatStopRequiresHostToken(t *testing.T) {
	server := newTestChatServer(t)
	defer os.RemoveAll(server.chatDir)

	guest := httptest.NewRecorder()
	server.mux.ServeHTTP(guest, httptest.NewRequest(http.MethodPost, "/chat/test/stop", nil))
	if guest.Code != http.StatusForbidden {
		t.Fatalf("guest stop status = %d, want %d", guest.Code, http.StatusForbidden)
	}

	host := httptest.NewRecorder()
	server.mux.ServeHTTP(host, httptest.NewRequest(http.MethodPost, "/chat/test/stop?token="+server.chatSession.hostToken, nil))
	if host.Code != http.StatusOK {
		t.Fatalf("host stop status = %d, want %d; body = %q", host.Code, http.StatusOK, host.Body.String())
	}
}

func TestChatRejectsWritesAfterTerminalState(t *testing.T) {
	server := newTestChatServer(t)
	defer os.RemoveAll(server.chatDir)
	server.chatSession.end("stopped")

	messageRequest := httptest.NewRequest(http.MethodPost, "/chat/test/messages", strings.NewReader(`{"sender":"Desk","token":"t","text":"late"}`))
	messageRequest.Header.Set("Content-Type", "application/json")
	messageResponse := httptest.NewRecorder()
	server.mux.ServeHTTP(messageResponse, messageRequest)
	if messageResponse.Code != http.StatusGone {
		t.Fatalf("terminal message status = %d, want %d", messageResponse.Code, http.StatusGone)
	}

	var uploadBody bytes.Buffer
	writer := multipart.NewWriter(&uploadBody)
	_ = writer.WriteField("sender", "Desk")
	_ = writer.WriteField("token", "t")
	part, err := writer.CreateFormFile("files", "late.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte("late")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	uploadRequest := httptest.NewRequest(http.MethodPost, "/chat/test/attachments", &uploadBody)
	uploadRequest.Header.Set("Content-Type", writer.FormDataContentType())
	uploadResponse := httptest.NewRecorder()
	server.mux.ServeHTTP(uploadResponse, uploadRequest)
	if uploadResponse.Code != http.StatusGone {
		t.Fatalf("terminal upload status = %d, want %d", uploadResponse.Code, http.StatusGone)
	}
}

func TestChatRejectsCrossOriginWrites(t *testing.T) {
	server := newTestChatServer(t)
	defer os.RemoveAll(server.chatDir)

	request := httptest.NewRequest(http.MethodPost, "/chat/test/messages", strings.NewReader(`{"sender":"Desk","token":"token","text":"cross origin"}`))
	request.Host = "127.0.0.1:8080"
	request.Header.Set("Origin", "https://example.invalid")
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	server.mux.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("cross-origin message status = %d, want %d", response.Code, http.StatusForbidden)
	}
}

func TestChatAllowsTrustedWailsOriginWrites(t *testing.T) {
	server := newTestChatServer(t)
	defer os.RemoveAll(server.chatDir)

	request := httptest.NewRequest(http.MethodPost, "/chat/test/messages", strings.NewReader(`{"sender":"Desktop","token":"token","text":"from app"}`))
	request.Host = "127.0.0.1:8080"
	request.Header.Set("Origin", "wails://wails.localhost")
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	server.mux.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("wails-origin message status = %d, want %d; body = %q", response.Code, http.StatusOK, response.Body.String())
	}
}

func TestChatAttachmentActiveContentDownloadsAsAttachment(t *testing.T) {
	server := newTestChatServer(t)
	defer os.RemoveAll(server.chatDir)

	uploaded := postChatAttachment(t, server, "Desk", "owner-token", "page.html", "text/html", "<script>alert(1)</script>")
	request := httptest.NewRequest(http.MethodGet, uploaded.URL, nil)
	response := httptest.NewRecorder()
	server.mux.ServeHTTP(response, request)
	if got := response.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want nosniff", got)
	}
	if got := response.Header().Get("Content-Disposition"); !strings.Contains(got, "attachment") {
		t.Fatalf("Content-Disposition = %q, want attachment for active content", got)
	}
}

func TestChatHistoryTrimRemovesPrunedAttachments(t *testing.T) {
	dir := t.TempDir()
	session := &chatSession{
		attachments:     map[string]chatAttachment{},
		subscribers:     map[chan struct{}]struct{}{},
		dir:             dir,
		attachmentRoute: "/attachments",
		startedAt:       time.Now(),
		lastActivity:    time.Now(),
	}

	first, err := session.saveAttachment("Desk", "token", "first.txt", "text/plain", 5, strings.NewReader("first"))
	if err != nil {
		t.Fatal(err)
	}
	firstPath := session.attachments[first.ID].Path
	for i := 0; i < maxChatHistory; i++ {
		session.addTextMessage("Desk", "token", "message")
	}

	if _, ok := session.attachments[first.ID]; ok {
		t.Fatalf("pruned attachment %q remains in attachment map", first.ID)
	}
	if _, err := os.Stat(firstPath); !os.IsNotExist(err) {
		t.Fatalf("pruned attachment file stat error = %v, want not exist", err)
	}
}

func TestServerShutdownStopsChatSession(t *testing.T) {
	var snapshots []ChatStatusSnapshot
	session := &chatSession{
		attachments:  map[string]chatAttachment{},
		subscribers:  map[chan struct{}]struct{}{},
		startedAt:    time.Now(),
		lastActivity: time.Now(),
		state:        "active",
		statusHook: func(snapshot ChatStatusSnapshot) {
			snapshots = append(snapshots, snapshot)
		},
	}
	srv := &Server{
		chatSession: session,
		stopChannel: make(chan bool, 1),
	}

	srv.Shutdown()

	if len(snapshots) != 1 {
		t.Fatalf("status hook calls = %d, want 1", len(snapshots))
	}
	if snapshots[0].State != "stopped" {
		t.Fatalf("snapshot state = %q, want stopped", snapshots[0].State)
	}
	select {
	case <-srv.stopChannel:
	default:
		t.Fatal("Shutdown did not signal stop")
	}
}

func newTestChatServer(t *testing.T) *Server {
	t.Helper()
	server := &Server{
		BaseURL:     "http://127.0.0.1:8080",
		ChatURL:     "http://127.0.0.1:8080/chat/test",
		mux:         http.NewServeMux(),
		stopChannel: make(chan bool, 1),
	}
	server.setStatus("waiting", "Waiting.")
	if err := server.Chat(); err != nil {
		t.Fatalf("Chat() error = %v", err)
	}
	return server
}

func postChatMessage(t *testing.T, server *Server, sender string, token string, text string) chatMessage {
	t.Helper()
	body := strings.NewReader(`{"sender":` + strconvQuote(sender) + `,"token":` + strconvQuote(token) + `,"text":` + strconvQuote(text) + `}`)
	request := httptest.NewRequest(http.MethodPost, "/chat/test/messages", body)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	server.mux.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("message status = %d, want %d; body = %q", response.Code, http.StatusOK, response.Body.String())
	}
	var message chatMessage
	if err := json.NewDecoder(response.Body).Decode(&message); err != nil {
		t.Fatal(err)
	}
	return message
}

func postChatAttachment(t *testing.T, server *Server, sender string, token string, name string, mimeType string, content string) chatMessage {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("sender", sender)
	_ = writer.WriteField("token", token)
	partHeader := make(textproto.MIMEHeader)
	partHeader.Set("Content-Disposition", `form-data; name="files"; filename="`+name+`"`)
	partHeader.Set("Content-Type", mimeType)
	part, err := writer.CreatePart(partHeader)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/chat/test/attachments", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response := httptest.NewRecorder()
	server.mux.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("upload status = %d, want %d; body = %q", response.Code, http.StatusOK, response.Body.String())
	}
	var uploaded []chatMessage
	if err := json.NewDecoder(response.Body).Decode(&uploaded); err != nil {
		t.Fatal(err)
	}
	if len(uploaded) != 1 {
		t.Fatalf("uploaded = %#v, want one attachment", uploaded)
	}
	return uploaded[0]
}

func strconvQuote(value string) string {
	data, _ := json.Marshal(value)
	return string(data)
}

func TestServerShutdownChatUsesRequestedTerminalState(t *testing.T) {
	var snapshots []ChatStatusSnapshot
	session := &chatSession{
		attachments:  map[string]chatAttachment{},
		subscribers:  map[chan struct{}]struct{}{},
		startedAt:    time.Now(),
		lastActivity: time.Now(),
		state:        "active",
		statusHook: func(snapshot ChatStatusSnapshot) {
			snapshots = append(snapshots, snapshot)
		},
	}
	srv := &Server{
		chatSession: session,
		stopChannel: make(chan bool, 1),
	}

	srv.ShutdownChat("replaced")

	if len(snapshots) != 1 {
		t.Fatalf("status hook calls = %d, want 1", len(snapshots))
	}
	if snapshots[0].State != "replaced" {
		t.Fatalf("snapshot state = %q, want replaced", snapshots[0].State)
	}
}
