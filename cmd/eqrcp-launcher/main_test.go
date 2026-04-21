package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestParseArgsWithExplicitEqrcpExe(t *testing.T) {
	exe, args, err := parseArgs([]string{"--eqrcp-exe", `C:\Tools\renamed.exe`, "share", `C:\tmp\a.txt`})
	if err != nil {
		t.Fatalf("parseArgs() error = %v", err)
	}
	if exe != `C:\Tools\renamed.exe` {
		t.Fatalf("parseArgs() exe = %q", exe)
	}
	if len(args) != 2 || args[0] != "share" || args[1] != `C:\tmp\a.txt` {
		t.Fatalf("parseArgs() args = %#v", args)
	}
}

func TestParseArgsWithoutExplicitEqrcpExe(t *testing.T) {
	exe, args, err := parseArgs([]string{"receive", `C:\tmp`})
	if err != nil {
		t.Fatalf("parseArgs() error = %v", err)
	}
	if exe != "" {
		t.Fatalf("parseArgs() exe = %q, want empty", exe)
	}
	if len(args) != 2 || args[0] != "receive" || args[1] != `C:\tmp` {
		t.Fatalf("parseArgs() args = %#v", args)
	}
}

func TestParseArgsMissingExplicitEqrcpExe(t *testing.T) {
	_, _, err := parseArgs([]string{"--eqrcp-exe"})
	if err == nil || !strings.Contains(err.Error(), "missing value for --eqrcp-exe") {
		t.Fatalf("parseArgs() error = %v, want missing --eqrcp-exe error", err)
	}
}

func TestAgentTaskFromArgs(t *testing.T) {
	task, ok := agentTaskFromArgs([]string{"share", `C:\tmp\a.txt`, `C:\tmp\b.txt`})
	if !ok {
		t.Fatal("agentTaskFromArgs() ok = false")
	}
	if task.Action != "share" || len(task.Paths) != 2 || task.Paths[1] != `C:\tmp\b.txt` {
		t.Fatalf("agentTaskFromArgs() = %#v", task)
	}

	if _, ok := agentTaskFromArgs([]string{"status"}); ok {
		t.Fatal("agentTaskFromArgs() should ignore non-transfer actions")
	}
}

func TestPostAgentTask(t *testing.T) {
	var got desktopAgentTask
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/tasks" {
			t.Fatalf("path = %q, want /tasks", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatal(err)
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()
	withDesktopAgentURL(t, server.URL)

	err := postAgentTask(desktopAgentTask{Action: "receive", Paths: []string{`C:\tmp`}})
	if err != nil {
		t.Fatalf("postAgentTask() error = %v", err)
	}
	if got.Action != "receive" || len(got.Paths) != 1 || got.Paths[0] != `C:\tmp` {
		t.Fatalf("posted task = %#v", got)
	}
}

func TestPostAgentTaskReportsRejection(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "desktop agent is busy", http.StatusConflict)
	}))
	defer server.Close()
	withDesktopAgentURL(t, server.URL)

	err := postAgentTask(desktopAgentTask{Action: "share", Paths: []string{"a.txt"}})
	if err == nil || !strings.Contains(err.Error(), "desktop agent is busy") {
		t.Fatalf("postAgentTask() error = %v, want busy rejection", err)
	}
	var rejection agentRejectionError
	if !errors.As(err, &rejection) {
		t.Fatalf("postAgentTask() error type = %T, want agentRejectionError", err)
	}
}

func TestSubmitTaskToAgentDoesNotStartAgentAfterRejection(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "desktop agent is busy", http.StatusConflict)
	}))
	defer server.Close()
	withDesktopAgentURL(t, server.URL)

	err := submitTaskToAgent("/path/to/missing-eqrcp", desktopAgentTask{Action: "share", Paths: []string{"a.txt"}}, nil)
	if err == nil || !strings.Contains(err.Error(), "desktop agent is busy") {
		t.Fatalf("submitTaskToAgent() error = %v, want busy rejection", err)
	}
	var rejection agentRejectionError
	if !errors.As(err, &rejection) {
		t.Fatalf("submitTaskToAgent() error type = %T, want agentRejectionError", err)
	}
}

func TestWaitForAgent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			t.Fatalf("path = %q, want /health", r.URL.Path)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	withDesktopAgentURL(t, server.URL)

	if err := waitForAgent(time.Second); err != nil {
		t.Fatalf("waitForAgent() error = %v", err)
	}
}

func TestFormatErrorIncludesCommandLogAndDetails(t *testing.T) {
	dir := t.TempDir()
	logPath := filepath.Join(dir, "launcher.log")
	if err := os.WriteFile(logPath, []byte("first line\nlast line\n"), 0644); err != nil {
		t.Fatal(err)
	}

	got := formatError(
		errors.New("exit status 1"),
		logPath,
		`C:\Tools\renamed eqrcp.exe`,
		[]string{"desktop", "share", `C:\tmp\my file.txt`},
	)

	for _, want := range []string{
		"eqrcp failed: exit status 1",
		`Command: "C:\Tools\renamed eqrcp.exe" desktop share "C:\tmp\my file.txt"`,
		"Log: " + logPath,
		"Details:\nfirst line\nlast line\n",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("formatError() = %q, want to contain %q", got, want)
		}
	}
}

func TestReadTailLimitsOutput(t *testing.T) {
	path := filepath.Join(t.TempDir(), "launcher.log")
	if err := os.WriteFile(path, []byte("0123456789"), 0644); err != nil {
		t.Fatal(err)
	}

	got := readTail(path, 4)
	if got != "6789" {
		t.Fatalf("readTail() = %q, want %q", got, "6789")
	}
}

func TestRunLauncherReportsArgumentError(t *testing.T) {
	got := runLauncher([]string{"--eqrcp-exe"})
	if !strings.Contains(got, "missing value for --eqrcp-exe") {
		t.Fatalf("runLauncher() = %q, want missing --eqrcp-exe error", got)
	}
}

func withDesktopAgentURL(t *testing.T, url string) {
	t.Helper()
	old := desktopAgentURL
	desktopAgentURL = url
	t.Cleanup(func() {
		desktopAgentURL = old
	})
}
