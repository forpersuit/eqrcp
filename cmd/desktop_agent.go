package cmd

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"eqrcp/application"
	"github.com/spf13/cobra"
)

const desktopAgentAddress = "127.0.0.1:48176"

type desktopAgentTask struct {
	Action string   `json:"action"`
	Paths  []string `json:"paths"`
}

type desktopAgentResponse struct {
	State     string            `json:"state"`
	Current   *desktopAgentTask `json:"current,omitempty"`
	LastError string            `json:"lastError,omitempty"`
}

type desktopAgent struct {
	mu        sync.Mutex
	baseFlags application.Flags
	busy      bool
	current   *desktopAgentTask
	lastError string
	runner    func(desktopAgentTask) error
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
	if agent.busy {
		agent.mu.Unlock()
		http.Error(w, "desktop agent is busy", http.StatusConflict)
		return
	}
	agent.busy = true
	agent.current = &task
	agent.lastError = ""
	agent.mu.Unlock()

	go agent.execute(task)
	w.WriteHeader(http.StatusAccepted)
	agent.writeStatus(w)
}

func (agent *desktopAgent) execute(task desktopAgentTask) {
	err := agent.runner(task)
	agent.mu.Lock()
	defer agent.mu.Unlock()
	agent.busy = false
	agent.current = nil
	if err != nil {
		agent.lastError = err.Error()
	}
}

func (agent *desktopAgent) writeStatus(w http.ResponseWriter) {
	agent.mu.Lock()
	defer agent.mu.Unlock()
	response := desktopAgentResponse{
		State:     "idle",
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
	app.Flags = agent.baseFlags
	app.Flags.Browser = true
	switch task.Action {
	case "share":
		return sendCmdFunc(nil, task.Paths)
	case "receive":
		app.Flags.Output = task.Paths[0]
		return receiveCmdFunc(nil, task.Paths)
	default:
		return fmt.Errorf("unsupported desktop action %q", task.Action)
	}
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
