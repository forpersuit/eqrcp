package session

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"eqt/pkg/chat/v2/diag"
	"eqt/pkg/chat/v2/protocol"
)

// Session represents a single chat room / token session.
type Session struct {
	Token                 string
	mu                    sync.RWMutex
	clients               map[string]*Client
	MessageStore          *MessageStore
	clientThemes          map[string]string // maps client peer ID to allocated theme
	clientThemeJoins      map[string]string // maps client peer ID to last join token
	attachments           map[string]string // maps fileID/messageID to absolute filePath
	Logger                diag.Logger       // Structural logger instance
	DisableSystemMessages bool
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
	var oldClient *Client
	for _, client := range s.clients {
		if client.Peer == c.Peer && client.ID != c.ID {
			oldClient = client
			break
		}
	}
	var parentLabel string
	if c.Join != "" {
		for _, client := range s.clients {
			if client.LocalJoin == c.Join && client.ID != c.ID && client.Peer != "desktop" {
				parentLabel = client.Label
				break
			}
		}
	}
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
		// According to the requirement, we do not sync messages sent before joining.
		// So we set startSeq to the current sequence number.
		startSeq = s.MessageStore.CurrentSeq()
		shouldReplay = true
	}

	if shouldReplay {
		events := s.MessageStore.GetSince(startSeq)
		for _, e := range events {
			if e.Message != nil {
				if e.Message.Type == protocol.MessageFile && !e.Message.Downloaded {
					if c.Peer != e.Message.SenderID && c.Peer != "desktop" && c.Peer != "" {
						diag.Emit(context.Background(), s.Logger, diag.LevelDebug, "[WebSocket Replay Filtered]", nil,
							diag.F("msgID", e.Message.ID), diag.F("clientID", c.ID), diag.F("peer", c.Peer),
							diag.F("senderID", e.Message.SenderID))
						continue
					}
				}
				c.Send(e)
			}
		}
	}

	// Broadcast presence update
	s.broadcastPresence()

	// Broadcast system message for client join / reconnect / rename
	var sysMsg string
	if oldClient != nil {
		if oldClient.Label != c.Label {
			sysMsg = fmt.Sprintf("%s 修改用户名为 %s", oldClient.Label, c.Label)
		} else if oldClient.Avatar != c.Avatar {
			sysMsg = fmt.Sprintf("%s 修改了头像", c.Label)
		} else {
			sysMsg = fmt.Sprintf("%s 已重新连接", c.Label)
		}
	} else {
		if parentLabel != "" {
			sysMsg = fmt.Sprintf("%s 通过 %s 加入了会话", c.Label, parentLabel)
		} else {
			sysMsg = fmt.Sprintf("%s 已加入会话", c.Label)
		}
	}

	if sysMsg != "" && !s.DisableSystemMessages {
		s.broadcastSystemMessage(sysMsg, c.Theme)
	}
}

// Unregister removes a client from the session and broadcasts presence.
func (s *Session) Unregister(c *Client) {
	s.mu.Lock()
	_, exists := s.clients[c.ID]
	if exists {
		delete(s.clients, c.ID)
	}
	// Check if there is still any other client connected with the same Peer
	hasOther := false
	for _, client := range s.clients {
		if client.Peer == c.Peer {
			hasOther = true
			break
		}
	}
	s.mu.Unlock()

	if exists {
		c.Close()
		s.broadcastPresence()

		if !hasOther && !s.DisableSystemMessages && !c.Kicked {
			s.broadcastSystemMessage(fmt.Sprintf("%s 已断开连接", c.Label), c.Theme)
		}

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
		visible := true
		filterReason := ""
		if (event.Type == protocol.EventMessageAdded || event.Type == protocol.EventMessageUpdated) && event.Message != nil && event.Message.Type == protocol.MessageFile && !event.Message.Downloaded {
			visible = c.Peer == event.Message.SenderID || c.Peer == "desktop" || c.Peer == ""
			if !visible {
				filterReason = fmt.Sprintf("undownloaded FileMessage restriction (SenderID=%s, ClientPeer=%s)", event.Message.SenderID, c.Peer)
			}
		}
		if visible && event.Transfer != nil {
			visible = s.isTransferEventVisibleTo(c, event)
			if !visible {
				filterReason = "isTransferEventVisibleTo restriction"
			}
		}

		msgID := ""
		if event.Message != nil {
			msgID = event.Message.ID
		}

		if visible {
			diag.Emit(context.Background(), s.Logger, diag.LevelInfo, "[WebSocket Broadcast All]", nil,
				diag.F("eventType", event.Type), diag.F("seq", event.Seq), diag.F("msgID", msgID),
				diag.F("clientID", c.ID), diag.F("peer", c.Peer))
			c.Send(event)
		} else {
			diag.Emit(context.Background(), s.Logger, diag.LevelDebug, "[WebSocket Broadcast Filtered]", nil,
				diag.F("eventType", event.Type), diag.F("seq", event.Seq), diag.F("msgID", msgID),
				diag.F("clientID", c.ID), diag.F("peer", c.Peer), diag.F("reason", filterReason))
		}
	}
}

