package chathttp

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"eqt/pkg/chat/v2/diag"
	"eqt/pkg/chat/v2/protocol"
)

// handleDownload processes native HTTP file download requests, tracking server-side write progress.
func (h *Handler) handleDownload(w http.ResponseWriter, r *http.Request, token string, fileID string, fields ...diag.Field) {
	if r.Method != http.MethodGet {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusMethodNotAllowed, "method not allowed"), fields...)
		return
	}

	query := r.URL.Query()
	clientID := query.Get("clientId")
	messageID := query.Get("messageId")
	filename := query.Get("filename")
	if filename == "" {
		filename = "download-" + fileID + ".bin"
	}

	mockSizeStr := query.Get("mock_size")
	size := int64(1024 * 1024) // 1MB default
	if mockSizeStr != "" {
		if s, err := strconv.ParseInt(mockSizeStr, 10, 64); err == nil && s > 0 {
			size = s
		}
	}

	// Create and register the download Job
	jobID := "dl-" + fileID
	h.transfer.CreateJob(token, jobID, messageID, clientID, filename, size)

	w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.WriteHeader(http.StatusOK)

	// Start the job
	_ = h.transfer.StartJob(jobID)

	isPaid := query.Get("is_paid") == "true"
	h.scheduler.RegisterJob(jobID, isPaid)
	defer h.scheduler.UnregisterJob(jobID)

	startTime := time.Now()

	var bytesWritten int64
	// We check elapsed time or percentage inside Job.UpdateProgress to throttle WebSocket events.
	// Write progress is intercepted per write.
	pw := struct {
		http.ResponseWriter
		onWrite func(n int)
	}{
		ResponseWriter: w,
		onWrite: func(n int) {
			bytesWritten += int64(n)
			_ = h.transfer.UpdateProgress(jobID, bytesWritten)
			h.scheduler.Throttle(jobID, bytesWritten, startTime)
		},
	}

	// Helper wrapper for response writer writing
	writeFunc := func(p []byte) (int, error) {
		n, err := pw.ResponseWriter.Write(p)
		if n > 0 {
			pw.onWrite(n)
		}
		return n, err
	}

	// Simulate streaming out the file content in chunks
	buf := make([]byte, 32*1024) // 32KB chunks
	var totalWritten int64
	for totalWritten < size {
		select {
		case <-r.Context().Done():
			_ = h.transfer.FailJob(jobID, r.Context().Err())
			diag.Emit(r.Context(), h.logger, diag.LevelWarn, "download cancelled by client disconnect", r.Context().Err(), fields...)
			return
		default:
		}

		writeSize := int64(len(buf))
		if size-totalWritten < writeSize {
			writeSize = size - totalWritten
		}

		n, err := writeFunc(buf[:writeSize])
		if err != nil {
			_ = h.transfer.FailJob(jobID, err)
			diag.Emit(r.Context(), h.logger, diag.LevelWarn, "download write failed", err, fields...)
			return
		}

		totalWritten += int64(n)

		// Throttle loop speed slightly for very small mock sizes during tests to simulate network transmission
		if size < 500*1024 {
			time.Sleep(1 * time.Millisecond)
		}
	}

	_ = h.transfer.CompleteJob(jobID)
	diag.Emit(r.Context(), h.logger, diag.LevelInfo, "download completed successfully", nil, fields...)
}
