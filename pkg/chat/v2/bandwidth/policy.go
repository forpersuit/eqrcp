package bandwidth

// Policy defines limits for a transfer class.
type Policy struct {
	MaxSpeed int64 // bytes per second
}

var (
	// PolicyFree limits visitor connections to 512KB/s.
	PolicyFree = Policy{MaxSpeed: 512 * 1024}
	// PolicyPaid limits paid connections to 10MB/s.
	PolicyPaid = Policy{MaxSpeed: 10 * 1024 * 1024}
)
