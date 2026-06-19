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

	"eqt/pages"
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
	attachment, err := session.saveAttachmentWithAvatar("Phone", "📱", "mobile-token", "note.txt", "text/plain", 4, strings.NewReader("file"))
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

func TestChatKickRequiresHostAndBlocksClient(t *testing.T) {
	server := newTestChatServer(t)
	defer os.RemoveAll(server.chatDir)

	done := server.chatSession.registerClient("mobile-token", "Phone", "", "", "join-1", "")
	defer done()
	devices := server.chatSession.deviceRosterLocked()
	if len(devices) != 1 || devices[0].ID == "" {
		t.Fatalf("devices = %#v, want one kickable device id", devices)
	}

	guest := httptest.NewRecorder()
	server.mux.ServeHTTP(guest, httptest.NewRequest(http.MethodPost, "/chat/test/clients/"+devices[0].ID+"/kick", nil))
	if guest.Code != http.StatusForbidden {
		t.Fatalf("guest kick status = %d, want %d", guest.Code, http.StatusForbidden)
	}

	host := httptest.NewRecorder()
	server.mux.ServeHTTP(host, httptest.NewRequest(http.MethodPost, "/chat/test/clients/"+devices[0].ID+"/kick?token="+server.chatSession.hostToken, nil))
	if host.Code != http.StatusAccepted {
		t.Fatalf("host kick status = %d, want %d; body = %q", host.Code, http.StatusAccepted, host.Body.String())
	}

	messageRequest := httptest.NewRequest(http.MethodPost, "/chat/test/messages", strings.NewReader(`{"sender":"Phone","token":"mobile-token","text":"late"}`))
	messageRequest.Header.Set("Content-Type", "application/json")
	messageResponse := httptest.NewRecorder()
	server.mux.ServeHTTP(messageResponse, messageRequest)
	if messageResponse.Code != http.StatusForbidden {
		t.Fatalf("kicked message status = %d, want %d", messageResponse.Code, http.StatusForbidden)
	}
}

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

func TestChatPageKeepsDeviceCacheAcrossRescans(t *testing.T) {
	if !strings.Contains(pages.Chat, "var joinToken = currentJoinToken()") {
		t.Fatal("chat page should create a per-scan join token")
	}
	if !strings.Contains(pages.Chat, "window.localStorage.getItem(chatCacheKey)") || !strings.Contains(pages.Chat, "window.localStorage.setItem(chatCacheKey") {
		t.Fatal("chat cache should follow the stable device token across rescans")
	}
}

func TestChatPageUsesMeasuredMobileViewport(t *testing.T) {
	for _, want := range []string{
		"viewport-fit=cover",
		"--chat-viewport-height: 100vh",
		"--chat-viewport-height: 100dvh",
		"--chat-viewport-width: 100vw",
		"--chat-viewport-top: 0px",
		"--chat-viewport-left: 0px",
		"<div class=\"chat-viewport\" id=\"chat-viewport\">",
		"position: fixed",
		"height: var(--chat-viewport-height)",
		"max-height: var(--chat-viewport-height)",
		"width: var(--chat-viewport-width)",
		"left: var(--chat-viewport-left)",
		"top: var(--chat-viewport-top)",
		"function measuredViewportHeight()",
		"function measuredViewportWidth()",
		"function measuredViewportTop()",
		"function measuredViewportLeft()",
		"window.visualViewport",
		"var top = visual && visual.offsetTop ? visual.offsetTop : 0",
		"var left = visual && visual.offsetLeft ? visual.offsetLeft : 0",
		"return Math.max(1, Math.floor(height || 640))",
		"document.documentElement.style.setProperty('--chat-viewport-width'",
		"document.documentElement.style.setProperty('--chat-viewport-height'",
		"document.documentElement.style.setProperty('--chat-viewport-left'",
		"document.documentElement.style.setProperty('--chat-viewport-top'",
		"function correctDocumentScroll(reason)",
		"function scheduleScrollCorrection(reason)",
		"window.scrollTo(0, 0)",
		"window.visualViewport.addEventListener('resize', handleViewportChange)",
		"input,\n            textarea {\n                font-size: 16px;",
		"var viewport = measuredViewportHeight()",
		"id=\"viewport-debug\"",
		"var viewportDebugEnabled = new URLSearchParams(window.location.search).get('viewportDebug') === '1'",
		"function updateViewportDebug(reason)",
		"function sendViewportDebug(snapshot)",
		"function viewportDebugPointerDown(event)",
		"function viewportDebugPointerMove(event)",
		"viewportDebugEl.addEventListener('pointerdown', viewportDebugPointerDown)",
		"updateViewportDebug('debug-drag')",
		"fetch(viewportDebugRoute",
		"window.visualViewport.addEventListener('scroll', handleViewportScroll)",
		"scheduleScrollCorrection('focus')",
		"updateViewportDebug('init')",
		"function isInsideScrollSurface(target)",
		"function preventOuterTouchMove(event)",
		"document.addEventListener('touchmove', preventOuterTouchMove, {passive: false})",
	} {
		if !strings.Contains(pages.Chat, want) {
			t.Fatalf("chat page should contain %q", want)
		}
	}
	for _, removed := range []string{
		"transform: translateY(var(--chat-viewport-offset-top))",
		"transform: translateY(var(--chat-viewport-top))",
		"function measuredViewportOffsetTop()",
		"window.visualViewport.addEventListener('scroll', handleViewportChange)",
		"maximum-scale=1",
		"user-scalable=no",
	} {
		if strings.Contains(pages.Chat, removed) {
			t.Fatalf("chat page should not contain %q", removed)
		}
	}
}

