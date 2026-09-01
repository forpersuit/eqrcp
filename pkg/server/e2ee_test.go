package server

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"eqt/pkg/body"
	"eqt/pkg/config"
	"eqt/pkg/crypto/e2ee"
)

func TestE2EEReceiveMultiChunkConcurrentWrite(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "eqt-e2ee-receive-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	cfg := &config.Config{
		Interface: "lo",
		Port:      0,
		Bind:      "127.0.0.1",
		KeepAlive: true,
	}
	srv, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if err := srv.ReceiveTo(tempDir); err != nil {
		t.Fatal(err)
	}

	masterKey, err := e2ee.GenerateMasterKey()
	if err != nil {
		t.Fatal(err)
	}
	if err := srv.EnableE2EE(masterKey, "sess-test-123"); err != nil {
		t.Fatal(err)
	}

	keys, _ := e2ee.DeriveKeys(masterKey)

	// Create a 9.5 MB payload (Chunk 0: 4MB, Chunk 1: 4MB, Chunk 2: 1.5MB)
	totalBytes := int64(9*1024*1024 + 512*1024)
	originalData := make([]byte, totalBytes)
	_, _ = rand.Read(originalData)

	fileID := "file-e2ee-test-9mb"
	fileName := "large_document.bin"
	totalChunks := uint32(3)

	chunk0Data := originalData[0 : 4*1024*1024]
	chunk1Data := originalData[4*1024*1024 : 8*1024*1024]
	chunk2Data := originalData[8*1024*1024:]

	enc0, err := e2ee.EncryptChunk(chunk0Data, 0, keys.RecvKey[:], fileID)
	if err != nil {
		t.Fatal(err)
	}
	enc1, err := e2ee.EncryptChunk(chunk1Data, 1, keys.RecvKey[:], fileID)
	if err != nil {
		t.Fatal(err)
	}
	enc2, err := e2ee.EncryptChunk(chunk2Data, 2, keys.RecvKey[:], fileID)
	if err != nil {
		t.Fatal(err)
	}

	chunks := []struct {
		idx  uint32
		data []byte
	}{
		{idx: 2, data: enc2}, // upload chunk 2 first (out-of-order)
		{idx: 0, data: enc0}, // then chunk 0
		{idx: 1, data: enc1}, // then chunk 1
	}

	clientID := "client-mobile-tester"

	// Upload chunks concurrently in parallel goroutines to test lock-free WriteAt
	var wg sync.WaitGroup
	errCh := make(chan error, len(chunks))

	for _, c := range chunks {
		wg.Add(1)
		go func(chunkIdx uint32, encData []byte) {
			defer wg.Done()

			req := httptest.NewRequest("POST", srv.ReceiveURL+"/chunk", bytes.NewReader(encData))
			req.Header.Set("X-File-ID", fileID)
			req.Header.Set("X-Chunk-Index", fmt.Sprintf("%d", chunkIdx))
			req.Header.Set("X-Total-Chunks", fmt.Sprintf("%d", totalChunks))
			req.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", totalBytes))
			req.Header.Set("X-File-Name", fileName)
			req.Header.Set("X-Client-ID", clientID)

			w := httptest.NewRecorder()
			srv.handleE2EEReceiveChunk(w, req)

			resp := w.Result()
			if resp.StatusCode != http.StatusOK {
				body, _ := io.ReadAll(resp.Body)
				errCh <- fmt.Errorf("chunk %d upload failed with status %d: %s", chunkIdx, resp.StatusCode, string(body))
				return
			}
		}(c.idx, c.data)
	}

	wg.Wait()
	close(errCh)

	for err := range errCh {
		t.Fatal(err)
	}

	// Query chunk status
	statusReq := httptest.NewRequest("GET", srv.ReceiveURL+"/chunk_status?file_id="+fileID+"&client_id="+clientID, nil)
	wStatus := httptest.NewRecorder()
	srv.handleE2EEReceiveChunkStatus(wStatus, statusReq)

	var statusRes struct {
		OK              bool       `json:"ok"`
		ContinuousIndex uint32     `json:"continuous_index"`
		Completed       bool       `json:"completed"`
		ReceivedRanges  [][]uint32 `json:"received_ranges"`
	}
	json.NewDecoder(wStatus.Body).Decode(&statusRes)

	if !statusRes.OK || !statusRes.Completed || statusRes.ContinuousIndex != 3 {
		t.Fatalf("unexpected chunk status response: %+v", statusRes)
	}

	// Verify the final file on disk
	outputDir, _ := srv.getDeviceOutputDir(clientID)
	finalFilePath := filepath.Join(outputDir, fileName)
	savedData, err := os.ReadFile(finalFilePath)
	if err != nil {
		t.Fatalf("failed to read saved file %s: %v", finalFilePath, err)
	}

	if int64(len(savedData)) != totalBytes {
		t.Fatalf("saved file size = %d; want %d", len(savedData), totalBytes)
	}

	if !bytes.Equal(savedData, originalData) {
		t.Fatal("saved file contents do not match original plaintext!")
	}
}

