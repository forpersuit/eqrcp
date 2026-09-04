package chathttp

import (
	"archive/zip"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
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

	var msgMimeType string
	if msg, ok := sess.MessageStore.Find(fileID); ok {
		if fileReader == nil && mockSizeStr == "" && msg.Size > 0 {
			size = msg.Size
		}
		if query.Get("filename") == "" && msg.FileName != "" {
			filename = msg.FileName
		}
		msgMimeType = msg.MimeType
	}

	// Dynamic Content-Type resolution: prioritize extension mapping, fallback to stored MIME, then octet-stream
	contentType := ""
	if ext := filepath.Ext(filename); ext != "" {
		contentType = mime.TypeByExtension(ext)
	}
	if contentType == "" && msgMimeType != "" {
		contentType = msgMimeType
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	// Evaluate inline caching vs attachment download headers before creating any transfer jobs
	etag := fmt.Sprintf("\"%s-%d\"", fileID, size)
	isInline := query.Get("inline") == "1"

	// Strict SVG and scriptable document exclusion to eliminate stored-XSS execution vectors (F1')
	if isInline && !isSafeInlineResource(contentType, filename) {
		isInline = false
	}

	if isInline {
		w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=\"%s\"", filename))
		w.Header().Set("Cache-Control", "public, max-age=86400, immutable")
		w.Header().Set("ETag", etag)
		w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
		w.Header().Set("X-Content-Type-Options", "nosniff")

		// Check 304 before streaming to prevent unnecessary transfers (P2)
		if match := r.Header.Get("If-None-Match"); match != "" && (match == etag || match == "*") {
			w.WriteHeader(http.StatusNotModified)
			return
		}
	} else {
		// Strict iOS Safari WebKit attachment requirements (.agents/skills/eqt-lan-tls/SKILL.md §6.1)
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
		w.Header().Set("Cache-Control", "private, no-transform")
		w.Header().Del("Pragma")
		w.Header().Del("Expires")
	}

	w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	w.Header().Set("Content-Type", contentType)

	if isInline {
		w.WriteHeader(http.StatusOK)

		// Inline media streaming (e.g. <img> previews) bypasses transfer jobs completely (F2')
		// to avoid broadcasting job state changes (queued/started/completed) to the entire room.
		if fileReader != nil {
			if _, err := io.Copy(w, fileReader); err != nil {
				diag.Emit(r.Context(), h.logger, diag.LevelWarn, "inline stream failed", err, fields...)
				return
			}
			diag.Emit(r.Context(), h.logger, diag.LevelInfo, "inline stream completed successfully", nil, fields...)
		} else if mockSizeStr != "" {
			buf := make([]byte, 32*1024)
			var totalWritten int64
			for totalWritten < size {
				select {
				case <-r.Context().Done():
					return
				default:
				}
				writeSize := int64(len(buf))
				if size-totalWritten < writeSize {
					writeSize = size - totalWritten
				}
				n, err := w.Write(buf[:writeSize])
				if err != nil {
					return
				}
				totalWritten += int64(n)
				if size < 500*1024 {
					time.Sleep(1 * time.Millisecond)
				}
			}
		} else {
			// P2P / Duplex Streaming Proxy mode for inline media
			h.mu.Lock()
			rdv := &rendezvous{
				readerChan: make(chan io.ReadCloser, 1),
				errChan:    make(chan error, 1),
			}
			h.rendezvousMap[fileID] = append(h.rendezvousMap[fileID], rdv)
			h.mu.Unlock()
			defer func() {
				h.mu.Lock()
				list := h.rendezvousMap[fileID]
				for i, r := range list {
					if r == rdv {
						h.rendezvousMap[fileID] = append(list[:i], list[i+1:]...)
						break
					}
				}
				if len(h.rendezvousMap[fileID]) == 0 {
					delete(h.rendezvousMap, fileID)
				}
				h.mu.Unlock()
			}()

			sess.Broadcast(protocol.EventEnvelope{
				Type: protocol.EventRequestFileData,
				Message: &protocol.Message{
					ID: fileID,
				},
				Time: time.Now(),
			})

			select {
			case senderStream := <-rdv.readerChan:
				defer senderStream.Close()
				var limitReader io.Reader = senderStream
				if msg, ok := sess.MessageStore.Find(fileID); ok && msg.Size > 0 {
					limitReader = io.LimitReader(senderStream, msg.Size)
				}
				if _, err := io.Copy(w, limitReader); err != nil {
					rdv.errChan <- err
					diag.Emit(r.Context(), h.logger, diag.LevelWarn, "inline rendezvous copy failed", err, fields...)
					return
				}
				rdv.errChan <- nil
			case <-r.Context().Done():
				return
			case <-time.After(35 * time.Second):
				http.Error(w, "Timeout waiting for sender stream", http.StatusGatewayTimeout)
				return
			}
		}
		return
	}

	// Create and register the download Job only for active data streaming
	jobID := "dl-" + fileID
	if clientID != "" {
		jobID = "dl-" + fileID + "-" + clientID
	}
	job, err := h.transfer.GetJob(jobID)
	if err != nil || job.State == protocol.TransferCancelled || job.State == protocol.TransferFailed || job.State == protocol.TransferCompleted {
		h.transfer.CreateJob(token, jobID, messageID, clientID, filename, size)
	}

	w.WriteHeader(http.StatusOK)

	// Start the job
	_ = h.transfer.StartJob(jobID)

	// Attachment data plane only — WebSocket control/text paths never use this scheduler.
	h.scheduler.RegisterJob(jobID, h.attachmentUnrestricted())
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
		h.rendezvousMap[fileID] = append(h.rendezvousMap[fileID], rdv)
		h.mu.Unlock()
		defer func() {
			h.mu.Lock()
			list := h.rendezvousMap[fileID]
			for i, r := range list {
				if r == rdv {
					h.rendezvousMap[fileID] = append(list[:i], list[i+1:]...)
					break
				}
			}
			if len(h.rendezvousMap[fileID]) == 0 {
				delete(h.rendezvousMap, fileID)
			}
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

			var limitReader io.Reader = senderStream
			if msg, ok := sess.MessageStore.Find(fileID); ok && msg.Size > 0 {
				limitReader = io.LimitReader(senderStream, msg.Size)
			}

			if _, err := io.Copy(pw, limitReader); err != nil {
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
	var rdv *rendezvous
	list := h.rendezvousMap[messageID]
	if len(list) > 0 {
		rdv = list[0]
		h.rendezvousMap[messageID] = list[1:]
		if len(h.rendezvousMap[messageID]) == 0 {
			delete(h.rendezvousMap, messageID)
		}
	}
	h.mu.Unlock()

	if rdv == nil {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusNotFound, "stream rendezvous not found (receiver might have canceled or timed out)"), fields...)
		return
	}

	// We stream raw r.Body directly without parsing multipart to prevent memory buffering or temp file writes.
	// Send file reader to the waiting GET download thread.
	rdv.readerChan <- r.Body

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
	if job, err := pw.transfer.GetJob(pw.jobID); err == nil {
		if job.GetState() == protocol.TransferCancelled {
			return 0, fmt.Errorf("transfer cancelled by user")
		}
	}
	n, err := pw.writer.Write(p)
	if n > 0 {
		pw.written += int64(n)
		_ = pw.transfer.UpdateProgress(pw.jobID, pw.written)
		pw.scheduler.Throttle(pw.jobID, pw.written, pw.startTime)
	}
	return n, err
}

