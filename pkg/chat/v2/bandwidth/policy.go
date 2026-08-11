package bandwidth

// Policy defines limits for a transfer class (attachment data plane only).
// WebSocket control/heartbeat/text paths must never use these caps.
type Policy struct {
	MaxSpeed int64 // bytes per second
}

const (
	// DefaultFreeChatDailySeconds is the daily full-feature chat allowance for unpaid users (5 minutes).
	DefaultFreeChatDailySeconds = 300
	// DefaultFreeChatMaxAttachmentBytes is the per-file size cap after free chat quota is exhausted (4MB).
	DefaultFreeChatMaxAttachmentBytes = 4 * 1024 * 1024
	// DefaultFreeChatDegradedBytesPerSec is the attachment transfer rate cap after free chat quota is exhausted (100 KB/s).
	DefaultFreeChatDegradedBytesPerSec = 100 * 1024
)

var (
	// PolicyFreeDegraded is the free-tier over-quota attachment cap.
	PolicyFreeDegraded = Policy{MaxSpeed: DefaultFreeChatDegradedBytesPerSec}
	// PolicyFree is an alias kept for older call sites; same as free over-quota cap.
	PolicyFree = PolicyFreeDegraded
	// PolicyPaid is full-speed attachment transfer for paid users and free users still within daily quota.
	PolicyPaid = Policy{MaxSpeed: 100 * 1024 * 1024}
)
