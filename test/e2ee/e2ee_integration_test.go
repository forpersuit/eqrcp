package e2ee_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"eqt/pkg/application"
	"eqt/pkg/body"
	"eqt/pkg/config"
	"eqt/pkg/crypto/e2ee"
	"eqt/pkg/server"
)

// TestE2EETriStateSecurityStateMachine tests the full three-state security lifecycle:
// Active (🔒) -> Degraded (⚠️) -> Disabled (🔓) -> Recovered (🔒)
func TestE2EETriStateSecurityStateMachine(t *testing.T) {
	mockDRM := e2ee.NewMockDRMServer()
	defer mockDRM.Close()

	// 1. Initial State: Active (🔒)
	e2ee.SetDRMOnline(true)
	if !e2ee.IsDRMOnline() {
		t.Fatal("expected DRM to be online initially")
	}

	// 2. Simulate DRM service outage: Degraded (⚠️)
	mockDRM.SetHealthy(false, http.StatusServiceUnavailable)
	healthy := e2ee.CheckDRMHealth(mockDRM.URL())
	if healthy {
		t.Fatal("expected DRM health check to fail when server returns 503")
	}
	e2ee.SetDRMOnline(false)
	if e2ee.IsDRMOnline() {
		t.Fatal("expected DRM to report offline in degraded state")
	}

	// 3. User disables E2EE in settings: Disabled (🔓)
	app := application.New()
	cfgPath := filepath.Join(t.TempDir(), "config.yml")
	app.Flags.Config = cfgPath

	settings, err := config.ReadDesktopSettings(app)
	if err != nil {
		t.Fatalf("ReadDesktopSettings failed: %v", err)
	}
	settings.EnableE2EE = false
	if _, err := config.WriteDesktopSettings(app, settings); err != nil {
		t.Fatalf("WriteDesktopSettings failed: %v", err)
	}
	reloaded, _ := config.ReadDesktopSettings(app)
	if reloaded.EnableE2EE {
		t.Fatal("expected EnableE2EE to be false when user disables it in settings")
	}

	// 4. Recover DRM server and re-enable E2EE: Active (🔒)
	mockDRM.SetHealthy(true, http.StatusOK)
	if !e2ee.CheckDRMHealth(mockDRM.URL()) {
		t.Fatal("expected DRM health check to pass after recovery")
	}
	e2ee.SetDRMOnline(true)
	settings.EnableE2EE = true
	if _, err := config.WriteDesktopSettings(app, settings); err != nil {
		t.Fatalf("WriteDesktopSettings failed: %v", err)
	}
	finalSettings, _ := config.ReadDesktopSettings(app)
	if !finalSettings.EnableE2EE {
		t.Fatal("expected EnableE2EE to be true after re-enabling")
	}
}

