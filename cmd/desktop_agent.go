package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"eqrcp/application"
	"eqrcp/body"
	"eqrcp/config"
	"eqrcp/server"
	"github.com/adrg/xdg"
	"github.com/spf13/cobra"
)

const desktopAgentAddress = "127.0.0.1:48176"
const desktopAgentMaxQueue = 16
const desktopAgentMaxHistory = 20
const desktopAgentHistoryFilename = "desktop-agent-history.json"

var openDesktopAgentPage = openDesktopAgentPageURL
var desktopAgentBaseURL = "http://" + desktopAgentAddress

type desktopAgentTask struct {
	Action string   `json:"action"`
	Paths  []string `json:"paths"`
}

type desktopAgentTaskRecord struct {
	ID         int        `json:"id"`
	Action     string     `json:"action"`
	Paths      []string   `json:"paths"`
	State      string     `json:"state"`
	PageURL    string     `json:"pageUrl,omitempty"`
	Error      string     `json:"error,omitempty"`
	StartedAt  time.Time  `json:"startedAt"`
	FinishedAt *time.Time `json:"finishedAt,omitempty"`
}

type desktopAgentResponse struct {
	State     string                   `json:"state"`
	Current   *desktopAgentTaskRecord  `json:"current,omitempty"`
	Queued    int                      `json:"queued"`
	History   []desktopAgentTaskRecord `json:"history,omitempty"`
	LastError string                   `json:"lastError,omitempty"`
}

type desktopAgentHistoryStore struct {
	History []desktopAgentTaskRecord `json:"history"`
}

type desktopAgentNotifier func(title string, message string) error

type desktopAgent struct {
	mu          sync.Mutex
	baseFlags   application.Flags
	busy        bool
	current     *desktopAgentTaskRecord
	queue       []desktopAgentTask
	history     []desktopAgentTaskRecord
	nextID      int
	activeStop  func()
	shutdown    func()
	lastError   string
	runner      func(desktopAgentTask) error
	notifier    desktopAgentNotifier
	historyPath string
}

func newDesktopAgent(baseFlags application.Flags) *desktopAgent {
	agent := &desktopAgent{
		baseFlags:   baseFlags,
		notifier:    notifyDesktop,
		historyPath: defaultDesktopAgentHistoryPath(),
	}
	agent.runner = agent.runTask
	return agent
}

func defaultDesktopAgentHistoryPath() string {
	return filepath.Join(xdg.ConfigHome, application.New().Name, desktopAgentHistoryFilename)
}

func (agent *desktopAgent) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", agent.handlePage)
	mux.HandleFunc("/health", agent.handleHealth)
	mux.HandleFunc("/status", agent.handleStatus)
	mux.HandleFunc("/tasks", agent.handleTasks)
	mux.HandleFunc("/history", agent.handleHistory)
	mux.HandleFunc("/stop-current", agent.handleStopCurrent)
	mux.HandleFunc("/shutdown", agent.handleShutdown)
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
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (agent *desktopAgent) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	agent.writeStatus(w)
}

func (agent *desktopAgent) handleTasks(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var task desktopAgentTask
	if err := json.NewDecoder(r.Body).Decode(&task); err != nil {
		http.Error(w, fmt.Sprintf("invalid task: %v", err), http.StatusBadRequest)
		return
	}
	if err := validateDesktopAgentTask(task); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	agent.mu.Lock()
	if len(agent.queue) >= desktopAgentMaxQueue {
		agent.mu.Unlock()
		http.Error(w, "desktop agent queue is full", http.StatusTooManyRequests)
		return
	}
	agent.queue = append(agent.queue, task)
	agent.lastError = ""
	if agent.busy {
		agent.replaceActiveLocked("replaced")
	}
	agent.startNextLocked()
	agent.mu.Unlock()

	w.WriteHeader(http.StatusAccepted)
	agent.writeStatus(w)
}

func (agent *desktopAgent) handleHistory(w http.ResponseWriter, r *http.Request) {
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

func (agent *desktopAgent) handleStopCurrent(w http.ResponseWriter, r *http.Request) {
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

func (agent *desktopAgent) handleShutdown(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	agent.mu.Lock()
	agent.queue = nil
	if agent.busy {
		agent.replaceActiveLocked("replaced")
	}
	shutdown := agent.shutdown
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
			} else {
				agent.current.State = "completed"
			}
		}
		agent.addHistoryLocked(*agent.current)
		agent.notifyRecordLocked(*agent.current)
	}
	agent.busy = false
	agent.current = nil
	agent.activeStop = nil
	agent.startNextLocked()
}

