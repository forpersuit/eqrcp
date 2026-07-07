package server

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image/png"
	"io"
	"log"
	"math/big"
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

	"eqt/pkg/pages"
	"eqt/pkg/qr"
	"eqt/pkg/version"
	chatv2http "eqt/pkg/chat/v2/http"

	"github.com/tus/tusd/v2/pkg/filestore"
	tusd "github.com/tus/tusd/v2/pkg/handler"
)

const (
	maxChatHistory     = 200
	defaultChatThemeID = "theme-0"
	maxChatThemeSeed   = int64(1<<31 - 1)
	maxChatDebugBytes  = 64 << 10
)

type chatSession struct {
	mu               sync.Mutex
	messages         []chatMessage
	attachments      map[string]chatAttachment
	subscribers      map[chan struct{}]struct{}
	clients          map[string]chatClient
	clientIDs        map[string]string
	kickedClients    map[string]struct{}
	clientThemes     map[string]string
	clientThemeJoins map[string]string
	nextID           int64
	dir              string
	viewportDebugLog string
	attachmentRoute  string
	startedAt        time.Time
	lastActivity     time.Time
	state            string
	eventSeq         int64
	statusSeq        int64
	hostToken        string
	statusHook       func(ChatStatusSnapshot)
	hostRenameHook   func(string)

	tusHandler       *tusd.Handler
	tusUploadsDone   map[string]int64
	tusUploadsTotal  map[string]int64
	tusUploadClients map[string]string
	tusMu            sync.Mutex
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
	Avatar     string    `json:"avatar,omitempty"`
	Type       string    `json:"type"`
	Text       string    `json:"text,omitempty"`
	Recalled   bool      `json:"recalled,omitempty"`
	FileName   string    `json:"fileName,omitempty"`
	Size       int64     `json:"size,omitempty"`
	MimeType   string    `json:"mimeType,omitempty"`
	URL        string    `json:"url,omitempty"`
	Theme      string    `json:"theme,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
	Seq        int64     `json:"seq,omitempty"`
	createdSeq int64
	ownerToken string
	SenderID   string  `json:"senderId,omitempty"`
	Sending    bool    `json:"sending,omitempty"`
	Progress   int     `json:"progress,omitempty"`
	Receiving  bool    `json:"receiving,omitempty"`
	Duration   float64 `json:"duration,omitempty"`
	Width      int     `json:"width,omitempty"`
	Height     int     `json:"height,omitempty"`
}

type chatAttachment struct {
	ID       string
	Path     string
	FileName string
	Size     int64
	MimeType string
}

type chatClient struct {
	ID       string    `json:"id,omitempty"`
	Label    string    `json:"label"`
	Avatar   string    `json:"avatar,omitempty"`
	Count    int       `json:"count"`
	Theme    string    `json:"theme,omitempty"`
	LastSeen time.Time `json:"lastSeen"`
}

// Chat adds handlers for a browser-based chat session.
func (s *Server) Chat() error {
	s.statusMu.Lock()
	if s.chatSession != nil {
		s.statusMu.Unlock()
		return nil
	}
	s.statusMu.Unlock()

	dir, err := os.MkdirTemp("", "eqt-chat-*")
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
	clientsRoute := route + "/clients"
	stopRoute := route + "/stop"
	healthRoute := route + "/health"
	viewportDebugRoute := route + "/viewport-debug"
	payRoute := route + "/pay"
	viewportDebugLog := chatViewportDebugLogPath()
	tusTmpDir := filepath.Join(dir, ".tus-tmp")
	_ = os.MkdirAll(tusTmpDir, 0755)

	store := filestore.New(tusTmpDir)
	composer := tusd.NewStoreComposer()
	store.UseIn(composer)

	tusBasePath := attachmentsRoute + "/tus/"
	tusHandler, err := tusd.NewHandler(tusd.Config{
		BasePath:               tusBasePath,
		StoreComposer:          composer,
		NotifyUploadProgress:   true,
		NotifyCompleteUploads:  true,
		UploadProgressInterval: 200 * time.Millisecond,
	})
	if err != nil {
		os.RemoveAll(dir)
		return err
	}

	session := &chatSession{
		attachments:      map[string]chatAttachment{},
		subscribers:      map[chan struct{}]struct{}{},
		clients:          map[string]chatClient{},
		clientIDs:        map[string]string{},
		kickedClients:    map[string]struct{}{},
		clientThemes:     map[string]string{},
		clientThemeJoins: map[string]string{},
		dir:              dir,
		viewportDebugLog: viewportDebugLog,
		attachmentRoute:  attachmentsRoute,
		startedAt:        time.Now(),
		lastActivity:     time.Now(),
		state:            "waiting",
		hostToken:        randomChatToken(),
		statusHook:       s.chatStatusHook,
		hostRenameHook:   s.chatHostRenameHook,
		tusHandler:       tusHandler,
		tusUploadsDone:   make(map[string]int64),
		tusUploadsTotal:  make(map[string]int64),
		tusUploadClients: make(map[string]string),
	}

	copyFile := func(src, dst string) error {
		in, err := os.Open(src)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.Create(dst)
		if err != nil {
			return err
		}
		defer out.Close()
		_, err = io.Copy(out, in)
		return err
	}

	// Listen to chat tus progress channel
	go func() {
		for event := range tusHandler.UploadProgress {
			messageID := event.Upload.MetaData["messageid"]
			if messageID == "" {
				continue
			}
			progressPercent := int(float64(event.Upload.Offset) / float64(event.Upload.Size) * 100)
			_, _ = session.updateUploadProgressMessage(messageID, progressPercent)
		}
	}()

	// Listen to chat tus complete channel
	go func() {
		for info := range tusHandler.CompleteUploads {
			filename := info.Upload.MetaData["filename"]
			messageID := info.Upload.MetaData["messageid"]
			sender := sanitizeChatSender(info.Upload.MetaData["sender"])
			avatar := sanitizeChatAvatar(info.Upload.MetaData["avatar"])
			token := info.Upload.MetaData["token"]
			theme := info.Upload.MetaData["theme"]
			join := info.Upload.MetaData["join"]

			if messageID == "" || filename == "" {
				continue
			}

			storedName := messageID + "-" + safeChatFilename(filename)
			finalPath := filepath.Join(session.dir, storedName)
			tmpPath := info.Upload.Storage["Path"]

			if err := os.Rename(tmpPath, finalPath); err != nil {
				if err := copyFile(tmpPath, finalPath); err == nil {
					_ = os.Remove(tmpPath)
				} else {
					log.Printf("Chat Tus complete: failed to save attachment: %v\n", err)
					continue
				}
			} else {
				_ = os.Remove(tmpPath)
			}

			mimeType := info.Upload.MetaData["mime"]
			if mimeType == "" {
				mimeType = mime.TypeByExtension(filepath.Ext(filename))
			}

			var duration float64
			if dVal := info.Upload.MetaData["duration"]; dVal != "" {
				duration, _ = strconv.ParseFloat(dVal, 64)
			}
			var width int
			if wVal := info.Upload.MetaData["width"]; wVal != "" {
				width, _ = strconv.Atoi(wVal)
			}
			var height int
			if hVal := info.Upload.MetaData["height"]; hVal != "" {
				height, _ = strconv.Atoi(hVal)
			}

			session.ensureChatTheme(token, sender, "", theme, join)

			_, _ = session.registerTusAttachment(
				sender,
				avatar,
				token,
				filename,
				mimeType,
				info.Upload.Size,
				finalPath,
				messageID,
				duration,
				width,
				height,
			)
		}
	}()

	limiterInstance.mu.Lock()
	limiterInstance.activeSession = session
	limiterInstance.mu.Unlock()
	session.notifyStatus("waiting")
	qrImg, err := qr.RenderImage(s.ChatJoinURL())
	if err != nil {
		os.RemoveAll(dir)
		return err
	}
	var qrBuf bytes.Buffer
	if err := png.Encode(&qrBuf, qrImg); err != nil {
		os.RemoveAll(dir)
		return err
	}
	qrBytes := qrBuf.Bytes()
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
		status.Target = s.ChatJoinURL()
		status.Message = "Scan to join this chat session."
	})
	s.mux.HandleFunc(imageRoute, func(w http.ResponseWriter, r *http.Request) {
		if handleChatCORS(w, r, http.MethodGet) {
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Content-Length", strconv.Itoa(len(qrBytes)))
		_, _ = w.Write(qrBytes)
	})
	chatV2Handler := chatv2http.NewHandler(chatv2http.Config{
		BasePath: "/chat-v2",
		Logger:   nil,
		IsPaidOrUnrestricted: func() bool {
			usage := limiterInstance.GetStatus()
			return usage.IsPaid || usage.UsedSeconds < 300
		},
	})
	s.mux.Handle("/chat-v2/", chatV2Handler)

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
		licenseTierDisplay := ""
		rawTier := GetLicenseTier()
		codeDate := GetCodeDate()
		if rawTier != "" {
			switch rawTier {
			case "PLUS":
				if codeDate == "LIFETIME" {
					licenseTierDisplay = "PLUS U"
				} else {
					licenseTierDisplay = "PLUS"
				}
			case "PRO":
				licenseTierDisplay = "PRO"
			default:
				licenseTierDisplay = strings.ToUpper(rawTier)
			}
		}

		variables := struct {
			URL                string
			QRImageRoute       string
			EventsRoute        string
			MessagesRoute      string
			AttachmentsRoute   string
			ClientsRoute       string
			StopRoute          string
			HealthRoute        string
			ViewportDebugRoute string
			HostToken          string
			CanStop            bool
			Version            string
			PayRoute           string
			LicenseTier        string
		}{
			URL:                s.ChatJoinURL(),
			QRImageRoute:       imageRoute,
			EventsRoute:        eventsRoute,
			MessagesRoute:      messagesRoute,
			AttachmentsRoute:   attachmentsRoute,
			ClientsRoute:       clientsRoute,
			StopRoute:          stopRoute,
			HealthRoute:        healthRoute,
			ViewportDebugRoute: viewportDebugRoute,
			HostToken:          session.hostToken,
			CanStop:            session.validHostToken(r.URL.Query().Get("hostToken")),
			Version:            version.String(),
			PayRoute:           payRoute,
			LicenseTier:        licenseTierDisplay,
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
	s.mux.HandleFunc(attachmentsRoute+"/tus/", session.handleTusUpload)
	s.mux.HandleFunc(attachmentsRoute+"/local", session.handleLocalAttachmentRegister)
	s.mux.HandleFunc(attachmentsRoute+"/", session.handleAttachmentDownload)
	s.mux.HandleFunc(clientsRoute+"/", session.handleClientAction)
	s.mux.HandleFunc(viewportDebugRoute, session.handleViewportDebug)
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
		if session.rejectKickedClient(w, r.URL.Query().Get("token")) {
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
		token := r.URL.Query().Get("token")
		var clientID string
		if client, ok := session.clients[token]; ok {
			clientID = client.ID
		} else {
			clientID = session.clientIDLocked(token)
		}
		theme := session.chatThemeForClientLocked(token, r.URL.Query().Get("label"), r.URL.Query().Get("peer"), r.URL.Query().Get("theme"), r.URL.Query().Get("join"))
		session.mu.Unlock()
		usage := limiterInstance.GetStatus()
		licenseTierDisplay := ""
		if usage.LicenseTier != "" {
			switch usage.LicenseTier {
			case "PLUS":
				if usage.CodeDate == "LIFETIME" {
					licenseTierDisplay = "PLUS U"
				} else {
					licenseTierDisplay = "PLUS"
				}
			case "PRO":
				licenseTierDisplay = "PRO"
			default:
				licenseTierDisplay = strings.ToUpper(usage.LicenseTier)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]interface{}{
			"status":        "ok",
			"timestamp":     time.Now().Unix(),
			"messageCount":  messageCount,
			"eventSeq":      eventSeq,
			"deviceCount":   deviceCount,
			"devices":       devices,
			"state":         state,
			"theme":         theme,
			"clientId":      clientID,
			"startedAt":     startedAt,
			"lastActivity":  lastActivity,
			"usedSeconds":   usage.UsedSeconds,
			"isPaid":        usage.IsPaid,
			"licenseTier":   licenseTierDisplay,
			"clockTampered": usage.ClockTampered,
			"viewportDebug": s.ViewportDebug,
		}); err != nil {
			log.Println(err)
		}
	})

	s.mux.HandleFunc(payRoute, func(w http.ResponseWriter, r *http.Request) {
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
		var req struct {
			Pay bool `json:"pay"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		tier := ""
		if req.Pay {
			tier = "PRO"
		}
		usage := limiterInstance.SetPaidDetails(req.Pay, time.Now().Format(time.RFC3339), "WEBPAY", tier)
		session.mu.Lock()
		session.notifyLocked()
		session.mu.Unlock()

		licenseTierDisplay := ""
		if usage.LicenseTier != "" {
			switch usage.LicenseTier {
			case "PLUS":
				if usage.CodeDate == "LIFETIME" {
					licenseTierDisplay = "PLUS U"
				} else {
					licenseTierDisplay = "PLUS"
				}
			case "PRO":
				licenseTierDisplay = "PRO"
			default:
				licenseTierDisplay = strings.ToUpper(usage.LicenseTier)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"status":      "ok",
			"isPaid":      usage.IsPaid,
			"usedSeconds": usage.UsedSeconds,
			"licenseTier": licenseTierDisplay,
		})
	})

	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			if session.isTerminal() {
				return
			}
			session.mu.Lock()
			clientCount := len(session.clients)
			session.mu.Unlock()
			if clientCount > 0 {
				usage, limitReached := limiterInstance.IncrementUsage(2)
				if limitReached && !usage.IsPaid {
					session.mu.Lock()
					session.notifyLocked()
					session.mu.Unlock()
				}
			}
		}
	}()

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
	if session.rejectKickedClient(w, request.Token) {
		return
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

func (session *chatSession) handleClientAction(w http.ResponseWriter, r *http.Request) {
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
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 3 {
		http.NotFound(w, r)
		return
	}
	action := parts[len(parts)-1]
	id := parts[len(parts)-2]

	if action == "kick" {
		if !session.validHostToken(chatHostTokenFromRequest(r)) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		if !session.kickClient(id) {
			http.Error(w, "device not found or cannot be kicked", http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusAccepted)
		fmt.Fprintln(w, "Device forced offline.")
		return
	}

	if action == "rename" {
		var request struct {
			Token string `json:"token"`
			Label string `json:"label"`
		}
		if r.Body != nil {
			_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&request)
		}
		request.Token = strings.TrimSpace(request.Token)
		trimmedLabel := strings.Join(strings.Fields(request.Label), " ")
		if request.Token == "" || trimmedLabel == "" {
			http.Error(w, "invalid token or name", http.StatusBadRequest)
			return
		}
		request.Label = sanitizeChatSender(request.Label)

		var shouldTriggerHostRename bool
		var newHostName string

		session.mu.Lock()
		client, exists := session.clients[request.Token]
		if !exists || client.ID != id {
			session.mu.Unlock()
			http.Error(w, "forbidden or device not found", http.StatusForbidden)
			return
		}

		oldLabel := client.Label
		if oldLabel != request.Label {
			client.Label = request.Label
			session.clients[request.Token] = client
			session.addSystemMessageLocked(oldLabel + " has been renamed to " + request.Label)
			session.notifyLocked()

			if session.validHostToken(request.Token) {
				shouldTriggerHostRename = true
				newHostName = request.Label
			}
		}
		hook, snapshot := session.statusSnapshotLocked(session.state)
		session.mu.Unlock()

		notifyChatStatusHook(hook, snapshot)

		if shouldTriggerHostRename && session.hostRenameHook != nil {
			session.hostRenameHook(newHostName)
		}

		w.WriteHeader(http.StatusOK)
		fmt.Fprintln(w, "Rename success")
		return
	}

	http.NotFound(w, r)
}

func (session *chatSession) handleViewportDebug(w http.ResponseWriter, r *http.Request) {
	if handleChatCORS(w, r, http.MethodGet, http.MethodPost) {
		return
	}
	switch r.Method {
	case http.MethodGet:
		w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
		http.ServeFile(w, r, session.viewportDebugLog)
	case http.MethodPost:
		if rejectCrossOriginChat(w, r) {
			return
		}
		defer r.Body.Close()
		var payload map[string]interface{}
		decoder := json.NewDecoder(io.LimitReader(r.Body, maxChatDebugBytes))
		decoder.UseNumber()
		if err := decoder.Decode(&payload); err != nil {
			http.Error(w, "invalid debug payload", http.StatusBadRequest)
			return
		}
		payload["serverTime"] = time.Now().Format(time.RFC3339Nano)
		payload["remoteAddr"] = r.RemoteAddr
		line, err := json.Marshal(payload)
		if err != nil {
			http.Error(w, "invalid debug payload", http.StatusBadRequest)
			return
		}
		session.mu.Lock()
		defer session.mu.Unlock()
		if err := appendChatViewportDebugLine(session.viewportDebugLog, line); err != nil {
			http.Error(w, "debug log unavailable", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintln(w, `{"status":"ok"}`)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func chatViewportDebugLogPath() string {
	name := "viewport-debug-" + time.Now().Format("20060102-150405.000000000") + "-" + randomChatToken()[:8] + ".ndjson"
	return filepath.Join(os.TempDir(), "eqt-viewport-debug", name)
}

func appendChatViewportDebugLine(path string, line []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return err
	}
	if _, err := file.Write(append(line, '\n')); err != nil {
		file.Close()
		return err
	}
	return file.Close()
}

func (s *Server) DisplayChat() error {
	return s.DisplayChatWithURL(func() string {
		return appendChatQuery(s.ChatJoinURL(), map[string]string{
			"peer":      "desktop",
			"hostToken": s.ChatHostToken(),
		})
	})
}

// ChatJoinURL returns the user-facing chat URL, including debug query
// parameters when the application is running in development mode.
func (s *Server) ChatJoinURL() string {
	chatURL := s.ChatURL
	if s.EnableChatV2 {
		chatURL = strings.Replace(chatURL, "/chat/", "/chat-v2/", 1)
	}
	if !s.ViewportDebug {
		return chatURL
	}
	return appendChatQuery(chatURL, map[string]string{"viewportDebug": "1"})
}

func appendChatQuery(baseURL string, values map[string]string) string {
	parsed, err := url.Parse(baseURL)
	if err != nil {
		sep := "?"
		if strings.Contains(baseURL, "?") {
			sep = "&"
		}
		parts := make([]string, 0, len(values))
		for key, value := range values {
			if value == "" {
				continue
			}
			parts = append(parts, url.QueryEscape(key)+"="+url.QueryEscape(value))
		}
		sort.Strings(parts)
		if len(parts) == 0 {
			return baseURL
		}
		return baseURL + sep + strings.Join(parts, "&")
	}
	params := parsed.Query()
	for key, value := range values {
		if value == "" {
			continue
		}
		params.Set(key, value)
	}
	parsed.RawQuery = params.Encode()
	return parsed.String()
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
			w.Header().Set("X-Eqt-Chat-Seq", strconv.FormatInt(currentSeq, 10))
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
		usage := limiterInstance.GetStatus()
		if !usage.IsPaid && usage.UsedSeconds >= 300 {
			// Experience degradation instead of hard lock: 30% message send failure rate.
			nBig, err := rand.Int(rand.Reader, big.NewInt(100))
			if err == nil && nBig.Int64() < 30 {
				http.Error(w, "Message failed to send (free tier limit reached). Please retry.", http.StatusInternalServerError)
				return
			}
		}
		var request struct {
			Sender   string  `json:"sender"`
			Avatar   string  `json:"avatar"`
			Text     string  `json:"text"`
			Token    string  `json:"token"`
			Theme    string  `json:"theme"`
			Join     string  `json:"join"`
			TempID   string  `json:"tempId,omitempty"`
			Type     string  `json:"type,omitempty"`
			FileName string  `json:"fileName,omitempty"`
			Size     int64   `json:"size,omitempty"`
			Progress int     `json:"progress,omitempty"`
			Sending  bool    `json:"sending,omitempty"`
			Duration float64 `json:"duration,omitempty"`
			Width    int     `json:"width,omitempty"`
			Height   int     `json:"height,omitempty"`
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
		if session.rejectKickedClient(w, request.Token) {
			return
		}

		if request.Sending && request.Type != "" && request.Progress == 0 {
			session.ensureChatTheme(request.Token, request.Sender, "", request.Theme, request.Join)
			message := session.addUploadPlaceholderMessage(
				sanitizeChatSender(request.Sender),
				sanitizeChatAvatar(request.Avatar),
				request.Token,
				request.Type,
				request.FileName,
				request.Size,
				request.TempID,
				request.Duration,
				request.Width,
				request.Height,
			)
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode(message); err != nil {
				log.Println(err)
			}
			return
		}

		if request.TempID != "" && request.Progress > 0 {
			message, ok := session.updateUploadProgressMessage(request.TempID, request.Progress)
			if !ok {
				http.Error(w, "placeholder message not found", http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode(message); err != nil {
				log.Println(err)
			}
			return
		}

		session.ensureChatTheme(request.Token, request.Sender, "", request.Theme, request.Join)
		message := session.addTextMessageWithAvatar(sanitizeChatSender(request.Sender), sanitizeChatAvatar(request.Avatar), request.Token, request.Text)
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
	usage := limiterInstance.GetStatus()
	isFreeLimitExceeded := !usage.IsPaid && usage.UsedSeconds >= 300
	var reqBody io.ReadCloser = r.Body
	if isFreeLimitExceeded {
		reqBody = &ThrottledReadCloser{
			Reader: &ThrottledReader{
				r:      r.Body,
				limit:  100 * 1024,
				active: true,
			},
			Closer: r.Body,
		}
	}
	r.Body = http.MaxBytesReader(w, reqBody, maxUploadBytes)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		http.Error(w, "upload failed", http.StatusBadRequest)
		return
	}
	if r.MultipartForm != nil {
		defer func() {
			_ = r.MultipartForm.RemoveAll()
		}()
	}
	sender := sanitizeChatSender(r.FormValue("sender"))
	avatar := sanitizeChatAvatar(r.FormValue("avatar"))
	token := strings.TrimSpace(r.FormValue("token"))
	tempID := strings.TrimSpace(r.FormValue("tempId"))

	var duration float64
	if dVal := r.FormValue("duration"); dVal != "" {
		duration, _ = strconv.ParseFloat(dVal, 64)
	}
	var width int
	if wVal := r.FormValue("width"); wVal != "" {
		width, _ = strconv.Atoi(wVal)
	}
	var height int
	if hVal := r.FormValue("height"); hVal != "" {
		height, _ = strconv.Atoi(hVal)
	}

	if token == "" {
		http.Error(w, "missing token", http.StatusBadRequest)
		return
	}
	if session.rejectKickedClient(w, token) {
		return
	}
	session.ensureChatTheme(token, sender, "", r.FormValue("theme"), r.FormValue("join"))
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
		if isFreeLimitExceeded && header.Size > 2*1024*1024 {
			file.Close()
			http.Error(w, "File size exceeds 2MB free limit. Please upgrade.", http.StatusRequestEntityTooLarge)
			return
		}
		message, err := session.saveAttachmentWithAvatar(sender, avatar, token, safeChatFilename(header.Filename), header.Header.Get("Content-Type"), header.Size, file, tempID, duration, width, height)
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

	usage := limiterInstance.GetStatus()
	isFreeLimitExceeded := !usage.IsPaid && usage.UsedSeconds >= 300

	if isFreeLimitExceeded {
		file, err := os.Open(attachment.Path)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer file.Close()

		// Limit to 100 KB/s (102400 bytes/sec)
		throttled := &ThrottledReader{
			r:      file,
			limit:  100 * 1024,
			active: true,
		}

		w.Header().Set("Content-Length", strconv.FormatInt(attachment.Size, 10))
		_, _ = io.Copy(w, throttled)
		return
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
	if session.rejectKickedClient(w, r.URL.Query().Get("token")) {
		return
	}
	if !hasCursor {
		// New devices join at the current event boundary. They do not receive
		// earlier session history, but they will receive later changes.
		seenSeq = session.currentEventSeq()
	}
	if !hasJoinSeq {
		joinSeq = seenSeq
	}
	clientToken := r.URL.Query().Get("token")
	unregisterClient := session.registerClientWithAvatar(r.URL.Query().Get("token"), r.URL.Query().Get("label"), r.URL.Query().Get("avatar"), r.URL.Query().Get("peer"), r.URL.Query().Get("theme"), r.URL.Query().Get("join"), r.RemoteAddr)
	defer unregisterClient()

	write := func() bool {
		if session.clientKicked(clientToken) {
			return false
		}
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

func (session *chatSession) clientKicked(token string) bool {
	token = strings.TrimSpace(token)
	if token == "" {
		return false
	}
	session.mu.Lock()
	defer session.mu.Unlock()
	_, kicked := session.kickedClients[token]
	return kicked
}

func (session *chatSession) registerClient(token string, label string, peer string, preferredTheme string, join string, fallback string) func() {
	return session.registerClientWithAvatar(token, label, "", peer, preferredTheme, join, fallback)
}

func (session *chatSession) registerClientWithAvatar(token string, label string, avatar string, peer string, preferredTheme string, join string, fallback string) func() {
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
	if session.clientIDs == nil {
		session.clientIDs = map[string]string{}
	}
	if session.kickedClients == nil {
		session.kickedClients = map[string]struct{}{}
	}
	if _, kicked := session.kickedClients[client]; kicked {
		session.mu.Unlock()
		return func() {}
	}
	theme := session.chatThemeForClientLocked(client, label, peer, preferredTheme, join)
	info := session.clients[client]
	if info.ID == "" {
		info.ID = session.clientIDLocked(client)
	}
	info.Count++
	info.Label = sanitizeChatSender(label)
	info.Avatar = sanitizeChatAvatar(avatar)
	info.Theme = theme
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
			// Do not remove token-to-clientId mapping during disconnect to allow stable clientId
			// when a client reconnects (e.g. on mobile network switch or Wails window resizing).
			// delete(session.clientIDs, client)
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

func (session *chatSession) clientIDLocked(token string) string {
	token = strings.TrimSpace(token)
	if token == "" {
		return ""
	}
	if session.clientIDs == nil {
		session.clientIDs = map[string]string{}
	}
	if id := session.clientIDs[token]; id != "" {
		return id
	}
	id := "dev-" + randomChatToken()
	session.clientIDs[token] = id
	return id
}

func (session *chatSession) kickClient(id string) bool {
	id = strings.TrimSpace(id)
	if id == "" {
		return false
	}
	session.mu.Lock()
	for token, client := range session.clients {
		if client.ID != id || session.validHostToken(token) {
			continue
		}
		if session.kickedClients == nil {
			session.kickedClients = map[string]struct{}{}
		}
		session.kickedClients[token] = struct{}{}
		delete(session.clients, token)
		delete(session.clientIDs, token)
		session.addSystemMessageLocked(client.Label + " was forced offline.")
		hook, snapshot := session.statusSnapshotLocked(session.state)
		session.notifyLocked()
		session.mu.Unlock()
		notifyChatStatusHook(hook, snapshot)
		return true
	}
	session.mu.Unlock()
	return false
}

func (session *chatSession) rejectKickedClient(w http.ResponseWriter, token string) bool {
	token = strings.TrimSpace(token)
	if token == "" {
		return false
	}
	session.mu.Lock()
	_, kicked := session.kickedClients[token]
	session.mu.Unlock()
	if kicked {
		http.Error(w, "device was forced offline", http.StatusForbidden)
	}
	return kicked
}

func (session *chatSession) chatThemeForToken(token string, label string) string {
	session.mu.Lock()
	defer session.mu.Unlock()
	return session.chatThemeForClientLocked(token, label, "", "", "")
}

func (session *chatSession) ensureChatTheme(token string, label string, peer string, preferredTheme string, join string) string {
	session.mu.Lock()
	defer session.mu.Unlock()
	return session.chatThemeForClientLocked(token, label, peer, preferredTheme, join)
}

func (session *chatSession) chatThemeForClientLocked(token string, label string, peer string, preferredTheme string, join string) string {
	client := strings.TrimSpace(token)
	if client == "" {
		return defaultChatThemeID
	}
	if session.clientThemes == nil {
		session.clientThemes = map[string]string{}
	}
	if session.clientThemeJoins == nil {
		session.clientThemeJoins = map[string]string{}
	}
	if session.isDesktopChatClient(client, label, peer) {
		session.clientThemes[client] = defaultChatThemeID
		return defaultChatThemeID
	}
	join = strings.TrimSpace(join)
	if theme := session.clientThemes[client]; validChatTheme(theme) && (join == "" || session.clientThemeJoins[client] == join) {
		return theme
	}
	theme := session.randomChatThemeLocked(client)
	session.clientThemes[client] = theme
	if join != "" {
		session.clientThemeJoins[client] = join
	}
	return theme
}

func (session *chatSession) isDesktopChatClient(token string, label string, peer string) bool {
	if session.validHostToken(token) {
		return true
	}
	if strings.EqualFold(strings.TrimSpace(peer), "desktop") {
		return true
	}
	return false
}

func (session *chatSession) randomChatThemeLocked(client string) string {
	for tries := 0; tries < 8; tries++ {
		theme := randomChatThemeID()
		if !session.themeInUseByOtherClientLocked(client, theme) {
			return theme
		}
	}
	return randomChatThemeID()
}

func randomChatThemeID() string {
	seed, err := rand.Int(rand.Reader, big.NewInt(maxChatThemeSeed))
	if err != nil {
		return fmt.Sprintf("theme-%d", time.Now().UnixNano()%maxChatThemeSeed+1)
	}
	return fmt.Sprintf("theme-%d", seed.Int64()+1)
}

func (session *chatSession) themeInUseByOtherClientLocked(client string, theme string) bool {
	for other, assigned := range session.clientThemes {
		if other != client && assigned == theme {
			return true
		}
	}
	return false
}

func validChatTheme(theme string) bool {
	if !strings.HasPrefix(theme, "theme-") {
		return false
	}
	index, err := strconv.ParseInt(strings.TrimPrefix(theme, "theme-"), 10, 64)
	return err == nil && index >= 0 && index <= maxChatThemeSeed
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
	return session.addTextMessageWithAvatar(sender, "", token, text)
}

func (session *chatSession) addTextMessageWithAvatar(sender string, avatar string, token string, text string) chatMessage {
	text = strings.TrimSpace(text)
	if text == "" {
		return chatMessage{}
	}
	theme := session.chatThemeForToken(strings.TrimSpace(token), sender)
	return session.addMessageWithStatus(chatMessage{
		Sender:     sender,
		Avatar:     avatar,
		Type:       "text",
		Text:       text,
		Theme:      theme,
		ownerToken: strings.TrimSpace(token),
	}, "active")
}

func (session *chatSession) addUploadPlaceholderMessage(sender string, avatar string, token string, msgType string, fileName string, size int64, tempID string, duration float64, width int, height int) chatMessage {
	theme := session.chatThemeForToken(strings.TrimSpace(token), sender)
	return session.addMessageWithStatus(chatMessage{
		ID:         tempID,
		Sender:     sender,
		Avatar:     avatar,
		Type:       msgType,
		FileName:   fileName,
		Size:       size,
		Sending:    true,
		Progress:   0,
		Theme:      theme,
		ownerToken: strings.TrimSpace(token),
		Duration:   duration,
		Width:      width,
		Height:     height,
	}, "active")
}

func (session *chatSession) updateUploadProgressMessage(tempID string, progress int) (chatMessage, bool) {
	session.mu.Lock()
	defer session.mu.Unlock()
	for index := range session.messages {
		if session.messages[index].ID == tempID {
			session.messages[index].Progress = progress
			session.messages[index].Seq = session.nextEventSeqLocked()
			session.lastActivity = time.Now()
			session.notifyLocked()
			return session.messages[index], true
		}
	}
	return chatMessage{}, false
}

func (session *chatSession) updateDownloadProgressMessage(messageID string, receiving bool, progress int) (chatMessage, bool) {
	session.mu.Lock()
	defer session.mu.Unlock()
	for index := range session.messages {
		if session.messages[index].ID == messageID {
			session.messages[index].Receiving = receiving
			session.messages[index].Progress = progress
			session.messages[index].Seq = session.nextEventSeqLocked()
			session.lastActivity = time.Now()
			session.notifyLocked()
			return session.messages[index], true
		}
	}
	return chatMessage{}, false
}

func (session *chatSession) addSystemMessage(text string) chatMessage {
	return session.addMessageWithStatus(chatMessage{
		Sender: "system",
		Type:   "system",
		Text:   text,
	}, "")
}

func (session *chatSession) addSystemMessageLocked(text string) chatMessage {
	message := chatMessage{
		Sender: "system",
		Type:   "system",
		Text:   text,
	}
	message.ID = session.nextMessageIDLocked()
	message.CreatedAt = time.Now()
	message.Seq = session.nextEventSeqLocked()
	message.createdSeq = message.Seq
	session.messages = append(session.messages, message)
	session.trimHistoryLocked()
	session.lastActivity = time.Now()
	return message
}

func (session *chatSession) saveAttachment(sender string, token string, name string, mimeType string, size int64, reader io.Reader) (chatMessage, error) {
	return session.saveAttachmentWithAvatar(sender, "", token, name, mimeType, size, reader, "", 0, 0, 0)
}

func (session *chatSession) saveAttachmentWithAvatar(sender string, avatar string, token string, name string, mimeType string, size int64, reader io.Reader, tempID string, duration float64, width int, height int) (chatMessage, error) {
	if name == "" {
		name = "attachment"
	}
	var id string
	if tempID != "" {
		id = tempID
	} else {
		id = session.nextMessageID()
	}
	storedName := id + "-" + name
	path := filepath.Join(session.dir, storedName)
	out, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return chatMessage{}, err
	}
	usage := limiterInstance.GetStatus()
	isFreeLimitExceeded := !usage.IsPaid && usage.UsedSeconds >= 300

	var r io.Reader = reader
	if isFreeLimitExceeded {
		r = &ThrottledReader{
			r:      reader,
			limit:  100 * 1024,
			active: true,
		}
	}

	written, copyErr := io.Copy(out, r)
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
	} else if strings.HasPrefix(mimeType, "audio/") {
		messageType = "audio"
	}
	ownerToken := strings.TrimSpace(token)
	message := chatMessage{
		ID:         id,
		Sender:     sender,
		Avatar:     avatar,
		Type:       messageType,
		FileName:   name,
		Size:       size,
		MimeType:   mimeType,
		URL:        strings.TrimRight(session.attachmentRoute, "/") + "/" + id,
		Theme:      session.chatThemeForToken(ownerToken, sender),
		CreatedAt:  time.Now(),
		ownerToken: ownerToken,
		Duration:   duration,
		Width:      width,
		Height:     height,
	}
	session.mu.Lock()
	if client, ok := session.clients[ownerToken]; ok {
		message.Sender = client.Label
		message.SenderID = client.ID
		if client.Avatar != "" {
			message.Avatar = client.Avatar
		}
	}
	session.attachments[id] = chatAttachment{
		ID:       id,
		Path:     path,
		FileName: name,
		Size:     size,
		MimeType: mimeType,
	}
	foundIdx := -1
	for index := range session.messages {
		if session.messages[index].ID == id {
			foundIdx = index
			break
		}
	}
	if foundIdx >= 0 {
		message.CreatedAt = session.messages[foundIdx].CreatedAt
		message.Seq = session.nextEventSeqLocked()
		message.createdSeq = session.messages[foundIdx].createdSeq
		session.messages[foundIdx] = message
	} else {
		message.Seq = session.nextEventSeqLocked()
		message.createdSeq = message.Seq
		session.messages = append(session.messages, message)
	}
	session.trimHistoryLocked()
	session.lastActivity = time.Now()
	session.notifyLocked()
	hook, snapshot := session.statusSnapshotLocked("active")
	session.mu.Unlock()
	notifyChatStatusHook(hook, snapshot)
	return message, nil
}

func (session *chatSession) registerTusAttachment(sender string, avatar string, token string, name string, mimeType string, size int64, finalPath string, tempID string, duration float64, width int, height int) (chatMessage, error) {
	if name == "" {
		name = "attachment"
	}
	id := tempID
	if id == "" {
		id = session.nextMessageID()
	}
	if mimeType == "" || mimeType == "application/octet-stream" {
		mimeType = mime.TypeByExtension(filepath.Ext(name))
	}
	messageType := "file"
	if strings.HasPrefix(mimeType, "image/") {
		messageType = "image"
	} else if strings.HasPrefix(mimeType, "video/") {
		messageType = "video"
	} else if strings.HasPrefix(mimeType, "audio/") {
		messageType = "audio"
	}
	ownerToken := strings.TrimSpace(token)
	message := chatMessage{
		ID:         id,
		Sender:     sender,
		Avatar:     avatar,
		Type:       messageType,
		FileName:   name,
		Size:       size,
		MimeType:   mimeType,
		URL:        strings.TrimRight(session.attachmentRoute, "/") + "/" + id,
		Theme:      session.chatThemeForToken(ownerToken, sender),
		CreatedAt:  time.Now(),
		ownerToken: ownerToken,
		Duration:   duration,
		Width:      width,
		Height:     height,
	}
	session.mu.Lock()
	if client, ok := session.clients[ownerToken]; ok {
		message.Sender = client.Label
		message.SenderID = client.ID
		if client.Avatar != "" {
			message.Avatar = client.Avatar
		}
	}
	session.attachments[id] = chatAttachment{
		ID:       id,
		Path:     finalPath,
		FileName: name,
		Size:     size,
		MimeType: mimeType,
	}
	foundIdx := -1
	for index := range session.messages {
		if session.messages[index].ID == id {
			foundIdx = index
			break
		}
	}
	if foundIdx >= 0 {
		message.CreatedAt = session.messages[foundIdx].CreatedAt
		message.Seq = session.nextEventSeqLocked()
		message.createdSeq = session.messages[foundIdx].createdSeq
		session.messages[foundIdx] = message
	} else {
		message.Seq = session.nextEventSeqLocked()
		message.createdSeq = message.Seq
		session.messages = append(session.messages, message)
	}
	session.trimHistoryLocked()
	session.lastActivity = time.Now()
	session.notifyLocked()
	hook, snapshot := session.statusSnapshotLocked("active")
	session.mu.Unlock()
	notifyChatStatusHook(hook, snapshot)
	return message, nil
}

func (session *chatSession) handleTusUpload(w http.ResponseWriter, r *http.Request) {
	if session.isTerminal() {
		writeChatTerminal(w)
		return
	}
	prefix := session.attachmentRoute + "/tus/"
	http.StripPrefix(prefix, session.tusHandler).ServeHTTP(w, r)
}

func (session *chatSession) addMessageWithStatus(message chatMessage, statusState string) chatMessage {
	session.mu.Lock()
	if client, ok := session.clients[message.ownerToken]; ok {
		message.Sender = client.Label
		message.SenderID = client.ID
		if client.Avatar != "" {
			message.Avatar = client.Avatar
		}
	}
	if message.ID == "" {
		message.ID = session.nextMessageIDLocked()
	}
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
		if session.messages[index].Sending {
			msg := session.messages[index]
			session.messages = append(session.messages[:index], session.messages[index+1:]...)
			session.lastActivity = time.Now()
			session.notifyLocked()
			return msg, true
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
	fmt.Fprintln(w, "This chat session has ended. Start a new eqt chat session to continue.")
}

func (session *chatSession) validHostToken(token string) bool {
	return session.hostToken != "" && token == session.hostToken
}

func (session *chatSession) updateHostAvatar(token string, newAvatar string) {
	session.mu.Lock()
	defer session.mu.Unlock()

	client, exists := session.clients[token]
	if exists {
		oldAvatar := client.Avatar
		if oldAvatar != newAvatar {
			client.Avatar = newAvatar
			session.clients[token] = client
			session.addSystemMessageLocked("roster-update")
			session.notifyLocked()
		}
	}
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

	limiterInstance.mu.Lock()
	if limiterInstance.activeSession == session {
		limiterInstance.activeSession = nil
	}
	limiterInstance.mu.Unlock()
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

func sanitizeChatAvatar(avatar string) string {
	avatar = strings.TrimSpace(avatar)
	if avatar == "" {
		return ""
	}
	if strings.HasPrefix(avatar, "data:image/") {
		if len(avatar) > 102400 {
			return avatar[:102400]
		}
		return avatar
	}
	runes := []rune(avatar)
	if len(runes) > 4 {
		avatar = string(runes[:4])
	}
	return avatar
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
	if token := r.Header.Get("X-Eqt-Chat-Host-Token"); token != "" {
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

// ThrottledReader limits the read rate to a specified bytes per second.
type ThrottledReader struct {
	r      io.Reader
	limit  int // bytes per second
	active bool
}

func (tr *ThrottledReader) Read(p []byte) (n int, err error) {
	if !tr.active {
		return tr.r.Read(p)
	}
	maxToRead := len(p)
	if maxToRead > 16*1024 {
		maxToRead = 16 * 1024
	}
	n, err = tr.r.Read(p[:maxToRead])
	if n > 0 {
		delayMs := (int64(n) * 1000) / int64(tr.limit)
		if delayMs > 0 {
			time.Sleep(time.Duration(delayMs) * time.Millisecond)
		}
	}
	return n, err
}

// ThrottledReadCloser wraps a reader and a closer to provide a rate-limited io.ReadCloser.
type ThrottledReadCloser struct {
	io.Reader
	io.Closer
}

func (session *chatSession) handleLocalAttachmentRegister(w http.ResponseWriter, r *http.Request) {
	if handleChatCORS(w, r, http.MethodPost) {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if session.isTerminal() {
		writeChatTerminal(w)
		return
	}
	if !session.validHostToken(chatHostTokenFromRequest(r)) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	var req struct {
		Path   string `json:"path"`
		Sender string `json:"sender"`
		Avatar string `json:"avatar"`
		Token  string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Path == "" {
		http.Error(w, "path is required", http.StatusBadRequest)
		return
	}

	info, err := os.Stat(req.Path)
	if err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "file does not exist", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if info.IsDir() {
		http.Error(w, "path is a directory, not a file", http.StatusBadRequest)
		return
	}

	fileName := filepath.Base(req.Path)
	size := info.Size()
	mimeType := mime.TypeByExtension(filepath.Ext(fileName))

	message, err := session.registerTusAttachment(
		sanitizeChatSender(req.Sender),
		sanitizeChatAvatar(req.Avatar),
		strings.TrimSpace(req.Token),
		safeChatFilename(fileName),
		mimeType,
		size,
		req.Path,
		"",
		0, 0, 0,
	)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(message); err != nil {
		log.Println(err)
	}
}