// handleZipDownload packages multiple selected chat attachments into a single zip archive for mobile/browser clients.
func (h *Handler) handleZipDownload(w http.ResponseWriter, r *http.Request, token string, fields ...diag.Field) {
	if r.Method != http.MethodGet {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusMethodNotAllowed, "method not allowed"), fields...)
		return
	}

	query := r.URL.Query()
	clientID := query.Get("clientId")

	// Collect message/file IDs from query parameters (supports both comma-separated and multiple `ids` params)
	var rawIDs []string
	for _, val := range query["ids"] {
		for _, part := range strings.Split(val, ",") {
			if trimmed := strings.TrimSpace(part); trimmed != "" && !sliceContains(rawIDs, trimmed) {
				rawIDs = append(rawIDs, trimmed)
			}
		}
	}

	if len(rawIDs) == 0 {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusBadRequest, "no file IDs specified for zip download"), fields...)
		return
	}

	sess := h.sessions.GetOrCreate(token)
	zipFilename := query.Get("filename")
	if zipFilename == "" {
		zipFilename = fmt.Sprintf("chat-attachments-%s.zip", time.Now().Format("20060102-150405"))
	} else if !strings.HasSuffix(strings.ToLower(zipFilename), ".zip") {
		zipFilename += ".zip"
	}

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", zipFilename))
	w.WriteHeader(http.StatusOK)

	zipWriter := zip.NewWriter(w)
	defer zipWriter.Close()

	usedNames := make(map[string]int)
	getUniqueFilename := func(orig string) string {
		if orig == "" {
			orig = "attachment.bin"
		}
		ext := filepath.Ext(orig)
		base := strings.TrimSuffix(orig, ext)
		count, exists := usedNames[orig]
		if !exists {
			usedNames[orig] = 1
			return orig
		}
		usedNames[orig] = count + 1
		return fmt.Sprintf("%s (%d)%s", base, count, ext)
	}

	mockSizeStr := query.Get("mock_size")

	for _, fileID := range rawIDs {
		filePath := sess.GetAttachment(fileID)
		var origName string
		var fileSize int64

		if msg, ok := sess.MessageStore.Find(fileID); ok && msg != nil {
			origName = msg.FileName
			fileSize = msg.Size
		}

		var fileReader io.ReadCloser
		if filePath != "" {
			if info, err := os.Stat(filePath); err == nil && !info.IsDir() {
				if fileSize == 0 {
					fileSize = info.Size()
				}
				if origName == "" {
					origName = filepath.Base(filePath)
				}
				if f, err := os.Open(filePath); err == nil {
					fileReader = f
				}
			}
		}

		if origName == "" {
			origName = "file-" + fileID + ".bin"
		}

		jobID := "dl-" + fileID
		if clientID != "" {
			jobID = "dl-" + fileID + "-" + clientID
		}

		_, msgExists := sess.MessageStore.Find(fileID)
		isMissing := fileReader == nil && (mockSizeStr == "" || (!msgExists && filePath == ""))

		if isMissing {
			job, err := h.transfer.GetJob(jobID)
			if err != nil || job.State == protocol.TransferCancelled || job.State == protocol.TransferFailed || job.State == protocol.TransferCompleted {
				_ = h.transfer.CreateJob(token, jobID, fileID, clientID, origName, fileSize)
			}
			_ = h.transfer.FailJob(jobID, fmt.Errorf("attachment file not found on server: %s", fileID))
			diag.Emit(r.Context(), h.logger, diag.LevelWarn, "zip download skipped missing file", fmt.Errorf("file missing"), append(fields, diag.F("fileID", fileID))...)
			continue
		}

		cleanFilename := getUniqueFilename(origName)
		header := &zip.FileHeader{
			Name:     cleanFilename,
			Method:   zip.Deflate,
			Modified: time.Now(),
		}

		fw, err := zipWriter.CreateHeader(header)
		if err != nil {
			if fileReader != nil {
				_ = fileReader.Close()
			}
			continue
		}

		job, err := h.transfer.GetJob(jobID)
		if err != nil || job.State == protocol.TransferCancelled || job.State == protocol.TransferFailed || job.State == protocol.TransferCompleted {
			_ = h.transfer.CreateJob(token, jobID, fileID, clientID, cleanFilename, fileSize)
		} else if fileSize > 0 && job.BytesTotal == 0 {
			_ = h.transfer.SetJobBytesTotal(jobID, fileSize)
		}
		_ = h.transfer.StartJob(jobID)

		if fileReader != nil {
			var readWritten int64
			pr := transfer.NewProgressReader(fileReader, func(n int) {
				readWritten += int64(n)
				_ = h.transfer.UpdateProgress(jobID, readWritten)
			})

			_, copyErr := io.Copy(fw, pr)
			_ = fileReader.Close()
			if copyErr == nil {
				_ = h.transfer.CompleteJob(jobID)
				if updatedMsg := sess.MessageStore.MarkDownloaded(fileID); updatedMsg != nil {
					sess.Broadcast(protocol.EventEnvelope{
						Type:    protocol.EventMessageUpdated,
						Message: updatedMsg,
					})
				}
			} else {
				_ = h.transfer.FailJob(jobID, copyErr)
			}
		} else if mockSizeStr != "" {
			// Mock data writer for test suite
			var mockSize int64 = 1024
			if s, err := strconv.ParseInt(mockSizeStr, 10, 64); err == nil && s > 0 {
				mockSize = s
			}
			if existingJob, getErr := h.transfer.GetJob(jobID); getErr == nil && existingJob.BytesTotal == 0 {
				_ = h.transfer.SetJobBytesTotal(jobID, mockSize)
			}

			chunkSize := int64(32 * 1024)
			var totalWritten int64
			var writeErr error
			for totalWritten < mockSize {
				currChunk := chunkSize
				if mockSize-totalWritten < currChunk {
					currChunk = mockSize - totalWritten
				}
				buf := make([]byte, currChunk)
				n, err := fw.Write(buf)
				if n > 0 {
					totalWritten += int64(n)
					_ = h.transfer.UpdateProgress(jobID, totalWritten)
				}
				if err != nil {
					writeErr = err
					break
				}
			}

			if writeErr == nil {
				_ = h.transfer.CompleteJob(jobID)
				if updatedMsg := sess.MessageStore.MarkDownloaded(fileID); updatedMsg != nil {
					sess.Broadcast(protocol.EventEnvelope{
						Type:    protocol.EventMessageUpdated,
						Message: updatedMsg,
					})
				}
			} else {
				_ = h.transfer.FailJob(jobID, writeErr)
			}
		}
	}
}

func sliceContains(slice []string, val string) bool {
	for _, item := range slice {
		if item == val {
			return true
		}
	}
	return false
}

// isSafeInlineResource checks whether a file type is safe for inline rendering.
// Executable/scriptable documents such as SVG, HTML, XML, and JS are strictly excluded
// to eliminate stored-XSS execution vectors when opened as top-level documents (F1').
func isSafeInlineResource(contentType, filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	if ext == ".svg" || ext == ".html" || ext == ".htm" || ext == ".xhtml" || ext == ".xml" || ext == ".js" {
		return false
	}
	ct := strings.ToLower(contentType)
	if strings.Contains(ct, "svg") || strings.Contains(ct, "html") || strings.Contains(ct, "javascript") || strings.Contains(ct, "xml") {
		return false
	}
	return true
}
