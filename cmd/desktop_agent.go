package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"eqt/application"
	"eqt/body"
	"eqt/config"
	"eqt/logger"
	"eqt/server"
	"eqt/version"
	"github.com/spf13/cobra"
)

var desktopAgentAddress = getDesktopAgentAddress()
const desktopAgentMaxQueue = 16
const desktopAgentMaxHistory = 20
const desktopAgentHistoryFilename = "desktop-agent-history.json"

var openDesktopAgentPage = openDesktopAgentPageURL
var desktopAgentBaseURL = "http://" + desktopAgentAddress
var desktopAgentExecutable = os.Executable
var desktopAgentBackgroundStarter = startDesktopAgentBackgroundProcess
var desktopAgentReadyWaiter = waitForDesktopAgentReady

func getDesktopAgentAddress() string {
	if port := os.Getenv("EQT_AGENT_PORT"); port != "" {
		return "127.0.0.1:" + port
	}
	return "127.0.0.1:48176"
}

type desktopAgentTask struct {
	Action  string   `json:"action"`
	Paths   []string `json:"paths"`
	Browser *bool    `json:"browser,omitempty"`
}


type desktopAgentTaskRecord struct {
	ID                  int        `json:"id"`
	Action              string     `json:"action"`
	Paths               []string   `json:"paths"`
	State               string     `json:"state"`
	TransferState       string     `json:"transferState,omitempty"`
	TransferMessage     string     `json:"transferMessage,omitempty"`
	TransferMode        string     `json:"transferMode,omitempty"`
	TransferTarget      string     `json:"transferTarget,omitempty"`
	TransferArchive     bool       `json:"transferArchive,omitempty"`
	TransferArchiveName string     `json:"transferArchiveName,omitempty"`
	TransferItems       []string   `json:"transferItems,omitempty"`
	TransferCurrent     string     `json:"transferCurrent,omitempty"`
	TransferPercent     int        `json:"transferPercent,omitempty"`
	BytesDone           int64      `json:"bytesDone,omitempty"`
	BytesTotal          int64      `json:"bytesTotal,omitempty"`
	SavedFiles          []string   `json:"savedFiles,omitempty"`
	ChatState           string     `json:"chatState,omitempty"`
	ChatMessageCount    int        `json:"chatMessageCount,omitempty"`
	ChatDeviceCount     int        `json:"chatDeviceCount,omitempty"`
	ChatLastActivity    string     `json:"chatLastActivity,omitempty"`
	PageURL             string     `json:"pageUrl,omitempty"`
	Error               string     `json:"error,omitempty"`
	StartedAt           time.Time  `json:"startedAt"`
	FinishedAt          *time.Time `json:"finishedAt,omitempty"`
}

type desktopAgentResponse struct {
	State            string                   `json:"state"`
	Current          *desktopAgentTaskRecord  `json:"current,omitempty"`
	Chat             *desktopAgentTaskRecord  `json:"chat,omitempty"`
	Queued           int                      `json:"queued"`
	History          []desktopAgentTaskRecord `json:"history,omitempty"`
	LastError        string                   `json:"lastError,omitempty"`
	Version          string                   `json:"version"`
	AgentStartedAt   time.Time                `json:"agentStartedAt"`
	ClockTampered    bool                     `json:"clockTampered"`
	IsPaid           bool                     `json:"isPaid"`
	LicenseTier      string                   `json:"licenseTier"`
	MaxDevices       int                      `json:"maxDevices"`
	ActivatedDevices int                      `json:"activatedDevices"`
}

type desktopAgentHistoryStore struct {
	History []desktopAgentTaskRecord `json:"history"`
}

type desktopAgentNotifier func(title string, message string) error

type desktopAgent struct {
	mu          sync.Mutex
	baseFlags   application.Flags
	log         logger.Logger
	startedAt   time.Time
	busy        bool
	current     *desktopAgentTaskRecord
	chat        *desktopAgentTaskRecord
	queue       []desktopAgentTask
	history     []desktopAgentTaskRecord
	nextID      int
	activeStop  func(string)
	chatStop    func(string)
	shutdown    func()
	lastError   string
	runner      func(desktopAgentTask) error
	notifier    desktopAgentNotifier
	historyPath  string
	notified     map[int]map[string]bool
	revision     int64
	subscribers  map[chan struct{}]struct{}
	activeServer *server.Server
}

func newDesktopAgent(baseFlags application.Flags) *desktopAgent {
	agent := &desktopAgent{
		baseFlags:   baseFlags,
		log:         logger.New(baseFlags.Quiet),
		startedAt:   time.Now(),
		notifier:    notifyDesktop,
		historyPath: defaultDesktopAgentHistoryPath(),
		notified:    map[int]map[string]bool{},
		subscribers: map[chan struct{}]struct{}{},
	}
	agent.runner = agent.runTask
	return agent
}

func defaultDesktopAgentHistoryPath() string {
	return filepath.Join(config.DefaultConfigDir(), desktopAgentHistoryFilename)
}

func (agent *desktopAgent) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", agent.handlePage)
	mux.HandleFunc("/health", agent.handleHealth)
	mux.HandleFunc("/status", agent.handleStatus)
	mux.HandleFunc("/events", agent.handleEvents)
	mux.HandleFunc("/settings", agent.handleSettings)
	mux.HandleFunc("/restart", agent.handleRestart)
	mux.HandleFunc("/tasks", agent.handleTasks)
	mux.HandleFunc("/tasks/", agent.handleTaskAction)
	mux.HandleFunc("/history", agent.handleHistory)
	mux.HandleFunc("/file", agent.handleFile)
	mux.HandleFunc("/stop-current", agent.handleStopCurrent)
	mux.HandleFunc("/stop-chat", agent.handleStopChat)
	mux.HandleFunc("/shutdown", agent.handleShutdown)
	mux.HandleFunc("/set-paid-status", agent.handleSetPaidStatus)
	mux.HandleFunc("/activate", agent.handleActivate)
	mux.HandleFunc("/reset-license", agent.handleResetLicense)
	mux.HandleFunc("/update/check", agent.handleUpdateCheck)
	mux.HandleFunc("/update/download", agent.handleUpdateDownload)
	mux.HandleFunc("/update/install", agent.handleUpdateInstall)
	return mux
}

func (agent *desktopAgent) handlePage(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	status := agent.snapshot()
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = desktopAgentPageTemplate.Execute(w, status)
}

