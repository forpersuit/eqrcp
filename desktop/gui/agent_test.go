package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"eqt/pkg/server"
)

func TestGUIAgentHistoryDeDuplicate(t *testing.T) {
	historyPath := filepath.Join(t.TempDir(), "gui_history_dedup.json")
	agent := newDesktopAgent(nil)
	agent.historyPath = historyPath

	// Add same task multiple times with updates
	agent.mu.Lock()
	agent.addHistoryLocked(TaskRecord{
		ID:        15,
		Action:    "share",
		State:     "running",
		StartedAt: time.Now(),
	})
	agent.addHistoryLocked(TaskRecord{
		ID:        15,
		Action:    "share",
		State:     "completed",
		BytesDone: 100,
		StartedAt: time.Now(),
	})
	agent.mu.Unlock()

	agent.mu.Lock()
	historyLen := len(agent.history)
	state := agent.history[0].State
	agent.mu.Unlock()

	if historyLen != 1 {
		t.Fatalf("History length = %d, want 1 (deduplicated)", historyLen)
	}
	if state != "completed" {
		t.Fatalf("History[0].State = %q, want completed", state)
	}
}

func TestGUIAgentHistoryCorruptedSelfHealing(t *testing.T) {
	historyPath := filepath.Join(t.TempDir(), "gui_history_corrupt.json")

	// Write invalid JSON content
	if err := os.WriteFile(historyPath, []byte("{invalid json"), 0600); err != nil {
		t.Fatal(err)
	}

	agent := newDesktopAgent(nil)
	agent.historyPath = historyPath

	// loadHistory should tolerate corrupted file and not fail, just treating it as empty
	if err := agent.loadHistory(); err != nil {
		t.Fatalf("loadHistory returned error for corrupted file: %v", err)
	}

	agent.mu.Lock()
	historyLen := len(agent.history)
	agent.mu.Unlock()

	if historyLen != 0 {
		t.Fatalf("History length = %d, want 0 after self-healing", historyLen)
	}
}

func TestGUIAgentCloneTaskRecordSavedFiles(t *testing.T) {
	// Import mock package dependency if needed, but server is already imported in package main (agent.go imports server)
	tr := TaskRecord{
		ID:     1,
		Action: "receive",
		TransferClientStates: map[string]*server.ClientTransferStateInfo{
			"client-1": {
				ClientID:   "client-1",
				DeviceName: "Test Device",
				SavedFiles: []string{"/path/to/file1.txt", "/path/to/file2.txt"},
			},
		},
	}

	cloned := cloneTaskRecord(tr)

	if cloned.TransferClientStates == nil {
		t.Fatal("Expected cloned clientStates to not be nil")
	}

	clientState, ok := cloned.TransferClientStates["client-1"]
	if !ok {
		t.Fatal("Expected 'client-1' in cloned clientStates")
	}

	if len(clientState.SavedFiles) != 2 {
		t.Fatalf("Expected 2 saved files, got %d", len(clientState.SavedFiles))
	}

	if clientState.SavedFiles[0] != "/path/to/file1.txt" || clientState.SavedFiles[1] != "/path/to/file2.txt" {
		t.Fatalf("Unexpected saved files values: %v", clientState.SavedFiles)
	}

	clientState.SavedFiles[0] = "/mutated/path.txt"
	if tr.TransferClientStates["client-1"].SavedFiles[0] != "/path/to/file1.txt" {
		t.Fatal("Expected deep clone of SavedFiles, but mutation affected the original TaskRecord")
	}
}

func TestGUIAgentHistoryChatFiltered(t *testing.T) {
	historyPath := filepath.Join(t.TempDir(), "gui_history_chat.json")
	agent := newDesktopAgent(nil)
	agent.historyPath = historyPath

	agent.mu.Lock()
	agent.addHistoryLocked(TaskRecord{
		ID:        1,
		Action:    "chat",
		State:     "running",
		StartedAt: time.Now(),
	})
	agent.addHistoryLocked(TaskRecord{
		ID:        1,
		Action:    "chat",
		State:     "completed",
		StartedAt: time.Now(),
	})
	agent.mu.Unlock()

	agent.mu.Lock()
	historyLen := len(agent.history)
	agent.mu.Unlock()

	if historyLen != 0 {
		t.Fatalf("Chat history length = %d, want 0 (filtered)", historyLen)
	}
}

func TestGUIAgentHistoryNoTransferFiltered(t *testing.T) {
	historyPath := filepath.Join(t.TempDir(), "gui_history_notransfer.json")
	agent := newDesktopAgent(nil)
	agent.historyPath = historyPath

	// 1. Share task with no transfer -> should be removed when completed
	agent.mu.Lock()
	agent.addHistoryLocked(TaskRecord{
		ID:        1,
		Action:    "send",
		State:     "running",
		StartedAt: time.Now(),
	})
	if len(agent.history) != 1 {
		t.Fatalf("Expected task 1 in running state, got history length = %d", len(agent.history))
	}

	agent.addHistoryLocked(TaskRecord{
		ID:        1,
		Action:    "send",
		State:     "completed",
		BytesDone: 0,
		StartedAt: time.Now(),
	})
	if len(agent.history) != 0 {
		t.Fatalf("Expected task 1 to be removed from history when completed with 0 bytes, got %d", len(agent.history))
	}
	agent.mu.Unlock()

	// 2. Share task with transfer -> should be kept
	agent.mu.Lock()
	agent.addHistoryLocked(TaskRecord{
		ID:        2,
		Action:    "send",
		State:     "running",
		StartedAt: time.Now(),
	})
	agent.addHistoryLocked(TaskRecord{
		ID:        2,
		Action:    "send",
		State:     "completed",
		BytesDone: 1024,
		StartedAt: time.Now(),
	})
	if len(agent.history) != 1 {
		t.Fatalf("Expected task 2 to be kept, got length = %d", len(agent.history))
	}
	agent.mu.Unlock()

	// 3. Receive task with no files -> should be removed when completed
	agent.mu.Lock()
	agent.addHistoryLocked(TaskRecord{
		ID:        3,
		Action:    "receive",
		State:     "running",
		StartedAt: time.Now(),
	})
	agent.addHistoryLocked(TaskRecord{
		ID:         3,
		Action:     "receive",
		State:      "completed",
		BytesDone:  0,
		SavedFiles: []string{},
		StartedAt:  time.Now(),
	})
	// Still only task 2 should remain
	if len(agent.history) != 1 || agent.history[0].ID != 2 {
		t.Fatalf("Expected only task 2 in history, got %v", agent.history)
	}
	agent.mu.Unlock()
}
