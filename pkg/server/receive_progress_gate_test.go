package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"eqt/pkg/config"
)

func TestReceiveTusSafetyGate_InitAndDone(t *testing.T) {
	SetUsedReceiveTransfers(0)
	SetUsedTransfers(0)
	defer func() {
		SetUsedReceiveTransfers(0)
		SetUsedTransfers(0)
	}()

	tempDir, err := os.MkdirTemp("", "eqt_recv_gate_test")
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

	clientID := "client_tus_gate_001"

	// 1. Test ?init=true with 2 declared files
	initPayload := map[string]interface{}{
		"files": []map[string]interface{}{
			{"name": "fileA.bin", "size": 1024},
			{"name": "fileB.bin", "size": 2048},
		},
	}
	initBody, _ := json.Marshal(initPayload)
	reqInit := httptest.NewRequest("POST", srv.ReceiveURL+"?init=true&client_id="+clientID, bytes.NewReader(initBody))
	reqInit.Header.Set("Content-Type", "application/json")
	recInit := httptest.NewRecorder()
	srv.mux.ServeHTTP(recInit, reqInit)

	if recInit.Code != http.StatusOK {
		t.Fatalf("init request failed: status %d, body %s", recInit.Code, recInit.Body.String())
	}

	cs := srv.getClientStatus(clientID)
	if !cs.FilesDeclared {
		t.Errorf("expected FilesDeclared to be true after ?init=true")
	}
	if len(cs.Files) != 2 {
		t.Fatalf("expected 2 files declared, got %d", len(cs.Files))
	}
	if cs.BytesTotal != 3072 {
		t.Errorf("expected BytesTotal 3072, got %d", cs.BytesTotal)
	}
	if cs.State != "transferring" {
		t.Errorf("expected state 'transferring', got %q", cs.State)
	}

	// 2. Simulate file 1 completion when files are declared
	dummyFile1 := filepath.Join(tempDir, "fileA.bin")
	_ = os.WriteFile(dummyFile1, make([]byte, 1024), 0644)

	srv.updateClientStatus(clientID, nil, func(cs *ClientTransferStateInfo) {
		cs.SavedFiles = append(cs.SavedFiles, dummyFile1)
		cs.BytesDone = 1024
		cs.Percent = transferPercent(cs.BytesDone, cs.BytesTotal)
		cs.Files[0].State = "completed"
		cs.Files[0].BytesDone = 1024
		cs.Files[0].Percent = 100
		cs.Files[0].Path = dummyFile1

		// Gate check:
		if cs.FilesDeclared && len(cs.Files) > 0 && (len(cs.SavedFiles) >= len(cs.Files) || (cs.BytesTotal > 0 && cs.BytesDone >= cs.BytesTotal)) {
			cs.State = "completed"
		}
	})

	cs = srv.getClientStatus(clientID)
	if cs.State == "completed" {
		t.Errorf("client state should NOT be completed after only 1 of 2 files finished")
	}

	// 3. Simulate file 2 completion -> now all declared files are saved
	dummyFile2 := filepath.Join(tempDir, "fileB.bin")
	_ = os.WriteFile(dummyFile2, make([]byte, 2048), 0644)

	srv.updateClientStatus(clientID, nil, func(cs *ClientTransferStateInfo) {
		cs.SavedFiles = append(cs.SavedFiles, dummyFile2)
		cs.BytesDone = 3072
		cs.Percent = transferPercent(cs.BytesDone, cs.BytesTotal)
		cs.Files[1].State = "completed"
		cs.Files[1].BytesDone = 2048
		cs.Files[1].Percent = 100
		cs.Files[1].Path = dummyFile2

		if cs.FilesDeclared && len(cs.Files) > 0 && (len(cs.SavedFiles) >= len(cs.Files) || (cs.BytesTotal > 0 && cs.BytesDone >= cs.BytesTotal)) {
			cs.State = "completed"
		}
	})

	cs = srv.getClientStatus(clientID)
	if cs.State != "completed" {
		t.Errorf("expected state 'completed' after all 2 declared files finished, got %q", cs.State)
	}

	// 4. Test undeclared client (no ?init=true called)
	undeclaredID := "client_undeclared_002"
	srv.updateClientStatus(undeclaredID, nil, func(cs *ClientTransferStateInfo) {
		cs.SavedFiles = append(cs.SavedFiles, dummyFile1)
		cs.Files = append(cs.Files, ClientFileTransferState{
			Name:       "fileA.bin",
			Path:       dummyFile1,
			State:      "completed",
			BytesDone:  1024,
			BytesTotal: 1024,
			Percent:    100,
		})

		// Undeclared gate check:
		if cs.FilesDeclared && len(cs.Files) > 0 && (len(cs.SavedFiles) >= len(cs.Files) || (cs.BytesTotal > 0 && cs.BytesDone >= cs.BytesTotal)) {
			cs.State = "completed"
		} else if !cs.FilesDeclared {
			cs.State = "waiting"
			cs.Message = fmt.Sprintf("Received %s. Waiting for more files.", "fileA.bin")
		}
	})

	csUnd := srv.getClientStatus(undeclaredID)
	if csUnd.State == "completed" {
		t.Errorf("undeclared client must NOT be marked completed on single file completion")
	}
	if csUnd.State != "waiting" {
		t.Errorf("expected state 'waiting', got %q", csUnd.State)
	}

	// 5. Test ?done=true for undeclared client -> explicitly completes the session
	reqDone := httptest.NewRequest("POST", srv.ReceiveURL+"?done=true&client_id="+undeclaredID, nil)
	recDone := httptest.NewRecorder()
	srv.mux.ServeHTTP(recDone, reqDone)

	if recDone.Code != http.StatusOK {
		t.Fatalf("done request failed: status %d", recDone.Code)
	}

	csUnd = srv.getClientStatus(undeclaredID)
	if csUnd.State != "completed" {
		t.Errorf("expected state 'completed' after ?done=true, got %q", csUnd.State)
	}
	if csUnd.Percent != 100 {
		t.Errorf("expected percent 100 after ?done=true, got %d", csUnd.Percent)
	}
}

