package cmd

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"eqrcp/application"
	"eqrcp/config"
	"eqrcp/server"
	"github.com/spf13/cobra"
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
	notifications := make(chan string, 4)
	agent := newDesktopAgent(application.Flags{})
	agent.notifier = func(title string, message string) error {
		notifications <- title + ": " + message
		return nil
	}
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
	if len(status.History) != 1 || status.History[0].State != "completed" || status.History[0].Action != "share" {
		t.Fatalf("History = %#v, want completed share record", status.History)
	}
	assertNotificationContains(t, notifications, "eqrcp transfer ready")
	assertNotificationContains(t, notifications, "eqrcp transfer completed")
}

func TestDesktopAgentRecordsNotificationStates(t *testing.T) {
	tests := []struct {
		name  string
		state string
		err   string
		want  []string
	}{
		{name: "running", state: "running", want: []string{"eqrcp transfer ready", "Share ready: a.txt"}},
		{name: "completed", state: "completed", want: []string{"eqrcp transfer completed", "Share completed: a.txt"}},
		{name: "failed", state: "failed", err: "network failed", want: []string{"eqrcp transfer failed", "Share failed: network failed"}},
		{name: "stopped", state: "stopped", want: []string{"eqrcp transfer stopped", "Share stopped: a.txt"}},
		{name: "replaced", state: "replaced", want: []string{"eqrcp transfer replaced", "Share replaced by a newer task: a.txt"}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			title, message := desktopAgentNotification(desktopAgentTaskRecord{
				Action: "share",
				Paths:  []string{"a.txt"},
				State:  test.state,
				Error:  test.err,
			})
			got := title + ": " + message
			for _, want := range test.want {
				if !strings.Contains(got, want) {
					t.Fatalf("notification = %q, want to contain %q", got, want)
				}
			}
		})
	}
}

func TestDesktopAgentObservesTransferStatus(t *testing.T) {
	notifications := make(chan string, 4)
	agent := newDesktopAgent(application.Flags{})
	agent.notifier = func(title string, message string) error {
		notifications <- title + ": " + message
		return nil
	}
	agent.busy = true
	agent.current = &desktopAgentTaskRecord{
		ID:        3,
		Action:    "receive",
		Paths:     []string{"/tmp/inbox"},
		State:     "running",
		StartedAt: time.Now(),
	}

	agent.observeTransferStatus(3, server.TransferStatusSnapshot{
		State:      "transferring",
		Message:    "Receiving report.txt.",
		Current:    "report.txt",
		BytesDone:  50,
		BytesTotal: 100,
		Percent:    50,
	})
	status := agent.snapshot()
	if status.Current == nil || status.Current.TransferState != "transferring" || status.Current.TransferPercent != 50 || status.Current.TransferCurrent != "report.txt" {
		t.Fatalf("Current = %#v, want observed transfer status", status.Current)
	}
	assertNotificationContains(t, notifications, "eqrcp transfer started")

	agent.observeTransferStatus(3, server.TransferStatusSnapshot{
		State:      "completed",
		Message:    "Received 2 files.",
		Current:    "b.txt",
		Percent:    100,
		SavedFiles: []string{"a.txt", "b.txt"},
	})
	status = agent.snapshot()
	if status.Current != nil {
		t.Fatalf("Current = %#v, want completed transfer moved to history", status.Current)
	}
	if len(status.History) != 1 || status.History[0].State != "completed" || len(status.History[0].SavedFiles) != 2 || status.History[0].TransferCurrent != "b.txt" {
		t.Fatalf("History = %#v, want saved files and completed transfer", status.History)
	}
	assertNotificationContains(t, notifications, "eqrcp transfer completed")
}

func TestDesktopAgentRecordsStoppedTransferState(t *testing.T) {
	agent := newDesktopAgent(application.Flags{})
	agent.runner = func(task desktopAgentTask) error {
		return nil
	}
	agent.busy = true
	agent.current = &desktopAgentTaskRecord{
		ID:        8,
		Action:    "share",
		Paths:     []string{"a.txt"},
		State:     "running",
		StartedAt: time.Now(),
	}

	agent.observeTransferStatus(8, server.TransferStatusSnapshot{
		State:   "stopped",
		Message: "Transfer interrupted before completion.",
	})
	status := agent.snapshot()
	if status.Current != nil {
		t.Fatalf("Current = %#v, want stopped task moved to history", status.Current)
	}
	if len(status.History) != 1 || status.History[0].State != "stopped" || status.History[0].FinishedAt == nil {
		t.Fatalf("History = %#v, want stopped history task before server exits", status.History)
	}
	agent.execute(desktopAgentTask{Action: "share", Paths: []string{"a.txt"}}, 8)
	status = agent.snapshot()
	if len(status.History) != 1 || status.History[0].State != "stopped" || status.History[0].TransferState != "stopped" {
		t.Fatalf("History = %#v, want stopped transfer record", status.History)
	}
}

func TestDesktopAgentRecordsFailedTransferState(t *testing.T) {
	agent := newDesktopAgent(application.Flags{})
	agent.runner = func(task desktopAgentTask) error {
		return nil
	}
	agent.busy = true
	agent.current = &desktopAgentTaskRecord{
		ID:        9,
		Action:    "receive",
		Paths:     []string{"/tmp/inbox"},
		State:     "running",
		StartedAt: time.Now(),
	}

	agent.observeTransferStatus(9, server.TransferStatusSnapshot{
		State:   "failed",
		Message: "Upload failed.",
	})
	status := agent.snapshot()
	if status.Current != nil {
		t.Fatalf("Current = %#v, want failed task moved to history", status.Current)
	}
	if len(status.History) != 1 || status.History[0].State != "failed" || status.History[0].FinishedAt == nil {
		t.Fatalf("History = %#v, want failed history task before server exits", status.History)
	}
	agent.execute(desktopAgentTask{Action: "receive", Paths: []string{"/tmp/inbox"}}, 9)
	status = agent.snapshot()
	if len(status.History) != 1 || status.History[0].State != "failed" || status.History[0].TransferState != "failed" {
		t.Fatalf("History = %#v, want failed transfer record", status.History)
	}
}