func TestE2EEReceiveTamperedChunkRejection(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "eqt-e2ee-tamper-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	cfg := &config.Config{Interface: "lo", Port: 0, Bind: "127.0.0.1", KeepAlive: true}
	srv, _ := New(cfg)
	_ = srv.ReceiveTo(tempDir)

	masterKey, _ := e2ee.GenerateMasterKey()
	_ = srv.EnableE2EE(masterKey, "sess-tamper")
	keys, _ := e2ee.DeriveKeys(masterKey)

	fileID := "file-tamper-test"
	plain := []byte("Sensitive data chunk")
	enc, _ := e2ee.EncryptChunk(plain, 0, keys.RecvKey[:], fileID)

	// Tamper 1 byte in ciphertext
	enc[len(enc)-5] ^= 0xFF

	req := httptest.NewRequest("POST", srv.ReceiveURL+"/chunk", bytes.NewReader(enc))
	req.Header.Set("X-File-ID", fileID)
	req.Header.Set("X-Chunk-Index", "0")
	req.Header.Set("X-Total-Chunks", "1")
	req.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", len(plain)))
	req.Header.Set("X-File-Name", "tampered.txt")
	req.Header.Set("X-Client-ID", "client-attacker")

	w := httptest.NewRecorder()
	srv.handleE2EEReceiveChunk(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request on tampered chunk, got %d", resp.StatusCode)
	}

	var errRes struct {
		OK        bool   `json:"ok"`
		ErrorCode string `json:"error_code"`
	}
	json.NewDecoder(resp.Body).Decode(&errRes)
	if errRes.ErrorCode != "AUTH_FAILED" {
		t.Fatalf("expected AUTH_FAILED error code, got %+v", errRes)
	}
}

func TestE2EEReceiveSilentBanAndPurgeTmpFile(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "eqt-e2ee-ban-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	cfg := &config.Config{Interface: "lo", Port: 0, Bind: "127.0.0.1", KeepAlive: true}
	srv, _ := New(cfg)
	_ = srv.ReceiveTo(tempDir)

	masterKey, _ := e2ee.GenerateMasterKey()
	_ = srv.EnableE2EE(masterKey, "sess-ban")
	keys, _ := e2ee.DeriveKeys(masterKey)

	clientID := "client-bad-guy"
	fileID := "file-ban-test"
	plain0 := make([]byte, 4*1024*1024)
	enc0, _ := e2ee.EncryptChunk(plain0, 0, keys.RecvKey[:], fileID)

	// 1. Upload chunk 0 of 2
	req0 := httptest.NewRequest("POST", srv.ReceiveURL+"/chunk", bytes.NewReader(enc0))
	req0.Header.Set("X-File-ID", fileID)
	req0.Header.Set("X-Chunk-Index", "0")
	req0.Header.Set("X-Total-Chunks", "2")
	req0.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", 8*1024*1024))
	req0.Header.Set("X-File-Name", "in_progress.bin")
	req0.Header.Set("X-Client-ID", clientID)

	w0 := httptest.NewRecorder()
	srv.handleE2EEReceiveChunk(w0, req0)
	if w0.Code != http.StatusOK {
		t.Fatalf("chunk 0 upload failed: %d", w0.Code)
	}

	// Verify .tmp file exists on disk
	outputDir, _ := srv.getDeviceOutputDir(clientID)
	tmpPath := filepath.Join(outputDir, "in_progress.bin.tmp")
	if _, err := os.Stat(tmpPath); os.IsNotExist(err) {
		t.Fatalf("expected .tmp file %s to exist before ban", tmpPath)
	}

	// 2. Ban the client
	srv.BanClient(clientID)
	if !srv.IsClientBanned(clientID) {
		t.Fatal("expected client to be banned")
	}

	// Red Line §7.5: .tmp file MUST be deleted from disk immediately
	if _, err := os.Stat(tmpPath); !os.IsNotExist(err) {
		t.Fatalf("expected .tmp file %s to be deleted upon ban, but it still exists!", tmpPath)
	}

	// 3. Upload chunk 1 should be rejected with 403 Forbidden
	enc1, _ := e2ee.EncryptChunk(plain0, 1, keys.RecvKey[:], fileID)
	req1 := httptest.NewRequest("POST", srv.ReceiveURL+"/chunk", bytes.NewReader(enc1))
	req1.Header.Set("X-File-ID", fileID)
	req1.Header.Set("X-Chunk-Index", "1")
	req1.Header.Set("X-Total-Chunks", "2")
	req1.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", 8*1024*1024))
	req1.Header.Set("X-File-Name", "in_progress.bin")
	req1.Header.Set("X-Client-ID", clientID)

	w1 := httptest.NewRecorder()
	srv.handleE2EEReceiveChunk(w1, req1)
	if w1.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for banned client, got %d", w1.Code)
	}

	// 4. Unban client and check status reset to M=0
	srv.UnbanClient(clientID)
	if srv.IsClientBanned(clientID) {
		t.Fatal("expected client to be unbanned")
	}

	statusReq := httptest.NewRequest("GET", srv.ReceiveURL+"/chunk_status?file_id="+fileID+"&client_id="+clientID, nil)
	wStatus := httptest.NewRecorder()
	srv.handleE2EEReceiveChunkStatus(wStatus, statusReq)

	var statusRes struct {
		ContinuousIndex uint32 `json:"continuous_index"`
	}
	json.NewDecoder(wStatus.Body).Decode(&statusRes)
	if statusRes.ContinuousIndex != 0 {
		t.Fatalf("expected continuous_index to reset to 0 after unban, got %d", statusRes.ContinuousIndex)
	}
}