func TestChatViewportDebugRouteStoresSnapshots(t *testing.T) {
	t.Setenv("TMPDIR", t.TempDir())
	server := newTestChatServer(t)
	defer os.RemoveAll(server.chatDir)

	body := strings.NewReader(`{"reason":"focus","token":"device-token","visualViewport":{"height":412},"rects":{"composer":{"bottom":390}}}`)
	request := httptest.NewRequest(http.MethodPost, "/chat/test/viewport-debug", body)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	server.mux.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("debug post status = %d, want %d", response.Code, http.StatusOK)
	}
	data, err := os.ReadFile(server.chatSession.viewportDebugLog)
	if err != nil {
		t.Fatalf("read debug log: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 1 {
		t.Fatalf("debug log lines = %d, want 1", len(lines))
	}
	var entry map[string]interface{}
	if err := json.Unmarshal([]byte(lines[0]), &entry); err != nil {
		t.Fatalf("decode debug entry: %v", err)
	}
	if entry["reason"] != "focus" || entry["token"] != "device-token" {
		t.Fatalf("debug entry = %#v, want reason and token preserved", entry)
	}
	if _, ok := entry["serverTime"]; !ok {
		t.Fatal("debug entry missing serverTime")
	}
	if filepath.Dir(server.chatSession.viewportDebugLog) == server.chatDir {
		t.Fatal("debug log should persist outside the chat session temp directory")
	}

	get := httptest.NewRequest(http.MethodGet, "/chat/test/viewport-debug", nil)
	getResponse := httptest.NewRecorder()
	server.mux.ServeHTTP(getResponse, get)
	if getResponse.Code != http.StatusOK {
		t.Fatalf("debug get status = %d, want %d", getResponse.Code, http.StatusOK)
	}
	if !strings.Contains(getResponse.Body.String(), `"reason":"focus"`) {
		t.Fatalf("debug get body = %q, want stored snapshot", getResponse.Body.String())
	}
}

func TestChatJoinURLAddsViewportDebugInDevMode(t *testing.T) {
	server := &Server{ChatURL: "http://127.0.0.1:8080/chat/test", ViewportDebug: true}
	if got := server.ChatJoinURL(); got != "http://127.0.0.1:8080/chat/test?viewportDebug=1" {
		t.Fatalf("ChatJoinURL() = %q, want viewport debug query", got)
	}

	server.ViewportDebug = false
	if got := server.ChatJoinURL(); got != server.ChatURL {
		t.Fatalf("ChatJoinURL() = %q, want base chat URL", got)
	}
}

