package session

import (
	"sync"
	"time"

	"eqt/pkg/chat/v2/protocol"
)

// Session represents a single chat room / token session.
type Session struct {
	Token        string
	mu           sync.RWMutex
	clients      map[string]*Client
	MessageStore *MessageStore
}

// NewSession creates a new Session.
func NewSession(token string) *Session {
	return &Session{
		Token:        token,
		clients:      make(map[string]*Client),
		MessageStore: NewMessageStore(),
	}
}

// Register adds a client to the session, replays missed events, and broadcasts presence.
func (s *Session) Register(c *Client, afterSeq, joinSeq int64) {
	s.mu.Lock()
	s.clients[c.ID] = c
	s.mu.Unlock()

	// Replay missed events
	var startSeq int64 = 0
	if afterSeq > 0 {
		startSeq = afterSeq
	} else if joinSeq > 0 {
		startSeq = joinSeq
	}

	if startSeq > 0 {
		events := s.MessageStore.GetSince(startSeq)
		for _, e := range events {
			c.Send(e)
		}
	}

	// Broadcast presence update
	s.broadcastPresence()
}

// Unregister removes a client from the session and broadcasts presence.
func (s *Session) Unregister(c *Client) {
	s.mu.Lock()
	_, exists := s.clients[c.ID]
	if exists {
		delete(s.clients, c.ID)
	}
	s.mu.Unlock()

	if exists {
		c.Close()
		s.broadcastPresence()
	}
}

// Broadcast sends an event to all connected clients in the session.
// The event is stored in the message store and assigned a monotonic sequence number first.
func (s *Session) Broadcast(event protocol.EventEnvelope) {
	event = s.MessageStore.Add(event)

	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, c := range s.clients {
		c.Send(event)
	}
}

// SendText broadcasts a new text message.
func (s *Session) SendText(sender *Client, text string, commandID string) {
	msg := &protocol.Message{
		ID:        generateID(),
		SenderID:  sender.ID,
		Sender:    sender.Label,
		Avatar:    sender.Avatar,
		Theme:     sender.Theme,
		Type:      protocol.MessageText,
		Text:      text,
		CreatedAt: time.Now(),
	}

	event := protocol.EventEnvelope{
		Type:      protocol.EventMessageAdded,
		CommandID: commandID,
		Message:   msg,
		Time:      time.Now(),
	}

	s.Broadcast(event)
}

// RecallMessage broadcasts a message recall event and marks the message as recalled in the message store.
func (s *Session) RecallMessage(senderID string, messageID string, commandID string) {
	// Find and mark the message in MessageStore
	msg := s.MessageStore.Recall(messageID, senderID)
	if msg == nil {
		return
	}

	event := protocol.EventEnvelope{
		Type:      protocol.EventMessageRecalled,
		CommandID: commandID,
		Message:   msg,
		Time:      time.Now(),
	}

	s.Broadcast(event)
}



func (s *Session) broadcastPresence() {
	s.mu.RLock()
	devices := make([]protocol.Device, 0, len(s.clients))
	for _, c := range s.clients {
		devices = append(devices, c.ToDevice())
	}
	s.mu.RUnlock()

	event := protocol.EventEnvelope{
		Type: protocol.EventPresenceChanged,
		Presence: &protocol.PresenceEvent{
			Devices: devices,
		},
		Time: time.Now(),
	}

	s.Broadcast(event)
}

// ClientsCount returns the current number of registered clients.
func (s *Session) ClientsCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.clients)
}

// SendSystemMessage broadcasts a system notification text message.
func (s *Session) SendSystemMessage(text string) {
	msg := &protocol.Message{
		ID:        generateID(),
		SenderID:  "system",
		Sender:    "system",
		Type:      protocol.MessageSystem,
		Text:      text,
		CreatedAt: time.Now(),
	}

	event := protocol.EventEnvelope{
		Type:    protocol.EventMessageAdded,
		Message: msg,
		Time:    time.Now(),
	}

	s.Broadcast(event)
}
