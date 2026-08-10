//go:build !windows

package server

// Keep hideWindowAttr nil for non-Windows platforms
func init() {
}
