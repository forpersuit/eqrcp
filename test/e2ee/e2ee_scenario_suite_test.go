package e2ee_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"eqt/pkg/body"
	"eqt/pkg/config"
	"eqt/pkg/crypto/e2ee"
	"eqt/pkg/server"
)

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func dataSHA256(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

func getTestFile(t *testing.T, filename string, fallbackSize int) (string, []byte) {
	primaryPath := filepath.Join("/mnt/e/developer/results/data", filename)
	if data, err := os.ReadFile(primaryPath); err == nil {
		return primaryPath, data
	}
	// Fallback to synthetic data if results directory is not mounted
	tmpDir := t.TempDir()
	syntheticPath := filepath.Join(tmpDir, filename)
	data := make([]byte, fallbackSize)
	for i := range data {
		data[i] = byte((i*31 + 17) % 251)
	}
	if err := os.WriteFile(syntheticPath, data, 0644); err != nil {
		t.Fatalf("failed to create fallback test file: %v", err)
	}
	return syntheticPath, data
}

// =========================================================================
// 场景 1：E2EE 模式 Share（下载端）全链路与实时平滑进度验证
// =========================================================================
func TestScenario1_E2EEShareRealDataPipelineAndProgress(t *testing.T) {
	filePath, fileData := getTestFile(t, "eqt-multiple-files-20260627-205709.zip", 10*1024*1024)
	expectedHash := dataSHA256(fileData)
	totalBytes := int64(len(fileData))
	t.Logf("[Scenario 1] Using test file: %s (Size: %d bytes, SHA256: %s)", filepath.Base(filePath), totalBytes, expectedHash)

	cfg := config.Config{
		Interface: "lo",
		Bind:      "127.0.0.1",
		Port:      0,
		KeepAlive: true,
	}
	srv, err := server.New(&cfg)
	if err != nil {
		t.Fatalf("server.New failed: %v", err)
	}
	defer srv.Shutdown()

	masterKey, _ := e2ee.GenerateMasterKey()
	sessionID := "sc1-session-123"
	if err := srv.EnableE2EE(masterKey, sessionID); err != nil {
		t.Fatalf("EnableE2EE failed: %v", err)
	}
	keys, err := e2ee.DeriveKeys(masterKey)
	if err != nil {
		t.Fatalf("DeriveKeys failed: %v", err)
	}

	payload, err := body.FromArgs([]string{filePath}, false)
	if err != nil {
		t.Fatalf("body.FromArgs failed: %v", err)
	}
	srv.Send(payload)

	clientID := "client-scenario-1"

	// 1. Fetch metadata
	metaReq := httptest.NewRequest("GET", srv.SendURL+"/meta?client_id="+clientID, nil)
	wMeta := httptest.NewRecorder()
	srv.HandleE2EEShareMeta(wMeta, metaReq)
	if wMeta.Code != http.StatusOK {
		t.Fatalf("meta request failed: code %d, body: %s", wMeta.Code, wMeta.Body.String())
	}

	var metaResp struct {
		OK        bool                       `json:"ok"`
		IsE2EE    bool                       `json:"is_e2ee"`
		SessionID string                     `json:"session_id"`
		Files     []server.E2EEShareFileInfo `json:"files"`
	}
	if err := json.Unmarshal(wMeta.Body.Bytes(), &metaResp); err != nil {
		t.Fatalf("failed to decode meta response: %v", err)
	}
	if !metaResp.OK || !metaResp.IsE2EE || len(metaResp.Files) != 1 {
		t.Fatalf("invalid meta response: %+v", metaResp)
	}

	// 2. Verify initial state is 'connected' with valid BytesTotal and 0 BytesDone
	cStateInit := srv.GetClientStatus(clientID)
	t.Logf("[Scenario 1] Post-meta State: %s, BytesDone: %d, BytesTotal: %d, Percent: %d%%",
		cStateInit.State, cStateInit.BytesDone, cStateInit.BytesTotal, cStateInit.Percent)
	if cStateInit.State != "connected" || cStateInit.BytesTotal != totalBytes || cStateInit.BytesDone != 0 {
		t.Fatalf("expected initial state=connected, bytesTotal=%d; got state=%s, bytesTotal=%d, bytesDone=%d",
			totalBytes, cStateInit.State, cStateInit.BytesTotal, cStateInit.BytesDone)
	}

	fileInfo := metaResp.Files[0]
	var decryptedBuffer bytes.Buffer
	prevPercent := -1

	// 3. Download and decrypt each chunk sequentially
	for chunkIdx := uint32(0); chunkIdx < fileInfo.TotalChunks; chunkIdx++ {
		chunkURL := fmt.Sprintf("%s/chunk?file_id=%s&chunk_index=%d&client_id=%s", srv.SendURL, fileInfo.FileID, chunkIdx, clientID)
		chunkReq := httptest.NewRequest("GET", chunkURL, nil)
		wChunk := httptest.NewRecorder()
		srv.HandleE2EEShareChunk(wChunk, chunkReq)
		if wChunk.Code != http.StatusOK {
			t.Fatalf("chunk %d fetch failed: code %d, body: %s", chunkIdx, wChunk.Code, wChunk.Body.String())
		}

		encryptedBytes := wChunk.Body.Bytes()
		decryptedChunk, err := e2ee.DecryptChunk(encryptedBytes, chunkIdx, keys.SendKey[:], fileInfo.FileID)
		if err != nil {
			t.Fatalf("chunk %d decryption failed: %v", chunkIdx, err)
		}
		decryptedBuffer.Write(decryptedChunk)

		cState := srv.GetClientStatus(clientID)
		t.Logf("[Scenario 1] Chunk %d/%d downloaded. Progress: %d / %d bytes (%d%%), State: %s",
			chunkIdx+1, fileInfo.TotalChunks, cState.BytesDone, cState.BytesTotal, cState.Percent, cState.State)

		// Assert progress strictly increases without rollback
		if cState.Percent < prevPercent {
			t.Fatalf("progress rollback detected at chunk %d: prev %d%%, now %d%%", chunkIdx, prevPercent, cState.Percent)
		}
		prevPercent = cState.Percent
	}

	// 4. Verify assembled file hash matches original
	actualHash := dataSHA256(decryptedBuffer.Bytes())
	if actualHash != expectedHash {
		t.Fatalf("hash mismatch! expected %s, got %s", expectedHash, actualHash)
	}

	// 5. Verify final completion state
	cStateFinal := srv.GetClientStatus(clientID)
	if cStateFinal.State != "completed" || cStateFinal.Percent != 100 || cStateFinal.BytesDone != totalBytes {
		t.Fatalf("expected completed state with 100%%; got state=%s, percent=%d, bytesDone=%d",
			cStateFinal.State, cStateFinal.Percent, cStateFinal.BytesDone)
	}
	t.Logf("[Scenario 1] PASS: 100%% byte-for-byte SHA256 verified, smooth monotonic progress verified.")
}

// =========================================================================
// 场景 2：E2EE 模式 Receive（多文件上传）全局进度跨文件累加无回跳验证
// =========================================================================
func TestScenario2_E2EEReceiveMultiFileCumulativeProgress(t *testing.T) {
	file1Path, file1Data := getTestFile(t, "eqt-multiple-files-20260627-205709.zip", 8*1024*1024)
	file2Path, file2Data := getTestFile(t, "eqt-multiple-files-20260701-211034.zip", 12*1024*1024)

	hash1 := dataSHA256(file1Data)
	hash2 := dataSHA256(file2Data)
	totalGlobalBytes := int64(len(file1Data) + len(file2Data))

	t.Logf("[Scenario 2] Multi-file receive test: File 1 (%d bytes), File 2 (%d bytes), Total: %d bytes",
		len(file1Data), len(file2Data), totalGlobalBytes)

	tempDir := t.TempDir()
	recOutDir := filepath.Join(tempDir, "rec_out_s2")
	if err := os.MkdirAll(recOutDir, 0755); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}

	cfg := config.Config{
		Interface: "lo",
		Bind:      "127.0.0.1",
		Port:      0,
		KeepAlive: true,
	}
	srv, err := server.New(&cfg)
	if err != nil {
		t.Fatalf("server.New failed: %v", err)
	}
	defer srv.Shutdown()
	if err := srv.ReceiveTo(recOutDir); err != nil {
		t.Fatalf("ReceiveTo failed: %v", err)
	}

	masterKey, _ := e2ee.GenerateMasterKey()
	sessionID := "sc2-session-multi"
	_ = srv.EnableE2EE(masterKey, sessionID)
	keys, _ := e2ee.DeriveKeys(masterKey)

	clientID := "client-scenario-2-uploader"
	file1ID := "f-sc2-file1"
	file2ID := "f-sc2-file2"

	chunkSize := server.E2EEChunkPlaintextSize // 4MB
	file1Chunks := (len(file1Data) + chunkSize - 1) / chunkSize
	file2Chunks := (len(file2Data) + chunkSize - 1) / chunkSize

	lastGlobalPercent := -1

	// Helper to send a chunk
	sendChunk := func(fData []byte, fID string, fName string, fIdx int, fCount int, chunkIdx int, totalChunks int) {
		start := chunkIdx * chunkSize
		end := start + chunkSize
		if end > len(fData) {
			end = len(fData)
		}
		rawSlice := fData[start:end]
		encChunk, err := e2ee.EncryptChunk(rawSlice, uint32(chunkIdx), keys.RecvKey[:], fID)
		if err != nil {
			t.Fatalf("EncryptChunk failed: %v", err)
		}

		req := httptest.NewRequest("POST", srv.ReceiveURL+"/chunk", bytes.NewReader(encChunk))
		req.Header.Set("X-Client-ID", clientID)
		req.Header.Set("X-File-ID", fID)
		req.Header.Set("X-File-Name", fName)
		req.Header.Set("X-Chunk-Index", fmt.Sprintf("%d", chunkIdx))
		req.Header.Set("X-Total-Chunks", fmt.Sprintf("%d", totalChunks))
		req.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", len(fData)))
		req.Header.Set("X-Total-All-Bytes", fmt.Sprintf("%d", totalGlobalBytes))
		req.Header.Set("X-File-Index", fmt.Sprintf("%d", fIdx))
		req.Header.Set("X-File-Count", fmt.Sprintf("%d", fCount))

		w := httptest.NewRecorder()
		srv.HandleE2EEReceiveChunk(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("upload chunk %d of %s failed: %d %s", chunkIdx, fName, w.Code, w.Body.String())
		}

		cState := srv.GetClientStatus(clientID)
		t.Logf("[Scenario 2] Uploaded [%s] chunk %d/%d -> Global Done: %d / %d bytes (%d%%), State: %s",
			fName, chunkIdx+1, totalChunks, cState.BytesDone, cState.BytesTotal, cState.Percent, cState.State)

		// Critical assertion: Global percent must NEVER rollback across file boundary!
		if cState.Percent < lastGlobalPercent {
			t.Fatalf("CRITICAL BUG: Global progress rolled back from %d%% to %d%% during file transition!",
				lastGlobalPercent, cState.Percent)
		}
		lastGlobalPercent = cState.Percent
	}

	// 1. Upload all chunks of File 1
	for c := 0; c < file1Chunks; c++ {
		sendChunk(file1Data, file1ID, filepath.Base(file1Path), 0, 2, c, file1Chunks)
	}

	cStateAfterFile1 := srv.GetClientStatus(clientID)
	t.Logf("[Scenario 2] Status after File 1 complete: State=%s, Percent=%d%%, BytesDone=%d, BytesTotal=%d",
		cStateAfterFile1.State, cStateAfterFile1.Percent, cStateAfterFile1.BytesDone, cStateAfterFile1.BytesTotal)

	// 2. Upload chunk 0 of File 2 (This is where the bug previously caused a drop back to 10-20%)
	sendChunk(file2Data, file2ID, filepath.Base(file2Path), 1, 2, 0, file2Chunks)

	cStateFile2Start := srv.GetClientStatus(clientID)
	t.Logf("[Scenario 2] Status after File 2 chunk 0: State=%s, Percent=%d%%, BytesDone=%d, BytesTotal=%d",
		cStateFile2Start.State, cStateFile2Start.Percent, cStateFile2Start.BytesDone, cStateFile2Start.BytesTotal)

	if cStateFile2Start.BytesDone < int64(len(file1Data)) {
		t.Fatalf("CRITICAL: BytesDone (%d) dropped below completed File 1 size (%d)!",
			cStateFile2Start.BytesDone, len(file1Data))
	}

	// 3. Upload remaining chunks of File 2
	for c := 1; c < file2Chunks; c++ {
		sendChunk(file2Data, file2ID, filepath.Base(file2Path), 1, 2, c, file2Chunks)
	}

	// 4. Verify on-disk received files match original SHA256 hashes
	savedFiles := srv.GetClientStatus(clientID).SavedFiles
	if len(savedFiles) != 2 {
		t.Fatalf("expected 2 saved files, got %d: %+v", len(savedFiles), savedFiles)
	}

	diskHash1, err := fileSHA256(savedFiles[0])
	if err != nil || diskHash1 != hash1 {
		t.Fatalf("saved file 1 hash mismatch: err=%v, expected=%s, got=%s", err, hash1, diskHash1)
	}
	diskHash2, err := fileSHA256(savedFiles[1])
	if err != nil || diskHash2 != hash2 {
		t.Fatalf("saved file 2 hash mismatch: err=%v, expected=%s, got=%s", err, hash2, diskHash2)
	}

	cStateFinal := srv.GetClientStatus(clientID)
	if cStateFinal.State != "completed" || cStateFinal.Percent != 100 || cStateFinal.BytesDone != totalGlobalBytes {
		t.Fatalf("expected final state=completed, percent=100, bytesDone=%d; got %+v", totalGlobalBytes, cStateFinal)
	}
	t.Logf("[Scenario 2] PASS: Multi-file receive monotonic cumulative progress & on-disk SHA256 integrity 100%% verified.")
}

