package server

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"eqt/pkg/config"
)

func TestThrottledReadSeekerDirect(t *testing.T) {
	tempFile, err := os.CreateTemp("", "test-seek-*.dat")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tempFile.Name())
	defer tempFile.Close()

	content := []byte("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")
	if _, err := tempFile.Write(content); err != nil {
		t.Fatal(err)
	}

	// Re-open for reading
	readFile, err := os.Open(tempFile.Name())
	if err != nil {
		t.Fatal(err)
	}
	defer readFile.Close()

	trs := NewThrottledReadSeeker(readFile, 100000, true)

	// 1. Verify Seek from start
	pos, err := trs.Seek(10, io.SeekStart)
	if err != nil || pos != 10 {
		t.Fatalf("SeekStart failed: pos=%d, err=%v", pos, err)
	}
	buf := make([]byte, 5)
	n, err := trs.Read(buf)
	if err != nil || n != 5 || string(buf) != "ABCDE" {
		t.Fatalf("Read after SeekStart failed: n=%d, got=%s, want=ABCDE", n, string(buf))
	}

	// 2. Verify Seek from current
	pos, err = trs.Seek(5, io.SeekCurrent)
	if err != nil || pos != 20 { // 10 + 5 + 5 = 20
		t.Fatalf("SeekCurrent failed: pos=%d, err=%v", pos, err)
	}
	buf = make([]byte, 4)
	n, err = trs.Read(buf)
	if err != nil || n != 4 || string(buf) != "KLMN" {
		t.Fatalf("Read after SeekCurrent failed: n=%d, got=%s, want=KLMN", n, string(buf))
	}

	// 3. Verify Seek from end
	pos, err = trs.Seek(-5, io.SeekEnd)
	if err != nil || pos != int64(len(content)-5) {
		t.Fatalf("SeekEnd failed: pos=%d, err=%v", pos, err)
	}
	buf = make([]byte, 5)
	n, err = trs.Read(buf)
	if err != nil || n != 5 || string(buf) != "vwxyz" {
		t.Fatalf("Read after SeekEnd failed: n=%d, got=%s, want=vwxyz", n, string(buf))
	}
}

