package main

import (
	"os"
	"path/filepath"
	"strings"
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

func TestGUIAgentNotificationDisabledInSettings(t *testing.T) {
	agent := newDesktopAgent(nil)
	if agent.notifyEnabled {
		t.Fatalf("expected notifyEnabled default to be false, got true")
	}

	notifications := make(chan string, 4)
	agent.notifier = func(title string, message string) error {
		notifications <- title + ": " + message
		return nil
	}

	agent.mu.Lock()
	agent.current = &TaskRecord{ID: 10, Action: "share", Paths: []string{"a.txt"}, State: "running"}
	agent.notifyRecordLocked(*agent.current)
	agent.notifyTransferStatusLocked(TaskRecord{
		ID:            10,
		Action:        "share",
		Paths:         []string{"a.txt"},
		TransferState: "transferring",
	})
	agent.mu.Unlock()

	select {
	case got := <-notifications:
		t.Fatalf("unexpected notification when notifyEnabled is false: %q", got)
	default:
		// Success: no notification sent
	}

	// Now enable it and verify notifications are sent
	agent.mu.Lock()
	agent.notifyEnabled = true
	agent.notifyRecordLocked(*agent.current)
	agent.mu.Unlock()

	select {
	case got := <-notifications:
		if !strings.Contains(got, "eqt transfer ready") {
			t.Fatalf("expected 'eqt transfer ready', got %q", got)
		}
	default:
		t.Fatal("expected notification when notifyEnabled is true, got none")
	}
}

func TestDesktopChatPageURLDefaultSender(t *testing.T) {
	urlWithEmptySender := desktopChatPageURL("http://127.0.0.1:19000/chat/abc", "host-token-123", "", "", true)
	if !strings.Contains(urlWithEmptySender, "sender=Desktop") {
		t.Fatalf("expected sender=Desktop in URL, got %s", urlWithEmptySender)
	}
	if !strings.Contains(urlWithEmptySender, "/chat-v2/") {
		t.Fatalf("expected /chat-v2/ in URL when useV2 is true, got %s", urlWithEmptySender)
	}

	urlWithCustomSender := desktopChatPageURL("http://127.0.0.1:19000/chat/abc", "host-token-123", "CustomDevice", "avatar.png", true)
	if !strings.Contains(urlWithCustomSender, "sender=CustomDevice") {
		t.Fatalf("expected sender=CustomDevice in URL, got %s", urlWithCustomSender)
	}
}

func TestGUIAgentRunTaskEnableTLSFallbackToHTTP(t *testing.T) {
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)
	t.Setenv("USERPROFILE", tempHome)

	testFile := filepath.Join(tempHome, "sample.txt")
	if err := os.WriteFile(testFile, []byte("test content"), 0600); err != nil {
		t.Fatal(err)
	}

	agent := newDesktopAgent(nil)
	agent.baseFlags.Port = 0
	agent.baseFlags.Bind = "127.0.0.1"

	_, err := agent.writeSettings(DesktopSettings{
		EnableTLS:     true,
		CloseBehavior: "tray",
		Interface:     "lo",
	})
	if err != nil {
		t.Fatalf("writeSettings failed: %v", err)
	}

	agent.mu.Lock()
	agent.current = &TaskRecord{ID: 1, Action: "share"}
	agent.mu.Unlock()

	errCh := make(chan error, 1)
	go func() {
		errCh <- agent.runTask(AgentTask{
			Action: "share",
			Paths:  []string{testFile},
		})
	}()

	var srv *server.Server
	var currentTask *TaskRecord
	for i := 0; i < 30; i++ {
		time.Sleep(50 * time.Millisecond)
		agent.mu.Lock()
		srv = agent.activeServer
		currentTask = agent.current
		agent.mu.Unlock()
		if srv != nil && currentTask != nil && strings.HasPrefix(currentTask.QRCode, "data:image/png;base64,") {
			break
		}
	}

	if srv == nil {
		t.Fatalf("expected server to be running despite missing TLS certificates (graceful HTTP fallback)")
	}
	if strings.HasPrefix(srv.SendURL, "https://") {
		t.Fatalf("expected HTTP URL after fallback, got: %s", srv.SendURL)
	}
	agent.mu.Lock()
	currentTask = agent.current
	agent.mu.Unlock()
	if currentTask == nil || !strings.HasPrefix(currentTask.QRCode, "data:image/png;base64,") {
		t.Fatalf("expected offline Base64 QRCode on current task, got: %v", currentTask)
	}

	go srv.Shutdown()
	select {
	case <-errCh:
	case <-time.After(1 * time.Second):
	}
}

