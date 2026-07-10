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

// Recall finds the message event with the given messageID. If senderID is not empty,
// it verifies that the senderID matches the message's SenderID.
// If valid, it marks the message as recalled and returns it.
func (s *MessageStore) Recall(messageID string, senderID string) *protocol.Message {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i, e := range s.events {
		if e.Message != nil && e.Message.ID == messageID {
			if senderID != "" && e.Message.SenderID != senderID {
				return nil
			}
			e.Message.Recalled = true
			s.events[i] = e
			return e.Message
		}
	}
	return nil
}

// CurrentSeq returns the sequence number of the most recently added event.
func (s *MessageStore) CurrentSeq() int64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.nextSeq - 1
}

// MarkDownloaded finds the message event with the given messageID, marks it as downloaded, and returns it.
func (s *MessageStore) MarkDownloaded(messageID string) *protocol.Message {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i, e := range s.events {
		if e.Message != nil && e.Message.ID == messageID {
			if !e.Message.Downloaded {
				e.Message.Downloaded = true
				s.events[i] = e
				return e.Message
			}
			return e.Message
		}
	}
	return nil
}

// MarkUploadComplete finds the message event with the given messageID, marks Uploading as false, and returns it.
func (s *MessageStore) MarkUploadComplete(messageID string) *protocol.Message {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i, e := range s.events {
		if e.Message != nil && e.Message.ID == messageID {
			if e.Message.Uploading {
				e.Message.Uploading = false
				s.events[i] = e
				return e.Message
			}
			return e.Message
		}
	}
	return nil
}

// Find retrieves the message with the given messageID from the store.
func (s *MessageStore) Find(messageID string) (*protocol.Message, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, e := range s.events {
		if e.Message != nil && e.Message.ID == messageID {
			return e.Message, true
		}
	}
	return nil, false
}
