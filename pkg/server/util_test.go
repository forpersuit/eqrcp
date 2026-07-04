package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"eqt/pkg/body"
	"eqt/pkg/config"
	"eqt/pkg/pages"
)

func TestGetFileName(t *testing.T) {
	existing := []string{"report.txt", "report(1).txt"}

	got := getFileName("report.txt", existing)
	if got != "report(2).txt" {
		t.Fatalf("getFileName() = %q, want %q", got, "report(2).txt")
	}
}

func TestCreateUniqueFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "photo.jpg"), []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}

	out, name, err := createUniqueFile(dir, "photo.jpg", []string{"photo.jpg"})
	if err != nil {
		t.Fatalf("createUniqueFile() error = %v", err)
	}
	defer out.Close()

	if name != "photo(1).jpg" {
		t.Fatalf("createUniqueFile() name = %q, want %q", name, "photo(1).jpg")
	}
	if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
		t.Fatalf("created file missing: %v", err)
	}
}

func TestContentDispositionEscapesSpacesAsPercent20(t *testing.T) {
	got := contentDisposition(`my file "final".txt`)
	want := `attachment; filename="my file \"final\".txt"; filename*=UTF-8''my%20file%20%22final%22.txt`
	if got != want {
		t.Fatalf("contentDisposition() = %q, want %q", got, want)
	}
}

func TestQRPageIncludesURLCopyAndStop(t *testing.T) {
	var out bytes.Buffer
	data := struct {
		URL              string
		NetworkHost      string
		QRImageRoute     string
		StatusRoute      string
		EventsRoute      string
		StopRoute        string
		RepeatRoute      string
		AgentStatusRoute string
		AgentTaskID      string
		HasAgentStatus   bool
		Version          string
	}{
		URL:              `http://127.0.0.1:8080/send/a?name="quoted"`,
		NetworkHost:      "127.0.0.1:8080",
		QRImageRoute:     "/qr/image",
		StatusRoute:      "/qr/status",
		EventsRoute:      "/qr/events",
		StopRoute:        "/qr/stop",
		RepeatRoute:      "http://127.0.0.1:48176/tasks/7/repeat",
		AgentStatusRoute: "http://127.0.0.1:48176/status",
		AgentTaskID:      "7",
		HasAgentStatus:   true,
		Version:          "eqt test [date: now]",
	}

	if err := serveTemplate("qr", pages.QR, &out, data); err != nil {
		t.Fatalf("serveTemplate() error = %v", err)
	}
	html := out.String()
	for _, want := range []string{
		`src="/qr/image"`,
		`id="qr-area"`,
		`action="/qr/stop"`,
		`Transfer again`,
		`http:\/\/127.0.0.1:48176\/tasks\/7\/repeat`,
		`fetch('\/qr\/status'`,
		`new EventSource('\/qr\/events')`,
		"Copy URL",
		"Stop transfer",
		`id="transfer-progress"`,
		`id="transfer-items-title"`,
		`id="transfer-items"`,
		`id="saved-files-title"`,
		`id="saved-files"`,
		`id="transfer-version"`,
		`Version: eqt test [date: now]`,
		`Current address`,
		`127.0.0.1:8080`,
		`same LAN as the phone`,
		`classList.add('hidden')`,
		`Download archive: `,
		`renderList('transfer-items', 'transfer-items-title'`,
		`renderSavedFiles(data.savedFiles || [])`,
		`formatBytes(done)`,
		`Agent: checking`,
		`http:\/\/127.0.0.1:48176\/status`,
		`Task #`,
		`renderAgentRecord(record)`,
		`handleTransferUnavailable`,
		`Transfer service disconnected. Checking desktop agent.`,
		`agentTimer`,
		"Waiting for a device to connect.",
		`name=&#34;quoted&#34;`,
	} {
		if !strings.Contains(html, want) {
			t.Fatalf("QR page = %q, want to contain %q", html, want)
		}
	}
}

func TestQRPageOmitsRepeatWithoutRoute(t *testing.T) {
	var out bytes.Buffer
	data := struct {
		URL              string
		NetworkHost      string
		QRImageRoute     string
		StatusRoute      string
		EventsRoute      string
		StopRoute        string
		RepeatRoute      string
		AgentStatusRoute string
		AgentTaskID      string
		HasAgentStatus   bool
		Version          string
	}{
		URL:          "http://127.0.0.1:8080/send/a",
		NetworkHost:  "127.0.0.1:8080",
		QRImageRoute: "/qr/image",
		StatusRoute:  "/qr/status",
		EventsRoute:  "/qr/events",
		StopRoute:    "/qr/stop",
		Version:      "eqt test [date: now]",
	}

	if err := serveTemplate("qr", pages.QR, &out, data); err != nil {
		t.Fatalf("serveTemplate() error = %v", err)
	}
	if strings.Contains(out.String(), "Transfer again") {
		t.Fatalf("QR page = %q, want no repeat action without route", out.String())
	}
}

func TestBrowserPagesUseBrandAssets(t *testing.T) {
	for name, html := range map[string]string{
		"qr":     pages.QR,
		"chat":   pages.Chat,
		"upload": pages.Upload,
		"done":   pages.Done,
	} {
		if !strings.Contains(html, `href="/favicon.png"`) {
			t.Fatalf("%s page should reference shared favicon route", name)
		}
		expectedLogo := `/assets/eqt-logo-mark.png`
		if name == "done" {
			expectedLogo = `/assets/eqt-logo-horizontal.png`
		}
		if !strings.Contains(html, expectedLogo) {
			t.Fatalf("%s page should reference shared logo route %s", name, expectedLogo)
		}
	}
	if strings.Contains(pages.Upload, `id="Layer_1"`) {
		t.Fatal("upload page should not keep the old inline SVG logo")
	}
}

func TestUploadLangRendering(t *testing.T) {
	var out strings.Builder
	htmlVariables := struct {
		Route         string
		ClientID      string
		DeviceName    string
		File          string
		Files         []string
		Count         int
		Lang          string
		IsPaid        bool
		LicenseTier   string
		UsedTransfers int
		ClockTampered bool
	}{
		Route: "/receive/test",
		Lang:  "",
	}
	if err := serveTemplate("upload", pages.Upload, &out, htmlVariables); err != nil {
		t.Fatalf("serveTemplate upload error = %v", err)
	}
	rendered := out.String()
	lines := strings.Split(rendered, "\n")
	found := false
	for _, line := range lines {
		if strings.Contains(line, "var serverLang") {
			found = true
			t.Logf("Rendered var serverLang line: %s", strings.TrimSpace(line))
		}
	}
	if !found {
		t.Fatal("var serverLang line not found in rendered upload page")
	}
}

func TestReceivePageRendering(t *testing.T) {
	var out strings.Builder
	htmlVariables := struct {
		Route         string
		ClientID      string
		DeviceName    string
		File          string
		Files         []string
		Count         int
		Lang          string
		IsPaid        bool
		LicenseTier   string
		UsedTransfers int
		ClockTampered bool
	}{
		Route: "/receive/testtoken",
		Lang:  "zh",
	}
	if err := serveTemplate("upload", pages.Upload, &out, htmlVariables); err != nil {
		t.Fatalf("serveTemplate upload error = %v", err)
	}
	rendered := out.String()
	if len(rendered) < 1000 {
		t.Fatalf("Rendered page size too small, got %d bytes", len(rendered))
	}
	lines := strings.Split(rendered, "\n")
	for i := 0; i < 30 && i < len(lines); i++ {
		t.Logf("%d: %s", i+1, lines[i])
	}
}


