package server

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"eqt/pkg/chat/v2/bandwidth"
	"eqt/pkg/config"
)

// Free-tier Chat daily quota and attachment degradation (data plane only).
const (
	// FreeChatDailySeconds is the daily full-feature chat allowance for unpaid users (5 minutes).
	FreeChatDailySeconds = bandwidth.DefaultFreeChatDailySeconds
	// FreeChatMaxAttachmentBytes is the per-file size cap after free chat quota is exhausted.
	FreeChatMaxAttachmentBytes = bandwidth.DefaultFreeChatMaxAttachmentBytes
	// FreeChatDegradedBytesPerSec is the attachment transfer cap after free chat quota is exhausted.
	FreeChatDegradedBytesPerSec = bandwidth.DefaultFreeChatDegradedBytesPerSec
	// lastSeenTolerance is the allowed backward clock variance for the free-tier
	// anti-rollback anchor (mirrors the paid certificate LastSeenLocalTime rule).
	lastSeenTolerance = 10 * time.Minute
	// clockDriftThreshold is the informational-only guard band for surfacing a
	// "system time out of sync" hint. It never locks quota.
	clockDriftThreshold = 60 * time.Minute
)

// FreeChatDegraded reports whether free chat should run in attachment-degraded mode.
// Text messages are never degraded; only attachment transfer rate/size is limited.
func FreeChatDegraded() bool {
	usage := limiterInstance.GetStatus()
	return !usage.IsPaid && usage.UsedSeconds >= FreeChatDailySeconds
}

// FreeChatAttachmentUnrestricted is true for paid users or free users still within daily quota.
func FreeChatAttachmentUnrestricted() bool {
	return !FreeChatDegraded()
}

// ChatUsage holds the daily usage statistics and premium license tracking.
type ChatUsage struct {
	Date                 string `json:"date"`
	UsedSeconds          int    `json:"usedSeconds"`
	UsedTransfers        int    `json:"usedTransfers"`        // Daily transfers count (Share)
	UsedReceiveTransfers int    `json:"usedReceiveTransfers"` // Daily Receive transfers count
	IsPaid               bool   `json:"isPaid"`
	LastTime             int64  `json:"lastTime"`             // Last running timestamp in seconds
	RedeemedAt           string `json:"redeemedAt"`           // ISO format activation time
	CodeDate             string `json:"codeDate"`             // Code issue date or "LIFETIME"
	ClockTampered        bool   `json:"clockTampered"`        // Locked if clock rollback is detected
	LastSeen             string `json:"lastSeen"`             // UTC RFC3339 local anti-rollback anchor (§6)
	ClockDrift           bool   `json:"clockDrift,omitempty"` // Informational: system clock vs network time deviated (never persisted)
	LicenseTier          string `json:"licenseTier"`          // Activated license tier (e.g. PLUS, PRO)
	MAC                  string `json:"mac,omitempty"`        // HMAC-SHA256 integrity signature (§8)
}

// isPlusLifetime reports whether the activated license is the PLUS lifetime plan.
// Lifetime is a PLUS-only product; a PRO certificate carrying "LIFETIME" expiry
// is not treated as the lifetime badge.
func isPlusLifetime(tier, codeDate string) bool {
	return tier == "PLUS" && codeDate == "LIFETIME"
}

// ChatLimiter manages daily chat time limits and payment state.
type ChatLimiter struct {
	mu            sync.Mutex
	activeSession *chatSession
	cachedUsage   ChatUsage
	hasCached     bool
	lastCacheTime time.Time
}

var limiterInstance = &ChatLimiter{}

func getChatUsageFilePath() string {
	return filepath.Join(config.DefaultConfigDir(), "chat_usage.json")
}

