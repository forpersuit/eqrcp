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

	clientID := "client-share-archive-test"

	// Meta
	metaReq := httptest.NewRequest("GET", srv.SendURL+"/meta", nil)
	metaReq.Header.Set("X-Client-ID", clientID)
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
	chunkReq.Header.Set("X-Client-ID", clientID)
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

	// Verify that archive progress is accurately reported and client is finished
	cs := srv.getClientStatus(clientID)
	if cs.BytesTotal <= 0 || cs.BytesDone != cs.BytesTotal || cs.Percent != 100 || cs.State != "completed" {
		t.Fatalf("expected completed archive progress, got BytesDone=%d BytesTotal=%d Percent=%d State=%q", cs.BytesDone, cs.BytesTotal, cs.Percent, cs.State)
	}
	if !srv.isClientFinished(clientID) {
		t.Fatalf("expected srv.isClientFinished(%q) to be true for archive", clientID)
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

func TestE2EEShareProgressTracking(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "eqt-e2ee-share-progress-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	// Create an 8.5MB test file
	testFilePath := filepath.Join(tempDir, "test_document.bin")
	totalBytes := int64(8*1024*1024 + 512*1024)
	f, err := os.Create(testFilePath)
	if err != nil {
		t.Fatal(err)
	}
	_ = f.Truncate(totalBytes)
	_ = f.Close()

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
	b, err := body.FromArgs([]string{testFilePath}, false)
	if err != nil {
		t.Fatal(err)
	}
	srv.Send(b)

	masterKey, err := e2ee.GenerateMasterKey()
	if err != nil {
		t.Fatal(err)
	}
	if err := srv.EnableE2EE(masterKey, "sess-share-progress"); err != nil {
		t.Fatal(err)
	}

	clientID := "client-share-progress-tester"

	// 1. Fetch metadata
	metaReq := httptest.NewRequest("GET", srv.SendURL+"/meta?client_id="+clientID, nil)
	metaReq.Header.Set("X-Client-ID", clientID)
	wMeta := httptest.NewRecorder()
	srv.handleE2EEShareMeta(wMeta, metaReq)
	if wMeta.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from meta, got %d", wMeta.Code)
	}

	cs := srv.getClientStatus(clientID)
	if cs.State != "connected" || cs.BytesTotal != totalBytes {
		t.Fatalf("expected client to be connected with totalBytes %d, got state=%q total=%d", totalBytes, cs.State, cs.BytesTotal)
	}

	// 2. Fetch Chunk 0 (4MB)
	chunk0Req := httptest.NewRequest("GET", srv.SendURL+"/chunk?file_id=f-0&chunk_index=0&client_id="+clientID, nil)
	chunk0Req.Header.Set("X-Client-ID", clientID)
	wChunk0 := httptest.NewRecorder()
	srv.handleE2EEShareChunk(wChunk0, chunk0Req)
	if wChunk0.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from chunk 0, got %d", wChunk0.Code)
	}

	cs0 := srv.getClientStatus(clientID)
	if cs0.State != "transferring" || cs0.BytesDone != 4*1024*1024 || cs0.Percent <= 0 || cs0.Percent >= 100 {
		t.Fatalf("expected chunk 0 progress: state=transferring, BytesDone=4MB, got state=%q BytesDone=%d Percent=%d", cs0.State, cs0.BytesDone, cs0.Percent)
	}

	// 3. Fetch Chunk 1 (4MB)
	chunk1Req := httptest.NewRequest("GET", srv.SendURL+"/chunk?file_id=f-0&chunk_index=1&client_id="+clientID, nil)
	chunk1Req.Header.Set("X-Client-ID", clientID)
	wChunk1 := httptest.NewRecorder()
	srv.handleE2EEShareChunk(wChunk1, chunk1Req)
	if wChunk1.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from chunk 1, got %d", wChunk1.Code)
	}

	cs1 := srv.getClientStatus(clientID)
	if cs1.State != "transferring" || cs1.BytesDone != 8*1024*1024 || cs1.Percent <= cs0.Percent {
		t.Fatalf("expected chunk 1 progress > chunk 0, got BytesDone=%d Percent=%d", cs1.BytesDone, cs1.Percent)
	}

	// 4. Fetch Chunk 2 (0.5MB, final chunk)
	chunk2Req := httptest.NewRequest("GET", srv.SendURL+"/chunk?file_id=f-0&chunk_index=2&client_id="+clientID, nil)
	chunk2Req.Header.Set("X-Client-ID", clientID)
	wChunk2 := httptest.NewRecorder()
	srv.handleE2EEShareChunk(wChunk2, chunk2Req)
	if wChunk2.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from chunk 2, got %d", wChunk2.Code)
	}

	cs2 := srv.getClientStatus(clientID)
	if cs2.State != "completed" || cs2.BytesDone != totalBytes || cs2.Percent != 100 {
		t.Fatalf("expected completed transfer: state=completed BytesDone=%d Percent=100, got state=%q BytesDone=%d Percent=%d", totalBytes, cs2.State, cs2.BytesDone, cs2.Percent)
	}
}