func TestGUIAgentTaskOfflineQRCodeGeneration(t *testing.T) {
	agent := newDesktopAgent(nil)
	agent.current = &TaskRecord{ID: 1, Action: "share"}
	agent.chat = &TaskRecord{ID: 2, Action: "chat"}

	// 1. Test share task QR generation
	agent.setTaskPageURL("share", "https://192-168-0-1.direct.eqt.net.im:18080/qr", "https://192-168-0-1.direct.eqt.net.im:18080/send/token123")
	if !strings.HasPrefix(agent.current.QRCode, "data:image/png;base64,") {
		t.Fatalf("expected data:image/png;base64, prefix for share QR code, got: %q", agent.current.QRCode)
	}
	if agent.current.PageURL != "https://192-168-0-1.direct.eqt.net.im:18080/qr" {
		t.Fatalf("expected PageURL preserved, got: %s", agent.current.PageURL)
	}

	// 2. Test chat task QR generation
	chatURL := "https://192-168-0-1.direct.eqt.net.im:18080/chat/token456"
	agent.setTaskPageURL("chat", chatURL, chatURL)
	if !strings.HasPrefix(agent.chat.QRCode, "data:image/png;base64,") {
		t.Fatalf("expected data:image/png;base64, prefix for chat QR code, got: %q", agent.chat.QRCode)
	}
	if agent.chat.PageURL != chatURL {
		t.Fatalf("expected chat PageURL preserved, got: %s", agent.chat.PageURL)
	}

	// 3. Test addHistoryLocked clears QRCode to keep history lean
	agent.mu.Lock()
	agent.addHistoryLocked(*agent.current)
	agent.mu.Unlock()
	if len(agent.history) == 0 || agent.history[0].QRCode != "" {
		t.Fatalf("expected history record to have empty QRCode, got: %v", agent.history)
	}
}

func TestGUIAgentObserveTransferStatusDownloadedItems(t *testing.T) {
	agent := newDesktopAgent(nil)
	agent.current = &TaskRecord{ID: 10, Action: "share", State: "running"}

	snapshot := server.TransferStatusSnapshot{
		State:           "waiting",
		DownloadedItems: []int{0, 2, 5},
	}

	agent.observeTransferStatus(10, snapshot)

	agent.mu.Lock()
	defer agent.mu.Unlock()

	if agent.current == nil {
		t.Fatal("agent.current is nil")
	}
	if len(agent.current.DownloadedItems) != 3 {
		t.Fatalf("DownloadedItems length = %d, want 3", len(agent.current.DownloadedItems))
	}
	if agent.current.DownloadedItems[0] != 0 || agent.current.DownloadedItems[1] != 2 || agent.current.DownloadedItems[2] != 5 {
		t.Fatalf("DownloadedItems = %v, want [0, 2, 5]", agent.current.DownloadedItems)
	}

	// Verify deep clone
	cloned := cloneTaskRecord(*agent.current)
	if len(cloned.DownloadedItems) != 3 {
		t.Fatalf("cloned DownloadedItems length = %d, want 3", len(cloned.DownloadedItems))
	}
	cloned.DownloadedItems[0] = 999
	if agent.current.DownloadedItems[0] == 999 {
		t.Fatal("cloneTaskRecord did not perform deep copy of DownloadedItems")
	}
}

