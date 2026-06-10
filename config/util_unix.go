//go:build !windows
package config

func wakeUpReaderOnWindows() {
	// No-op on non-Windows platforms
}