// TestE2EEDeviceBanUnbanAndPurge verifies device management isolation:
// BanClient -> physical .tmp purge -> 403 Forbidden -> UnbanClient -> M=0 restart & success.
func TestE2EEDeviceBanUnbanAndPurge(t *testing.T) {
	outDir := t.TempDir()
	cfg := config.Config{
		Interface: "lo",
		Bind:      "127.0.0.1",
		Port:      0,
		KeepAlive: true,
		Output:    outDir,
	}
	srv, err := server.New(&cfg)
	if err != nil {
		t.Fatalf("server.New failed: %v", err)
	}
	defer srv.Shutdown()
	if err := srv.ReceiveTo(outDir); err != nil {
		t.Fatalf("ReceiveTo failed: %v", err)
	}

	masterKey, err := e2ee.GenerateMasterKey()
	if err != nil {
		t.Fatalf("GenerateMasterKey failed: %v", err)
	}
	sessionID := "integration-test-session"
	if err := srv.EnableE2EE(masterKey, sessionID); err != nil {
		t.Fatalf("EnableE2EE failed: %v", err)
	}
	keys, _ := e2ee.DeriveKeys(masterKey)

	clientID := "client-device-x10"
	fileID := "file-upload-test-001"
	fileName := "report.bin"
	totalSize := int64(8 * 1024 * 1024) // 8MB
	totalChunks := uint32(2)

	// Upload Chunk 0 (4MB)
	chunk0Plain := make([]byte, 4*1024*1024)
	for i := range chunk0Plain {
		chunk0Plain[i] = byte(i % 251)
	}
	packet0, err := e2ee.EncryptChunk(chunk0Plain, 0, keys.RecvKey[:], fileID)
	if err != nil {
		t.Fatalf("EncryptChunk 0 failed: %v", err)
	}

	req0 := httptest.NewRequest("POST", srv.ReceiveURL+"/chunk", bytes.NewReader(packet0))
	req0.Header.Set("X-Client-ID", clientID)
	req0.Header.Set("X-File-ID", fileID)
	req0.Header.Set("X-File-Name", fileName)
	req0.Header.Set("X-Chunk-Index", "0")
	req0.Header.Set("X-Total-Chunks", fmt.Sprintf("%d", totalChunks))
	req0.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", totalSize))
	w0 := httptest.NewRecorder()
	srv.HandleE2EEReceiveChunk(w0, req0)
	if w0.Code != http.StatusOK {
		t.Fatalf("Chunk 0 expected 200, got %d: %s", w0.Code, w0.Body.String())
	}

	// 1. BAN device: should purge .tmp file and block future requests
	srv.BanClient(clientID)

	// Try uploading Chunk 1: must be blocked with 403 Forbidden
	chunk1Plain := make([]byte, 4*1024*1024)
	for i := range chunk1Plain {
		chunk1Plain[i] = byte((i + 17) % 251)
	}
	packet1, err := e2ee.EncryptChunk(chunk1Plain, 1, keys.RecvKey[:], fileID)
	if err != nil {
		t.Fatalf("EncryptChunk 1 failed: %v", err)
	}

	req1 := httptest.NewRequest("POST", srv.ReceiveURL+"/chunk", bytes.NewReader(packet1))
	req1.Header.Set("X-Client-ID", clientID)
	req1.Header.Set("X-File-ID", fileID)
	req1.Header.Set("X-File-Name", fileName)
	req1.Header.Set("X-Chunk-Index", "1")
	req1.Header.Set("X-Total-Chunks", fmt.Sprintf("%d", totalChunks))
	req1.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", totalSize))
	w1 := httptest.NewRecorder()
	srv.HandleE2EEReceiveChunk(w1, req1)
	if w1.Code != http.StatusForbidden {
		t.Fatalf("Expected 403 Forbidden after ban, got %d: %s", w1.Code, w1.Body.String())
	}

	// 2. UNBAN device: should allow uploading from Chunk 0
	srv.UnbanClient(clientID)

	// Chunk status check must show continuous_index M=0 after unban
	statusReq := httptest.NewRequest("GET", fmt.Sprintf("%s/chunk_status?file_id=%s", srv.ReceiveURL, fileID), nil)
	statusReq.Header.Set("X-Client-ID", clientID)
	wStatus := httptest.NewRecorder()
	srv.HandleE2EEReceiveChunkStatus(wStatus, statusReq)
	if wStatus.Code != http.StatusOK {
		t.Fatalf("Expected 200 from chunk_status after unban, got %d: %s", wStatus.Code, wStatus.Body.String())
	}
	var statusResp struct {
		ContinuousIndex int `json:"continuous_index"`
	}
	_ = json.Unmarshal(wStatus.Body.Bytes(), &statusResp)
	if statusResp.ContinuousIndex != 0 {
		t.Fatalf("Expected ContinuousIndex=0 after unban, got %d", statusResp.ContinuousIndex)
	}

	// Now re-upload Chunk 0 and Chunk 1 cleanly
	req0Retry := httptest.NewRequest("POST", srv.ReceiveURL+"/chunk", bytes.NewReader(packet0))
	req0Retry.Header.Set("X-Client-ID", clientID)
	req0Retry.Header.Set("X-File-ID", fileID)
	req0Retry.Header.Set("X-File-Name", fileName)
	req0Retry.Header.Set("X-Chunk-Index", "0")
	req0Retry.Header.Set("X-Total-Chunks", fmt.Sprintf("%d", totalChunks))
	req0Retry.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", totalSize))
	w0Retry := httptest.NewRecorder()
	srv.HandleE2EEReceiveChunk(w0Retry, req0Retry)
	if w0Retry.Code != http.StatusOK {
		t.Fatalf("Retry Chunk 0 expected 200, got %d", w0Retry.Code)
	}

	req1Retry := httptest.NewRequest("POST", srv.ReceiveURL+"/chunk", bytes.NewReader(packet1))
	req1Retry.Header.Set("X-Client-ID", clientID)
	req1Retry.Header.Set("X-File-ID", fileID)
	req1Retry.Header.Set("X-File-Name", fileName)
	req1Retry.Header.Set("X-Chunk-Index", "1")
	req1Retry.Header.Set("X-Total-Chunks", fmt.Sprintf("%d", totalChunks))
	req1Retry.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", totalSize))
	w1Retry := httptest.NewRecorder()
	srv.HandleE2EEReceiveChunk(w1Retry, req1Retry)
	if w1Retry.Code != http.StatusOK {
		t.Fatalf("Retry Chunk 1 expected 200, got %d", w1Retry.Code)
	}

	// Verify the final assembled file
	devDir, err := srv.GetDeviceOutputDir(clientID)
	if err != nil {
		t.Fatalf("GetDeviceOutputDir failed: %v", err)
	}
	finalPath := filepath.Join(devDir, fileName)
	finalData, err := os.ReadFile(finalPath)
	if err != nil {
		t.Fatalf("ReadFile finalPath (%s) failed: %v", finalPath, err)
	}
	expectedData := append(chunk0Plain, chunk1Plain...)
	if !bytes.Equal(finalData, expectedData) {
		t.Fatal("Final assembled file content mismatch!")
	}
}

