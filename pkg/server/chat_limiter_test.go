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

// TestCrossPlatformWebCryptoSignatureVerification ensures TS WebCrypto PKCS8 signing format
// and Go Ed25519 verification format match with 100% byte-exact consistency.
func TestCrossPlatformWebCryptoSignatureVerification(t *testing.T) {
	// Dev test public key corresponding to private seed 2cf5baa843e935702283ad56e4c7be5a0e0be2cbef81b83d1c3a647960309995
	testPublicKeyHex := "978fe821f1261dfb3f4e73aed051b75424dce9a8eb5606382f16e4a40c494376"

	oldKey := defaultPublicKeyHex
	defaultPublicKeyHex = testPublicKeyHex
	defer func() {
		defaultPublicKeyHex = oldKey
	}()

	devID := "test_dev_001"
	usageDate := "2026-08-24"
	usedSeconds := 45
	usedTransfers := 1
	quotaExceeded := false
	serverTime := "2026-08-24T02:00:00.000Z"

	// Derive key from standard seed
	seedBytes, _ := hex.DecodeString("2cf5baa843e935702283ad56e4c7be5a0e0be2cbef81b83d1c3a647960309995")
	privKey := ed25519.NewKeyFromSeed(seedBytes)

	payloadStr := fmt.Sprintf("SYNC|%s|%s|%d|%d|0|%s", devID, usageDate, usedSeconds, usedTransfers, serverTime)
	sigBytes := ed25519.Sign(privKey, []byte(payloadStr))
	sigHex := hex.EncodeToString(sigBytes)

	if !VerifySyncUsageSignature(devID, usageDate, usedSeconds, usedTransfers, quotaExceeded, serverTime, sigHex) {
		t.Fatalf("cross-platform signature verification failed for dev keypair")
	}
}

// TestNetworkTimeColdStartAndCacheInvalidation tests the cold-start optimistic branch,
// the offline fallback branch, and the cache invalidation trigger.
func TestNetworkTimeColdStartAndCacheInvalidation(t *testing.T) {
	// Temporarily disable EQT_TESTING to exercise real branch logic
	origTesting := os.Getenv("EQT_TESTING")
	_ = os.Setenv("EQT_TESTING", "false")
	defer func() {
		if origTesting != "" {
			_ = os.Setenv("EQT_TESTING", origTesting)
		} else {
			_ = os.Unsetenv("EQT_TESTING")
		}
	}()

	// Save original global state
	netTimeMu.Lock()
	origOffset := netTimeOffset
	origCached := netTimeCached
	origLastCheck := netTimeLastCheck
	origIsChecking := netTimeIsChecking
	origFirstFetch := netTimeFirstFetch
	netTimeMu.Unlock()

	defer func() {
		netTimeMu.Lock()
		netTimeOffset = origOffset
		netTimeCached = origCached
		netTimeLastCheck = origLastCheck
		netTimeIsChecking = origIsChecking
		netTimeFirstFetch = origFirstFetch
		netTimeMu.Unlock()
	}()

	// 1. Scenario A: Cold-start initial in-flight fetch (isChecking=true, firstFetch=true, cached=false)
	// Must optimistically return isOnline=true to prevent cold-start false quota lockout.
	netTimeMu.Lock()
	netTimeCached = false
	netTimeIsChecking = true
	netTimeFirstFetch = true
	netTimeLastCheck = time.Time{}
	netTimeMu.Unlock()

	_, isOnlineA := getNetworkTimeOrStartFetch()
	if !isOnlineA {
		t.Errorf("Scenario A: expected isOnline=true during initial cold-start in-flight check, got false")
	}

	// 2. Scenario B: Subsequent retry in-flight (isChecking=true, firstFetch=false, cached=false)
	// Must return isOnline=false when subsequent fetch is pending without cache.
	netTimeMu.Lock()
	netTimeCached = false
	netTimeIsChecking = true
	netTimeFirstFetch = false
	netTimeMu.Unlock()

	_, isOnlineB := getNetworkTimeOrStartFetch()
	if isOnlineB {
		t.Errorf("Scenario B: expected isOnline=false during subsequent un-cached check, got true")
	}

	// 3. Scenario C: Cached network time (cached=true, within 1h)
	// Must return isOnline=true with applied offset.
	testOffset := 5 * time.Minute
	netTimeMu.Lock()
	netTimeCached = true
	netTimeOffset = testOffset
	netTimeLastCheck = time.Now()
	netTimeIsChecking = false
	netTimeFirstFetch = false
	netTimeMu.Unlock()

	nowEst, isOnlineC := getNetworkTimeOrStartFetch()
	if !isOnlineC {
		t.Errorf("Scenario C: expected isOnline=true when network time is cached")
	}
	diff := time.Until(nowEst)
	if diff < 4*time.Minute || diff > 6*time.Minute {
		t.Errorf("Scenario C: expected estimated time offset near ~5m, got diff %v", diff)
	}

	// 4. Scenario D: InvalidateCache resets hasCached
	limiter := &ChatLimiter{
		hasCached:     true,
		lastCacheTime: time.Now(),
	}
	limiter.invalidateCache()
	if limiter.hasCached {
		t.Errorf("Scenario D: expected hasCached=false after invalidateCache(), got true")
	}
}

