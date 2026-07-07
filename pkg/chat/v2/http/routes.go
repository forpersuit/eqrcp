// Package chathttp contains experimental HTTP routes for chat v2.
package chathttp

import (
	"encoding/json"
	"net/http"
	"strings"

	"eqt/pkg/chat/v2/diag"
	"eqt/pkg/chat/v2/protocol"
)

const Version = "v2"

// Config controls the experimental chat v2 handler.
type Config struct {
	BasePath string
	Logger   diag.Logger
}

// Handler is an isolated, unmounted chat v2 HTTP handler.
type Handler struct {
	basePath string
	logger   diag.Logger
}

// NewHandler creates an experimental chat v2 handler.
func NewHandler(cfg Config) *Handler {
	basePath := strings.TrimRight(cfg.BasePath, "/")
	if basePath == "" {
		basePath = "/chat-v2"
	}
	logger := cfg.Logger
	if logger == nil {
		logger = diag.NopLogger{}
	}
	return &Handler{
		basePath: basePath,
		logger:   logger,
	}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	token, suffix, ok := h.route(r.URL.Path)
	if !ok || token == "" {
		http.NotFound(w, r)
		return
	}
	fields := []diag.Field{
		diag.F("method", r.Method),
		diag.F("path", r.URL.Path),
		diag.F("token", token),
	}
	diag.Emit(r.Context(), h.logger, diag.LevelDebug, "request received", nil, fields...)

	switch suffix {
	case "", "/":
		h.writeSkeleton(w, r, token, fields...)
	case "/health":
		h.writeHealth(w, r, token, fields...)
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

func (h *Handler) writeSkeleton(w http.ResponseWriter, r *http.Request, token string, fields ...diag.Field) {
	if r.Method != http.MethodGet {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusMethodNotAllowed, "method not allowed"), fields...)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotImplemented)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"version": Version,
		"token":   token,
		"status":  "not_implemented",
	})
	diag.Emit(r.Context(), h.logger, diag.LevelInfo, "skeleton response sent", nil, fields...)
}

func (h *Handler) writeHealth(w http.ResponseWriter, r *http.Request, token string, fields ...diag.Field) {
	if r.Method != http.MethodGet {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusMethodNotAllowed, "method not allowed"), fields...)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"version": Version,
		"token":   token,
		"status":  "skeleton",
	})
	diag.Emit(r.Context(), h.logger, diag.LevelInfo, "health response sent", nil, fields...)
}
