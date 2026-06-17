//go:build !windows

package main

func attachWindowsConsole() bool {
	return false
}

func detachWindowsConsole() {
}

func isWindows() bool {
	return false
}