func TestChatPageStopsSessionQRPulse(t *testing.T) {
	if !strings.Contains(pages.Chat, "function stopSessionQRPulse()") {
		t.Fatal("chat page should define a helper to stop the session QR pulse")
	}
	if !strings.Contains(pages.Chat, "window.setTimeout(stopSessionQRPulse, 10000)") {
		t.Fatal("chat page should stop the session QR pulse after 10 seconds")
	}
}

func TestChatPageOutsideActionsStayVisible(t *testing.T) {
	if strings.Contains(pages.Chat, ".message.touch-actions {\n            max-width") {
		t.Fatal("message actions should not use touch-only max-width expansion")
	}
	if !strings.Contains(pages.Chat, "max-width: min(560px, calc(100% - 74px))") {
		t.Fatal("touch layouts should reserve horizontal action-button space")
	}
	if !strings.Contains(pages.Chat, "message-footer-actions") {
		t.Fatal("message actions should render inside the message footer")
	}
	if !strings.Contains(pages.Chat, "function renderFooterActions(message)") {
		t.Fatal("message actions should use a shared renderFooterActions helper")
	}
	if !strings.Contains(pages.Chat, "var color = themeColor(device.theme)") || !strings.Contains(pages.Chat, "border-color:' + color.border") {
		t.Fatal("device roster should render each device with its assigned theme color")
	}
	if !strings.Contains(pages.Chat, "--device-text:' + color.text") || !strings.Contains(pages.Chat, "color: var(--device-text") {
		t.Fatal("device roster text should use each device's assigned theme color")
	}
	if !strings.Contains(pages.Chat, "function messageCopyText(message)") || !strings.Contains(pages.Chat, "message.type === 'image' && message.url && message.sender !== state.sender") || strings.Contains(pages.Chat, "return downloadURL(message.url)") {
		t.Fatal("text messages and received image attachments should expose copy actions without copying download URLs")
	}
	if !strings.Contains(pages.Chat, "function copyImageToClipboard(url, button)") || !strings.Contains(pages.Chat, "new ClipboardItem") || !strings.Contains(pages.Chat, "id=\"preview-copy\"") {
		t.Fatal("received image previews should support copying the image to the clipboard")
	}
	if !strings.Contains(pages.Chat, "function renderDownloadAction(message)") || !strings.Contains(pages.Chat, "message.type === 'text'") || !strings.Contains(pages.Chat, "download.setAttribute('aria-label', 'Download')") {
		t.Fatal("non-text messages should expose the shared download action")
	}
	if !strings.Contains(pages.Chat, "--message-actions-min-width: 58px") || !strings.Contains(pages.Chat, "min-width: var(--message-actions-min-width)") {
		t.Fatal("message bubbles should be at least as wide as two action buttons")
	}
	if !strings.Contains(pages.Chat, "--message-action-bg") || !strings.Contains(pages.Chat, "footer.style.setProperty('--message-action-text', sc.text)") {
		t.Fatal("message actions should inherit the sender theme color")
	}
	if !strings.Contains(pages.Chat, ".file-label:active") || !strings.Contains(pages.Chat, "-webkit-tap-highlight-color: transparent") {
		t.Fatal("mobile attachment button taps should keep a rounded button feedback")
	}
	if !strings.Contains(pages.Chat, "function confirmThenRecall(button, message)") || !strings.Contains(pages.Chat, "confirm-delete") {
		t.Fatal("delete actions should require a confirmation click")
	}
	if !strings.Contains(pages.Chat, "function keepActionFocus(control)") || !strings.Contains(pages.Chat, "function restoreFocusAfterCopy(active)") {
		t.Fatal("message action clicks should not steal composer focus")
	}
	if !strings.Contains(pages.Chat, "function mergeMessages(incoming, forceScroll)") || !strings.Contains(pages.Chat, "target.focus({preventScroll: true})") || !strings.Contains(pages.Chat, "messagesBottomSpace() - messagesEl.clientHeight") {
		t.Fatal("locally sent messages should focus and scroll to the newest message with bottom spacing")
	}
	if !strings.Contains(pages.Chat, "function refocusComposer()") || !strings.Contains(pages.Chat, "sendButton.addEventListener('mousedown'") || !strings.Contains(pages.Chat, "textEl.focus({preventScroll: true})") {
		t.Fatal("sending messages should keep the composer ready for continued typing")
	}
	if !strings.Contains(pages.Chat, "function scrollMessagesToBottomSoon(focusMessageID)") || !strings.Contains(pages.Chat, "window.requestAnimationFrame(function()") || !strings.Contains(pages.Chat, "window.setTimeout(function()") {
		t.Fatal("mobile send scrolling should retry after viewport and composer layout settle")
	}
	if !strings.Contains(pages.Chat, "--messages-bottom-space: clamp(16px, 2.2vh, 22px)") || !strings.Contains(pages.Chat, "scroll-padding-bottom: var(--messages-bottom-space)") {
		t.Fatal("message history bottom spacing should be explicit and bounded")
	}
	if !strings.Contains(pages.Chat, "if (!fresh.length && !updated.length)") || !strings.Contains(pages.Chat, "scrollMessagesToBottomSoon(incoming[incoming.length - 1]") {
		t.Fatal("duplicate local send echoes should scroll without rerendering")
	}
	if !strings.Contains(pages.Chat, "class=\"history-progress\"") || !strings.Contains(pages.Chat, "function updateHistoryProgress()") || !strings.Contains(pages.Chat, "--history-progress-top") {
		t.Fatal("message history should expose a minimal scroll progress indicator")
	}
	if !strings.Contains(pages.Chat, "var followLatest = true") || !strings.Contains(pages.Chat, "function setFollowLatest(value)") {
		t.Fatal("chat scroll behavior should track the user's follow-latest intent explicitly")
	}
	if !strings.Contains(pages.Chat, "if (!followLatest && !forceScroll)") || !strings.Contains(pages.Chat, "if (followLatest || forceScroll)") {
		t.Fatal("incoming messages should respect the follow-latest state")
	}
	if !strings.Contains(pages.Chat, "messagesEl.addEventListener('wheel', noteUserScrollIntent") || !strings.Contains(pages.Chat, "messagesEl.addEventListener('touchstart', noteUserScrollIntent") {
		t.Fatal("manual history scrolling should disable follow-latest tracking")
	}
	if !strings.Contains(pages.Chat, "function captureMessageFocus()") || !strings.Contains(pages.Chat, "function restoreMessageFocus(focusState)") {
		t.Fatal("passive message refreshes should preserve message-local focus")
	}
	if strings.Contains(pages.Chat, "openTouchActions(item)") || strings.Contains(pages.Chat, "bindMessageGestures(item") {
		t.Fatal("message actions should not require long press or hover-only gesture binding")
	}
	if strings.Contains(pages.Chat, ".text,\n            .message:not(.system):not(.attachment-message):not(:has(.attachment-card)) .bubble") {
		t.Fatal("message actions should not disable message text selection")
	}
	if !strings.Contains(pages.Chat, "function messageTimestamp(value)") || !strings.Contains(pages.Chat, "+ '\\n' +") {
		t.Fatal("avatar timestamps should render date and 24-hour time on two lines")
	}
}

