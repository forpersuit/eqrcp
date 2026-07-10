package bandwidth

// Policy defines limits for a transfer class.
type Policy struct {
	MaxSpeed int64 // bytes per second
}

var (
	// PolicyFree limits visitor connections to 2MB/s.
	PolicyFree = Policy{MaxSpeed: 2 * 1024 * 1024}
	// PolicyPaid limits paid connections to 100MB/s.
	PolicyPaid = Policy{MaxSpeed: 100 * 1024 * 1024}
)