func fetchNetworkTime() (time.Time, error) {
	client := http.Client{
		Timeout: 3 * time.Second,
		Transport: &http.Transport{
			Proxy: http.ProxyFromEnvironment,
		},
	}
	endpoints := []string{
		getLicenseServer(),
		"https://www.cloudflare.com",
		"https://www.aliyun.com",
		"https://www.qq.com",
		"http://connect.rom.miui.com/generate_204",
	}

	for _, endpoint := range endpoints {
		req, err := http.NewRequest("HEAD", endpoint, nil)
		if err != nil {
			continue
		}
		req.Header.Set("User-Agent", "EQT-Client/1.0")

		resp, err := client.Do(req)
		if err != nil {
			reqGet, errGet := http.NewRequest("GET", endpoint, nil)
			if errGet == nil {
				reqGet.Header.Set("User-Agent", "EQT-Client/1.0")
				reqGet.Header.Set("Range", "bytes=0-0")
				resp, err = client.Do(reqGet)
			}
		}
		if err != nil || resp == nil {
			continue
		}
		dateStr := resp.Header.Get("Date")
		resp.Body.Close()
		if dateStr == "" {
			continue
		}
		t, err := time.Parse(time.RFC1123, dateStr)
		if err != nil {
			t, err = time.Parse(time.RFC1123Z, dateStr)
		}
		if err == nil && !t.IsZero() {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("all network time endpoints failed")
}

var (
	netTimeMu         sync.Mutex
	netTimeOffset     time.Duration
	netTimeCached     bool
	netTimeLastCheck  time.Time
	netTimeIsChecking bool
	netTimeFirstFetch bool = true
)

// getNetworkTimeOrStartFetch returns the best estimation of network time and online reachability status.
// It is non-blocking and triggers an asynchronous HTTP request if cache is stale or missing.
func getNetworkTimeOrStartFetch() (time.Time, bool) {
	now := time.Now()
	if os.Getenv("EQT_TESTING") == "true" {
		return now, true
	}

	netTimeMu.Lock()
	if netTimeCached && now.Sub(netTimeLastCheck) < 1*time.Hour {
		offset := netTimeOffset
		netTimeMu.Unlock()
		return now.Add(offset), true
	}

	if netTimeIsChecking {
		if netTimeCached {
			offset := netTimeOffset
			netTimeMu.Unlock()
			return now.Add(offset), true
		}
		isFirst := netTimeFirstFetch
		netTimeMu.Unlock()
		// While the initial fetch is in flight, optimistically assume reachable to prevent false cold-start quota lockout
		return now, isFirst
	}

	if !netTimeCached && !netTimeLastCheck.IsZero() && now.Sub(netTimeLastCheck) < 1*time.Minute {
		netTimeMu.Unlock()
		return now, false
	}

	netTimeIsChecking = true
	isFirst := netTimeFirstFetch
	netTimeMu.Unlock()

	go func() {
		netTime, err := fetchNetworkTime()
		netTimeMu.Lock()
		netTimeIsChecking = false
		netTimeLastCheck = time.Now()
		netTimeFirstFetch = false
		if err == nil {
			netTimeOffset = time.Until(netTime)
			netTimeCached = true
		} else {
			netTimeCached = false
		}
		netTimeMu.Unlock()

		// Invalidate limiter cached usage to reflect fresh network time alignment
		limiterInstance.invalidateCache()
	}()

	netTimeMu.Lock()
	defer netTimeMu.Unlock()
	if netTimeCached {
		return now.Add(netTimeOffset), true
	}
	return now, isFirst
}

// netTimeNow returns network-corrected time when authoritatively cached, else local wall clock.
func netTimeNow() time.Time {
	netTimeMu.Lock()
	defer netTimeMu.Unlock()
	if netTimeCached {
		return time.Now().Add(netTimeOffset)
	}
	return time.Now()
}

// isNetTimeCached reports whether network time is authoritatively calibrated
// (as opposed to the optimistic cold-start guess, which is raw local time).
func isNetTimeCached() bool {
	netTimeMu.Lock()
	defer netTimeMu.Unlock()
	return netTimeCached
}

// rollbackDetected reports whether the persisted last-seen anchor lies beyond the
// tolerance window in the future relative to refTime — i.e. the local clock moved
// backward since the anchor was written (the classic "regain daily quota" rollback).
func rollbackDetected(usage *ChatUsage, refTime time.Time) bool {
	if usage.LastSeen == "" {
		return false
	}
	lastSeen, err := time.Parse(time.RFC3339, usage.LastSeen)
	if err != nil {
		return false
	}
	return refTime.Before(lastSeen.Add(-lastSeenTolerance))
}

// lastSeenAge returns how long ago the persisted anchor was written.
func lastSeenAge(refTime time.Time, lastSeenStr string) time.Duration {
	if lastSeenStr == "" {
		return 365 * 24 * time.Hour
	}
	lastSeen, err := time.Parse(time.RFC3339, lastSeenStr)
	if err != nil {
		return 365 * 24 * time.Hour
	}
	return refTime.Sub(lastSeen)
}

func (l *ChatLimiter) invalidateCache() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.hasCached = false
}

func (l *ChatLimiter) checkLicenseValidity(usage *ChatUsage) {
	// Align status dynamically with single source of truth (license.go)
	usage.IsPaid = GetPaidStatus()
	usage.LicenseTier = GetLicenseTier()
	usage.CodeDate = GetCodeDate()
	usage.ClockTampered = GetClockTamperedStatus()
}

func getMockUsageForAcceptance() *ChatUsage {
	mockEnv := os.Getenv("EQT_MOCK_STATUS")
	if mockEnv == "" {
		return nil
	}
	switch mockEnv {
	case "clock_tampered":
		return &ChatUsage{
			Date:          time.Now().UTC().Format("2006-01-02"),
			UsedSeconds:   300,
			IsPaid:        false,
			ClockTampered: true,
			LicenseTier:   "PLUS U",
		}
	case "inconsistent_unpaid":
		return &ChatUsage{
			Date:          time.Now().UTC().Format("2006-01-02"),
			UsedSeconds:   300,
			IsPaid:        false,
			ClockTampered: false,
			LicenseTier:   "PLUS U",
		}
	case "premium_active":
		return &ChatUsage{
			Date:          time.Now().UTC().Format("2006-01-02"),
			UsedSeconds:   120,
			IsPaid:        true,
			ClockTampered: false,
			LicenseTier:   "PLUS U",
		}
	case "free_quota":
		return &ChatUsage{
			Date:          time.Now().UTC().Format("2006-01-02"),
			UsedSeconds:   120,
			IsPaid:        false,
			ClockTampered: false,
			LicenseTier:   "",
		}
	case "free_exceeded":
		return &ChatUsage{
			Date:                 time.Now().UTC().Format("2006-01-02"),
			UsedSeconds:          300,
			UsedTransfers:        5,
			UsedReceiveTransfers: 5,
			IsPaid:               false,
			ClockTampered:        false,
			LicenseTier:          "",
		}
	case "free_exceeded_share":
		return &ChatUsage{
			Date:                 time.Now().UTC().Format("2006-01-02"),
			UsedSeconds:          600,
			UsedTransfers:        5,
			UsedReceiveTransfers: 5,
			IsPaid:               false,
			ClockTampered:        false,
			LicenseTier:          "",
		}
	}
	return nil
}

func writeAtomic(filename string, data []byte, perm os.FileMode) error {
	tmpFile := filename + ".tmp"
	if err := os.MkdirAll(filepath.Dir(filename), 0755); err != nil {
		return err
	}
	if err := os.WriteFile(tmpFile, data, perm); err != nil {
		return err
	}
	if err := os.Rename(tmpFile, filename); err != nil {
		_ = os.Remove(tmpFile)
		return err
	}
	return nil
}

// computeUsageMACV1 verifies the legacy V1 payload written by builds before the
// anti-rollback anchor existed, so existing on-disk files upgrade without a false tamper lock.
func computeUsageMACV1(usage ChatUsage, machineKey string) string {
	if machineKey == "" {
		machineKey = "EQT_DEFAULT_USAGE_KEY"
	}
	h := hmac.New(sha256.New, []byte("EQT_USAGE_HMAC_v1:"+machineKey))
	payload := fmt.Sprintf("V1|%s|%d|%d|%d|%t|%t",
		usage.Date,
		usage.UsedSeconds,
		usage.UsedTransfers,
		usage.UsedReceiveTransfers,
		usage.IsPaid,
		usage.ClockTampered,
	)
	h.Write([]byte(payload))
	return hex.EncodeToString(h.Sum(nil))
}

func computeUsageMAC(usage ChatUsage, machineKey string) string {
	if machineKey == "" {
		machineKey = "EQT_DEFAULT_USAGE_KEY"
	}
	h := hmac.New(sha256.New, []byte("EQT_USAGE_HMAC_v1:"+machineKey))
	payload := fmt.Sprintf("V2|%s|%d|%d|%d|%t|%t|%s",
		usage.Date,
		usage.UsedSeconds,
		usage.UsedTransfers,
		usage.UsedReceiveTransfers,
		usage.IsPaid,
		usage.ClockTampered,
		usage.LastSeen,
	)
	h.Write([]byte(payload))
	return hex.EncodeToString(h.Sum(nil))
}

func (l *ChatLimiter) loadUsageLocked() ChatUsage {
	if mock := getMockUsageForAcceptance(); mock != nil {
		return *mock
	}

	netTime, isOnline := getNetworkTimeOrStartFetch()
	today := netTime.UTC().Format("2006-01-02")

	if l.hasCached && l.cachedUsage.Date == today {
		usage := l.cachedUsage
		l.checkLicenseValidity(&usage)
		return usage
	}

	path := getChatUsageFilePath()
	var usage ChatUsage
	readOk := false
	tampered := false

	if data, err := os.ReadFile(path); err == nil && len(data) > 0 {
		if errJson := json.Unmarshal(data, &usage); errJson == nil && usage.Date != "" {
			readOk = true
			machineKey := GetDeviceStableID()
			if usage.MAC != "" && usage.MAC != computeUsageMAC(usage, machineKey) && usage.MAC != computeUsageMACV1(usage, machineKey) {
				// Local usage file has been maliciously edited!
				tampered = true
			}
		}
	}

	dateChanged := false
	if !readOk || usage.Date != today {
		usage.Date = today
		usage.UsedSeconds = 0
		usage.UsedTransfers = 0
		usage.UsedReceiveTransfers = 0
		dateChanged = true
	}

	// Anti-rollback anchor reference: network-corrected time when authoritative,
	// otherwise local wall clock (the optimistic cold-start guess is raw local time).
	refTime := netTime

	oldPaid := usage.IsPaid
	oldTampered := usage.ClockTampered

	l.checkLicenseValidity(&usage)

	// Informational clock-drift hint only — never locks quota. Surfaced to the UI as
	// "system time out of sync" so a genuinely wrong clock is not penalized.
	drift := false
	if isOnline && os.Getenv("EQT_TESTING") != "true" {
		if diff := time.Since(netTime); diff < -clockDriftThreshold || diff > clockDriftThreshold {
			drift = true
		}
	}

	// Local anti-rollback anchor: a clock rolled back between writes (to regain the
	// daily quota) puts refTime before the persisted last-seen moment. This is the
	// free-tier counterpart of the paid certificate LastSeenLocalTime check.
	rollback := rollbackDetected(&usage, refTime)
	if rollback {
		usage.ClockTampered = true
		usage.IsPaid = false
		usage.UsedSeconds = 600
		usage.UsedTransfers = 5
		usage.UsedReceiveTransfers = 5
		if !oldTampered {
			go SetClockTampered(true)
		}
	} else if tampered {
		usage.ClockTampered = true
		usage.UsedSeconds = 600
		usage.UsedTransfers = 5
		usage.UsedReceiveTransfers = 5
		if !oldTampered {
			go SetClockTampered(true)
		}
	} else if usage.ClockTampered && !tampered && !rollback && isNetTimeCached() && os.Getenv("EQT_TESTING") != "true" {
		// Self-healing only against authoritatively calibrated network time — the
		// optimistic cold-start path must never clear a real tamper flag. A resolved
		// false positive clears the flag without restoring already-burned quota.
		if diff := time.Since(netTime); diff >= -clockDriftThreshold && diff <= clockDriftThreshold {
			usage.ClockTampered = false
			go SetClockTampered(false)
		}
	}

	// Refresh the anchor on the returned/cached value; the periodic-save throttle
	// decides whether it also reaches disk this pass.
	anchorDue := usage.LastSeen == "" || lastSeenAge(refTime, usage.LastSeen) >= 1*time.Minute
	usage.LastSeen = refTime.UTC().Format(time.RFC3339)

	if dateChanged || oldPaid != usage.IsPaid || oldTampered != usage.ClockTampered || tampered || rollback || anchorDue {
		l.saveUsageLocked(usage)
	} else {
		l.cachedUsage = usage
		l.hasCached = true
		l.lastCacheTime = time.Now()
	}

	// Cache may have been written via the save path (which strips ClockDrift); restore
	// the live hint so GetStatus polls keep surfacing it until the next reload.
	l.cachedUsage.ClockDrift = drift
	usage.ClockDrift = drift
	return usage
}

func (l *ChatLimiter) saveUsageLocked(usage ChatUsage) {
	drift := usage.ClockDrift
	if !drift && l.cachedUsage.ClockDrift {
		drift = l.cachedUsage.ClockDrift
	}

	// Refresh the anti-rollback anchor on every persisted write so a later rollback
	// is caught against the most recent honest wall-clock moment.
	usage.LastSeen = netTimeNow().UTC().Format(time.RFC3339)
	// ClockDrift is a live, derived hint; never persist or MAC it.
	usage.ClockDrift = false

	machineKey := GetDeviceStableID()
	usage.MAC = computeUsageMAC(usage, machineKey)

	path := getChatUsageFilePath()
	data, err := json.Marshal(usage)
	if err == nil {
		_ = writeAtomic(path, data, 0644)
	}

	l.cachedUsage = usage
	l.cachedUsage.ClockDrift = drift
	l.hasCached = true
	l.lastCacheTime = time.Now()
}

type syncUsageRequest struct {
	DeviceID       string `json:"device_id"`
	DeltaSeconds   int    `json:"delta_seconds"`
	DeltaTransfers int    `json:"delta_transfers"`
}

type syncUsageResponse struct {
	Success       bool   `json:"success"`
	DeviceID      string `json:"device_id"`
	UsageDate     string `json:"usage_date"`
	UsedSeconds   int    `json:"used_seconds"`
	UsedTransfers int    `json:"used_transfers"`
	QuotaExceeded bool   `json:"quota_exceeded"`
	IsPaid        bool   `json:"is_paid"`
	ServerTime    string `json:"server_time"`
	Signature     string `json:"signature,omitempty"`
	Error         string `json:"error,omitempty"`
}

// SyncUsageToServer reports usage delta and aligns with authoritative cloud quota (§8)
func SyncUsageToServer(deltaSeconds, deltaTransfers int) {
	if GetPaidStatus() || os.Getenv("EQT_TESTING") == "true" {
		return
	}
	devID := GetDeviceStableID()
	if devID == "" {
		return
	}
	serverURL := getLicenseServer()
	if serverURL == "" {
		return
	}

	go func() {
		reqBody, _ := json.Marshal(syncUsageRequest{
			DeviceID:       devID,
			DeltaSeconds:   deltaSeconds,
			DeltaTransfers: deltaTransfers,
		})

		client := http.Client{Timeout: 3 * time.Second}
		resp, err := client.Post(serverURL+"/api/v1/device/sync-usage", "application/json", bytes.NewReader(reqBody))
		if err != nil {
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return
		}

		var result syncUsageResponse
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil || !result.Success {
			return
		}

		if result.IsPaid {
			return
		}

		// Cryptographic Ed25519 signature verification against rogue server / MITM attacks (fail-closed)
		if result.Signature == "" || !VerifySyncUsageSignature(result.DeviceID, result.UsageDate, result.UsedSeconds, result.UsedTransfers, result.QuotaExceeded, result.ServerTime, result.Signature) {
			return
		}

		limiterInstance.mu.Lock()
		defer limiterInstance.mu.Unlock()

		usage := limiterInstance.loadUsageLocked()
		if usage.Date == result.UsageDate {
			updated := false
			if result.UsedSeconds > usage.UsedSeconds {
				usage.UsedSeconds = result.UsedSeconds
				updated = true
			}
			if result.UsedTransfers > usage.UsedTransfers {
				usage.UsedTransfers = result.UsedTransfers
				updated = true
			}
			if result.QuotaExceeded && usage.UsedSeconds < 600 {
				usage.UsedSeconds = 600
				updated = true
			}
			if updated {
				limiterInstance.saveUsageLocked(usage)
			}
		}
	}()
}

// IncrementUsage adds used seconds to the daily counter if not paid.
func (l *ChatLimiter) IncrementUsage(seconds int) (ChatUsage, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()

	usage := l.loadUsageLocked()
	if usage.IsPaid {
		return usage, false
	}

	usage.UsedSeconds += seconds
	l.saveUsageLocked(usage)

	go SyncUsageToServer(seconds, 0)

	limitReached := usage.UsedSeconds >= FreeChatDailySeconds
	return usage, limitReached
}

// GetStatus returns the current daily chat usage status.
func (l *ChatLimiter) GetStatus() ChatUsage {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.loadUsageLocked()
}

// SetClockTampered updates clock tampered status and persists it to disk.
func (l *ChatLimiter) SetClockTampered(tampered bool) {
	l.mu.Lock()
	defer l.mu.Unlock()

	usage := l.loadUsageLocked()
	usage.ClockTampered = tampered
	if tampered {
		usage.IsPaid = false
	}
	l.saveUsageLocked(usage)
}

// SetPaidDetails updates the payment status and license metadata.
func (l *ChatLimiter) SetPaidDetails(paid bool, redeemedAt string, codeDate string, tier string) ChatUsage {
	// Sync memory caches in license.go first to align dynamic validation checks
	paidStateMu.Lock()
	cachedIsPaid = paid
	cachedTier = tier
	cachedCodeDate = codeDate
	if !paid {
		cachedTier = ""
		cachedCodeDate = ""
	}
	paidStateMu.Unlock()

	l.mu.Lock()
	defer l.mu.Unlock()

	usage := l.loadUsageLocked()
	oldPaid := usage.IsPaid
	usage.IsPaid = paid
	usage.RedeemedAt = redeemedAt
	usage.CodeDate = codeDate
	usage.LicenseTier = tier
	if paid {
		// Reset clock tampering lock only on valid paid activation
		usage.ClockTampered = false
	}
	l.saveUsageLocked(usage)

	if l.activeSession != nil {
		l.activeSession.mu.Lock()
		if paid && !oldPaid {
			tierText := "PRO"
			if tier != "" {
				switch tier {
				case "PLUS":
					if codeDate == "LIFETIME" {
						tierText = "PLUS U"
					} else {
						tierText = "PLUS"
					}
				case "PRO":
					tierText = "PRO"
				default:
					tierText = strings.ToUpper(tier)
				}
			}
			l.activeSession.addSystemMessageLocked("Premium activated: " + tierText + ".")
		} else if !paid && oldPaid {
			l.activeSession.addSystemMessageLocked("License reset. Back to free tier.")
		}
		l.activeSession.notifyLocked()
		l.activeSession.mu.Unlock()
	}

	return usage
}

// GetUsedSeconds returns the current daily chat usage seconds.
func GetUsedSeconds() int {
	return limiterInstance.GetStatus().UsedSeconds
}

// GetClockDrift reports whether the local system clock deviates from the
// authoritative network time beyond the tolerance threshold. Informational
// only: the quota is never locked for drift, the UI shows a hint instead.
func GetClockDrift() bool {
	return limiterInstance.GetStatus().ClockDrift
}

// SetUsedSeconds updates the daily used seconds.
func (l *ChatLimiter) SetUsedSeconds(seconds int) ChatUsage {
	l.mu.Lock()
	defer l.mu.Unlock()

	usage := l.loadUsageLocked()
	usage.UsedSeconds = seconds
	l.saveUsageLocked(usage)
	return usage
}

// SetUsedSeconds updates the daily used seconds globally.
func SetUsedSeconds(seconds int) {
	limiterInstance.SetUsedSeconds(seconds)
}

// IncrementTransfers adds count to daily used transfers if not paid.
func (l *ChatLimiter) IncrementTransfers(count int) (ChatUsage, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()

	usage := l.loadUsageLocked()
	if usage.IsPaid {
		return usage, false
	}

	usage.UsedTransfers += count
	l.saveUsageLocked(usage)

	go SyncUsageToServer(0, count)

	limitReached := usage.UsedTransfers >= 5
	return usage, limitReached
}

// SetUsedTransfers updates the daily used transfers.
func (l *ChatLimiter) SetUsedTransfers(transfers int) ChatUsage {
	l.mu.Lock()
	defer l.mu.Unlock()

	usage := l.loadUsageLocked()
	usage.UsedTransfers = transfers
	l.saveUsageLocked(usage)
	return usage
}

func GetUsedTransfers() int {
	return limiterInstance.GetStatus().UsedTransfers
}

func IncrementUsedTransfers(count int) {
	_, _ = limiterInstance.IncrementTransfers(count)
}

func SetUsedTransfers(transfers int) {
	limiterInstance.SetUsedTransfers(transfers)
}

// IncrementReceiveTransfers adds count to daily used receive transfers if not paid.
func (l *ChatLimiter) IncrementReceiveTransfers(count int) (ChatUsage, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()

	usage := l.loadUsageLocked()
	if usage.IsPaid {
		return usage, false
	}

	usage.UsedReceiveTransfers += count
	l.saveUsageLocked(usage)

	go SyncUsageToServer(0, count)

	limitReached := usage.UsedReceiveTransfers >= 5
	return usage, limitReached
}

// SetUsedReceiveTransfers updates the daily used receive transfers.
func (l *ChatLimiter) SetUsedReceiveTransfers(transfers int) ChatUsage {
	l.mu.Lock()
	defer l.mu.Unlock()

	usage := l.loadUsageLocked()
	usage.UsedReceiveTransfers = transfers
	l.saveUsageLocked(usage)
	return usage
}

func GetUsedReceiveTransfers() int {
	return limiterInstance.GetStatus().UsedReceiveTransfers
}

func IncrementUsedReceiveTransfers(count int) {
	_, _ = limiterInstance.IncrementReceiveTransfers(count)
}

func SetUsedReceiveTransfers(transfers int) {
	limiterInstance.SetUsedReceiveTransfers(transfers)
}
