package chathttp

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"eqt/pkg/chat/v2/bandwidth"
	"eqt/pkg/chat/v2/diag"
	"eqt/pkg/chat/v2/protocol"
	"eqt/pkg/chat/v2/session"
	"eqt/pkg/chat/v2/transfer"
)

// freeChatMaxAttachmentBytes references bandwidth.DefaultFreeChatMaxAttachmentBytes for free over-quota uploads.
const freeChatMaxAttachmentBytes int64 = bandwidth.DefaultFreeChatMaxAttachmentBytes

// handleLocalAttachmentRegister registers a local file attachment from the GUI host.
func (h *Handler) handleLocalAttachmentRegister(w http.ResponseWriter, r *http.Request, token string, fields ...diag.Field) {
	if r.Method != http.MethodPost {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusMethodNotAllowed, "method not allowed"), fields...)
		return
	}

	// Verify hostToken
	actualHostToken := ""
	if h.hostToken != nil {
		actualHostToken = h.hostToken()
	}
	reqHostToken := r.URL.Query().Get("hostToken")
	if actualHostToken == "" || reqHostToken != actualHostToken {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusForbidden, "forbidden"), fields...)
		return
	}

	var req struct {
		Path   string `json:"path"`
		Sender string `json:"sender"`
		Avatar string `json:"avatar"`
		Token  string `json:"token"`
		Peer   string `json:"peer"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusBadRequest, "invalid request body"), fields...)
		return
	}

	if req.Path == "" {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusBadRequest, "path is required"), fields...)
		return
	}

	info, err := os.Stat(req.Path)
	if err != nil {
		if os.IsNotExist(err) {
			diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusNotFound, "file does not exist"), fields...)
			return
		}
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusInternalServerError, err.Error()), fields...)
		return
	}
	if info.IsDir() {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusBadRequest, "path is a directory, not a file"), fields...)
		return
	}

	fileName := filepath.Base(req.Path)
	size := info.Size()
	if !h.attachmentUnrestricted() && size > freeChatMaxAttachmentBytes {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusRequestEntityTooLarge, "file size exceeds 10MB free limit. Please upgrade."), fields...)
		return
	}
	mimeType := mime.TypeByExtension(filepath.Ext(fileName))

	// Generate unique message ID
	msgID := generateAttachmentMsgID()

	// Register mapping in session
	sess := h.sessions.GetOrCreate(token)
	sess.AddAttachment(msgID, req.Path)

	senderID := req.Peer
	if senderID == "" {
		senderID = "desktop"
	}

	msg := &protocol.Message{
		ID:         msgID,
		SenderID:   senderID,
		Sender:     req.Sender,
		Avatar:     req.Avatar,
		Theme:      sess.GetClientTheme(senderID),
		Type:       protocol.MessageFile,
		FileName:   fileName,
		Size:       size,
		MimeType:   mimeType,
		FilePath:   req.Path,
		URL:        fmt.Sprintf("/chat-v2/%s/files/%s", token, msgID),
		Downloaded: true,
		CreatedAt:  time.Now(),
	}

	event := protocol.EventEnvelope{
		Type:    protocol.EventMessageAdded,
		Message: msg,
		Time:    time.Now(),
	}

	sess.Broadcast(event)

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(msg); err != nil {
		diag.Emit(r.Context(), h.logger, diag.LevelWarn, "failed to encode register response", err, fields...)
	}
}

func generateAttachmentMsgID() string {
	maxSeed := int64(1<<31 - 1)
	seed, err := rand.Int(rand.Reader, big.NewInt(maxSeed))
	if err != nil {
		return fmt.Sprintf("msg-%d", time.Now().UnixNano())
	}
	return fmt.Sprintf("msg-%d", seed.Int64()+1)
}

// handleUploadInit handles pre-registering a file upload message to get a message ID and allocate placeholder cards.
func (h *Handler) handleUploadInit(w http.ResponseWriter, r *http.Request, token string, fields ...diag.Field) {
	if r.Method != http.MethodPost {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusMethodNotAllowed, "method not allowed"), fields...)
		return
	}

	var req struct {
		FileName string `json:"fileName"`
		Size     int64  `json:"size"`
		Sender   string `json:"sender"`
		Avatar   string `json:"avatar"`
		Peer     string `json:"peer"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusBadRequest, "invalid request body"), fields...)
		return
	}

	if !h.attachmentUnrestricted() && req.Size > freeChatMaxAttachmentBytes {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusRequestEntityTooLarge, "file size exceeds 10MB free limit. Please upgrade."), fields...)
		return
	}

	msgID := generateAttachmentMsgID()

	sess := h.sessions.GetOrCreate(token)
	senderID := req.Peer
	if senderID == "" {
		senderID = "web-upload"
	}

	msg := &protocol.Message{
		ID:        msgID,
		SenderID:  senderID,
		Sender:    req.Sender,
		Avatar:    req.Avatar,
		Theme:     sess.GetClientTheme(senderID),
		Type:      protocol.MessageFile,
		FileName:  req.FileName,
		Size:      req.Size,
		MimeType:  mime.TypeByExtension(filepath.Ext(req.FileName)),
		Uploading: true, // Marked as uploading state
		CreatedAt: time.Now(),
	}

	event := protocol.EventEnvelope{
		Type:    protocol.EventMessageAdded,
		Message: msg,
		Time:    time.Now(),
	}
	// Pre-create and start the upload job so clients can report progress immediately
	h.transfer.CreateJob(token, "ul-"+msgID, msgID, senderID, req.FileName, req.Size)
	_ = h.transfer.StartJob("ul-" + msgID)

	sess.Broadcast(event)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(msg)
}

