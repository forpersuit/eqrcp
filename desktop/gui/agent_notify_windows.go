//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"

	"eqt/pkg/util"
	toast "git.sr.ht/~jackmordaunt/go-toast/v2"
)

const eqtToastAppID = "EQT Easy QR Transfer"

func notifyDesktop(title string, message string) error {
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

func notifyDesktopWindowsBalloon(title string, message string) error {
	script := fmt.Sprintf(
		`Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.BalloonTipTitle = %s; $n.BalloonTipText = %s; $n.Visible = $true; $n.ShowBalloonTip(5000); Start-Sleep -Seconds 6; $n.Dispose()`,
		powershellString(title),
		powershellString(message),
	)
	cmd := exec.Command("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", script)
	util.HideCommand(cmd)
	return cmd.Start()
}

func powershellString(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}
