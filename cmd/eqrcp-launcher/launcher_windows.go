//go:build windows

package main

import (
	"os/exec"
	"syscall"
	"unsafe"
)

func configureCommand(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}

func showError(message string) {
	messagePtr, err := syscall.UTF16PtrFromString(message)
	if err != nil {
		return
	}
	titlePtr, err := syscall.UTF16PtrFromString("eqrcp")
	if err != nil {
		return
	}
	user32 := syscall.NewLazyDLL("user32.dll")
	messageBox := user32.NewProc("MessageBoxW")
	const (
		mbOK       = 0x00000000
		mbIconErr  = 0x00000010
		mbTaskMode = 0x00002000
	)
	_, _, _ = messageBox.Call(
		0,
		uintptr(unsafe.Pointer(messagePtr)),
		uintptr(unsafe.Pointer(titlePtr)),
		uintptr(mbOK|mbIconErr|mbTaskMode),
	)
}
