package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"eqrcp/body"
	"eqrcp/config"
	"eqrcp/pages"
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
		QRImageRoute:     "/qr/image",
		StatusRoute:      "/qr/status",
		EventsRoute:      "/qr/events",
		StopRoute:        "/qr/stop",
		RepeatRoute:      "http://127.0.0.1:48176/tasks/7/repeat",
		AgentStatusRoute: "http://127.0.0.1:48176/status",
		AgentTaskID:      "7",
		HasAgentStatus:   true,
		Version:          "eqrcp test [date: now]",
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
		`Version: eqrcp test [date: now]`,
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
		QRImageRoute: "/qr/image",
		StatusRoute:  "/qr/status",
		EventsRoute:  "/qr/events",
		StopRoute:    "/qr/stop",
		Version:      "eqrcp test [date: now]",
	}

	if err := serveTemplate("qr", pages.QR, &out, data); err != nil {
		t.Fatalf("serveTemplate() error = %v", err)
	}
	if strings.Contains(out.String(), "Transfer again") {
		t.Fatalf("QR page = %q, want no repeat action without route", out.String())
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
		status.Target = "eqrcp-multiple-files.zip"
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
	if status.State != "completed" || status.Target != "eqrcp-multiple-files.zip" {
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
	server.ReceiveTo(server.outputDir)

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
		File  string
		Files []string
		Count int
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
		"Upload complete",
		"2 files were sent to this device.",
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
	path := filepath.Join(t.TempDir(), "eqrcp-multiple-files-20260422-010203.zip")
	if err := os.WriteFile(path, []byte("zip"), 0644); err != nil {
		t.Fatal(err)
	}
	server := &Server{}
	server.Send(body.Body{
		Path:     path,
		Filename: "eqrcp-multiple-files-20260422-010203.zip",
		Archive:  true,
		Items:    []string{"one.txt", "two.txt"},
	})

	got := server.getStatus()
	if got.Mode != "send" || got.Title != "Share multiple files" {
		t.Fatalf("getStatus() = %#v", got)
	}
	if !got.Archive || got.ArchiveName != "eqrcp-multiple-files-20260422-010203.zip" {
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
		"eqrcp-multiple-files-20260422-010203.zip": "Share multiple files",
		"eqrcp-multiple-files.zip":                 "Share file",
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
