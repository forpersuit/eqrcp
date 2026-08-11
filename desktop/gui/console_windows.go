//go:build windows

package main

import (
	"os"
	"syscall"
)

var (
	kernel32          = syscall.NewLazyDLL("kernel32.dll")
	procAttachConsole = kernel32.NewProc("AttachConsole")
	procFreeConsole   = kernel32.NewProc("FreeConsole")
)

const attachParentProcess = 0xFFFFFFFF // -1

func attachWindowsConsole() bool {
	r1, _, _ := procAttachConsole.Call(uintptr(attachParentProcess))
	if r1 == 0 {
		return false
	}

	// Redirect standard file descriptors to Windows console device CONOUT$ / CONIN$
	if stdout, err := os.OpenFile("CONOUT$", os.O_WRONLY, 0); err == nil {
		os.Stdout = stdout
	}
	if stderr, err := os.OpenFile("CONOUT$", os.O_WRONLY, 0); err == nil {
		os.Stderr = stderr
	}
	if stdin, err := os.OpenFile("CONIN$", os.O_RDONLY, 0); err == nil {
		os.Stdin = stdin
	}
	return true
}

func detachWindowsConsole() {
	procFreeConsole.Call()
}

func isWindows() bool {
	return true
}
