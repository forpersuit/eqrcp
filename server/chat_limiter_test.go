package server

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"eqt/config"
)

func TestChatLimiter(t *testing.T) {
	// Setup temporary config directory for testing
	tempDir, err := os.MkdirTemp("", "eqt-test-config-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Override config directory by mock logic
	// In the production code, it uses config.DefaultConfigDir().
	// To prevent writing to ~/.local/eqt/chat_usage.json during tests,
	// we will backup and restore the file if it exists, or dynamically mock it.
	// Since getChatUsageFilePath() uses config.DefaultConfigDir(),
	// we can check if it creates the file correctly.
	
	// Let's backup current file if exists
	usageFile := filepath.Join(config.DefaultConfigDir(), "chat_usage.json")
	var backup []byte
	backupExists := false
	if data, err := os.ReadFile(usageFile); err == nil {
		backup = data
		backupExists = true
		_ = os.Remove(usageFile)
	}
	defer func() {
		if backupExists {
			_ = os.WriteFile(usageFile, backup, 0644)
		} else {
			_ = os.Remove(usageFile)
		}
	}()

	limiter := &ChatLimiter{}

	// Test 1: Initial status
	usage := limiter.GetStatus()
	today := time.Now().Format("2006-01-02")
	if usage.Date != today {
		t.Errorf("expected date %s, got %s", today, usage.Date)
	}
	if usage.UsedSeconds != 0 {
		t.Errorf("expected used seconds 0, got %d", usage.UsedSeconds)
	}
	if usage.IsPaid {
		t.Errorf("expected unpaid initially")
	}

	// Test 2: Increment usage
	usage, limitReached := limiter.IncrementUsage(100)
	if usage.UsedSeconds != 100 {
		t.Errorf("expected used seconds 100, got %d", usage.UsedSeconds)
	}
	if limitReached {
		t.Errorf("expected limit not reached at 100s")
	}

	// Test 3: Reach limit
	usage, limitReached = limiter.IncrementUsage(200)
	if usage.UsedSeconds != 300 {
		t.Errorf("expected used seconds 300, got %d", usage.UsedSeconds)
	}
	if !limitReached {
		t.Errorf("expected limit reached at 300s")
	}

	// Test 4: Set paid
	usage = limiter.SetPaid(true)
	if !usage.IsPaid {
		t.Errorf("expected marked as paid")
	}

	// Test 5: Increment after paid
	usage, limitReached = limiter.IncrementUsage(50)
	if limitReached {
		t.Errorf("expected limit not reached for paid user")
	}

	// Test 6: Reset on date change
	// Mock a different date
	usage.Date = "2000-01-01"
	usage.UsedSeconds = 250
	limiter.saveUsage(usage)

	// Fetch status again, should reset usedSeconds but keep isPaid
	usage = limiter.GetStatus()
	if usage.Date != today {
		t.Errorf("expected date reset to %s, got %s", today, usage.Date)
	}
	if usage.UsedSeconds != 0 {
		t.Errorf("expected used seconds reset to 0, got %d", usage.UsedSeconds)
	}
	if !usage.IsPaid {
		t.Errorf("expected to retain paid status across days")
	}
}