func TestDesktopAgentTransferNotificationsAreDeduped(t *testing.T) {
	notifications := make(chan string, 4)
	agent := newDesktopAgent(application.Flags{})
	agent.notifier = func(title string, message string) error {
		notifications <- title + ": " + message
		return nil
	}
	agent.busy = true
	agent.current = &desktopAgentTaskRecord{ID: 4, Action: "share", Paths: []string{"a.txt"}, State: "running"}

	for index := 0; index < 3; index++ {
		agent.observeTransferStatus(4, server.TransferStatusSnapshot{State: "transferring", Current: "a.txt"})
	}
	assertNotificationContains(t, notifications, "eqrcp transfer started")
	select {
	case got := <-notifications:
		t.Fatalf("unexpected duplicate notification %q", got)
	default:
	}
}

func TestDesktopAgentFailedTransferNotificationUsesTransferMessage(t *testing.T) {
	title, message := desktopAgentTransferNotification(desktopAgentTaskRecord{
		Action:          "receive",
		Paths:           []string{"/tmp/inbox"},
		TransferState:   "failed",
		TransferMessage: "Unable to write file to disk.",
		TransferCurrent: "report.txt",
	})
	got := title + ": " + message
	for _, want := range []string{"eqrcp transfer failed", "Receive failed: Unable to write file to disk."} {
		if !strings.Contains(got, want) {
			t.Fatalf("notification = %q, want to contain %q", got, want)
		}
	}
}

func TestDesktopAgentNotificationSummarizesMultiplePaths(t *testing.T) {
	_, message := desktopAgentNotification(desktopAgentTaskRecord{
		Action: "share",
		Paths:  []string{"a.txt", "b.txt", "c.txt"},
		State:  "running",
	})
	if !strings.Contains(message, "3 items") {
		t.Fatalf("message = %q, want multi-item summary", message)
	}
}

func TestDesktopAgentNotificationSkipsChat(t *testing.T) {
	title, message := desktopAgentNotification(desktopAgentTaskRecord{
		Action: "chat",
		State:  "running",
	})
	if title != "" || message != "" {
		t.Fatalf("desktopAgentNotification(chat) = %q, %q; want no notification", title, message)
	}
}

func TestDesktopAgentIgnoresNotificationErrors(t *testing.T) {
	agent := newDesktopAgent(application.Flags{})
	agent.notifier = func(title string, message string) error {
		return errors.New("notification backend unavailable")
	}
	agent.mu.Lock()
	agent.notifyRecordLocked(desktopAgentTaskRecord{Action: "share", Paths: []string{"a.txt"}, State: "running"})
	agent.mu.Unlock()
	if agent.lastError != "" {
		t.Fatalf("lastError = %q, want notification errors to stay non-fatal", agent.lastError)
	}
}

