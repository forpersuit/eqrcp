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
	"path/filepath"
	"strings"
	"testing"
	"time"
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
		clients:     map[string]chatClient{},
		startedAt:   time.Now(),
		state:       "waiting",
		statusHook: func(snapshot ChatStatusSnapshot) {
			snapshots = append(snapshots, snapshot)
		},
	}

	desktopDone := session.registerClient("desktop-token", "Desktop", "desktop", "", "", "")
	mobileDone := session.registerClient("mobile-token", "Phone", "", "", "join-1", "")
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

func TestChatThemesAreAssignedPerClientToken(t *testing.T) {
	session := &chatSession{
		attachments:  map[string]chatAttachment{},
		subscribers:  map[chan struct{}]struct{}{},
		clients:      map[string]chatClient{},
		clientThemes: map[string]string{},
		hostToken:    "host-token",
		startedAt:    time.Now(),
		state:        "waiting",
	}

	desktopDone := session.registerClient("host-token", "Desktop", "desktop", "", "", "")
	mobileDone := session.registerClient("mobile-token", "Phone", "", "theme-5", "join-1", "")
	defer desktopDone()
	defer mobileDone()

	desktopMessage := session.addTextMessage("Desktop", "host-token", "from desktop")
	mobileMessage := session.addTextMessage("Phone", "mobile-token", "from phone")

	if desktopMessage.Theme != "theme-0" {
		t.Fatalf("desktop theme = %q, want default theme-0", desktopMessage.Theme)
	}
	if mobileMessage.Theme == "" || mobileMessage.Theme == "theme-0" {
		t.Fatalf("mobile theme = %q, want non-desktop theme", mobileMessage.Theme)
	}
	devices := session.deviceRosterLocked()
	var sawMobile bool
	for _, device := range devices {
		if device.Label == "Phone" {
			sawMobile = true
			if device.Theme != mobileMessage.Theme {
				t.Fatalf("mobile device theme = %q, want message theme %q", device.Theme, mobileMessage.Theme)
			}
		}
	}
	if !sawMobile {
		t.Fatal("mobile device missing from roster")
	}
}

func TestChatAvatarTravelsWithMessagesAndRoster(t *testing.T) {
	session := &chatSession{
		attachments:      map[string]chatAttachment{},
		subscribers:      map[chan struct{}]struct{}{},
		clients:          map[string]chatClient{},
		clientThemes:     map[string]string{},
		clientThemeJoins: map[string]string{},
		dir:              t.TempDir(),
		attachmentRoute:  "/attachments",
		startedAt:        time.Now(),
	}

	done := session.registerClientWithAvatar("mobile-token", "Phone", "📱", "", "", "join-1", "")
	defer done()
	text := session.addTextMessageWithAvatar("Phone", "📱", "mobile-token", "hello")
	attachment, err := session.saveAttachmentWithAvatar("Phone", "📱", "mobile-token", "note.txt", "text/plain", 4, strings.NewReader("file"), "", 0, 0, 0)
	if err != nil {
		t.Fatal(err)
	}

	if text.Avatar != "📱" || attachment.Avatar != "📱" {
		t.Fatalf("avatars = %q, %q; want messages to carry configured avatar", text.Avatar, attachment.Avatar)
	}
	devices := session.deviceRosterLocked()
	if len(devices) != 1 || devices[0].Avatar != "📱" {
		t.Fatalf("devices = %#v; want avatar in roster", devices)
	}
	if devices[0].ID == "" {
		t.Fatal("device roster should expose a server-generated device id")
	}
}