func TestChatPageIncludesMessagingRoutes(t *testing.T) {
	var out bytes.Buffer
	data := struct {
		URL                string
		QRImageRoute       string
		EventsRoute        string
		MessagesRoute      string
		AttachmentsRoute   string
		ClientsRoute       string
		StopRoute          string
		HealthRoute        string
		ViewportDebugRoute string
		HostToken          string
		CanStop            bool
		Version            string
		PayRoute           string
		LicenseTier        string
	}{
		URL:                "http://127.0.0.1:8080/chat/test",
		QRImageRoute:       "/chat/test/qr/image",
		EventsRoute:        "/chat/test/events",
		MessagesRoute:      "/chat/test/messages",
		AttachmentsRoute:   "/chat/test/attachments",
		ClientsRoute:       "/chat/test/clients",
		StopRoute:          "/chat/test/stop",
		HealthRoute:        "/chat/test/health",
		ViewportDebugRoute: "/chat/test/viewport-debug",
		HostToken:          "host-token",
		CanStop:            true,
		Version:            "eqt test [date: now]",
		PayRoute:           "/chat/test/pay",
	}

	if err := serveTemplate("chat", pages.Chat, &out, data); err != nil {
		t.Fatalf("serveTemplate() error = %v", err)
	}
	html := out.String()

	// Debug: check if template variables are present
	t.Logf("HTML length: %d", len(html))
	t.Logf("Contains 'EQT Chat': %v", strings.Contains(html, "EQT Chat"))
	t.Logf("Contains 'EventsRoute': %v", strings.Contains(html, "EventsRoute"))

	// The template uses {{.EventsRoute}} which gets replaced with the actual value
	// In JavaScript, forward slashes in strings are escaped as \/
	for _, want := range []string{
		"EQT Chat",
		`src="/chat/test/qr/image"`,
		"connectSSE",        // Check for reconnection logic - this is the key new feature
		"scheduleReconnect", // Check for reconnection scheduling
		"verifyConnection",  // Check for connection verification
		"isPageVisible",     // Check for visibility tracking
		"visibilitychange",  // Check for Page Visibility API
		`class="icon-button" type="button" id="share-session"`,
		`id="send-button"`,
		`id="devices-toggle"`,
		`id="device-count"`,
		`embedded-chat`,
		`eqt-chat-draft:`,
		`clipboardData.files`,
		`read-clipboard-text`,
		`clipboard-text`,
		`auto-save-file`,
		`currentAvatar`,
		`showSystemNotice`,
		`chatConnectionLost`,
		`\/chat\/test\/viewport-debug`,
		`message-avatar`,
		`file-icon`,
		`placeholder="Message"`,
		`attachment-card`,
		`downloadURL(message.url)`,
		`Device `,
	} {
		if !strings.Contains(html, want) {
			t.Fatalf("Chat page want to contain %q", want)
		}
	}
}

func TestChatPageHidesStopWithoutHostToken(t *testing.T) {
	var out bytes.Buffer
	data := struct {
		URL                string
		QRImageRoute       string
		EventsRoute        string
		MessagesRoute      string
		AttachmentsRoute   string
		ClientsRoute       string
		StopRoute          string
		HealthRoute        string
		ViewportDebugRoute string
		HostToken          string
		CanStop            bool
		Version            string
		PayRoute           string
		LicenseTier        string
	}{
		URL:                "http://127.0.0.1:8080/chat/test",
		QRImageRoute:       "/chat/test/qr/image",
		EventsRoute:        "/chat/test/events",
		MessagesRoute:      "/chat/test/messages",
		AttachmentsRoute:   "/chat/test/attachments",
		ClientsRoute:       "/chat/test/clients",
		StopRoute:          "/chat/test/stop",
		HealthRoute:        "/chat/test/health",
		ViewportDebugRoute: "/chat/test/viewport-debug",
		Version:            "eqt test [date: now]",
		PayRoute:           "/chat/test/pay",
	}

	if err := serveTemplate("chat", pages.Chat, &out, data); err != nil {
		t.Fatalf("serveTemplate() error = %v", err)
	}
	if strings.Contains(out.String(), "Stop chat") {
		t.Fatalf("guest chat page includes host stop action")
	}
}

