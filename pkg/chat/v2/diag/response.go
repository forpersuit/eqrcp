package diag

import (
	"encoding/json"
	"net/http"
)

// WriteError writes a public JSON error response and logs the diagnostic error.
func WriteError(w http.ResponseWriter, r *http.Request, logger Logger, err error, fields ...Field) {
	diagErr := NormalizeError(err)
	status := diagErr.Status
	if status == 0 {
		status = http.StatusInternalServerError
	}
	Emit(r.Context(), logger, LevelWarn, "request failed", diagErr, fields...)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": diagErr.Payload(),
	})
}