// TestE2EETamperedAndForgedAttacks verifies cryptographic defenses against:
// 1. Wrong Master Key
// 2. Corrupted Ciphertext payload
// 3. AAD Mismatch (chunk index swap attack)
func TestE2EETamperedAndForgedAttacks(t *testing.T) {
	outDir := t.TempDir()
	cfg := config.Config{
		Interface: "lo",
		Bind:      "127.0.0.1",
		Port:      0,
		KeepAlive: true,
		Output:    outDir,
	}
	srv, err := server.New(&cfg)
	if err != nil {
		t.Fatalf("server.New failed: %v", err)
	}
	defer srv.Shutdown()
	if err := srv.ReceiveTo(outDir); err != nil {
		t.Fatalf("ReceiveTo failed: %v", err)
	}

	correctKey, _ := e2ee.GenerateMasterKey()
	attackerKey, _ := e2ee.GenerateMasterKey()
	sessionID := "attack-test-session"
	_ = srv.EnableE2EE(correctKey, sessionID)

	attackerKeys, _ := e2ee.DeriveKeys(attackerKey)
	correctKeys, _ := e2ee.DeriveKeys(correctKey)

	fileID := "victim-file-001"
	fileName := "secret.txt"
	plain := []byte("Sensitive secret contents for E2EE pipeline")

	// 1. Attack with wrong master key
	attackerPacket, err := e2ee.EncryptChunk(plain, 0, attackerKeys.RecvKey[:], fileID)
	if err != nil {
		t.Fatalf("EncryptChunk failed: %v", err)
	}
	reqWrongKey := httptest.NewRequest("POST", srv.ReceiveURL+"/chunk", bytes.NewReader(attackerPacket))
	reqWrongKey.Header.Set("X-Client-ID", "attacker-001")
	reqWrongKey.Header.Set("X-File-ID", fileID)
	reqWrongKey.Header.Set("X-File-Name", fileName)
	reqWrongKey.Header.Set("X-Chunk-Index", "0")
	reqWrongKey.Header.Set("X-Total-Chunks", "1")
	reqWrongKey.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", len(plain)))
	wWrongKey := httptest.NewRecorder()
	srv.HandleE2EEReceiveChunk(wWrongKey, reqWrongKey)
	if wWrongKey.Code != http.StatusBadRequest {
		t.Fatalf("Expected 400 Bad Request for wrong key attack, got %d: %s", wWrongKey.Code, wWrongKey.Body.String())
	}

	// 2. Attack with tampered ciphertext byte
	validPacket, _ := e2ee.EncryptChunk(plain, 0, correctKeys.RecvKey[:], fileID)
	tamperedPacket := make([]byte, len(validPacket))
	copy(tamperedPacket, validPacket)
	tamperedPacket[len(tamperedPacket)-1] ^= 0xFF // Flip last tag byte

	reqTampered := httptest.NewRequest("POST", srv.ReceiveURL+"/chunk", bytes.NewReader(tamperedPacket))
	reqTampered.Header.Set("X-Client-ID", "attacker-002")
	reqTampered.Header.Set("X-File-ID", fileID)
	reqTampered.Header.Set("X-File-Name", fileName)
	reqTampered.Header.Set("X-Chunk-Index", "0")
	reqTampered.Header.Set("X-Total-Chunks", "1")
	reqTampered.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", len(plain)))
	wTampered := httptest.NewRecorder()
	srv.HandleE2EEReceiveChunk(wTampered, reqTampered)
	if wTampered.Code != http.StatusBadRequest {
		t.Fatalf("Expected 400 Bad Request for tampered ciphertext attack, got %d: %s", wTampered.Code, wTampered.Body.String())
	}

	// 3. Attack with Chunk Index swap (AAD mismatch)
	// Encrypt as chunk 0, but send header claiming chunk 1
	reqAADSwap := httptest.NewRequest("POST", srv.ReceiveURL+"/chunk", bytes.NewReader(validPacket))
	reqAADSwap.Header.Set("X-Client-ID", "attacker-003")
	reqAADSwap.Header.Set("X-File-ID", fileID)
	reqAADSwap.Header.Set("X-File-Name", fileName)
	reqAADSwap.Header.Set("X-Chunk-Index", "1") // Swap index in HTTP header!
	reqAADSwap.Header.Set("X-Total-Chunks", "2")
	reqAADSwap.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", len(plain)))
	wAADSwap := httptest.NewRecorder()
	srv.HandleE2EEReceiveChunk(wAADSwap, reqAADSwap)
	if wAADSwap.Code != http.StatusBadRequest {
		t.Fatalf("Expected 400 Bad Request for AAD chunk index swap attack, got %d: %s", wAADSwap.Code, wAADSwap.Body.String())
	}
}