func TestChatMessagesAndAttachments(t *testing.T) {
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
	defer os.RemoveAll(server.chatDir)

	messageBody := strings.NewReader(`{"sender":"Desk One","token":"desk-token","text":"hello mobile"}`)
	messageRequest := httptest.NewRequest(http.MethodPost, "/chat/test/messages", messageBody)
	messageRequest.Header.Set("Content-Type", "application/json")
	messageResponse := httptest.NewRecorder()
	server.mux.ServeHTTP(messageResponse, messageRequest)
	if messageResponse.Code != http.StatusOK {
		t.Fatalf("message status = %d, want %d; body = %q", messageResponse.Code, http.StatusOK, messageResponse.Body.String())
	}

	listRequest := httptest.NewRequest(http.MethodGet, "/chat/test/messages", nil)
	listResponse := httptest.NewRecorder()
	server.mux.ServeHTTP(listResponse, listRequest)
	var messages []chatMessage
	if err := json.NewDecoder(listResponse.Body).Decode(&messages); err != nil {
		t.Fatalf("decode messages: %v", err)
	}
	if len(messages) != 2 || messages[0].Sender != "system" || messages[0].Text != "Chat session started." || messages[1].Sender != "Desk One" || messages[1].Text != "hello mobile" {
		t.Fatalf("messages = %#v, want startup system message plus desktop text message", messages)
	}
	recallBody := strings.NewReader(`{"sender":"Desk One","token":"desk-token"}`)
	recallRequest := httptest.NewRequest(http.MethodDelete, "/chat/test/messages/"+messages[1].ID, recallBody)
	recallRequest.Header.Set("Content-Type", "application/json")
	recallResponse := httptest.NewRecorder()
	server.mux.ServeHTTP(recallResponse, recallRequest)
	if recallResponse.Code != http.StatusOK {
		t.Fatalf("recall status = %d, want %d; body = %q", recallResponse.Code, http.StatusOK, recallResponse.Body.String())
	}
	listResponse = httptest.NewRecorder()
	server.mux.ServeHTTP(listResponse, listRequest)
	if err := json.NewDecoder(listResponse.Body).Decode(&messages); err != nil {
		t.Fatalf("decode recalled messages: %v", err)
	}
	if len(messages) != 2 || messages[1].Sender != "Desk One" || !messages[1].Recalled || messages[1].Text != "hello mobile" {
		t.Fatalf("messages = %#v, want recalled message retaining original text", messages)
	}

	var uploadBody bytes.Buffer
	writer := multipart.NewWriter(&uploadBody)
	if err := writer.WriteField("sender", "Phone 2471"); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("token", "phone-token"); err != nil {
		t.Fatal(err)
	}
	part, err := writer.CreateFormFile("files", "photo.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte("attachment body")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	uploadRequest := httptest.NewRequest(http.MethodPost, "/chat/test/attachments", &uploadBody)
	uploadRequest.Header.Set("Content-Type", writer.FormDataContentType())
	uploadResponse := httptest.NewRecorder()
	server.mux.ServeHTTP(uploadResponse, uploadRequest)
	if uploadResponse.Code != http.StatusOK {
		t.Fatalf("upload status = %d, want %d; body = %q", uploadResponse.Code, http.StatusOK, uploadResponse.Body.String())
	}
	var uploaded []chatMessage
	if err := json.NewDecoder(uploadResponse.Body).Decode(&uploaded); err != nil {
		t.Fatalf("decode upload: %v", err)
	}
	if len(uploaded) != 1 || uploaded[0].Sender != "Phone 2471" || uploaded[0].FileName != "photo.txt" || uploaded[0].URL == "" {
		t.Fatalf("uploaded = %#v, want named mobile attachment message", uploaded)
	}

	if uploaded[0].URL != "/chat/test/attachments/"+uploaded[0].ID {
		t.Fatalf("uploaded URL = %q, want absolute chat attachment path", uploaded[0].URL)
	}

	downloadRequest := httptest.NewRequest(http.MethodGet, uploaded[0].URL, nil)
	downloadResponse := httptest.NewRecorder()
	server.mux.ServeHTTP(downloadResponse, downloadRequest)
	if downloadResponse.Code != http.StatusOK {
		t.Fatalf("download status = %d, want %d; body = %q", downloadResponse.Code, http.StatusOK, downloadResponse.Body.String())
	}
	if downloadResponse.Body.String() != "attachment body" {
		t.Fatalf("download body = %q, want attachment body", downloadResponse.Body.String())
	}

	forcedDownloadRequest := httptest.NewRequest(http.MethodGet, uploaded[0].URL+"?download=1", nil)
	forcedDownloadResponse := httptest.NewRecorder()
	server.mux.ServeHTTP(forcedDownloadResponse, forcedDownloadRequest)
	if got := forcedDownloadResponse.Header().Get("Content-Disposition"); !strings.Contains(got, "attachment") || !strings.Contains(got, "photo.txt") {
		t.Fatalf("download content disposition = %q, want attachment filename", got)
	}

	recallAttachmentBody := strings.NewReader(`{"sender":"Phone 2471","token":"phone-token"}`)
	recallAttachmentRequest := httptest.NewRequest(http.MethodDelete, "/chat/test/messages/"+uploaded[0].ID, recallAttachmentBody)
	recallAttachmentRequest.Header.Set("Content-Type", "application/json")
	recallAttachmentResponse := httptest.NewRecorder()
	server.mux.ServeHTTP(recallAttachmentResponse, recallAttachmentRequest)
	if recallAttachmentResponse.Code != http.StatusOK {
		t.Fatalf("attachment recall status = %d, want %d; body = %q", recallAttachmentResponse.Code, http.StatusOK, recallAttachmentResponse.Body.String())
	}
	listResponse = httptest.NewRecorder()
	server.mux.ServeHTTP(listResponse, listRequest)
	if err := json.NewDecoder(listResponse.Body).Decode(&messages); err != nil {
		t.Fatalf("decode attachment recall messages: %v", err)
	}
	if len(messages) != 3 || !messages[2].Recalled || messages[2].URL != "" || messages[2].FileName != "" {
		t.Fatalf("messages = %#v, want recalled attachment without retrievable content", messages)
	}
	if _, err := os.Stat(filepath.Join(server.chatDir, uploaded[0].ID+"-photo.txt")); !os.IsNotExist(err) {
		t.Fatalf("recalled attachment file stat error = %v, want not exist", err)
	}
	recalledDownloadResponse := httptest.NewRecorder()
	server.mux.ServeHTTP(recalledDownloadResponse, downloadRequest)
	if recalledDownloadResponse.Code != http.StatusNotFound {
		t.Fatalf("recalled download status = %d, want %d", recalledDownloadResponse.Code, http.StatusNotFound)
	}
}

func TestSafeChatFilename(t *testing.T) {
	tests := map[string]string{
		`C:\fakepath\report final.pdf`: "report final.pdf",
		"../photo.jpeg":                "photo.jpeg",
		`bad:name?.txt`:                "bad_name_.txt",
		"":                             "attachment",
	}
	for input, want := range tests {
		if got := safeChatFilename(input); got != want {
			t.Fatalf("safeChatFilename(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestAgentStatusFromRepeatRoute(t *testing.T) {
	status, taskID, ok := agentStatusFromRepeatRoute("http://127.0.0.1:48176/tasks/42/repeat")
	if !ok {
		t.Fatal("agentStatusFromRepeatRoute() ok = false, want true")
	}
	if status != "http://127.0.0.1:48176/status" || taskID != "42" {
		t.Fatalf("agentStatusFromRepeatRoute() = %q, %q, want status route and task id", status, taskID)
	}

	for _, route := range []string{
		"",
		"/tasks/42/repeat",
		"http://127.0.0.1:48176/tasks/not-number/repeat",
		"http://127.0.0.1:48176/tasks/42/stop",
	} {
		if status, taskID, ok := agentStatusFromRepeatRoute(route); ok || status != "" || taskID != "" {
			t.Fatalf("agentStatusFromRepeatRoute(%q) = %q, %q, %v; want empty false", route, status, taskID, ok)
		}
	}
}

func TestDisplayQRServiceStatus(t *testing.T) {
	binDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(binDir, "xdg-open"), []byte("#!/bin/sh\nexit 0\n"), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir)
	server := &Server{
		BaseURL: "http://127.0.0.1:8080",
		mux:     http.NewServeMux(),
	}
	server.setStatus("waiting", "Waiting for a device to connect.")

	if err := server.DisplayQR("http://127.0.0.1:8080/send/test"); err != nil {
		t.Fatalf("DisplayQR() error = %v", err)
	}

	server.recordStatus()
	request := httptest.NewRequest(http.MethodGet, "/status", nil)
	response := httptest.NewRecorder()
	server.mux.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("/status code = %d, want %d; body = %q", response.Code, http.StatusOK, response.Body.String())
	}
	var status serviceStatus
	if err := json.NewDecoder(response.Body).Decode(&status); err != nil {
		t.Fatalf("decode /status: %v", err)
	}
	if status.State != "waiting" || status.Current.State != "waiting" {
		t.Fatalf("/status = %#v, want waiting service and current state", status)
	}
	if status.Version == "" || status.Current.Version == "" {
		t.Fatalf("/status = %#v, want service and current version", status)
	}
	if len(status.History) != 1 || status.History[0].State != "waiting" {
		t.Fatalf("/status history = %#v, want waiting history record", status.History)
	}
}

func TestServeQRDoesNotOpenBrowser(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	server := &Server{
		BaseURL: "http://127.0.0.1:8080",
		mux:     http.NewServeMux(),
	}
	server.setStatus("waiting", "Waiting for a device to connect.")

	if err := server.ServeQR("http://127.0.0.1:8080/send/test"); err != nil {
		t.Fatalf("ServeQR() error = %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/qr/status", nil)
	response := httptest.NewRecorder()
	server.mux.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("/qr/status code = %d, want %d; body = %q", response.Code, http.StatusOK, response.Body.String())
	}
}

func TestDisplayQRCurrentStatus(t *testing.T) {
	binDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(binDir, "xdg-open"), []byte("#!/bin/sh\nexit 0\n"), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir)
	server := &Server{
		BaseURL: "http://127.0.0.1:8080",
		mux:     http.NewServeMux(),
	}
	server.setStatus("waiting", "Waiting for a device to connect.")

	if err := server.DisplayQR("http://127.0.0.1:8080/send/test"); err != nil {
		t.Fatalf("DisplayQR() error = %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/qr/status", nil)
	response := httptest.NewRecorder()
	server.mux.ServeHTTP(response, request)

	var status transferStatus
	if err := json.NewDecoder(response.Body).Decode(&status); err != nil {
		t.Fatalf("decode /qr/status: %v", err)
	}
	if status.State != "waiting" {
		t.Fatalf("/qr/status = %#v, want waiting state", status)
	}
	if status.Version == "" {
		t.Fatalf("/qr/status = %#v, want version", status)
	}
	if strings.Contains(response.Body.String(), `"history"`) {
		t.Fatalf("/qr/status body = %q, should not include history", response.Body.String())
	}
}

func TestDisplayQRTransferURLStatusAlias(t *testing.T) {
	binDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(binDir, "xdg-open"), []byte("#!/bin/sh\nexit 0\n"), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir)
	server := &Server{
		BaseURL: "http://127.0.0.1:8080",
		mux:     http.NewServeMux(),
	}
	server.setStatus("completed", "Transfer completed.")
	server.updateStatus(func(status *transferStatus) {
		status.Mode = "send"
		status.Target = "eqt-multiple-files.zip"
		status.SavedFiles = []string{"one.txt", "two.txt"}
	})

	if err := server.DisplayQR("http://127.0.0.1:8080/send/test/status-alias"); err != nil {
		t.Fatalf("DisplayQR() error = %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/send/test/status-alias/status", nil)
	response := httptest.NewRecorder()
	server.mux.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("transfer status alias code = %d, want %d; body = %q", response.Code, http.StatusOK, response.Body.String())
	}
	var status transferStatus
	if err := json.NewDecoder(response.Body).Decode(&status); err != nil {
		t.Fatalf("decode transfer status alias: %v", err)
	}
	if status.State != "completed" || status.Target != "eqt-multiple-files.zip" {
		t.Fatalf("transfer status alias = %#v, want completed status for current transfer", status)
	}
	if strings.Contains(response.Body.String(), `"history"`) {
		t.Fatalf("transfer status alias body = %q, should not include history", response.Body.String())
	}
}

func TestCompletedOneShotSendReturnsGoneForLaterBrowser(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "report.txt")
	if err := os.WriteFile(file, []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}
	server, err := New(&config.Config{
		Interface: "any",
		Bind:      "127.0.0.1",
		Port:      0,
		Path:      "repeat-send",
		KeepAlive: false,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Shutdown()
	server.SetStatusGracePeriod(time.Second)
	server.Send(body.Body{Path: file, Filename: "report.txt"})

	request, err := http.NewRequest(http.MethodGet, server.SendURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("User-Agent", "Mozilla test")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("first send status = %d, want %d", response.StatusCode, http.StatusOK)
	}
	if _, err := io.ReadAll(response.Body); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()

	// Simulate the iframe triggering the actual file download
	iframeRequest, err := http.NewRequest(http.MethodGet, server.SendURL+"?download=1", nil)
	if err != nil {
		t.Fatal(err)
	}
	iframeRequest.Header.Set("User-Agent", "Mozilla test")
	iframeResponse, err := http.DefaultClient.Do(iframeRequest)
	if err != nil {
		t.Fatal(err)
	}
	if iframeResponse.StatusCode != http.StatusOK {
		t.Fatalf("iframe download status = %d, want %d", iframeResponse.StatusCode, http.StatusOK)
	}
	iframeBody, err := io.ReadAll(iframeResponse.Body)
	if err != nil {
		t.Fatal(err)
	}
	iframeResponse.Body.Close()
	if string(iframeBody) != "hello" {
		t.Fatalf("iframe download body = %q, want %q", string(iframeBody), "hello")
	}

	request, err = http.NewRequest(http.MethodGet, server.SendURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("User-Agent", "Mozilla test")
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusGone {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("second send status = %d, want %d; body = %q", response.StatusCode, http.StatusGone, string(body))
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "already completed") {
		t.Fatalf("second send body = %q, want completion explanation", string(body))
	}
}

func TestCompletedOneShotReceiveReturnsGoneForLaterBrowser(t *testing.T) {
	server, err := New(&config.Config{
		Interface: "any",
		Bind:      "127.0.0.1",
		Port:      0,
		Path:      "repeat-receive",
		KeepAlive: false,
		Output:    t.TempDir(),
	})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Shutdown()
	server.setStatus("completed", "Transfer completed.")
	if err := server.ReceiveTo(server.outputDir); err != nil {
		t.Fatal(err)
	}

	response, err := http.Get(server.ReceiveURL)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusGone {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("completed receive status = %d, want %d; body = %q", response.StatusCode, http.StatusGone, string(body))
	}
}

func TestDonePageListsTransferredFiles(t *testing.T) {
	var out bytes.Buffer
	data := struct {
		File          string
		Files         []string
		Count         int
		IsPaid        bool
		LicenseTier   string
		UsedTransfers int
		ClockTampered bool
	}{
		File:  `C:\Downloads\one.txt, C:\Downloads\two file.txt`,
		Files: []string{`C:\Downloads\one.txt`, `C:\Downloads\two file.txt`},
		Count: 2,
	}

	if err := serveTemplate("done", pages.Done, &out, data); err != nil {
		t.Fatalf("serveTemplate() error = %v", err)
	}
	html := out.String()
	for _, want := range []string{
		"Transfer Complete",
		"2 files have been saved successfully.",
		"Saved files",
		`C:\Downloads\one.txt`,
		`C:\Downloads\two file.txt`,
		"You can close this page now.",
	} {
		if !strings.Contains(html, want) {
			t.Fatalf("Done page = %q, want to contain %q", html, want)
		}
	}
}

func TestTransferStatus(t *testing.T) {
	server := &Server{}
	server.setStatus("waiting", "Waiting for a device to connect.")
	got := server.getStatus()
	if got.State != "waiting" || got.Message != "Waiting for a device to connect." {
		t.Fatalf("getStatus() = %#v", got)
	}

	server.setStatus("completed", "Transfer completed.")
	got = server.getStatus()
	if got.State != "completed" || got.Message != "Transfer completed." {
		t.Fatalf("getStatus() = %#v", got)
	}
}

func TestTransferStatusHookReceivesCurrentStatus(t *testing.T) {
	server := &Server{}
	server.setStatus("waiting", "Waiting for a device to connect.")
	var snapshots []TransferStatusSnapshot
	server.SetStatusHook(func(status TransferStatusSnapshot) {
		snapshots = append(snapshots, status)
	})
	server.updateStatus(func(status *transferStatus) {
		status.BytesDone = 5
		status.BytesTotal = 10
	})
	server.setStatus("completed", "Transfer completed.")

	if len(snapshots) != 3 {
		t.Fatalf("snapshots = %#v, want initial, progress, completed", snapshots)
	}
	if snapshots[0].State != "waiting" || snapshots[0].Message != "Waiting for a device to connect." {
		t.Fatalf("initial snapshot = %#v, want waiting", snapshots[0])
	}
	if snapshots[1].Percent != 50 {
		t.Fatalf("progress snapshot = %#v, want 50 percent", snapshots[1])
	}
	if snapshots[2].State != "completed" || snapshots[2].Percent != 100 {
		t.Fatalf("completed snapshot = %#v, want completed 100 percent", snapshots[2])
	}
}

func TestTransferStatusStoresSavedFiles(t *testing.T) {
	server := &Server{}
	files := []string{`C:\Downloads\a.txt`, `C:\Downloads\a(1).txt`}
	server.updateStatus(func(status *transferStatus) {
		status.SavedFiles = append([]string(nil), files...)
	})

	got := server.getStatus()
	if len(got.SavedFiles) != len(files) {
		t.Fatalf("SavedFiles = %#v, want %#v", got.SavedFiles, files)
	}
	for index := range files {
		if got.SavedFiles[index] != files[index] {
			t.Fatalf("SavedFiles = %#v, want %#v", got.SavedFiles, files)
		}
	}
}

func TestSendSetsStatusMetadata(t *testing.T) {
	path := filepath.Join(t.TempDir(), "report.txt")
	if err := os.WriteFile(path, []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}
	server := &Server{}
	server.Send(body.Body{Path: path, Filename: "report.txt", Items: []string{"report.txt"}})

	got := server.getStatus()
	if got.Mode != "send" || got.Title != "Share file" || got.Target != "report.txt" {
		t.Fatalf("getStatus() = %#v", got)
	}
	if got.Archive || got.ArchiveName != "" {
		t.Fatalf("archive metadata = %#v, want no archive", got)
	}
	if len(got.Items) != 1 || got.Items[0] != "report.txt" {
		t.Fatalf("Items = %#v, want report.txt", got.Items)
	}
	if got.BytesTotal != 5 {
		t.Fatalf("BytesTotal = %d, want 5", got.BytesTotal)
	}
}

func TestSendSetsArchiveStatusMetadata(t *testing.T) {
	path := filepath.Join(t.TempDir(), "eqt-multiple-files-20260422-010203.zip")
	if err := os.WriteFile(path, []byte("zip"), 0644); err != nil {
		t.Fatal(err)
	}
	server := &Server{}
	server.Send(body.Body{
		Path:     path,
		Filename: "eqt-multiple-files-20260422-010203.zip",
		Archive:  true,
		Items:    []string{"one.txt", "two.txt"},
	})

	got := server.getStatus()
	if got.Mode != "send" || got.Title != "Share multiple files" {
		t.Fatalf("getStatus() = %#v", got)
	}
	if !got.Archive || got.ArchiveName != "eqt-multiple-files-20260422-010203.zip" {
		t.Fatalf("archive metadata = %#v", got)
	}
	if strings.Join(got.Items, ",") != "one.txt,two.txt" {
		t.Fatalf("Items = %#v", got.Items)
	}
	if !strings.Contains(got.Message, "zip archive") {
		t.Fatalf("Message = %q, want zip archive explanation", got.Message)
	}
}

func TestReceiveToSetsStatusMetadata(t *testing.T) {
	dir := t.TempDir()
	server := &Server{}
	if err := server.ReceiveTo(dir); err != nil {
		t.Fatal(err)
	}

	got := server.getStatus()
	if got.Mode != "receive" || got.Title != "Receive files" || got.Target != dir {
		t.Fatalf("getStatus() = %#v", got)
	}
}

func TestSendTitle(t *testing.T) {
	tests := map[string]string{
		"report.txt":                               "Share file",
		"photos-directory-20260422-010203.zip":     "Share directory",
		"eqt-multiple-files-20260422-010203.zip": "Share multiple files",
		"eqt-multiple-files.zip":                 "Share file",
	}
	for filename, want := range tests {
		if got := sendTitle(filename); got != want {
			t.Fatalf("sendTitle(%q) = %q, want %q", filename, got, want)
		}
	}
}

func TestTransferPercent(t *testing.T) {
	tests := []struct {
		done  int64
		total int64
		want  int
	}{
		{done: 0, total: 100, want: 0},
		{done: 25, total: 100, want: 25},
		{done: 150, total: 100, want: 100},
		{done: 25, total: 0, want: 0},
	}
	for _, test := range tests {
		if got := transferPercent(test.done, test.total); got != test.want {
			t.Fatalf("transferPercent(%d, %d) = %d, want %d", test.done, test.total, got, test.want)
		}
	}
}

func TestTransferIncomplete(t *testing.T) {
	tests := []struct {
		done  int64
		total int64
		want  bool
	}{
		{done: 0, total: 0, want: false},
		{done: 0, total: 10, want: true},
		{done: 9, total: 10, want: true},
		{done: 10, total: 10, want: false},
		{done: 11, total: 10, want: false},
	}

	for _, test := range tests {
		if got := transferIncomplete(test.done, test.total); got != test.want {
			t.Fatalf("transferIncomplete(%d, %d) = %v, want %v", test.done, test.total, got, test.want)
		}
	}
}

func TestProgressResponseWriterStoresWriteError(t *testing.T) {
	wantErr := io.ErrClosedPipe
	writer := &progressResponseWriter{
		ResponseWriter: failingResponseWriter{err: wantErr},
	}

	if _, err := writer.Write([]byte("hello")); err != wantErr {
		t.Fatalf("Write() error = %v, want %v", err, wantErr)
	}
	if writer.err != wantErr {
		t.Fatalf("progress writer error = %v, want %v", writer.err, wantErr)
	}
}

type failingResponseWriter struct {
	err error
}

func (failingResponseWriter) Header() http.Header {
	return http.Header{}
}

func (failingResponseWriter) WriteHeader(statusCode int) {}

func (w failingResponseWriter) Write(data []byte) (int, error) {
	return 0, w.err
}

func TestSignalStopAfterStatusGraceWaitsForCompletedState(t *testing.T) {
	server := &Server{stopChannel: make(chan bool, 1)}
	server.SetStatusGracePeriod(10 * time.Millisecond)
	server.setStatus("completed", "Transfer completed.")

	start := time.Now()
	server.signalStopAfterStatusGrace()

	if elapsed := time.Since(start); elapsed < 10*time.Millisecond {
		t.Fatalf("signalStopAfterStatusGrace() returned after %v, want at least grace period", elapsed)
	}
	select {
	case <-server.stopChannel:
	default:
		t.Fatal("signalStopAfterStatusGrace() did not signal stop")
	}
}

func TestSignalStopAfterStatusGraceDoesNotWaitForWaitingState(t *testing.T) {
	server := &Server{stopChannel: make(chan bool, 1)}
	server.SetStatusGracePeriod(time.Second)
	server.setStatus("waiting", "Waiting for a device to connect.")

	start := time.Now()
	server.signalStopAfterStatusGrace()

	if elapsed := time.Since(start); elapsed > 100*time.Millisecond {
		t.Fatalf("signalStopAfterStatusGrace() returned after %v, want immediate stop", elapsed)
	}
	select {
	case <-server.stopChannel:
	default:
		t.Fatal("signalStopAfterStatusGrace() did not signal stop")
	}
}

func TestTransferStatusConcurrentAccess(t *testing.T) {
	server := &Server{}
	var waitGroup sync.WaitGroup
	for i := 0; i < 10; i++ {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			server.setStatus("transferring", "Transfer in progress.")
			_ = server.getStatus()
		}()
	}
	waitGroup.Wait()
}

func TestChatHealthEndpoint(t *testing.T) {
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
	defer os.RemoveAll(server.chatDir)

	// Test health endpoint
	healthRequest := httptest.NewRequest(http.MethodGet, "/chat/test/health", nil)
	healthResponse := httptest.NewRecorder()
	server.mux.ServeHTTP(healthResponse, healthRequest)

	if healthResponse.Code != http.StatusOK {
		t.Fatalf("health endpoint status = %d, want %d", healthResponse.Code, http.StatusOK)
	}

	var health map[string]interface{}
	if err := json.NewDecoder(healthResponse.Body).Decode(&health); err != nil {
		t.Fatalf("decode health response: %v", err)
	}

	if health["status"] != "ok" {
		t.Fatalf("health status = %v, want ok", health["status"])
	}

	if _, ok := health["timestamp"]; !ok {
		t.Fatal("health response missing timestamp")
	}

	if _, ok := health["messageCount"]; !ok {
		t.Fatal("health response missing messageCount")
	}
	if _, ok := health["deviceCount"]; !ok {
		t.Fatal("health response missing deviceCount")
	}
	if _, ok := health["devices"]; !ok {
		t.Fatal("health response missing devices")
	}
	if _, ok := health["state"]; !ok {
		t.Fatal("health response missing state")
	}
	if _, ok := health["lastActivity"]; !ok {
		t.Fatal("health response missing lastActivity")
	}
}

func TestChatMessagesSnapshotIgnoresLastEventIDQuery(t *testing.T) {
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
	defer os.RemoveAll(server.chatDir)

	// Send three messages
	for i := 1; i <= 3; i++ {
		messageBody := strings.NewReader(fmt.Sprintf(`{"sender":"Test","token":"test-token","text":"message %d"}`, i))
		messageRequest := httptest.NewRequest(http.MethodPost, "/chat/test/messages", messageBody)
		messageRequest.Header.Set("Content-Type", "application/json")
		messageResponse := httptest.NewRecorder()
		server.mux.ServeHTTP(messageResponse, messageRequest)
		if messageResponse.Code != http.StatusOK {
			t.Fatalf("send message %d status = %d, want %d", i, messageResponse.Code, http.StatusOK)
		}
	}

	// Get all messages
	listRequest := httptest.NewRequest(http.MethodGet, "/chat/test/messages", nil)
	listResponse := httptest.NewRecorder()
	server.mux.ServeHTTP(listResponse, listRequest)
	var allMessages []chatMessage
	if err := json.NewDecoder(listResponse.Body).Decode(&allMessages); err != nil {
		t.Fatalf("decode messages: %v", err)
	}
	if len(allMessages) != 4 {
		t.Fatalf("got %d messages, want 4", len(allMessages))
	}

	// GET /messages is a full snapshot endpoint. Reconnection recovery is
	// handled by merging full SSE snapshots on the client.
	recoveryRequest := httptest.NewRequest(http.MethodGet, "/chat/test/messages?lastEventId="+allMessages[0].ID, nil)
	recoveryResponse := httptest.NewRecorder()
	server.mux.ServeHTTP(recoveryResponse, recoveryRequest)
	var recoveredMessages []chatMessage
	if err := json.NewDecoder(recoveryResponse.Body).Decode(&recoveredMessages); err != nil {
		t.Fatalf("decode recovered messages: %v", err)
	}

	if len(recoveredMessages) != 4 {
		t.Fatalf("recovered %d messages, want 4", len(recoveredMessages))
	}
}

type monitoringReader struct {
	r     io.Reader
	count int
	limit int
	fn    func()
}

func (mr *monitoringReader) Read(p []byte) (n int, err error) {
	n, err = mr.r.Read(p)
	mr.count += n
	if mr.count >= mr.limit && mr.fn != nil {
		mr.fn()
		mr.fn = nil // only trigger once
	}
	return n, err
}

func TestReceiveLimitsExceededCount(t *testing.T) {
	t.Setenv("EQT_TESTING", "true")
	t.Setenv("EQT_MOCK_STATUS", "free_exceeded_share")

	dir := t.TempDir()
	server, err := New(&config.Config{
		Interface: "any",
		Bind:      "127.0.0.1",
		Port:      0,
		Path:      "test-receive-limits-count",
		KeepAlive: false,
		Output:    dir,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Shutdown()

	if err := server.ReceiveTo(dir); err != nil {
		t.Fatal(err)
	}

	var uploadBody bytes.Buffer
	writer := multipart.NewWriter(&uploadBody)
	for i := 1; i <= 6; i++ {
		part, err := writer.CreateFormFile("files", fmt.Sprintf("file%d.txt", i))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write([]byte(fmt.Sprintf("content%d", i))); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, server.ReceiveURL, &uploadBody)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()

	server.mux.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected status code %d (Forbidden), got %d; body = %q", http.StatusForbidden, w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "File count exceeds 5 files free limit") {
		t.Fatalf("expected error message to contain limit description, got: %q", w.Body.String())
	}
}

func TestReceiveLimitsExceededSize(t *testing.T) {
	t.Setenv("EQT_TESTING", "true")
	t.Setenv("EQT_MOCK_STATUS", "free_exceeded_share")

	dir := t.TempDir()
	server, err := New(&config.Config{
		Interface: "any",
		Bind:      "127.0.0.1",
		Port:      0,
		Path:      "test-receive-limits-size",
		KeepAlive: false,
		Output:    dir,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Shutdown()

	if err := server.ReceiveTo(dir); err != nil {
		t.Fatal(err)
	}

	pr, pw := io.Pipe()
	writer := multipart.NewWriter(pw)

	go func() {
		defer pw.Close()
		defer writer.Close()
		part, err := writer.CreateFormFile("files", "hugefile.bin")
		if err != nil {
			return
		}
		chunk := make([]byte, 1024*1024)
		for i := 0; i < 51; i++ {
			if _, err := part.Write(chunk); err != nil {
				return
			}
		}
	}()

	req := httptest.NewRequest(http.MethodPost, server.ReceiveURL, pr)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()

	server.mux.ServeHTTP(w, req)

	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected status code %d (RequestEntityTooLarge), got %d; body = %q", http.StatusRequestEntityTooLarge, w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "File size exceeds 50MB free limit") {
		t.Fatalf("expected error message to contain limit description, got: %q", w.Body.String())
	}
}

func TestReceiveAllowCompletionIfStartedUnderLimit(t *testing.T) {
	t.Setenv("EQT_TESTING", "true")
	t.Setenv("EQT_MOCK_STATUS", "")

	limiterInstance.mu.Lock()
	limiterInstance.cachedUsage = ChatUsage{
		Date:                 time.Now().Format("2006-01-02"),
		UsedReceiveTransfers: 2,
		IsPaid:               false,
	}
	limiterInstance.hasCached = true
	limiterInstance.mu.Unlock()

	dir := t.TempDir()
	server, err := New(&config.Config{
		Interface: "any",
		Bind:      "127.0.0.1",
		Port:      0,
		Path:      "test-receive-completion",
		KeepAlive: false,
		Output:    dir,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Shutdown()

	if err := server.ReceiveTo(dir); err != nil {
		t.Fatal(err)
	}

	var uploadBody bytes.Buffer
	writer := multipart.NewWriter(&uploadBody)
	for i := 1; i <= 6; i++ {
		part, err := writer.CreateFormFile("files", fmt.Sprintf("file%d.txt", i))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write([]byte(fmt.Sprintf("content%d", i))); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	wrappedReader := &monitoringReader{
		r:     &uploadBody,
		limit: 50,
		fn: func() {
			limiterInstance.mu.Lock()
			limiterInstance.cachedUsage.UsedReceiveTransfers = 6
			limiterInstance.mu.Unlock()
		},
	}

	req := httptest.NewRequest(http.MethodPost, server.ReceiveURL, wrappedReader)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()

	server.mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status code %d (OK) since started under limit, got %d; body = %q", http.StatusOK, w.Code, w.Body.String())
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var txtCount int
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "file") && strings.HasSuffix(entry.Name(), ".txt") {
			txtCount++
		}
	}
	if txtCount != 6 {
		t.Fatalf("expected 6 files to be written successfully, got %d", txtCount)
	}
}

func TestSendMultiFileDownloadSuccessive(t *testing.T) {
	tempDir := t.TempDir()
	file1 := filepath.Join(tempDir, "one.txt")
	file2 := filepath.Join(tempDir, "two.txt")
	_ = os.WriteFile(file1, []byte("hello one"), 0644)
	_ = os.WriteFile(file2, []byte("hello two"), 0644)

	cfg := &config.Config{
		Interface: "any",
		Port:      0,
		KeepAlive: false,
	}
	server, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Shutdown()
	server.SetStatusGracePeriod(time.Second)

	// Use FromArgs to construct payload with Paths filled
	payload, err := body.FromArgs([]string{file1, file2}, false)
	if err != nil {
		t.Fatal(err)
	}
	server.Send(payload)

	// First GET to render download page
	request, err := http.NewRequest(http.MethodGet, server.SendURL+"?client_id=testClient", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("User-Agent", "Mozilla test")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("page load status = %d, want %d", response.StatusCode, http.StatusOK)
	}
	response.Body.Close()

	// Download item 0
	item0Request, err := http.NewRequest(http.MethodGet, server.SendURL+"?download=1&item=0&client_id=testClient", nil)
	if err != nil {
		t.Fatal(err)
	}
	item0Request.Header.Set("User-Agent", "Mozilla test")
	item0Response, err := http.DefaultClient.Do(item0Request)
	if err != nil {
		t.Fatal(err)
	}
	if item0Response.StatusCode != http.StatusOK {
		t.Fatalf("item0 download status = %d, want %d", item0Response.StatusCode, http.StatusOK)
	}
	item0Body, err := io.ReadAll(item0Response.Body)
	if err != nil {
		t.Fatal(err)
	}
	item0Response.Body.Close()
	if string(item0Body) != "hello one" {
		t.Fatalf("item0 body = %q, want %q", string(item0Body), "hello one")
	}

	// Verify server is still running
	checkRequest, err := http.NewRequest(http.MethodGet, server.SendURL+"?client_id=testClient", nil)
	if err != nil {
		t.Fatal(err)
	}
	checkRequest.Header.Set("User-Agent", "Mozilla test")
	checkResponse, err := http.DefaultClient.Do(checkRequest)
	if err != nil {
		t.Fatal(err)
	}
	if checkResponse.StatusCode != http.StatusOK {
		t.Fatalf("server stopped after item0 download? status = %d, want %d", checkResponse.StatusCode, http.StatusOK)
	}
	checkResponse.Body.Close()

	// Download item 1
	item1Request, err := http.NewRequest(http.MethodGet, server.SendURL+"?download=1&item=1&client_id=testClient", nil)
	if err != nil {
		t.Fatal(err)
	}
	item1Request.Header.Set("User-Agent", "Mozilla test")
	item1Response, err := http.DefaultClient.Do(item1Request)
	if err != nil {
		t.Fatal(err)
	}
	if item1Response.StatusCode != http.StatusOK {
		t.Fatalf("item1 download status = %d, want %d", item1Response.StatusCode, http.StatusOK)
	}
	item1Body, err := io.ReadAll(item1Response.Body)
	if err != nil {
		t.Fatal(err)
	}
	item1Response.Body.Close()
	if string(item1Body) != "hello two" {
		t.Fatalf("item1 body = %q, want %q", string(item1Body), "hello two")
	}

	// Wait for grace period (1.2s)
	time.Sleep(1200 * time.Millisecond)

	// Make final request, server should be stopped
	finalRequest, err := http.NewRequest(http.MethodGet, server.SendURL+"?client_id=testClient", nil)
	if err != nil {
		t.Fatal(err)
	}
	finalRequest.Header.Set("User-Agent", "Mozilla test")
	finalResponse, err := http.DefaultClient.Do(finalRequest)
	if err == nil {
		defer finalResponse.Body.Close()
		if finalResponse.StatusCode != http.StatusGone {
			t.Fatalf("server still running after downloading all items! status = %d", finalResponse.StatusCode)
		}
	}
}

func TestSendMultiDeviceDownloadIsolation(t *testing.T) {
	tempDir := t.TempDir()
	file1 := filepath.Join(tempDir, "one.txt")
	file2 := filepath.Join(tempDir, "two.txt")
	_ = os.WriteFile(file1, []byte("hello one"), 0644)
	_ = os.WriteFile(file2, []byte("hello two"), 0644)

	cfg := &config.Config{
		Interface: "any",
		Port:      0,
		KeepAlive: false,
	}
	server, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Shutdown()
	server.SetStatusGracePeriod(time.Second)

	payload, err := body.FromArgs([]string{file1, file2}, false)
	if err != nil {
		t.Fatal(err)
	}
	server.Send(payload)

	// 1. 模拟设备 A (client_id=deviceA) 首次连接并状态查询，激活设备
	reqStatusA, _ := http.NewRequest(http.MethodGet, server.SendURL+"/status?client_id=deviceA", nil)
	respStatusA, err := http.DefaultClient.Do(reqStatusA)
	if err != nil {
		t.Fatal(err)
	}
	respStatusA.Body.Close()

	// 2. 模拟设备 B (client_id=deviceB) 首次连接并状态查询，激活设备
	reqStatusB, _ := http.NewRequest(http.MethodGet, server.SendURL+"/status?client_id=deviceB", nil)
	respStatusB, err := http.DefaultClient.Do(reqStatusB)
	if err != nil {
		t.Fatal(err)
	}
	respStatusB.Body.Close()

	// 3. 模拟设备 A 下载完第一个文件 (item=0)
	reqDownA0, _ := http.NewRequest(http.MethodGet, server.SendURL+"?download=1&item=0&client_id=deviceA", nil)
	respDownA0, err := http.DefaultClient.Do(reqDownA0)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.ReadAll(respDownA0.Body)
	respDownA0.Body.Close()

	// 4. 模拟设备 A 下载完第二个文件 (item=1) -> 设备 A 下载全部完成！
	reqDownA1, _ := http.NewRequest(http.MethodGet, server.SendURL+"?download=1&item=1&client_id=deviceA", nil)
	respDownA1, err := http.DefaultClient.Do(reqDownA1)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.ReadAll(respDownA1.Body)
	respDownA1.Body.Close()

	// 5. 验证设备 A 发送状态查询时，返回的 State 是否已经为 completed
	reqCheckA, _ := http.NewRequest(http.MethodGet, server.SendURL+"/status?client_id=deviceA", nil)
	respCheckA, err := http.DefaultClient.Do(reqCheckA)
	if err != nil {
		t.Fatal(err)
	}
	var statusA transferStatus
	bodyBytesA, err := io.ReadAll(respCheckA.Body)
	if err != nil {
		t.Fatal(err)
	}
	respCheckA.Body.Close()
	t.Logf("Response body A: %s", string(bodyBytesA))
	err = json.Unmarshal(bodyBytesA, &statusA)
	if err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}

	if statusA.State != "completed" {
		t.Fatalf("Device A state = %q, want completed", statusA.State)
	}

	// 6. 验证设备 B 发送状态查询时，返回的 State 是否依然是 transferring！且 DownloadedItems 不应该包含 A 下载的文件！
	reqCheckB, _ := http.NewRequest(http.MethodGet, server.SendURL+"/status?client_id=deviceB", nil)
	respCheckB, err := http.DefaultClient.Do(reqCheckB)
	if err != nil {
		t.Fatal(err)
	}
	var statusB transferStatus
	bodyBytesB, _ := io.ReadAll(respCheckB.Body)
	respCheckB.Body.Close()
	_ = json.Unmarshal(bodyBytesB, &statusB)

	if statusB.State == "completed" {
		t.Fatalf("Device B state = completed, want NOT completed")
	}
	if len(statusB.DownloadedItems) > 0 {
		t.Fatalf("Device B downloadedItems count = %d, want 0", len(statusB.DownloadedItems))
	}

	// 7. 模拟设备 B 下载完第 0 个文件
	reqDownB0, _ := http.NewRequest(http.MethodGet, server.SendURL+"?download=1&item=0&client_id=deviceB", nil)
	respDownB0, _ := http.DefaultClient.Do(reqDownB0)
	_, _ = io.ReadAll(respDownB0.Body)
	respDownB0.Body.Close()

	// 再次验证设备 B 的 status.DownloadedItems 刚好为 [0]！
	reqCheckB2, _ := http.NewRequest(http.MethodGet, server.SendURL+"/status?client_id=deviceB", nil)
	respCheckB2, err := http.DefaultClient.Do(reqCheckB2)
	if err != nil {
		t.Fatal(err)
	}
	var statusB2 transferStatus
	bodyBytesB2, _ := io.ReadAll(respCheckB2.Body)
	respCheckB2.Body.Close()
	_ = json.Unmarshal(bodyBytesB2, &statusB2)
	if len(statusB2.DownloadedItems) != 1 || statusB2.DownloadedItems[0] != 0 {
		t.Fatalf("Device B2 downloadedItems = %v, want [0]", statusB2.DownloadedItems)
	}

	// 8. 模拟设备 B 下载完第二个文件 (item=1) -> 设备 B 也全部完成！
	reqDownB1, _ := http.NewRequest(http.MethodGet, server.SendURL+"?download=1&item=1&client_id=deviceB", nil)
	respDownB1, err := http.DefaultClient.Do(reqDownB1)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.ReadAll(respDownB1.Body)
	respDownB1.Body.Close()

	// 9. 等待 grace period 之后，验证服务器是否自动关闭！
	time.Sleep(1200 * time.Millisecond)

	finalRequest, err := http.NewRequest(http.MethodGet, server.SendURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	finalResponse, err := http.DefaultClient.Do(finalRequest)
	if err == nil {
		defer finalResponse.Body.Close()
		if finalResponse.StatusCode != http.StatusGone {
			t.Fatalf("server still running after all devices downloaded all items! status = %d", finalResponse.StatusCode)
		}
	}
}

func TestDeviceLimitExceededFreeTier(t *testing.T) {
	t.Setenv("EQT_TESTING", "true")
	SetUsedTransfers(0)
	limiterInstance.SetPaidDetails(false, "", "", "")

	dir := t.TempDir()
	file := filepath.Join(dir, "doc.txt")
	_ = os.WriteFile(file, []byte("test content"), 0644)

	server1, err := New(&config.Config{
		Interface: "any",
		Bind:      "127.0.0.1",
		Port:      0,
		Path:      "task1",
		KeepAlive: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer server1.Shutdown()
	server1.Send(body.Body{Path: file, Filename: "doc.txt"})

	clientID_A := "cli_A"
	clientID_B := "cli_B"
	clientID_C := "cli_C"

	if GetUsedTransfers() != 1 {
		t.Fatalf("used transfers = %d, want 1", GetUsedTransfers())
	}

	if server1.isClientLimitExceeded(clientID_A) {
		t.Fatal("device A should not be limited in first transfer")
	}
	if server1.isClientLimitExceeded(clientID_B) {
		t.Fatal("device B should not be limited in first transfer")
	}
	if server1.isClientLimitExceeded(clientID_C) {
		t.Fatal("device C should not be limited in first transfer")
	}

	// SetUsedTransfers to 5 to simulate quota exceeded state
	SetUsedTransfers(5)

	server2, err := New(&config.Config{
		Interface: "any",
		Bind:      "127.0.0.1",
		Port:      0,
		Path:      "task2",
		KeepAlive: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer server2.Shutdown()
	server2.Send(body.Body{Path: file, Filename: "doc.txt"})

	if server2.isClientLimitExceeded(clientID_A) {
		t.Fatal("device A should be allowed as 1st device")
	}
	server2.clientMutex.Lock()
	server2.clientLastSeen[clientID_A] = time.Now()
	server2.clientMutex.Unlock()

	if server2.isClientLimitExceeded(clientID_B) {
		t.Fatal("device B should be allowed as 2nd device")
	}
	server2.clientMutex.Lock()
	server2.clientLastSeen[clientID_B] = time.Now()
	server2.clientMutex.Unlock()

	if !server2.isClientLimitExceeded(clientID_C) {
		t.Fatal("device C should be limited in second transfer as 3rd device")
	}

	server2.clientMutex.Lock()
	server2.clientLastSeen[clientID_A] = time.Now().Add(-10 * time.Second)
	server2.clientMutex.Unlock()

	if server2.isClientLimitExceeded(clientID_C) {
		t.Fatal("device C should be allowed after device A becomes inactive")
	}
}

func TestIsReceiveClientLimitExceeded(t *testing.T) {
	t.Setenv("EQT_TESTING", "true")
	// Create temporary directory for server
	dir, err := os.MkdirTemp("", "eqrcp-test-receive-limit")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)

	srv, err := New(&config.Config{
		Interface: "any",
		Bind:      "127.0.0.1",
		Port:      0,
		Path:      "receive-limit-test",
		KeepAlive: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Shutdown()
	if err := srv.ReceiveTo(dir); err != nil {
		t.Fatal(err)
	}

	clientID_A := "client_A"
	clientID_B := "client_B"

	// 1. Set UsedReceiveTransfers to 0 (Not exceeded free quota)
	SetUsedReceiveTransfers(0)

	// In this state, there are NO limits (it should never exceed)
	if srv.isReceiveClientLimitExceeded(clientID_A) {
		t.Fatal("device A should not be limited when quota not exceeded")
	}
	srv.clientMutex.Lock()
	srv.clientLastSeen[clientID_A] = time.Now()
	srv.clientMutex.Unlock()

	if srv.isReceiveClientLimitExceeded(clientID_B) {
		t.Fatal("device B should not be limited when quota not exceeded")
	}
	srv.clientMutex.Lock()
	srv.clientLastSeen[clientID_B] = time.Now()
	srv.clientMutex.Unlock()

	clientID_C := "client_C"
	if srv.isReceiveClientLimitExceeded(clientID_C) {
		t.Fatal("device C should not be limited when quota not exceeded")
	}

	// 2. Set UsedReceiveTransfers to 5 (Exceeded free quota)
	SetUsedReceiveTransfers(5)
	srv.clientMutex.Lock()
	delete(srv.clientLastSeen, clientID_B)
	srv.clientMutex.Unlock()

	// Now since quota is exceeded, activeCount >= 1 is exceeded.
	// device A (which is already active) should be allowed (it's the 1 allowed active client)
	if srv.isReceiveClientLimitExceeded(clientID_A) {
		t.Fatal("device A should not be limited as it is already the active device")
	}

	// device B should be limited because device A is active (activeCount == 1 >= 1)
	if !srv.isReceiveClientLimitExceeded(clientID_B) {
		t.Fatal("device B should be limited as device A is already active (quota exceeded)")
	}

	// Make device A inactive
	srv.clientMutex.Lock()
	srv.clientLastSeen[clientID_A] = time.Now().Add(-10 * time.Second)
	srv.clientMutex.Unlock()

	// device B should now be allowed (activeCount == 0 < 1)
	if srv.isReceiveClientLimitExceeded(clientID_B) {
		t.Fatal("device B should not be limited after device A becomes inactive")
	}
}
