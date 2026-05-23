//go:build windows

package cmd

import (
	"os"

	toast "git.sr.ht/~jackmordaunt/go-toast/v2"
)

const eqtToastAppID = "EQT Easy QR Transfer"

func notifyDesktopWindows(title string, message string) error {
	exe, _ := os.Executable()
	_ = toast.SetAppData(toast.AppData{
		AppID:         eqtToastAppID,
		GUID:          "{7F4E6F7D-4E10-49A1-A80D-93F1B9B89B7C}",
		ActivationExe: exe,
	})
	notification := toast.Notification{
		AppID:    eqtToastAppID,
		Title:    title,
		Body:     message,
		Duration: toast.Short,
	}
	if err := notification.Push(); err == nil {
		return nil
	}
	return notifyDesktopWindowsBalloon(title, message)
}
