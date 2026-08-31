package e2ee

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"time"
)

// MockSession represents an in-memory session stored by MockDRMServer.
type MockSession struct {
	SessionID    string `json:"session_id"`
	LicenseKey   string `json:"license_key"`
	DeviceID     string `json:"device_id"`
	Mode         string `json:"mode"`
	MasterKeyB64 string `json:"master_key_b64"`
	KAuthHash    string `json:"k_auth_hash"`
	CloseToken   string `json:"close_token"`
	ClaimCount   int    `json:"claim_count"`
	MaxClaims    int    `json:"max_claims"`
	ExpiresAt    int64  `json:"expires_at"`
}

// MockDRMServer simulates the Cloudflare D1 DRM API server locally for offline testing.
type MockDRMServer struct {
	server        *httptest.Server
	mu            sync.RWMutex
	sessions      map[string]*MockSession // key: session_id
	deviceIndex   map[string]string       // key: device_id:mode -> session_id
	healthy       bool
	healthStatus  int
	licenseStatus string // "active", "expired", "revoked", "suspended"
	defaultKeyB64 string
	defaultAuth   string
}

// NewMockDRMServer creates and starts a new MockDRMServer.
func NewMockDRMServer() *MockDRMServer {
	// Generate default 32-byte master key
	key := make([]byte, 32)
	rand.Read(key)
	keyB64 := base64.StdEncoding.EncodeToString(key)

	authBytes := make([]byte, 32)
	rand.Read(authBytes)
	authHex := hex.EncodeToString(authBytes)

	m := &MockDRMServer{
		sessions:      make(map[string]*MockSession),
		deviceIndex:   make(map[string]string),
		healthy:       true,
		healthStatus:  http.StatusOK,
		licenseStatus: "active",
		defaultKeyB64: keyB64,
		defaultAuth:   authHex,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", m.handleHealth)
	mux.HandleFunc("/api/v1/e2ee/session/health", m.handleHealth)
	mux.HandleFunc("/api/v1/session/health", m.handleHealth)

	mux.HandleFunc("/api/v1/e2ee/session/create", m.handleCreate)
	mux.HandleFunc("/api/v1/session/create", m.handleCreate)

	mux.HandleFunc("/api/v1/e2ee/session/claim", m.handleClaim)
	mux.HandleFunc("/api/v1/session/claim", m.handleClaim)

	mux.HandleFunc("/api/v1/e2ee/session/close", m.handleClose)
	mux.HandleFunc("/api/v1/session/close", m.handleClose)

	m.server = httptest.NewServer(mux)
	return m
}

// URL returns the base URL of the mock DRM server.
func (m *MockDRMServer) URL() string {
	return m.server.URL
}

// Close terminates the mock HTTP server.
func (m *MockDRMServer) Close() {
	m.server.Close()
}

// SetHealthy configures the health response.
func (m *MockDRMServer) SetHealthy(healthy bool, statusCode int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.healthy = healthy
	m.healthStatus = statusCode
}

// SetLicenseStatus configures mock license status ("active", "expired", "revoked", "suspended").
func (m *MockDRMServer) SetLicenseStatus(status string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.licenseStatus = status
}

// DefaultMasterKey returns the generated default master key.
func (m *MockDRMServer) DefaultMasterKey() (string, string) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.defaultKeyB64, m.defaultAuth
}

func (m *MockDRMServer) handleHealth(w http.ResponseWriter, r *http.Request) {
	m.mu.RLock()
	healthy := m.healthy
	status := m.healthStatus
	m.mu.RUnlock()

	if !healthy || status != http.StatusOK {
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "unhealthy"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		json.NewEncoder(w).Encode(map[string]any{"ok": true, "status": "healthy"})
	}
}

func (m *MockDRMServer) handleCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if m.licenseStatus != "active" {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]any{
			"ok":         false,
			"error_code": "LICENSE_INACTIVE",
			"error":      "License is not active",
		})
		return
	}

	var req struct {
		LicenseKey   string `json:"license_key"`
		DeviceID     string `json:"device_id"`
		Mode         string `json:"mode"`
		MasterKeyB64 string `json:"master_key_b64"`
		KAuthHash    string `json:"k_auth_hash"`
		MaxClaims    int    `json:"max_claims"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "error_code": "INVALID_PAYLOAD"})
		return
	}

	if req.Mode == "" {
		req.Mode = "share"
	}
	if req.MaxClaims <= 0 {
		req.MaxClaims = 2
	}
	if req.MasterKeyB64 == "" {
		req.MasterKeyB64 = m.defaultKeyB64
		req.KAuthHash = m.defaultAuth
	}

	sessionID := "sess-" + hex.EncodeToString(generateRandomBytes(12))
	closeToken := "close-" + hex.EncodeToString(generateRandomBytes(16))

	// Upsert session index
	devKey := req.DeviceID + ":" + req.Mode
	if oldSessID, exists := m.deviceIndex[devKey]; exists {
		delete(m.sessions, oldSessID)
	}
	m.deviceIndex[devKey] = sessionID

	sess := &MockSession{
		SessionID:    sessionID,
		LicenseKey:   req.LicenseKey,
		DeviceID:     req.DeviceID,
		Mode:         req.Mode,
		MasterKeyB64: req.MasterKeyB64,
		KAuthHash:    req.KAuthHash,
		CloseToken:   closeToken,
		MaxClaims:    req.MaxClaims,
		ExpiresAt:    time.Now().Add(10 * time.Minute).Unix(),
	}
	m.sessions[sessionID] = sess

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{
		"ok":          true,
		"session_id":  sessionID,
		"close_token": closeToken,
		"claim_url":   m.server.URL + "/api/v1/e2ee/session/claim?session_id=" + sessionID,
		"expires_at":  sess.ExpiresAt,
	})
}

func (m *MockDRMServer) handleClaim(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("session_id")
	if sessionID == "" && r.Method == http.MethodPost {
		var req struct {
			SessionID string `json:"session_id"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		sessionID = req.SessionID
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	sess, exists := m.sessions[sessionID]
	if !exists {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "error_code": "SESSION_NOT_FOUND"})
		return
	}

	if sess.ExpiresAt <= time.Now().Unix() {
		w.WriteHeader(http.StatusGone)
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "error_code": "SESSION_EXPIRED"})
		return
	}

	if sess.ClaimCount >= sess.MaxClaims {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]any{
			"ok":             false,
			"error_code":     "CLAIM_LIMIT_EXCEEDED",
			"limit_exceeded": true,
		})
		return
	}

	sess.ClaimCount++

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{
		"ok":             true,
		"session_id":     sess.SessionID,
		"mode":           sess.Mode,
		"master_key_b64": sess.MasterKeyB64,
		"k_auth_hash":    sess.KAuthHash,
		"claims_left":    sess.MaxClaims - sess.ClaimCount,
	})
}

func (m *MockDRMServer) handleClose(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		SessionID  string `json:"session_id"`
		CloseToken string `json:"close_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "error_code": "INVALID_PAYLOAD"})
		return
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	sess, exists := m.sessions[req.SessionID]
	if !exists || sess.CloseToken != req.CloseToken {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "error_code": "SESSION_NOT_FOUND"})
		return
	}

	devKey := sess.DeviceID + ":" + sess.Mode
	delete(m.deviceIndex, devKey)
	delete(m.sessions, req.SessionID)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{"ok": true, "closed": true})
}

func generateRandomBytes(n int) []byte {
	b := make([]byte, n)
	rand.Read(b)
	return b
}
