//go:build !windows
package config

import "github.com/eiannone/keyboard"

func wakeUpReaderOnWindows() {
	// No-op on non-Windows platforms
}

func SafeCloseKeyboard() {
	keyboard.Close()
}
