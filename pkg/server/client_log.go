package server

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
)

// ClientLogEntry represents a log telemetry payload sent from a browser client.
type ClientLogEntry struct {
	ClientID  string         `json:"client_id"`
	SessionID string         `json:"session_id"`
	Timestamp int64          `json:"timestamp"`
	Level     string         `json:"level"`    // INFO, WARN, ERROR
	Category  string         `json:"category"` // PAGE_LOAD, ACTION, E2EE, SAVE, GLOBAL_ERROR
	Message   string         `json:"message"`
	Details   map[string]any `json:"details,omitempty"`
	UserAgent string         `json:"user_agent,omitempty"`
}

// handleClientLog handles telemetry POST requests from browser clients.
func (s *Server) handleClientLog(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	bodyBytes, err := io.ReadAll(io.LimitReader(r.Body, 128*1024))
	if err != nil || len(bodyBytes) == 0 {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	var entries []ClientLogEntry
	if err := json.Unmarshal(bodyBytes, &entries); err != nil {
		var single ClientLogEntry
		if err2 := json.Unmarshal(bodyBytes, &single); err2 != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		entries = []ClientLogEntry{single}
	}

	for _, entry := range entries {
		var detailsStr string
		if len(entry.Details) > 0 {
			if dj, err := json.Marshal(entry.Details); err == nil {
				detailsStr = string(dj)
			}
		}
		ua := entry.UserAgent
		if ua == "" {
			ua = r.UserAgent()
		}
		if len(ua) > 60 {
			ua = ua[:60] + "..."
		}

		shortID := entry.ClientID
		if len(shortID) > 6 {
			shortID = shortID[len(shortID)-6:]
		}

		fmt.Printf("📱 [CLIENT-LOG] [%s] [%s] [%s] %s | details=%s (UA: %s)\n",
			entry.Category, entry.Level, shortID, entry.Message, detailsStr, ua)
		log.Printf("[CLIENT-LOG] [%s] [%s] [%s] %s | details=%s",
			entry.Category, entry.Level, shortID, entry.Message, detailsStr)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"ok":true}`))
}