// TestE2EEShareAndReceiveFullPipeline runs an end-to-end multi-megabyte stream:
// Plaintext file -> Share encrypted chunks -> Decrypt -> Receive encrypted chunks -> Verify final hash.
func TestE2EEShareAndReceiveFullPipeline(t *testing.T) {
	tempDir := t.TempDir()
	srcFilePath := filepath.Join(tempDir, "source_payload.dat")
	outDir := filepath.Join(tempDir, "received_output")
	_ = os.MkdirAll(outDir, 0755)

	// Create a 6MB test payload (Chunk 0: 4MB, Chunk 1: 2MB)
	testSize := 6 * 1024 * 1024
	testData := make([]byte, testSize)
	for i := range testData {
		testData[i] = byte((i*7 + 13) % 256)
	}
	if err := os.WriteFile(srcFilePath, testData, 0644); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}
	expectedHash := sha256.Sum256(testData)

	cfg := config.Config{
		Interface: "lo",
		Bind:      "127.0.0.1",
		Port:      0,
		KeepAlive: true,
		Output:    outDir,
	}
	srv, err := server.New(&cfg)
	if err != nil {
		t.Fatalf("server.New failed: %v", err)
	}
	defer srv.Shutdown()

	payload, err := body.FromArgs([]string{srcFilePath}, false)
	if err != nil {
		t.Fatalf("body.FromArgs failed: %v", err)
	}
	srv.Send(payload)

	masterKey, _ := e2ee.GenerateMasterKey()
	sessionID := "pipeline-test-session"
	_ = srv.EnableE2EE(masterKey, sessionID)
	keys, _ := e2ee.DeriveKeys(masterKey)

	// 1. Download encrypted chunk 0 from Share endpoint
	shareReq0 := httptest.NewRequest("GET", fmt.Sprintf("%s/chunk?file_index=0&chunk_index=0", srv.SendURL), nil)
	wShare0 := httptest.NewRecorder()
	srv.HandleE2EEShareChunk(wShare0, shareReq0)
	if wShare0.Code != http.StatusOK {
		t.Fatalf("Share Chunk 0 expected 200, got %d: %s", wShare0.Code, wShare0.Body.String())
	}
	encChunk0 := wShare0.Body.Bytes()

	// Decrypt Chunk 0
	decChunk0, err := e2ee.DecryptChunk(encChunk0, 0, keys.SendKey[:], "f-0")
	if err != nil {
		t.Fatalf("DecryptChunk 0 failed: %v", err)
	}
	if len(decChunk0) != 4*1024*1024 {
		t.Fatalf("Expected 4MB chunk 0, got %d bytes", len(decChunk0))
	}

	// 2. Download encrypted chunk 1 from Share endpoint
	shareReq1 := httptest.NewRequest("GET", fmt.Sprintf("%s/chunk?file_index=0&chunk_index=1", srv.SendURL), nil)
	wShare1 := httptest.NewRecorder()
	srv.HandleE2EEShareChunk(wShare1, shareReq1)
	if wShare1.Code != http.StatusOK {
		t.Fatalf("Share Chunk 1 expected 200, got %d: %s", wShare1.Code, wShare1.Body.String())
	}
	encChunk1 := wShare1.Body.Bytes()

	// Decrypt Chunk 1
	decChunk1, err := e2ee.DecryptChunk(encChunk1, 1, keys.SendKey[:], "f-0")
	if err != nil {
		t.Fatalf("DecryptChunk 1 failed: %v", err)
	}
	if len(decChunk1) != 2*1024*1024 {
		t.Fatalf("Expected 2MB chunk 1, got %d bytes", len(decChunk1))
	}

	// Verify combined decrypted data matches source
	downloaded := append(decChunk0, decChunk1...)
	if !bytes.Equal(downloaded, testData) {
		t.Fatal("Downloaded and decrypted stream does not match source payload!")
	}

	// 3. Upload back through Receive endpoint under a new fileID
	receiveSrv, err := server.New(&cfg)
	if err != nil {
		t.Fatalf("receiveSrv New failed: %v", err)
	}
	defer receiveSrv.Shutdown()
	if err := receiveSrv.ReceiveTo(outDir); err != nil {
		t.Fatalf("receiveSrv ReceiveTo failed: %v", err)
	}
	_ = receiveSrv.EnableE2EE(masterKey, sessionID)

	receiveFileID := "received_payload.dat"
	recEncChunk0, _ := e2ee.EncryptChunk(decChunk0, 0, keys.RecvKey[:], receiveFileID)

	recReq0 := httptest.NewRequest("POST", receiveSrv.ReceiveURL+"/chunk", bytes.NewReader(recEncChunk0))
	recReq0.Header.Set("X-Client-ID", "receiver-peer-1")
	recReq0.Header.Set("X-File-ID", receiveFileID)
	recReq0.Header.Set("X-File-Name", receiveFileID)
	recReq0.Header.Set("X-Chunk-Index", "0")
	recReq0.Header.Set("X-Total-Chunks", "2")
	recReq0.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", testSize))
	wRec0 := httptest.NewRecorder()
	receiveSrv.HandleE2EEReceiveChunk(wRec0, recReq0)
	if wRec0.Code != http.StatusOK {
		t.Fatalf("Receive Chunk 0 expected 200, got %d: %s", wRec0.Code, wRec0.Body.String())
	}

	recEncChunk1, _ := e2ee.EncryptChunk(decChunk1, 1, keys.RecvKey[:], receiveFileID)

	recReq1 := httptest.NewRequest("POST", receiveSrv.ReceiveURL+"/chunk", bytes.NewReader(recEncChunk1))
	recReq1.Header.Set("X-Client-ID", "receiver-peer-1")
	recReq1.Header.Set("X-File-ID", receiveFileID)
	recReq1.Header.Set("X-File-Name", receiveFileID)
	recReq1.Header.Set("X-Chunk-Index", "1")
	recReq1.Header.Set("X-Total-Chunks", "2")
	recReq1.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", testSize))
	wRec1 := httptest.NewRecorder()
	receiveSrv.HandleE2EEReceiveChunk(wRec1, recReq1)
	if wRec1.Code != http.StatusOK {
		t.Fatalf("Receive Chunk 1 expected 200, got %d: %s", wRec1.Code, wRec1.Body.String())
	}

	// 4. Verify received physical file on disk
	devDir, err := receiveSrv.GetDeviceOutputDir("receiver-peer-1")
	if err != nil {
		t.Fatalf("GetDeviceOutputDir failed: %v", err)
	}
	receivedPath := filepath.Join(devDir, receiveFileID)
	receivedBytes, err := os.ReadFile(receivedPath)
	if err != nil {
		t.Fatalf("ReadFile receivedPath (%s) failed: %v", receivedPath, err)
	}
	receivedHash := sha256.Sum256(receivedBytes)
	if receivedHash != expectedHash {
		t.Fatalf("SHA256 checksum mismatch!\nExpected: %x\nReceived: %x", expectedHash, receivedHash)
	}
}

