package server

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"eqt/pkg/config"
)

func TestChatLimiter(t *testing.T) {
	os.Setenv("EQT_TESTING", "true")
	defer os.Unsetenv("EQT_TESTING")

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
	today := time.Now().UTC().Format("2006-01-02")
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
	if usage.UsedSeconds != FreeChatDailySeconds {
		t.Errorf("expected used seconds %d, got %d", FreeChatDailySeconds, usage.UsedSeconds)
	}
	if !limitReached {
		t.Errorf("expected limit reached at %ds", FreeChatDailySeconds)
	}

	// FreeChatDegraded / AttachmentUnrestricted use the process-global limiterInstance.
	SetPaidStatus(false, "", "", "")
	SetUsedSeconds(FreeChatDailySeconds)
	if !FreeChatDegraded() {
		t.Error("expected FreeChatDegraded after daily free quota")
	}
	if FreeChatAttachmentUnrestricted() {
		t.Error("expected attachments restricted after daily free quota")
	}
	SetUsedSeconds(0)
	if FreeChatDegraded() {
		t.Error("expected not degraded after reset")
	}

	// Test 4: Set paid
	usage = limiter.SetPaidDetails(true, "", "", "PLUS")
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
	limiter.saveUsageLocked(usage)

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

	// Test 7: Exported SetPaidStatus / GetPaidStatus
	SetPaidStatus(false, "", "", "")
	if GetPaidStatus() {
		t.Errorf("expected unpaid status via SetPaidStatus")
	}
	SetPaidStatus(true, "", "", "PLUS")
	if !GetPaidStatus() {
		t.Errorf("expected paid status via SetPaidStatus")
	}
	if GetLicenseTier() != "PLUS" {
		t.Errorf("expected GetLicenseTier() to return 'PLUS', got '%s'", GetLicenseTier())
	}
}

func TestNetworkTimeAndAntiTamper(t *testing.T) {
	// Test network time fetch helper in testing mode
	os.Setenv("EQT_TESTING", "true")
	netTime, isOnline := getNetworkTimeOrStartFetch()
	if !isOnline {
		t.Errorf("expected isOnline true in testing mode")
	}
	if netTime.IsZero() {
		t.Errorf("expected non-zero netTime")
	}
}

func TestChatUsageHMACAndAntiTamper(t *testing.T) {
	os.Setenv("EQT_TESTING", "true")
	defer os.Unsetenv("EQT_TESTING")

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
	today := time.Now().UTC().Format("2006-01-02")

	// 1. Save valid usage and check MAC signature is generated
	u := ChatUsage{
		Date:                 today,
		UsedSeconds:          150,
		UsedTransfers:        2,
		UsedReceiveTransfers: 1,
		IsPaid:               false,
		ClockTampered:        false,
	}
	limiter.saveUsageLocked(u)

	// Read file directly from disk and check MAC presence
	diskBytes, err := os.ReadFile(usageFile)
	if err != nil {
		t.Fatalf("failed to read usage file: %v", err)
	}
	var loaded ChatUsage
	if err := json.Unmarshal(diskBytes, &loaded); err != nil {
		t.Fatalf("failed to parse json: %v", err)
	}
	if loaded.MAC == "" {
		t.Fatalf("expected MAC signature to be non-empty")
	}

	// 2. Tamper with the file (e.g. manually reducing usedSeconds to 0 without valid MAC)
	loaded.UsedSeconds = 0
	loaded.MAC = "fake_tampered_signature"
	tamperedBytes, _ := json.Marshal(loaded)
	if err := os.WriteFile(usageFile, tamperedBytes, 0644); err != nil {
		t.Fatalf("failed to write tampered file: %v", err)
	}

	// Create new limiter instance without cache to force disk load
	freshLimiter := &ChatLimiter{}
	checked := freshLimiter.loadUsageLocked()

	// Must detect tamper: set ClockTampered = true and UsedSeconds = 600
	if !checked.ClockTampered {
		t.Fatalf("expected ClockTampered to be true when MAC is tampered")
	}
	if checked.UsedSeconds < 300 {
		t.Fatalf("expected UsedSeconds to be locked to exhausted (>300), got %d", checked.UsedSeconds)
	}
}

func TestVerifySyncUsageSignature(t *testing.T) {
	// 1. Negative cases: empty or invalid signature
	if VerifySyncUsageSignature("dev123", "2026-08-24", 100, 2, false, "2026-08-24T00:00:00Z", "") {
		t.Fatalf("expected empty signature to fail verification (fail-closed)")
	}
	if VerifySyncUsageSignature("dev123", "2026-08-24", 100, 2, false, "2026-08-24T00:00:00Z", "deadbeef") {
		t.Fatalf("expected invalid hex signature to fail verification")
	}
	fake128Hex := strings.Repeat("a", 128)
	if VerifySyncUsageSignature("dev123", "2026-08-24", 100, 2, false, "2026-08-24T00:00:00Z", fake128Hex) {
		t.Fatalf("expected forged signature to fail verification")
	}

	// 2. Positive case: valid keypair self-signed and verified
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate ed25519 keypair: %v", err)
	}

	oldKey := defaultPublicKeyHex
	defaultPublicKeyHex = hex.EncodeToString(pub)
	defer func() {
		defaultPublicKeyHex = oldKey
	}()

	devID := "dev_mock_test_001"
	usageDate := "2026-08-24"
	usedSeconds := 180
	usedTransfers := 3
	quotaExceeded := false
	serverTime := "2026-08-24T02:00:00Z"

	payloadStr := fmt.Sprintf("SYNC|%s|%s|%d|%d|0|%s", devID, usageDate, usedSeconds, usedTransfers, serverTime)
	sigBytes := ed25519.Sign(priv, []byte(payloadStr))
	sigHex := hex.EncodeToString(sigBytes)

	// Valid signature must pass
	if !VerifySyncUsageSignature(devID, usageDate, usedSeconds, usedTransfers, quotaExceeded, serverTime, sigHex) {
		t.Fatalf("expected valid signature to pass verification")
	}

	// Tampered usedSeconds must fail
	if VerifySyncUsageSignature(devID, usageDate, 0, usedTransfers, quotaExceeded, serverTime, sigHex) {
		t.Fatalf("expected tampered usedSeconds to fail verification")
	}

	// Tampered usageDate must fail
	if VerifySyncUsageSignature(devID, "2026-08-25", usedSeconds, usedTransfers, quotaExceeded, serverTime, sigHex) {
		t.Fatalf("expected tampered usageDate to fail verification")
	}

	// Tampered quotaExceeded flag must fail
	if VerifySyncUsageSignature(devID, usageDate, usedSeconds, usedTransfers, true, serverTime, sigHex) {
		t.Fatalf("expected tampered quotaExceeded to fail verification")
	}
}
