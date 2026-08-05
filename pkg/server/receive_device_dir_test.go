package server

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"eqt/pkg/config"
)

func TestSanitizeDeviceID(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"device-123", "device-123"},
		{"device_abc_456", "device_abc_456"},
		{"../../etc/passwd", "etc_passwd"},
		{"device/id:with*invalid?chars", "device_id_with_invalid_chars"},
		{"   ", "unknown"},
		{"...", "unknown"},
	}

	for _, tt := range tests {
		got := sanitizeDeviceID(tt.input)
		if got != tt.want {
			t.Errorf("sanitizeDeviceID(%q) = %q; want %q", tt.input, got, tt.want)
		}
	}
}

func TestReceiveMultipleDevicesSubdirectories(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "eqt_recv_dev_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	cfg := config.Config{
		Interface: "any",
		Bind:      "127.0.0.1",
		KeepAlive: true,
	}
	srv, err := New(&cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Shutdown()

	if err := srv.ReceiveTo(tempDir); err != nil {
		t.Fatal(err)
	}

	uploadFileForDevice := func(clientID, filename, content string) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		part, err := writer.CreateFormFile("file", filename)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = part.Write([]byte(content))
		_ = writer.Close()

		req := httptest.NewRequest("POST", srv.ReceiveURL+"?client_id="+clientID, body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		srv.mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("Device %s upload failed with status %d: %s", clientID, rec.Code, rec.Body.String())
		}
	}

	uploadFileForDevice("dev_phone_a", "photo.png", "phone_a_data")
	uploadFileForDevice("dev_phone_b", "document.pdf", "phone_b_data")

	findDeviceFile := func(clientID, filename string) (string, []byte) {
		shortID := shortDeviceID(sanitizeDeviceID(clientID))
		prefix := "eqt_receive_" + shortID + "_"
		var matchedPath string
		err := filepath.Walk(tempDir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if !info.IsDir() && info.Name() == filename && filepath.Base(filepath.Dir(path)) != "" {
				parentDir := filepath.Base(filepath.Dir(path))
				if len(parentDir) >= len(prefix) && parentDir[:len(prefix)] == prefix {
					matchedPath = path
				}
			}
			return nil
		})
		if err != nil || matchedPath == "" {
			t.Fatalf("Could not find file %s for clientID %s with directory prefix %s", filename, clientID, prefix)
		}
		data, err := os.ReadFile(matchedPath)
		if err != nil {
			t.Fatalf("Failed to read file at %s: %v", matchedPath, err)
		}
		return matchedPath, data
	}

	_, dataA := findDeviceFile("dev_phone_a", "photo.png")
	if string(dataA) != "phone_a_data" {
		t.Fatalf("Device A file content = %q; want %q", string(dataA), "phone_a_data")
	}

	_, dataB := findDeviceFile("dev_phone_b", "document.pdf")
	if string(dataB) != "phone_b_data" {
		t.Fatalf("Device B file content = %q; want %q", string(dataB), "phone_b_data")
	}
}
