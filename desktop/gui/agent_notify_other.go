//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

func notifyDesktop(title string, message string) error {
	switch runtime.GOOS {
	case "linux":
		if os.Getenv("DISPLAY") == "" && os.Getenv("WAYLAND_DISPLAY") == "" {
			return nil
		}
		return exec.Command("notify-send", title, message).Start()
	case "darwin":
		script := fmt.Sprintf("display notification %s with title %s", appleScriptString(message), appleScriptString(title))
		return exec.Command("osascript", "-e", script).Start()
	default:
		return nil
	}
}

func appleScriptString(value string) string {
	return `"` + strings.ReplaceAll(strings.ReplaceAll(value, `\`, `\\`), `"`, `\"`) + `"`
}