func TestContinuousRangesComputation(t *testing.T) {
	// Case 1: Empty
	m, ranges := computeContinuousRanges(nil)
	if m != 0 || len(ranges) != 0 {
		t.Fatalf("empty test failed: m=%d, ranges=%v", m, ranges)
	}

	// Case 2: Continuous 0, 1, 2
	m, ranges = computeContinuousRanges(map[uint32]bool{0: true, 1: true, 2: true})
	if m != 3 || len(ranges) != 1 || ranges[0][0] != 0 || ranges[0][1] != 2 {
		t.Fatalf("continuous test failed: m=%d, ranges=%v", m, ranges)
	}

	// Case 3: Hole at chunk 2 (0, 1, 3, 4)
	m, ranges = computeContinuousRanges(map[uint32]bool{0: true, 1: true, 3: true, 4: true})
	if m != 2 || len(ranges) != 2 {
		t.Fatalf("hole test failed: m=%d, ranges=%v", m, ranges)
	}
	if ranges[0][0] != 0 || ranges[0][1] != 1 || ranges[1][0] != 3 || ranges[1][1] != 4 {
		t.Fatalf("hole ranges mismatch: %+v", ranges)
	}
}

func TestE2EEShareMultiChunkDownload(t *testing.T) {
	tempFile, err := os.CreateTemp("", "eqt-share-test-*.bin")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tempFile.Name())

	// Create 6MB payload (2 chunks: 4MB + 2MB)
	testPayload := make([]byte, 6*1024*1024)
	_, _ = rand.Read(testPayload)
	_, _ = tempFile.Write(testPayload)
	_ = tempFile.Close()

	cfg := &config.Config{Interface: "lo", Port: 0, Bind: "127.0.0.1", KeepAlive: true}
	srv, _ := New(cfg)
	b, err := body.FromArgs([]string{tempFile.Name()}, false)
	if err != nil {
		t.Fatal(err)
	}
	srv.Send(b)

	masterKey, _ := e2ee.GenerateMasterKey()
	_ = srv.EnableE2EE(masterKey, "sess-share-test")
	keys, _ := e2ee.DeriveKeys(masterKey)

	// 1. Check meta
	metaReq := httptest.NewRequest("GET", srv.SendURL+"/meta", nil)
	wMeta := httptest.NewRecorder()
	srv.handleE2EEShareMeta(wMeta, metaReq)

	var metaRes struct {
		OK        bool                `json:"ok"`
		IsE2EE    bool                `json:"is_e2ee"`
		SessionID string              `json:"session_id"`
		Files     []E2EEShareFileInfo `json:"files"`
	}
	json.NewDecoder(wMeta.Body).Decode(&metaRes)

	if !metaRes.OK || !metaRes.IsE2EE || len(metaRes.Files) != 1 {
		t.Fatalf("unexpected meta response: %+v", metaRes)
	}
	if metaRes.Files[0].TotalChunks != 2 || metaRes.Files[0].FileSize != 6*1024*1024 {
		t.Fatalf("unexpected file info: %+v", metaRes.Files[0])
	}

	// 2. Fetch Chunk 0
	chunk0Req := httptest.NewRequest("GET", srv.SendURL+"/chunk?file_id=f-0&chunk_index=0", nil)
	wChunk0 := httptest.NewRecorder()
	srv.handleE2EEShareChunk(wChunk0, chunk0Req)
	if wChunk0.Code != http.StatusOK {
		t.Fatalf("fetch chunk 0 failed: %d", wChunk0.Code)
	}

	plain0, err := e2ee.DecryptChunk(wChunk0.Body.Bytes(), 0, keys.SendKey[:], "f-0")
	if err != nil {
		t.Fatalf("decrypt chunk 0 failed: %v", err)
	}
	if !bytes.Equal(plain0, testPayload[0:4*1024*1024]) {
		t.Fatal("chunk 0 plaintext mismatch")
	}

	// 3. Fetch Chunk 1
	chunk1Req := httptest.NewRequest("GET", srv.SendURL+"/chunk?file_id=f-0&chunk_index=1", nil)
	wChunk1 := httptest.NewRecorder()
	srv.handleE2EEShareChunk(wChunk1, chunk1Req)
	if wChunk1.Code != http.StatusOK {
		t.Fatalf("fetch chunk 1 failed: %d", wChunk1.Code)
	}

	plain1, err := e2ee.DecryptChunk(wChunk1.Body.Bytes(), 1, keys.SendKey[:], "f-0")
	if err != nil {
		t.Fatalf("decrypt chunk 1 failed: %v", err)
	}
	if !bytes.Equal(plain1, testPayload[4*1024*1024:]) {
		t.Fatal("chunk 1 plaintext mismatch")
	}
}

