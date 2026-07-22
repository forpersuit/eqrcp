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
//
// Same-browser / same-device policy: peer is the device identity. At most one
// live connection per peer is kept in a room — any prior connections with the
// same peer are removed and closed with CloseReasonReplaced so the old tab
// does not auto-reconnect and fight for the slot.
func (s *Session) Register(c *Client, afterSeq, joinSeq int64) {
	s.mu.Lock()
	var superseded []*Client
	for _, client := range s.clients {
		if client.Peer == c.Peer && client.ID != c.ID {
			superseded = append(superseded, client)
		}
	}
	for _, old := range superseded {
		delete(s.clients, old.ID)
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

	// Drop previous sockets for this peer outside the lock.
	for _, old := range superseded {
		old.CloseReplaced()
	}

	// Replay missed events safely ensuring we never leak history before joinSeq.
	// Cold-start clients (empty local UI) send afterSeq=joinSeq to rehydrate history;
	// warm reconnects keep a high afterSeq for incremental missed events only.
	// Large gaps are paged: only the newest History page is pushed; older pages
	// are fetched via load_history.
	startSeq := ResolveReplayStartSeq(afterSeq, joinSeq, s.MessageStore.CurrentSeq())
	s.sendHistoryPage(c, startSeq, 0, DefaultHistoryPageSize, "")

	// Broadcast presence update
	s.broadcastPresence()

	// Broadcast system message for client join / reconnect / rename
	var sysMsg string
	var oldClient *Client
	if len(superseded) > 0 {
		oldClient = superseded[len(superseded)-1]
	}
	if oldClient != nil {
		if oldClient.Label != c.Label {
			sysMsg = "{oldSender} 修改用户名为 {sender}"
		} else if oldClient.Avatar != c.Avatar {
			sysMsg = "{sender} 修改了头像"
		} else {
			sysMsg = "{sender} 已重新连接"
		}
	} else {
		if parentLabel != "" {
			sysMsg = fmt.Sprintf("{sender} 通过 %s 加入了会话", parentLabel)
		} else {
			sysMsg = "{sender} 已加入会话"
		}
	}

	if sysMsg != "" && !s.DisableSystemMessages {
		var oldLabel string
		if oldClient != nil {
			oldLabel = oldClient.Label
		}
		s.broadcastSystemMessage(sysMsg, c.Theme, c, oldLabel)
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
			s.broadcastSystemMessage("{sender} 已断开连接", c.Theme, c, "")
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
		visible := s.isEventVisibleTo(c, event)
		filterReason := ""
		if !visible {
			filterReason = "isEventVisibleTo restriction"
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
		visible := s.isEventVisibleTo(c, event)

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

// LoadHistory delivers one older page of message events for the client.
// Floor is joinSeq (no pre-join leak); ceiling is beforeSeq (exclusive).
func (s *Session) LoadHistory(c *Client, joinSeq, beforeSeq int64, limit int, commandID string) {
	if beforeSeq <= 0 {
		c.Send(protocol.EventEnvelope{
			Type:      protocol.EventHistoryPage,
			Time:      time.Now(),
			CommandID: commandID,
			History:   &protocol.HistoryPage{HasMore: false, Count: 0},
		})
		return
	}
	floor := joinSeq
	if floor < 0 {
		floor = 0
	}
	s.sendHistoryPage(c, floor, beforeSeq, limit, commandID)
}

// sendHistoryPage pushes up to limit newest message events in (afterSeq, beforeSeq)
// and always finishes with a history_page meta event (not stored in MessageStore).
func (s *Session) sendHistoryPage(c *Client, afterSeq, beforeSeq int64, limit int, commandID string) {
	limit = NormalizeHistoryLimit(limit)
	page, hasMore := s.MessageStore.SelectMessageHistoryPage(afterSeq, beforeSeq, limit)

	var oldestSeq, newestSeq int64
	sent := 0
	for _, e := range page {
		if !s.isEventVisibleTo(c, e) {
			continue
		}
		c.Send(e)
		sent++
		if oldestSeq == 0 || e.Seq < oldestSeq {
			oldestSeq = e.Seq
		}
		if e.Seq > newestSeq {
			newestSeq = e.Seq
		}
	}

	if sent == 0 {
		// No visible messages in this page. If the store page was non-empty but
		// filtered out, advance the cursor to the oldest candidate so the next
		// load_history request moves backward instead of looping forever.
		if len(page) > 0 {
			oldestSeq = page[0].Seq
			newestSeq = page[len(page)-1].Seq
		} else {
			hasMore = false
			oldestSeq = 0
			newestSeq = 0
		}
	}

	c.Send(protocol.EventEnvelope{
		Type:      protocol.EventHistoryPage,
		Time:      time.Now(),
		CommandID: commandID,
		History: &protocol.HistoryPage{
			HasMore:   hasMore,
			OldestSeq: oldestSeq,
			NewestSeq: newestSeq,
			Count:     sent,
		},
	})
}

// isEventVisibleTo checks if a generic event envelope is visible to a client.
func (s *Session) isEventVisibleTo(c *Client, event protocol.EventEnvelope) bool {
	if event.Transfer != nil {
		return s.isTransferEventVisibleTo(c, event)
	}

	if event.Message != nil && event.Message.Type == protocol.MessageFile && event.Message.Uploading {
		// Limit uploading file messages to sender, desktop, or empty targets
		return c.Peer == event.Message.SenderID || c.Peer == "desktop" || c.Peer == ""
	}

	return true
}

func (s *Session) broadcastSystemMessage(text string, theme string, cl *Client, oldSender string) {
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
	if cl != nil {
		msg.Sender = cl.Label
		msg.SenderID = cl.Peer
		msg.OldSender = oldSender
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
	var oldLabelVal string
	if oldLabel != label {
		sysMsg = "{oldSender} 修改用户名为 {sender}"
		oldLabelVal = oldLabel
	} else if oldAvatar != avatar {
		sysMsg = "{sender} 修改了头像"
	}

	if sysMsg != "" && !s.DisableSystemMessages {
		s.broadcastSystemMessage(sysMsg, c.Theme, c, oldLabelVal)
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
		sysMsg := "已强制设备 {sender} 退出会话"
		if !s.DisableSystemMessages {
			s.broadcastSystemMessage(sysMsg, c.Theme, c, "")
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
