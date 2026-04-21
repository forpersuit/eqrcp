package cmd

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"eqrcp/application"
	"eqrcp/body"
	"eqrcp/config"
	"eqrcp/server"
	"github.com/spf13/cobra"
)

const desktopAgentAddress = "127.0.0.1:48176"
const desktopAgentMaxQueue = 16

type desktopAgentTask struct {
	Action string   `json:"action"`
	Paths  []string `json:"paths"`
}

type desktopAgentResponse struct {
	State     string            `json:"state"`
	Current   *desktopAgentTask `json:"current,omitempty"`
	Queued    int               `json:"queued"`
	LastError string            `json:"lastError,omitempty"`
}

type desktopAgent struct {
	mu         sync.Mutex
	baseFlags  application.Flags
	busy       bool
	current    *desktopAgentTask
	queue      []desktopAgentTask
	activeStop func()
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
		agent.stopActiveLocked()
	}
	agent.startNextLocked()
	agent.mu.Unlock()

	w.WriteHeader(http.StatusAccepted)
	agent.writeStatus(w)
}

func (agent *desktopAgent) execute(task desktopAgentTask) {
	err := agent.runner(task)
	agent.mu.Lock()
	defer agent.mu.Unlock()
	agent.busy = false
	agent.current = nil
	agent.activeStop = nil
	if err != nil {
		agent.lastError = err.Error()
	}
	agent.startNextLocked()
}

func (agent *desktopAgent) stopActiveLocked() {
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
	agent.busy = true
	agent.current = &task
	go agent.execute(task)
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
		LastError: agent.lastError,
	}
	if agent.busy {
		response.State = "busy"
		if agent.current != nil {
			current := *agent.current
			response.Current = &current
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(response)
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
		command.Printf("Desktop agent listening on http://%s\n", desktopAgentAddress)
		return http.ListenAndServe(desktopAgentAddress, agent.routes())
	},
}