func TestReceiveMultipartProgress_MultiFileStreaming(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "eqt_recv_multipart_test")
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

	clientID := "client_multipart_multi"
	file1Content := bytes.Repeat([]byte("A"), 512*1024)  // 512 KB
	file2Content := bytes.Repeat([]byte("B"), 1024*1024) // 1024 KB
	totalContentSize := int64(len(file1Content) + len(file2Content))

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	// Add fileMetadata
	metaField, err := writer.CreateFormField("fileMetadata")
	if err != nil {
		t.Fatal(err)
	}
	metadataStr := fmt.Sprintf("%s:%d,%s:%d",
		url.QueryEscape("doc1.dat"), len(file1Content),
		url.QueryEscape("doc2.dat"), len(file2Content),
	)
	_, _ = metaField.Write([]byte(metadataStr))

	// Add file 1
	part1, err := writer.CreateFormFile("files", "doc1.dat")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part1.Write(file1Content)

	// Add file 2
	part2, err := writer.CreateFormFile("files", "doc2.dat")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part2.Write(file2Content)

	_ = writer.Close()

	req := httptest.NewRequest("POST", srv.ReceiveURL+"?client_id="+clientID, body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	srv.mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("multipart upload failed with status %d: %s", rec.Code, rec.Body.String())
	}

	cs := srv.getClientStatus(clientID)
	if cs.State != "completed" {
		t.Errorf("expected completed state, got %q", cs.State)
	}
	if cs.BytesDone != totalContentSize {
		t.Errorf("expected BytesDone %d, got %d", totalContentSize, cs.BytesDone)
	}
	if cs.BytesTotal != totalContentSize {
		t.Errorf("expected BytesTotal %d, got %d", totalContentSize, cs.BytesTotal)
	}
	if cs.Percent != 100 {
		t.Errorf("expected Percent 100, got %d", cs.Percent)
	}
	if len(cs.SavedFiles) != 2 {
		t.Errorf("expected 2 saved files, got %d", len(cs.SavedFiles))
	}
	if len(cs.Files) != 2 {
		t.Errorf("expected 2 items in cs.Files, got %d", len(cs.Files))
	}
	for _, f := range cs.Files {
		if f.State != "completed" {
			t.Errorf("expected file %s to be completed, got %q", f.Name, f.State)
		}
		if f.Percent != 100 {
			t.Errorf("expected file %s percent 100, got %d", f.Name, f.Percent)
		}
	}
}

