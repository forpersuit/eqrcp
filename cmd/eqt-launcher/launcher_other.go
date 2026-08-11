//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
)

func configureCommand(cmd *exec.Cmd) {}

func showError(message string) {
	fmt.Fprintln(os.Stderr, message)
}
