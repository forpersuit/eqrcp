package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
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
