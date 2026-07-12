package transfer

import (
	"fmt"
	"sync"

	"eqt/pkg/chat/v2/protocol"
)

// StateChangeCallback defines the handler triggered when a transfer job state or progress changes.
type StateChangeCallback func(token string, eventType protocol.EventType, event protocol.TransferEvent)

// Manager handles the lifecycle of uploads and downloads.
type Manager struct {
	mu            sync.RWMutex
	jobs          map[string]*Job
	onStateChange StateChangeCallback
}

// NewManager creates a new transfer Manager.
func NewManager() *Manager {
	return &Manager{
		jobs: make(map[string]*Job),
	}
}

// RegisterCallback registers a function to receive all state and throttled progress events.
func (m *Manager) RegisterCallback(cb StateChangeCallback) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.onStateChange = cb
}

// CreateJob registers a new transfer job and triggers the state change callback.
func (m *Manager) CreateJob(token, id, messageID, clientID, fileName string, bytesTotal int64) *Job {
	m.mu.Lock()
	job := NewJob(token, id, messageID, clientID, fileName, bytesTotal)
	m.jobs[id] = job
	cb := m.onStateChange
	m.mu.Unlock()

	if cb != nil {
		cb(token, protocol.EventTransferQueued, job.ToEvent())
	}
	return job
}

// GetJob retrieves a registered job by its ID.
func (m *Manager) GetJob(id string) (*Job, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	job, exists := m.jobs[id]
	if !exists {
		return nil, fmt.Errorf("job %s not found", id)
	}
	return job, nil
}

// StartJob changes the job state to running.
func (m *Manager) StartJob(id string) error {
	m.mu.RLock()
	job, exists := m.jobs[id]
	cb := m.onStateChange
	m.mu.RUnlock()

	if !exists {
		return fmt.Errorf("job %s not found", id)
	}

	job.UpdateState(protocol.TransferRunning, "")
	if cb != nil {
		cb(job.Token, protocol.EventTransferStarted, job.ToEvent())
	}
	return nil
}

// UpdateProgress updates the processed byte count, triggering progress events if throttled.
func (m *Manager) UpdateProgress(id string, bytesDone int64) error {
	m.mu.RLock()
	job, exists := m.jobs[id]
	cb := m.onStateChange
	m.mu.RUnlock()

	if !exists {
		return fmt.Errorf("job %s not found", id)
	}

	shouldNotify := job.UpdateProgress(bytesDone)
	if shouldNotify && cb != nil {
		cb(job.Token, protocol.EventTransferProgress, job.ToEvent())
	}
	return nil
}

// CompleteJob marks the job as completed.
func (m *Manager) CompleteJob(id string) error {
	m.mu.RLock()
	job, exists := m.jobs[id]
	cb := m.onStateChange
	m.mu.RUnlock()

	if !exists {
		return fmt.Errorf("job %s not found", id)
	}

	job.UpdateState(protocol.TransferCompleted, "")
	if cb != nil {
		cb(job.Token, protocol.EventTransferCompleted, job.ToEvent())
	}
	return nil
}

// FailJob marks the job as failed with an error description.
func (m *Manager) FailJob(id string, err error) error {
	m.mu.RLock()
	job, exists := m.jobs[id]
	cb := m.onStateChange
	m.mu.RUnlock()

	if !exists {
		return fmt.Errorf("job %s not found", id)
	}

	// If job is already cancelled, don't overwrite it with failed status
	if job.State == protocol.TransferCancelled {
		return nil
	}

	errStr := ""
	if err != nil {
		errStr = err.Error()
	}

	job.UpdateState(protocol.TransferFailed, errStr)
	if cb != nil {
		cb(job.Token, protocol.EventTransferFailed, job.ToEvent())
	}
	return nil
}

// CancelJob marks the job as cancelled.
func (m *Manager) CancelJob(id string) error {
	m.mu.RLock()
	job, exists := m.jobs[id]
	cb := m.onStateChange
	m.mu.RUnlock()

	if !exists {
		return fmt.Errorf("job %s not found", id)
	}

	job.UpdateState(protocol.TransferCancelled, "cancelled by user")
	if cb != nil {
		cb(job.Token, protocol.EventTransferCancelled, job.ToEvent())
	}
	return nil
}
