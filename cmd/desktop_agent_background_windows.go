//go:build windows

package cmd

import (
	"os/exec"
	"syscall"
)

func configureDesktopAgentBackgroundCommand(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000,
	}
}