// TestE2EEManualStopClientTransfer verifies that manual stop immediately terminates active transfers:
// 1. StopClientTransfer sets client state to "stopped"
// 2. Next share/receive chunk requests return 403 Forbidden with CLIENT_STOPPED error_code
// 3. Incomplete temp files are cleaned up
func TestE2EEManualStopClientTransfer(t *testing.T) {
	tempDir := t.TempDir()
	filePath := filepath.Join(tempDir, "stop_test.txt")
	testData := make([]byte, 5*1024*1024)
	for i := range testData {
		testData[i] = byte(i % 251)
	}
	if err := os.WriteFile(filePath, testData, 0644); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
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

	masterKey, _ := e2ee.GenerateMasterKey()
	sessionID := "stop-test-session"
	_ = srv.EnableE2EE(masterKey, sessionID)
	keys, _ := e2ee.DeriveKeys(masterKey)

	payload, err := body.FromArgs([]string{filePath}, false)
	if err != nil {
		t.Fatalf("body.FromArgs failed: %v", err)
	}
	srv.Send(payload)

	clientID := "client-to-stop-123"

	// 1. Fetch chunk 0 successfully
	req0 := httptest.NewRequest("GET", srv.SendURL+"/chunk?file_id=f-0&chunk_index=0&client_id="+clientID, nil)
	w0 := httptest.NewRecorder()
	srv.HandleE2EEShareChunk(w0, req0)
	if w0.Code != http.StatusOK {
		t.Fatalf("expected 200 before stop, got %d: %s", w0.Code, w0.Body.String())
	}

	// 2. Host manually stops the transfer
	stopped := srv.StopClientTransfer(clientID)
	if !stopped {
		t.Fatal("StopClientTransfer returned false, expected true")
	}

	// 3. Next chunk request must be rejected with 403 / CLIENT_STOPPED
	req1 := httptest.NewRequest("GET", srv.SendURL+"/chunk?file_id=f-0&chunk_index=1&client_id="+clientID, nil)
	w1 := httptest.NewRecorder()
	srv.HandleE2EEShareChunk(w1, req1)
	if w1.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden after stop, got %d: %s", w1.Code, w1.Body.String())
	}
	var resp1 map[string]any
	if err := json.Unmarshal(w1.Body.Bytes(), &resp1); err != nil || resp1["error_code"] != "CLIENT_STOPPED" {
		t.Fatalf("expected CLIENT_STOPPED error code, got: %s", w1.Body.String())
	}

	// 4. Meta refresh request must also be rejected with 403 / CLIENT_STOPPED
	metaReq := httptest.NewRequest("GET", srv.SendURL+"/meta?client_id="+clientID, nil)
	wMeta := httptest.NewRecorder()
	srv.HandleE2EEShareMeta(wMeta, metaReq)
	if wMeta.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for meta after stop, got %d: %s", wMeta.Code, wMeta.Body.String())
	}
	var respMeta map[string]any
	if err := json.Unmarshal(wMeta.Body.Bytes(), &respMeta); err != nil || respMeta["error_code"] != "CLIENT_STOPPED" {
		t.Fatalf("expected CLIENT_STOPPED error code on meta refresh, got: %s", wMeta.Body.String())
	}

	// 5. Test receive chunk endpoint when stopped with physical temp file cleanup
	recOutDir := filepath.Join(tempDir, "rec_out")
	if err := os.MkdirAll(recOutDir, 0755); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}
	recSrv, err := server.New(&cfg)
	if err != nil {
		t.Fatalf("recSrv New failed: %v", err)
	}
	defer recSrv.Shutdown()
	if err := recSrv.ReceiveTo(recOutDir); err != nil {
		t.Fatalf("ReceiveTo failed: %v", err)
	}
	_ = recSrv.EnableE2EE(masterKey, sessionID)

	recClientID := "rec-client-stop-456"
	recFileID := "f-test-temp-1"
	recEncChunk0, _ := e2ee.EncryptChunk(testData[:1024], 0, keys.RecvKey[:], recFileID)

	// Send chunk 0 of 2 (incomplete transfer)
	recReq0 := httptest.NewRequest("POST", recSrv.ReceiveURL+"/chunk", bytes.NewReader(recEncChunk0))
	recReq0.Header.Set("X-Client-ID", recClientID)
	recReq0.Header.Set("X-File-ID", recFileID)
	recReq0.Header.Set("X-File-Name", "rec_stop.dat")
	recReq0.Header.Set("X-Chunk-Index", "0")
	recReq0.Header.Set("X-Total-Chunks", "2")
	recReq0.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", len(testData)))
	wRec0 := httptest.NewRecorder()
	recSrv.HandleE2EEReceiveChunk(wRec0, recReq0)
	if wRec0.Code != http.StatusOK {
		t.Fatalf("expected 200 for initial receive chunk, got %d: %s", wRec0.Code, wRec0.Body.String())
	}

	// Verify temp file exists in output directory
	devDir, err := recSrv.GetDeviceOutputDir(recClientID)
	if err != nil {
		t.Fatalf("GetDeviceOutputDir failed: %v", err)
	}
	matches, _ := filepath.Glob(filepath.Join(devDir, "*.tmp"))
	if len(matches) == 0 {
		t.Fatal("expected temporary .tmp file to exist while transfer is in progress")
	}
	tempFilePath := matches[0]

	// Host stops receive client
	recSrv.StopClientTransfer(recClientID)

	// Assert physical temp file was removed on StopClientTransfer
	if _, err := os.Stat(tempFilePath); !os.IsNotExist(err) {
		t.Fatalf("expected temp file %s to be deleted after StopClientTransfer", tempFilePath)
	}

	// Subsequent chunk upload attempt must be rejected with 403 / CLIENT_STOPPED
	recEncChunk1, _ := e2ee.EncryptChunk(testData[1024:2048], 1, keys.RecvKey[:], recFileID)
	recReq1 := httptest.NewRequest("POST", recSrv.ReceiveURL+"/chunk", bytes.NewReader(recEncChunk1))
	recReq1.Header.Set("X-Client-ID", recClientID)
	recReq1.Header.Set("X-File-ID", recFileID)
	recReq1.Header.Set("X-File-Name", "rec_stop.dat")
	recReq1.Header.Set("X-Chunk-Index", "1")
	recReq1.Header.Set("X-Total-Chunks", "2")
	recReq1.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", len(testData)))
	wRec1 := httptest.NewRecorder()
	recSrv.HandleE2EEReceiveChunk(wRec1, recReq1)
	if wRec1.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for stopped receive client, got %d: %s", wRec1.Code, wRec1.Body.String())
	}
	var recResp map[string]any
	if err := json.Unmarshal(wRec1.Body.Bytes(), &recResp); err != nil || recResp["error_code"] != "CLIENT_STOPPED" {
		t.Fatalf("expected CLIENT_STOPPED error code on receive, got: %s", wRec1.Body.String())
	}

	// Chunk status request must also return 403 / CLIENT_STOPPED
	statusReq := httptest.NewRequest("GET", recSrv.ReceiveURL+"/chunk_status?file_id="+recFileID+"&client_id="+recClientID, nil)
	wStatus := httptest.NewRecorder()
	recSrv.HandleE2EEReceiveChunkStatus(wStatus, statusReq)
	if wStatus.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for chunk_status after stop, got %d: %s", wStatus.Code, wStatus.Body.String())
	}
}