func TestE2EEShareProgressRetryDeduplicationAndReset(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "eqt-e2ee-share-dedup-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	// Create an 8.5MB test file
	testFilePath := filepath.Join(tempDir, "test_document.bin")
	totalBytes := int64(8*1024*1024 + 512*1024)
	f, err := os.Create(testFilePath)
	if err != nil {
		t.Fatal(err)
	}
	_ = f.Truncate(totalBytes)
	_ = f.Close()

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
	b, err := body.FromArgs([]string{testFilePath}, false)
	if err != nil {
		t.Fatal(err)
	}
	srv.Send(b)

	masterKey, err := e2ee.GenerateMasterKey()
	if err != nil {
		t.Fatal(err)
	}
	if err := srv.EnableE2EE(masterKey, "sess-share-dedup"); err != nil {
		t.Fatal(err)
	}

	clientID := "client-share-dedup-tester"

	// 1. Initial /meta
	metaReq := httptest.NewRequest("GET", srv.SendURL+"/meta?client_id="+clientID, nil)
	metaReq.Header.Set("X-Client-ID", clientID)
	wMeta := httptest.NewRecorder()
	srv.handleE2EEShareMeta(wMeta, metaReq)
	if wMeta.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", wMeta.Code)
	}

	// 2. Fetch Chunk 0
	chunk0Req := httptest.NewRequest("GET", srv.SendURL+"/chunk?file_id=f-0&chunk_index=0&client_id="+clientID, nil)
	chunk0Req.Header.Set("X-Client-ID", clientID)
	wChunk0 := httptest.NewRecorder()
	srv.handleE2EEShareChunk(wChunk0, chunk0Req)
	if wChunk0.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", wChunk0.Code)
	}

	cs0 := srv.getClientStatus(clientID)
	if cs0.BytesDone != 4*1024*1024 {
		t.Fatalf("expected BytesDone=4MB, got %d", cs0.BytesDone)
	}

	// 3. Retry Chunk 0 (simulate network glitch retry without /meta) -> should NOT double-count!
	chunk0RetryReq := httptest.NewRequest("GET", srv.SendURL+"/chunk?file_id=f-0&chunk_index=0&client_id="+clientID, nil)
	chunk0RetryReq.Header.Set("X-Client-ID", clientID)
	wChunk0Retry := httptest.NewRecorder()
	srv.handleE2EEShareChunk(wChunk0Retry, chunk0RetryReq)
	if wChunk0Retry.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on retry, got %d", wChunk0Retry.Code)
	}

	cs0Retry := srv.getClientStatus(clientID)
	if cs0Retry.BytesDone != 4*1024*1024 {
		t.Fatalf("expected BytesDone to stay 4MB after retry deduplication, got %d", cs0Retry.BytesDone)
	}

	// 4. Simulate page refresh -> calls /meta again -> should reset progress cleanly
	metaRefreshReq := httptest.NewRequest("GET", srv.SendURL+"/meta?client_id="+clientID, nil)
	metaRefreshReq.Header.Set("X-Client-ID", clientID)
	wMetaRefresh := httptest.NewRecorder()
	srv.handleE2EEShareMeta(wMetaRefresh, metaRefreshReq)

	csRefresh := srv.getClientStatus(clientID)
	if csRefresh.BytesDone != 0 || csRefresh.Percent != 0 {
		t.Fatalf("expected BytesDone=0 and Percent=0 after refresh /meta, got done=%d pct=%d", csRefresh.BytesDone, csRefresh.Percent)
	}

	// 5. Fresh attempt downloads chunk 0 and 1 -> BytesDone reaches 8MB without premature completed
	chunk0Req2 := httptest.NewRequest("GET", srv.SendURL+"/chunk?file_id=f-0&chunk_index=0&client_id="+clientID, nil)
	chunk0Req2.Header.Set("X-Client-ID", clientID)
	wChunk0_2 := httptest.NewRecorder()
	srv.handleE2EEShareChunk(wChunk0_2, chunk0Req2)

	chunk1Req := httptest.NewRequest("GET", srv.SendURL+"/chunk?file_id=f-0&chunk_index=1&client_id="+clientID, nil)
	chunk1Req.Header.Set("X-Client-ID", clientID)
	wChunk1 := httptest.NewRecorder()
	srv.handleE2EEShareChunk(wChunk1, chunk1Req)

	cs1 := srv.getClientStatus(clientID)
	if cs1.State == "completed" || cs1.BytesDone != 8*1024*1024 {
		t.Fatalf("expected state=transferring with 8MB, got state=%q done=%d", cs1.State, cs1.BytesDone)
	}
}