func TestReceiveTusDoneAutoStopBehavior(t *testing.T) {
	outputDir := t.TempDir()
	cfg := config.Config{
		Interface: "lo",
		Bind:      "127.0.0.1",
		Port:      18099,
		Path:      "test-autostop",
		KeepAlive: true,
		Output:    outputDir,
	}
	srv, err := New(&cfg)
	if err != nil {
		t.Fatal(err)
	}

	clientID := "client-autostop-test"
	req := httptest.NewRequest("GET", "/test", nil)
	srv.registerClientActivityWithID(clientID, req)

	// 1. Initial state: autoStop is false, KeepAlive is true
	srv.statusMu.Lock()
	srv.autoStop = false
	srv.status.AutoStop = false
	srv.status.State = "waiting"
	srv.statusMu.Unlock()

	// 2. Simulate Tus client finished and sending ?done=true
	doneReq := httptest.NewRequest("POST", srv.ReceiveURL+"?done=true&client_id="+clientID, nil)
	doneRec := httptest.NewRecorder()
	srv.mux.ServeHTTP(doneRec, doneReq)

	if doneRec.Code != http.StatusOK {
		t.Fatalf("expected status OK for ?done=true, got %d", doneRec.Code)
	}

	// Assert: client state is completed
	cs := srv.getClientStatus(clientID)
	if cs.State != "completed" {
		t.Fatalf("expected client state completed, got %q", cs.State)
	}

	// Critical Assert: Global server status must NOT be 'completed' when autoStop is false!
	// It must stay 'waiting' so desktop GUI does not exit prematurely.
	srv.statusMu.Lock()
	globalState := srv.status.State
	globalMsg := srv.status.Message
	srv.statusMu.Unlock()

	if globalState != "waiting" {
		t.Fatalf("expected global status to remain 'waiting' when autoStop is false, got %q", globalState)
	}
	if globalMsg != "Transfer completed. Waiting for more files." {
		t.Fatalf("expected global message 'Transfer completed. Waiting for more files.', got %q", globalMsg)
	}

	// Verify stopChannel did not receive any signal
	select {
	case <-srv.stopChannel:
		t.Fatal("server stopChannel fired even though autoStop was false!")
	default:
		// OK
	}

	// 3. Test scenario with autoStop = true:
	// When autoStop is enabled before/during transfer, sending ?done=true should trigger completed state.
	clientID2 := "client-autostop-true"
	req2 := httptest.NewRequest("GET", "/test2", nil)
	srv.registerClientActivityWithID(clientID2, req2)

	srv.statusMu.Lock()
	srv.autoStop = true
	srv.status.AutoStop = true
	srv.statusMu.Unlock()

	doneReq2 := httptest.NewRequest("POST", srv.ReceiveURL+"?done=true&client_id="+clientID2, nil)
	doneRec2 := httptest.NewRecorder()
	srv.mux.ServeHTTP(doneRec2, doneReq2)

	if doneRec2.Code != http.StatusOK {
		t.Fatalf("expected status OK for ?done=true, got %d", doneRec2.Code)
	}

	srv.statusMu.Lock()
	newGlobalState := srv.status.State
	srv.statusMu.Unlock()

	if newGlobalState != "completed" {
		t.Fatalf("expected global status 'completed' when autoStop is true, got %q", newGlobalState)
	}
}