// handleUpload handles file upload from web clients, writing the data directly to a temporary file in uploadRoot via single-pass streaming.
func (h *Handler) handleUpload(w http.ResponseWriter, r *http.Request, token string, fields ...diag.Field) {
	if r.Method != http.MethodPost {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusMethodNotAllowed, "method not allowed"), fields...)
		return
	}

	mr, err := r.MultipartReader()
	if err != nil {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusBadRequest, "failed to parse multipart reader: "+err.Error()), fields...)
		return
	}

	sender := strings.TrimSpace(r.URL.Query().Get("sender"))
	avatar := strings.TrimSpace(r.URL.Query().Get("avatar"))
	peer := strings.TrimSpace(r.URL.Query().Get("peer"))
	messageID := strings.TrimSpace(r.URL.Query().Get("messageId"))

	uploadRoot, err := session.UploadRoot()
	if err != nil {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorInternal, http.StatusInternalServerError, "failed to resolve upload root: "+err.Error()), fields...)
		return
	}

	unrestricted := h.attachmentUnrestricted()

	var (
		tempFile    *os.File
		fileName    string
		writtenSize int64
		jobID       string
		fileFound   bool
	)

	cleanupTemp := func() {
		if tempFile != nil {
			_ = tempFile.Close()
			_ = os.Remove(tempFile.Name())
		}
	}

	for {
		part, partErr := mr.NextPart()
		if partErr == io.EOF {
			break
		}
		if partErr != nil {
			cleanupTemp()
			if jobID != "" {
				_ = h.transfer.FailJob(jobID, partErr)
			}
			diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusBadRequest, "failed reading multipart part: "+partErr.Error()), fields...)
			return
		}

		formName := part.FormName()
		if formName == "file" {
			fileFound = true
			fileName = part.FileName()
			if fileName == "" {
				fileName = "attachment"
			}

			// Create temp file directly inside uploadRoot (Single-pass streaming, 0 intermediate /tmp files)
			tempFile, err = os.CreateTemp(uploadRoot, "eqt-chat-upload-*")
			if err != nil {
				part.Close()
				diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorInternal, http.StatusInternalServerError, "failed to create temp file: "+err.Error()), fields...)
				return
			}

			if messageID != "" {
				jobID = "ul-" + messageID
				h.transfer.CreateJob(token, jobID, messageID, peer, fileName, 0)
				_ = h.transfer.StartJob(jobID)
			}

			var pr io.Reader = part
			if jobID != "" {
				pr = &progressReader{
					reader:   part,
					transfer: h.transfer,
					jobID:    jobID,
				}
			}

			if !unrestricted {
				throttleJobID := jobID
				if throttleJobID == "" {
					throttleJobID = "ul-direct-" + generateAttachmentMsgID()
				}
				h.scheduler.RegisterJob(throttleJobID, false)
				defer h.scheduler.UnregisterJob(throttleJobID)
				pr = &throttledUploadReader{
					reader:    pr,
					scheduler: h.scheduler,
					jobID:     throttleJobID,
					startTime: time.Now(),
				}
			}

			// Stream directly to tempFile in uploadRoot
			writtenSize, err = io.Copy(tempFile, pr)
			part.Close()
			if err != nil {
				cleanupTemp()
				if jobID != "" {
					_ = h.transfer.FailJob(jobID, err)
				}
				diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorInternal, http.StatusInternalServerError, "failed to save upload: "+err.Error()), fields...)
				return
			}

			// Enforce free tier size limit if degraded/restricted
			if !unrestricted && writtenSize > freeChatMaxAttachmentBytes {
				cleanupTemp()
				if jobID != "" {
					_ = h.transfer.FailJob(jobID, fmt.Errorf("file size exceeds limit"))
				}
				diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusRequestEntityTooLarge, "file size exceeds 10MB free limit. Please upgrade."), fields...)
				return
			}

			// Explicit close to flush to disk
			if err := tempFile.Close(); err != nil {
				_ = os.Remove(tempFile.Name())
				if jobID != "" {
					_ = h.transfer.FailJob(jobID, err)
				}
				diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorInternal, http.StatusInternalServerError, "failed to flush upload temp file: "+err.Error()), fields...)
				return
			}
		} else {
			// Read form field values
			buf, readErr := io.ReadAll(io.LimitReader(part, 64*1024))
			part.Close()
			if readErr == nil {
				val := strings.TrimSpace(string(buf))
				switch formName {
				case "messageId":
					if messageID == "" {
						messageID = val
					}
				case "sender":
					if sender == "" {
						sender = val
					}
				case "avatar":
					if avatar == "" {
						avatar = val
					}
				case "peer":
					if peer == "" {
						peer = val
					}
				}
			}
		}
	}

	if !fileFound || tempFile == nil {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusBadRequest, "file parameter is required"), fields...)
		return
	}

	if sender == "" {
		sender = "Anonymous"
	}

	mimeType := mime.TypeByExtension(filepath.Ext(fileName))
	sess := h.sessions.GetOrCreate(token)

	if messageID != "" {
		if jobID == "" {
			jobID = "ul-" + messageID
			h.transfer.CreateJob(token, jobID, messageID, peer, fileName, writtenSize)
			_ = h.transfer.StartJob(jobID)
			_ = h.transfer.UpdateProgress(jobID, writtenSize)
		}
		// Update physical path and complete job
		sess.AddAttachment(messageID, tempFile.Name())
		// Mark as downloaded instantly when caching finishes to enable instant broadcast distribution to peer clients
		_ = sess.MessageStore.MarkDownloaded(messageID)
		if msg := sess.MessageStore.MarkUploadComplete(messageID); msg != nil {
			event := protocol.EventEnvelope{
				Type:    protocol.EventMessageUpdated,
				Time:    time.Now(),
				Message: msg,
			}
			sess.Broadcast(event)
		}
		_ = h.transfer.CompleteJob(jobID)

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "success", "messageId": messageID})
	} else {
		// Fallback direct upload mode
		msgID := generateAttachmentMsgID()
		sess.AddAttachment(msgID, tempFile.Name())

		senderID := peer
		if senderID == "" {
			senderID = "web-upload"
		}

		msg := &protocol.Message{
			ID:         msgID,
			SenderID:   senderID,
			Sender:     sender,
			Avatar:     avatar,
			Theme:      sess.GetClientTheme(senderID),
			Type:       protocol.MessageFile,
			FileName:   fileName,
			Size:       writtenSize,
			MimeType:   mimeType,
			URL:        fmt.Sprintf("/chat-v2/%s/files/%s", token, msgID),
			Downloaded: true, // Auto-mark downloaded when fallback direct upload caches successfully
			CreatedAt:  time.Now(),
		}

		event := protocol.EventEnvelope{
			Type:    protocol.EventMessageAdded,
			Message: msg,
			Time:    time.Now(),
		}
		sess.Broadcast(event)

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(msg)
	}
}

type progressReader struct {
	reader   io.Reader
	transfer *transfer.Manager
	jobID    string
	written  int64
}

func (pr *progressReader) Read(p []byte) (n int, err error) {
	n, err = pr.reader.Read(p)
	if n > 0 {
		pr.written += int64(n)
		_ = pr.transfer.UpdateProgress(pr.jobID, pr.written)
	}
	return n, err
}

// throttledUploadReader applies attachment data-plane bandwidth limits on upload.
// WebSocket control traffic never flows through this reader.
type throttledUploadReader struct {
	reader    io.Reader
	scheduler *bandwidth.Scheduler
	jobID     string
	startTime time.Time
	written   int64
}

func (tr *throttledUploadReader) Read(p []byte) (int, error) {
	n, err := tr.reader.Read(p)
	if n > 0 && tr.scheduler != nil {
		tr.written += int64(n)
		tr.scheduler.Throttle(tr.jobID, tr.written, tr.startTime)
	}
	return n, err
}
