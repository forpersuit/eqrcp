package server

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ClientLogEntry represents a telemetry log event dispatched from mobile browser client probes.
type ClientLogEntry struct {
	ClientID  string         `json:"client_id"`
	Timestamp int64          `json:"timestamp"`
	Level     string         `json:"level"`
	Category  string         `json:"category"`
	Message   string         `json:"message"`
	Details   map[string]any `json:"details,omitempty"`
}

var (
	validLevels = map[string]string{
		"INFO":  "INFO",
		"WARN":  "WARN",
		"ERROR": "ERROR",
		"DEBUG": "DEBUG",
	}

	validCategories = map[string]string{
		"PAGE_LOAD":       "PAGE_LOAD",
		"DOWNLOAD_CLICK":  "DOWNLOAD_CLICK",
		"CHUNK_RETRY":     "CHUNK_RETRY",
		"CHUNK_FAIL":      "CHUNK_FAIL",
		"UPLOAD_START":    "UPLOAD_START",
		"UPLOAD_PROGRESS": "UPLOAD_PROGRESS",
		"UPLOAD_COMPLETE": "UPLOAD_COMPLETE",
		"UPLOAD_FAIL":     "UPLOAD_FAIL",
		"NETWORK_OFFLINE": "NETWORK_OFFLINE",
		"NETWORK_ONLINE":  "NETWORK_ONLINE",
		"SHARE_API":       "SHARE_API",
		"EXCEPTION":       "EXCEPTION",
		"CHAT_CONNECT":    "CHAT_CONNECT",
		"CHAT_DISCONNECT": "CHAT_DISCONNECT",
		"ACTION":          "ACTION",
		"TRANSFER":        "TRANSFER",
		"CLIENT_EVENT":    "CLIENT_EVENT",
	}
)

func sanitizeLevel(lvl string) string {
	upper := strings.ToUpper(strings.TrimSpace(lvl))
	if mapped, ok := validLevels[upper]; ok {
		return mapped
	}
	return "INFO"
}

func sanitizeCategory(cat string) string {
	upper := strings.ToUpper(strings.TrimSpace(cat))
	if mapped, ok := validCategories[upper]; ok {
		return mapped
	}
	return "CLIENT_EVENT"
}

func sanitizeClientID(id string) string {
	clean := sanitizeString(id, 16)
	if clean == "" {
		return "unknown"
	}
	return clean
}

// sanitizeString strips \r, \n and non-printable control characters, truncating to maxLen.
func sanitizeString(s string, maxLen int) string {
	if maxLen <= 0 {
		maxLen = 256
	}
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if r == '\r' || r == '\n' || (r < 32 && r != ' ') {
			b.WriteRune(' ')
		} else {
			b.WriteRune(r)
		}
	}
	res := strings.TrimSpace(b.String())
	if len(res) > maxLen {
		return res[:maxLen]
	}
	return res
}

