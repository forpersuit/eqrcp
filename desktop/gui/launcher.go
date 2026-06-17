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

// isRightClickAction determines if the program is called by right-click shortcuts
func isRightClickAction(args []string) bool {
	if len(args) == 0 {
		return false
	}
	switch args[0] {
	case "share", "receive":
		return true
	default:
		return false
	}
}

// runSilentLauncher executes the task submission or agent auto-starting logic
func runSilentLauncher(args []string) {
	if len(args) == 0 {
		return
	}

	exe, err := os.Executable()
	if err != nil {
		showError(fmt.Sprintf("eqrcp failed: %v", err))
		return
	}

	task := desktopAgentTask{
		Action: args[0],
		Paths:  args[1:],
	}

	logFile, logPath, err := createLauncherLog()
	if err == nil && logFile != nil {
		defer logFile.Close()
	}

	if err := submitTaskToAgent(exe, task, logFile); err != nil {
		var rejection agentRejectionError
		if errors.As(err, &rejection) {
			errMsg := formatLauncherError(err, logPath, exe, args)
			showError(errMsg)
			return
		}

		// Fallback: run command directly if agent cannot be spawned
		if directErr := runDirectCLI(exe, args, logFile); directErr != nil {
			errMsg := formatLauncherError(fmt.Errorf("agent unavailable: %v; direct launch failed: %w", err, directErr), logPath, exe, args)
			showError(errMsg)
		}
	}
}

func submitTaskToAgent(exe string, task desktopAgentTask, logFile *os.File) error {
	if actualURL := readPortFileAndGetURL(); actualURL != "" {
		desktopAgentURL = actualURL
	}
	if err := postAgentTask(task); err == nil {
		return nil
	} else {
		var rejection agentRejectionError
		if errors.As(err, &rejection) {
			return err
		}
	}
	if err := startAgentProcess(exe, logFile); err != nil {
		return err
	}
	if err := waitForAgentReady(3 * time.Second); err != nil {
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

func startAgentProcess(exe string, logFile *os.File) error {
	cmd := exec.Command(exe, "desktop", "agent")
	configureCommand(cmd)
	if logFile != nil {
		cmd.Stdout = logFile
		cmd.Stderr = logFile
	}
	return cmd.Start()
}

func waitForAgentReady(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var lastErr error
	portFilePath := desktopAgentPortFilePath()
	for time.Now().Before(deadline) {
		if data, err := os.ReadFile(portFilePath); err == nil {
			if portVal := strings.TrimSpace(string(data)); portVal != "" {
				desktopAgentURL = "http://127.0.0.1:" + portVal
			}
		}
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

func runDirectCLI(exe string, args []string, logFile *os.File) error {
	cmd := exec.Command(exe, args...)
	configureCommand(cmd)
	if logFile != nil {
		cmd.Stdout = logFile
		cmd.Stderr = logFile
	}
	return cmd.Run()
}

func createLauncherLog() (*os.File, string, error) {
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

func formatLauncherError(err error, logPath string, exe string, args []string) string {
	message := fmt.Sprintf("eqrcp failed: %v", err)
	if exe != "" {
		message += fmt.Sprintf("\n\nCommand: %s", commandLineString(exe, args))
	}
	if logPath == "" {
		return message
	}
	message += fmt.Sprintf("\n\nLog: %s", logPath)
	if details := readTailBytes(logPath, 4000); details != "" {
		message += "\n\nDetails:\n" + details
	}
	return message
}

func commandLineString(exe string, args []string) string {
	values := append([]string{exe}, args...)
	for index, value := range values {
		values[index] = quoteArgForDisplay(value)
	}
	return strings.Join(values, " ")
}

func quoteArgForDisplay(value string) string {
	if value == "" {
		return `""`
	}
	if !strings.ContainsAny(value, " \t\r\n\"") {
		return value
	}
	return `"` + strings.ReplaceAll(value, `"`, `\"`) + `"`
}

func readTailBytes(path string, limit int64) string {
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


func readPortFileAndGetURL() string {
	portFilePath := desktopAgentPortFilePath()
	if data, err := os.ReadFile(portFilePath); err == nil {
		if portVal := strings.TrimSpace(string(data)); portVal != "" {
			return "http://127.0.0.1:" + portVal
		}
	}
	return ""
}
