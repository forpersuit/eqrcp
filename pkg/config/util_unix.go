//go:build !windows

package config

import "github.com/eiannone/keyboard"

func SafeCloseKeyboard() {
	keyboard.Close()
}
