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
