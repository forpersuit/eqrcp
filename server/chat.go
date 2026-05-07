package server

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image/png"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
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
	clients         map[string]chatClient
	nextID          int64
	dir             string
	attachmentRoute string
	startedAt       time.Time
	lastActivity    time.Time
	state           string
	eventSeq        int64
	statusSeq       int64
	hostToken       string
	statusHook      func(ChatStatusSnapshot)
}

// ChatStatusSnapshot represents the current state of a chat session.
type ChatStatusSnapshot struct {
	State        string    `json:"state"` // "waiting", "active", "ended", "stopped", "failed", "replaced"
	MessageCount int       `json:"messageCount"`
	DeviceCount  int       `json:"deviceCount"`
	StartedAt    time.Time `json:"startedAt"`
	LastActivity time.Time `json:"lastActivity"`
	Seq          int64     `json:"seq"`
}

type chatMessage struct {
	ID         string    `json:"id"`
	Sender     string    `json:"sender"`
	Type       string    `json:"type"`
	Text       string    `json:"text,omitempty"`
	Recalled   bool      `json:"recalled,omitempty"`
	FileName   string    `json:"fileName,omitempty"`
	Size       int64     `json:"size,omitempty"`
	MimeType   string    `json:"mimeType,omitempty"`
	URL        string    `json:"url,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
	Seq        int64     `json:"seq,omitempty"`
	createdSeq int64
	ownerToken string
}

type chatAttachment struct {
	ID       string
	Path     string
	FileName string
	Size     int64
	MimeType string
}

type chatClient struct {
	Label    string    `json:"label"`
	Count    int       `json:"count"`
	LastSeen time.Time `json:"lastSeen"`
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
		clients:         map[string]chatClient{},
		dir:             dir,
		attachmentRoute: attachmentsRoute,
		startedAt:       time.Now(),
		lastActivity:    time.Now(),
		state:           "waiting",
		hostToken:       randomChatToken(),
		statusHook:      s.chatStatusHook,
	}
	session.notifyStatus("waiting")
	qrImg, err := qr.RenderImage(s.ChatURL)
	if err != nil {
		os.RemoveAll(dir)
		return err
	}
	s.statusMu.Lock()
	s.chatDir = dir
	s.chatSession = session
	s.statusMu.Unlock()
	s.setStatus("waiting", "Chat session waiting for a device to connect.")
	session.addMessageWithStatus(chatMessage{
		Sender: "system",
		Type:   "system",
		Text:   "Chat session started.",
	}, "waiting")
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
		w.Header().Set("Content-Type", "image/png")
		if err := png.Encode(w, qrImg); err != nil {
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
			HostToken        string
			CanStop          bool
			Version          string
		}{
			URL:              s.ChatURL,
			QRImageRoute:     imageRoute,
			EventsRoute:      eventsRoute,
			MessagesRoute:    messagesRoute,
			AttachmentsRoute: attachmentsRoute,
			StopRoute:        stopRoute,
			HealthRoute:      healthRoute,
			HostToken:        session.hostToken,
			CanStop:          session.validHostToken(r.URL.Query().Get("hostToken")),
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
		if rejectCrossOriginChat(w, r) {
			return
		}
		if !session.validHostToken(chatHostTokenFromRequest(r)) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		session.addSystemMessage("Chat session stopped.")
		session.end("stopped")
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
		eventSeq := session.eventSeq
		deviceCount := len(session.clients)
		devices := session.deviceRosterLocked()
		state := session.state
		startedAt := session.startedAt
		lastActivity := session.lastActivity
		session.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":       "ok",
			"timestamp":    time.Now().Unix(),
			"messageCount": messageCount,
			"eventSeq":     eventSeq,
			"deviceCount":  deviceCount,
			"devices":      devices,
			"state":        state,
			"startedAt":    startedAt,
			"lastActivity": lastActivity,
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
	if rejectCrossOriginChat(w, r) {
		return
	}
	id := strings.TrimPrefix(r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:], "/")
	var request struct {
		Sender string `json:"sender"`
		Token  string `json:"token"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&request)
	}
	if session.isTerminal() {
		writeChatTerminal(w)
		return
	}
	message, ok := session.recallMessage(id, sanitizeChatSender(request.Sender), request.Token)
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
	return s.DisplayChatWithURL(func() string {
		return s.ChatURL + "?peer=desktop&hostToken=" + url.QueryEscape(s.ChatHostToken())
	})
}

// DisplayChatWithURL serves the chat page and opens the provided URL in the browser.
func (s *Server) DisplayChatWithURL(browserURL func() string) error {
	if err := s.Chat(); err != nil {
		return err
	}
	if browserURL == nil {
		return nil
	}
	return openBrowser(browserURL())
}