func (agent *desktopAgent) handleHealth(w http.ResponseWriter, r *http.Request) {
	if handleDesktopAgentCORS(w, r, http.MethodGet) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if rejectCrossOriginDesktopAgent(w, r) {
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (agent *desktopAgent) handleStatus(w http.ResponseWriter, r *http.Request) {
	if handleDesktopAgentCORS(w, r, http.MethodGet) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if rejectCrossOriginDesktopAgent(w, r) {
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	agent.writeStatus(w)
}

func (agent *desktopAgent) handleEvents(w http.ResponseWriter, r *http.Request) {
	if handleDesktopAgentCORS(w, r, http.MethodGet) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if rejectCrossOriginDesktopAgent(w, r) {
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
	lastRevision := int64(-1)
	send := func() bool {
		status, revision := agent.snapshotWithRevision()
		if revision == lastRevision {
			return true
		}
		lastRevision = revision
		if _, err := fmt.Fprint(w, "data: "); err != nil {
			return false
		}
		if err := json.NewEncoder(w).Encode(status); err != nil {
			return false
		}
		if _, err := fmt.Fprint(w, "\n"); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}
	if !send() {
		return
	}
	events, unsubscribe := agent.subscribeEvents()
	defer unsubscribe()
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-events:
			if !send() {
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

func (agent *desktopAgent) subscribeEvents() (<-chan struct{}, func()) {
	ch := make(chan struct{}, 1)
	agent.mu.Lock()
	if agent.subscribers == nil {
		agent.subscribers = map[chan struct{}]struct{}{}
	}
	agent.subscribers[ch] = struct{}{}
	agent.mu.Unlock()
	return ch, func() {
		agent.mu.Lock()
		delete(agent.subscribers, ch)
		close(ch)
		agent.mu.Unlock()
	}
}

func (agent *desktopAgent) touchLocked() {
	agent.revision++
	for ch := range agent.subscribers {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func (agent *desktopAgent) handleRestart(w http.ResponseWriter, r *http.Request) {
	if rejectCrossOriginDesktopAgent(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	logFile, logPath, err := createDesktopAgentBackgroundLog()
	if err != nil {
		http.Error(w, fmt.Sprintf("desktop agent restart failed: %v", err), http.StatusInternalServerError)
		return
	}
	exe, err := desktopAgentExecutable()
	if err != nil {
		_ = logFile.Close()
		http.Error(w, fmt.Sprintf("desktop agent restart failed: %v", err), http.StatusInternalServerError)
		return
	}
	cmd := exec.Command(exe, "desktop", "agent-restart-helper")
	configureDesktopAgentBackgroundCommand(cmd)
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		http.Error(w, fmt.Sprintf("desktop agent restart failed: %v", err), http.StatusInternalServerError)
		return
	}
	if err := cmd.Process.Release(); err != nil {
		_ = logFile.Close()
		http.Error(w, fmt.Sprintf("desktop agent restart failed: %v", err), http.StatusInternalServerError)
		return
	}
	agent.mu.Lock()
	agent.queue = nil
	if agent.busy {
		agent.finalizeActiveLocked("replaced")
	}
	if agent.chat != nil {
		agent.finalizeChatLocked("replaced")
	}
	shutdown := agent.shutdown
	agent.touchLocked()
	agent.mu.Unlock()

	w.WriteHeader(http.StatusAccepted)
	fmt.Fprintf(w, "Desktop agent restarting.\nLog: %s\n", logPath)
	go func() {
		defer logFile.Close()
		if shutdown != nil {
			shutdown()
		}
	}()
}

func (agent *desktopAgent) handleSettings(w http.ResponseWriter, r *http.Request) {
	if rejectCrossOriginDesktopAgent(w, r) {
		return
	}
	switch r.Method {
	case http.MethodGet:
		settings, err := agent.readSettings()
		if err != nil {
			http.Error(w, fmt.Sprintf("desktop agent settings unavailable: %v", err), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(settings)
	case http.MethodPost:
		var settings config.DesktopSettings
		if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
			http.Error(w, fmt.Sprintf("invalid settings: %v", err), http.StatusBadRequest)
			return
		}
		saved, err := agent.writeSettings(settings)
		if err != nil {
			http.Error(w, fmt.Sprintf("save desktop agent settings failed: %v", err), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(saved)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (agent *desktopAgent) settingsApp() application.App {
	settingsApp := application.New()
	settingsApp.Flags = agent.baseFlags
	return settingsApp
}

func (agent *desktopAgent) readSettings() (config.DesktopSettings, error) {
	return config.ReadDesktopSettings(agent.settingsApp())
}

func (agent *desktopAgent) writeSettings(settings config.DesktopSettings) (config.DesktopSettings, error) {
	saved, err := config.WriteDesktopSettings(agent.settingsApp(), settings)
	if err != nil {
		return saved, err
	}
	agent.mu.Lock()
	srv := agent.activeServer
	chatTaskRunning := agent.chat != nil && agent.chat.State == "running"
	agent.mu.Unlock()

	if chatTaskRunning && srv != nil {
		srv.UpdateChatHostAvatar(settings.ChatAvatar)
	}
	return saved, nil
}

func (agent *desktopAgent) handleChatHostRename(newName string) {
	agent.log.Infof("handleChatHostRename: updating persistent chatSender to %q", newName)
	settings, err := agent.readSettings()
	if err != nil {
		agent.log.Errorf("handleChatHostRename: failed to read settings: %v", err)
		return
	}
	settings.ChatSender = newName
	if _, err := agent.writeSettings(settings); err != nil {
		agent.log.Errorf("handleChatHostRename: failed to write settings: %v", err)
	} else {
		agent.log.Infof("handleChatHostRename: settings updated successfully with new chatSender")
	}
}

func (agent *desktopAgent) handleTasks(w http.ResponseWriter, r *http.Request) {
	if rejectCrossOriginDesktopAgent(w, r) {
		agent.log.Errorf("handleTasks: cross origin request rejected")
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var task desktopAgentTask
	if err := json.NewDecoder(r.Body).Decode(&task); err != nil {
		agent.log.Errorf("handleTasks: failed to decode JSON task: %v", err)
		http.Error(w, fmt.Sprintf("invalid task: %v", err), http.StatusBadRequest)
		return
	}
	agent.log.Infof("handleTasks: received task request: Action=%q, Paths=%v", task.Action, task.Paths)
	if err := validateDesktopAgentTask(task); err != nil {
		agent.log.Errorf("handleTasks: validation failed for action %q: %v", task.Action, err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	agent.mu.Lock()
	if task.Action == "chat" && agent.chat != nil && agent.chat.State == "running" {
		agent.log.Infof("handleTasks: chat is already running (ID: %d). Returning Accepted.", agent.chat.ID)
		agent.lastError = ""
		agent.touchLocked()
		agent.mu.Unlock()
		w.WriteHeader(http.StatusAccepted)
		agent.writeStatus(w)
		return
	}
	agent.lastError = ""
	if task.Action == "chat" {
		agent.log.Infof("handleTasks: starting new chat session...")
		agent.startChatLocked(task)
	} else {
		if len(agent.queue) >= desktopAgentMaxQueue {
			agent.log.Errorf("handleTasks: queue is full (%d tasks), rejecting request", len(agent.queue))
			agent.mu.Unlock()
			http.Error(w, "desktop agent queue is full", http.StatusTooManyRequests)
			return
		}
		agent.queue = append(agent.queue, task)
		agent.log.Infof("handleTasks: task enqueued (queue size: %d)", len(agent.queue))
		if agent.busy {
			agent.log.Infof("handleTasks: agent is busy. Replacing active task with status: replaced")
			agent.replaceActiveLocked("replaced")
		}
		agent.startNextLocked()
	}
	agent.touchLocked()
	agent.mu.Unlock()

	w.WriteHeader(http.StatusAccepted)
	agent.writeStatus(w)
}

func (agent *desktopAgent) handleTaskAction(w http.ResponseWriter, r *http.Request) {
	if handleDesktopAgentCORS(w, r, http.MethodPost) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if rejectCrossOriginDesktopAgent(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	taskID, action, ok := parseDesktopAgentTaskActionPath(r.URL.Path)
	if !ok || action != "repeat" {
		http.NotFound(w, r)
		return
	}
	if err := agent.repeatTask(taskID); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	w.WriteHeader(http.StatusAccepted)
	agent.writeStatus(w)
}

func parseDesktopAgentTaskActionPath(path string) (int, string, bool) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) != 3 || parts[0] != "tasks" {
		return 0, "", false
	}
	id, err := strconv.Atoi(parts[1])
	if err != nil || id <= 0 {
		return 0, "", false
	}
	return id, parts[2], true
}

func handleDesktopAgentCORS(w http.ResponseWriter, r *http.Request, methods ...string) bool {
	origin := r.Header.Get("Origin")
	if origin != "" && trustedDesktopAgentOrigin(origin, r.Host) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if len(methods) > 0 {
			allowed := append([]string(nil), methods...)
			allowed = append(allowed, http.MethodOptions)
			w.Header().Set("Access-Control-Allow-Methods", strings.Join(allowed, ", "))
		}
	}
	return r.Method == http.MethodOptions
}

func rejectCrossOriginDesktopAgent(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}
	if trustedDesktopAgentOrigin(origin, r.Host) {
		return false
	}
	http.Error(w, "forbidden", http.StatusForbidden)
	return true
}

func trustedDesktopAgentOrigin(origin string, requestHost string) bool {
	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	if trustedDesktopAgentWailsOrigin(parsed) {
		return true
	}
	if strings.EqualFold(parsed.Host, requestHost) {
		return true
	}
	return trustedDesktopAgentLocalHost(parsed.Hostname())
}

func trustedDesktopAgentWailsOrigin(parsed *url.URL) bool {
	host := strings.ToLower(parsed.Hostname())
	return parsed.Scheme == "wails" || host == "wails.localhost"
}

func trustedDesktopAgentLocalHost(host string) bool {
	host = strings.Trim(strings.ToLower(host), "[]")
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast())
}

func (agent *desktopAgent) handleHistory(w http.ResponseWriter, r *http.Request) {
	if rejectCrossOriginDesktopAgent(w, r) {
		return
	}
	if r.Method != http.MethodDelete {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := agent.clearHistory(); err != nil {
		http.Error(w, fmt.Sprintf("clear desktop agent history failed: %v", err), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (agent *desktopAgent) handleFile(w http.ResponseWriter, r *http.Request) {
	if handleDesktopAgentCORS(w, r, http.MethodGet) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if rejectCrossOriginDesktopAgent(w, r) {
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		http.Error(w, "missing path parameter", http.StatusBadRequest)
		return
	}

	agent.mu.Lock()
	valid := false
	if agent.current != nil {
		for _, f := range agent.current.SavedFiles {
			if f == filePath {
				valid = true
				break
			}
		}
		if !valid {
			for _, p := range agent.current.Paths {
				if p == filePath {
					valid = true
					break
				}
			}
		}
	}
	if !valid && agent.chat != nil {
		for _, f := range agent.chat.SavedFiles {
			if f == filePath {
				valid = true
				break
			}
		}
		if !valid {
			for _, p := range agent.chat.Paths {
				if p == filePath {
					valid = true
					break
				}
			}
		}
	}
	if !valid {
		for _, record := range agent.history {
			for _, f := range record.SavedFiles {
				if f == filePath {
					valid = true
					break
				}
			}
			if valid {
				break
			}
			for _, p := range record.Paths {
				if p == filePath {
					valid = true
					break
				}
			}
			if valid {
				break
			}
		}
	}
	agent.mu.Unlock()

	if !valid {
		http.Error(w, "forbidden file path", http.StatusForbidden)
		return
	}

	stat, err := os.Stat(filePath)
	if err != nil || stat.IsDir() {
		http.Error(w, "file not found", http.StatusNotFound)
		return
	}

	http.ServeFile(w, r, filePath)
}

func (agent *desktopAgent) handleStopCurrent(w http.ResponseWriter, r *http.Request) {
	if rejectCrossOriginDesktopAgent(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !agent.stopCurrent("stopped") {
		http.Error(w, "desktop agent has no active task", http.StatusConflict)
		return
	}
	if strings.Contains(r.Header.Get("Accept"), "text/html") {
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	w.WriteHeader(http.StatusAccepted)
	fmt.Fprintln(w, "Current desktop agent task stopped.")
}

func (agent *desktopAgent) handleStopChat(w http.ResponseWriter, r *http.Request) {
	if rejectCrossOriginDesktopAgent(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !agent.stopChat("stopped") {
		http.Error(w, "desktop agent has no active chat", http.StatusConflict)
		return
	}
	w.WriteHeader(http.StatusAccepted)
	fmt.Fprintln(w, "Current desktop chat stopped.")
}

func (agent *desktopAgent) handleSetPaidStatus(w http.ResponseWriter, r *http.Request) {
	if handleDesktopAgentCORS(w, r, http.MethodPost) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if rejectCrossOriginDesktopAgent(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Paid       bool   `json:"paid"`
		RedeemedAt string `json:"redeemedAt"`
		CodeDate   string `json:"codeDate"`
		Tier       string `json:"tier"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	server.SetPaidStatus(req.Paid, req.RedeemedAt, req.CodeDate, req.Tier)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok"})
}

func (agent *desktopAgent) handleActivate(w http.ResponseWriter, r *http.Request) {
	if handleDesktopAgentCORS(w, r, http.MethodPost) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if rejectCrossOriginDesktopAgent(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		LicenseCode string `json:"license_code"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if req.LicenseCode == "" {
		http.Error(w, "license_code is required", http.StatusBadRequest)
		return
	}

	err := server.ActivateLicenseOnline(req.LicenseCode)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok"})
}

func (agent *desktopAgent) handleResetLicense(w http.ResponseWriter, r *http.Request) {
	if handleDesktopAgentCORS(w, r, http.MethodPost) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if rejectCrossOriginDesktopAgent(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	server.ResetLicense()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok"})
}

func (agent *desktopAgent) handleUpdateCheck(w http.ResponseWriter, r *http.Request) {
	if handleDesktopAgentCORS(w, r, http.MethodGet) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if rejectCrossOriginDesktopAgent(w, r) {
		return
	}
	
	// Read settings to check dev mode and dynamically set server package logger
	settings, err := config.ReadDesktopSettings(agent.settingsApp())
	if err == nil {
		if settings.DevMode || settings.DebugLog {
			server.Log = agent.log
		} else {
			server.Log = logger.New(true)
		}
	}

	agent.log.Infof("HTTP Request: %s %s from %s", r.Method, r.URL.Path, r.RemoteAddr)

	if r.Method != http.MethodGet {
		agent.log.Errorf("handleUpdateCheck: method not allowed: %s", r.Method)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	
	agent.log.Infof("handleUpdateCheck: starting check with version %s", version.Version())
	res, err := server.CheckForUpdates(true, version.Version())
	if err != nil {
		agent.log.Errorf("handleUpdateCheck error: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	agent.log.Infof("handleUpdateCheck success: new_version_available: %v, version: %s", res.NewVersionAvailable, res.Version)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(res)
}

func (agent *desktopAgent) handleUpdateDownload(w http.ResponseWriter, r *http.Request) {
	if handleDesktopAgentCORS(w, r, http.MethodPost) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if rejectCrossOriginDesktopAgent(w, r) {
		return
	}

	settings, err := config.ReadDesktopSettings(agent.settingsApp())
	if err == nil {
		if settings.DevMode || settings.DebugLog {
			server.Log = agent.log
		} else {
			server.Log = logger.New(true)
		}
	}

	agent.log.Infof("HTTP Request: %s %s from %s", r.Method, r.URL.Path, r.RemoteAddr)

	if r.Method != http.MethodPost {
		agent.log.Errorf("handleUpdateDownload: method not allowed: %s", r.Method)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	
	var req struct {
		AssetURL     string `json:"asset_url"`
		SignatureURL string `json:"signature_url"`
		AssetName    string `json:"asset_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		agent.log.Errorf("handleUpdateDownload: failed to decode JSON: %v", err)
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	agent.log.Infof("handleUpdateDownload: req.AssetName: %s, req.AssetURL: %s", req.AssetName, req.AssetURL)
	if req.AssetURL == "" || req.SignatureURL == "" || req.AssetName == "" {
		agent.log.Errorf("handleUpdateDownload: missing parameters")
		http.Error(w, "Missing required parameters", http.StatusBadRequest)
		return
	}

	savedPath, err := server.DownloadUpdate(req.AssetURL, req.SignatureURL, req.AssetName)
	if err != nil {
		agent.log.Errorf("handleUpdateDownload error: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	agent.log.Infof("handleUpdateDownload success: savedPath: %s", savedPath)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"saved_path": savedPath,
		"status":     "ready",
	})
}

func (agent *desktopAgent) handleUpdateInstall(w http.ResponseWriter, r *http.Request) {
	if handleDesktopAgentCORS(w, r, http.MethodPost) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if rejectCrossOriginDesktopAgent(w, r) {
		return
	}

	settings, err := config.ReadDesktopSettings(agent.settingsApp())
	if err == nil {
		if settings.DevMode || settings.DebugLog {
			server.Log = agent.log
		} else {
			server.Log = logger.New(true)
		}
	}

	agent.log.Infof("HTTP Request: %s %s from %s", r.Method, r.URL.Path, r.RemoteAddr)

	if r.Method != http.MethodPost {
		agent.log.Errorf("handleUpdateInstall: method not allowed: %s", r.Method)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		AssetName string `json:"asset_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		agent.log.Errorf("handleUpdateInstall: failed to decode JSON: %v", err)
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	agent.log.Infof("handleUpdateInstall: req.AssetName: %s", req.AssetName)
	if req.AssetName == "" {
		agent.log.Errorf("handleUpdateInstall: missing asset_name")
		http.Error(w, "Missing asset_name", http.StatusBadRequest)
		return
	}

	agent.mu.Lock()
	hasActiveTransfer := false
	if agent.current != nil && agent.current.State != "completed" && agent.current.State != "failed" && agent.current.State != "" {
		hasActiveTransfer = true
	}
	agent.mu.Unlock()

	if hasActiveTransfer {
		agent.log.Infof("handleUpdateInstall: reject install due to active transfer task")
		http.Error(w, "Cannot install update during active transfer", http.StatusConflict)
		return
	}

	agent.log.Infof("handleUpdateInstall: starting installer routine...")
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "installing"})

	go func() {
		time.Sleep(500 * time.Millisecond)
		err := server.InstallAndRestart(req.AssetName)
		if err != nil {
			agent.log.Errorf("handleUpdateInstall failed to install: %v", err)
		}
	}()
}

func (agent *desktopAgent) handleShutdown(w http.ResponseWriter, r *http.Request) {
	if rejectCrossOriginDesktopAgent(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	agent.mu.Lock()
	agent.queue = nil
	if agent.busy {
		agent.finalizeActiveLocked("replaced")
	}
	shutdown := agent.shutdown
	agent.touchLocked()
	agent.mu.Unlock()

	w.WriteHeader(http.StatusAccepted)
	fmt.Fprintln(w, "Desktop agent stopping.")
	if shutdown != nil {
		go shutdown()
	}
}

func (agent *desktopAgent) execute(task desktopAgentTask, id int) {
	err := agent.runner(task)
	agent.mu.Lock()
	defer agent.mu.Unlock()
	if agent.current != nil && agent.current.ID == id {
		finishedAt := time.Now()
		agent.current.FinishedAt = &finishedAt
		if agent.current.State == "running" {
			if err != nil {
				agent.current.State = "failed"
				agent.current.Error = err.Error()
				agent.lastError = err.Error()
			} else if isTerminalDesktopTransferState(agent.current.TransferState) {
				agent.current.State = agent.current.TransferState
			} else {
				agent.current.State = "completed"
			}
		}
		agent.addHistoryLocked(*agent.current)
		agent.notifyRecordLocked(*agent.current)
		delete(agent.notified, agent.current.ID)
		agent.busy = false
		agent.current = nil
		agent.activeStop = nil
		agent.startNextLocked()
		agent.touchLocked()
	}
}

func (agent *desktopAgent) executeChat(task desktopAgentTask, id int) {
	agent.log.Infof("executeChat: running task runner (taskID: %d)", id)
	err := agent.runner(task)
	agent.mu.Lock()
	defer agent.mu.Unlock()
	if agent.chat != nil && agent.chat.ID == id {
		finishedAt := time.Now()
		agent.chat.FinishedAt = &finishedAt
		if agent.chat.State == "running" {
			if err != nil {
				agent.log.Errorf("executeChat: task runner failed for taskID: %d: %v", id, err)
				agent.chat.State = "failed"
				agent.chat.Error = err.Error()
				agent.lastError = err.Error()
			} else {
				agent.log.Infof("executeChat: task runner completed successfully for taskID: %d", id)
				agent.chat.State = "completed"
			}
		}
		agent.addHistoryLocked(*agent.chat)
		agent.notifyRecordLocked(*agent.chat)
		delete(agent.notified, agent.chat.ID)
		agent.chat = nil
		agent.chatStop = nil
		agent.touchLocked()
	}
}

func (agent *desktopAgent) stopCurrent(state string) bool {
	agent.mu.Lock()
	defer agent.mu.Unlock()
	if agent.busy {
		agent.replaceActiveLocked(state)
		agent.touchLocked()
		return true
	}
	if agent.chat == nil {
		return false
	}
	agent.replaceChatLocked(state)
	agent.touchLocked()
	return true
}

func (agent *desktopAgent) stopChat(state string) bool {
	agent.mu.Lock()
	defer agent.mu.Unlock()
	if agent.chat == nil {
		return false
	}
	agent.replaceChatLocked(state)
	agent.touchLocked()
	return true
}

func (agent *desktopAgent) repeatTask(id int) error {
	agent.mu.Lock()
	defer agent.mu.Unlock()
	if len(agent.queue) >= desktopAgentMaxQueue {
		return fmt.Errorf("desktop agent queue is full")
	}
	var repeated *desktopAgentTask
	if agent.current != nil && agent.current.ID == id {
		task := desktopAgentTask{Action: agent.current.Action, Paths: append([]string(nil), agent.current.Paths...)}
		repeated = &task
	}
	if repeated == nil && agent.chat != nil && agent.chat.ID == id {
		task := desktopAgentTask{Action: agent.chat.Action, Paths: append([]string(nil), agent.chat.Paths...)}
		repeated = &task
	}
	if repeated == nil {
		for _, record := range agent.history {
			if record.ID == id {
				task := desktopAgentTask{Action: record.Action, Paths: append([]string(nil), record.Paths...)}
				repeated = &task
				break
			}
		}
	}
	if repeated == nil {
		return fmt.Errorf("desktop agent task #%d was not found", id)
	}
	if err := validateDesktopAgentTask(*repeated); err != nil {
		return err
	}
	agent.lastError = ""
	if repeated.Action == "chat" {
		if agent.chat != nil {
			agent.replaceChatLocked("replaced")
		}
		agent.startChatLocked(*repeated)
	} else {
		agent.queue = append(agent.queue, *repeated)
		if agent.busy {
			agent.replaceActiveLocked("replaced")
		}
		agent.startNextLocked()
	}
	agent.touchLocked()
	return nil
}

func isTerminalDesktopTransferState(state string) bool {
	return state == "completed" || state == "stopped" || state == "failed"
}

func isTerminalDesktopChatState(state string) bool {
	return state == "ended" || state == "stopped" || state == "failed" || state == "replaced"
}

func desktopTaskStateForChatState(state string) string {
	switch state {
	case "ended":
		return "completed"
	case "stopped", "failed", "replaced":
		return state
	default:
		return "running"
	}
}

func (agent *desktopAgent) replaceActiveLocked(state string) {
	if agent.current != nil && agent.current.State == "running" {
		agent.current.State = state
		finishedAt := time.Now()
		agent.current.FinishedAt = &finishedAt
	}
	if agent.activeStop == nil {
		return
	}
	stop := agent.activeStop
	go stop(state)
}

func (agent *desktopAgent) replaceChatLocked(state string) {
	if agent.chat != nil && agent.chat.State == "running" {
		agent.chat.State = state
		finishedAt := time.Now()
		agent.chat.FinishedAt = &finishedAt
	}
	if agent.chatStop == nil {
		return
	}
	stop := agent.chatStop
	go stop(state)
}

func (agent *desktopAgent) finalizeActiveLocked(state string) {
	agent.replaceActiveLocked(state)
	if agent.current == nil {
		return
	}
	record := *agent.current
	agent.addHistoryLocked(record)
	agent.notifyRecordLocked(record)
	delete(agent.notified, record.ID)
	agent.busy = false
	agent.current = nil
	agent.activeStop = nil
}

func (agent *desktopAgent) finalizeChatLocked(state string) {
	agent.replaceChatLocked(state)
	if agent.chat == nil {
		return
	}
	record := *agent.chat
	agent.addHistoryLocked(record)
	agent.notifyRecordLocked(record)
	delete(agent.notified, record.ID)
	agent.chat = nil
	agent.chatStop = nil
}

func (agent *desktopAgent) startNextLocked() {
	if agent.busy || len(agent.queue) == 0 {
		return
	}
	task := agent.queue[0]
	agent.queue = agent.queue[1:]
	agent.nextID++
	record := desktopAgentTaskRecord{
		ID:        agent.nextID,
		Action:    task.Action,
		Paths:     append([]string(nil), task.Paths...),
		State:     "running",
		StartedAt: time.Now(),
	}
	agent.busy = true
	agent.current = &record
	agent.notifyRecordLocked(record)
	go agent.execute(task, record.ID)
}

func (agent *desktopAgent) startChatLocked(task desktopAgentTask) {
	agent.nextID++
	agent.log.Infof("startChatLocked: initiating chat session with taskID=%d", agent.nextID)
	record := desktopAgentTaskRecord{
		ID:        agent.nextID,
		Action:    task.Action,
		Paths:     append([]string(nil), task.Paths...),
		State:     "running",
		StartedAt: time.Now(),
	}
	agent.chat = &record
	agent.notifyRecordLocked(record)
	go agent.executeChat(task, record.ID)
}

func (agent *desktopAgent) taskIDForAction(action string) int {
	agent.mu.Lock()
	defer agent.mu.Unlock()
	if action == "chat" {
		if agent.chat == nil {
			return 0
		}
		return agent.chat.ID
	}
	if agent.current == nil {
		return 0
	}
	return agent.current.ID
}

func (agent *desktopAgent) observeTransferStatus(taskID int, status server.TransferStatusSnapshot) {
	agent.mu.Lock()
	defer agent.mu.Unlock()
	if agent.current == nil || agent.current.ID != taskID {
		return
	}
	agent.current.TransferState = status.State
	agent.current.TransferMessage = status.Message
	agent.current.TransferMode = status.Mode
	agent.current.TransferTarget = status.Target
	agent.current.TransferArchive = status.Archive
	agent.current.TransferArchiveName = status.ArchiveName
	agent.current.TransferItems = append([]string(nil), status.Items...)
	agent.current.TransferCurrent = status.Current
	agent.current.TransferPercent = status.Percent
	agent.current.BytesDone = status.BytesDone
	agent.current.BytesTotal = status.BytesTotal
	agent.current.SavedFiles = append([]string(nil), status.SavedFiles...)
	if isTerminalDesktopTransferState(status.State) && agent.current.State == "running" {
		agent.current.State = status.State
		finishedAt := time.Now()
		agent.current.FinishedAt = &finishedAt
	}
	agent.notifyTransferStatusLocked(*agent.current)
	if isTerminalDesktopTransferState(agent.current.State) {
		record := *agent.current
		agent.addHistoryLocked(record)
		agent.notifyRecordLocked(record)
		delete(agent.notified, record.ID)
		agent.busy = false
		agent.current = nil
		agent.activeStop = nil
		agent.startNextLocked()
		agent.touchLocked()
		return
	}
	agent.touchLocked()
}

func (agent *desktopAgent) observeChatStatus(taskID int, status server.ChatStatusSnapshot) {
	agent.mu.Lock()
	defer agent.mu.Unlock()
	if agent.chat == nil || agent.chat.ID != taskID {
		return
	}
	agent.chat.ChatState = status.State
	agent.chat.ChatMessageCount = status.MessageCount
	agent.chat.ChatDeviceCount = status.DeviceCount
	if !status.LastActivity.IsZero() {
		agent.chat.ChatLastActivity = status.LastActivity.Format(time.RFC3339)
	}
	if isTerminalDesktopChatState(status.State) && agent.chat.State == "running" {
		agent.chat.State = desktopTaskStateForChatState(status.State)
		finishedAt := time.Now()
		agent.chat.FinishedAt = &finishedAt
		record := *agent.chat
		agent.addHistoryLocked(record)
		agent.notifyRecordLocked(record)
		delete(agent.notified, record.ID)
		agent.chat = nil
		agent.chatStop = nil
		agent.touchLocked()
		return
	}
	agent.touchLocked()
}

func (agent *desktopAgent) notifyRecordLocked(record desktopAgentTaskRecord) {
	if agent.notifier == nil {
		return
	}
	title, message := desktopAgentNotification(record)
	if title == "" || message == "" {
		return
	}
	_ = agent.notifier(title, message)
}

func (agent *desktopAgent) notifyTransferStatusLocked(record desktopAgentTaskRecord) {
	if agent.notifier == nil {
		return
	}
	key := record.TransferState
	switch key {
	case "transferring", "completed", "stopped", "failed":
	default:
		return
	}
	if agent.notified[record.ID] == nil {
		agent.notified[record.ID] = map[string]bool{}
	}
	if agent.notified[record.ID][key] {
		return
	}
	title, message := desktopAgentTransferNotification(record)
	if title == "" || message == "" {
		return
	}
	agent.notified[record.ID][key] = true
	_ = agent.notifier(title, message)
}

func desktopAgentNotification(record desktopAgentTaskRecord) (string, string) {
	if record.Action == "chat" {
		return "", ""
	}
	action := desktopAgentActionLabel(record.Action)
	target := desktopAgentPathsSummary(record.Paths)
	switch record.State {
	case "running":
		return "eqt transfer ready", fmt.Sprintf("%s ready: %s", action, target)
	case "completed":
		if record.TransferState == "completed" {
			return "", ""
		}
		return "eqt transfer completed", fmt.Sprintf("%s completed: %s", action, target)
	case "failed":
		if record.TransferState == "failed" {
			return "", ""
		}
		if record.Error != "" {
			return "eqt transfer failed", fmt.Sprintf("%s failed: %s", action, record.Error)
		}
		return "eqt transfer failed", fmt.Sprintf("%s failed: %s", action, target)
	case "stopped":
		if record.TransferState == "stopped" {
			return "", ""
		}
		return "eqt transfer stopped", fmt.Sprintf("%s stopped: %s", action, target)
	case "replaced":
		return "eqt transfer replaced", fmt.Sprintf("%s replaced by a newer task: %s", action, target)
	default:
		return "", ""
	}
}

func desktopAgentTransferNotification(record desktopAgentTaskRecord) (string, string) {
	action := desktopAgentActionLabel(record.Action)
	target := desktopAgentPathsSummary(record.Paths)
	if record.TransferCurrent != "" {
		target = record.TransferCurrent
	}
	switch record.TransferState {
	case "transferring":
		return "eqt transfer started", fmt.Sprintf("%s started: %s", action, target)
	case "completed":
		if len(record.SavedFiles) == 1 {
			return "eqt transfer completed", fmt.Sprintf("%s completed: %s", action, record.SavedFiles[0])
		}
		if len(record.SavedFiles) > 1 {
			return "eqt transfer completed", fmt.Sprintf("%s completed: %d files", action, len(record.SavedFiles))
		}
		return "eqt transfer completed", fmt.Sprintf("%s completed: %s", action, target)
	case "stopped":
		return "eqt transfer stopped", fmt.Sprintf("%s stopped: %s", action, target)
	case "failed":
		if record.TransferMessage != "" {
			return "eqt transfer failed", fmt.Sprintf("%s failed: %s", action, record.TransferMessage)
		}
		return "eqt transfer failed", fmt.Sprintf("%s failed: %s", action, target)
	default:
		return "", ""
	}
}

func desktopAgentActionLabel(action string) string {
	switch action {
	case "share":
		return "Share"
	case "receive":
		return "Receive"
	case "chat":
		return "Chat"
	default:
		return action
	}
}

func desktopAgentPathsSummary(paths []string) string {
	switch len(paths) {
	case 0:
		return "no paths"
	case 1:
		return paths[0]
	default:
		return fmt.Sprintf("%d items", len(paths))
	}
}

func displayBaseName(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	value = strings.TrimRight(value, `/\`)
	if value == "" {
		return ""
	}
	index := strings.LastIndexAny(value, `/\`)
	if index >= 0 && index+1 < len(value) {
		return value[index+1:]
	}
	return value
}

func listSummary(values []string, singular string) string {
	switch len(values) {
	case 0:
		return ""
	case 1:
		return displayBaseName(values[0])
	default:
		return fmt.Sprintf("%d %ss", len(values), singular)
	}
}

func desktopAgentPathDisplaySummary(action string, archive bool, archiveName string, paths []string, items []string) string {
	if archive && archiveName != "" {
		return archiveName
	}
	if len(items) > 1 {
		return fmt.Sprintf("%d items", len(items))
	}
	if len(items) == 1 {
		return items[0]
	}
	if action == "receive" {
		return listSummary(paths, "folder")
	}
	return listSummary(paths, "item")
}

func desktopAgentPathDetail(action string, archive bool, archiveName string, paths []string, items []string) string {
	var lines []string
	if archive && archiveName != "" {
		lines = append(lines, "Archive: "+archiveName)
	}
	if len(items) > 0 {
		lines = append(lines, "Items:")
		for _, item := range items {
			lines = append(lines, "  "+item)
		}
	}
	if len(paths) > 0 {
		if len(lines) > 0 {
			lines = append(lines, "")
		}
		lines = append(lines, "Paths:")
		for _, path := range paths {
			lines = append(lines, "  "+path)
		}
	}
	if len(lines) == 0 && action == "receive" {
		return "Current receive folder"
	}
	return strings.Join(lines, "\n")
}

func desktopAgentPathKind(action string, archive bool, paths []string) string {
	if archive || len(paths) > 1 {
		return "archive"
	}
	if action == "receive" {
		return "directory"
	}
	return "file"
}

func (agent *desktopAgent) setTaskStop(action string, stop func(string)) {
	agent.mu.Lock()
	defer agent.mu.Unlock()
	if action == "chat" {
		agent.chatStop = stop
		return
	}
	agent.activeStop = stop
}

func (agent *desktopAgent) setActiveStop(stop func(string)) {
	agent.setTaskStop("share", stop)
}

func (agent *desktopAgent) setTaskPageURL(action string, url string) {
	agent.mu.Lock()
	defer agent.mu.Unlock()
	if action == "chat" {
		if agent.chat != nil && agent.chat.State == "running" {
			agent.chat.PageURL = url
			agent.touchLocked()
		}
		return
	}
	if agent.current != nil && agent.current.State == "running" {
		agent.current.PageURL = url
		agent.touchLocked()
	}
}

func (agent *desktopAgent) setCurrentPageURL(url string) {
	agent.setTaskPageURL("share", url)
}

func (agent *desktopAgent) writeStatus(w http.ResponseWriter) {
	response := agent.snapshot()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(response)
}

func (agent *desktopAgent) snapshot() desktopAgentResponse {
	response, _ := agent.snapshotWithRevision()
	return response
}

func (agent *desktopAgent) snapshotWithRevision() (desktopAgentResponse, int64) {
	agent.mu.Lock()
	defer agent.mu.Unlock()
	var maxDev int
	var actDev int
	if cert, ok := server.GetLocalLicenseInfo(); ok {
		maxDev = cert.MaxDevices
		actDev = cert.ActivatedDevices
	}

	response := desktopAgentResponse{
		State:            "idle",
		Queued:           len(agent.queue),
		History:          cloneDesktopAgentRecords(agent.history),
		LastError:        agent.lastError,
		Version:          version.String(),
		AgentStartedAt:   agent.startedAt,
		ClockTampered:    server.GetClockTamperedStatus(),
		IsPaid:           server.GetPaidStatus(),
		LicenseTier:      server.GetLicenseTier(),
		MaxDevices:       maxDev,
		ActivatedDevices: actDev,
	}
	if agent.busy {
		response.State = "busy"
		if agent.current != nil {
			current := cloneDesktopAgentRecord(*agent.current)
			response.Current = &current
		}
	}
	if agent.chat != nil {
		chat := cloneDesktopAgentRecord(*agent.chat)
		response.Chat = &chat
		if response.State == "idle" {
			response.State = "chat"
		}
	}
	return response, agent.revision
}

func (agent *desktopAgent) addHistoryLocked(record desktopAgentTaskRecord) {
	record = cloneDesktopAgentRecord(record)
	agent.history = append([]desktopAgentTaskRecord{record}, agent.history...)
	if len(agent.history) > desktopAgentMaxHistory {
		agent.history = agent.history[:desktopAgentMaxHistory]
	}
	if err := saveDesktopAgentHistory(agent.historyPath, agent.history); err != nil {
		agent.lastError = fmt.Sprintf("unable to save desktop agent history: %v", err)
	}
}

func (agent *desktopAgent) loadHistory() error {
	history, err := loadDesktopAgentHistory(agent.historyPath)
	if err != nil {
		return err
	}
	nextID := agent.nextID
	for _, record := range history {
		if record.ID > nextID {
			nextID = record.ID
		}
	}
	if len(history) > desktopAgentMaxHistory {
		history = history[:desktopAgentMaxHistory]
	}
	agent.mu.Lock()
	defer agent.mu.Unlock()
	agent.history = cloneDesktopAgentRecords(history)
	agent.nextID = nextID
	agent.touchLocked()
	return nil
}

func (agent *desktopAgent) clearHistory() error {
	agent.mu.Lock()
	agent.history = nil
	agent.lastError = ""
	historyPath := agent.historyPath
	agent.touchLocked()
	agent.mu.Unlock()
	return saveDesktopAgentHistory(historyPath, nil)
}

func loadDesktopAgentHistory(path string) ([]desktopAgentTaskRecord, error) {
	if path == "" {
		return nil, nil
	}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var store desktopAgentHistoryStore
	if err := json.Unmarshal(data, &store); err != nil {
		return nil, err
	}
	return cloneDesktopAgentRecords(store.History), nil
}

func saveDesktopAgentHistory(path string, history []desktopAgentTaskRecord) error {
	if path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(desktopAgentHistoryStore{History: cloneDesktopAgentRecords(history)}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}

func cloneDesktopAgentRecords(records []desktopAgentTaskRecord) []desktopAgentTaskRecord {
	if len(records) == 0 {
		return nil
	}
	cloned := make([]desktopAgentTaskRecord, len(records))
	for index, record := range records {
		cloned[index] = cloneDesktopAgentRecord(record)
	}
	return cloned
}

func cloneDesktopAgentRecord(record desktopAgentTaskRecord) desktopAgentTaskRecord {
	record.Paths = append([]string(nil), record.Paths...)
	record.SavedFiles = append([]string(nil), record.SavedFiles...)
	record.TransferItems = append([]string(nil), record.TransferItems...)
	return record
}

func (agent *desktopAgent) runTask(task desktopAgentTask) error {
	taskID := agent.taskIDForAction(task.Action)
	agent.log.Infof("runTask: preparing to execute task %d (action: %q)", taskID, task.Action)
	agentApp := application.New()
	agentApp.Flags = agent.baseFlags
	agentApp.Flags.Browser = desktopBrowserPreference(agent.baseFlags, true)
	if task.Browser != nil {
		agentApp.Flags.Browser = *task.Browser
	}
	if task.Action == "receive" {
		agentApp.Flags.Output = task.Paths[0]
	}
	desktopSettings, err := agent.readSettings()
	if err != nil {
		agent.log.Errorf("runTask: failed to read desktop settings (using defaults): %v", err)
		desktopSettings = config.DesktopSettings{}
	}
	agent.log.Infof("runTask: creating new qrcp configuration...")
	cfg, err := config.New(agentApp)
	if err != nil {
		agent.log.Errorf("runTask: failed to create qrcp config: %v", err)
		return err
	}
	agent.log.Infof("runTask: instantiating qrcp server...")
	srv, err := server.New(&cfg)
	if err != nil {
		agent.log.Errorf("runTask: failed to instantiate server: %v", err)
		return err
	}
	agent.mu.Lock()
	agent.activeServer = srv
	agent.mu.Unlock()
	defer func() {
		agent.mu.Lock()
		if agent.activeServer == srv {
			agent.activeServer = nil
		}
		agent.mu.Unlock()
	}()
	srv.ChatDebug = desktopSettings.DebugLog
	srv.ViewportDebug = desktopSettings.ViewportDebug
	agent.log.Infof("runTask: server instance created. BaseURL=%s", srv.BaseURL)
	srv.SetStatusHook(func(status server.TransferStatusSnapshot) {
		agent.observeTransferStatus(taskID, status)
	})
	srv.SetRepeatRoute(desktopAgentBaseURL + "/tasks/" + strconv.Itoa(taskID) + "/repeat")
	agent.setTaskStop(task.Action, func(state string) {
		agent.log.Infof("runTask: stop callback triggered for action %q (target state: %s)", task.Action, state)
		if task.Action == "chat" {
			srv.ShutdownChat(state)
			return
		}
		srv.Shutdown()
	})
	switch task.Action {
	case "share":
		agent.setTaskPageURL(task.Action, srv.BaseURL+"/qr")
		payload, err := body.FromArgs(task.Paths, agentApp.Flags.Zip)
		if err != nil {
			agent.log.Errorf("runTask (share): failed to create payload from args: %v", err)
			srv.Shutdown()
			return err
		}
		srv.Send(payload)
		if err := serveDesktopTaskQR(srv, srv.SendURL, agentApp.Flags.Browser); err != nil {
			agent.log.Errorf("runTask (share): failed to serve QR: %v", err)
			srv.Shutdown()
			return err
		}
	case "receive":
		agent.setTaskPageURL(task.Action, srv.BaseURL+"/qr")
		if err := srv.ReceiveTo(cfg.Output); err != nil {
			agent.log.Errorf("runTask (receive): failed to prepare receive path: %v", err)
			srv.Shutdown()
			return err
		}
		if err := serveDesktopTaskQR(srv, srv.ReceiveURL, agentApp.Flags.Browser); err != nil {
			agent.log.Errorf("runTask (receive): failed to serve QR: %v", err)
			srv.Shutdown()
			return err
		}
	case "chat":
		chatPageURLBuilder := func() string {
			return desktopChatPageURL(srv.ChatJoinURL(), srv.ChatHostToken(), desktopSettings.ChatSender, desktopSettings.ChatAvatar)
		}
		agent.log.Infof("runTask (chat): chat join URL = %s", srv.ChatJoinURL())
		if agentApp.Flags.Browser {
			agent.log.Infof("runTask (chat): launching chat in browser...")
			if err := srv.DisplayChatWithURL(chatPageURLBuilder); err != nil {
				agent.log.Errorf("runTask (chat): DisplayChatWithURL failed: %v", err)
				srv.Shutdown()
				return err
			}
		} else {
			agent.log.Infof("runTask (chat): starting chat server listener...")
			if err := srv.Chat(); err != nil {
				agent.log.Errorf("runTask (chat): Chat server failed to start: %v", err)
				srv.Shutdown()
				return err
			}
		}
		chatPageURL := chatPageURLBuilder()
		agent.log.Infof("runTask (chat): chat server active. chatPageURL = %s", chatPageURL)
		agent.setTaskPageURL(task.Action, chatPageURL)
		srv.SetChatHostRenameHook(func(newName string) {
			agent.handleChatHostRename(newName)
		})
		srv.SetChatStatusHook(func(status server.ChatStatusSnapshot) {
			agent.observeChatStatus(taskID, status)
		})
	default:
		srv.Shutdown()
		agent.log.Errorf("runTask: unsupported action %q", task.Action)
		return fmt.Errorf("unsupported desktop action %q", task.Action)
	}
	agent.log.Infof("runTask: server Wait loop entered...")
	waitErr := srv.Wait()
	if waitErr != nil {
		agent.log.Errorf("runTask: server Wait exited with error: %v", waitErr)
	} else {
		agent.log.Infof("runTask: server Wait exited normally")
	}
	return waitErr
}

func serveDesktopTaskQR(srv *server.Server, url string, openBrowser bool) error {
	if openBrowser {
		return srv.DisplayQR(url)
	}
	return srv.ServeQR(url)
}

func desktopChatPageURL(baseURL string, hostToken string, sender string, avatar string) string {
	parsed, err := url.Parse(baseURL)
	if err != nil {
		query := "?peer=desktop&hostToken=" + url.QueryEscape(hostToken)
		if sender = strings.TrimSpace(sender); sender != "" {
			query += "&sender=" + url.QueryEscape(sender)
		}
		if avatar = strings.TrimSpace(avatar); avatar != "" {
			query += "&avatar=" + url.QueryEscape(avatar)
		}
		return baseURL + query
	}
	params := parsed.Query()
	params.Set("peer", "desktop")
	params.Set("hostToken", hostToken)
	if sender = strings.TrimSpace(sender); sender != "" {
		params.Set("sender", sender)
	}
	if avatar = strings.TrimSpace(avatar); avatar != "" {
		params.Set("avatar", avatar)
	}
	parsed.RawQuery = params.Encode()
	return parsed.String()
}

func validateDesktopAgentTask(task desktopAgentTask) error {
	switch task.Action {
	case "share":
		if len(task.Paths) == 0 {
			return fmt.Errorf("share task requires at least one path")
		}
	case "receive":
		if len(task.Paths) != 1 {
			return fmt.Errorf("receive task requires exactly one directory")
		}
	case "chat":
		if len(task.Paths) != 0 {
			return fmt.Errorf("chat task does not accept paths")
		}
	default:
		return fmt.Errorf("unsupported desktop action %q", task.Action)
	}
	return nil
}

var desktopAgentCmd = &cobra.Command{
	Use:   "agent",
	Short: "Run the desktop integration agent",
	Long:  "Run a local desktop integration agent that accepts right-click share and receive tasks.",
	Args:  desktopAgentCommandArgs,
	RunE:  runDesktopAgent,
}

var desktopAgentStartCmd = &cobra.Command{
	Use:   "agent-start",
	Short: "Start the desktop integration agent",
	Long:  "Start the local desktop integration agent that accepts right-click share and receive tasks.",
	Args:  desktopAgentCommandArgs,
	RunE:  runDesktopAgent,
}

func desktopAgentCommandArgs(command *cobra.Command, args []string) error {
	if len(args) == 0 {
		return nil
	}
	if len(args) == 1 && args[0] == "runtime" {
		return fmt.Errorf("use `eqt desktop status` or `eqt desktop agent-status` for runtime details; `%s` starts the foreground agent process", command.CommandPath())
	}
	return fmt.Errorf("%s does not take arguments", command.CommandPath())
}

func runDesktopAgent(command *cobra.Command, args []string) error {
	background := false
	if command.Flags().Lookup("background") != nil {
		value, err := command.Flags().GetBool("background")
		if err != nil {
			return err
		}
		background = value
	}
	if background {
		return runDesktopAgentBackground(command)
	}

	log := logger.New(app.Flags.Quiet)
	log.Infof("Starting desktop agent...")

	log.Infof("Creating new desktop agent instance")
	agent := newDesktopAgent(app.Flags)

	log.Infof("Loading desktop agent history from path: %s", agent.historyPath)
	if err := agent.loadHistory(); err != nil {
		log.Errorf("Failed to load desktop agent history: %v", err)
		agent.lastError = fmt.Sprintf("unable to load desktop agent history: %v", err)
	} else {
		log.Infof("Successfully loaded %d history records", len(agent.history))
	}

	basePort := 48176
	if portStr := os.Getenv("EQT_AGENT_PORT"); portStr != "" {
		if p, err := strconv.Atoi(portStr); err == nil {
			basePort = p
		}
	}

	var listener net.Listener
	actualPort := basePort

	for i := 0; i < 20; i++ {
		currPort := basePort + i
		addr := fmt.Sprintf("127.0.0.1:%d", currPort)
		healthURL := fmt.Sprintf("http://%s/health", addr)
		response, healthErr := http.Get(healthURL)
		if healthErr == nil {
			response.Body.Close()
			if response.StatusCode == http.StatusNoContent {
				log.Infof("Another running desktop agent instance detected at %s", addr)
				return fmt.Errorf("desktop agent is already running at http://%s; use `eqt desktop agent-open`, `eqt desktop agent-status`, or `eqt desktop status`", addr)
			}
		}

		l, listenErr := net.Listen("tcp", addr)
		if listenErr == nil {
			listener = l
			actualPort = currPort
			break
		}
		log.Errorf("Port %d is in use or reserved: %v, trying next...", currPort, listenErr)
	}

	if listener == nil {
		log.Infof("All default ports %d-%d are in use or reserved. Attempting dynamic port allocation (port 0)...", basePort, basePort+19)
		l, listenErr := net.Listen("tcp", "127.0.0.1:0")
		if listenErr != nil {
			return fmt.Errorf("unable to find any available port and dynamic allocation failed: %w", listenErr)
		}
		listener = l
		actualPort = l.Addr().(*net.TCPAddr).Port
		log.Infof("Successfully allocated dynamic port %d", actualPort)
	}

	desktopAgentAddress = fmt.Sprintf("127.0.0.1:%d", actualPort)
	desktopAgentBaseURL = "http://" + desktopAgentAddress

	portFilePath := desktopAgentPortFilePath()
	if err := os.WriteFile(portFilePath, []byte(strconv.Itoa(actualPort)), 0644); err != nil {
		log.Errorf("Failed to write runtime agent.port file: %v", err)
	} else {
		log.Infof("Successfully recorded active port %d to runtime file: %s", actualPort, portFilePath)
	}

	log.Infof("Setting up HTTP server on address: %s", desktopAgentAddress)
	server := &http.Server{Addr: desktopAgentAddress, Handler: agent.routes()}
	agent.shutdown = func() {
		log.Infof("Shutting down HTTP server")
		_ = os.Remove(portFilePath)
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}

	log.Infof("Desktop agent listening on http://%s", desktopAgentAddress)
	command.Printf("Desktop agent listening on http://%s\n", desktopAgentAddress)

	log.Infof("HTTP server Serve starts")
	if serveErr := server.Serve(listener); serveErr != nil && serveErr != http.ErrServerClosed {
		log.Errorf("HTTP server Serve exited with error: %v", serveErr)
		return serveErr
	}
	log.Infof("HTTP server exited cleanly")
	return nil
}

var desktopAgentRestartHelperCmd = &cobra.Command{
	Use:    "agent-restart-helper",
	Hidden: true,
	Args:   cobra.NoArgs,
	RunE: func(command *cobra.Command, args []string) error {
		time.Sleep(800 * time.Millisecond)
		return runDesktopAgent(command, args)
	},
}

func runDesktopAgentBackground(command *cobra.Command) error {
	portFilePath := desktopAgentPortFilePath()
	activePort := 0
	if data, err := os.ReadFile(portFilePath); err == nil {
		if portVal := strings.TrimSpace(string(data)); portVal != "" {
			if p, err := strconv.Atoi(portVal); err == nil {
				activePort = p
			}
		}
	}

	basePort := 48176
	if portStr := os.Getenv("EQT_AGENT_PORT"); portStr != "" {
		if p, err := strconv.Atoi(portStr); err == nil {
			basePort = p
		}
	}

	if activePort != 0 {
		desktopAgentAddress = fmt.Sprintf("127.0.0.1:%d", activePort)
		desktopAgentBaseURL = "http://" + desktopAgentAddress
		if _, err := fetchDesktopAgentStatus(); err != nil {
			activePort = 0
		}
	}

	if activePort == 0 {
		for i := 0; i < 20; i++ {
			currPort := basePort + i
			addr := fmt.Sprintf("127.0.0.1:%d", currPort)
			response, healthErr := http.Get(fmt.Sprintf("http://%s/health", addr))
			if healthErr == nil {
				response.Body.Close()
				if response.StatusCode == http.StatusNoContent {
					activePort = currPort
					_ = os.WriteFile(portFilePath, []byte(strconv.Itoa(activePort)), 0644)
					break
				}
			}
		}
	}

	if activePort != 0 {
		desktopAgentAddress = fmt.Sprintf("127.0.0.1:%d", activePort)
		desktopAgentBaseURL = "http://" + desktopAgentAddress
		if _, err := fetchDesktopAgentStatus(); err == nil {
			fmt.Fprintf(command.OutOrStdout(), "Desktop agent is already running at %s.\n", desktopAgentBaseURL)
			return nil
		}
	}

	exe, err := desktopAgentExecutable()
	if err != nil {
		return err
	}
	logFile, logPath, err := createDesktopAgentBackgroundLog()
	if err != nil {
		return err
	}
	err = desktopAgentBackgroundStarter(exe, logFile)
	logFile.Close()
	if err != nil {
		return err
	}
	if err := desktopAgentReadyWaiter(10 * time.Second); err != nil {
		if detail := readDesktopAgentLogPortConflict(logPath); detail != "" {
			return fmt.Errorf("desktop agent background start failed: port %s is already in use by another process that is not responding; stop that process and try again; log: %s", desktopAgentAddress, logPath)
		}
		var logTail string
		if data, tailErr := os.ReadFile(logPath); tailErr == nil {
			logTail = string(data)
			if len(logTail) > 1000 {
				logTail = logTail[len(logTail)-1000:]
			}
		}
		if logTail != "" {
			return fmt.Errorf("desktop agent background start failed: %w;\nLog path: %s\nLog content:\n%s", err, logPath, logTail)
		}
		return fmt.Errorf("desktop agent background start failed: %w; log: %s", err, logPath)
	}
	fmt.Fprintf(command.OutOrStdout(), "Desktop agent started in background.\nStatus: %s/\nLog: %s\n", desktopAgentBaseURL, logPath)
	return nil
}

func createDesktopAgentBackgroundLog() (*os.File, string, error) {
	dir, err := os.UserCacheDir()
	if err != nil {
		dir = os.TempDir()
	}
	dir = filepath.Join(dir, application.New().Name)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, "", err
	}
	file, err := os.CreateTemp(dir, "agent-*.log")
	if err != nil {
		return nil, "", err
	}
	return file, file.Name(), nil
}

func startDesktopAgentBackgroundProcess(exe string, logFile *os.File) error {
	cmd := exec.Command(exe, "desktop", "agent")
	configureDesktopAgentBackgroundCommand(cmd)
	if logFile != nil {
		cmd.Stdout = logFile
		cmd.Stderr = logFile
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

func waitForDesktopAgentReady(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var lastErr error
	portFilePath := desktopAgentPortFilePath()
	for time.Now().Before(deadline) {
		if data, err := os.ReadFile(portFilePath); err == nil {
			if portVal := strings.TrimSpace(string(data)); portVal != "" {
				desktopAgentAddress = "127.0.0.1:" + portVal
				desktopAgentBaseURL = "http://" + desktopAgentAddress
			}
		}

		response, err := http.Get(desktopAgentBaseURL + "/health")
		if err == nil {
			response.Body.Close()
			if response.StatusCode == http.StatusNoContent {
				return nil
			}
			lastErr = fmt.Errorf("desktop agent health returned %s", response.Status)
		} else {
			lastErr = err
		}
		time.Sleep(100 * time.Millisecond)
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("desktop agent did not become ready")
	}
	return lastErr
}

var desktopAgentPortFilePath = defaultDesktopAgentPortFilePath

func defaultDesktopAgentPortFilePath() string {
	dir, err := os.UserCacheDir()
	if err != nil {
		dir = os.TempDir()
	}
	return filepath.Join(dir, "eqt", "agent.port")
}

func desktopAgentAddressInUse(err error) bool {
	message := err.Error()
	return strings.Contains(message, "address already in use") || strings.Contains(message, "Only one usage of each socket address")
}

func readDesktopAgentLogPortConflict(logPath string) string {
	data, err := os.ReadFile(logPath)
	if err != nil {
		return ""
	}
	content := string(data)
	if strings.Contains(content, "address already in use") || strings.Contains(content, "Only one usage of each socket address") {
		return content
	}
	return ""
}

var desktopAgentHistoryClearCmd = &cobra.Command{
	Use:   "agent-history-clear",
	Short: "Clear desktop integration agent history",
	Long:  "Clear recent task history stored by the local desktop integration agent.",
	RunE: func(command *cobra.Command, args []string) error {
		request, err := http.NewRequest(http.MethodDelete, desktopAgentBaseURL+"/history", nil)
		if err != nil {
			return err
		}
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			return fmt.Errorf("desktop agent is not running: %w", err)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusNoContent {
			details, _ := io.ReadAll(io.LimitReader(response.Body, 1000))
			message := strings.TrimSpace(string(details))
			if message == "" {
				message = response.Status
			}
			return fmt.Errorf("desktop agent history clear failed: %s", message)
		}
		fmt.Fprintln(command.OutOrStdout(), "Desktop agent history cleared.")
		return nil
	},
}

var desktopAgentStopCmd = &cobra.Command{
	Use:   "agent-stop",
	Short: "Stop the desktop integration agent",
	Long:  "Stop the local desktop integration agent if it is running.",
	RunE: func(command *cobra.Command, args []string) error {
		response, err := http.Post(desktopAgentBaseURL+"/shutdown", "text/plain", nil)
		if err != nil {
			return fmt.Errorf("desktop agent is not running: %w", err)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusAccepted {
			return fmt.Errorf("desktop agent stop failed: %s", response.Status)
		}
		fmt.Fprintln(command.OutOrStdout(), "Desktop agent stopped.")
		return nil
	},
}

var desktopAgentStopCurrentCmd = &cobra.Command{
	Use:   "agent-stop-current",
	Short: "Stop the current desktop integration agent task",
	Long:  "Stop the active share or receive task without stopping the local desktop integration agent.",
	RunE: func(command *cobra.Command, args []string) error {
		response, err := http.Post(desktopAgentBaseURL+"/stop-current", "text/plain", nil)
		if err != nil {
			return fmt.Errorf("desktop agent is not running: %w", err)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusAccepted {
			details, _ := io.ReadAll(io.LimitReader(response.Body, 1000))
			message := strings.TrimSpace(string(details))
			if message == "" {
				message = response.Status
			}
			return fmt.Errorf("desktop agent stop-current failed: %s", message)
		}
		fmt.Fprintln(command.OutOrStdout(), "Current desktop agent task stopped.")
		return nil
	},
}

var desktopAgentStatusCmd = &cobra.Command{
	Use:   "agent-status",
	Short: "Show desktop integration agent status",
	Long:  "Show the local desktop integration agent status and recent task history.",
	RunE: func(command *cobra.Command, args []string) error {
		status, err := fetchDesktopAgentStatus()
		if err != nil {
			return err
		}
		fmt.Fprint(command.OutOrStdout(), formatDesktopAgentStatus(status))
		return nil
	},
}

var desktopAgentOpenCmd = &cobra.Command{
	Use:   "agent-open",
	Short: "Open the desktop integration agent status page",
	Long:  "Open the local desktop integration agent status page in the default browser.",
	RunE: func(command *cobra.Command, args []string) error {
		response, err := http.Get(desktopAgentBaseURL + "/health")
		if err != nil {
			return fmt.Errorf("desktop agent is not running: %w", err)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusNoContent {
			return fmt.Errorf("desktop agent health check failed: %s", response.Status)
		}
		if err := openDesktopAgentPage(desktopAgentBaseURL + "/"); err != nil {
			return err
		}
		fmt.Fprintln(command.OutOrStdout(), "Desktop agent status page opened.")
		return nil
	},
}

var desktopAgentOpenCurrentCmd = &cobra.Command{
	Use:   "agent-open-current",
	Short: "Open the current desktop integration QR page",
	Long:  "Open the active desktop integration task QR page in the default browser.",
	RunE: func(command *cobra.Command, args []string) error {
		status, err := fetchDesktopAgentStatus()
		if err != nil {
			return err
		}
		if status.Current == nil || status.Current.PageURL == "" {
			return fmt.Errorf("desktop agent has no active QR page")
		}
		if err := openDesktopAgentPage(status.Current.PageURL); err != nil {
			return err
		}
		fmt.Fprintln(command.OutOrStdout(), "Current desktop agent QR page opened.")
		return nil
	},
}

func openDesktopAgentPageURL(url string) error {
	switch runtime.GOOS {
	case "linux":
		return exec.Command("xdg-open", url).Start()
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		return exec.Command("open", url).Start()
	default:
		return fmt.Errorf("failed to open browser on platform: %s", runtime.GOOS)
	}
}

func notifyDesktop(title string, message string) error {
	switch runtime.GOOS {
	case "windows":
		return notifyDesktopWindows(title, message)
	case "linux":
		if os.Getenv("DISPLAY") == "" && os.Getenv("WAYLAND_DISPLAY") == "" {
			return nil
		}
		return exec.Command("notify-send", title, message).Start()
	case "darwin":
		script := fmt.Sprintf("display notification %s with title %s", appleScriptString(message), appleScriptString(title))
		return exec.Command("osascript", "-e", script).Start()
	default:
		return nil
	}
}

func notifyDesktopWindowsBalloon(title string, message string) error {
	script := fmt.Sprintf(
		`Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.BalloonTipTitle = %s; $n.BalloonTipText = %s; $n.Visible = $true; $n.ShowBalloonTip(5000); Start-Sleep -Seconds 6; $n.Dispose()`,
		powershellString(title),
		powershellString(message),
	)
	cmd := exec.Command("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", script)
	configureDesktopAgentBackgroundCommand(cmd)
	return cmd.Start()
}

func powershellString(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func appleScriptString(value string) string {
	return `"` + strings.ReplaceAll(strings.ReplaceAll(value, `\`, `\\`), `"`, `\"`) + `"`
}

func fetchDesktopAgentStatus() (desktopAgentResponse, error) {
	response, err := http.Get(desktopAgentBaseURL + "/status")
	if err != nil {
		return desktopAgentResponse{}, fmt.Errorf("desktop agent is not running: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		details, _ := io.ReadAll(io.LimitReader(response.Body, 1000))
		message := strings.TrimSpace(string(details))
		if message == "" {
			message = response.Status
		}
		return desktopAgentResponse{}, fmt.Errorf("desktop agent status failed: %s", message)
	}
	var status desktopAgentResponse
	if err := json.NewDecoder(response.Body).Decode(&status); err != nil {
		return desktopAgentResponse{}, err
	}
	return status, nil
}

func formatDesktopAgentStatus(status desktopAgentResponse) string {
	var builder strings.Builder
	builder.WriteString("Desktop agent status\n")
	builder.WriteString(fmt.Sprintf("- state: %s\n", status.State))
	builder.WriteString(fmt.Sprintf("- queued: %d\n", status.Queued))
	builder.WriteString(fmt.Sprintf("- version: %s\n", status.Version))
	builder.WriteString(fmt.Sprintf("- agent started: %s\n", status.AgentStartedAt.Format(time.RFC3339)))
	if status.Current != nil {
		builder.WriteString("- current:\n")
		writeDesktopAgentRecord(&builder, *status.Current, "  ")
	}
	if status.LastError != "" {
		builder.WriteString(fmt.Sprintf("- last error: %s\n", status.LastError))
	}
	if len(status.History) == 0 {
		builder.WriteString("- history: empty\n")
		return builder.String()
	}
	builder.WriteString("- history:\n")
	for _, record := range status.History {
		writeDesktopAgentRecord(&builder, record, "  ")
	}
	builder.WriteString("- repeat: use the browser agent page Transfer again button for a history item\n")
	return builder.String()
}

func writeDesktopAgentRecord(builder *strings.Builder, record desktopAgentTaskRecord, indent string) {
	builder.WriteString(fmt.Sprintf("%s- #%d %s %s\n", indent, record.ID, record.Action, record.State))
	if len(record.Paths) > 0 {
		builder.WriteString(fmt.Sprintf("%s  paths: %s\n", indent, strings.Join(record.Paths, ", ")))
	}
	if record.PageURL != "" {
		builder.WriteString(fmt.Sprintf("%s  qr page: %s\n", indent, record.PageURL))
	}
	if record.Action == "chat" {
		if record.ChatState != "" {
			builder.WriteString(fmt.Sprintf("%s  chat: %s", indent, record.ChatState))
			if record.ChatMessageCount > 0 {
				builder.WriteString(fmt.Sprintf(" (%d messages)", record.ChatMessageCount))
			}
			if record.ChatDeviceCount > 0 {
				builder.WriteString(fmt.Sprintf(", %d devices", record.ChatDeviceCount))
			}
			builder.WriteString("\n")
		}
		if record.ChatLastActivity != "" {
			builder.WriteString(fmt.Sprintf("%s  last activity: %s\n", indent, record.ChatLastActivity))
		}
	} else {
		if record.TransferState != "" {
			builder.WriteString(fmt.Sprintf("%s  transfer: %s", indent, record.TransferState))
			if record.TransferPercent > 0 {
				builder.WriteString(fmt.Sprintf(" %d%%", record.TransferPercent))
			}
			builder.WriteString("\n")
		}
		if record.TransferMessage != "" {
			builder.WriteString(fmt.Sprintf("%s  transfer message: %s\n", indent, record.TransferMessage))
		}
		if record.TransferCurrent != "" {
			builder.WriteString(fmt.Sprintf("%s  current file: %s\n", indent, record.TransferCurrent))
		}
		if len(record.SavedFiles) > 0 {
			builder.WriteString(fmt.Sprintf("%s  saved files: %s\n", indent, strings.Join(record.SavedFiles, ", ")))
		}
	}
	if !record.StartedAt.IsZero() {
		builder.WriteString(fmt.Sprintf("%s  started: %s\n", indent, record.StartedAt.Format(time.RFC3339)))
	}
	if record.FinishedAt != nil {
		builder.WriteString(fmt.Sprintf("%s  finished: %s\n", indent, record.FinishedAt.Format(time.RFC3339)))
	}
	if record.Error != "" {
		builder.WriteString(fmt.Sprintf("%s  error: %s\n", indent, record.Error))
	}
}

var desktopAgentPageTemplate = template.Must(template.New("desktop-agent").Funcs(template.FuncMap{
	"formatTime": func(value time.Time) string {
		if value.IsZero() {
			return ""
		}
		return value.Format("2006-01-02 15:04:05")
	},
	"formatFinished": func(value *time.Time) string {
		if value == nil || value.IsZero() {
			return ""
		}
		return value.Format("2006-01-02 15:04:05")
	},
	"collapseID": func(prefix string, recordID int, field string) string {
		return fmt.Sprintf("%s-%d-%s", prefix, recordID, field)
	},
	"dict": func(values ...string) map[string]string {
		result := make(map[string]string, len(values)/2)
		for index := 0; index+1 < len(values); index += 2 {
			result[values[index]] = values[index+1]
		}
		return result
	},
	"joinPaths": func(paths []string) string {
		return strings.Join(paths, ", ")
	},
	"joinLines": func(paths []string) string {
		return strings.Join(paths, "\n")
	},
	"baseName": displayBaseName,
	"savedSummary": func(paths []string) string {
		return listSummary(paths, "file")
	},
	"pathsSummary": desktopAgentPathDisplaySummary,
	"pathsDetail":  desktopAgentPathDetail,
	"pathsKind":    desktopAgentPathKind,
}).Parse(`{{define "detailCell"}}{{if .Value}}<button class="detail-cell kind-{{.Kind}}" type="button" data-detail-label="{{.Label}}" data-detail-value="{{.Value}}"><span class="kind-dot"></span><span class="detail-cell-text" title="{{.Value}}">{{if .Display}}{{.Display}}{{else}}{{.Value}}{{end}}</span></button>{{end}}{{end}}<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>eqt Agent</title>
<style>
:root {
  color-scheme: light;
  --bg: #f6f7f9;
  --panel: #ffffff;
  --text: #1f2933;
  --muted: #64748b;
  --line: #d7dde5;
  --accent: #2563eb;
  --danger: #b91c1c;
  --ok: #047857;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 15px;
}
main {
  width: min(960px, calc(100% - 32px));
  margin: 32px auto;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}
h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
}
h2 {
  margin: 0 0 12px;
  font-size: 18px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
button, a.button {
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fff;
  color: var(--text);
  cursor: pointer;
  display: inline-flex;
  min-height: 36px;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
  text-decoration: none;
  font: inherit;
}
button.primary { border-color: var(--accent); color: var(--accent); }
button.danger { border-color: var(--danger); color: var(--danger); }
section {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  margin-bottom: 16px;
  padding: 18px;
}
.summary {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}
.metric {
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 12px;
}
.label {
  color: var(--muted);
  font-size: 13px;
}
.value {
  margin-top: 4px;
  font-weight: 700;
  overflow-wrap: anywhere;
}
.state-busy, .state-transferring, .state-waiting { color: var(--accent); }
.state-idle, .state-completed { color: var(--ok); }
.state-failed, .state-replaced, .state-stopped { color: var(--danger); }
table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
th, td {
  border-top: 1px solid var(--line);
  padding: 10px 8px;
  text-align: left;
  vertical-align: top;
  min-width: 0;
}
th {
  color: var(--muted);
  font-size: 13px;
  font-weight: 600;
}
.table-wrap {
  overflow-x: auto;
}
.detail-cell {
  width: 100%;
  min-height: 28px;
  display: inline-grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  border: 0;
  border-radius: 5px;
  padding: 3px 6px;
  background: #f8fafc;
  color: var(--text);
  text-align: left;
}
.detail-cell-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kind-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--muted);
}
.kind-file .kind-dot { background: var(--accent); }
.kind-directory .kind-dot { background: var(--ok); }
.kind-archive .kind-dot { background: #c2410c; }
.kind-file { background: #eff6ff; }
.kind-directory { background: #ecfdf5; }
.kind-archive { background: #fff7ed; }
.detail-cell:hover {
  outline: 1px solid var(--accent);
}
.current-actions {
  display: flex;
  gap: 6px;
}
.detail-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.42);
}
.detail-backdrop.open {
  display: flex;
}
.detail-dialog {
  width: min(760px, 100%);
  max-height: min(70vh, 680px);
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 20px 55px rgba(15, 23, 42, 0.22);
}
.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--line);
  padding: 12px 14px;
}
.detail-title {
  margin: 0;
  font-size: 16px;
}
.detail-body {
  max-height: calc(min(70vh, 680px) - 58px);
  overflow: auto;
  padding: 14px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.45;
}
.detail-footer {
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid var(--line);
  padding: 10px 14px;
}
.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.field label {
  display: block;
  color: var(--muted);
  font-size: 13px;
  margin-bottom: 4px;
}
.field input, .field select {
  width: 100%;
  min-height: 36px;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 0 10px;
  font: inherit;
  background: #fff;
}
.field.checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
}
.field.checkbox input {
  width: auto;
  min-height: 0;
}
.field.checkbox label {
  margin: 0;
  color: var(--text);
}
.settings-status {
  margin: 10px 0 0;
  color: var(--muted);
}
.empty {
  color: var(--muted);
  margin: 0;
}
@media (max-width: 720px) {
  main { width: min(100% - 20px, 960px); margin: 20px auto; }
  header { align-items: flex-start; flex-direction: column; }
  .summary { grid-template-columns: 1fr; }
  .settings-grid { grid-template-columns: 1fr; }
  table, thead, tbody, th, td, tr { display: block; }
  thead { display: none; }
  tr { border-top: 1px solid var(--line); padding: 8px 0; }
  td { border-top: 0; padding: 4px 0; }
  td::before { color: var(--muted); content: attr(data-label) ": "; font-weight: 600; }
}
</style>
</head>
<body>
<main>
  <header>
    <h1>eqt Agent</h1>
    <div class="actions">
      <button id="restart-agent" type="button">Restart Agent</button>
      <button id="clear-history" type="button">Clear History</button>
      <form method="post" action="/shutdown"><button class="danger" type="submit">Stop Agent</button></form>
    </div>
  </header>

  <section>
    <h2>Status</h2>
    <div class="summary">
      <div class="metric">
        <div class="label">State</div>
        <div id="agent-state" class="value state-{{.State}}">{{.State}}</div>
      </div>
      <div class="metric">
        <div class="label">Queued</div>
        <div id="agent-queued" class="value">{{.Queued}}</div>
      </div>
      <div class="metric">
        <div class="label">Version</div>
        <div id="agent-version" class="value">{{.Version}}</div>
      </div>
      <div class="metric">
        <div class="label">Started</div>
        <div id="agent-started" class="value">{{formatTime .AgentStartedAt}}</div>
      </div>
      <div class="metric">
        <div class="label">Last Error</div>
        <div id="agent-last-error" class="value">{{if .LastError}}{{.LastError}}{{else}}None{{end}}</div>
      </div>
    </div>
  </section>

  <section>
    <h2>Settings</h2>
    <form id="settings-form">
      <div class="settings-grid">
        <div class="field">
          <label for="settings-output">Output directory</label>
          <input id="settings-output" name="output" autocomplete="off">
        </div>
        <div class="field">
          <label for="settings-interface">Interface</label>
          <select id="settings-interface" name="interface"></select>
        </div>
        <div class="field">
          <label for="settings-port">Port</label>
          <input id="settings-port" name="port" type="number" min="0" max="65535" step="1">
          <p class="settings-status">Use 0 to automatically choose an available port. Fixed ports can fail when another process already uses them.</p>
        </div>
        <div class="field">
          <label for="settings-config">Config file</label>
          <input id="settings-config" name="configPath" readonly>
        </div>
        <div class="field checkbox">
          <input id="settings-browser" name="browser" type="checkbox">
          <label for="settings-browser">Open browser pages automatically</label>
        </div>
        <div class="field checkbox">
          <input id="settings-chat-autosave" name="chatAutoSave" type="checkbox">
          <label for="settings-chat-autosave">Auto-save chat attachments</label>
        </div>
        <div class="field">
          <label for="settings-chat-sender">Chat username</label>
          <input id="settings-chat-sender" name="chatSender" autocomplete="off" maxlength="40">
        </div>
        <div class="field">
          <label for="settings-chat-avatar">Chat avatar badge</label>
          <input id="settings-chat-avatar" name="chatAvatar" autocomplete="off" maxlength="8" placeholder="Emoji or initials">
          <p class="settings-status">Use an emoji or 1-4 initials. New desktop chat sessions sync this badge to other devices.</p>
        </div>
        <div class="field">
          <label for="settings-close-behavior">Window close action</label>
          <select id="settings-close-behavior" name="closeBehavior">
            <option value="tray">Keep EQT in taskbar tray</option>
            <option value="quit">Quit EQT completely</option>
          </select>
        </div>
      </div>
      <div class="actions" style="margin-top: 12px;">
        <button class="primary" type="submit">Save Settings</button>
      </div>
      <p id="settings-status" class="settings-status">Loading settings.</p>
      <p class="settings-status">Config is stored in the current user's config directory so installed application files can stay read-only.</p>
    </form>
  </section>

	  <section>
	    <h2>Current</h2>
	    <p class="empty">Current keeps the active task visible while its QR service is still running, even after the transfer already reached a final state.</p>
	    <div id="agent-current">
	    {{if .Current}}
    <div class="table-wrap">
    <table>
      <thead><tr><th>ID</th><th>Action</th><th>State</th><th>Transfer</th><th>Current File</th><th>Saved Files</th><th>QR Page</th><th>Paths</th><th>Started</th><th>Actions</th></tr></thead>
      <tbody>
        <tr>
          <td data-label="ID">#{{.Current.ID}}</td>
          <td data-label="Action">{{.Current.Action}}</td>
          <td data-label="State" class="state-{{.Current.State}}">{{.Current.State}}</td>
          <td data-label="Transfer">{{if .Current.TransferState}}{{.Current.TransferState}} {{if .Current.TransferPercent}}{{.Current.TransferPercent}}%{{end}}{{end}}</td>
          <td data-label="Current File">{{template "detailCell" (dict "Label" "Current File" "Kind" "file" "Display" (baseName .Current.TransferCurrent) "Value" .Current.TransferCurrent)}}</td>
          <td data-label="Saved Files">{{template "detailCell" (dict "Label" "Saved Files" "Kind" "file" "Display" (savedSummary .Current.SavedFiles) "Value" (joinLines .Current.SavedFiles))}}</td>
          <td data-label="QR Page">{{if .Current.PageURL}}<a href="{{.Current.PageURL}}">Open QR Page</a>{{end}}</td>
          <td data-label="Paths">{{template "detailCell" (dict "Label" "Paths" "Kind" (pathsKind .Current.Action .Current.TransferArchive .Current.Paths) "Display" (pathsSummary .Current.Action .Current.TransferArchive .Current.TransferArchiveName .Current.Paths .Current.TransferItems) "Value" (pathsDetail .Current.Action .Current.TransferArchive .Current.TransferArchiveName .Current.Paths .Current.TransferItems))}}</td>
          <td data-label="Started">{{formatTime .Current.StartedAt}}</td>
          <td data-label="Actions"><button class="primary" type="button" data-stop-current="true">Stop Current</button></td>
        </tr>
      </tbody>
    </table>
    </div>
    {{else}}
    <p class="empty">No active task.</p>
    {{end}}
    </div>
  </section>

	  <section>
	    <h2>History</h2>
	    <p class="empty">History contains finalized tasks after the QR service has exited and the task is fully closed out.</p>
	    <div id="agent-history">
    {{if .History}}
    <div class="table-wrap">
    <table>
      <thead><tr><th>ID</th><th>Action</th><th>State</th><th>Transfer</th><th>Current File</th><th>Saved Files</th><th>Paths</th><th>Started</th><th>Finished</th><th>Error</th><th>Actions</th></tr></thead>
      <tbody>
        {{range .History}}
        <tr>
          <td data-label="ID">#{{.ID}}</td>
          <td data-label="Action">{{.Action}}</td>
          <td data-label="State" class="state-{{.State}}">{{.State}}</td>
          <td data-label="Transfer">{{if .TransferState}}{{.TransferState}} {{if .TransferPercent}}{{.TransferPercent}}%{{end}}{{end}}</td>
          <td data-label="Current File">{{template "detailCell" (dict "Label" "Current File" "Kind" "file" "Display" (baseName .TransferCurrent) "Value" .TransferCurrent)}}</td>
          <td data-label="Saved Files">{{template "detailCell" (dict "Label" "Saved Files" "Kind" "file" "Display" (savedSummary .SavedFiles) "Value" (joinLines .SavedFiles))}}</td>
          <td data-label="Paths">{{template "detailCell" (dict "Label" "Paths" "Kind" (pathsKind .Action .TransferArchive .Paths) "Display" (pathsSummary .Action .TransferArchive .TransferArchiveName .Paths .TransferItems) "Value" (pathsDetail .Action .TransferArchive .TransferArchiveName .Paths .TransferItems))}}</td>
          <td data-label="Started">{{formatTime .StartedAt}}</td>
          <td data-label="Finished">{{formatFinished .FinishedAt}}</td>
          <td data-label="Error">{{.Error}}</td>
          <td data-label="Actions"><button type="button" data-repeat-id="{{.ID}}">Transfer again</button></td>
        </tr>
        {{end}}
      </tbody>
    </table>
    </div>
    {{else}}
    <p class="empty">No history yet.</p>
    {{end}}
    </div>
  </section>
</main>
<div id="detail-backdrop" class="detail-backdrop" role="dialog" aria-modal="true" aria-labelledby="detail-title">
  <div class="detail-dialog">
    <div class="detail-header">
      <h2 id="detail-title" class="detail-title">Details</h2>
      <button id="detail-close" type="button">Close</button>
    </div>
    <div id="detail-body" class="detail-body"></div>
    <div class="detail-footer"><button id="detail-copy" type="button">Copy</button></div>
  </div>
</div>
<script>
function setText(id, value) {
  document.getElementById(id).textContent = value;
}
var currentDetailValue = '';
function setStateClass(element, state) {
  element.className = 'value state-' + state;
}
function formatAgentTime(value) {
  if (!value) {
    return '';
  }
  var date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}
function appendCell(row, label, value, className) {
  var cell = document.createElement('td');
  cell.setAttribute('data-label', label);
  if (className && className.indexOf('detail') !== 0) {
    cell.className = className;
  }
  if (className && className.indexOf('detail') === 0) {
    var parts = className.split(':');
    renderDetailCell(cell, label, value || '', parts[1] || 'file', decodeClassPart(parts[2] || ''));
  } else {
    cell.textContent = value || '';
  }
  row.appendChild(cell);
}
function renderDetailCell(cell, label, value, kind, display) {
  if (!value) {
    cell.textContent = '';
    return;
  }
  var content = document.createElement('button');
  content.type = 'button';
  content.className = 'detail-cell kind-' + (kind || 'file');
  content.setAttribute('data-detail-label', label || 'Details');
  content.setAttribute('data-detail-value', value);
  content.title = value;
  var dot = document.createElement('span');
  dot.className = 'kind-dot';
  content.appendChild(dot);
  var text = document.createElement('span');
  text.className = 'detail-cell-text';
  text.textContent = display || displayValue(value);
  content.appendChild(text);
  cell.appendChild(content);
}
function appendLinkCell(row, label, href, text) {
  var cell = document.createElement('td');
  cell.setAttribute('data-label', label);
  if (href) {
    var link = document.createElement('a');
    link.href = href;
    link.textContent = text;
    cell.appendChild(link);
  }
  row.appendChild(cell);
}
function renderCurrent(record) {
  var container = document.getElementById('agent-current');
  container.innerHTML = '';
  if (!record) {
    var empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No active task.';
    container.appendChild(empty);
    return;
  }
  var wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  var table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>ID</th><th>Action</th><th>State</th><th>Transfer</th><th>Current File</th><th>Saved Files</th><th>QR Page</th><th>Paths</th><th>Started</th><th>Actions</th></tr></thead>';
  var body = document.createElement('tbody');
  var row = document.createElement('tr');
  appendCell(row, 'ID', '#' + record.id);
  appendCell(row, 'Action', record.action);
  appendCell(row, 'State', record.state, 'state-' + record.state);
  appendCell(row, 'Transfer', transferText(record));
  appendCell(row, 'Current File', record.transferCurrent || '', 'detail:file:' + encodeClassPart(baseName(record.transferCurrent || '')));
  appendCell(row, 'Saved Files', (record.savedFiles || []).join('\n'), 'detail:file:' + encodeClassPart(listSummary(record.savedFiles || [], 'file')));
  appendLinkCell(row, 'QR Page', record.pageUrl, 'Open QR Page');
  appendCell(row, 'Paths', pathDetail(record), 'detail:' + pathKind(record) + ':' + encodeClassPart(pathSummary(record)));
  appendCell(row, 'Started', formatAgentTime(record.startedAt));
  appendStopCurrentCell(row);
  body.appendChild(row);
  table.appendChild(body);
  wrap.appendChild(table);
  container.appendChild(wrap);
}
function renderHistory(records) {
  var container = document.getElementById('agent-history');
  container.innerHTML = '';
  if (!records || !records.length) {
    var empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No history yet.';
    container.appendChild(empty);
    return;
  }
  var wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  var table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>ID</th><th>Action</th><th>State</th><th>Transfer</th><th>Current File</th><th>Saved Files</th><th>Paths</th><th>Started</th><th>Finished</th><th>Error</th><th>Actions</th></tr></thead>';
  var body = document.createElement('tbody');
  records.forEach(function(record) {
    var row = document.createElement('tr');
    appendCell(row, 'ID', '#' + record.id);
    appendCell(row, 'Action', record.action);
    appendCell(row, 'State', record.state, 'state-' + record.state);
    appendCell(row, 'Transfer', transferText(record));
    appendCell(row, 'Current File', record.transferCurrent || '', 'detail:file:' + encodeClassPart(baseName(record.transferCurrent || '')));
    appendCell(row, 'Saved Files', (record.savedFiles || []).join('\n'), 'detail:file:' + encodeClassPart(listSummary(record.savedFiles || [], 'file')));
    appendCell(row, 'Paths', pathDetail(record), 'detail:' + pathKind(record) + ':' + encodeClassPart(pathSummary(record)));
    appendCell(row, 'Started', formatAgentTime(record.startedAt));
    appendCell(row, 'Finished', formatAgentTime(record.finishedAt));
    appendCell(row, 'Error', record.error || '');
    appendRepeatCell(row, record.id);
    body.appendChild(row);
  });
  table.appendChild(body);
  wrap.appendChild(table);
  container.appendChild(wrap);
}
function appendRepeatCell(row, id) {
  var cell = document.createElement('td');
  cell.setAttribute('data-label', 'Actions');
  var button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('data-repeat-id', String(id));
  button.textContent = 'Transfer again';
  cell.appendChild(button);
  row.appendChild(cell);
}
function appendStopCurrentCell(row) {
  var cell = document.createElement('td');
  cell.setAttribute('data-label', 'Actions');
  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'primary';
  button.setAttribute('data-stop-current', 'true');
  button.textContent = 'Stop Current';
  cell.appendChild(button);
  row.appendChild(cell);
}
function transferText(record) {
  if (!record.transferState) {
    return '';
  }
  var text = record.transferState;
  if (record.transferPercent) {
    text += ' ' + record.transferPercent + '%';
  }
  return text;
}
function baseName(value) {
  value = String(value || '').replace(/[\/\\]+$/, '');
  var index = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  return index >= 0 ? value.slice(index + 1) : value;
}
function listSummary(values, singular) {
  values = values || [];
  if (values.length === 0) {
    return '';
  }
  if (values.length === 1) {
    return baseName(values[0]);
  }
  return values.length + ' ' + singular + 's';
}
function pathSummary(record) {
  if (record.transferArchive && record.transferArchiveName) {
    return record.transferArchiveName;
  }
  if (record.transferItems && record.transferItems.length > 1) {
    return record.transferItems.length + ' items';
  }
  if (record.transferItems && record.transferItems.length === 1) {
    return record.transferItems[0];
  }
  return listSummary(record.paths || [], record.action === 'receive' ? 'folder' : 'item');
}
function pathDetail(record) {
  var lines = [];
  if (record.transferArchive && record.transferArchiveName) {
    lines.push('Archive: ' + record.transferArchiveName);
  }
  if (record.transferItems && record.transferItems.length) {
    lines.push('Items:');
    record.transferItems.forEach(function(item) { lines.push('  ' + item); });
  }
  if (record.paths && record.paths.length) {
    if (lines.length) {
      lines.push('');
    }
    lines.push('Paths:');
    record.paths.forEach(function(path) { lines.push('  ' + path); });
  }
  return lines.join('\n');
}
function pathKind(record) {
  if (record.transferArchive || (record.paths || []).length > 1) {
    return 'archive';
  }
  if (record.action === 'receive') {
    return 'directory';
  }
  return 'file';
}
function displayValue(value) {
  var first = String(value || '').split('\n').filter(Boolean)[0] || '';
  return baseName(first);
}
function encodeClassPart(value) {
  return encodeURIComponent(value || '');
}
function decodeClassPart(value) {
  try {
    return decodeURIComponent(value || '');
  } catch (error) {
    return value || '';
  }
}
function renderAgentStatus(status) {
  var state = status.state || 'idle';
  var stateElement = document.getElementById('agent-state');
  setText('agent-state', state);
  setStateClass(stateElement, state);
  setText('agent-queued', String(status.queued || 0));
  setText('agent-version', status.version || '');
  setText('agent-started', formatAgentTime(status.agentStartedAt));
  setText('agent-last-error', status.lastError || 'None');
  renderCurrent(status.current);
  renderHistory(status.history || []);
}
function openDetailDialog(title, value) {
  currentDetailValue = value || '';
  setText('detail-title', title || 'Details');
  setText('detail-body', currentDetailValue);
  document.getElementById('detail-backdrop').classList.add('open');
}
function closeDetailDialog() {
  document.getElementById('detail-backdrop').classList.remove('open');
}
function copyText(value) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(value);
  }
  var area = document.createElement('textarea');
  area.value = value;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  var ok = document.execCommand('copy');
  document.body.removeChild(area);
  return ok ? Promise.resolve() : Promise.reject(new Error('copy failed'));
}
function updateAgentStatus() {
  fetch('/status', { cache: 'no-store' })
    .then(function(response) {
      if (!response.ok) {
        throw new Error('status request failed');
      }
      return response.json();
    })
    .then(renderAgentStatus)
    .catch(function() {
      setText('agent-last-error', 'Status unavailable.');
    });
}
function renderSettings(settings) {
  document.getElementById('settings-output').value = settings.output || '';
  var interfaceSelect = document.getElementById('settings-interface');
  interfaceSelect.innerHTML = '';
  (settings.interfaceOptions || []).forEach(function(option) {
    var item = document.createElement('option');
    item.value = option.name;
    item.textContent = option.label || option.name;
    interfaceSelect.appendChild(item);
  });
  if (settings.interface && !Array.prototype.some.call(interfaceSelect.options, function(option) { return option.value === settings.interface; })) {
    var current = document.createElement('option');
    current.value = settings.interface;
    current.textContent = settings.interface + ' (not currently available)';
    interfaceSelect.appendChild(current);
  }
  interfaceSelect.value = settings.interface || 'any';
  document.getElementById('settings-port').value = String(settings.port || 0);
  document.getElementById('settings-config').value = settings.configPath || '';
  document.getElementById('settings-browser').checked = Boolean(settings.browser);
  document.getElementById('settings-chat-autosave').checked = settings.chatAutoSave !== false;
  document.getElementById('settings-chat-sender').value = settings.chatSender || '';
  document.getElementById('settings-chat-avatar').value = settings.chatAvatar || '';
  document.getElementById('settings-close-behavior').value = settings.closeBehavior === 'quit' ? 'quit' : 'tray';
  setText('settings-status', 'Settings loaded.');
}
function loadSettings() {
  fetch('/settings', { cache: 'no-store' })
    .then(function(response) {
      if (!response.ok) {
        throw new Error('settings request failed');
      }
      return response.json();
    })
    .then(renderSettings)
    .catch(function() {
      setText('settings-status', 'Settings unavailable.');
    });
}
if (window.EventSource) {
  var agentEvents = new EventSource('/events');
  agentEvents.onmessage = function(event) {
    renderAgentStatus(JSON.parse(event.data));
  };
  agentEvents.onerror = function() {
    setText('agent-last-error', 'Status stream unavailable; using refresh fallback.');
  };
  setInterval(updateAgentStatus, 5000);
} else {
  setInterval(updateAgentStatus, 500);
}
document.getElementById('clear-history').addEventListener('click', function() {
  fetch('/history', { method: 'DELETE' })
    .then(function(response) {
      if (!response.ok) {
        throw new Error('clear history failed');
      }
      return updateAgentStatus();
    })
    .catch(function() {
      setText('agent-last-error', 'Clear history failed.');
    });
});
document.getElementById('restart-agent').addEventListener('click', function() {
  fetch('/restart', { method: 'POST' })
    .then(function(response) {
      if (!response.ok) {
        throw new Error('restart failed');
      }
      setText('agent-last-error', 'Restarting.');
      setTimeout(updateAgentStatus, 1200);
    })
    .catch(function() {
      setText('agent-last-error', 'Restart failed.');
    });
});
document.getElementById('settings-form').addEventListener('submit', function(event) {
  event.preventDefault();
  var port = Number.parseInt(document.getElementById('settings-port').value || '0', 10);
  fetch('/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      output: document.getElementById('settings-output').value,
      interface: document.getElementById('settings-interface').value,
      port: Number.isNaN(port) ? 0 : port,
      browser: document.getElementById('settings-browser').checked,
      chatAutoSave: document.getElementById('settings-chat-autosave').checked,
      chatSender: document.getElementById('settings-chat-sender').value,
      chatAvatar: document.getElementById('settings-chat-avatar').value,
      closeBehavior: document.getElementById('settings-close-behavior').value
    })
  })
    .then(function(response) {
      if (!response.ok) {
        throw new Error('settings save failed');
      }
      return response.json();
    })
    .then(function(settings) {
      renderSettings(settings);
      setText('settings-status', 'Settings saved.');
    })
    .catch(function() {
      setText('settings-status', 'Settings save failed.');
    });
});
document.getElementById('detail-close').addEventListener('click', closeDetailDialog);
document.getElementById('detail-copy').addEventListener('click', function() {
  copyText(currentDetailValue)
    .then(function() {
      setText('settings-status', 'Copied detail.');
    })
    .catch(function() {
      setText('settings-status', 'Copy failed.');
    });
});
document.getElementById('detail-backdrop').addEventListener('click', function(event) {
  if (event.target.id === 'detail-backdrop') {
    closeDetailDialog();
  }
});
document.addEventListener('keydown', function(event) {
  if (event.key === 'Escape') {
    closeDetailDialog();
  }
});
document.addEventListener('click', function(event) {
  var stopCurrent = event.target.closest('[data-stop-current]');
  if (stopCurrent) {
    fetch('/stop-current', { method: 'POST' })
      .then(function(response) {
        if (!response.ok) {
          throw new Error('stop-current failed');
        }
        return updateAgentStatus();
      })
      .catch(function() {
        setText('agent-last-error', 'Stop current failed.');
      });
    return;
  }
  var detail = event.target.closest('[data-detail-value]');
  if (detail) {
    openDetailDialog(detail.getAttribute('data-detail-label') || 'Details', detail.getAttribute('data-detail-value') || '');
    return;
  }
  var button = event.target.closest('[data-repeat-id]');
  if (!button) {
    return;
  }
  var id = button.getAttribute('data-repeat-id');
  fetch('/tasks/' + id + '/repeat', { method: 'POST' })
    .then(function(response) {
      if (!response.ok) {
        throw new Error('repeat failed');
      }
      return updateAgentStatus();
    })
    .catch(function() {
      setText('agent-last-error', 'Transfer again failed.');
    });
});
updateAgentStatus();
loadSettings();
</script>
</body>
</html>`))