func TestE2EEShareBannedClientBlocked(t *testing.T) {
	tempFile, err := os.CreateTemp("", "eqt-share-ban-test-*.bin")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tempFile.Name())
	_, _ = tempFile.Write([]byte("Protected secret"))
	_ = tempFile.Close()

	cfg := &config.Config{Interface: "lo", Port: 0, Bind: "127.0.0.1", KeepAlive: true}
	srv, _ := New(cfg)
	b, err := body.FromArgs([]string{tempFile.Name()}, false)
	if err != nil {
		t.Fatal(err)
	}
	srv.Send(b)

	masterKey, _ := e2ee.GenerateMasterKey()
	_ = srv.EnableE2EE(masterKey, "sess-share-ban")

	clientID := "bad-mobile-client"
	srv.BanClient(clientID)

	chunkReq := httptest.NewRequest("GET", srv.SendURL+"/chunk?file_id=f-0&chunk_index=0", nil)
	chunkReq.Header.Set("X-Client-ID", clientID)
	wChunk := httptest.NewRecorder()
	srv.handleE2EEShareChunk(wChunk, chunkReq)

	if wChunk.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for banned client, got %d", wChunk.Code)
	}
}

func TestE2EEReceiveRetrySameFileID(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "eqt-retry-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	cfg := &config.Config{Interface: "lo", Port: 0, Bind: "127.0.0.1", KeepAlive: true}
	srv, _ := New(cfg)
	_ = srv.ReceiveTo(tempDir)

	masterKey, _ := e2ee.GenerateMasterKey()
	_ = srv.EnableE2EE(masterKey, "sess-retry-test")
	keys, _ := e2ee.DeriveKeys(masterKey)

	fileID := "file-retry-id-123"
	plain := []byte("Initial transfer content")
	enc, _ := e2ee.EncryptChunk(plain, 0, keys.RecvKey[:], fileID)

	// First upload: complete file
	req1 := httptest.NewRequest("POST", srv.ReceiveURL+"/chunk", bytes.NewReader(enc))
	req1.Header.Set("X-File-ID", fileID)
	req1.Header.Set("X-Chunk-Index", "0")
	req1.Header.Set("X-Total-Chunks", "1")
	req1.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", len(plain)))
	req1.Header.Set("X-File-Name", "file.txt")
	req1.Header.Set("X-Client-ID", "retry-client")

	w1 := httptest.NewRecorder()
	srv.handleE2EEReceiveChunk(w1, req1)
	if w1.Code != http.StatusOK {
		t.Fatalf("first upload failed: %d", w1.Code)
	}

	// Second upload reusing same fileID (e.g. user retries): MUST NOT return 403
	plain2 := []byte("Second transfer content")
	enc2, _ := e2ee.EncryptChunk(plain2, 0, keys.RecvKey[:], fileID)

	req2 := httptest.NewRequest("POST", srv.ReceiveURL+"/chunk", bytes.NewReader(enc2))
	req2.Header.Set("X-File-ID", fileID)
	req2.Header.Set("X-Chunk-Index", "0")
	req2.Header.Set("X-Total-Chunks", "1")
	req2.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", len(plain2)))
	req2.Header.Set("X-File-Name", "file.txt")
	req2.Header.Set("X-Client-ID", "retry-client")

	w2 := httptest.NewRecorder()
	srv.handleE2EEReceiveChunk(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("second upload with same fileID failed with code %d (expected 200, must not return 403): %s", w2.Code, w2.Body.String())
	}
}