// formatDetails formats arbitrary key-value details into a sanitized, sorted single-line string.
func formatDetails(details map[string]any, maxLen int) string {
	if len(details) == 0 {
		return "none"
	}
	if maxLen <= 0 {
		maxLen = 1024
	}

	keys := make([]string, 0, len(details))
	for k := range details {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var parts []string
	for _, k := range keys {
		cleanK := sanitizeString(k, 32)
		valStr := fmt.Sprintf("%v", details[k])
		cleanV := sanitizeString(valStr, 128)
		parts = append(parts, fmt.Sprintf("%s=%s", cleanK, cleanV))
	}
	joined := strings.Join(parts, ", ")
	if len(joined) > maxLen {
		return joined[:maxLen]
	}
	return joined
}

// ExtractClientIP parses the remote IP without port.
func ExtractClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// MaskTokenInPath masks sensitive URL tokens in /send/, /receive/, and /chat/ paths.
// e.g. "/send/a1b2c3d4e5f6g7h8i9j0" -> "/send/a1b2c3...8i9j0"
func MaskTokenInPath(path string) string {
	for _, prefix := range []string{"/send/", "/receive/", "/chat/"} {
		if strings.HasPrefix(path, prefix) {
			remainder := strings.TrimPrefix(path, prefix)
			parts := strings.SplitN(remainder, "/", 2)
			token := parts[0]
			if len(token) > 12 {
				maskedToken := token[:6] + "..." + token[len(token)-6:]
				if len(parts) > 1 {
					return prefix + maskedToken + "/" + parts[1]
				}
				return prefix + maskedToken
			}
		}
	}
	return path
}

type ipBucket struct {
	tokens   float64
	lastTime time.Time
}

// TelemetryRateLimiter implements token bucket rate limiting per remote IP.
type TelemetryRateLimiter struct {
	mu       sync.Mutex
	buckets  map[string]*ipBucket
	capacity float64
	rate     float64 // tokens per second
}

// NewTelemetryRateLimiter creates a rate limiter with default 10 tokens capacity and 10 tokens/s fill rate.
func NewTelemetryRateLimiter(capacity, rate float64) *TelemetryRateLimiter {
	return &TelemetryRateLimiter{
		buckets:  make(map[string]*ipBucket),
		capacity: capacity,
		rate:     rate,
	}
}

// Allow checks if the given IP has tokens available.
func (l *TelemetryRateLimiter) Allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	b, exists := l.buckets[ip]
	if !exists {
		l.buckets[ip] = &ipBucket{
			tokens:   l.capacity - 1,
			lastTime: now,
		}
		// Periodically clean up stale entries if map gets large
		if len(l.buckets) > 1024 {
			for k, v := range l.buckets {
				if now.Sub(v.lastTime) > 10*time.Minute {
					delete(l.buckets, k)
				}
			}
		}
		return true
	}

	elapsed := now.Sub(b.lastTime).Seconds()
	b.lastTime = now
	b.tokens += elapsed * l.rate
	if b.tokens > l.capacity {
		b.tokens = l.capacity
	}

	if b.tokens >= 1.0 {
		b.tokens -= 1.0
		return true
	}
	return false
}

// HandleClientLog processes client-side telemetry POST requests with strict sanitization.
func (s *Server) HandleClientLog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 1. Restrict body size to 32KB
	r.Body = http.MaxBytesReader(w, r.Body, 32*1024)
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "request entity too large", http.StatusRequestEntityTooLarge)
		return
	}

	// 2. Token-bucket rate limiting based on client IP
	ip := ExtractClientIP(r)
	if s.telemetryLimiter != nil && !s.telemetryLimiter.Allow(ip) {
		dropped := atomic.AddUint64(&s.droppedClientLogCount, 1)
		if dropped%10 == 1 {
			log.Printf("[WARN] [SRV] Dropped client-log telemetry requests due to IP rate limiting (count=%d, IP=%s)", dropped, ip)
		}
		http.Error(w, "too many requests", http.StatusTooManyRequests)
		return
	}

	// 3. Deserialize JSON
	var entry ClientLogEntry
	if err := json.Unmarshal(bodyBytes, &entry); err != nil {
		http.Error(w, "invalid json payload", http.StatusBadRequest)
		return
	}

	// 4. Sanitize and validate fields
	level := sanitizeLevel(entry.Level)
	category := sanitizeCategory(entry.Category)
	clientID := sanitizeClientID(entry.ClientID)
	msg := sanitizeString(entry.Message, 256)
	detailsStr := formatDetails(entry.Details, 1024)

	// 5. Output structured log line (Server-arrival timestamp is sole authority)
	log.Printf("[%s] [CLIENT] [%s] [%s] %s | %s (IP: %s)", level, clientID, category, msg, detailsStr, ip)

	w.WriteHeader(http.StatusNoContent)
}

// wrapAccessLog wraps an http.Handler to log incoming requests with token masking.
func (s *Server) wrapAccessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		// Log access for key operational endpoints
		if strings.HasPrefix(path, "/send/") || strings.HasPrefix(path, "/receive/") || strings.HasPrefix(path, "/chat") {
			// Skip logging high-frequency polling /status endpoints to avoid log flooding
			if !strings.HasSuffix(path, "/status") && path != "/status" {
				maskedPath := MaskTokenInPath(path)
				ip := ExtractClientIP(r)
				log.Printf("[INFO] [SRV] HTTP %s %s from %s", r.Method, maskedPath, ip)
			}
		}
		next.ServeHTTP(w, r)
	})
}
