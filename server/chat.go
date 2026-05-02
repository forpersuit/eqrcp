package server

import (
	"encoding/json"
	"fmt"
	"image/jpeg"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"eqrcp/pages"
	"eqrcp/qr"
	"eqrcp/version"
)

const maxChatHistory = 200

type chatSession struct {
	mu              sync.Mutex
	messages        []chatMessage
	attachments     map[string]chatAttachment
	subscribers     map[chan struct{}]struct{}
	nextID          int64
	dir             string
	attachmentRoute string
}

type chatMessage struct {
	ID        string    `json:"id"`
	Sender    string    `json:"sender"`
	Type      string    `json:"type"`
	Text      string    `json:"text,omitempty"`
	Recalled  bool      `json:"recalled,omitempty"`
	FileName  string    `json:"fileName,omitempty"`
	Size      int64     `json:"size,omitempty"`
	MimeType  string    `json:"mimeType,omitempty"`
	URL       string    `json:"url,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type chatAttachment struct {
	ID       string
	Path     string
	FileName string
	Size     int64
	MimeType string
}

// Chat adds handlers for a browser-based chat session.
func (s *Server) Chat() error {
	dir, err := os.MkdirTemp("", "eqrcp-chat-*")
	if err != nil {
		return err
	}
	route := strings.TrimPrefix(strings.TrimRight(s.ChatURL, "/"), s.BaseURL)
	if route == "" || route == s.ChatURL {
		os.RemoveAll(dir)
		return fmt.Errorf("invalid chat URL %q", s.ChatURL)
	}
	imageRoute := route + "/qr/image"
	eventsRoute := route + "/events"
	messagesRoute := route + "/messages"
	attachmentsRoute := route + "/attachments"
	stopRoute := route + "/stop"
	healthRoute := route + "/health"
	session := &chatSession{
		attachments:     map[string]chatAttachment{},
		subscribers:     map[chan struct{}]struct{}{},
		dir:             dir,
		attachmentRoute: attachmentsRoute,
	}
	qrImg, err := qr.RenderImage(s.ChatURL)
	if err != nil {
		os.RemoveAll(dir)
		return err
	}
	s.chatDir = dir
	s.setStatus("waiting", "Chat session waiting for a device to connect.")
	s.updateStatus(func(status *transferStatus) {
		status.Mode = "chat"
		status.Title = "Chat session"
		status.Target = s.ChatURL
		status.Message = "Scan to join this chat session."
	})
	s.mux.HandleFunc(imageRoute, func(w http.ResponseWriter, r *http.Request) {
		if handleChatCORS(w, r, http.MethodGet) {
			return
		}
		w.Header().Set("Content-Type", "image/jpeg")
		if err := jpeg.Encode(w, qrImg, nil); err != nil {
			log.Println(err)
		}
	})
	s.mux.HandleFunc(route, func(w http.ResponseWriter, r *http.Request) {
		if handleChatCORS(w, r, http.MethodGet) {
			return
		}
		if r.URL.Path != route {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		variables := struct {
			URL              string
			QRImageRoute     string
			EventsRoute      string
			MessagesRoute    string
			AttachmentsRoute string
			StopRoute        string
			HealthRoute      string
			Version          string
		}{
			URL:              s.ChatURL,
			QRImageRoute:     imageRoute,
			EventsRoute:      eventsRoute,
			MessagesRoute:    messagesRoute,
			AttachmentsRoute: attachmentsRoute,
			StopRoute:        stopRoute,
			HealthRoute:      healthRoute,
			Version:          version.String(),
		}
		if err := serveTemplate("chat", pages.Chat, w, variables); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			log.Printf("Template error: %v\n", err)
			s.signalStop()
		}
	})
	s.mux.HandleFunc(eventsRoute, session.handleEvents)
	s.mux.HandleFunc(messagesRoute, session.handleMessages)
	s.mux.HandleFunc(messagesRoute+"/", session.handleMessageAction)
	s.mux.HandleFunc(attachmentsRoute, session.handleAttachmentUpload)
	s.mux.HandleFunc(attachmentsRoute+"/", session.handleAttachmentDownload)
	s.mux.HandleFunc(stopRoute, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		session.addSystemMessage("Chat session stopped.")
		s.setStatus("stopped", "Chat session stopped.")
		fmt.Fprintln(w, "Chat session stopped. You can close this page.")
		s.signalStop()
	})
	s.mux.HandleFunc(healthRoute, func(w http.ResponseWriter, r *http.Request) {
		if handleChatCORS(w, r, http.MethodGet) {
			return
		}
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		session.mu.Lock()
		messageCount := len(session.messages)
		session.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":       "ok",
			"timestamp":    time.Now().Unix(),
			"messageCount": messageCount,
		})
	})
	return nil
}

func (session *chatSession) handleMessageAction(w http.ResponseWriter, r *http.Request) {
	if handleChatCORS(w, r, http.MethodDelete) {
		return
	}
	if r.Method != http.MethodDelete {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := strings.TrimPrefix(r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:], "/")
	var request struct {
		Sender string `json:"sender"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&request)
	}
	message, ok := session.recallMessage(id, sanitizeChatSender(request.Sender))
	if !ok {
		http.Error(w, "message not found or cannot be recalled", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(message); err != nil {
		log.Println(err)
	}
}

func (s *Server) DisplayChat() error {
	if err := s.Chat(); err != nil {
		return err
	}
	return openBrowser(s.ChatURL + "?peer=desktop")
}

func (session *chatSession) handleMessages(w http.ResponseWriter, r *http.Request) {
	if handleChatCORS(w, r, http.MethodGet, http.MethodPost) {
		return
	}
	switch r.Method {
	case http.MethodGet:
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(session.snapshot()); err != nil {
			log.Println(err)
		}
	case http.MethodPost:
		var request struct {
			Sender string `json:"sender"`
			Text   string `json:"text"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&request); err != nil {
			http.Error(w, "invalid message", http.StatusBadRequest)
			return
		}
		message := session.addTextMessage(sanitizeChatSender(request.Sender), request.Text)
		if message.ID == "" {
			http.Error(w, "message text is empty", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(message); err != nil {
			log.Println(err)
		}
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (session *chatSession) handleAttachmentUpload(w http.ResponseWriter, r *http.Request) {
	if handleChatCORS(w, r, http.MethodPost) {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		http.Error(w, "upload failed", http.StatusBadRequest)
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	sender := sanitizeChatSender(r.FormValue("sender"))
	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		files = r.MultipartForm.File["file"]
	}
	if len(files) == 0 {
		http.Error(w, "no file uploaded", http.StatusBadRequest)
		return
	}
	var uploaded []chatMessage
	for _, header := range files {
		file, err := header.Open()
		if err != nil {
			http.Error(w, "upload failed", http.StatusBadRequest)
			return
		}
		message, err := session.saveAttachment(sender, safeChatFilename(header.Filename), header.Header.Get("Content-Type"), header.Size, file)
		file.Close()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		uploaded = append(uploaded, message)
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(uploaded); err != nil {
		log.Println(err)
	}
}

func (session *chatSession) handleAttachmentDownload(w http.ResponseWriter, r *http.Request) {
	if handleChatCORS(w, r, http.MethodGet) {
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) == 0 {
		http.NotFound(w, r)
		return
	}
	id := parts[len(parts)-1]
	session.mu.Lock()
	attachment, ok := session.attachments[id]
	session.mu.Unlock()
	if !ok {
		http.NotFound(w, r)
		return
	}
	if r.URL.Query().Get("download") == "1" {
		w.Header().Set("Content-Disposition", contentDispositionFor("attachment", attachment.FileName))
	} else {
		w.Header().Set("Content-Disposition", contentDispositionFor("inline", attachment.FileName))
	}
	if attachment.MimeType != "" {
		w.Header().Set("Content-Type", attachment.MimeType)
	}
	http.ServeFile(w, r, attachment.Path)
}

func (session *chatSession) handleEvents(w http.ResponseWriter, r *http.Request) {
	if handleChatCORS(w, r, http.MethodGet) {
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	
	// Support Last-Event-ID for message recovery after reconnection
	lastEventID := r.Header.Get("Last-Event-ID")
	if lastEventID == "" {
		lastEventID = r.URL.Query().Get("lastEventId")
	}
	
	write := func() bool {
		messages := session.snapshot()
		
		// If client provides lastEventID, only send messages after that ID
		if lastEventID != "" {
			messages = filterMessagesAfter(messages, lastEventID)
		}
		
		data, err := json.Marshal(messages)
		if err != nil {
			return false
		}
		if lastID := latestChatMessageID(messages); lastID != "" {
			if _, err := fmt.Fprintf(w, "id: %s\n", lastID); err != nil {
				return false
			}
		}
		if _, err := fmt.Fprintf(w, "data: %s\n\n", data); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}
	if !write() {
		return
	}
	events, unsubscribe := session.subscribe()
	defer unsubscribe()
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-events:
			if !write() {
				return
			}
		case <-heartbeat.C:
			if _, err := fmt.Fprint(w, ": keep-alive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func handleChatCORS(w http.ResponseWriter, r *http.Request, methods ...string) bool {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	if len(methods) > 0 {
		allowed := append([]string(nil), methods...)
		allowed = append(allowed, http.MethodOptions)
		w.Header().Set("Access-Control-Allow-Methods", strings.Join(allowed, ", "))
	}
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return true
	}
	return false
}

func (session *chatSession) addTextMessage(sender string, text string) chatMessage {
	text = strings.TrimSpace(text)
	if text == "" {
		return chatMessage{}
	}
	return session.addMessage(chatMessage{
		Sender: sender,
		Type:   "text",
		Text:   text,
	})
}

func (session *chatSession) addSystemMessage(text string) chatMessage {
	return session.addMessage(chatMessage{
		Sender: "system",
		Type:   "system",
		Text:   text,
	})
}

func (session *chatSession) saveAttachment(sender string, name string, mimeType string, size int64, reader io.Reader) (chatMessage, error) {
	if name == "" {
		name = "attachment"
	}
	id := session.nextMessageID()
	storedName := id + "-" + name
	path := filepath.Join(session.dir, storedName)
	out, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return chatMessage{}, err
	}
	written, copyErr := io.Copy(out, reader)
	closeErr := out.Close()
	if copyErr != nil {
		return chatMessage{}, copyErr
	}
	if closeErr != nil {
		return chatMessage{}, closeErr
	}
	if size <= 0 {
		size = written
	}
	if mimeType == "" || mimeType == "application/octet-stream" {
		mimeType = mime.TypeByExtension(filepath.Ext(name))
	}
	messageType := "file"
	if strings.HasPrefix(mimeType, "image/") {
		messageType = "image"
	} else if strings.HasPrefix(mimeType, "video/") {
		messageType = "video"
	}
	message := chatMessage{
		ID:        id,
		Sender:    sender,
		Type:      messageType,
		FileName:  name,
		Size:      size,
		MimeType:  mimeType,
		URL:       strings.TrimRight(session.attachmentRoute, "/") + "/" + id,
		CreatedAt: time.Now(),
	}
	session.mu.Lock()
	session.attachments[id] = chatAttachment{
		ID:       id,
		Path:     path,
		FileName: name,
		Size:     size,
		MimeType: mimeType,
	}
	session.messages = append(session.messages, message)
	if len(session.messages) > maxChatHistory {
		session.messages = session.messages[len(session.messages)-maxChatHistory:]
	}
	session.notifyLocked()
	session.mu.Unlock()
	return message, nil
}

func (session *chatSession) addMessage(message chatMessage) chatMessage {
	session.mu.Lock()
	message.ID = session.nextMessageIDLocked()
	message.CreatedAt = time.Now()
	session.messages = append(session.messages, message)
	if len(session.messages) > maxChatHistory {
		session.messages = session.messages[len(session.messages)-maxChatHistory:]
	}
	session.notifyLocked()
	session.mu.Unlock()
	return message
}

func (session *chatSession) snapshot() []chatMessage {
	session.mu.Lock()
	defer session.mu.Unlock()
	return append([]chatMessage(nil), session.messages...)
}

func latestChatMessageID(messages []chatMessage) string {
	if len(messages) == 0 {
		return ""
	}
	return messages[len(messages)-1].ID
}

func (session *chatSession) recallMessage(id string, sender string) (chatMessage, bool) {
	session.mu.Lock()
	defer session.mu.Unlock()
	for index := range session.messages {
		if session.messages[index].ID != id {
			continue
		}
		if sender != "" && session.messages[index].Sender != sender {
			return chatMessage{}, false
		}
		session.messages[index].Recalled = true
		if session.messages[index].URL != "" {
			delete(session.attachments, id)
			session.messages[index].URL = ""
			session.messages[index].FileName = ""
			session.messages[index].Size = 0
			session.messages[index].MimeType = ""
		}
		session.notifyLocked()
		return session.messages[index], true
	}
	return chatMessage{}, false
}

func (session *chatSession) subscribe() (<-chan struct{}, func()) {
	ch := make(chan struct{}, 1)
	session.mu.Lock()
	session.subscribers[ch] = struct{}{}
	session.mu.Unlock()
	return ch, func() {
		session.mu.Lock()
		delete(session.subscribers, ch)
		close(ch)
		session.mu.Unlock()
	}
}

func (session *chatSession) notifyLocked() {
	for ch := range session.subscribers {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func (session *chatSession) nextMessageID() string {
	session.mu.Lock()
	defer session.mu.Unlock()
	return session.nextMessageIDLocked()
}

func (session *chatSession) nextMessageIDLocked() string {
	session.nextID++
	return strconv.FormatInt(time.Now().UnixNano(), 36) + "-" + strconv.FormatInt(session.nextID, 36)
}

func sanitizeChatSender(sender string) string {
	sender = strings.TrimSpace(sender)
	if sender == "" {
		return "Guest"
	}
	sender = strings.Join(strings.Fields(sender), " ")
	if len([]rune(sender)) > 40 {
		sender = string([]rune(sender)[:40])
	}
	return sender
}

func safeChatFilename(name string) string {
	name = strings.TrimSpace(strings.ReplaceAll(name, `\`, "/"))
	name = filepath.Base(name)
	if name == "" || name == "." || name == string(filepath.Separator) {
		return "attachment"
	}
	name = strings.Map(func(r rune) rune {
		switch r {
		case '/', '\\', ':', '*', '?', '"', '<', '>', '|':
			return '_'
		}
		if r < 32 {
			return '_'
		}
		return r
	}, name)
	if len([]rune(name)) > 180 {
		ext := filepath.Ext(name)
		base := strings.TrimSuffix(name, ext)
		runes := []rune(base)
		limit := 180 - len([]rune(ext))
		if limit < 1 {
			limit = 1
		}
		if len(runes) > limit {
			base = string(runes[:limit])
		}
		name = base + ext
	}
	return name
}

// filterMessagesAfter returns messages that come after the specified message ID.
// If the ID is not found, returns all messages.
func filterMessagesAfter(messages []chatMessage, afterID string) []chatMessage {
	for i, msg := range messages {
		if msg.ID == afterID {
			if i+1 < len(messages) {
				return messages[i+1:]
			}
			return []chatMessage{}
		}
	}
	return messages
}
