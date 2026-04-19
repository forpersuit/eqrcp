package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
)

func main() {
	if len(os.Args) < 2 {
		return
	}
	exe, err := os.Executable()
	if err != nil {
		return
	}
	eqrcp, args := parseArgs(os.Args[1:])
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
		showError(formatError(err, logPath))
	}
}

func parseArgs(args []string) (string, []string) {
	if len(args) >= 2 && args[0] == "--eqrcp-exe" {
		return args[1], args[2:]
	}
	return "", args
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

func formatError(err error, logPath string) string {
	message := fmt.Sprintf("eqrcp failed: %v", err)
	if logPath == "" {
		return message
	}
	message += fmt.Sprintf("\n\nLog: %s", logPath)
	if details := readTail(logPath, 4000); details != "" {
		message += "\n\nDetails:\n" + details
	}
	return message
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