func TestE2EEShareInvalidFileID(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "eqt-e2ee-share-invalid-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	testFilePath := filepath.Join(tempDir, "test.txt")
	_ = os.WriteFile(testFilePath, []byte("hello"), 0644)

	cfg := &config.Config{Interface: "lo", Port: 0, Bind: "127.0.0.1", KeepAlive: true}
	srv, _ := New(cfg)
	b, _ := body.FromArgs([]string{testFilePath}, false)
	srv.Send(b)

	masterKey, _ := e2ee.GenerateMasterKey()
	_ = srv.EnableE2EE(masterKey, "sess-share-invalid")

	invalidIDs := []string{"foo", "f-abc", "f-99", "invalid"}
	for _, id := range invalidIDs {
		req := httptest.NewRequest("GET", srv.SendURL+"/chunk?file_id="+id+"&chunk_index=0", nil)
		w := httptest.NewRecorder()
		srv.handleE2EEShareChunk(w, req)
		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404 NotFound for invalid file_id=%q, got %d", id, w.Code)
		}
	}
}

func TestE2EEReceiveMultiFileNoFlicker(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "eqt-multi-file-noflicker-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	cfg := &config.Config{Interface: "lo", Port: 0, Bind: "127.0.0.1", KeepAlive: true}
	srv, _ := New(cfg)
	_ = srv.ReceiveTo(tempDir)

	masterKey, _ := e2ee.GenerateMasterKey()
	_ = srv.EnableE2EE(masterKey, "sess-multi-noflicker")
	keys, _ := e2ee.DeriveKeys(masterKey)

	clientID := "client-multi-file-noflicker"

	// 1. Upload File 1 of 2 (X-File-Index: 0, X-File-Count: 2)
	data1 := []byte("content of file 1")
	enc1, _ := e2ee.EncryptChunk(data1, 0, keys.RecvKey[:], "f-101")
	req1 := httptest.NewRequest("POST", srv.ReceiveURL+"/chunk", bytes.NewReader(enc1))
	req1.Header.Set("X-File-ID", "f-101")
	req1.Header.Set("X-Chunk-Index", "0")
	req1.Header.Set("X-Total-Chunks", "1")
	req1.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", len(data1)))
	req1.Header.Set("X-File-Name", "file1.txt")
	req1.Header.Set("X-File-Index", "0")
	req1.Header.Set("X-File-Count", "2")
	req1.Header.Set("X-Client-ID", clientID)

	w1 := httptest.NewRecorder()
	srv.handleE2EEReceiveChunk(w1, req1)
	if w1.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for file 1, got %d", w1.Code)
	}

	cs1 := srv.getClientStatus(clientID)
	// Must stay "transferring" since 1 of 2 files is completed
	if cs1.State != "transferring" {
		t.Fatalf("expected state=transferring after file 1 completes in 2-file transfer, got state=%q", cs1.State)
	}
	if len(cs1.Files) != 2 || cs1.Files[0].State != "completed" || cs1.Files[1].State != "waiting" {
		t.Fatalf("unexpected cs1.Files state: %+v", cs1.Files)
	}

	// 2. Upload File 2 of 2 (X-File-Index: 1, X-File-Count: 2)
	data2 := []byte("content of file 2")
	enc2, _ := e2ee.EncryptChunk(data2, 0, keys.RecvKey[:], "f-102")
	req2 := httptest.NewRequest("POST", srv.ReceiveURL+"/chunk", bytes.NewReader(enc2))
	req2.Header.Set("X-File-ID", "f-102")
	req2.Header.Set("X-Chunk-Index", "0")
	req2.Header.Set("X-Total-Chunks", "1")
	req2.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", len(data2)))
	req2.Header.Set("X-File-Name", "file2.txt")
	req2.Header.Set("X-File-Index", "1")
	req2.Header.Set("X-File-Count", "2")
	req2.Header.Set("X-Client-ID", clientID)

	w2 := httptest.NewRecorder()
	srv.handleE2EEReceiveChunk(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for file 2, got %d", w2.Code)
	}

	cs2 := srv.getClientStatus(clientID)
	// Must now be "completed"
	if cs2.State != "completed" || cs2.Percent != 100 {
		t.Fatalf("expected state=completed after both files complete, got state=%q percent=%d", cs2.State, cs2.Percent)
	}
	if len(cs2.Files) != 2 || cs2.Files[0].State != "completed" || cs2.Files[1].State != "completed" {
		t.Fatalf("unexpected cs2.Files state: %+v", cs2.Files)
	}
}
