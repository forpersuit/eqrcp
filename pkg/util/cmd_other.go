//go:build !windows

package util

import (
	"os/exec"
)

// HideCommand is a no-op on non-Windows platforms.
func HideCommand(cmd *exec.Cmd) {}