func TestDesktopAgentQueuesTaskWhileBusy(t *testing.T) {
	block := make(chan struct{})
	started := make(chan struct{})
	done := make(chan desktopAgentTask, 2)
	agent := newDesktopAgent(application.Flags{})
	var stopOnce sync.Once
	agent.runner = func(task desktopAgentTask) error {
		done <- task
		if task.Action == "share" {
			agent.setActiveStop(func(state string) {
				stopOnce.Do(func() {
					close(block)
				})
			})
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
	status := getAgentStatus(t, server.URL)
	if len(status.History) < 2 {
		t.Fatalf("History = %#v, want at least two records", status.History)
	}
	if status.History[1].State != "replaced" || status.History[1].Action != "share" {
		t.Fatalf("History = %#v, want replaced share record", status.History)
	}
	if status.History[0].State != "completed" || status.History[0].Action != "receive" {
		t.Fatalf("History = %#v, want completed receive record", status.History)
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

func TestParseDesktopAgentTaskActionPath(t *testing.T) {
	id, action, ok := parseDesktopAgentTaskActionPath("/tasks/42/repeat")
	if !ok || id != 42 || action != "repeat" {
		t.Fatalf("parseDesktopAgentTaskActionPath() = %d, %q, %v", id, action, ok)
	}
	if _, _, ok := parseDesktopAgentTaskActionPath("/tasks/nope/repeat"); ok {
		t.Fatal("parseDesktopAgentTaskActionPath() accepted invalid path")
	}
}

func TestDesktopAgentRepeatsHistoryTask(t *testing.T) {
	done := make(chan desktopAgentTask, 1)
	agent := newDesktopAgent(application.Flags{})
	agent.history = []desktopAgentTaskRecord{
		{ID: 3, Action: "share", Paths: []string{"again.txt"}, State: "completed", StartedAt: time.Now()},
	}
	agent.runner = func(task desktopAgentTask) error {
		done <- task
		return nil
	}
	server := httptest.NewServer(agent.routes())
	defer server.Close()

	response, err := http.Post(server.URL+"/tasks/3/repeat", "text/plain", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusAccepted {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("repeat status = %d, want %d; body = %q", response.StatusCode, http.StatusAccepted, string(body))
	}
	select {
	case task := <-done:
		if task.Action != "share" || len(task.Paths) != 1 || task.Paths[0] != "again.txt" {
			t.Fatalf("task = %#v, want repeated history task", task)
		}
	case <-time.After(time.Second):
		t.Fatal("repeated task did not run")
	}
}

func TestDesktopAgentRepeatMissingTask(t *testing.T) {
	agent := newDesktopAgent(application.Flags{})
	server := httptest.NewServer(agent.routes())
	defer server.Close()

	response, err := http.Post(server.URL+"/tasks/99/repeat", "text/plain", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusConflict {
		t.Fatalf("repeat status = %d, want %d", response.StatusCode, http.StatusConflict)
	}
}

func TestDesktopAgentShutdownStopsActiveTask(t *testing.T) {
	block := make(chan struct{})
	started := make(chan struct{})
	shutdownCalled := make(chan struct{}, 1)
	agent := newDesktopAgent(application.Flags{})
	var stopOnce sync.Once
	agent.shutdown = func() {
		shutdownCalled <- struct{}{}
	}
	agent.runner = func(task desktopAgentTask) error {
		agent.setActiveStop(func(state string) {
			stopOnce.Do(func() {
				close(block)
			})
		})
		close(started)
		<-block
		return nil
	}
	server := httptest.NewServer(agent.routes())
	defer server.Close()

	first := postAgentTask(t, server.URL, desktopAgentTask{Action: "share", Paths: []string{"active.txt"}})
	if first.StatusCode != http.StatusAccepted {
		t.Fatalf("first status = %d, want %d", first.StatusCode, http.StatusAccepted)
	}
	<-started
	response, err := http.Post(server.URL+"/shutdown", "text/plain", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusAccepted {
		t.Fatalf("shutdown status = %d, want %d", response.StatusCode, http.StatusAccepted)
	}
	select {
	case <-shutdownCalled:
	case <-time.After(time.Second):
		t.Fatal("shutdown handler did not call shutdown function")
	}
	status := getAgentStatus(t, server.URL)
	if len(status.History) == 0 || status.History[0].State != "replaced" {
		t.Fatalf("History = %#v, want replaced active task", status.History)
	}
}

func TestDesktopAgentStopCurrentStopsActiveTask(t *testing.T) {
	block := make(chan struct{})
	started := make(chan struct{})
	agent := newDesktopAgent(application.Flags{})
	var stopOnce sync.Once
	agent.runner = func(task desktopAgentTask) error {
		agent.setActiveStop(func(state string) {
			stopOnce.Do(func() {
				close(block)
			})
		})
		close(started)
		<-block
		return nil
	}
	server := httptest.NewServer(agent.routes())
	defer server.Close()

	first := postAgentTask(t, server.URL, desktopAgentTask{Action: "share", Paths: []string{"active.txt"}})
	if first.StatusCode != http.StatusAccepted {
		t.Fatalf("first status = %d, want %d", first.StatusCode, http.StatusAccepted)
	}
	<-started
	response, err := http.Post(server.URL+"/stop-current", "text/plain", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusAccepted {
		t.Fatalf("stop-current status = %d, want %d", response.StatusCode, http.StatusAccepted)
	}
	deadline := time.After(time.Second)
	for {
		status := getAgentStatus(t, server.URL)
		if len(status.History) > 0 {
			if status.History[0].State != "stopped" {
				t.Fatalf("History = %#v, want stopped active task", status.History)
			}
			return
		}
		select {
		case <-deadline:
			t.Fatalf("History = %#v, want stopped active task", status.History)
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}
}

func TestDesktopAgentStopCurrentWhenIdle(t *testing.T) {
	agent := newDesktopAgent(application.Flags{})
	server := httptest.NewServer(agent.routes())
	defer server.Close()

	response, err := http.Post(server.URL+"/stop-current", "text/plain", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusConflict {
		t.Fatalf("stop-current status = %d, want %d", response.StatusCode, http.StatusConflict)
	}
}

func TestDesktopAgentStopCurrentCommand(t *testing.T) {
	block := make(chan struct{})
	started := make(chan struct{})
	agent := newDesktopAgent(application.Flags{})
	var stopOnce sync.Once
	agent.runner = func(task desktopAgentTask) error {
		agent.setActiveStop(func(state string) {
			stopOnce.Do(func() {
				close(block)
			})
		})
		close(started)
		<-block
		return nil
	}
	server := httptest.NewServer(agent.routes())
	defer server.Close()

	first := postAgentTask(t, server.URL, desktopAgentTask{Action: "share", Paths: []string{"active.txt"}})
	if first.StatusCode != http.StatusAccepted {
		t.Fatalf("first status = %d, want %d", first.StatusCode, http.StatusAccepted)
	}
	<-started
	previousBaseURL := desktopAgentBaseURL
	desktopAgentBaseURL = server.URL
	t.Cleanup(func() {
		desktopAgentBaseURL = previousBaseURL
	})

	var out bytes.Buffer
	desktopAgentStopCurrentCmd.SetOut(&out)
	if err := desktopAgentStopCurrentCmd.RunE(desktopAgentStopCurrentCmd, nil); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "Current desktop agent task stopped.") {
		t.Fatalf("output = %q", out.String())
	}
	deadline := time.After(time.Second)
	for {
		status := getAgentStatus(t, server.URL)
		if len(status.History) > 0 {
			if status.History[0].State != "stopped" {
				t.Fatalf("History = %#v, want stopped active task", status.History)
			}
			return
		}
		select {
		case <-deadline:
			t.Fatalf("History = %#v, want stopped active task", status.History)
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}
}

func TestDesktopAgentStopCurrentCommandWhenIdle(t *testing.T) {
	agent := newDesktopAgent(application.Flags{})
	server := httptest.NewServer(agent.routes())
	defer server.Close()
	previousBaseURL := desktopAgentBaseURL
	desktopAgentBaseURL = server.URL
	t.Cleanup(func() {
		desktopAgentBaseURL = previousBaseURL
	})

	var out bytes.Buffer
	desktopAgentStopCurrentCmd.SetOut(&out)
	err := desktopAgentStopCurrentCmd.RunE(desktopAgentStopCurrentCmd, nil)
	if err == nil {
		t.Fatal("agent-stop-current expected an error")
	}
	if !strings.Contains(err.Error(), "no active task") {
		t.Fatalf("error = %q, want no active task", err.Error())
	}
}

func TestDesktopAgentStopCurrentRedirectsBrowserRequests(t *testing.T) {
	block := make(chan struct{})
	started := make(chan struct{})
	agent := newDesktopAgent(application.Flags{})
	var stopOnce sync.Once
	agent.runner = func(task desktopAgentTask) error {
		agent.setActiveStop(func(state string) {
			stopOnce.Do(func() {
				close(block)
			})
		})
		close(started)
		<-block
		return nil
	}
	server := httptest.NewServer(agent.routes())
	defer server.Close()

	first := postAgentTask(t, server.URL, desktopAgentTask{Action: "share", Paths: []string{"active.txt"}})
	if first.StatusCode != http.StatusAccepted {
		t.Fatalf("first status = %d, want %d", first.StatusCode, http.StatusAccepted)
	}
	<-started
	client := &http.Client{CheckRedirect: func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	request, err := http.NewRequest(http.MethodPost, server.URL+"/stop-current", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Accept", "text/html")
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusSeeOther {
		t.Fatalf("stop-current status = %d, want %d", response.StatusCode, http.StatusSeeOther)
	}
	if response.Header.Get("Location") != "/" {
		t.Fatalf("Location = %q, want /", response.Header.Get("Location"))
	}
}

func TestDesktopAgentPageRendersStatus(t *testing.T) {
	started := time.Date(2026, 4, 22, 9, 0, 0, 0, time.UTC)
	finished := started.Add(time.Minute)
	agent := newDesktopAgent(application.Flags{})
	agent.history = []desktopAgentTaskRecord{
		{
			ID:              1,
			Action:          "share",
			Paths:           []string{"finished.txt"},
			State:           "completed",
			TransferCurrent: "finished.txt",
			SavedFiles:      []string{"finished.txt"},
			StartedAt:       started,
			FinishedAt:      &finished,
		},
	}
	agent.current = &desktopAgentTaskRecord{
		ID:              2,
		Action:          "receive",
		Paths:           []string{"/tmp/recv"},
		State:           "running",
		TransferCurrent: "incoming.txt",
		SavedFiles:      []string{"a.txt", "b.txt"},
		PageURL:         "http://127.0.0.1:19000/qr",
		StartedAt:       started,
	}
	agent.busy = true
	server := httptest.NewServer(agent.routes())
	defer server.Close()

	response, err := http.Get(server.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("page status = %d, want %d", response.StatusCode, http.StatusOK)
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"eqrcp Agent",
		"Stop Current",
		"Clear History",
		"Transfer again",
		"Stop Agent",
		"Restart Agent",
		"Settings",
		"Save Settings",
		"Output directory",
		"<select id=\"settings-interface\"",
		"Open browser pages automatically",
		"Auto-save chat attachments",
		"current user's config directory",
		"detail-backdrop",
		"detail-body",
		"Current keeps the active task visible while its QR service is still running",
		"History contains finalized tasks after the QR service has exited",
		"Version",
		"Started",
		"agent-version",
		"agent-started",
		"fetch('/status'",
		"data-repeat-id",
		"/tasks/' + id + '/repeat",
		"fetch('/history'",
		"fetch('/restart'",
		"fetch('/settings'",
		"new EventSource('/events')",
		"setInterval(updateAgentStatus, 5000)",
		"Open QR Page",
		"http://127.0.0.1:19000/qr",
		"Current File",
		"Saved Files",
		"incoming.txt",
		"2 files",
		"a.txt\nb.txt",
		"receive",
		"/tmp/recv",
		"finished.txt",
		"table-layout: fixed",
		"table-wrap",
		"detail-cell",
		"data-detail-value",
		"detail-copy",
		"Copy",
		"kind-directory",
		"kind-archive",
		"completed",
	} {
		if !strings.Contains(string(body), want) {
			t.Fatalf("agent page = %q, want to contain %q", string(body), want)
		}
	}
}

func TestDesktopAgentPersistsHistory(t *testing.T) {
	started := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)
	finished := started.Add(time.Minute)
	historyPath := filepath.Join(t.TempDir(), "history.json")
	agent := newDesktopAgent(application.Flags{})
	agent.historyPath = historyPath
	agent.mu.Lock()
	agent.addHistoryLocked(desktopAgentTaskRecord{
		ID:         7,
		Action:     "share",
		Paths:      []string{"a file.txt"},
		State:      "completed",
		StartedAt:  started,
		FinishedAt: &finished,
	})
	agent.mu.Unlock()

	restarted := newDesktopAgent(application.Flags{})
	restarted.historyPath = historyPath
	if err := restarted.loadHistory(); err != nil {
		t.Fatal(err)
	}
	status := restarted.snapshot()
	if len(status.History) != 1 {
		t.Fatalf("History = %#v, want one persisted record", status.History)
	}
	record := status.History[0]
	if record.ID != 7 || record.Action != "share" || record.State != "completed" || len(record.Paths) != 1 || record.Paths[0] != "a file.txt" {
		t.Fatalf("History[0] = %#v, want persisted share record", record)
	}
	if restarted.nextID != 7 {
		t.Fatalf("nextID = %d, want 7", restarted.nextID)
	}
}

func TestDesktopAgentCommandArgs(t *testing.T) {
	if err := desktopAgentCommandArgs(desktopAgentCmd, nil); err != nil {
		t.Fatalf("desktopAgentCommandArgs(nil) error = %v", err)
	}
	err := desktopAgentCommandArgs(desktopAgentCmd, []string{"runtime"})
	if err == nil || !strings.Contains(err.Error(), "desktop status") {
		t.Fatalf("desktopAgentCommandArgs(runtime) = %v, want runtime guidance", err)
	}
	err = desktopAgentCommandArgs(desktopAgentStartCmd, []string{"extra"})
	if err == nil || !strings.Contains(err.Error(), "does not take arguments") {
		t.Fatalf("desktopAgentCommandArgs(extra) = %v, want no-args error", err)
	}
}

func TestValidateDesktopAgentChatTask(t *testing.T) {
	if err := validateDesktopAgentTask(desktopAgentTask{Action: "chat"}); err != nil {
		t.Fatalf("validateDesktopAgentTask(chat) error = %v", err)
	}
	err := validateDesktopAgentTask(desktopAgentTask{Action: "chat", Paths: []string{"unexpected"}})
	if err == nil || !strings.Contains(err.Error(), "does not accept paths") {
		t.Fatalf("validateDesktopAgentTask(chat paths) = %v, want path rejection", err)
	}
}

func TestDesktopAgentObservesChatStatus(t *testing.T) {
	agent := newDesktopAgent(application.Flags{})
	agent.busy = true
	agent.current = &desktopAgentTaskRecord{
		ID:        5,
		Action:    "chat",
		State:     "running",
		StartedAt: time.Now(),
	}

	agent.observeChatStatus(5, server.ChatStatusSnapshot{
		State:        "active",
		MessageCount: 12,
		DeviceCount:  2,
		StartedAt:    time.Now(),
		LastActivity: time.Now(),
	})

	status := agent.snapshot()
	if status.Current == nil {
		t.Fatal("Current is nil, want active chat task")
	}
	if status.Current.ChatState != "active" {
		t.Fatalf("ChatState = %q, want active", status.Current.ChatState)
	}
	if status.Current.ChatMessageCount != 12 {
		t.Fatalf("ChatMessageCount = %d, want 12", status.Current.ChatMessageCount)
	}
	if status.Current.ChatDeviceCount != 2 {
		t.Fatalf("ChatDeviceCount = %d, want 2", status.Current.ChatDeviceCount)
	}
	if status.Current.ChatLastActivity == "" {
		t.Fatal("ChatLastActivity is empty, want timestamp")
	}
}

func TestDesktopAgentChatEndedMovesToHistory(t *testing.T) {
	agent := newDesktopAgent(application.Flags{})
	agent.busy = true
	agent.current = &desktopAgentTaskRecord{
		ID:        6,
		Action:    "chat",
		State:     "running",
		StartedAt: time.Now(),
	}

	agent.observeChatStatus(6, server.ChatStatusSnapshot{
		State:        "ended",
		MessageCount: 25,
		StartedAt:    time.Now().Add(-10 * time.Minute),
		LastActivity: time.Now(),
	})

	status := agent.snapshot()
	if status.Current != nil {
		t.Fatalf("Current = %#v, want ended chat moved to history", status.Current)
	}
	if len(status.History) != 1 {
		t.Fatalf("History length = %d, want 1", len(status.History))
	}
	record := status.History[0]
	if record.State != "completed" {
		t.Fatalf("History[0].State = %q, want completed", record.State)
	}
	if record.ChatState != "ended" {
		t.Fatalf("History[0].ChatState = %q, want ended", record.ChatState)
	}
	if record.ChatMessageCount != 25 {
		t.Fatalf("History[0].ChatMessageCount = %d, want 25", record.ChatMessageCount)
	}
	if record.FinishedAt == nil {
		t.Fatal("History[0].FinishedAt is nil, want timestamp")
	}
}

func TestDesktopAgentChatStoppedMovesToStoppedHistory(t *testing.T) {
	agent := newDesktopAgent(application.Flags{})
	agent.busy = true
	agent.current = &desktopAgentTaskRecord{
		ID:        7,
		Action:    "chat",
		State:     "running",
		StartedAt: time.Now(),
	}

	agent.observeChatStatus(7, server.ChatStatusSnapshot{
		State:        "stopped",
		MessageCount: 3,
		LastActivity: time.Now(),
	})

	status := agent.snapshot()
	if status.Current != nil {
		t.Fatalf("Current = %#v, want stopped chat moved to history", status.Current)
	}
	if len(status.History) != 1 {
		t.Fatalf("History length = %d, want 1", len(status.History))
	}
	record := status.History[0]
	if record.State != "stopped" {
		t.Fatalf("History[0].State = %q, want stopped", record.State)
	}
	if record.ChatState != "stopped" || record.ChatMessageCount != 3 {
		t.Fatalf("History[0] = %#v, want stopped chat details", record)
	}
}

func TestRunDesktopAgentBackgroundStartsProcess(t *testing.T) {
	previousBaseURL := desktopAgentBaseURL
	previousExecutable := desktopAgentExecutable
	previousStarter := desktopAgentBackgroundStarter
	previousWaiter := desktopAgentReadyWaiter
	desktopAgentBaseURL = "http://127.0.0.1:1"
	desktopAgentExecutable = func() (string, error) {
		return "/tmp/eqrcp", nil
	}
	started := false
	desktopAgentBackgroundStarter = func(exe string, logFile *os.File) error {
		started = true
		if exe != "/tmp/eqrcp" {
			t.Fatalf("exe = %q, want /tmp/eqrcp", exe)
		}
		if logFile == nil {
			t.Fatal("logFile is nil")
		}
		return nil
	}
	desktopAgentReadyWaiter = func(timeout time.Duration) error {
		if timeout != 3*time.Second {
			t.Fatalf("timeout = %s, want 3s", timeout)
		}
		return nil
	}
	t.Cleanup(func() {
		desktopAgentBaseURL = previousBaseURL
		desktopAgentExecutable = previousExecutable
		desktopAgentBackgroundStarter = previousStarter
		desktopAgentReadyWaiter = previousWaiter
	})

	command := &cobra.Command{}
	var out bytes.Buffer
	command.SetOut(&out)
	if err := runDesktopAgentBackground(command); err != nil {
		t.Fatal(err)
	}
	if !started {
		t.Fatal("background starter was not called")
	}
	if !strings.Contains(out.String(), "Desktop agent started in background.") || !strings.Contains(out.String(), "Log: ") {
		t.Fatalf("output = %q, want background start details", out.String())
	}
}

func TestDesktopAgentAddressInUse(t *testing.T) {
	if !desktopAgentAddressInUse(fmt.Errorf("listen tcp 127.0.0.1:48176: bind: address already in use")) {
		t.Fatal("desktopAgentAddressInUse() should detect unix-style bind errors")
	}
	if !desktopAgentAddressInUse(fmt.Errorf("listen tcp 127.0.0.1:48176: bind: Only one usage of each socket address (protocol/network address/port) is normally permitted.")) {
		t.Fatal("desktopAgentAddressInUse() should detect windows-style bind errors")
	}
	if desktopAgentAddressInUse(fmt.Errorf("some other error")) {
		t.Fatal("desktopAgentAddressInUse() should ignore unrelated errors")
	}
}

func TestDesktopAgentLoadHistoryTrimsToLimit(t *testing.T) {
	historyPath := filepath.Join(t.TempDir(), "history.json")
	var records []desktopAgentTaskRecord
	for index := 0; index < desktopAgentMaxHistory+3; index++ {
		records = append(records, desktopAgentTaskRecord{
			ID:        index + 1,
			Action:    "share",
			Paths:     []string{"file.txt"},
			State:     "completed",
			StartedAt: time.Now(),
		})
	}
	if err := saveDesktopAgentHistory(historyPath, records); err != nil {
		t.Fatal(err)
	}

	agent := newDesktopAgent(application.Flags{})
	agent.historyPath = historyPath
	if err := agent.loadHistory(); err != nil {
		t.Fatal(err)
	}
	status := agent.snapshot()
	if len(status.History) != desktopAgentMaxHistory {
		t.Fatalf("History length = %d, want %d", len(status.History), desktopAgentMaxHistory)
	}
	if agent.nextID != desktopAgentMaxHistory+3 {
		t.Fatalf("nextID = %d, want %d", agent.nextID, desktopAgentMaxHistory+3)
	}
}

func TestDesktopAgentClearHistory(t *testing.T) {
	historyPath := filepath.Join(t.TempDir(), "history.json")
	agent := newDesktopAgent(application.Flags{})
	agent.historyPath = historyPath
	agent.mu.Lock()
	agent.addHistoryLocked(desktopAgentTaskRecord{
		ID:        1,
		Action:    "share",
		Paths:     []string{"a.txt"},
		State:     "completed",
		StartedAt: time.Now(),
	})
	agent.mu.Unlock()
	server := httptest.NewServer(agent.routes())
	defer server.Close()

	request, err := http.NewRequest(http.MethodDelete, server.URL+"/history", nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("clear history status = %d, want %d", response.StatusCode, http.StatusNoContent)
	}
	status := getAgentStatus(t, server.URL)
	if len(status.History) != 0 {
		t.Fatalf("History = %#v, want empty", status.History)
	}
	restarted := newDesktopAgent(application.Flags{})
	restarted.historyPath = historyPath
	if err := restarted.loadHistory(); err != nil {
		t.Fatal(err)
	}
	if len(restarted.snapshot().History) != 0 {
		t.Fatalf("persisted History = %#v, want empty", restarted.snapshot().History)
	}
}

func TestDesktopAgentRestartEndpointStopsAndStartsAgent(t *testing.T) {
	previousExecutable := desktopAgentExecutable
	desktopAgentExecutable = func() (string, error) {
		return "/bin/true", nil
	}
	t.Cleanup(func() {
		desktopAgentExecutable = previousExecutable
	})

	shutdownCalled := make(chan struct{}, 1)
	agent := newDesktopAgent(application.Flags{})
	agent.shutdown = func() {
		shutdownCalled <- struct{}{}
	}
	server := httptest.NewServer(agent.routes())
	defer server.Close()

	response, err := http.Post(server.URL+"/restart", "text/plain", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusAccepted {
		t.Fatalf("restart status = %d, want %d", response.StatusCode, http.StatusAccepted)
	}
	select {
	case <-shutdownCalled:
	case <-time.After(time.Second):
		t.Fatal("restart did not call shutdown")
	}
}

func TestDesktopAgentRestartPersistsActiveTaskForRepeat(t *testing.T) {
	previousExecutable := desktopAgentExecutable
	desktopAgentExecutable = func() (string, error) {
		return "/bin/true", nil
	}
	t.Cleanup(func() {
		desktopAgentExecutable = previousExecutable
	})

	block := make(chan struct{})
	started := make(chan struct{})
	shutdownCalled := make(chan struct{}, 1)
	historyPath := filepath.Join(t.TempDir(), "history.json")
	agent := newDesktopAgent(application.Flags{})
	agent.historyPath = historyPath
	var stopOnce sync.Once
	agent.shutdown = func() {
		shutdownCalled <- struct{}{}
	}
	agent.runner = func(task desktopAgentTask) error {
		agent.setActiveStop(func(state string) {
			stopOnce.Do(func() {
				close(block)
			})
		})
		close(started)
		<-block
		return nil
	}
	server := httptest.NewServer(agent.routes())
	defer server.Close()

	response := postAgentTask(t, server.URL, desktopAgentTask{Action: "share", Paths: []string{"active.txt"}})
	if response.StatusCode != http.StatusAccepted {
		t.Fatalf("task status = %d, want %d", response.StatusCode, http.StatusAccepted)
	}
	<-started
	restartResponse, err := http.Post(server.URL+"/restart", "text/plain", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer restartResponse.Body.Close()
	if restartResponse.StatusCode != http.StatusAccepted {
		t.Fatalf("restart status = %d, want %d", restartResponse.StatusCode, http.StatusAccepted)
	}
	select {
	case <-shutdownCalled:
	case <-time.After(time.Second):
		t.Fatal("restart did not call shutdown")
	}
	status := getAgentStatus(t, server.URL)
	if status.Current != nil {
		t.Fatalf("Current = %#v, want nil after restart finalizes active task", status.Current)
	}
	if len(status.History) == 0 || status.History[0].ID != 1 || status.History[0].State != "replaced" {
		t.Fatalf("History = %#v, want replaced active task #1", status.History)
	}

	repeated := make(chan desktopAgentTask, 1)
	restarted := newDesktopAgent(application.Flags{})
	restarted.historyPath = historyPath
	if err := restarted.loadHistory(); err != nil {
		t.Fatal(err)
	}
	restarted.runner = func(task desktopAgentTask) error {
		repeated <- task
		return nil
	}
	restartedServer := httptest.NewServer(restarted.routes())
	defer restartedServer.Close()

	repeatResponse, err := http.Post(restartedServer.URL+"/tasks/1/repeat", "text/plain", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer repeatResponse.Body.Close()
	if repeatResponse.StatusCode != http.StatusAccepted {
		body, _ := io.ReadAll(repeatResponse.Body)
		t.Fatalf("repeat status = %d, want %d; body = %q", repeatResponse.StatusCode, http.StatusAccepted, string(body))
	}
	select {
	case task := <-repeated:
		if task.Action != "share" || len(task.Paths) != 1 || task.Paths[0] != "active.txt" {
			t.Fatalf("repeated task = %#v, want original active task", task)
		}
	case <-time.After(time.Second):
		t.Fatal("repeated task did not run after restart")
	}
}

func TestDesktopAgentSettingsEndpointReadsAndWritesConfig(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.yml")
	if err := os.WriteFile(configPath, []byte("output: /tmp/old\nport: 19000\nchatSender: Desk\nchatAvatar: D\n"), 0644); err != nil {
		t.Fatal(err)
	}
	agent := newDesktopAgent(application.Flags{Config: configPath})
	server := httptest.NewServer(agent.routes())
	defer server.Close()

	response, err := http.Get(server.URL + "/settings")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("settings status = %d, want %d", response.StatusCode, http.StatusOK)
	}
	var settings config.DesktopSettings
	if err := json.NewDecoder(response.Body).Decode(&settings); err != nil {
		t.Fatal(err)
	}
	if settings.Output != "/tmp/old" || settings.Port != 19000 || settings.ChatSender != "Desk" || settings.ChatAvatar != "D" || !settings.Browser || !settings.ChatAutoSave || settings.CloseBehavior != config.DesktopCloseBehaviorTray || settings.ConfigPath != configPath || len(settings.InterfaceOptions) == 0 {
		t.Fatalf("settings = %#v, want config values", settings)
	}

	newOutput := t.TempDir()
	payload := bytes.NewBufferString(fmt.Sprintf(`{"output":%q,"interface":"any","port":19001,"browser":true,"chatAutoSave":false,"chatSender":"Alice","chatAvatar":"A","closeBehavior":"quit"}`, newOutput))
	response, err = http.Post(server.URL+"/settings", "application/json", payload)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("save settings status = %d, want %d; body = %q", response.StatusCode, http.StatusOK, string(body))
	}
	if err := json.NewDecoder(response.Body).Decode(&settings); err != nil {
		t.Fatal(err)
	}
	if settings.Output != newOutput || settings.Interface != "any" || settings.Port != 19001 || settings.ChatSender != "Alice" || settings.ChatAvatar != "A" || !settings.Browser || settings.ChatAutoSave || settings.CloseBehavior != config.DesktopCloseBehaviorQuit {
		t.Fatalf("saved settings = %#v, want updated values", settings)
	}
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"output: " + newOutput, "interface: any", "port: 19001", "browser: true", "chatautosave: false", "chatsender: Alice", "chatavatar: A", "closebehavior: quit"} {
		if !strings.Contains(string(data), want) {
			t.Fatalf("config = %q, want to contain %q", string(data), want)
		}
	}
}

func TestDesktopChatPageURLBuildsProfileQuery(t *testing.T) {
	got := desktopChatPageURL("https://example.test/chat?existing=1", "host token", " Alice & Bob ", "🙂")

	parsed, err := url.Parse(got)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	if query.Get("existing") != "1" || query.Get("peer") != "desktop" || query.Get("hostToken") != "host token" || query.Get("sender") != "Alice & Bob" || query.Get("avatar") != "🙂" {
		t.Fatalf("query = %v, want preserved base query and desktop profile params", query)
	}
}

func TestDesktopChatPageURLOmitsBlankProfileFields(t *testing.T) {
	got := desktopChatPageURL("https://example.test/chat", "host-token", "   ", "")

	parsed, err := url.Parse(got)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	if query.Get("peer") != "desktop" || query.Get("hostToken") != "host-token" {
		t.Fatalf("query = %v, want required params", query)
	}
	if _, ok := query["sender"]; ok {
		t.Fatalf("query = %v, want sender omitted", query)
	}
	if _, ok := query["avatar"]; ok {
		t.Fatalf("query = %v, want avatar omitted", query)
	}
}

func TestDesktopAgentHistoryClearCommand(t *testing.T) {
	agent := newDesktopAgent(application.Flags{})
	agent.historyPath = filepath.Join(t.TempDir(), "history.json")
	agent.history = []desktopAgentTaskRecord{
		{ID: 1, Action: "share", Paths: []string{"a.txt"}, State: "completed", StartedAt: time.Now()},
	}
	server := httptest.NewServer(agent.routes())
	defer server.Close()

	previousBaseURL := desktopAgentBaseURL
	desktopAgentBaseURL = server.URL
	t.Cleanup(func() {
		desktopAgentBaseURL = previousBaseURL
	})

	var out bytes.Buffer
	desktopAgentHistoryClearCmd.SetOut(&out)
	if err := desktopAgentHistoryClearCmd.RunE(desktopAgentHistoryClearCmd, nil); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "Desktop agent history cleared.") {
		t.Fatalf("output = %q", out.String())
	}
	if len(agent.snapshot().History) != 0 {
		t.Fatalf("History = %#v, want empty", agent.snapshot().History)
	}
}

func TestDesktopAgentSetCurrentPageURL(t *testing.T) {
	agent := newDesktopAgent(application.Flags{})
	agent.busy = true
	agent.current = &desktopAgentTaskRecord{
		ID:        1,
		Action:    "share",
		Paths:     []string{"active.txt"},
		State:     "running",
		StartedAt: time.Now(),
	}

	agent.setCurrentPageURL("http://127.0.0.1:19000/qr")
	status := agent.snapshot()
	if status.Current == nil || status.Current.PageURL != "http://127.0.0.1:19000/qr" {
		t.Fatalf("Current = %#v, want page URL", status.Current)
	}
}

func TestDesktopAgentOpenCommandOpensStatusPage(t *testing.T) {
	agent := newDesktopAgent(application.Flags{})
	server := httptest.NewServer(agent.routes())
	defer server.Close()

	previousBaseURL := desktopAgentBaseURL
	previousOpen := openDesktopAgentPage
	desktopAgentBaseURL = server.URL
	opened := make(chan string, 1)
	openDesktopAgentPage = func(url string) error {
		opened <- url
		return nil
	}
	t.Cleanup(func() {
		desktopAgentBaseURL = previousBaseURL
		openDesktopAgentPage = previousOpen
	})

	var out bytes.Buffer
	desktopAgentOpenCmd.SetOut(&out)
	if err := desktopAgentOpenCmd.RunE(desktopAgentOpenCmd, nil); err != nil {
		t.Fatal(err)
	}
	select {
	case url := <-opened:
		if url != server.URL+"/" {
			t.Fatalf("opened URL = %q, want %q", url, server.URL+"/")
		}
	case <-time.After(time.Second):
		t.Fatal("agent-open did not open status page")
	}
	if !strings.Contains(out.String(), "Desktop agent status page opened.") {
		t.Fatalf("output = %q", out.String())
	}
}

func TestDesktopAgentOpenCurrentCommandOpensQRPage(t *testing.T) {
	agent := newDesktopAgent(application.Flags{})
	agent.busy = true
	agent.current = &desktopAgentTaskRecord{
		ID:        1,
		Action:    "share",
		Paths:     []string{"active.txt"},
		State:     "running",
		PageURL:   "http://127.0.0.1:19000/qr",
		StartedAt: time.Now(),
	}
	server := httptest.NewServer(agent.routes())
	defer server.Close()

	previousBaseURL := desktopAgentBaseURL
	previousOpen := openDesktopAgentPage
	desktopAgentBaseURL = server.URL
	opened := make(chan string, 1)
	openDesktopAgentPage = func(url string) error {
		opened <- url
		return nil
	}
	t.Cleanup(func() {
		desktopAgentBaseURL = previousBaseURL
		openDesktopAgentPage = previousOpen
	})

	var out bytes.Buffer
	desktopAgentOpenCurrentCmd.SetOut(&out)
	if err := desktopAgentOpenCurrentCmd.RunE(desktopAgentOpenCurrentCmd, nil); err != nil {
		t.Fatal(err)
	}
	select {
	case url := <-opened:
		if url != "http://127.0.0.1:19000/qr" {
			t.Fatalf("opened URL = %q, want current QR page", url)
		}
	case <-time.After(time.Second):
		t.Fatal("agent-open-current did not open QR page")
	}
	if !strings.Contains(out.String(), "Current desktop agent QR page opened.") {
		t.Fatalf("output = %q", out.String())
	}
}

func TestDesktopAgentOpenCurrentCommandWhenIdle(t *testing.T) {
	agent := newDesktopAgent(application.Flags{})
	server := httptest.NewServer(agent.routes())
	defer server.Close()

	previousBaseURL := desktopAgentBaseURL
	previousOpen := openDesktopAgentPage
	desktopAgentBaseURL = server.URL
	openDesktopAgentPage = func(url string) error {
		t.Fatalf("openDesktopAgentPage(%q) should not be called", url)
		return nil
	}
	t.Cleanup(func() {
		desktopAgentBaseURL = previousBaseURL
		openDesktopAgentPage = previousOpen
	})

	err := desktopAgentOpenCurrentCmd.RunE(desktopAgentOpenCurrentCmd, nil)
	if err == nil {
		t.Fatal("agent-open-current expected an error")
	}
	if !strings.Contains(err.Error(), "no active QR page") {
		t.Fatalf("error = %q, want no active QR page", err.Error())
	}
}

func TestFormatDesktopAgentStatus(t *testing.T) {
	started := time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC)
	finished := started.Add(time.Minute)
	status := desktopAgentResponse{
		State:  "busy",
		Queued: 1,
		Current: &desktopAgentTaskRecord{
			ID:              2,
			Action:          "share",
			Paths:           []string{`C:\tmp\second.txt`},
			State:           "running",
			TransferCurrent: `C:\tmp\second.txt`,
			SavedFiles:      []string{`C:\tmp\second.txt`},
			PageURL:         "http://127.0.0.1:19000/qr",
			StartedAt:       started,
		},
		History: []desktopAgentTaskRecord{
			{
				ID:              1,
				Action:          "share",
				Paths:           []string{`C:\tmp\first.txt`},
				State:           "replaced",
				TransferCurrent: `C:\tmp\first.txt`,
				SavedFiles:      []string{`C:\tmp\first.txt`},
				StartedAt:       started,
				FinishedAt:      &finished,
			},
		},
	}

	got := formatDesktopAgentStatus(status)
	for _, want := range []string{
		"Desktop agent status",
		"- state: busy",
		"- queued: 1",
		"- version: ",
		"#2 share running",
		`paths: C:\tmp\second.txt`,
		`current file: C:\tmp\second.txt`,
		`saved files: C:\tmp\second.txt`,
		`qr page: http://127.0.0.1:19000/qr`,
		"#1 share replaced",
		`paths: C:\tmp\first.txt`,
		`current file: C:\tmp\first.txt`,
		`saved files: C:\tmp\first.txt`,
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("formatDesktopAgentStatus() = %q, want to contain %q", got, want)
		}
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

func assertNotificationContains(t *testing.T, notifications <-chan string, want string) {
	t.Helper()
	deadline := time.After(time.Second)
	for {
		select {
		case got := <-notifications:
			if strings.Contains(got, want) {
				return
			}
		case <-deadline:
			t.Fatalf("notification %q was not sent", want)
		}
	}
}