// ChatHostToken returns the hostToken for the current chat session, or empty string if none.
func (s *Server) ChatHostToken() string {
	s.statusMu.Lock()
	defer s.statusMu.Unlock()
	if s.chatSession != nil {
		return s.chatSession.hostToken
	}
	return ""
}

func (session *chatSession) handleMessages(w http.ResponseWriter, r *http.Request) {
	if handleChatCORS(w, r, http.MethodGet, http.MethodPost) {
		return
	}
	switch r.Method {
	case http.MethodGet:
		afterSeq, hasAfterSeq := chatEventCursorFromRequest(r, "afterSeq")
		joinSeq, hasJoinSeq := chatEventCursorFromRequest(r, "joinSeq")
		if !hasJoinSeq {
			joinSeq = afterSeq
		}
		w.Header().Set("Content-Type", "application/json")
		if hasAfterSeq {
			messages, currentSeq := session.snapshotAfterSeq(joinSeq, afterSeq)
			w.Header().Set("X-Eqrcp-Chat-Seq", strconv.FormatInt(currentSeq, 10))
			if err := json.NewEncoder(w).Encode(messages); err != nil {
				log.Println(err)
			}
			return
		}
		if err := json.NewEncoder(w).Encode(session.snapshot()); err != nil {
			log.Println(err)
		}
	case http.MethodPost:
		if rejectCrossOriginChat(w, r) {
			return
		}
		var request struct {
			Sender string `json:"sender"`
			Text   string `json:"text"`
			Token  string `json:"token"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&request); err != nil {
			http.Error(w, "invalid message", http.StatusBadRequest)
			return
		}
		if session.isTerminal() {
			writeChatTerminal(w)
			return
		}
		if strings.TrimSpace(request.Token) == "" {
			http.Error(w, "missing token", http.StatusBadRequest)
			return
		}
		message := session.addTextMessage(sanitizeChatSender(request.Sender), request.Token, request.Text)
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
	if rejectCrossOriginChat(w, r) {
		return
	}
	if session.isTerminal() {
		writeChatTerminal(w)
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
	token := strings.TrimSpace(r.FormValue("token"))
	if token == "" {
		http.Error(w, "missing token", http.StatusBadRequest)
		return
	}
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
		message, err := session.saveAttachment(sender, token, safeChatFilename(header.Filename), header.Header.Get("Content-Type"), header.Size, file)
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
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.URL.Query().Get("download") == "1" || !safeInlineChatMime(attachment.MimeType) {
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

	seenSeq, hasCursor := chatEventCursorFromRequest(r, "afterSeq", "Last-Event-ID")
	joinSeq, hasJoinSeq := chatEventCursorFromRequest(r, "joinSeq")
	if !hasCursor {
		// New devices join at the current event boundary. They do not receive
		// earlier session history, but they will receive later changes.
		seenSeq = session.currentEventSeq()
	}
	if !hasJoinSeq {
		joinSeq = seenSeq
	}
	unregisterClient := session.registerClient(r.URL.Query().Get("token"), r.URL.Query().Get("label"), r.RemoteAddr)
	defer unregisterClient()

	write := func() bool {
		toSend, currentSeq := session.snapshotAfterSeq(joinSeq, seenSeq)
		data, err := json.Marshal(toSend)
		if err != nil {
			return false
		}
		if _, err := fmt.Fprintf(w, "id: %d\n", currentSeq); err != nil {
			return false
		}
		if _, err := fmt.Fprintf(w, "data: %s\n\n", data); err != nil {
			return false
		}
		seenSeq = currentSeq
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

func (session *chatSession) registerClient(token string, label string, fallback string) func() {
	client := strings.TrimSpace(token)
	if client == "" {
		client = strings.TrimSpace(fallback)
	}
	if client == "" {
		return func() {}
	}
	session.mu.Lock()
	if session.clients == nil {
		session.clients = map[string]chatClient{}
	}
	info := session.clients[client]
	info.Count++
	info.Label = sanitizeChatSender(label)
	info.LastSeen = time.Now()
	session.clients[client] = info
	nextState := session.state
	if len(session.clients) > 1 && !isTerminalChatState(session.state) {
		nextState = "active"
	}
	hook, snapshot := session.statusSnapshotLocked(nextState)
	session.mu.Unlock()
	notifyChatStatusHook(hook, snapshot)
	return func() {
		session.mu.Lock()
		info := session.clients[client]
		if info.Count <= 1 {
			delete(session.clients, client)
		} else {
			info.Count--
			info.LastSeen = time.Now()
			session.clients[client] = info
		}
		hook, snapshot := session.statusSnapshotLocked(session.state)
		session.mu.Unlock()
		notifyChatStatusHook(hook, snapshot)
	}
}

func (session *chatSession) deviceRosterLocked() []chatClient {
	devices := make([]chatClient, 0, len(session.clients))
	for _, client := range session.clients {
		if client.Label == "" {
			client.Label = "Guest"
		}
		devices = append(devices, client)
	}
	sort.SliceStable(devices, func(i, j int) bool {
		if devices[i].Label == devices[j].Label {
			return devices[i].LastSeen.Before(devices[j].LastSeen)
		}
		return devices[i].Label < devices[j].Label
	})
	return devices
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

func rejectCrossOriginChat(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}
	parsed, err := url.Parse(origin)
	if err != nil || (!strings.EqualFold(parsed.Host, r.Host) && !trustedWailsOrigin(parsed)) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return true
	}
	return false
}

func trustedWailsOrigin(parsed *url.URL) bool {
	host := strings.ToLower(parsed.Hostname())
	return parsed.Scheme == "wails" || host == "wails.localhost"
}

func (session *chatSession) addTextMessage(sender string, token string, text string) chatMessage {
	text = strings.TrimSpace(text)
	if text == "" {
		return chatMessage{}
	}
	return session.addMessageWithStatus(chatMessage{
		Sender:     sender,
		Type:       "text",
		Text:       text,
		ownerToken: strings.TrimSpace(token),
	}, "active")
}

func (session *chatSession) addSystemMessage(text string) chatMessage {
	return session.addMessageWithStatus(chatMessage{
		Sender: "system",
		Type:   "system",
		Text:   text,
	}, "")
}

func (session *chatSession) saveAttachment(sender string, token string, name string, mimeType string, size int64, reader io.Reader) (chatMessage, error) {
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
		ID:         id,
		Sender:     sender,
		Type:       messageType,
		FileName:   name,
		Size:       size,
		MimeType:   mimeType,
		URL:        strings.TrimRight(session.attachmentRoute, "/") + "/" + id,
		CreatedAt:  time.Now(),
		ownerToken: strings.TrimSpace(token),
	}
	session.mu.Lock()
	message.Seq = session.nextEventSeqLocked()
	message.createdSeq = message.Seq
	session.attachments[id] = chatAttachment{
		ID:       id,
		Path:     path,
		FileName: name,
		Size:     size,
		MimeType: mimeType,
	}
	session.messages = append(session.messages, message)
	session.trimHistoryLocked()
	session.lastActivity = time.Now()
	session.notifyLocked()
	hook, snapshot := session.statusSnapshotLocked("active")
	session.mu.Unlock()
	notifyChatStatusHook(hook, snapshot)
	return message, nil
}

func (session *chatSession) addMessage(message chatMessage) chatMessage {
	return session.addMessageWithStatus(message, "active")
}

func (session *chatSession) addMessageWithStatus(message chatMessage, statusState string) chatMessage {
	session.mu.Lock()
	message.ID = session.nextMessageIDLocked()
	message.CreatedAt = time.Now()
	message.Seq = session.nextEventSeqLocked()
	message.createdSeq = message.Seq
	session.messages = append(session.messages, message)
	session.trimHistoryLocked()
	session.lastActivity = time.Now()
	session.notifyLocked()
	var hook func(ChatStatusSnapshot)
	var snapshot ChatStatusSnapshot
	if statusState != "" {
		hook, snapshot = session.statusSnapshotLocked(statusState)
	}
	session.mu.Unlock()
	notifyChatStatusHook(hook, snapshot)
	return message
}

func (session *chatSession) snapshot() []chatMessage {
	session.mu.Lock()
	defer session.mu.Unlock()
	return append([]chatMessage(nil), session.messages...)
}

func (session *chatSession) snapshotAfterSeq(joinSeq int64, afterSeq int64) ([]chatMessage, int64) {
	session.mu.Lock()
	defer session.mu.Unlock()
	return messagesAfterSeq(session.messages, joinSeq, afterSeq), session.eventSeq
}

func (session *chatSession) currentEventSeq() int64 {
	session.mu.Lock()
	defer session.mu.Unlock()
	return session.eventSeq
}

func (session *chatSession) trimHistoryLocked() {
	if len(session.messages) <= maxChatHistory {
		return
	}
	pruned := append([]chatMessage(nil), session.messages[:len(session.messages)-maxChatHistory]...)
	session.messages = session.messages[len(session.messages)-maxChatHistory:]
	for _, message := range pruned {
		if message.URL == "" {
			continue
		}
		attachment, ok := session.attachments[message.ID]
		if !ok {
			continue
		}
		delete(session.attachments, message.ID)
		if attachment.Path != "" {
			_ = os.Remove(attachment.Path)
		}
	}
}

func messagesAfterSeq(messages []chatMessage, joinSeq int64, afterSeq int64) []chatMessage {
	if joinSeq < 0 {
		joinSeq = 0
	}
	if afterSeq < 0 {
		afterSeq = 0
	}
	var result []chatMessage
	for _, message := range messages {
		if message.Seq > afterSeq && message.createdSeq > joinSeq {
			result = append(result, message)
		}
	}
	if result == nil {
		return []chatMessage{}
	}
	return result
}

func (session *chatSession) recallMessage(id string, sender string, token string) (chatMessage, bool) {
	session.mu.Lock()
	defer session.mu.Unlock()
	for index := range session.messages {
		if session.messages[index].ID != id {
			continue
		}
		if session.messages[index].ownerToken != "" {
			if strings.TrimSpace(token) != session.messages[index].ownerToken {
				return chatMessage{}, false
			}
		} else if sender != "" && session.messages[index].Sender != sender {
			return chatMessage{}, false
		}
		session.messages[index].Recalled = true
		session.messages[index].Seq = session.nextEventSeqLocked()
		if session.messages[index].URL != "" {
			if attachment, ok := session.attachments[id]; ok && attachment.Path != "" {
				_ = os.Remove(attachment.Path)
			}
			delete(session.attachments, id)
			session.messages[index].URL = ""
			session.messages[index].FileName = ""
			session.messages[index].Size = 0
			session.messages[index].MimeType = ""
		}
		session.lastActivity = time.Now()
		session.notifyLocked()
		return session.messages[index], true
	}
	return chatMessage{}, false
}

func (session *chatSession) isTerminal() bool {
	session.mu.Lock()
	defer session.mu.Unlock()
	return isTerminalChatState(session.state)
}

func writeChatTerminal(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusGone)
	fmt.Fprintln(w, "This chat session has ended. Start a new eqrcp chat session to continue.")
}

func (session *chatSession) validHostToken(token string) bool {
	return session.hostToken != "" && token == session.hostToken
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

func (session *chatSession) notifyStatus(state string) {
	session.mu.Lock()
	hook, snapshot := session.statusSnapshotLocked(state)
	session.mu.Unlock()
	notifyChatStatusHook(hook, snapshot)
}

func (session *chatSession) statusSnapshotLocked(state string) (func(ChatStatusSnapshot), ChatStatusSnapshot) {
	if state != "" && !isTerminalChatState(session.state) {
		session.state = state
	}
	if state != "" {
		session.statusSeq++
	}
	snapshot := ChatStatusSnapshot{
		State:        session.state,
		MessageCount: len(session.messages),
		DeviceCount:  len(session.clients),
		StartedAt:    session.startedAt,
		LastActivity: session.lastActivity,
		Seq:          session.statusSeq,
	}
	return session.statusHook, snapshot
}

func notifyChatStatusHook(hook func(ChatStatusSnapshot), snapshot ChatStatusSnapshot) {
	if hook != nil {
		hook(snapshot)
	}
}

func (session *chatSession) end(state string) {
	if state == "" {
		state = "stopped"
	}
	session.mu.Lock()
	if isTerminalChatState(session.state) {
		session.mu.Unlock()
		return
	}
	hook, snapshot := session.statusSnapshotLocked(state)
	session.mu.Unlock()
	notifyChatStatusHook(hook, snapshot)
}

func isTerminalChatState(state string) bool {
	return state == "ended" || state == "stopped" || state == "failed" || state == "replaced"
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

func (session *chatSession) nextEventSeqLocked() int64 {
	session.eventSeq++
	return session.eventSeq
}

func chatEventCursorFromRequest(r *http.Request, names ...string) (int64, bool) {
	for _, name := range names {
		value := r.URL.Query().Get(name)
		if value == "" {
			value = r.Header.Get(name)
		}
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		seq, err := strconv.ParseInt(value, 10, 64)
		if err != nil || seq < 0 {
			continue
		}
		return seq, true
	}
	return 0, false
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

func chatHostTokenFromRequest(r *http.Request) string {
	if token := r.Header.Get("X-Eqrcp-Chat-Host-Token"); token != "" {
		return token
	}
	if token := r.URL.Query().Get("token"); token != "" {
		return token
	}
	if token := r.URL.Query().Get("hostToken"); token != "" {
		return token
	}
	if err := r.ParseForm(); err == nil {
		if token := r.FormValue("hostToken"); token != "" {
			return token
		}
	}
	return ""
}

func randomChatToken() string {
	var data [16]byte
	if _, err := rand.Read(data[:]); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return hex.EncodeToString(data[:])
}

func safeInlineChatMime(mimeType string) bool {
	mimeType = strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0]))
	if strings.HasPrefix(mimeType, "video/") {
		return true
	}
	if !strings.HasPrefix(mimeType, "image/") {
		return false
	}
	return mimeType != "image/svg+xml"
}