func TestE2EEShareArchiveDirectory(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "eqt-share-dir-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	f1 := filepath.Join(tempDir, "a.txt")
	_ = os.WriteFile(f1, []byte("file a content"), 0644)
	f2 := filepath.Join(tempDir, "b.txt")
	_ = os.WriteFile(f2, []byte("file b content"), 0644)

	cfg := &config.Config{Interface: "lo", Port: 0, Bind: "127.0.0.1", KeepAlive: true}
	srv, _ := New(cfg)
	b, err := body.FromArgs([]string{tempDir}, true)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Delete()
	srv.Send(b)

	masterKey, _ := e2ee.GenerateMasterKey()
	_ = srv.EnableE2EE(masterKey, "sess-share-dir")
	keys, _ := e2ee.DeriveKeys(masterKey)

	// Meta
	metaReq := httptest.NewRequest("GET", srv.SendURL+"/meta", nil)
	wMeta := httptest.NewRecorder()
	srv.handleE2EEShareMeta(wMeta, metaReq)

	var metaRes struct {
		OK    bool                `json:"ok"`
		Files []E2EEShareFileInfo `json:"files"`
	}
	json.NewDecoder(wMeta.Body).Decode(&metaRes)
	if !metaRes.OK || len(metaRes.Files) != 1 {
		t.Fatalf("unexpected meta for directory: %+v", metaRes)
	}

	// Fetch chunk 0
	chunkReq := httptest.NewRequest("GET", srv.SendURL+"/chunk?file_id=f-0&chunk_index=0", nil)
	wChunk := httptest.NewRecorder()
	srv.handleE2EEShareChunk(wChunk, chunkReq)
	if wChunk.Code != http.StatusOK {
		t.Fatalf("fetch directory chunk failed: %d, body: %s", wChunk.Code, wChunk.Body.String())
	}

	plain, err := e2ee.DecryptChunk(wChunk.Body.Bytes(), 0, keys.SendKey[:], "f-0")
	if err != nil {
		t.Fatalf("decrypt directory chunk failed: %v", err)
	}
	if len(plain) == 0 {
		t.Fatal("empty decrypted archive chunk")
	}
}

