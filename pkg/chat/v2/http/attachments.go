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
	"time"

	"eqt/pkg/chat/v2/diag"
	"eqt/pkg/chat/v2/protocol"
	"eqt/pkg/chat/v2/transfer"
)

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
		ID:        msgID,
		SenderID:  senderID,
		Sender:    req.Sender,
		Avatar:    req.Avatar,
		Type:      protocol.MessageFile,
		FileName:  fileName,
		Size:      size,
		MimeType:  mimeType,
		FilePath:  req.Path,
		CreatedAt: time.Now(),
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
	sess.Broadcast(event)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(msg)
}

// handleUpload handles file upload from web clients, writing the data to a temporary file.
func (h *Handler) handleUpload(w http.ResponseWriter, r *http.Request, token string, fields ...diag.Field) {
	if r.Method != http.MethodPost {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusMethodNotAllowed, "method not allowed"), fields...)
		return
	}

	// Parse multipart form up to 32MB in RAM, rest goes to disk
	err := r.ParseMultipartForm(32 * 1024 * 1024)
	if err != nil {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusBadRequest, "failed to parse multipart form: "+err.Error()), fields...)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusBadRequest, "file parameter is required: "+err.Error()), fields...)
		return
	}
	defer file.Close()

	sender := r.FormValue("sender")
	avatar := r.FormValue("avatar")
	peer := r.FormValue("peer")
	messageID := r.FormValue("messageId")

	if sender == "" {
		sender = "Anonymous"
	}

	// Create temp file
	tempFile, err := os.CreateTemp("", "eqt-chat-upload-*")
	if err != nil {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorInternal, http.StatusInternalServerError, "failed to create temp file: "+err.Error()), fields...)
		return
	}
	defer tempFile.Close()

	// Wrap copy stream to report progress
	var pr io.Reader = file
	if messageID != "" {
		pr = &progressReader{
			reader:   file,
			transfer: h.transfer,
			jobID:    "ul-" + messageID,
		}
	}

	// Stream copy
	size, err := io.Copy(tempFile, pr)
	if err != nil {
		tempFile.Close()
		os.Remove(tempFile.Name())
		if messageID != "" {
			_ = h.transfer.FailJob("ul-"+messageID, err)
		}
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorInternal, http.StatusInternalServerError, "failed to save upload: "+err.Error()), fields...)
		return
	}

	// 显式关闭临时文件以确保数据落盘且释放文件句柄
	if err := tempFile.Close(); err != nil {
		os.Remove(tempFile.Name())
		if messageID != "" {
			_ = h.transfer.FailJob("ul-"+messageID, err)
		}
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorInternal, http.StatusInternalServerError, "failed to flush upload temp file: "+err.Error()), fields...)
		return
	}

	fileName := header.Filename
	mimeType := mime.TypeByExtension(filepath.Ext(fileName))
	sess := h.sessions.GetOrCreate(token)

	if messageID != "" {
		// Update physical path and complete job
		sess.AddAttachment(messageID, tempFile.Name())
		sess.MessageStore.MarkUploadComplete(messageID)
		_ = h.transfer.CompleteJob("ul-" + messageID)

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
			ID:        msgID,
			SenderID:  senderID,
			Sender:    sender,
			Avatar:    avatar,
			Type:      protocol.MessageFile,
			FileName:  fileName,
			Size:      size,
			MimeType:  mimeType,
			CreatedAt: time.Now(),
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
