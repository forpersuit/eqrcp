package server

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"eqrcp/body"
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
		URL          string
		QRImageRoute string
		StatusRoute  string
		StopRoute    string
	}{
		URL:          `http://127.0.0.1:8080/send/a?name="quoted"`,
		QRImageRoute: "/qr/image",
		StatusRoute:  "/qr/status",
		StopRoute:    "/qr/stop",
	}

	if err := serveTemplate("qr", pages.QR, &out, data); err != nil {
		t.Fatalf("serveTemplate() error = %v", err)
	}
	html := out.String()
	for _, want := range []string{
		`src="/qr/image"`,
		`action="/qr/stop"`,
		`fetch('\/qr\/status'`,
		"Copy URL",
		"Stop transfer",
		`id="transfer-progress"`,
		`id="saved-files"`,
		`renderSavedFiles(data.savedFiles || [])`,
		`formatBytes(done)`,
		"Waiting for a device to connect.",
		`name=&#34;quoted&#34;`,
	} {
		if !strings.Contains(html, want) {
			t.Fatalf("QR page = %q, want to contain %q", html, want)
		}
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
	server.Send(body.Body{Path: path, Filename: "report.txt"})

	got := server.getStatus()
	if got.Mode != "send" || got.Title != "Share file" || got.Target != "report.txt" {
		t.Fatalf("getStatus() = %#v", got)
	}
	if got.BytesTotal != 5 {
		t.Fatalf("BytesTotal = %d, want 5", got.BytesTotal)
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
		"report.txt":               "Share file",
		"photos-directory.zip":     "Share directory",
		"eqrcp-multiple-files.zip": "Share multiple files",
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