func TestE2EEReceiveStaleCleanup(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "eqt-stale-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	cfg := &config.Config{Interface: "lo", Port: 0, Bind: "127.0.0.1", KeepAlive: true}
	srv, _ := New(cfg)
	_ = srv.ReceiveTo(tempDir)

	masterKey, _ := e2ee.GenerateMasterKey()
	_ = srv.EnableE2EE(masterKey, "sess-stale-cleanup")
	keys, _ := e2ee.DeriveKeys(masterKey)

	// Create a physical stale .tmp file
	staleTmpPath := filepath.Join(tempDir, "stale-upload.tmp")
	staleFile, err := os.OpenFile(staleTmpPath, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = staleFile.WriteString("stale chunk data")

	// Inject a stale entry (created 35 minutes ago)
	srv.e2eeReceiveFilesMu.Lock()
	if srv.e2eeReceiveFiles == nil {
		srv.e2eeReceiveFiles = make(map[string]*e2eeReceiveFile)
	}
	staleRf := &e2eeReceiveFile{
		FileID:    "stale-file-123",
		FileName:  "stale-upload.dat",
		TempPath:  staleTmpPath,
		FinalPath: filepath.Join(tempDir, "stale-upload.dat"),
		File:      staleFile,
		CreatedAt: time.Now().Add(-35 * time.Minute),
	}
	srv.e2eeReceiveFiles["stale-file-123"] = staleRf
	srv.e2eeReceiveFilesMu.Unlock()

	// Verify that the stale file exists before cleanup
	if _, err := os.Stat(staleTmpPath); err != nil {
		t.Fatalf("expected stale tmp file to exist before request: %v", err)
	}

	// Trigger a normal chunk request which runs the stale purge
	validPayload := []byte("hello fresh chunk")
	encChunk, err := e2ee.EncryptChunk(validPayload, 0, keys.RecvKey[:], "fresh-file-456")
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("POST", srv.ReceiveURL+"/chunk", bytes.NewReader(encChunk))
	req.Header.Set("X-File-ID", "fresh-file-456")
	req.Header.Set("X-Chunk-Index", "0")
	req.Header.Set("X-Total-Chunks", "1")
	req.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", len(validPayload)))
	req.Header.Set("X-File-Name", "fresh.dat")
	req.Header.Set("X-Client-ID", "client-test")

	w := httptest.NewRecorder()
	srv.handleE2EEReceiveChunk(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", w.Code)
	}

	// Verify that the stale entry was removed from map
	srv.e2eeReceiveFilesMu.Lock()
	_, stillExists := srv.e2eeReceiveFiles["stale-file-123"]
	srv.e2eeReceiveFilesMu.Unlock()

	if stillExists {
		t.Fatal("expected stale entry to be purged from map")
	}

	// Verify that stale file handle was closed, Cancelled set, and .tmp removed from disk
	staleRf.mu.Lock()
	if staleRf.File != nil {
		t.Fatal("expected stale file handle to be set to nil")
	}
	if !staleRf.Cancelled {
		t.Fatal("expected stale entry Cancelled flag to be true")
	}
	staleRf.mu.Unlock()

	if _, err := os.Stat(staleTmpPath); !os.IsNotExist(err) {
		t.Fatalf("expected stale .tmp file to be physically removed from disk, stat err: %v", err)
	}
}

func TestE2EEPlainAndTusRouteBan(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "eqt-e2ee-ban-routes-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	cfg := &config.Config{
		Interface: "lo",
		Port:      0,
		Bind:      "127.0.0.1",
		KeepAlive: true,
	}
	srv, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if err := srv.ReceiveTo(tempDir); err != nil {
		t.Fatal(err)
	}

	clientID := "banned-client-007"
	srv.BanClient(clientID)

	// 1. Check plain receive route blocks banned client with 403
	reqRecv := httptest.NewRequest("GET", srv.ReceiveURL, nil)
	reqRecv.Header.Set("X-Client-ID", clientID)
	wRecv := httptest.NewRecorder()
	srv.mux.ServeHTTP(wRecv, reqRecv)
	if wRecv.Code != http.StatusForbidden {
		t.Fatalf("expected receive route to return 403 Forbidden for banned client, got %d", wRecv.Code)
	}

	// 2. Check tus route blocks banned client with 403
	reqTus := httptest.NewRequest("POST", srv.tusPath, nil)
	reqTus.Header.Set("X-Client-ID", clientID)
	wTus := httptest.NewRecorder()
	srv.mux.ServeHTTP(wTus, reqTus)
	if wTus.Code != http.StatusForbidden {
		t.Fatalf("expected tus route to return 403 Forbidden for banned client, got %d", wTus.Code)
	}

	// 3. Check client status reflection
	cs := srv.getClientStatus(clientID)
	if !cs.IsBanned || cs.State != "banned" {
		t.Fatalf("expected getClientStatus to report isBanned=true and state=banned, got %#v", cs)
	}

	// 4. Unban client and verify status restored
	srv.UnbanClient(clientID)
	csUnbanned := srv.getClientStatus(clientID)
	if csUnbanned.IsBanned || csUnbanned.State == "banned" {
		t.Fatalf("expected unbanned client to have isBanned=false, got %#v", csUnbanned)
	}
}