func TestChatAttachmentDownload_RangeAndThrottling(t *testing.T) {
	os.Setenv("EQT_TESTING", "true")
	defer os.Unsetenv("EQT_TESTING")

	// Backup usage file
	usageFile := filepath.Join(config.DefaultConfigDir(), "chat_usage.json")
	var backup []byte
	backupExists := false
	if data, err := os.ReadFile(usageFile); err == nil {
		backup = data
		backupExists = true
		_ = os.Remove(usageFile)
	}
	defer func() {
		SetPaidStatus(false, "", "", "")
		SetUsedSeconds(0)
		if backupExists {
			_ = os.WriteFile(usageFile, backup, 0644)
		} else {
			_ = os.Remove(usageFile)
		}
	}()

	// Setup chat session
	sessionDir := t.TempDir()
	session := &chatSession{
		attachments:     map[string]chatAttachment{},
		subscribers:     map[chan struct{}]struct{}{},
		clients:         map[string]chatClient{},
		dir:             sessionDir,
		attachmentRoute: "/attachments",
		startedAt:       time.Now(),
		lastActivity:    time.Now(),
	}

	// Generate 1024 bytes test payload: "0000: ... \n"
	var payload bytes.Buffer
	for i := 0; i < 64; i++ {
		payload.WriteString(fmt.Sprintf("%04d: ABCDEFGHIJKLMNOP\n", i)) // 22 bytes * 64 = 1408 bytes
	}
	data := payload.Bytes()
	totalSize := int64(len(data))

	msg, err := session.saveAttachment("sender-1", "token-1", "media.mp4", "video/mp4", totalSize, bytes.NewReader(data))
	if err != nil {
		t.Fatalf("saveAttachment failed: %v", err)
	}
	attID := msg.ID
	if attID == "" {
		t.Fatalf("expected non-empty AttachmentID")
	}

	// Helper to send download requests
	downloadReq := func(rangeHeader string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/attachments/"+attID, nil)
		if rangeHeader != "" {
			req.Header.Set("Range", rangeHeader)
		}
		rec := httptest.NewRecorder()
		session.handleAttachmentDownload(rec, req)
		return rec
	}

	// -------------------------------------------------------------
	// 1. Normal Mode (Unrestricted / Paid)
	// -------------------------------------------------------------
	SetPaidStatus(true, "", "", "PLUS")
	SetUsedSeconds(0)

	// 1.1 Full download
	rec := downloadReq("")
	if rec.Code != http.StatusOK {
		t.Fatalf("normal full download: expected 200 OK, got %d", rec.Code)
	}
	if !bytes.Equal(rec.Body.Bytes(), data) {
		t.Fatalf("normal full download: body mismatch")
	}

	// 1.2 Range download (bytes=100-199)
	rec = downloadReq("bytes=100-199")
	if rec.Code != http.StatusPartialContent {
		t.Fatalf("normal range: expected 206 Partial Content, got %d", rec.Code)
	}
	contentRange := rec.Header().Get("Content-Range")
	expectedRange := fmt.Sprintf("bytes 100-199/%d", totalSize)
	if contentRange != expectedRange {
		t.Fatalf("normal range: Content-Range got %q, want %q", contentRange, expectedRange)
	}
	if !bytes.Equal(rec.Body.Bytes(), data[100:200]) {
		t.Fatalf("normal range: body mismatch")
	}

	// -------------------------------------------------------------
	// 2. Degraded / Throttled Mode (Free quota exhausted)
	// -------------------------------------------------------------
	SetPaidStatus(false, "", "", "")
	SetUsedSeconds(FreeChatDailySeconds)
	if !FreeChatDegraded() {
		t.Fatal("expected FreeChatDegraded() to be true")
	}

	// 2.1 Full download under rate limiting -> 200 OK, full body
	rec = downloadReq("")
	if rec.Code != http.StatusOK {
		t.Fatalf("throttled full download: expected 200 OK, got %d", rec.Code)
	}
	if !bytes.Equal(rec.Body.Bytes(), data) {
		t.Fatalf("throttled full download: body mismatch")
	}

	// 2.2 Range download under rate limiting -> MUST be 206 Partial Content (NOT 200 OK!)
	rec = downloadReq("bytes=200-299")
	if rec.Code != http.StatusPartialContent {
		t.Fatalf("throttled range: expected 206 Partial Content, got %d (RFC 7233 violation regression!)", rec.Code)
	}
	contentRange = rec.Header().Get("Content-Range")
	expectedRange = fmt.Sprintf("bytes 200-299/%d", totalSize)
	if contentRange != expectedRange {
		t.Fatalf("throttled range: Content-Range got %q, want %q", contentRange, expectedRange)
	}
	if rec.Header().Get("Content-Length") != "100" {
		t.Fatalf("throttled range: Content-Length got %q, want 100", rec.Header().Get("Content-Length"))
	}
	if !bytes.Equal(rec.Body.Bytes(), data[200:300]) {
		t.Fatalf("throttled range: body mismatch")
	}

	// 2.3 Safari / Media Player probe request (bytes=0-1)
	rec = downloadReq("bytes=0-1")
	if rec.Code != http.StatusPartialContent {
		t.Fatalf("Safari probe: expected 206 Partial Content, got %d", rec.Code)
	}
	expectedProbeRange := fmt.Sprintf("bytes 0-1/%d", totalSize)
	if rec.Header().Get("Content-Range") != expectedProbeRange {
		t.Fatalf("Safari probe: Content-Range got %q, want %q", rec.Header().Get("Content-Range"), expectedProbeRange)
	}
	if rec.Header().Get("Content-Length") != "2" {
		t.Fatalf("Safari probe: Content-Length got %q, want 2", rec.Header().Get("Content-Length"))
	}
	if !bytes.Equal(rec.Body.Bytes(), data[0:2]) {
		t.Fatalf("Safari probe: body mismatch")
	}

	// 2.4 Seek to tail / resume download (bytes=1000-)
	rec = downloadReq("bytes=1000-")
	if rec.Code != http.StatusPartialContent {
		t.Fatalf("Seek to tail: expected 206 Partial Content, got %d", rec.Code)
	}
	expectedTailRange := fmt.Sprintf("bytes 1000-%d/%d", totalSize-1, totalSize)
	if rec.Header().Get("Content-Range") != expectedTailRange {
		t.Fatalf("Seek to tail: Content-Range got %q, want %q", rec.Header().Get("Content-Range"), expectedTailRange)
	}
	if rec.Header().Get("Content-Length") != fmt.Sprintf("%d", totalSize-1000) {
		t.Fatalf("Seek to tail: Content-Length got %q, want %d", rec.Header().Get("Content-Length"), totalSize-1000)
	}
	if !bytes.Equal(rec.Body.Bytes(), data[1000:]) {
		t.Fatalf("Seek to tail: body mismatch")
	}

	// 2.5 Out of range request (bytes=5000-6000) -> 416 Range Not Satisfiable
	rec = downloadReq("bytes=5000-6000")
	if rec.Code != http.StatusRequestedRangeNotSatisfiable {
		t.Fatalf("Out of range: expected 416 Range Not Satisfiable, got %d", rec.Code)
	}
	expectedUnsatRange := fmt.Sprintf("bytes */%d", totalSize)
	if rec.Header().Get("Content-Range") != expectedUnsatRange {
		t.Fatalf("Out of range: Content-Range got %q, want %q", rec.Header().Get("Content-Range"), expectedUnsatRange)
	}
}

