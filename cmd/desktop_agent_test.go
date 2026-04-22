package cmd

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
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
	if len(status.History) != 1 || status.History[0].State != "completed" || status.History[0].Action != "share" {
		t.Fatalf("History = %#v, want completed share record", status.History)
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
			agent.setActiveStop(func() {
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
		agent.setActiveStop(func() {
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
		agent.setActiveStop(func() {
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
		agent.setActiveStop(func() {
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
		agent.setActiveStop(func() {
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
			ID:         1,
			Action:     "share",
			Paths:      []string{"finished.txt"},
			State:      "completed",
			StartedAt:  started,
			FinishedAt: &finished,
		},
	}
	agent.current = &desktopAgentTaskRecord{
		ID:        2,
		Action:    "receive",
		Paths:     []string{"/tmp/recv"},
		State:     "running",
		PageURL:   "http://127.0.0.1:19000/qr",
		StartedAt: started,
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
		"Stop Agent",
		"fetch('/status'",
		"setInterval(updateAgentStatus, 500)",
		"Open QR Page",
		"http://127.0.0.1:19000/qr",
		"receive",
		"/tmp/recv",
		"finished.txt",
		"completed",
	} {
		if !strings.Contains(string(body), want) {
			t.Fatalf("agent page = %q, want to contain %q", string(body), want)
		}
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
			ID:        2,
			Action:    "share",
			Paths:     []string{`C:\tmp\second.txt`},
			State:     "running",
			PageURL:   "http://127.0.0.1:19000/qr",
			StartedAt: started,
		},
		History: []desktopAgentTaskRecord{
			{
				ID:         1,
				Action:     "share",
				Paths:      []string{`C:\tmp\first.txt`},
				State:      "replaced",
				StartedAt:  started,
				FinishedAt: &finished,
			},
		},
	}

	got := formatDesktopAgentStatus(status)
	for _, want := range []string{
		"Desktop agent status",
		"- state: busy",
		"- queued: 1",
		"#2 share running",
		`paths: C:\tmp\second.txt`,
		`qr page: http://127.0.0.1:19000/qr`,
		"#1 share replaced",
		`paths: C:\tmp\first.txt`,
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
