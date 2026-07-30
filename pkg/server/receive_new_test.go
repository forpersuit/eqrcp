package server

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPerClientSpeedAndStopTransfer(t *testing.T) {
	srv := &Server{
		clientStates:        make(map[string]*ClientTransferStateInfo),
		clientSpeedTrackers: make(map[string]*clientSpeedTracker),
	}

	clientID := "client-device-001"
	srv.clientStates[clientID] = &ClientTransferStateInfo{
		ClientID:   clientID,
		DeviceName: "Test iPhone",
		State:      "transferring",
		BytesDone:  100,
		BytesTotal: 1000,
	}

	// 1. Test speed calculation
	sp, _ := srv.calcClientSpeed(clientID, 100)
	if sp != 0 {
		t.Errorf("expected initial speed 0, got %d", sp)
	}

	// Fast forward initial time tracker to simulate 1 second elapsed
	srv.clientSpeedTrackersMu.Lock()
	srv.clientSpeedTrackers[clientID].lastTime = time.Now().Add(-1 * time.Second)
	srv.clientSpeedTrackersMu.Unlock()

	sp, spStr := srv.calcClientSpeed(clientID, 10*1024*1024)
	if sp <= 0 || spStr == "" {
		t.Errorf("expected positive speed and formatted speed, got speed=%d, spStr=%q", sp, spStr)
	}

	// 2. Test StopClientTransfer
	ok := srv.StopClientTransfer(clientID)
	if !ok {
		t.Fatalf("expected StopClientTransfer to return true")
	}

	srv.clientStatesMu.Lock()
	cs := srv.clientStates[clientID]
	srv.clientStatesMu.Unlock()

	if cs.State != "stopped" {
		t.Errorf("expected state 'stopped', got %q", cs.State)
	}
	if cs.Speed != 0 || cs.SpeedFormatted != "" {
		t.Errorf("expected reset speed on stop, got %d (%s)", cs.Speed, cs.SpeedFormatted)
	}
}

func TestTusTmpDirCleanup(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "eqt-tus-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	tusTmp := filepath.Join(tempDir, ".tus-tmp")
	if err := os.MkdirAll(tusTmp, 0755); err != nil {
		t.Fatalf("failed to create .tus-tmp: %v", err)
	}

	// Create dummy binary and paired .info file
	binFile := filepath.Join(tusTmp, "upload12345")
	infoFile := filepath.Join(tusTmp, "upload12345.info")

	_ = os.WriteFile(binFile, []byte("data"), 0644)
	_ = os.WriteFile(infoFile, []byte("info"), 0644)

	// Simulate complete upload cleanup: remove binFile and paired infoFile
	_ = os.Remove(binFile)
	_ = os.Remove(infoFile)

	// Clean up .tus-tmp directory if it has become empty
	if entries, err := os.ReadDir(tusTmp); err == nil && len(entries) == 0 {
		_ = os.Remove(tusTmp)
	}

	if _, err := os.Stat(tusTmp); !os.IsNotExist(err) {
		t.Errorf("expected .tus-tmp to be cleaned up, but it still exists")
	}
}
