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
	LastTime             int64  `json:"lastTime"`      // Last running timestamp in seconds
	RedeemedAt           string `json:"redeemedAt"`    // ISO format activation time
	CodeDate             string `json:"codeDate"`      // Code issue date or "LIFETIME"
	ClockTampered        bool   `json:"clockTampered"` // Locked if clock rollback is detected
	LicenseTier          string `json:"licenseTier"`   // Activated license tier (e.g. PLUS, PRO)
	MAC                  string `json:"mac,omitempty"` // HMAC-SHA256 integrity signature (§8)
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
		Timeout: 2 * time.Second,
	}
	// 1. 优先使用当前 DRM 激活所用的许可证服务器
	url := getLicenseServer()
	resp, err := client.Head(url)
	if err != nil {
		// 2. 备选全球高可用 CDN 域名
		resp, err = client.Head("https://www.cloudflare.com")
	}
	if err != nil {
		// 3. 备选国内高可用域名
		resp, err = client.Head("https://www.baidu.com")
	}
	if err != nil {
		return time.Time{}, err
	}
	defer resp.Body.Close()

	dateStr := resp.Header.Get("Date")
	if dateStr == "" {
		return time.Time{}, fmt.Errorf("no Date header")
	}
	return time.Parse(time.RFC1123, dateStr)
}

var (
	netTimeMu         sync.Mutex
	netTimeOffset     time.Duration
	netTimeCached     bool
	netTimeLastCheck  time.Time
	netTimeIsChecking bool
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
		netTimeMu.Unlock()
		return now, false
	}

	if !netTimeCached && !netTimeLastCheck.IsZero() && now.Sub(netTimeLastCheck) < 1*time.Minute {
		netTimeMu.Unlock()
		return now, false
	}

	netTimeIsChecking = true
	netTimeMu.Unlock()

	go func() {
		netTime, err := fetchNetworkTime()
		netTimeMu.Lock()
		defer netTimeMu.Unlock()
		netTimeIsChecking = false
		netTimeLastCheck = time.Now()
		if err == nil {
			netTimeOffset = time.Until(netTime)
			netTimeCached = true
		}
	}()

	netTimeMu.Lock()
	defer netTimeMu.Unlock()
	if netTimeCached {
		return now.Add(netTimeOffset), true
	}
	return now, false
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

func computeUsageMAC(usage ChatUsage, machineKey string) string {
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

func (l *ChatLimiter) loadUsageLocked() ChatUsage {
	if mock := getMockUsageForAcceptance(); mock != nil {
		return *mock
	}

	netTime, isOnline := getNetworkTimeOrStartFetch()
	today := netTime.UTC().Format("2006-01-02")

	if l.hasCached && l.cachedUsage.Date == today {
		usage := l.cachedUsage
		l.checkLicenseValidity(&usage)
		if !usage.IsPaid && !isOnline && os.Getenv("EQT_TESTING") != "true" {
			usage.UsedSeconds = 600
			usage.UsedTransfers = 5
			usage.UsedReceiveTransfers = 5
		}
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
			expectedMAC := computeUsageMAC(usage, machineKey)
			if usage.MAC != "" && usage.MAC != expectedMAC {
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

	oldPaid := usage.IsPaid
	oldTampered := usage.ClockTampered

	l.checkLicenseValidity(&usage)

	if tampered {
		usage.ClockTampered = true
		usage.UsedSeconds = 600
		usage.UsedTransfers = 5
		usage.UsedReceiveTransfers = 5
		if !oldTampered {
			go SetClockTampered(true)
		}
	} else if isOnline && !usage.IsPaid && os.Getenv("EQT_TESTING") != "true" {
		diff := time.Since(netTime)
		if diff < -10*time.Minute || diff > 10*time.Minute {
			usage.ClockTampered = true
			usage.IsPaid = false
			if !oldTampered {
				go SetClockTampered(true)
			}
		}
	}

	if dateChanged || oldPaid != usage.IsPaid || oldTampered != usage.ClockTampered || tampered {
		l.saveUsageLocked(usage)
	} else {
		l.cachedUsage = usage
		l.hasCached = true
		l.lastCacheTime = time.Now()
	}

	if !usage.IsPaid && !isOnline && os.Getenv("EQT_TESTING") != "true" {
		usage.UsedSeconds = 600
		usage.UsedTransfers = 5
		usage.UsedReceiveTransfers = 5
	}

	return usage
}

func (l *ChatLimiter) saveUsageLocked(usage ChatUsage) {
	machineKey := GetDeviceStableID()
	usage.MAC = computeUsageMAC(usage, machineKey)

	path := getChatUsageFilePath()
	data, err := json.Marshal(usage)
	if err == nil {
		_ = writeAtomic(path, data, 0644)
	}

	l.cachedUsage = usage
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

		// Cryptographic Ed25519 signature verification against rogue server / MITM attacks
		if result.Signature != "" {
			if !VerifySyncUsageSignature(result.DeviceID, result.UsageDate, result.UsedSeconds, result.UsedTransfers, result.QuotaExceeded, result.ServerTime, result.Signature) {
				return
			}
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
