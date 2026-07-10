package bandwidth

import (
	"context"
	"sync"
	"time"

	"eqt/pkg/chat/v2/diag"
)

type activeJob struct {
	id                  string
	isPaid              bool
	capacity            int64         // Estimated bottleneck capacity in bytes/sec
	probing             bool          // Currently in the probing phase
	probingStart        time.Time     // Time when probing started
	bytesAtProbingStart int64         // Total bytes transferred when probing started
	probingBytesLimit   int64         // Probing window size in bytes
	probingTimeLimit    time.Duration // Probing window duration limit
	bytesAtProbingEnd   int64         // Total bytes transferred when probing ended
	timeAtProbingEnd    time.Time     // Time when probing ended
}

// Scheduler owns data-plane fairness and controls transmission speed.
type Scheduler struct {
	mu           sync.RWMutex
	globalLimit  int64
	activeJobs   map[string]*activeJob
	Logger       diag.Logger   // Structured traceable logger
	ProbingBytes int64         // Configurable probing byte window. If <0, probing is disabled.
	ProbingTime  time.Duration // Configurable probing time window.
}

// NewScheduler creates a new Scheduler.
func NewScheduler(globalLimit int64) *Scheduler {
	if globalLimit <= 0 {
		globalLimit = 10 * 1024 * 1024 // 10MB/s default global bandwidth
	}
	return &Scheduler{
		globalLimit: globalLimit,
		activeJobs:  make(map[string]*activeJob),
	}
}

// RegisterJob adds a job to the active pool.
func (s *Scheduler) RegisterJob(id string, isPaid bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	pBytes := s.ProbingBytes
	if pBytes == 0 {
		pBytes = 2 * 1024 * 1024 // 2MB default probing window
	}
	pTime := s.ProbingTime
	if pTime == 0 {
		pTime = 2 * time.Second // 2s default probing window
	}

	s.activeJobs[id] = &activeJob{
		id:                id,
		isPaid:            isPaid,
		probing:           pBytes > 0, // Enabled if ProbingBytes > 0
		probingBytesLimit: pBytes,
		probingTimeLimit:  pTime,
	}
}

// UnregisterJob removes a job from the active pool.
func (s *Scheduler) UnregisterJob(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.activeJobs, id)
}

// LimitForJob calculates the dynamic capacity-aware allocated rate for a job.
func (s *Scheduler) LimitForJob(id string) int64 {
	s.mu.RLock()
	defer s.mu.RUnlock()

	job, exists := s.activeJobs[id]
	if !exists {
		return 32 * 1024 // 32KB/s fallback minimum
	}

	rateCap := PolicyFree.MaxSpeed
	if job.isPaid {
		rateCap = PolicyPaid.MaxSpeed
	}

	// 1. If probing is disabled (legacy fallback), return standard fair share
	if s.ProbingBytes < 0 {
		n := int64(len(s.activeJobs))
		if n <= 0 {
			n = 1
		}
		rate := s.globalLimit / n
		if rate > rateCap {
			rate = rateCap
		}
		if rate < 32*1024 {
			rate = 32 * 1024
		}
		return rate
	}

	// 2. If job is still in probing window, let it run at maximum policy speed
	if job.probing {
		return rateCap
	}

	// 3. Count active jobs and estimate remaining pool
	var totalNonProbingCapacity int64
	var nonProbingCount int64
	var activeProbingCapacity int64

	for _, j := range s.activeJobs {
		if j.probing {
			// Estimate current usage of active probing jobs
			if j.capacity > 0 {
				activeProbingCapacity += j.capacity
			} else {
				if j.isPaid {
					activeProbingCapacity += PolicyPaid.MaxSpeed
				} else {
					activeProbingCapacity += PolicyFree.MaxSpeed
				}
			}
		} else {
			nonProbingCount++
			if j.capacity > 0 {
				totalNonProbingCapacity += j.capacity
			} else {
				totalNonProbingCapacity += 32 * 1024 // Minimum fallback capacity
			}
		}
	}

	// Calculate remaining pool for non-probing jobs
	pool := s.globalLimit - activeProbingCapacity
	minGuaranteePool := nonProbingCount * 32 * 1024
	if pool < minGuaranteePool {
		pool = minGuaranteePool
	}

	if totalNonProbingCapacity <= 0 {
		totalNonProbingCapacity = 1
	}

	jobCapacity := job.capacity
	if jobCapacity <= 0 {
		jobCapacity = 32 * 1024
	}

	rate := int64(float64(pool) * (float64(jobCapacity) / float64(totalNonProbingCapacity)))

	// Clamp allocated rate by policy cap and estimated bottleneck capacity
	if rate > rateCap {
		rate = rateCap
	}
	if rate > jobCapacity {
		rate = jobCapacity
	}
	if rate < 32*1024 {
		rate = 32 * 1024 // Starvation prevention floor limit
	}

	// Trace rate allocation decisions in debug logs
	diag.Emit(context.Background(), s.Logger, diag.LevelDebug, "bandwidth rate allocated", nil,
		diag.F("jobID", id),
		diag.F("allocatedRateBytesPerSec", rate),
		diag.F("capacityBytesPerSec", job.capacity),
		diag.F("activeJobsCount", len(s.activeJobs)),
	)

	return rate
}

