package server

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"

	"eqt/config"
)

// ChatUsage holds the daily usage statistics.
type ChatUsage struct {
	Date        string `json:"date"`
	UsedSeconds int    `json:"usedSeconds"`
	IsPaid      bool   `json:"isPaid"`
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

func (l *ChatLimiter) loadUsage() ChatUsage {
	path := getChatUsageFilePath()
	var usage ChatUsage
	data, err := os.ReadFile(path)
	if err == nil {
		_ = json.Unmarshal(data, &usage)
	}

	today := time.Now().Format("2006-01-02")
	if usage.Date != today {
		usage.Date = today
		usage.UsedSeconds = 0
		// Keep isPaid status across days
	}
	return usage
}

func (l *ChatLimiter) saveUsage(usage ChatUsage) {
	path := getChatUsageFilePath()
	_ = os.MkdirAll(filepath.Dir(path), 0755)
	data, _ := json.Marshal(usage)
	_ = os.WriteFile(path, data, 0644)
}

// IncrementUsage adds used seconds to the daily counter if not paid.
// Returns current usage status and true if the limit has been reached.
func (l *ChatLimiter) IncrementUsage(seconds int) (ChatUsage, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()

	usage := l.loadUsage()
	if usage.IsPaid {
		return usage, false
	}

	usage.UsedSeconds += seconds
	l.saveUsage(usage)

	limitReached := usage.UsedSeconds >= 300
	return usage, limitReached
}

// GetStatus returns the current daily chat usage status.
func (l *ChatLimiter) GetStatus() ChatUsage {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.loadUsage()
}

// SetPaid updates the payment status.
func (l *ChatLimiter) SetPaid(paid bool) ChatUsage {
	l.mu.Lock()
	defer l.mu.Unlock()

	usage := l.loadUsage()
	usage.IsPaid = paid
	l.saveUsage(usage)

	// Notify active session to immediately refresh frontend clients
	if l.activeSession != nil {
		l.activeSession.mu.Lock()
		l.activeSession.notifyLocked()
		l.activeSession.mu.Unlock()
	}

	return usage
}

// SetPaidStatus updates the payment status globally.
func SetPaidStatus(paid bool) {
	limiterInstance.SetPaid(paid)
}

// GetPaidStatus returns whether the premium status is activated.
func GetPaidStatus() bool {
	return limiterInstance.GetStatus().IsPaid
}
