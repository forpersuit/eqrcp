package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

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
	args = append([]string{"desktop"}, args...)
	cmd := exec.Command(eqrcp, args...)
	configureCommand(cmd)
	logFile, logPath, err := createLog()
	if err == nil {
		defer logFile.Close()
		cmd.Stdout = logFile
		cmd.Stderr = logFile
	}
	if err := cmd.Run(); err != nil {
		return formatError(err, logPath, eqrcp, args)
	}
	return ""
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
