//go:build windows
// +build windows

package server

import "syscall"

func init() {
	hideWindowAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
}