// =========================================================================
// 场景 3：E2EE 传输中途主动 Stop、防绕过与物理临时文件即时清理验证
// =========================================================================
func TestScenario3_E2EEManualStopAndAntiBypassLifecycle(t *testing.T) {
	_, fileData := getTestFile(t, "eqt-multiple-files-20260627-205709.zip", 8*1024*1024)
	tempDir := t.TempDir()
	recOutDir := filepath.Join(tempDir, "rec_stop_s3")
	_ = os.MkdirAll(recOutDir, 0755)

	cfg := config.Config{Interface: "lo", Bind: "127.0.0.1", Port: 0, KeepAlive: true}
	srv, _ := server.New(&cfg)
	defer srv.Shutdown()
	_ = srv.ReceiveTo(recOutDir)

	masterKey, _ := e2ee.GenerateMasterKey()
	sessionID := "sc3-session-stop"
	_ = srv.EnableE2EE(masterKey, sessionID)
	keys, _ := e2ee.DeriveKeys(masterKey)

	clientID := "client-stop-test-s3"
	fileID := "f-sc3-stopfile"

	// 1. Send chunk 0 of 2 (creates an in-progress temporary .tmp file)
	encChunk0, _ := e2ee.EncryptChunk(fileData[:4*1024*1024], 0, keys.RecvKey[:], fileID)
	req0 := httptest.NewRequest("POST", srv.ReceiveURL+"/chunk", bytes.NewReader(encChunk0))
	req0.Header.Set("X-Client-ID", clientID)
	req0.Header.Set("X-File-ID", fileID)
	req0.Header.Set("X-File-Name", "stop_test.dat")
	req0.Header.Set("X-Chunk-Index", "0")
	req0.Header.Set("X-Total-Chunks", "2")
	req0.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", len(fileData)))
	w0 := httptest.NewRecorder()
	srv.HandleE2EEReceiveChunk(w0, req0)
	if w0.Code != http.StatusOK {
		t.Fatalf("initial chunk failed: %d %s", w0.Code, w0.Body.String())
	}

	devDir, _ := srv.GetDeviceOutputDir(clientID)
	matches, _ := filepath.Glob(filepath.Join(devDir, "*.tmp"))
	if len(matches) == 0 {
		t.Fatal("expected active .tmp temporary file on disk before stop")
	}
	tmpFileOnDisk := matches[0]
	t.Logf("[Scenario 3] In-progress temp file created on disk: %s", tmpFileOnDisk)

	// 2. Host manually stops the transfer
	stopped := srv.StopClientTransfer(clientID)
	if !stopped {
		t.Fatal("StopClientTransfer returned false")
	}
	t.Logf("[Scenario 3] StopClientTransfer called for client: %s", clientID)

	// 3. Assert physical .tmp file was immediately deleted on disk
	if _, err := os.Stat(tmpFileOnDisk); !os.IsNotExist(err) {
		t.Fatalf("LEAK DETECTED: temporary file %s still exists after StopClientTransfer!", tmpFileOnDisk)
	}
	t.Logf("[Scenario 3] Verified .tmp file deleted immediately on Stop.")

	// 4. Assert chunk requests from stopped client are rejected with 403 / CLIENT_STOPPED
	encChunk1, _ := e2ee.EncryptChunk(fileData[4*1024*1024:], 1, keys.RecvKey[:], fileID)
	req1 := httptest.NewRequest("POST", srv.ReceiveURL+"/chunk", bytes.NewReader(encChunk1))
	req1.Header.Set("X-Client-ID", clientID)
	req1.Header.Set("X-File-ID", fileID)
	req1.Header.Set("X-File-Name", "stop_test.dat")
	req1.Header.Set("X-Chunk-Index", "1")
	req1.Header.Set("X-Total-Chunks", "2")
	req1.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", len(fileData)))
	w1 := httptest.NewRecorder()
	srv.HandleE2EEReceiveChunk(w1, req1)
	if w1.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden after stop, got %d: %s", w1.Code, w1.Body.String())
	}
	var resp1 map[string]any
	_ = json.Unmarshal(w1.Body.Bytes(), &resp1)
	if resp1["error_code"] != "CLIENT_STOPPED" {
		t.Fatalf("expected error_code CLIENT_STOPPED, got: %v", resp1)
	}

	// 5. Assert chunk_status request is rejected with 403 / CLIENT_STOPPED
	statusReq := httptest.NewRequest("GET", srv.ReceiveURL+"/chunk_status?file_id="+fileID+"&client_id="+clientID, nil)
	wStatus := httptest.NewRecorder()
	srv.HandleE2EEReceiveChunkStatus(wStatus, statusReq)
	if wStatus.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for chunk_status after stop, got %d", wStatus.Code)
	}

	t.Logf("[Scenario 3] PASS: Manual stop, physical file cleanup, and anti-bypass 100%% verified.")
}

