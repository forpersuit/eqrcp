package session

import (
	"sync"
	"time"

	"eqt/pkg/chat/v2/protocol"
)

// MessageStore in-memory message store with monotonic event sequence.
type MessageStore struct {
	mu      sync.RWMutex
	events  []protocol.EventEnvelope
	nextSeq int64
}

// NewMessageStore creates a new MessageStore.
func NewMessageStore() *MessageStore {
	return &MessageStore{
		events:  make([]protocol.EventEnvelope, 0),
		nextSeq: 1,
	}
}

// Add appends a new event envelope to the store, assigning a monotonic sequence number.
// It returns a copy of the event with its Seq and Time fields set.
func (s *MessageStore) Add(event protocol.EventEnvelope) protocol.EventEnvelope {
	s.mu.Lock()
	defer s.mu.Unlock()

	event.Seq = s.nextSeq
	s.nextSeq++
	if event.Time.IsZero() {
		event.Time = time.Now()
	}

	s.events = append(s.events, event)
	return event
}

// GetSince returns all events that have a sequence number strictly greater than afterSeq.
func (s *MessageStore) GetSince(afterSeq int64) []protocol.EventEnvelope {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var res []protocol.EventEnvelope
	for _, e := range s.events {
		if e.Seq > afterSeq {
			res = append(res, e)
		}
	}
	return res
}