// BroadcastRaw broadcasts an event without adding it to the MessageStore history.
func (s *Session) BroadcastRaw(event protocol.EventEnvelope) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, c := range s.clients {
		visible := true
		if event.Transfer != nil {
			visible = s.isTransferEventVisibleTo(c, event)
		}

		if visible {
			msgID := ""
			if event.Message != nil {
				msgID = event.Message.ID
			}
			fmt.Printf("[WebSocket BroadcastRaw All] Sending EventType=%s MsgID=%s to ClientID=%s Peer=%s\n", event.Type, msgID, c.ID, c.Peer)
			c.Send(event)
		} else {
			fmt.Printf("[WebSocket BroadcastRaw Filtered] Skipping EventType=%s to ClientID=%s Peer=%s\n", event.Type, c.ID, c.Peer)
		}
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
	clientList := make([]*Client, 0, len(s.clients))
	for _, c := range s.clients {
		clientList = append(clientList, c)
	}
	s.mu.RUnlock()

	// Sort by JoinTime to guarantee a stable chronological list of devices
	sort.Slice(clientList, func(i, j int) bool {
		return clientList[i].JoinTime.Before(clientList[j].JoinTime)
	})

	devices := make([]protocol.Device, 0, len(clientList))
	for _, c := range clientList {
		devices = append(devices, c.ToDevice())
	}

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

// GetClientTheme returns the theme assigned to a client peer.
func (s *Session) GetClientTheme(peer string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.clientThemes == nil {
		return ""
	}
	return s.clientThemes[peer]
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
	if !info.IsNewScan {
		if theme := s.clientThemes[c.Peer]; s.validChatTheme(theme) && (join == "" || s.clientThemeJoins[c.Peer] == join) {
			c.Theme = theme
			return
		}
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

// isTransferEventVisibleTo checks if a specific transfer status event is visible to a client.
func (s *Session) isTransferEventVisibleTo(c *Client, event protocol.EventEnvelope) bool {
	if event.Transfer != nil {
		msgID := event.Transfer.MessageID
		if msgID != "" {
			// Find the target file message from the store
			if msg, exists := s.MessageStore.Find(msgID); exists && msg != nil {
				// If fully downloaded, it's ready and visible to all participants
				if msg.Downloaded {
					return true
				}
				// Otherwise, limit progress updates to the uploader, downloader, desktop, or empty targets
				return c.Peer == msg.SenderID || c.Peer == event.Transfer.ClientID || c.Peer == "desktop" || c.Peer == ""
			}
		}
		// If not registered yet in message store, fallback to client/desktop bounds
		return c.Peer == event.Transfer.ClientID || c.Peer == "desktop" || c.Peer == ""
	}
	return true
}

func (s *Session) broadcastSystemMessage(text string, theme string) {
	var num int64 = 0
	if n, err := rand.Int(rand.Reader, big.NewInt(1000000)); err == nil {
		num = n.Int64()
	}
	msg := protocol.Message{
		ID:        fmt.Sprintf("sys-%d-%d", time.Now().UnixNano(), num),
		Type:      protocol.MessageSystem,
		Text:      text,
		Theme:     theme,
		CreatedAt: time.Now(),
	}
	s.Broadcast(protocol.EventEnvelope{
		Type:    protocol.EventMessageAdded,
		Message: &msg,
		Time:    time.Now(),
	})
}

// UpdateClient updates the client's label and avatar under lock, broadcasts presence, and broadcasts a system message.
func (s *Session) UpdateClient(c *Client, label string, avatar string) {
	s.mu.Lock()
	oldLabel := c.Label
	oldAvatar := c.Avatar
	c.Label = label
	c.Avatar = avatar
	s.mu.Unlock()

	// Broadcast presence update to sync lists across all clients
	s.broadcastPresence()

	// Broadcast system message for rename/avatar change
	var sysMsg string
	if oldLabel != label {
		sysMsg = fmt.Sprintf("%s 修改用户名为 %s", oldLabel, label)
	} else if oldAvatar != avatar {
		sysMsg = fmt.Sprintf("%s 修改了头像", label)
	}

	if sysMsg != "" && !s.DisableSystemMessages {
		s.broadcastSystemMessage(sysMsg, c.Theme)
	}
}

// KickClient closes the connection of the client with the given ID.
func (s *Session) KickClient(clientID string) {
	s.mu.Lock()
	c, exists := s.clients[clientID]
	if exists {
		c.Kicked = true
	}
	s.mu.Unlock()

	if exists {
		sysMsg := fmt.Sprintf("已强制设备 %s 退出会话", c.Label)
		if !s.DisableSystemMessages {
			s.broadcastSystemMessage(sysMsg, c.Theme)
		}
		c.Close()
	}
}

// GetClient retrieves the client with the given ID.
func (s *Session) GetClient(clientID string) *Client {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.clients[clientID]
}