func TestChatPageUsesAvatarForMessagesRosterAndDesktopClipboardPaste(t *testing.T) {
	for _, want := range []string{
		"cleanAvatarLabel(message.avatar || '')",
		"cleanAvatarLabel(device.avatar || '')",
		"avatar: state.avatar",
		"data.append('avatar', state.avatar)",
		"withClientAvatar",
		"read-clipboard-text",
		"clipboard-text",
		"insertComposerText(text)",
	} {
		if !strings.Contains(pages.Chat, want) {
			t.Fatalf("chat page should contain %q", want)
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

func TestChatRenameDevice(t *testing.T) {
	server := newTestChatServer(t)
	defer os.RemoveAll(server.chatDir)

	done := server.chatSession.registerClient("mobile-token", "Phone", "", "", "join-1", "")
	defer done()
	devices := server.chatSession.deviceRosterLocked()
	if len(devices) != 1 || devices[0].ID == "" {
		t.Fatalf("devices = %#v, want one device id", devices)
	}
	deviceID := devices[0].ID

	// 1. Success case
	reqBody := `{"token":"mobile-token","label":"RenamedPhone"}`
	req := httptest.NewRequest(http.MethodPost, "/chat/test/clients/"+deviceID+"/rename", strings.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	server.mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("rename status = %d, want %d", w.Code, http.StatusOK)
	}

	// Verify the roster reflects the change
	devices = server.chatSession.deviceRosterLocked()
	if len(devices) != 1 || devices[0].Label != "RenamedPhone" {
		t.Fatalf("after rename, label = %q, want %q", devices[0].Label, "RenamedPhone")
	}

	// Verify the system message was sent
	msgs, _ := server.chatSession.snapshotAfterSeq(0, 0)
	var hasRenameSysMsg bool
	for _, m := range msgs {
		if m.Type == "system" && strings.Contains(m.Text, "Phone has been renamed to RenamedPhone") {
			hasRenameSysMsg = true
			break
		}
	}
	if !hasRenameSysMsg {
		t.Fatalf("rename system message not found in %v", msgs)
	}

	// 2. Forbidden case (wrong token)
	reqBodyWrongToken := `{"token":"wrong-token","label":"HackName"}`
	reqWrong := httptest.NewRequest(http.MethodPost, "/chat/test/clients/"+deviceID+"/rename", strings.NewReader(reqBodyWrongToken))
	reqWrong.Header.Set("Content-Type", "application/json")
	wWrong := httptest.NewRecorder()
	server.mux.ServeHTTP(wWrong, reqWrong)
	if wWrong.Code != http.StatusForbidden {
		t.Fatalf("wrong token rename status = %d, want %d", wWrong.Code, http.StatusForbidden)
	}

	// 3. BadRequest case (empty label)
	reqBodyEmptyLabel := `{"token":"mobile-token","label":""}`
	reqEmpty := httptest.NewRequest(http.MethodPost, "/chat/test/clients/"+deviceID+"/rename", strings.NewReader(reqBodyEmptyLabel))
	reqEmpty.Header.Set("Content-Type", "application/json")
	wEmpty := httptest.NewRecorder()
	server.mux.ServeHTTP(wEmpty, reqEmpty)
	if wEmpty.Code != http.StatusBadRequest {
		t.Fatalf("empty label rename status = %d, want %d", wEmpty.Code, http.StatusBadRequest)
	}
}

func TestAcceptanceMockStates(t *testing.T) {
	states := []string{"clock_tampered", "inconsistent_unpaid", "premium_active", "free_quota", "free_exceeded"}

	for _, state := range states {
		t.Run(state, func(t *testing.T) {
			t.Setenv("EQT_MOCK_STATUS", state)
			server := newTestChatServer(t)
			defer os.RemoveAll(server.chatDir)

			// 1. Request chat template page to verify HTML output stability
			req := httptest.NewRequest(http.MethodGet, "/chat/test", nil)
			w := httptest.NewRecorder()
			server.mux.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				t.Fatalf("state %s: status code = %d, want 200", state, w.Code)
			}

			body := w.Body.String()
			if !strings.Contains(body, "<!doctype html>") {
				t.Fatalf("state %s: missing doctype in body", state)
			}

			// 2. Validate current memory states from mock mapping
			usage := limiterInstance.GetStatus()
			switch state {
			case "clock_tampered":
				if !usage.ClockTampered || usage.LicenseTier != "PLUS U" {
					t.Fatalf("clock_tampered mock mismatch: %+v", usage)
				}
			case "inconsistent_unpaid":
				if usage.IsPaid || usage.ClockTampered || usage.LicenseTier != "PLUS U" {
					t.Fatalf("inconsistent_unpaid mock mismatch: %+v", usage)
				}
			case "premium_active":
				if !usage.IsPaid || usage.ClockTampered || usage.LicenseTier != "PLUS U" {
					t.Fatalf("premium_active mock mismatch: %+v", usage)
				}
			case "free_quota":
				if usage.IsPaid || usage.ClockTampered || usage.LicenseTier != "" {
					t.Fatalf("free_quota mock mismatch: %+v", usage)
				}
			case "free_exceeded":
				if usage.IsPaid || usage.ClockTampered || usage.UsedSeconds < 300 {
					t.Fatalf("free_exceeded mock mismatch: %+v", usage)
				}
			}
		})
	}
}
