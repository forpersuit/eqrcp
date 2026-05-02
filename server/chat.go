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
	mu          sync.Mutex
	messages    []chatMessage
	attachments map[string]chatAttachment
	subscribers map[chan struct{}]struct{}
	nextID      int64
	dir         string
}

type chatMessage struct {
	ID        string    `json:"id"`
	Sender    string    `json:"sender"`
	Type      string    `json:"type"`
	Text      string    `json:"text,omitempty"`
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
	session := &chatSession{
		attachments: map[string]chatAttachment{},
		subscribers: map[chan struct{}]struct{}{},
		dir:         dir,
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
		w.Header().Set("Content-Type", "image/jpeg")
		if err := jpeg.Encode(w, qrImg, nil); err != nil {
			log.Println(err)
		}
	})
	s.mux.HandleFunc(route, func(w http.ResponseWriter, r *http.Request) {
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
			Version          string
		}{
			URL:              s.ChatURL,
			QRImageRoute:     imageRoute,
			EventsRoute:      eventsRoute,
			MessagesRoute:    messagesRoute,
			AttachmentsRoute: attachmentsRoute,
			StopRoute:        stopRoute,
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
	return nil
}

func (s *Server) DisplayChat() error {
	if err := s.Chat(); err != nil {
		return err
	}
	return openBrowser(s.ChatURL + "?peer=desktop")
}

func (session *chatSession) handleMessages(w http.ResponseWriter, r *http.Request) {
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
		message := session.addTextMessage(normalizeChatSender(request.Sender), request.Text)
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
	sender := normalizeChatSender(r.FormValue("sender"))
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
		message, err := session.saveAttachment(sender, filepath.Base(header.Filename), header.Header.Get("Content-Type"), header.Size, file)
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
	w.Header().Set("Content-Disposition", contentDisposition(attachment.FileName))
	if attachment.MimeType != "" {
		w.Header().Set("Content-Type", attachment.MimeType)
	}
	http.ServeFile(w, r, attachment.Path)
}

func (session *chatSession) handleEvents(w http.ResponseWriter, r *http.Request) {
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
	write := func() bool {
		if _, err := fmt.Fprint(w, "data: "); err != nil {
			return false
		}
		if err := json.NewEncoder(w).Encode(session.snapshot()); err != nil {
			return false
		}
		if _, err := fmt.Fprint(w, "\n"); err != nil {
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
	if mimeType == "" {
		mimeType = mime.TypeByExtension(filepath.Ext(name))
	}
	messageType := "file"
	if strings.HasPrefix(mimeType, "image/") {
		messageType = "image"
	}
	message := chatMessage{
		ID:        id,
		Sender:    sender,
		Type:      messageType,
		FileName:  name,
		Size:      size,
		MimeType:  mimeType,
		URL:       "attachments/" + id,
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

func normalizeChatSender(sender string) string {
	switch strings.ToLower(strings.TrimSpace(sender)) {
	case "desktop":
		return "desktop"
	case "mobile":
		return "mobile"
	default:
		return "guest"
	}
}
