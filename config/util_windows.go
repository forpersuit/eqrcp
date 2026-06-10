//go:build windows
package config

import (
	"syscall"
	"unsafe"
)

func wakeUpReaderOnWindows() {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	procWriteConsoleInput := kernel32.NewProc("WriteConsoleInputW")

	hStdin, err := syscall.GetStdHandle(syscall.STD_INPUT_HANDLE)
	if err != nil {
		return
	}

	type KEY_EVENT_RECORD struct {
		KeyDown         int32
		RepeatCount     uint16
		VirtualKeyCode  uint16
		VirtualScanCode uint16
		UnicodeChar     uint16
		ControlKeyState uint32
	}

	type INPUT_RECORD struct {
		EventType uint16
		Padding   uint16
		Event     [16]byte
	}

	var record INPUT_RECORD
	record.EventType = 0x0001 // KEY_EVENT

	keyRecord := (*KEY_EVENT_RECORD)(unsafe.Pointer(&record.Event[0]))
	keyRecord.KeyDown = 1
	keyRecord.RepeatCount = 1
	keyRecord.VirtualKeyCode = 0x0D // VK_RETURN
	keyRecord.UnicodeChar = 0x0D    // '\r'

	var written uint32
	procWriteConsoleInput.Call(
		uintptr(hStdin),
		uintptr(unsafe.Pointer(&record)),
		1,
		uintptr(unsafe.Pointer(&written)),
	)
}
