package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"eqt/config"
)

// ChatUsage holds the daily usage statistics and premium license tracking.
type ChatUsage struct {
	Date          string `json:"date"`
	UsedSeconds   int    `json:"usedSeconds"`
	IsPaid        bool   `json:"isPaid"`
	LastTime      int64  `json:"lastTime"`      // Last running timestamp in seconds
	RedeemedAt    string `json:"redeemedAt"`    // ISO format activation time
	CodeDate      string `json:"codeDate"`      // Code issue date or "LIFETIME"
	ClockTampered bool   `json:"clockTampered"` // Locked if clock rollback is detected
	LicenseTier   string `json:"licenseTier"`   // Activated license tier (e.g. PLUS, PRO)
}


// ChatLimiter manages daily chat time limits and payment state.
type ChatLimiter struct {
	mu            sync.Mutex
	activeSession *chatSession
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
	resp, err := client.Head("https://www.google.com")
	if err != nil {
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

func (l *ChatLimiter) checkLicenseValidity(usage *ChatUsage) {
	now := time.Now().Unix()

	// 1. Time anti-rollback verification
	if usage.LastTime > 0 && now < usage.LastTime-600 {
		usage.ClockTampered = true
	}

	if !usage.ClockTampered && now > usage.LastTime {
		usage.LastTime = now
	}

	// 2. Premium license expiration check
	if usage.IsPaid && usage.RedeemedAt != "" && usage.CodeDate != "LIFETIME" {
		redeemedTime, err := time.Parse(time.RFC3339, usage.RedeemedAt)
		if err == nil {
			expiryTime := redeemedTime.Add(365 * 24 * time.Hour)
			
			// Verify against highly-available NTP-like network date headers if connected
			currentTime := time.Now()
			netTime, err := fetchNetworkTime()
			if err == nil {
				currentTime = netTime
			}

			if currentTime.After(expiryTime) {
				usage.IsPaid = false
			}
		}
	}

	// Force lock paid features if client clock was manipulated
	if usage.ClockTampered {
		usage.IsPaid = false
	}
}

func (l *ChatLimiter) loadUsageLocked() ChatUsage {
	path := getChatUsageFilePath()
	var usage ChatUsage
	data, err := os.ReadFile(path)
	if err != nil {
		if backupPath := getHiddenBackupFilePath(); backupPath != "" {
			if backupData, err := os.ReadFile(backupPath); err == nil {
				decrypted := xorObfuscate(backupData)
				_ = json.Unmarshal(decrypted, &usage)
			}
		}
	} else {
		_ = json.Unmarshal(data, &usage)
	}

	today := time.Now().Format("2006-01-02")
	dateChanged := false
	if usage.Date != today {
		usage.Date = today
		usage.UsedSeconds = 0
		dateChanged = true
	}

	oldPaid := usage.IsPaid
	oldTampered := usage.ClockTampered
	oldLastTime := usage.LastTime

	l.checkLicenseValidity(&usage)

	if dateChanged || oldPaid != usage.IsPaid || oldTampered != usage.ClockTampered || usage.LastTime != oldLastTime {
		l.saveUsageLocked(usage)
	}

	return usage
}

func (l *ChatLimiter) saveUsageLocked(usage ChatUsage) {
	path := getChatUsageFilePath()
	_ = os.MkdirAll(filepath.Dir(path), 0755)
	data, _ := json.Marshal(usage)
	_ = os.WriteFile(path, data, 0644)

	if backupPath := getHiddenBackupFilePath(); backupPath != "" {
		obfuscated := xorObfuscate(data)
		_ = os.WriteFile(backupPath, obfuscated, 0600)
	}
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
	usage.IsPaid = paid
	usage.RedeemedAt = redeemedAt
	usage.CodeDate = codeDate
	usage.LicenseTier = tier
	if !paid {
		usage.ClockTampered = false // Reset rollback lock on license reset
	}
	l.saveUsageLocked(usage)

	if l.activeSession != nil {
		l.activeSession.mu.Lock()
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
