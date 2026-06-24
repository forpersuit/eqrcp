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
	if port := os.Getenv("EQT_AGENT_PORT"); port != "" {
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
	eqt, args, err := parseArgs(rawArgs)
	if err != nil {
		return formatError(err, "", "", nil)
	}
	if eqt == "" {
		eqt = filepath.Join(filepath.Dir(exe), "eqt.exe")
		if _, err := os.Stat(eqt); err != nil {
			eqt = filepath.Join(filepath.Dir(exe), "eqt")
		}
	}
	logFile, logPath, err := createLog()
	if err == nil && logFile != nil {
		defer logFile.Close()
	}
	if task, ok := agentTaskFromArgs(args); ok {
		if err := submitTaskToAgent(eqt, task, logFile); err != nil {
			var rejection agentRejectionError
			if errors.As(err, &rejection) {
				return formatError(err, logPath, eqt, append([]string{"desktop"}, args...))
			}
			if directErr := runDirect(eqt, args, logFile); directErr != nil {
				return formatError(fmt.Errorf("agent unavailable: %v; direct launch failed: %w", err, directErr), logPath, eqt, append([]string{"desktop"}, args...))
			}
		}
		return ""
	}
	if err := runDirect(eqt, args, logFile); err != nil {
		return formatError(err, logPath, eqt, append([]string{"desktop"}, args...))
	}
	return ""
}

func isPathAbsolute(p string) bool {
	if filepath.IsAbs(p) {
		return true
	}
	if len(p) >= 2 && p[1] == ':' && ((p[0] >= 'a' && p[0] <= 'z') || (p[0] >= 'A' && p[0] <= 'Z')) {
		return true
	}
	if strings.HasPrefix(p, `\\`) {
		return true
	}
	return false
}

func agentTaskFromArgs(args []string) (desktopAgentTask, bool) {
	if len(args) == 0 {
		return desktopAgentTask{}, false
	}
	switch args[0] {
	case "share", "receive":
		absPaths := make([]string, len(args[1:]))
		for i, p := range args[1:] {
			if isPathAbsolute(p) {
				absPaths[i] = p
			} else if abs, err := filepath.Abs(p); err == nil {
				absPaths[i] = abs
			} else {
				absPaths[i] = p
			}
		}
		return desktopAgentTask{Action: args[0], Paths: absPaths}, true
	default:
		return desktopAgentTask{}, false
	}
}

func submitTaskToAgent(eqt string, task desktopAgentTask, logFile *os.File) error {
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
	if err := startAgent(eqt, logFile); err != nil {
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

func startAgent(eqt string, logFile *os.File) error {
	cmd := exec.Command(eqt, "desktop", "agent")
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

func runDirect(eqt string, args []string, logFile *os.File) error {
	desktopArgs := append([]string{"desktop"}, args...)
	cmd := exec.Command(eqt, desktopArgs...)
	configureCommand(cmd)
	if logFile != nil {
		cmd.Stdout = logFile
		cmd.Stderr = logFile
	}
	return cmd.Run()
}

func parseArgs(args []string) (string, []string, error) {
	if len(args) > 0 && args[0] == "--eqt-exe" {
		if len(args) < 2 || args[1] == "" {
			return "", nil, errors.New("missing value for --eqt-exe")
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
	dir = filepath.Join(dir, "eqt")
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
	message := fmt.Sprintf("eqt failed: %v", err)
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

var desktopAgentPortFilePath = defaultDesktopAgentPortFilePath

func defaultDesktopAgentPortFilePath() string {
	dir, err := os.UserCacheDir()
	if err != nil {
		dir = os.TempDir()
	}
	return filepath.Join(dir, "eqt", "agent.port")
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