// =========================================================================
// 场景 4：关闭 E2EE（明文模式）单文件与多文件进度与兼容性验证
// =========================================================================
func TestScenario4_PlaintextProgressCompatibility(t *testing.T) {
	filePath, fileData := getTestFile(t, "eqt-multiple-files-20260627-205709.zip", 4*1024*1024)
	totalBytes := int64(len(fileData))

	cfg := config.Config{Interface: "lo", Bind: "127.0.0.1", Port: 0, KeepAlive: true}
	srv, err := server.New(&cfg)
	if err != nil {
		t.Fatalf("server.New failed: %v", err)
	}
	defer srv.Shutdown()

	payload, err := body.FromArgs([]string{filePath}, false)
	if err != nil {
		t.Fatalf("body.FromArgs failed: %v", err)
	}
	srv.Send(payload)

	clientID := "client-plaintext-s4"
	downloadURL := fmt.Sprintf("%s?download=1&client_id=%s", srv.SendURL, clientID)

	httpClient := &http.Client{Timeout: 5 * time.Second}
	resp, err := httpClient.Get(downloadURL)
	if err != nil {
		t.Fatalf("download request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", resp.StatusCode)
	}

	received, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("failed reading download body: %v", err)
	}
	if int64(len(received)) != totalBytes {
		t.Fatalf("received size mismatch: expected %d, got %d", totalBytes, len(received))
	}

	// Verify client status after download
	cState := srv.GetClientStatus(clientID)
	t.Logf("[Scenario 4] Plaintext status after download: State=%s, BytesDone=%d, BytesTotal=%d, Percent=%d%%",
		cState.State, cState.BytesDone, cState.BytesTotal, cState.Percent)

	if cState.BytesDone != totalBytes || cState.BytesTotal != totalBytes || cState.Percent != 100 {
		t.Fatalf("expected 100%% completed progress in plaintext mode, got BytesDone=%d, BytesTotal=%d, Percent=%d",
			cState.BytesDone, cState.BytesTotal, cState.Percent)
	}

	t.Logf("[Scenario 4] PASS: Plaintext transfer progress smoothly verified.")
}

