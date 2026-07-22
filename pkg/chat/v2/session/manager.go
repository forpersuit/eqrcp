package session

import (
	"sync"

	"eqt/pkg/chat/v2/diag"
)

// Manager manages chat room sessions by token.
type Manager struct {
	mu                    sync.RWMutex
	sessions              map[string]*Session
	Logger                diag.Logger // Structural logger instance
	DisableSystemMessages bool
}

// NewManager creates a new session Manager.
func NewManager() *Manager {
	return &Manager{
		sessions: make(map[string]*Session),
	}
}

// GetOrCreate returns the Session for the given token, creating it if it doesn't exist.
func (m *Manager) GetOrCreate(token string) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()

	s, exists := m.sessions[token]
	if !exists {
		s = NewSession(token)
		s.Logger = m.Logger
		s.DisableSystemMessages = m.DisableSystemMessages
		m.sessions[token] = s
	}
	return s
}

// Delete removes the session for the given token.
func (m *Manager) Delete(token string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, token)
}

// HasRemoteClient reports whether any managed session has a non-desktop peer online.
func (m *Manager) HasRemoteClient() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, s := range m.sessions {
		if s != nil && s.HasRemoteClient() {
			return true
		}
	}
	return false
}

// ForEach calls fn for every active session (snapshot under lock).
func (m *Manager) ForEach(fn func(*Session)) {
	if fn == nil {
		return
	}
	m.mu.RLock()
	list := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		list = append(list, s)
	}
	m.mu.RUnlock()
	for _, s := range list {
		if s != nil {
			fn(s)
		}
	}
}

// GetAttachmentPathByID searches all sessions for the physical path of the given attachment ID.
func (m *Manager) GetAttachmentPathByID(id string) (string, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, sess := range m.sessions {
		if path := sess.GetAttachment(id); path != "" {
			return path, true
		}
	}
	return "", false
}

// GetAttachmentTokenAndPath searches all sessions for both token and physical path of the given attachment ID.
func (m *Manager) GetAttachmentTokenAndPath(id string) (string, string, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for token, sess := range m.sessions {
		if path := sess.GetAttachment(id); path != "" {
			return token, path, true
		}
	}
	return "", "", false
}