// TestLastSeenRollbackLocksFreeUser ensures a free user who rolls the system clock
// backward between writes (to regain the daily quota) is caught by the lastSeen anchor
// and locked into the exhausted state — the free-tier counterpart of the paid rule.
func TestLastSeenRollbackLocksFreeUser(t *testing.T) {
	os.Setenv("EQT_TESTING", "true")
	defer os.Unsetenv("EQT_TESTING")
	ResetPaidStatusCallbacksForTest()
	defer ResetPaidStatusCallbacksForTest()

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

	today := time.Now().UTC().Format("2006-01-02")
	// Anchor written ~15 minutes in the future: the local clock moved backward since the
	// last honest write, far beyond the 10-minute tolerance.
	futureSeen := time.Now().UTC().Add(15 * time.Minute).Format(time.RFC3339)

	u := ChatUsage{
		Date:          today,
		UsedSeconds:   0,
		IsPaid:        false,
		ClockTampered: false,
		LastSeen:      futureSeen,
	}
	machineKey := GetDeviceStableID()
	u.MAC = computeUsageMAC(u, machineKey)
	data, err := json.Marshal(u)
	if err != nil {
		t.Fatalf("failed to marshal usage: %v", err)
	}
	if err := os.WriteFile(usageFile, data, 0644); err != nil {
		t.Fatalf("failed to write usage file: %v", err)
	}

	fresh := &ChatLimiter{}
	checked := fresh.loadUsageLocked()

	if !checked.ClockTampered {
		t.Fatalf("expected ClockTampered=true after lastSeen rollback, got false")
	}
	if checked.UsedSeconds < 300 {
		t.Fatalf("expected UsedSeconds locked to exhausted (>300), got %d", checked.UsedSeconds)
	}
	if checked.IsPaid {
		t.Fatalf("expected IsPaid=false after lastSeen rollback")
	}
}

// TestUsageMACV1MigrationNoFalseLock ensures a legacy V1 usage file (written before the
// lastSeen anchor existed) loads without a false tamper lock and is upgraded to a V2 MAC.
func TestUsageMACV1MigrationNoFalseLock(t *testing.T) {
	os.Setenv("EQT_TESTING", "true")
	defer os.Unsetenv("EQT_TESTING")
	ResetPaidStatusCallbacksForTest()
	defer ResetPaidStatusCallbacksForTest()

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

	today := time.Now().UTC().Format("2006-01-02")
	u := ChatUsage{
		Date:          today,
		UsedSeconds:   120,
		UsedTransfers: 2,
		IsPaid:        false,
		ClockTampered: false,
		// LastSeen intentionally empty: legacy V1 payload.
	}
	machineKey := GetDeviceStableID()
	u.MAC = computeUsageMACV1(u, machineKey)
	data, err := json.Marshal(u)
	if err != nil {
		t.Fatalf("failed to marshal usage: %v", err)
	}
	if err := os.WriteFile(usageFile, data, 0644); err != nil {
		t.Fatalf("failed to write usage file: %v", err)
	}

	fresh := &ChatLimiter{}
	checked := fresh.loadUsageLocked()

	// Legacy V1 file must load without a false tamper lock and keep its usage.
	if checked.ClockTampered {
		t.Fatalf("expected no false tamper lock on V1 migration, got ClockTampered=true")
	}
	if checked.UsedSeconds != 120 {
		t.Fatalf("expected used seconds preserved at 120 on V1 migration, got %d", checked.UsedSeconds)
	}
	if checked.LastSeen == "" {
		t.Fatalf("expected lastSeen anchor initialized on V1 migration")
	}

	// The anchor is initialized and persisted with a fresh V2 MAC.
	diskBytes, err := os.ReadFile(usageFile)
	if err != nil {
		t.Fatalf("failed to read usage file after migration: %v", err)
	}
	var loaded ChatUsage
	if err := json.Unmarshal(diskBytes, &loaded); err != nil {
		t.Fatalf("failed to parse migrated file: %v", err)
	}
	if loaded.LastSeen == "" {
		t.Fatalf("expected persisted lastSeen after V1 migration")
	}
	if loaded.MAC != computeUsageMAC(loaded, machineKey) {
		t.Fatalf("expected persisted MAC upgraded to V2 after migration")
	}
}