func (agent *desktopAgent) stopCurrent(state string) bool {
	agent.mu.Lock()
	defer agent.mu.Unlock()
	if !agent.busy {
		return false
	}
	agent.replaceActiveLocked(state)
	return true
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
	go stop()
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

func desktopAgentNotification(record desktopAgentTaskRecord) (string, string) {
	action := desktopAgentActionLabel(record.Action)
	target := desktopAgentPathsSummary(record.Paths)
	switch record.State {
	case "running":
		return "eqrcp transfer started", fmt.Sprintf("%s started: %s", action, target)
	case "completed":
		return "eqrcp transfer completed", fmt.Sprintf("%s completed: %s", action, target)
	case "failed":
		if record.Error != "" {
			return "eqrcp transfer failed", fmt.Sprintf("%s failed: %s", action, record.Error)
		}
		return "eqrcp transfer failed", fmt.Sprintf("%s failed: %s", action, target)
	case "stopped":
		return "eqrcp transfer stopped", fmt.Sprintf("%s stopped: %s", action, target)
	case "replaced":
		return "eqrcp transfer replaced", fmt.Sprintf("%s replaced by a newer task: %s", action, target)
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

func (agent *desktopAgent) setActiveStop(stop func()) {
	agent.mu.Lock()
	defer agent.mu.Unlock()
	agent.activeStop = stop
}

func (agent *desktopAgent) setCurrentPageURL(url string) {
	agent.mu.Lock()
	defer agent.mu.Unlock()
	if agent.current != nil && agent.current.State == "running" {
		agent.current.PageURL = url
	}
}

func (agent *desktopAgent) writeStatus(w http.ResponseWriter) {
	response := agent.snapshot()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(response)
}

func (agent *desktopAgent) snapshot() desktopAgentResponse {
	agent.mu.Lock()
	defer agent.mu.Unlock()
	response := desktopAgentResponse{
		State:     "idle",
		Queued:    len(agent.queue),
		History:   cloneDesktopAgentRecords(agent.history),
		LastError: agent.lastError,
	}
	if agent.busy {
		response.State = "busy"
		if agent.current != nil {
			current := *agent.current
			current.Paths = append([]string(nil), agent.current.Paths...)
			response.Current = &current
		}
	}
	return response
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
	return nil
}

func (agent *desktopAgent) clearHistory() error {
	agent.mu.Lock()
	agent.history = nil
	agent.lastError = ""
	historyPath := agent.historyPath
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
	return record
}

func (agent *desktopAgent) runTask(task desktopAgentTask) error {
	agentApp := application.New()
	agentApp.Flags = agent.baseFlags
	agentApp.Flags.Browser = true
	if task.Action == "receive" {
		agentApp.Flags.Output = task.Paths[0]
	}
	cfg, err := config.New(agentApp)
	if err != nil {
		return err
	}
	srv, err := server.New(&cfg)
	if err != nil {
		return err
	}
	agent.setActiveStop(srv.Shutdown)
	agent.setCurrentPageURL(srv.BaseURL + "/qr")
	switch task.Action {
	case "share":
		payload, err := body.FromArgs(task.Paths, agentApp.Flags.Zip)
		if err != nil {
			srv.Shutdown()
			return err
		}
		srv.Send(payload)
		if err := srv.DisplayQR(srv.SendURL); err != nil {
			srv.Shutdown()
			return err
		}
	case "receive":
		if err := srv.ReceiveTo(cfg.Output); err != nil {
			srv.Shutdown()
			return err
		}
		if err := srv.DisplayQR(srv.ReceiveURL); err != nil {
			srv.Shutdown()
			return err
		}
	default:
		srv.Shutdown()
		return fmt.Errorf("unsupported desktop action %q", task.Action)
	}
	return srv.Wait()
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
	default:
		return fmt.Errorf("unsupported desktop action %q", task.Action)
	}
	return nil
}

var desktopAgentCmd = &cobra.Command{
	Use:   "agent",
	Short: "Run the desktop integration agent",
	Long:  "Run a local desktop integration agent that accepts right-click share and receive tasks.",
	RunE: func(command *cobra.Command, args []string) error {
		agent := newDesktopAgent(app.Flags)
		if err := agent.loadHistory(); err != nil {
			agent.lastError = fmt.Sprintf("unable to load desktop agent history: %v", err)
		}
		server := &http.Server{Addr: desktopAgentAddress, Handler: agent.routes()}
		agent.shutdown = func() {
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			_ = server.Shutdown(ctx)
		}
		command.Printf("Desktop agent listening on http://%s\n", desktopAgentAddress)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			return err
		}
		return nil
	},
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

func notifyDesktopWindows(title string, message string) error {
	script := fmt.Sprintf(
		`Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.BalloonTipTitle = %s; $n.BalloonTipText = %s; $n.Visible = $true; $n.ShowBalloonTip(5000); Start-Sleep -Seconds 6; $n.Dispose()`,
		powershellString(title),
		powershellString(message),
	)
	return exec.Command("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", script).Start()
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
	"joinPaths": func(paths []string) string {
		return strings.Join(paths, ", ")
	},
}).Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>eqrcp Agent</title>
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
  grid-template-columns: repeat(3, minmax(0, 1fr));
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
.state-busy { color: var(--accent); }
.state-idle, .state-completed { color: var(--ok); }
.state-failed, .state-replaced, .state-stopped { color: var(--danger); }
table {
  width: 100%;
  border-collapse: collapse;
}
th, td {
  border-top: 1px solid var(--line);
  padding: 10px 8px;
  text-align: left;
  vertical-align: top;
}
th {
  color: var(--muted);
  font-size: 13px;
  font-weight: 600;
}
.paths {
  max-width: 420px;
  overflow-wrap: anywhere;
}
.empty {
  color: var(--muted);
  margin: 0;
}
@media (max-width: 720px) {
  main { width: min(100% - 20px, 960px); margin: 20px auto; }
  header { align-items: flex-start; flex-direction: column; }
  .summary { grid-template-columns: 1fr; }
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
    <h1>eqrcp Agent</h1>
    <div class="actions">
      <form method="post" action="/stop-current"><button class="primary" type="submit">Stop Current</button></form>
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
        <div class="label">Last Error</div>
        <div id="agent-last-error" class="value">{{if .LastError}}{{.LastError}}{{else}}None{{end}}</div>
      </div>
    </div>
  </section>

  <section>
    <h2>Current</h2>
    <div id="agent-current">
    {{if .Current}}
    <table>
      <thead><tr><th>ID</th><th>Action</th><th>State</th><th>QR Page</th><th>Paths</th><th>Started</th></tr></thead>
      <tbody>
        <tr>
          <td data-label="ID">#{{.Current.ID}}</td>
          <td data-label="Action">{{.Current.Action}}</td>
          <td data-label="State" class="state-{{.Current.State}}">{{.Current.State}}</td>
          <td data-label="QR Page">{{if .Current.PageURL}}<a href="{{.Current.PageURL}}">Open QR Page</a>{{end}}</td>
          <td data-label="Paths" class="paths">{{joinPaths .Current.Paths}}</td>
          <td data-label="Started">{{formatTime .Current.StartedAt}}</td>
        </tr>
      </tbody>
    </table>
    {{else}}
    <p class="empty">No active task.</p>
    {{end}}
    </div>
  </section>

  <section>
    <h2>History</h2>
    <div id="agent-history">
    {{if .History}}
    <table>
      <thead><tr><th>ID</th><th>Action</th><th>State</th><th>Paths</th><th>Started</th><th>Finished</th><th>Error</th></tr></thead>
      <tbody>
        {{range .History}}
        <tr>
          <td data-label="ID">#{{.ID}}</td>
          <td data-label="Action">{{.Action}}</td>
          <td data-label="State" class="state-{{.State}}">{{.State}}</td>
          <td data-label="Paths" class="paths">{{joinPaths .Paths}}</td>
          <td data-label="Started">{{formatTime .StartedAt}}</td>
          <td data-label="Finished">{{formatFinished .FinishedAt}}</td>
          <td data-label="Error">{{.Error}}</td>
        </tr>
        {{end}}
      </tbody>
    </table>
    {{else}}
    <p class="empty">No history yet.</p>
    {{end}}
    </div>
  </section>
</main>
<script>
function setText(id, value) {
  document.getElementById(id).textContent = value;
}
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
  if (className) {
    cell.className = className;
  }
  cell.textContent = value || '';
  row.appendChild(cell);
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
  var table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>ID</th><th>Action</th><th>State</th><th>QR Page</th><th>Paths</th><th>Started</th></tr></thead>';
  var body = document.createElement('tbody');
  var row = document.createElement('tr');
  appendCell(row, 'ID', '#' + record.id);
  appendCell(row, 'Action', record.action);
  appendCell(row, 'State', record.state, 'state-' + record.state);
  appendLinkCell(row, 'QR Page', record.pageUrl, 'Open QR Page');
  appendCell(row, 'Paths', (record.paths || []).join(', '), 'paths');
  appendCell(row, 'Started', formatAgentTime(record.startedAt));
  body.appendChild(row);
  table.appendChild(body);
  container.appendChild(table);
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
  var table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>ID</th><th>Action</th><th>State</th><th>Paths</th><th>Started</th><th>Finished</th><th>Error</th></tr></thead>';
  var body = document.createElement('tbody');
  records.forEach(function(record) {
    var row = document.createElement('tr');
    appendCell(row, 'ID', '#' + record.id);
    appendCell(row, 'Action', record.action);
    appendCell(row, 'State', record.state, 'state-' + record.state);
    appendCell(row, 'Paths', (record.paths || []).join(', '), 'paths');
    appendCell(row, 'Started', formatAgentTime(record.startedAt));
    appendCell(row, 'Finished', formatAgentTime(record.finishedAt));
    appendCell(row, 'Error', record.error || '');
    body.appendChild(row);
  });
  table.appendChild(body);
  container.appendChild(table);
}
function updateAgentStatus() {
  fetch('/status', { cache: 'no-store' })
    .then(function(response) {
      if (!response.ok) {
        throw new Error('status request failed');
      }
      return response.json();
    })
    .then(function(status) {
      var state = status.state || 'idle';
      var stateElement = document.getElementById('agent-state');
      setText('agent-state', state);
      setStateClass(stateElement, state);
      setText('agent-queued', String(status.queued || 0));
      setText('agent-last-error', status.lastError || 'None');
      renderCurrent(status.current);
      renderHistory(status.history || []);
    })
    .catch(function() {
      setText('agent-last-error', 'Status unavailable.');
    });
}
setInterval(updateAgentStatus, 500);
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
updateAgentStatus();
</script>
</body>
</html>`))
