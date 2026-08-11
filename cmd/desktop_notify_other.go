//go:build !windows

package cmd

func notifyDesktopWindows(title string, message string) error {
	return nil
}