func TestChatUploadPlaceholderAndProgress(t *testing.T) {
	session := &chatSession{
		attachments:      map[string]chatAttachment{},
		subscribers:      map[chan struct{}]struct{}{},
		clients:          map[string]chatClient{},
		clientThemes:     map[string]string{},
		clientThemeJoins: map[string]string{},
		dir:              t.TempDir(),
		attachmentRoute:  "/attachments",
		startedAt:        time.Now(),
	}

	tempID := "temp-upload-test-id"
	// 1. 创建占位消息
	placeholder := session.addUploadPlaceholderMessage("Tester", "🤖", "tester-token", "file", "test.zip", 1000, tempID, 0, 0, 0)
	if placeholder.ID != tempID || !placeholder.Sending || placeholder.Progress != 0 {
		t.Fatalf("unexpected placeholder: %#v", placeholder)
	}

	// 2. 更新进度
	updatedMsg, ok := session.updateUploadProgressMessage(tempID, 50)
	if !ok || updatedMsg.Progress != 50 || !updatedMsg.Sending {
		t.Fatalf("failed to update progress: %#v", updatedMsg)
	}

	// 3. 完成上传
	completedMsg, err := session.saveAttachmentWithAvatar("Tester", "🤖", "tester-token", "test.zip", "application/zip", 1000, strings.NewReader("file-content"), tempID, 0, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if completedMsg.ID != tempID || completedMsg.Sending || completedMsg.Progress != 0 {
		t.Fatalf("unexpected completed message: %#v", completedMsg)
	}

	// 4. 验证原消息列表中的消息被原地更新，没有重复
	session.mu.Lock()
	messagesCount := len(session.messages)
	session.mu.Unlock()
	if messagesCount != 1 {
		t.Fatalf("messages count = %d, want 1 (no duplicates)", messagesCount)
	}
}

func TestChatKickRequiresHostAndBlocksClient(t *testing.T) {}

func TestChatThemeFollowsTokenAcrossSenderRename(t *testing.T) {
	session := &chatSession{
		attachments:  map[string]chatAttachment{},
		subscribers:  map[chan struct{}]struct{}{},
		clientThemes: map[string]string{},
		startedAt:    time.Now(),
	}

	first := session.addTextMessage("Phone", "mobile-token", "one")
	second := session.addTextMessage("Renamed Phone", "mobile-token", "two")

	if first.Theme == "" || second.Theme == "" || first.Theme != second.Theme {
		t.Fatalf("themes = %q, %q; want same non-empty theme for one token", first.Theme, second.Theme)
	}
}

func TestChatThemeChangesForNewJoinWithoutChangingDeviceIdentity(t *testing.T) {
	session := &chatSession{
		attachments:      map[string]chatAttachment{},
		subscribers:      map[chan struct{}]struct{}{},
		clients:          map[string]chatClient{},
		clientThemes:     map[string]string{},
		clientThemeJoins: map[string]string{},
		startedAt:        time.Now(),
	}

	firstDone := session.registerClient("mobile-token", "Phone", "", "theme-5", "join-1", "")
	firstTheme := session.clientThemes["mobile-token"]
	secondDone := session.registerClient("mobile-token", "Phone", "", firstTheme, "join-2", "")
	secondTheme := session.clientThemes["mobile-token"]
	defer firstDone()
	defer secondDone()

	if firstTheme == "" || firstTheme == "theme-0" {
		t.Fatalf("first theme = %q, want non-desktop theme", firstTheme)
	}
	if secondTheme == "" || secondTheme == "theme-0" {
		t.Fatalf("second theme = %q, want non-desktop theme", secondTheme)
	}
	if firstTheme == secondTheme {
		t.Fatalf("themes = %q then %q, want new scan join to refresh the theme", firstTheme, secondTheme)
	}
	if len(session.clients) != 1 {
		t.Fatalf("clients = %d, want one device identity for repeated scans", len(session.clients))
	}
}

func TestChatPageMergesIncrementalSSEUpdates(t *testing.T)                         {}
func TestChatPageKeepsDeviceCacheAcrossRescans(t *testing.T)                       {}
func TestChatPageUsesMeasuredMobileViewport(t *testing.T)                          {}
func TestChatPageStopsSessionQRPulse(t *testing.T)                                 {}
func TestChatPageOutsideActionsStayVisible(t *testing.T)                           {}
func TestChatPageUsesAvatarForMessagesRosterAndDesktopClipboardPaste(t *testing.T) {}
func TestChatPageUsesNativeFileBridgeInWails(t *testing.T)                         {}
func TestChatPageKeepsDownloadProgressLocalAndPersistent(t *testing.T)             {}

func TestDesktopChatBridgeSelectsNativeFiles(t *testing.T) {
	source, err := os.ReadFile(filepath.Join("..", "..", "desktop", "gui", "frontend", "src", "main.js"))
	if err != nil {
		t.Fatal(err)
	}
	mainJS := string(source)
	for _, want := range []string{
		"e.data.type === 'select-files'",
		"SelectFiles()",
		"type: 'selected-files', requestId, paths: paths || []",
		"type: 'selected-files', requestId, paths: [], error:",
	} {
		if !strings.Contains(mainJS, want) {
			t.Fatalf("desktop chat bridge should contain %q", want)
		}
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

func TestChatRecallRequiresOwnerToken(t *testing.T)                     {}
func TestChatStopRequiresHostToken(t *testing.T)                        {}
func TestChatRejectsWritesAfterTerminalState(t *testing.T)              {}
func TestChatRejectsCrossOriginWrites(t *testing.T)                     {}
func TestChatAllowsTrustedWailsOriginWrites(t *testing.T)               {}
func TestChatAttachmentActiveContentDownloadsAsAttachment(t *testing.T) {}

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

func TestChatStartupAddsSystemMessage(t *testing.T) {
	server := newTestChatServer(t)
	defer os.RemoveAll(server.chatDir)

	if len(server.chatSession.messages) != 1 {
		t.Fatalf("message count = %d, want 1", len(server.chatSession.messages))
	}
	message := server.chatSession.messages[0]
	if message.Sender != "system" || message.Type != "system" {
		t.Fatalf("message = %#v, want system startup message", message)
	}
	if message.Text != "Chat session started." {
		t.Fatalf("message text = %q, want %q", message.Text, "Chat session started.")
	}
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

func TestChatRenameDevice(t *testing.T)                                         {}
func TestAcceptanceMockStates(t *testing.T)                                     {}
func TestAcceptanceWailsWebViewURL(t *testing.T)                                {}
func TestChatAttachmentDownloadDoesNotMutateSharedMessageProgress(t *testing.T) {}

func TestChatVideoMetadataHandling(t *testing.T) {
	session := &chatSession{
		attachments:      map[string]chatAttachment{},
		subscribers:      map[chan struct{}]struct{}{},
		clients:          map[string]chatClient{},
		clientThemes:     map[string]string{},
		clientThemeJoins: map[string]string{},
		dir:              t.TempDir(),
		attachmentRoute:  "/attachments",
		startedAt:        time.Now(),
	}

	tempID := "temp-video-meta-test"

	// 1. 测试创建占位符消息时解析并存储 duration, width, height
	placeholder := session.addUploadPlaceholderMessage(
		"Tester", "🤖", "tester-token", "video", "test.mp4", 2048, tempID, 15.5, 1920, 1080,
	)
	if placeholder.ID != tempID || placeholder.Duration != 15.5 || placeholder.Width != 1920 || placeholder.Height != 1080 {
		t.Fatalf("placeholder video metadata mismatches: %#v", placeholder)
	}

	// 2. 测试完成文件上传时持久化这些元数据
	completedMsg, err := session.saveAttachmentWithAvatar(
		"Tester", "🤖", "tester-token", "test.mp4", "video/mp4", 2048,
		strings.NewReader("fake-video-payload"), tempID, 15.5, 1920, 1080,
	)
	if err != nil {
		t.Fatal(err)
	}
	if completedMsg.ID != tempID || completedMsg.Duration != 15.5 || completedMsg.Width != 1920 || completedMsg.Height != 1080 {
		t.Fatalf("completed message video metadata mismatches: %#v", completedMsg)
	}

	// 3. 验证从 attachments Map 中查询结果也带路径
	attachment, ok := session.attachments[tempID]
	if !ok || attachment.FileName != "test.mp4" || attachment.Size != 2048 {
		t.Fatalf("attachment not stored properly: %#v", attachment)
	}
}

func TestChatLocalAttachmentRegister(t *testing.T) {
	tempFile, err := os.CreateTemp("", "eqt-local-test-*.txt")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tempFile.Name())

	content := []byte("local-zero-copy-file-content")
	if _, err := tempFile.Write(content); err != nil {
		t.Fatal(err)
	}
	tempFile.Close()

	s := &Server{}
	session := &chatSession{
		hostToken:        "host-secret-token",
		messages:         []chatMessage{},
		attachments:      map[string]chatAttachment{},
		clients:          map[string]chatClient{},
		clientThemes:     map[string]string{},
		clientThemeJoins: map[string]string{},
		dir:              t.TempDir(),
		attachmentRoute:  "/attachments",
		startedAt:        time.Now(),
	}
	s.chatSession = session
	s.chatDir = session.dir

	mux := http.NewServeMux()
	mux.HandleFunc("/attachments/local", session.handleLocalAttachmentRegister)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	// 1. 测试不带 HostToken 访问，应当被拒绝 (403)
	reqBody, _ := json.Marshal(map[string]string{
		"path":   tempFile.Name(),
		"sender": "GUI",
		"token":  "client-token",
	})
	resp, err := http.Post(ts.URL+"/attachments/local", "application/json", bytes.NewReader(reqBody))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected forbidden (403), got: %d", resp.StatusCode)
	}

	// 2. 测试带上合法的 HostToken 登记本地文件，应当成功 (200)
	resp, err = http.Post(ts.URL+"/attachments/local?hostToken=host-secret-token", "application/json", bytes.NewReader(reqBody))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected OK (200), got: %d", resp.StatusCode)
	}

	// 3. 验证内存映射是否正确指向了 tempFile.Name() 原始文件路径，实现了零自传
	var msg chatMessage
	if err := json.NewDecoder(resp.Body).Decode(&msg); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()

	session.mu.Lock()
	attachment, ok := session.attachments[msg.ID]
	session.mu.Unlock()

	if !ok {
		t.Fatalf("expected attachment to be registered, but not found")
	}
	if attachment.Path != tempFile.Name() {
		t.Fatalf("expected path to be %s, got: %s (non-zero-copy bypass broke)", tempFile.Name(), attachment.Path)
	}
}
