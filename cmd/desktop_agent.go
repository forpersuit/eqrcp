package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"eqrcp/application"
	"eqrcp/body"
	"eqrcp/config"
	"eqrcp/server"
	"github.com/spf13/cobra"
)

const desktopAgentAddress = "127.0.0.1:48176"
const desktopAgentMaxQueue = 16
const desktopAgentMaxHistory = 20

type desktopAgentTask struct {
	Action string   `json:"action"`
	Paths  []string `json:"paths"`
}

type desktopAgentTaskRecord struct {
	ID         int        `json:"id"`
	Action     string     `json:"action"`
	Paths      []string   `json:"paths"`
	State      string     `json:"state"`
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

type desktopAgent struct {
	mu         sync.Mutex
	baseFlags  application.Flags
	busy       bool
	current    *desktopAgentTaskRecord
	queue      []desktopAgentTask
	history    []desktopAgentTaskRecord
	nextID     int
	activeStop func()
	shutdown   func()
	lastError  string
	runner     func(desktopAgentTask) error
}

func newDesktopAgent(baseFlags application.Flags) *desktopAgent {
	agent := &desktopAgent{baseFlags: baseFlags}
	agent.runner = agent.runTask
	return agent
}

func (agent *desktopAgent) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", agent.handleHealth)
	mux.HandleFunc("/status", agent.handleStatus)
	mux.HandleFunc("/tasks", agent.handleTasks)
	mux.HandleFunc("/shutdown", agent.handleShutdown)
	return mux
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
		agent.replaceActiveLocked()
	}
	agent.startNextLocked()
	agent.mu.Unlock()

	w.WriteHeader(http.StatusAccepted)
	agent.writeStatus(w)
}

func (agent *desktopAgent) handleShutdown(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	agent.mu.Lock()
	agent.queue = nil
	if agent.busy {
		agent.replaceActiveLocked()
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
	}
	agent.busy = false
	agent.current = nil
	agent.activeStop = nil
	agent.startNextLocked()
}

func (agent *desktopAgent) replaceActiveLocked() {
	if agent.current != nil && agent.current.State == "running" {
		agent.current.State = "replaced"
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
	go agent.execute(task, record.ID)
}

func (agent *desktopAgent) setActiveStop(stop func()) {
	agent.mu.Lock()
	defer agent.mu.Unlock()
	agent.activeStop = stop
}

func (agent *desktopAgent) writeStatus(w http.ResponseWriter) {
	agent.mu.Lock()
	defer agent.mu.Unlock()
	response := desktopAgentResponse{
		State:     "idle",
		Queued:    len(agent.queue),
		History:   append([]desktopAgentTaskRecord(nil), agent.history...),
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
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(response)
}

func (agent *desktopAgent) addHistoryLocked(record desktopAgentTaskRecord) {
	record.Paths = append([]string(nil), record.Paths...)
	agent.history = append([]desktopAgentTaskRecord{record}, agent.history...)
	if len(agent.history) > desktopAgentMaxHistory {
		agent.history = agent.history[:desktopAgentMaxHistory]
	}
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

var desktopAgentStopCmd = &cobra.Command{
	Use:   "agent-stop",
	Short: "Stop the desktop integration agent",
	Long:  "Stop the local desktop integration agent if it is running.",
	RunE: func(command *cobra.Command, args []string) error {
		response, err := http.Post("http://"+desktopAgentAddress+"/shutdown", "text/plain", nil)
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

func fetchDesktopAgentStatus() (desktopAgentResponse, error) {
	response, err := http.Get("http://" + desktopAgentAddress + "/status")
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
