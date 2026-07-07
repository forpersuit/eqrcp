package session

import (
	"sync"
)

// Manager manages chat room sessions by token.
type Manager struct {
	mu       sync.RWMutex
	sessions map[string]*Session
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
