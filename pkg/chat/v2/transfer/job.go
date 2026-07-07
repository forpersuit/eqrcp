package transfer

import (
	"sync"
	"time"

	"eqt/pkg/chat/v2/protocol"
)

// Job represents a single data-plane transfer job (upload or download).
type Job struct {
	mu           sync.RWMutex
	Token        string
	ID           string
	MessageID    string
	ClientID     string
	FileName     string
	BytesDone    int64
	BytesTotal   int64
	State        protocol.TransferState
	Error        string
	UpdatedAt    time.Time
	LastPct      int
	LastSentTime time.Time
}

// NewJob creates a new transfer Job.
func NewJob(token, id, messageID, clientID, fileName string, bytesTotal int64) *Job {
	return &Job{
		Token:      token,
		ID:         id,
		MessageID:  messageID,
		ClientID:   clientID,
		FileName:   fileName,
		BytesTotal: bytesTotal,
		State:      protocol.TransferQueued,
		UpdatedAt:  time.Now(),
	}
}

// ToEvent exports the concurrent Job state to a protocol.TransferEvent envelope.
func (j *Job) ToEvent() protocol.TransferEvent {
	j.mu.RLock()
	defer j.mu.RUnlock()

	pct := 0
	if j.BytesTotal > 0 {
		pct = int(float64(j.BytesDone) / float64(j.BytesTotal) * 100)
		if pct > 100 {
			pct = 100
		}
	}

	return protocol.TransferEvent{
		ID:         j.ID,
		MessageID:  j.MessageID,
		ClientID:   j.ClientID,
		FileName:   j.FileName,
		BytesDone:  j.BytesDone,
		BytesTotal: j.BytesTotal,
		Percent:    pct,
		State:      j.State,
		Error:      j.Error,
		UpdatedAt:  j.UpdatedAt,
	}
}

// UpdateState safely changes the transfer job lifecycle state.
func (j *Job) UpdateState(state protocol.TransferState, errStr string) {
	j.mu.Lock()
	defer j.mu.Unlock()

	j.State = state
	j.Error = errStr
	j.UpdatedAt = time.Now()
}

// UpdateProgress safely updates processed bytes.
// Returns true if the change should trigger a WebSocket broadcast (throttled by percent change or 200ms duration).
func (j *Job) UpdateProgress(bytesDone int64) bool {
	j.mu.Lock()
	defer j.mu.Unlock()

	j.BytesDone = bytesDone
	j.UpdatedAt = time.Now()

	pct := 0
	if j.BytesTotal > 0 {
		pct = int(float64(j.BytesDone) / float64(j.BytesTotal) * 100)
		if pct > 100 {
			pct = 100
		}
	}

	now := time.Now()
	// Trigger update if percentage changed, or if 200ms has elapsed since the last sent update.
	if pct != j.LastPct || now.Sub(j.LastSentTime) >= 200*time.Millisecond {
		j.LastPct = pct
		j.LastSentTime = now
		return true
	}

	return false
}
