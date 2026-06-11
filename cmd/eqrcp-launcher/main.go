package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

var desktopAgentURL = getDesktopAgentURL()
var agentHTTPClient = &http.Client{Timeout: time.Second}

func getDesktopAgentURL() string {
	if port := os.Getenv("EQRCP_AGENT_PORT"); port != "" {
		return "http://127.0.0.1:" + port
	}
	return "http://127.0.0.1:48176"
}

type desktopAgentTask struct {
	Action string   `json:"action"`
	Paths  []string `json:"paths"`
}

type agentRejectionError struct {
	message string
}

func (err agentRejectionError) Error() string {
	return err.message
}

func main() {
	message := runLauncher(os.Args[1:])
	if message != "" {
		showError(message)
	}
}

func runLauncher(rawArgs []string) string {
	if len(rawArgs) == 0 {
		return formatError(errors.New("missing launcher action"), "", "", nil)
	}
	exe, err := os.Executable()
	if err != nil {
		return formatError(err, "", "", nil)
	}
	eqrcp, args, err := parseArgs(rawArgs)
	if err != nil {
		return formatError(err, "", "", nil)
	}
	if eqrcp == "" {
		eqrcp = filepath.Join(filepath.Dir(exe), "eqrcp.exe")
		if _, err := os.Stat(eqrcp); err != nil {
			eqrcp = filepath.Join(filepath.Dir(exe), "eqrcp")
		}
	}
	logFile, logPath, err := createLog()
	if err == nil && logFile != nil {
		defer logFile.Close()
	}
	if task, ok := agentTaskFromArgs(args); ok {
		if err := submitTaskToAgent(eqrcp, task, logFile); err != nil {
			var rejection agentRejectionError
			if errors.As(err, &rejection) {
				return formatError(err, logPath, eqrcp, append([]string{"desktop"}, args...))
			}
			if directErr := runDirect(eqrcp, args, logFile); directErr != nil {
				return formatError(fmt.Errorf("agent unavailable: %v; direct launch failed: %w", err, directErr), logPath, eqrcp, append([]string{"desktop"}, args...))
			}
		}
		return ""
	}
	if err := runDirect(eqrcp, args, logFile); err != nil {
		return formatError(err, logPath, eqrcp, append([]string{"desktop"}, args...))
	}
	return ""
}

func agentTaskFromArgs(args []string) (desktopAgentTask, bool) {
	if len(args) == 0 {
		return desktopAgentTask{}, false
	}
	switch args[0] {
	case "share", "receive":
		return desktopAgentTask{Action: args[0], Paths: args[1:]}, true
	default:
		return desktopAgentTask{}, false
	}
}

func submitTaskToAgent(eqrcp string, task desktopAgentTask, logFile *os.File) error {
	if err := postAgentTask(task); err == nil {
		return nil
	} else {
		var rejection agentRejectionError
		if errors.As(err, &rejection) {
			return err
		}
	}
	if err := startAgent(eqrcp, logFile); err != nil {
		return err
	}
	if err := waitForAgent(3 * time.Second); err != nil {
		return err
	}
	return postAgentTask(task)
}

func postAgentTask(task desktopAgentTask) error {
	body, err := json.Marshal(task)
	if err != nil {
		return err
	}
	response, err := agentHTTPClient.Post(desktopAgentURL+"/tasks", "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusAccepted {
		details, _ := io.ReadAll(io.LimitReader(response.Body, 1000))
		message := strings.TrimSpace(string(details))
		if message == "" {
			message = response.Status
		}
		return agentRejectionError{message: fmt.Sprintf("agent rejected task: %s", message)}
	}
	return nil
}

func startAgent(eqrcp string, logFile *os.File) error {
	cmd := exec.Command(eqrcp, "desktop", "agent")
	configureCommand(cmd)
	if logFile != nil {
		cmd.Stdout = logFile
		cmd.Stderr = logFile
	}
	return cmd.Start()
}

func waitForAgent(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var lastErr error
	for time.Now().Before(deadline) {
		response, err := agentHTTPClient.Get(desktopAgentURL + "/health")
		if err == nil {
			response.Body.Close()
			if response.StatusCode == http.StatusNoContent {
				return nil
			}
			lastErr = fmt.Errorf("agent health returned %s", response.Status)
		} else {
			lastErr = err
		}
		time.Sleep(100 * time.Millisecond)
	}
	if lastErr == nil {
		lastErr = errors.New("agent did not become ready")
	}
	return lastErr
}

func runDirect(eqrcp string, args []string, logFile *os.File) error {
	desktopArgs := append([]string{"desktop"}, args...)
	cmd := exec.Command(eqrcp, desktopArgs...)
	configureCommand(cmd)
	if logFile != nil {
		cmd.Stdout = logFile
		cmd.Stderr = logFile
	}
	return cmd.Run()
}

func parseArgs(args []string) (string, []string, error) {
	if len(args) > 0 && args[0] == "--eqrcp-exe" {
		if len(args) < 2 || args[1] == "" {
			return "", nil, errors.New("missing value for --eqrcp-exe")
		}
		return args[1], args[2:], nil
	}
	return "", args, nil
}

func createLog() (*os.File, string, error) {
	dir, err := os.UserCacheDir()
	if err != nil {
		dir = os.TempDir()
	}
	dir = filepath.Join(dir, "eqrcp")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, "", err
	}
	file, err := os.CreateTemp(dir, "launcher-*.log")
	if err != nil {
		return nil, "", err
	}
	return file, file.Name(), nil
}

func formatError(err error, logPath string, exe string, args []string) string {
	message := fmt.Sprintf("eqrcp failed: %v", err)
	if exe != "" {
		message += fmt.Sprintf("\n\nCommand: %s", commandLine(exe, args))
	}
	if logPath == "" {
		return message
	}
	message += fmt.Sprintf("\n\nLog: %s", logPath)
	if details := readTail(logPath, 4000); details != "" {
		message += "\n\nDetails:\n" + details
	}
	return message
}

func commandLine(exe string, args []string) string {
	values := append([]string{exe}, args...)
	for index, value := range values {
		values[index] = quoteForDisplay(value)
	}
	return strings.Join(values, " ")
}

func quoteForDisplay(value string) string {
	if value == "" {
		return `""`
	}
	if !strings.ContainsAny(value, " \t\r\n\"") {
		return value
	}
	return `"` + strings.ReplaceAll(value, `"`, `\"`) + `"`
}

func readTail(path string, limit int64) string {
	file, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return ""
	}
	offset := int64(0)
	if info.Size() > limit {
		offset = info.Size() - limit
	}
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return ""
	}
	data, err := io.ReadAll(file)
	if err != nil {
		return ""
	}
	return string(data)
}
