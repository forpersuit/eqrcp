package bandwidth

// Policy defines limits for a transfer class (attachment data plane only).
// WebSocket control/heartbeat/text paths must never use these caps.
type Policy struct {
	MaxSpeed int64 // bytes per second
}

var (
	// PolicyFreeDegraded is the free-tier over-quota attachment cap (100 KB/s).
	PolicyFreeDegraded = Policy{MaxSpeed: 100 * 1024}
	// PolicyFree is an alias kept for older call sites; same as free over-quota cap.
	PolicyFree = PolicyFreeDegraded
	// PolicyPaid is full-speed attachment transfer for paid users and free users still within daily quota.
	PolicyPaid = Policy{MaxSpeed: 100 * 1024 * 1024}
)
