package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"eqt/pkg/config"
)

// ChatUsage holds the daily usage statistics and premium license tracking.
type ChatUsage struct {
	Date                 string `json:"date"`
	UsedSeconds          int    `json:"usedSeconds"`
	UsedTransfers        int    `json:"usedTransfers"` // Daily transfers count (Share)
	UsedReceiveTransfers int    `json:"usedReceiveTransfers"` // Daily Receive transfers count
	IsPaid               bool   `json:"isPaid"`
	LastTime             int64  `json:"lastTime"`      // Last running timestamp in seconds
	RedeemedAt           string `json:"redeemedAt"`    // ISO format activation time
	CodeDate             string `json:"codeDate"`      // Code issue date or "LIFETIME"
	ClockTampered        bool   `json:"clockTampered"` // Locked if clock rollback is detected
	LicenseTier          string `json:"licenseTier"`   // Activated license tier (e.g. PLUS, PRO)
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

func getHiddenBackupFilePath() string {
	if os.Getenv("EQT_TESTING") == "true" {
		return ""
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".eqt_sys_state")
}

func xorObfuscate(data []byte) []byte {
	key := byte(0xAD)
	result := make([]byte, len(data))
	for i, b := range data {
		result[i] = b ^ key
	}
	return result
}

func fetchNetworkTime() (time.Time, error) {
	client := http.Client{
		Timeout: 2 * time.Second,
	}
	// 1. 优先使用当前 DRM 激活所用的许可证服务器（基于 Cloudflare 全球 CDN，国内外访问都快且准确）
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

// getNetworkTimeOrStartFetch returns the best estimation of network time.
// It is non-blocking and triggers an asynchronous HTTP request if cache is stale or missing.
func getNetworkTimeOrStartFetch() time.Time {
	now := time.Now()
	if os.Getenv("EQT_TESTING") == "true" {
		return now
	}

	netTimeMu.Lock()
	// If cached, and the last check was successful and within 1 hour, use it.
	if netTimeCached && now.Sub(netTimeLastCheck) < 1*time.Hour {
		offset := netTimeOffset
		netTimeMu.Unlock()
		return now.Add(offset)
	}

	// If currently fetching, return estimated time (cached offset if available, otherwise local time).
	if netTimeIsChecking {
		if netTimeCached {
			offset := netTimeOffset
			netTimeMu.Unlock()
			return now.Add(offset)
		}
		netTimeMu.Unlock()
		return now
	}

	// Rate-limit failed checks to avoid spamming network requests when offline (e.g. retry once every 1 minute)
	if !netTimeCached && !netTimeLastCheck.IsZero() && now.Sub(netTimeLastCheck) < 1*time.Minute {
		netTimeMu.Unlock()
		return now
	}

	// Trigger async check
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
		return now.Add(netTimeOffset)
	}
	return now
}

func (l *ChatLimiter) checkLicenseValidity(usage *ChatUsage) {
	now := time.Now().Unix()

	// 1. Time anti-rollback verification
	if usage.LastTime > 0 && now < usage.LastTime-600 {
		usage.ClockTampered = true
	}

	if !usage.ClockTampered && now > usage.LastTime {
		usage.LastTime = now
	}

	// 2. Validate cryptographic local license (.lic) if exists
	licPath := getLicenseFilePath()
	var hasValidLic bool
	var cert LicenseCertificate

	if os.Getenv("EQT_TESTING") == "true" {
		// In testing environment, if no .lic file exists, fallback to JSON config paid status
		if _, err := os.Stat(licPath); os.IsNotExist(err) {
			hasValidLic = usage.IsPaid
			cert.Tier = usage.LicenseTier
			cert.ExpiresAt = usage.CodeDate
		}
	}

	if !hasValidLic {
		if data, err := os.ReadFile(licPath); err == nil {
			if err := json.Unmarshal(data, &cert); err == nil {
				// Verify signature, fingerprint, and expiration
				sigOk := VerifyLicenseSignature(cert)
				fpOk := VerifyFingerprint(cert)
				
				expOk := true
				if cert.ExpiresAt != "LIFETIME" {
					if expiry, err := time.Parse(time.RFC3339, cert.ExpiresAt); err == nil {
						currentTime := getNetworkTimeOrStartFetch()
						if currentTime.After(expiry) {
							expOk = false
						}
					} else {
						expOk = false
					}
				}

				if sigOk && fpOk && expOk {
					hasValidLic = true
				}
			}
		}
	}

	if hasValidLic {
		usage.IsPaid = true
		usage.LicenseTier = cert.Tier
		usage.CodeDate = cert.ExpiresAt
	} else {
		// No valid license certificate found on the machine. Revoke paid status.
		usage.IsPaid = false
		usage.LicenseTier = ""
	}

	// Force lock paid features if client clock was manipulated
	if usage.ClockTampered {
		usage.IsPaid = false
	}
}

func getMockUsageForAcceptance() *ChatUsage {
	mockEnv := os.Getenv("EQT_MOCK_STATUS")
	if mockEnv == "" {
		return nil
	}
	switch mockEnv {
	case "clock_tampered":
		return &ChatUsage{
			Date:          time.Now().Format("2006-01-02"),
			UsedSeconds:   300,
			IsPaid:        false,
			ClockTampered: true,
			LicenseTier:   "PLUS U",
		}
	case "inconsistent_unpaid":
		return &ChatUsage{
			Date:          time.Now().Format("2006-01-02"),
			UsedSeconds:   300,
			IsPaid:        false,
			ClockTampered: false,
			LicenseTier:   "PLUS U",
		}
	case "premium_active":
		return &ChatUsage{
			Date:          time.Now().Format("2006-01-02"),
			UsedSeconds:   120,
			IsPaid:        true,
			ClockTampered: false,
			LicenseTier:   "PLUS U",
		}
	case "free_quota":
		return &ChatUsage{
			Date:          time.Now().Format("2006-01-02"),
			UsedSeconds:   120,
			IsPaid:        false,
			ClockTampered: false,
			LicenseTier:   "",
		}
	case "free_exceeded":
		return &ChatUsage{
			Date:                 time.Now().Format("2006-01-02"),
			UsedSeconds:          300,
			UsedTransfers:        5,
			UsedReceiveTransfers: 5,
			IsPaid:               false,
			ClockTampered:        false,
			LicenseTier:          "",
		}
	case "free_exceeded_share":
		return &ChatUsage{
			Date:                 time.Now().Format("2006-01-02"),
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

func (l *ChatLimiter) loadUsageLocked() ChatUsage {
	if mock := getMockUsageForAcceptance(); mock != nil {
		return *mock
	}
	today := time.Now().Format("2006-01-02")
	if l.hasCached && l.cachedUsage.Date == today {
		return l.cachedUsage
	}

	path := getChatUsageFilePath()
	var usage ChatUsage
	readOk := false

	if data, err := os.ReadFile(path); err == nil && len(data) > 0 {
		if errJson := json.Unmarshal(data, &usage); errJson == nil && usage.Date != "" {
			readOk = true
		}
	}

	if !readOk {
		if backupPath := getHiddenBackupFilePath(); backupPath != "" {
			if backupData, err := os.ReadFile(backupPath); err == nil && len(backupData) > 0 {
				decrypted := xorObfuscate(backupData)
				if errJson := json.Unmarshal(decrypted, &usage); errJson == nil && usage.Date != "" {
					readOk = true
				}
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
	oldLastTime := usage.LastTime

	l.checkLicenseValidity(&usage)

	if dateChanged || oldPaid != usage.IsPaid || oldTampered != usage.ClockTampered || usage.LastTime != oldLastTime {
		l.saveUsageLocked(usage)
	} else {
		l.cachedUsage = usage
		l.hasCached = true
		l.lastCacheTime = time.Now()
	}

	return usage
}

func (l *ChatLimiter) saveUsageLocked(usage ChatUsage) {
	path := getChatUsageFilePath()
	data, err := json.Marshal(usage)
	if err == nil {
		_ = writeAtomic(path, data, 0644)

		if backupPath := getHiddenBackupFilePath(); backupPath != "" {
			obfuscated := xorObfuscate(data)
			_ = writeAtomic(backupPath, obfuscated, 0600)
		}
	}

	l.cachedUsage = usage
	l.hasCached = true
	l.lastCacheTime = time.Now()
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

	limitReached := usage.UsedSeconds >= 300
	return usage, limitReached
}

// GetStatus returns the current daily chat usage status.
func (l *ChatLimiter) GetStatus() ChatUsage {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.loadUsageLocked()
}

// SetPaidDetails updates the payment status and license metadata.
func (l *ChatLimiter) SetPaidDetails(paid bool, redeemedAt string, codeDate string, tier string) ChatUsage {
	l.mu.Lock()
	defer l.mu.Unlock()

	usage := l.loadUsageLocked()
	oldPaid := usage.IsPaid
	usage.IsPaid = paid
	usage.RedeemedAt = redeemedAt
	usage.CodeDate = codeDate
	usage.LicenseTier = tier
	// Reset clock tampering lock on explicit activation or reset
	usage.ClockTampered = false
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

// SetPaidStatus updates the payment status globally.
func SetPaidStatus(paid bool, redeemedAt string, codeDate string, tier string) {
	limiterInstance.SetPaidDetails(paid, redeemedAt, codeDate, tier)
}

// GetPaidStatus returns whether the premium status is activated.
func GetPaidStatus() bool {
	return limiterInstance.GetStatus().IsPaid
}

// GetLicenseTier returns the current license tier (e.g. PLUS, PRO).
func GetLicenseTier() string {
	return limiterInstance.GetStatus().LicenseTier
}

// GetCodeDate returns the current license code issue date or "LIFETIME".
func GetCodeDate() string {
	return limiterInstance.GetStatus().CodeDate
}

// GetClockTamperedStatus returns whether the system clock has been tampered.
func GetClockTamperedStatus() bool {
	return limiterInstance.GetStatus().ClockTampered
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


