//go:build !windows

package server

// Windows-only WMI hardware fingerprint queries. These stubs exist so the
// runtime.GOOS switch in hardware.go compiles on non-Windows platforms; they
// are never reached outside Windows.
func queryWindowsBoardUUID() string { return "" }
func queryWindowsCPUSerial() string { return "" }
func queryWindowsDiskSerial() string { return "" }
