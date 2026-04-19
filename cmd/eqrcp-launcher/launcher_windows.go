//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

func configureCommand(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}

func showError(message string) {
	_ = exec.Command(
		"powershell.exe",
		"-NoProfile",
		"-ExecutionPolicy",
		"Bypass",
		"-WindowStyle",
		"Hidden",
		"-Command",
		`Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show($args[0], 'eqrcp')`,
		message,
	).Start()
}
