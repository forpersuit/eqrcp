package main

import (
	"fmt"
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
	eqrcp := filepath.Join(filepath.Dir(exe), "eqrcp.exe")
	if _, err := os.Stat(eqrcp); err != nil {
		eqrcp = filepath.Join(filepath.Dir(exe), "eqrcp")
	}
	args := append([]string{"desktop"}, os.Args[1:]...)
	cmd := exec.Command(eqrcp, args...)
	configureCommand(cmd)
	if err := cmd.Start(); err != nil {
		showError(fmt.Sprintf("Unable to start eqrcp: %v", err))
	}
}