func TestSafariMediaStreamingWorkflow(t *testing.T) {
	os.Setenv("EQT_TESTING", "true")
	defer os.Unsetenv("EQT_TESTING")
	defer func() {
		SetPaidStatus(false, "", "", "")
		SetUsedSeconds(0)
	}()

	sessionDir := t.TempDir()
	session := &chatSession{
		attachments:     map[string]chatAttachment{},
		subscribers:     map[chan struct{}]struct{}{},
		clients:         map[string]chatClient{},
		dir:             sessionDir,
		attachmentRoute: "/attachments",
		startedAt:       time.Now(),
		lastActivity:    time.Now(),
	}

	// 2048 bytes media payload
	data := make([]byte, 2048)
	for i := range data {
		data[i] = byte((i * 17) % 256)
	}
	totalSize := int64(len(data))

	msg, err := session.saveAttachment("sender-safari", "token-safari", "sample_video.mov", "video/quicktime", totalSize, bytes.NewReader(data))
	if err != nil {
		t.Fatalf("saveAttachment failed: %v", err)
	}

	// Enter degraded/throttled state
	SetPaidStatus(false, "", "", "")
	SetUsedSeconds(FreeChatDailySeconds)

	safariUA := "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

	runSafariReq := func(rangeHeader string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/attachments/"+msg.ID, nil)
		req.Header.Set("User-Agent", safariUA)
		if rangeHeader != "" {
			req.Header.Set("Range", rangeHeader)
		}
		rec := httptest.NewRecorder()
		session.handleAttachmentDownload(rec, req)
		return rec
	}

	// Step 1: Initial 2-byte probe
	rec1 := runSafariReq("bytes=0-1")
	if rec1.Code != http.StatusPartialContent {
		t.Fatalf("Safari step 1 probe: expected 206, got %d", rec1.Code)
	}
	if rec1.Header().Get("Accept-Ranges") != "bytes" {
		t.Fatalf("Safari step 1 probe: expected Accept-Ranges: bytes, got %q", rec1.Header().Get("Accept-Ranges"))
	}
	if !bytes.Equal(rec1.Body.Bytes(), data[0:2]) {
		t.Fatalf("Safari step 1 probe: body mismatch")
	}

	// Step 2: Metadata / Moov header fetch
	rec2 := runSafariReq("bytes=0-511")
	if rec2.Code != http.StatusPartialContent {
		t.Fatalf("Safari step 2 metadata: expected 206, got %d", rec2.Code)
	}
	if rec2.Header().Get("Content-Range") != fmt.Sprintf("bytes 0-511/%d", totalSize) {
		t.Fatalf("Safari step 2 metadata: Content-Range mismatch: %s", rec2.Header().Get("Content-Range"))
	}
	if !bytes.Equal(rec2.Body.Bytes(), data[0:512]) {
		t.Fatalf("Safari step 2 metadata: body mismatch")
	}

	// Step 3: User seeks to timeline middle (bytes=1024-1535)
	rec3 := runSafariReq("bytes=1024-1535")
	if rec3.Code != http.StatusPartialContent {
		t.Fatalf("Safari step 3 seek: expected 206, got %d", rec3.Code)
	}
	if rec3.Header().Get("Content-Range") != fmt.Sprintf("bytes 1024-1535/%d", totalSize) {
		t.Fatalf("Safari step 3 seek: Content-Range mismatch: %s", rec3.Header().Get("Content-Range"))
	}
	if !bytes.Equal(rec3.Body.Bytes(), data[1024:1536]) {
		t.Fatalf("Safari step 3 seek: body mismatch")
	}
}
