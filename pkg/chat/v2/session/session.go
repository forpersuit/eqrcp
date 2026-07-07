package session

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"sync"
	"time"

	"eqt/pkg/chat/v2/protocol"
)

// Session represents a single chat room / token session.
type Session struct {
	Token            string
	mu               sync.RWMutex
	clients          map[string]*Client
	MessageStore     *MessageStore
	clientThemes     map[string]string // maps client peer ID to allocated theme
	clientThemeJoins map[string]string // maps client peer ID to last join token
}

// NewSession creates a new Session.
func NewSession(token string) *Session {
	return &Session{
		Token:            token,
		clients:          make(map[string]*Client),
		MessageStore:     NewMessageStore(),
		clientThemes:     make(map[string]string),
		clientThemeJoins: make(map[string]string),
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

// AssignTheme determines and assigns the correct theme for a client based on its peer type and scan join token.
func (s *Session) AssignTheme(c *Client, info protocol.ClientInfo) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.clientThemes == nil {
		s.clientThemes = make(map[string]string)
	}
	if s.clientThemeJoins == nil {
		s.clientThemeJoins = make(map[string]string)
	}

	isDesktop := false
	if strings.EqualFold(strings.TrimSpace(info.Peer), "desktop") || strings.EqualFold(strings.TrimSpace(c.Peer), "desktop") {
		isDesktop = true
	}

	if isDesktop {
		s.clientThemes[c.Peer] = "theme-0"
		c.Theme = "theme-0"
		return
	}

	join := strings.TrimSpace(info.Join)
	if theme := s.clientThemes[c.Peer]; s.validChatTheme(theme) && (join == "" || s.clientThemeJoins[c.Peer] == join) {
		c.Theme = theme
		return
	}

	oldTheme := s.clientThemes[c.Peer]
	theme := s.randomChatThemeLocked(c.Peer)
	if theme == oldTheme && oldTheme != "" {
		for i := 0; i < 5; i++ {
			theme = s.randomChatThemeLocked(c.Peer)
			if theme != oldTheme {
				break
			}
		}
	}
	s.clientThemes[c.Peer] = theme
	if join != "" {
		s.clientThemeJoins[c.Peer] = join
	}
	c.Theme = theme
}

func (s *Session) validChatTheme(theme string) bool {
	if !strings.HasPrefix(theme, "theme-") {
		return false
	}
	idxStr := strings.TrimPrefix(theme, "theme-")
	_, err := strconv.ParseInt(idxStr, 10, 64)
	return err == nil
}

func (s *Session) randomChatThemeLocked(peer string) string {
	for tries := 0; tries < 8; tries++ {
		theme := s.randomChatThemeID()
		if !s.themeInUseByOtherClientLocked(peer, theme) {
			return theme
		}
	}
	return s.randomChatThemeID()
}

func (s *Session) randomChatThemeID() string {
	maxChatThemeSeed := int64(1<<31 - 1)
	seed, err := rand.Int(rand.Reader, big.NewInt(maxChatThemeSeed))
	if err != nil {
		return fmt.Sprintf("theme-%d", time.Now().UnixNano()%maxChatThemeSeed+1)
	}
	return fmt.Sprintf("theme-%d", seed.Int64()+1)
}

func (s *Session) themeInUseByOtherClientLocked(peer string, theme string) bool {
	for other, assigned := range s.clientThemes {
		if other != peer && assigned == theme {
			return true
		}
	}
	return false
}