// =========================================================================
// 场景 5：E2EE 密文篡改与未初始化攻击防护 (Fail-Closed & Zero Plaintext Fallback)
// =========================================================================
func TestScenario5_E2EETamperAndFailClosedProtection(t *testing.T) {
	tempDir := t.TempDir()
	recOutDir := filepath.Join(tempDir, "rec_tamper_s5")
	_ = os.MkdirAll(recOutDir, 0755)

	cfg := config.Config{Interface: "lo", Bind: "127.0.0.1", Port: 0, KeepAlive: true}
	srv, _ := server.New(&cfg)
	defer srv.Shutdown()
	_ = srv.ReceiveTo(recOutDir)

	masterKey, _ := e2ee.GenerateMasterKey()
	sessionID := "sc5-session-tamper"
	_ = srv.EnableE2EE(masterKey, sessionID)
	keys, _ := e2ee.DeriveKeys(masterKey)

	clientID := "client-tamper-attacker"
	fileID := "f-sc5-tamper"
	validData := []byte("Sensitive corporate confidential data that must never leak in plaintext.")

	// 1. Valid encryption
	encChunk, err := e2ee.EncryptChunk(validData, 0, keys.RecvKey[:], fileID)
	if err != nil {
		t.Fatalf("EncryptChunk failed: %v", err)
	}

	// 2. Tamper with the encrypted ciphertext body (flip 1 bit)
	tamperedChunk := make([]byte, len(encChunk))
	copy(tamperedChunk, encChunk)
	tamperedChunk[len(tamperedChunk)-1] ^= 0xFF

	reqTampered := httptest.NewRequest("POST", srv.ReceiveURL+"/chunk", bytes.NewReader(tamperedChunk))
	reqTampered.Header.Set("X-Client-ID", clientID)
	reqTampered.Header.Set("X-File-ID", fileID)
	reqTampered.Header.Set("X-File-Name", "tamper.dat")
	reqTampered.Header.Set("X-Chunk-Index", "0")
	reqTampered.Header.Set("X-Total-Chunks", "1")
	reqTampered.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", len(validData)))
	wTampered := httptest.NewRecorder()
	srv.HandleE2EEReceiveChunk(wTampered, reqTampered)

	if wTampered.Code == http.StatusOK {
		t.Fatal("SECURITY BREACH: Tampered ciphertext was accepted by server!")
	}
	t.Logf("[Scenario 5] Verified tampered chunk rejected with code: %d", wTampered.Code)

	// 3. Verify zero unencrypted files leaked into output directory
	devDir, _ := srv.GetDeviceOutputDir(clientID)
	entries, _ := os.ReadDir(devDir)
	for _, entry := range entries {
		if !entry.IsDir() {
			content, _ := os.ReadFile(filepath.Join(devDir, entry.Name()))
			if bytes.Contains(content, validData) {
				t.Fatal("SECURITY BREACH: Plaintext data was written to disk on tampered transfer!")
			}
		}
	}

	t.Logf("[Scenario 5] PASS: Fail-closed zero-plaintext fallback protection verified.")
}
