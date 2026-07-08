package chathttp

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"time"

	"eqt/pkg/chat/v2/bandwidth"
	"eqt/pkg/chat/v2/diag"
	"eqt/pkg/chat/v2/protocol"
	"eqt/pkg/chat/v2/transfer"
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

	// Look up physical path if registered
	sess := h.sessions.GetOrCreate(token)
	filePath := sess.GetAttachment(fileID)
	var fileReader io.ReadCloser
	if filePath != "" {
		info, err := os.Stat(filePath)
		if err == nil && !info.IsDir() {
			size = info.Size()
			f, err := os.Open(filePath)
			if err == nil {
				fileReader = f
			}
		}
	}
	if fileReader != nil {
		defer fileReader.Close()
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

	isPaid := false
	if h.isPaidOrUnrestricted != nil {
		isPaid = h.isPaidOrUnrestricted()
	}
	h.scheduler.RegisterJob(jobID, isPaid)
	defer h.scheduler.UnregisterJob(jobID)

	startTime := time.Now()

	pw := &progressWriter{
		writer:    w,
		transfer:  h.transfer,
		scheduler: h.scheduler,
		jobID:     jobID,
		startTime: startTime,
	}

	if fileReader != nil {
		// Use standard io.Copy for robust, uncorrupted, and complete file streaming
		if _, err := io.Copy(pw, fileReader); err != nil {
			_ = h.transfer.FailJob(jobID, err)
			diag.Emit(r.Context(), h.logger, diag.LevelWarn, "download stream failed", err, fields...)
			return
		}
		_ = h.transfer.CompleteJob(jobID)
		diag.Emit(r.Context(), h.logger, diag.LevelInfo, "download completed successfully", nil, fields...)
	} else if mockSizeStr != "" {
		// Mock data fallback path (mainly for concurrency test suites)
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
			chunk := buf[:writeSize]

			n, err := pw.Write(chunk)
			if err != nil {
				_ = h.transfer.FailJob(jobID, err)
				diag.Emit(r.Context(), h.logger, diag.LevelWarn, "download mock write failed", err, fields...)
				return
			}
			totalWritten += int64(n)

			if size < 500*1024 {
				time.Sleep(1 * time.Millisecond)
			}
		}
		_ = h.transfer.CompleteJob(jobID)
		diag.Emit(r.Context(), h.logger, diag.LevelInfo, "download completed successfully (mock path)", nil, fields...)
	} else {
		// P2P / Duplex Streaming Proxy mode:
		// Wait for the web client (sender) to initiate POST upload stream on /upload/stream?messageId=xxx
		h.mu.Lock()
		rdv := &rendezvous{
			readerChan: make(chan io.ReadCloser, 1),
			errChan:    make(chan error, 1),
		}
		h.rendezvousMap[fileID] = rdv
		h.mu.Unlock()
		defer func() {
			h.mu.Lock()
			delete(h.rendezvousMap, fileID)
			h.mu.Unlock()
		}()

		// Broadcast socket event to ask the web client (sender) to start streaming
		sess.Broadcast(protocol.EventEnvelope{
			Type: protocol.EventRequestFileData,
			Message: &protocol.Message{
				ID: fileID,
			},
			Time: time.Now(),
		})

		diag.Emit(r.Context(), h.logger, diag.LevelInfo, "Waiting for web client stream rendezvous", nil, append(fields, diag.F("messageID", fileID))...)

		// Block and wait for connection from the sender
		select {
		case senderStream := <-rdv.readerChan:
			defer senderStream.Close()
			diag.Emit(r.Context(), h.logger, diag.LevelInfo, "Stream rendezvous established", nil, append(fields, diag.F("messageID", fileID))...)

			if _, err := io.Copy(pw, senderStream); err != nil {
				_ = h.transfer.FailJob(jobID, err)
				rdv.errChan <- err
				diag.Emit(r.Context(), h.logger, diag.LevelWarn, "streaming rendezvous copy failed", err, fields...)
				return
			}
			rdv.errChan <- nil
			_ = h.transfer.CompleteJob(jobID)
			diag.Emit(r.Context(), h.logger, diag.LevelInfo, "download completed successfully via streaming rendezvous", nil, fields...)

		case <-r.Context().Done():
			diag.Emit(r.Context(), h.logger, diag.LevelWarn, "Download context canceled", nil, append(fields, diag.F("messageID", fileID))...)
			return
		case <-time.After(35 * time.Second):
			// Timed out waiting
			_ = h.transfer.FailJob(jobID, fmt.Errorf("timeout waiting for sender stream"))
			diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorInternal, http.StatusRequestTimeout, "timed out waiting for sender file stream"), fields...)
			return
		}
	}
}

// handleUploadStream receives the direct file stream from the sender and passes it to the waiting download response.
func (h *Handler) handleUploadStream(w http.ResponseWriter, r *http.Request, token string, fields ...diag.Field) {
	if r.Method != http.MethodPost {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusMethodNotAllowed, "method not allowed"), fields...)
		return
	}

	messageID := r.URL.Query().Get("messageId")
	if messageID == "" {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusBadRequest, "messageId is required"), fields...)
		return
	}

	h.mu.Lock()
	rdv, exists := h.rendezvousMap[messageID]
	h.mu.Unlock()
	if !exists {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusNotFound, "stream rendezvous not found (receiver might have canceled or timed out)"), fields...)
		return
	}

	// Extract the upload file stream
	var fileStream io.ReadCloser
	err := r.ParseMultipartForm(32 * 1024 * 1024)
	if err == nil {
		file, _, err := r.FormFile("file")
		if err == nil {
			fileStream = file
		}
	}
	if fileStream == nil {
		fileStream = r.Body
	}
	defer fileStream.Close()

	// Send file reader to the waiting GET download thread
	rdv.readerChan <- fileStream

	// Wait until the receiver finishes reading the stream, or cancels
	select {
	case copyErr := <-rdv.errChan:
		if copyErr != nil {
			diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorInternal, http.StatusInternalServerError, copyErr.Error()), fields...)
		} else {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"success"}`))
		}
	case <-r.Context().Done():
		diag.Emit(r.Context(), h.logger, diag.LevelWarn, "Stream upload sender context canceled", nil, append(fields, diag.F("messageID", messageID))...)
	}
}

type progressWriter struct {
	writer    http.ResponseWriter
	transfer  *transfer.Manager
	scheduler *bandwidth.Scheduler
	jobID     string
	startTime time.Time
	written   int64
}

func (pw *progressWriter) Write(p []byte) (int, error) {
	n, err := pw.writer.Write(p)
	if n > 0 {
		pw.written += int64(n)
		_ = pw.transfer.UpdateProgress(pw.jobID, pw.written)
		pw.scheduler.Throttle(pw.jobID, pw.written, pw.startTime)
	}
	return n, err
}
