// Package chathttp contains experimental HTTP routes for chat v2.
package chathttp

import (
	"encoding/json"
	"net/http"
	"strings"
)

const Version = "v2"

// Config controls the experimental chat v2 handler.
type Config struct {
	BasePath string
}

// Handler is an isolated, unmounted chat v2 HTTP handler.
type Handler struct {
	basePath string
}

// NewHandler creates an experimental chat v2 handler.
func NewHandler(cfg Config) *Handler {
	basePath := strings.TrimRight(cfg.BasePath, "/")
	if basePath == "" {
		basePath = "/chat-v2"
	}
	return &Handler{basePath: basePath}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	token, suffix, ok := h.route(r.URL.Path)
	if !ok || token == "" {
		http.NotFound(w, r)
		return
	}

	switch suffix {
	case "", "/":
		h.writeSkeleton(w, r, token)
	case "/health":
		h.writeHealth(w, r, token)
	default:
		http.NotFound(w, r)
	}
}

func (h *Handler) route(path string) (string, string, bool) {
	if path != h.basePath && !strings.HasPrefix(path, h.basePath+"/") {
		return "", "", false
	}
	rest := strings.TrimPrefix(path, h.basePath)
	rest = strings.TrimPrefix(rest, "/")
	if rest == "" {
		return "", "", true
	}
	token, suffix, _ := strings.Cut(rest, "/")
	if suffix != "" {
		suffix = "/" + suffix
	}
	return token, suffix, true
}

func (h *Handler) writeSkeleton(w http.ResponseWriter, r *http.Request, token string) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotImplemented)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"version": Version,
		"token":   token,
		"status":  "not_implemented",
	})
}

func (h *Handler) writeHealth(w http.ResponseWriter, r *http.Request, token string) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"version": Version,
		"token":   token,
		"status":  "skeleton",
	})
}