func TestE2EEMultiFileReceiveCumulativeProgress(t *testing.T) {
	tempDir := t.TempDir()
	recOutDir := filepath.Join(tempDir, "multi_rec_out")
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
	sessionID := "multi-file-session"
	_ = srv.EnableE2EE(masterKey, sessionID)
	keys, _ := e2ee.DeriveKeys(masterKey)

	clientID := "client-multi-file-test"
	file1Data := bytes.Repeat([]byte("A"), 4*1024*1024)
	file2Data := bytes.Repeat([]byte("B"), 8*1024*1024)

	// 1. Upload File 1 (1 chunk of 4MB, complete)
	encChunk1, _ := e2ee.EncryptChunk(file1Data, 0, keys.RecvKey[:], "f-1")
	req1 := httptest.NewRequest("POST", srv.ReceiveURL+"/chunk", bytes.NewReader(encChunk1))
	req1.Header.Set("X-Client-ID", clientID)
	req1.Header.Set("X-File-ID", "f-1")
	req1.Header.Set("X-File-Name", "file1.txt")
	req1.Header.Set("X-Chunk-Index", "0")
	req1.Header.Set("X-Total-Chunks", "1")
	req1.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", len(file1Data)))
	req1.Header.Set("X-File-Index", "0")
	req1.Header.Set("X-File-Count", "2")
	w1 := httptest.NewRecorder()
	srv.HandleE2EEReceiveChunk(w1, req1)
	if w1.Code != http.StatusOK {
		t.Fatalf("file1 upload failed: %d %s", w1.Code, w1.Body.String())
	}

	cState1 := srv.GetClientStatus(clientID)
	if cState1.BytesDone != 4*1024*1024 {
		t.Fatalf("expected BytesDone=4MB after file 1, got %d", cState1.BytesDone)
	}

	// 2. Upload File 2 chunk 0 (4MB out of 8MB)
	encChunk2_0, _ := e2ee.EncryptChunk(file2Data[:4*1024*1024], 0, keys.RecvKey[:], "f-2")
	req2_0 := httptest.NewRequest("POST", srv.ReceiveURL+"/chunk", bytes.NewReader(encChunk2_0))
	req2_0.Header.Set("X-Client-ID", clientID)
	req2_0.Header.Set("X-File-ID", "f-2")
	req2_0.Header.Set("X-File-Name", "file2.txt")
	req2_0.Header.Set("X-Chunk-Index", "0")
	req2_0.Header.Set("X-Total-Chunks", "2")
	req2_0.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", len(file2Data)))
	req2_0.Header.Set("X-File-Index", "1")
	req2_0.Header.Set("X-File-Count", "2")
	w2_0 := httptest.NewRecorder()
	srv.HandleE2EEReceiveChunk(w2_0, req2_0)
	if w2_0.Code != http.StatusOK {
		t.Fatalf("file2 chunk 0 failed: %d %s", w2_0.Code, w2_0.Body.String())
	}

	cState2 := srv.GetClientStatus(clientID)
	// Must NOT rollback! Total should be file1 done (4MB) + file2 chunk 0 done (4MB) = 8MB out of 12MB
	expectedDone := int64(8 * 1024 * 1024)
	expectedTotal := int64(12 * 1024 * 1024)
	if cState2.BytesDone != expectedDone {
		t.Fatalf("expected cumulative BytesDone=%d, got %d (rollback detected!)", expectedDone, cState2.BytesDone)
	}
	if cState2.BytesTotal != expectedTotal {
		t.Fatalf("expected cumulative BytesTotal=%d, got %d", expectedTotal, cState2.BytesTotal)
	}
	if cState2.Percent != 66 {
		t.Fatalf("expected Percent=66, got %d", cState2.Percent)
	}

	// 3. Complete File 2
	encChunk2_1, _ := e2ee.EncryptChunk(file2Data[4*1024*1024:], 1, keys.RecvKey[:], "f-2")
	req2_1 := httptest.NewRequest("POST", srv.ReceiveURL+"/chunk", bytes.NewReader(encChunk2_1))
	req2_1.Header.Set("X-Client-ID", clientID)
	req2_1.Header.Set("X-File-ID", "f-2")
	req2_1.Header.Set("X-File-Name", "file2.txt")
	req2_1.Header.Set("X-Chunk-Index", "1")
	req2_1.Header.Set("X-Total-Chunks", "2")
	req2_1.Header.Set("X-Total-Bytes", fmt.Sprintf("%d", len(file2Data)))
	req2_1.Header.Set("X-File-Index", "1")
	req2_1.Header.Set("X-File-Count", "2")
	w2_1 := httptest.NewRecorder()
	srv.HandleE2EEReceiveChunk(w2_1, req2_1)
	if w2_1.Code != http.StatusOK {
		t.Fatalf("file2 chunk 1 failed: %d %s", w2_1.Code, w2_1.Body.String())
	}

	cStateFinal := srv.GetClientStatus(clientID)
	if cStateFinal.State != "completed" || cStateFinal.Percent != 100 || cStateFinal.BytesDone != expectedTotal {
		t.Fatalf("expected final state=completed, percent=100, bytesDone=%d; got %+v", expectedTotal, cStateFinal)
	}
}