// Throttle enforces the speed limit on a job by making the caller sleep.
func (s *Scheduler) Throttle(id string, totalBytesTransferred int64, startTime time.Time) {
	s.mu.Lock()
	job, exists := s.activeJobs[id]
	if !exists {
		s.mu.Unlock()
		return
	}

	// Handle Probing phase transitions and bandwidth measurement
	if s.ProbingBytes >= 0 && job.probing {
		if job.probingStart.IsZero() {
			warmUpLimit := int64(0)
			if s.ProbingBytes >= 256*1024 {
				warmUpLimit = 128 * 1024
			}
			if totalBytesTransferred < warmUpLimit {
				s.mu.Unlock()
				return
			}
			job.probingStart = time.Now()
			job.bytesAtProbingStart = totalBytesTransferred
			s.mu.Unlock()
			diag.Emit(context.Background(), s.Logger, diag.LevelInfo, "bandwidth probing started", nil,
				diag.F("jobID", id),
				diag.F("isPaid", job.isPaid),
				diag.F("warmUpBytes", totalBytesTransferred),
			)
			return
		}

		elapsed := time.Since(job.probingStart)
		bytesProbed := totalBytesTransferred - job.bytesAtProbingStart
		if bytesProbed >= job.probingBytesLimit || elapsed >= job.probingTimeLimit {
			// Probing finished! Transition to throttle phase
			if elapsed > 0 {
				job.capacity = int64(float64(bytesProbed) / elapsed.Seconds())
			}
			// Safeguard: sanitize estimated capacity to prevent slow-start stall lockouts
			minCapacity := int64(512 * 1024) // 512KB/s minimum floor for Free users
			if job.isPaid {
				minCapacity = 2 * 1024 * 1024 // 2MB/s minimum floor for Paid users
			}
			if job.capacity < minCapacity {
				job.capacity = minCapacity
			}

			job.probing = false
			job.bytesAtProbingEnd = totalBytesTransferred
			job.timeAtProbingEnd = time.Now()
			capacity := job.capacity
			s.mu.Unlock()

			diag.Emit(context.Background(), s.Logger, diag.LevelInfo, "bandwidth probing completed", nil,
				diag.F("jobID", id),
				diag.F("estimatedCapacityBytesPerSec", capacity),
				diag.F("bytesProbed", bytesProbed),
				diag.F("elapsedSec", elapsed.Seconds()),
			)
			return
		}

		// Update sliding capacity estimate during active probing
		if elapsed > 0 && bytesProbed > 0 {
			job.capacity = int64(float64(bytesProbed) / elapsed.Seconds())
		}
		s.mu.Unlock()
		return
	}
	s.mu.Unlock()

	// Handle Throttle phase sleep calculation
	var bytesToThrottle int64
	var elapsedToThrottle time.Duration

	if s.ProbingBytes < 0 {
		bytesToThrottle = totalBytesTransferred
		elapsedToThrottle = time.Since(startTime)
	} else {
		bytesToThrottle = totalBytesTransferred - job.bytesAtProbingEnd
		elapsedToThrottle = time.Since(job.timeAtProbingEnd)
	}

	limit := s.LimitForJob(id)
	if limit <= 0 {
		return
	}

	expectedTime := time.Duration(bytesToThrottle) * time.Second / time.Duration(limit)

	if elapsedToThrottle < expectedTime {
		sleep := expectedTime - elapsedToThrottle
		if sleep > 1*time.Second {
			sleep = 1 * time.Second
		}
		time.Sleep(sleep)
	}
}
