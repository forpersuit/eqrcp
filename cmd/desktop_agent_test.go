package cmd

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"eqrcp/application"
)

func TestValidateDesktopAgentTask(t *testing.T) {
	tests := []struct {
		name    string
		task    desktopAgentTask
		wantErr string
	}{
		{name: "share", task: desktopAgentTask{Action: "share", Paths: []string{"a.txt"}}},
		{name: "receive", task: desktopAgentTask{Action: "receive", Paths: []string{"/tmp"}}},
		{name: "share missing path", task: desktopAgentTask{Action: "share"}, wantErr: "requires at least one path"},
		{name: "receive multiple paths", task: desktopAgentTask{Action: "receive", Paths: []string{"a", "b"}}, wantErr: "requires exactly one directory"},
		{name: "unknown", task: desktopAgentTask{Action: "open", Paths: []string{"a"}}, wantErr: "unsupported desktop action"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateDesktopAgentTask(test.task)
			if test.wantErr == "" && err != nil {
				t.Fatalf("validateDesktopAgentTask() error = %v", err)
			}
			if test.wantErr != "" {
				if err == nil {
					t.Fatal("validateDesktopAgentTask() expected error")
				}
				if !strings.Contains(err.Error(), test.wantErr) {
					t.Fatalf("validateDesktopAgentTask() error = %q, want to contain %q", err, test.wantErr)
				}
			}
		})
	}
}

func TestDesktopAgentAcceptsTaskAndReportsStatus(t *testing.T) {
	done := make(chan desktopAgentTask, 1)
	agent := newDesktopAgent(application.Flags{})
	agent.runner = func(task desktopAgentTask) error {
		done <- task
		return nil
	}
	server := httptest.NewServer(agent.routes())
	defer server.Close()

	response := postAgentTask(t, server.URL, desktopAgentTask{Action: "share", Paths: []string{"a.txt"}})
	if response.StatusCode != http.StatusAccepted {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusAccepted)
	}
	select {
	case task := <-done:
		if task.Action != "share" || len(task.Paths) != 1 || task.Paths[0] != "a.txt" {
			t.Fatalf("task = %#v", task)
		}
	case <-time.After(time.Second):
		t.Fatal("agent did not run accepted task")
	}

	status := getAgentStatus(t, server.URL)
	if status.State != "idle" {
		t.Fatalf("State = %q, want idle", status.State)
	}
}

func TestDesktopAgentQueuesTaskWhileBusy(t *testing.T) {
	block := make(chan struct{})
	started := make(chan struct{})
	done := make(chan desktopAgentTask, 2)
	agent := newDesktopAgent(application.Flags{})
	agent.runner = func(task desktopAgentTask) error {
		done <- task
		if task.Action == "share" {
			close(started)
			<-block
		}
		return nil
	}
	server := httptest.NewServer(agent.routes())
	defer server.Close()

	first := postAgentTask(t, server.URL, desktopAgentTask{Action: "share", Paths: []string{"a.txt"}})
	if first.StatusCode != http.StatusAccepted {
		t.Fatalf("first status = %d, want %d", first.StatusCode, http.StatusAccepted)
	}
	<-started
	second := postAgentTask(t, server.URL, desktopAgentTask{Action: "receive", Paths: []string{"/tmp"}})
	if second.StatusCode != http.StatusAccepted {
		t.Fatalf("second status = %d, want %d", second.StatusCode, http.StatusAccepted)
	}
	status := getAgentStatus(t, server.URL)
	if status.State != "busy" || status.Current == nil || status.Current.Action != "share" || status.Queued != 1 {
		t.Fatalf("status = %#v", status)
	}
	close(block)

	var tasks []desktopAgentTask
	for len(tasks) < 2 {
		select {
		case task := <-done:
			tasks = append(tasks, task)
		case <-time.After(time.Second):
			t.Fatalf("queued task did not run, tasks = %#v", tasks)
		}
	}
	if tasks[0].Action != "share" || tasks[1].Action != "receive" {
		t.Fatalf("tasks = %#v, want share then receive", tasks)
	}
}

func TestDesktopAgentRejectsWhenQueueIsFull(t *testing.T) {
	block := make(chan struct{})
	started := make(chan struct{})
	agent := newDesktopAgent(application.Flags{})
	agent.runner = func(task desktopAgentTask) error {
		if len(task.Paths) > 0 && task.Paths[0] == "active.txt" {
			close(started)
		}
		<-block
		return nil
	}
	server := httptest.NewServer(agent.routes())
	defer server.Close()
	defer close(block)

	first := postAgentTask(t, server.URL, desktopAgentTask{Action: "share", Paths: []string{"active.txt"}})
	if first.StatusCode != http.StatusAccepted {
		t.Fatalf("first status = %d, want %d", first.StatusCode, http.StatusAccepted)
	}
	<-started
	for index := 0; index < desktopAgentMaxQueue; index++ {
		response := postAgentTask(t, server.URL, desktopAgentTask{Action: "share", Paths: []string{"queued.txt"}})
		if response.StatusCode != http.StatusAccepted {
			t.Fatalf("queued status = %d, want %d", response.StatusCode, http.StatusAccepted)
		}
	}
	response := postAgentTask(t, server.URL, desktopAgentTask{Action: "share", Paths: []string{"overflow.txt"}})
	if response.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("overflow status = %d, want %d", response.StatusCode, http.StatusTooManyRequests)
	}
}

func postAgentTask(t *testing.T, baseURL string, task desktopAgentTask) *http.Response {
	t.Helper()
	data, err := json.Marshal(task)
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.Post(baseURL+"/tasks", "application/json", bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		response.Body.Close()
	})
	return response
}

func getAgentStatus(t *testing.T, baseURL string) desktopAgentResponse {
	t.Helper()
	response, err := http.Get(baseURL + "/status")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var status desktopAgentResponse
	if err := json.NewDecoder(response.Body).Decode(&status); err != nil {
		t.Fatal(err)
	}
	return status
}
