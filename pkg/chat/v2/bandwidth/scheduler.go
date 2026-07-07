package bandwidth

import (
	"sync"
	"time"
)

type activeJob struct {
	id     string
	isPaid bool
}

// Scheduler owns data-plane fairness and controls transmission speed.
type Scheduler struct {
	mu          sync.RWMutex
	globalLimit int64
	activeJobs  map[string]activeJob
}

// NewScheduler creates a new Scheduler.
func NewScheduler(globalLimit int64) *Scheduler {
	if globalLimit <= 0 {
		globalLimit = 10 * 1024 * 1024 // 10MB/s default global bandwidth
	}
	return &Scheduler{
		globalLimit: globalLimit,
		activeJobs:  make(map[string]activeJob),
	}
}

// RegisterJob adds a job to the active pool.
func (s *Scheduler) RegisterJob(id string, isPaid bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.activeJobs[id] = activeJob{id: id, isPaid: isPaid}
}

// UnregisterJob removes a job from the active pool.
func (s *Scheduler) UnregisterJob(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.activeJobs, id)
}

// LimitForJob calculates the fair share bandwidth limit for a job.
func (s *Scheduler) LimitForJob(id string) int64 {
	s.mu.RLock()
	defer s.mu.RUnlock()

	jobInfo, exists := s.activeJobs[id]
	if !exists {
		return 32 * 1024 // 32KB/s fallback minimum
	}

	n := int64(len(s.activeJobs))
	if n <= 0 {
		n = 1
	}

	// Dynamic fair share of the global limit
	fairShare := s.globalLimit / n

	// Default cap by policy
	limit := PolicyFree.MaxSpeed
	if jobInfo.isPaid {
		limit = PolicyPaid.MaxSpeed
	}

	if fairShare < limit {
		limit = fairShare
	}

	// Enforce floor limit to prevent starvation
	if limit < 32*1024 {
		limit = 32 * 1024
	}

	return limit
}

// Throttle enforces the speed limit on a job by making the caller sleep.
func (s *Scheduler) Throttle(id string, totalBytesTransferred int64, startTime time.Time) {
	limit := s.LimitForJob(id)
	if limit <= 0 {
		return
	}

	expectedTime := time.Duration(totalBytesTransferred) * time.Second / time.Duration(limit)
	elapsed := time.Since(startTime)

	if elapsed < expectedTime {
		sleep := expectedTime - elapsed
		if sleep > 1*time.Second {
			sleep = 1 * time.Second
		}
		time.Sleep(sleep)
	}
}
