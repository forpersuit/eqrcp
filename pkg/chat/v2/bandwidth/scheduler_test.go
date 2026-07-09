package bandwidth

import (
	"testing"
	"time"
)

func TestSchedulerBandwidthFairShare(t *testing.T) {
	// Set global limit to 1MB/s and disable probing for legacy test compatibility
	sched := NewScheduler(1024 * 1024)
	sched.ProbingBytes = -1

	sched.RegisterJob("job-free-1", false)

	// Free policy limits to 512KB/s, fairShare is 1MB. Min(1MB, 512KB) = 512KB.
	limit1 := sched.LimitForJob("job-free-1")
	if limit1 != PolicyFree.MaxSpeed {
		t.Fatalf("job limit = %d, want %d (Free Policy Cap)", limit1, PolicyFree.MaxSpeed)
	}

	// Register a second job (paid)
	sched.RegisterJob("job-paid-2", true)

	// Two jobs active. Fair share per job is 1MB / 2 = 512KB.
	// For job-paid-2: Min(512KB, 10MB) = 512KB.
	limit2 := sched.LimitForJob("job-paid-2")
	if limit2 != 512*1024 {
		t.Fatalf("job-paid limit = %d, want 512KB (Fair Share)", limit2)
	}

	// For job-free-1: Min(512KB, 512KB) = 512KB.
	limit1Post := sched.LimitForJob("job-free-1")
	if limit1Post != 512*1024 {
		t.Fatalf("job-free limit = %d, want 512KB", limit1Post)
	}

	// Register a third job (paid)
	sched.RegisterJob("job-paid-3", true)

	// Three jobs active. Fair share is 1MB / 3 = 349525 bytes.
	// For job-paid-3: Min(349525, 10MB) = 349525 bytes.
	limit3 := sched.LimitForJob("job-paid-3")
	expectedLimit := int64(1024 * 1024 / 3)
	if limit3 != expectedLimit {
		t.Fatalf("job-paid-3 limit = %d, want %d", limit3, expectedLimit)
	}

	// Unregister one job
	sched.UnregisterJob("job-free-1")
	limit2Post := sched.LimitForJob("job-paid-2")
	if limit2Post != 512*1024 { // 1MB / 2
		t.Fatalf("post unregister job-paid-2 limit = %d, want 512KB", limit2Post)
	}
}

func TestSchedulerThrottleproportionalSleep(t *testing.T) {
	// Set global limit to very slow 10KB/s and disable probing
	sched := NewScheduler(10 * 1024)
	sched.ProbingBytes = -1
	sched.RegisterJob("job-slow", true)

	startTime := time.Now()
	// Transfer 30KB. Expected time: 30KB / 10KB/s = 3 seconds.
	// Throttle should force time.Sleep to reach ~3 seconds.
	sched.Throttle("job-slow", 30*1024, startTime)

	elapsed := time.Since(startTime)
	if elapsed < 800*time.Millisecond {
		t.Fatalf("expected throttle sleep for around 1s limit, but elapsed only = %v", elapsed)
	}
}

func TestSchedulerProbingAndCapacityEstimation(t *testing.T) {
	sched := NewScheduler(1024 * 1024)
	sched.ProbingBytes = 1000 // 1KB limit
	sched.ProbingTime = 100 * time.Millisecond

	sched.RegisterJob("job-probing", true)

	// In probing phase, it should return PolicyPaid.MaxSpeed
	limit := sched.LimitForJob("job-probing")
	if limit != PolicyPaid.MaxSpeed {
		t.Fatalf("probing limit = %d, want PolicyPaid.MaxSpeed", limit)
	}

	// Trigger Throttle to start probing
	sched.Throttle("job-probing", 100, time.Now())

	// Sleep slightly to simulate transfer duration
	time.Sleep(50 * time.Millisecond)

	// Trigger Throttle to exceed probing limit
	sched.Throttle("job-probing", 1200, time.Now())

	// Check that it transitioned out of probing
	sched.mu.RLock()
	job := sched.activeJobs["job-probing"]
	probing := job.probing
	capacity := job.capacity
	sched.mu.RUnlock()

	if probing {
		t.Fatalf("job should have finished probing")
	}
	if capacity <= 0 {
		t.Fatalf("estimated capacity should be greater than 0, got %d", capacity)
	}
}

func TestSchedulerCapacityAwareProportionalAllocation(t *testing.T) {
	// Global limit is 4MB/s
	sched := NewScheduler(4 * 1024 * 1024)
	sched.ProbingBytes = 1000 // Enable probing window so capacity-aware logic is active

	sched.RegisterJob("job-slow", true)
	sched.RegisterJob("job-fast", true)

	// Manually inject estimated capacities
	sched.mu.Lock()
	sched.activeJobs["job-slow"].probing = false
	sched.activeJobs["job-slow"].capacity = 1 * 1024 * 1024 // 1MB/s
	sched.activeJobs["job-fast"].probing = false
	sched.activeJobs["job-fast"].capacity = 3 * 1024 * 1024 // 3MB/s
	sched.mu.Unlock()

	// Proportional allocation:
	// Slow job should get: 4MB * (1MB / 4MB) = 1MB/s
	// Fast job should get: 4MB * (3MB / 4MB) = 3MB/s
	limitSlow := sched.LimitForJob("job-slow")
	limitFast := sched.LimitForJob("job-fast")

	if limitSlow != 1*1024*1024 {
		t.Fatalf("job-slow rate = %d, want 1MB/s, got %d", limitSlow, limitSlow)
	}
	if limitFast != 3*1024*1024 {
		t.Fatalf("job-fast rate = %d, want 3MB/s, got %d", limitFast, limitFast)
	}
}
