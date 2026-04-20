package server

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

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
		"Waiting for a device to connect.",
		`name=&#34;quoted&#34;`,
	} {
		if !strings.Contains(html, want) {
			t.Fatalf("QR page = %q, want to contain %q", html, want)
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