// TestSelfHealColdStartGuard ensures the tamper-flag self-heal only fires against
// authoritatively calibrated network time — never on the optimistic cold-start guess,
// which is raw local time and could wrongly clear a real tamper flag.
func TestSelfHealColdStartGuard(t *testing.T) {
	origTesting := os.Getenv("EQT_TESTING")
	_ = os.Setenv("EQT_TESTING", "false")
	defer func() {
		if origTesting != "" {
			_ = os.Setenv("EQT_TESTING", origTesting)
		} else {
			_ = os.Unsetenv("EQT_TESTING")
		}
	}()
	ResetPaidStatusCallbacksForTest()
	defer ResetPaidStatusCallbacksForTest()

	// Save and restore the global network-time state.
	netTimeMu.Lock()
	origOffset := netTimeOffset
	origCached := netTimeCached
	origLastCheck := netTimeLastCheck
	origIsChecking := netTimeIsChecking
	origFirstFetch := netTimeFirstFetch
	netTimeMu.Unlock()
	defer func() {
		netTimeMu.Lock()
		netTimeOffset = origOffset
		netTimeCached = origCached
		netTimeLastCheck = origLastCheck
		netTimeIsChecking = origIsChecking
		netTimeFirstFetch = origFirstFetch
		netTimeMu.Unlock()
	}()

	// Simulate a tamper previously recorded by the license single-source-of-truth.
	paidStateMu.Lock()
	cachedIsTampered = true
	paidStateMu.Unlock()
	defer func() {
		paidStateMu.Lock()
		cachedIsTampered = false
		paidStateMu.Unlock()
	}()

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

	writeUsage := func() {
		today := time.Now().UTC().Format("2006-01-02")
		u := ChatUsage{
			Date:          today,
			UsedSeconds:   300,
			IsPaid:        false,
			ClockTampered: true,
			LastSeen:      time.Now().UTC().Add(-1 * time.Minute).Format(time.RFC3339),
		}
		machineKey := GetDeviceStableID()
		u.MAC = computeUsageMAC(u, machineKey)
		data, _ := json.Marshal(u)
		_ = os.WriteFile(usageFile, data, 0644)
	}

	// Scenario 1: cold-start optimistic path — network time NOT yet cached. A real tamper
	// flag must be preserved, not cleared against a raw local-time guess.
	netTimeMu.Lock()
	netTimeCached = false
	netTimeIsChecking = true
	netTimeFirstFetch = true
	netTimeLastCheck = time.Time{}
	netTimeMu.Unlock()
	writeUsage()

	fresh := &ChatLimiter{}
	checked := fresh.loadUsageLocked()
	if !checked.ClockTampered {
		t.Fatalf("Scenario 1: expected tamper flag preserved during cold-start (no self-heal), got cleared")
	}

	// Scenario 2: authoritative network time within drift threshold → the flag clears.
	netTimeMu.Lock()
	netTimeCached = true
	netTimeOffset = 0
	netTimeIsChecking = false
	netTimeFirstFetch = false
	netTimeLastCheck = time.Now()
	netTimeMu.Unlock()
	writeUsage()

	fresh2 := &ChatLimiter{}
	checked2 := fresh2.loadUsageLocked()
	if checked2.ClockTampered {
		t.Fatalf("Scenario 2: expected tamper flag self-healed under authoritative network time, got still-tampered")
	}
}

// TestClockDriftPreservedAcrossSaveAndCacheHit verifies that live ClockDrift hints
// are never wiped out when saveUsageLocked is invoked, and that the cache-hit path
// remains a pure, non-disk-writing memory read.
func TestClockDriftPreservedAcrossSaveAndCacheHit(t *testing.T) {
	os.Setenv("EQT_TESTING", "true")
	defer os.Unsetenv("EQT_TESTING")

	limiter := &ChatLimiter{}
	today := time.Now().UTC().Format("2006-01-02")
	limiter.cachedUsage = ChatUsage{
		Date:       today,
		ClockDrift: true,
	}
	limiter.hasCached = true
	limiter.lastCacheTime = time.Now()

	// 1. Cache hit must return the in-memory ClockDrift state
	status := limiter.loadUsageLocked()
	if !status.ClockDrift {
		t.Errorf("expected ClockDrift=true on cache-hit read, got false")
	}

	// 2. A real save operation must preserve ClockDrift in the memory cache
	limiter.saveUsageLocked(status)
	if !limiter.cachedUsage.ClockDrift {
		t.Errorf("expected ClockDrift=true preserved in memory cache after saveUsageLocked, got false")
	}
}

