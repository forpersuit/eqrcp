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
	attachments      map[string]string // maps fileID/messageID to absolute filePath
}

// NewSession creates a new Session.
func NewSession(token string) *Session {
	return &Session{
		Token:            token,
		clients:          make(map[string]*Client),
		MessageStore:     NewMessageStore(),
		clientThemes:     make(map[string]string),
		clientThemeJoins: make(map[string]string),
		attachments:      make(map[string]string),
	}
}

// Register adds a client to the session, replays missed events, and broadcasts presence.
func (s *Session) Register(c *Client, afterSeq, joinSeq int64) {
	s.mu.Lock()
	s.clients[c.ID] = c
	s.mu.Unlock()

	// Replay missed events safely ensuring we never leak history before joinSeq
	var startSeq int64 = 0
	var shouldReplay bool = false

	if afterSeq > 0 && joinSeq > 0 {
		if afterSeq >= joinSeq {
			startSeq = afterSeq
		} else {
			startSeq = joinSeq
		}
		shouldReplay = true
	} else if afterSeq > 0 {
		startSeq = afterSeq
		shouldReplay = true
	} else if joinSeq > 0 {
		startSeq = joinSeq
		shouldReplay = true
	} else {
		// Both are 0, meaning a brand new client joined the session.
		// We replay all existing historical messages to sync state.
		startSeq = 0
		shouldReplay = true
	}

	if shouldReplay {
		events := s.MessageStore.GetSince(startSeq)
		for _, e := range events {
			if e.Message != nil {
				if e.Message.Type == protocol.MessageFile && !e.Message.Downloaded {
					if c.Peer != e.Message.SenderID && c.Peer != "desktop" && c.Peer != "" {
						continue
					}
				}
				c.Send(e)
			}
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

		s.mu.RLock()
		clientCount := len(s.clients)
		s.mu.RUnlock()
		if clientCount == 0 {
			go func() {
				_ = CleanupUploads()
			}()
		}
	}
}

// Broadcast sends an event to all connected clients in the session.
// The event is stored in the message store and assigned a monotonic sequence number first.
func (s *Session) Broadcast(event protocol.EventEnvelope) {
	event = s.MessageStore.Add(event)

	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, c := range s.clients {
		if (event.Type == protocol.EventMessageAdded || event.Type == protocol.EventMessageUpdated) && event.Message != nil && event.Message.Type == protocol.MessageFile && !event.Message.Downloaded {
			if c.Peer == event.Message.SenderID || c.Peer == "desktop" || c.Peer == "" {
				fmt.Printf("[WebSocket Broadcast Filtered] Sending EventType=%s Seq=%d MsgID=%s to ClientID=%s Peer=%s (MATCHED)\n", event.Type, event.Seq, event.Message.ID, c.ID, c.Peer)
				c.Send(event)
			} else {
				fmt.Printf("[WebSocket Broadcast Filtered] Skipping EventType=%s Seq=%d MsgID=%s for ClientID=%s Peer=%s (SKIPPED)\n", event.Type, event.Seq, event.Message.ID, c.ID, c.Peer)
			}
		} else {
			msgID := ""
			if event.Message != nil {
				msgID = event.Message.ID
			}
			fmt.Printf("[WebSocket Broadcast All] Sending EventType=%s Seq=%d MsgID=%s to ClientID=%s Peer=%s\n", event.Type, event.Seq, msgID, c.ID, c.Peer)
			c.Send(event)
		}
	}
}

// BroadcastRaw broadcasts an event without adding it to the MessageStore history.
func (s *Session) BroadcastRaw(event protocol.EventEnvelope) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, c := range s.clients {
		msgID := ""
		if event.Message != nil {
			msgID = event.Message.ID
		}
		fmt.Printf("[WebSocket BroadcastRaw All] Sending EventType=%s MsgID=%s to ClientID=%s Peer=%s\n", event.Type, msgID, c.ID, c.Peer)
		c.Send(event)
	}
}

// SendText broadcasts a new text message.
func (s *Session) SendText(sender *Client, text string, commandID string) {
	msg := &protocol.Message{
		ID:        generateID(),
		SenderID:  sender.Peer,
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

// AddAttachment maps a message/file ID to a local absolute filePath.
func (s *Session) AddAttachment(id string, path string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.attachments == nil {
		s.attachments = make(map[string]string)
	}
	s.attachments[id] = path
}

// GetAttachment retrieves the local absolute filePath mapped to an ID.
func (s *Session) GetAttachment(id string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.attachments == nil {
		return ""
	}
	return s.attachments[id]
}
