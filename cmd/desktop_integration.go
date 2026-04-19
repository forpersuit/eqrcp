package cmd

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

func installDesktopIntegration() error {
	switch runtime.GOOS {
	case "windows":
		return installWindowsDesktopIntegration()
	default:
		return fmt.Errorf("desktop install is not implemented for %s yet", runtime.GOOS)
	}
}

func uninstallDesktopIntegration() error {
	switch runtime.GOOS {
	case "windows":
		return uninstallWindowsDesktopIntegration()
	default:
		return fmt.Errorf("desktop uninstall is not implemented for %s yet", runtime.GOOS)
	}
}

func installWindowsDesktopIntegration() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	entries := []windowsContextEntry{
		{
			key:     `HKCU\Software\Classes\*\shell\eqrcp-share`,
			label:   "Share with eqrcp",
			command: windowsHiddenCommand(exe, "desktop", "share", "%1"),
		},
		{
			key:     `HKCU\Software\Classes\Directory\shell\eqrcp-share`,
			label:   "Share with eqrcp",
			command: windowsHiddenCommand(exe, "desktop", "share", "%1"),
		},
		{
			key:     `HKCU\Software\Classes\Directory\shell\eqrcp-receive`,
			label:   "Receive here with eqrcp",
			command: windowsHiddenCommand(exe, "desktop", "receive", "%1"),
		},
		{
			key:     `HKCU\Software\Classes\Directory\Background\shell\eqrcp-receive`,
			label:   "Receive here with eqrcp",
			command: windowsHiddenCommand(exe, "desktop", "receive", "%V"),
		},
	}
	for _, entry := range entries {
		if err := entry.install(exe); err != nil {
			return err
		}
	}
	return nil
}

func uninstallWindowsDesktopIntegration() error {
	keys := []string{
		`HKCU\Software\Classes\*\shell\eqrcp-share`,
		`HKCU\Software\Classes\Directory\shell\eqrcp-share`,
		`HKCU\Software\Classes\Directory\shell\eqrcp-receive`,
		`HKCU\Software\Classes\Directory\Background\shell\eqrcp-receive`,
	}
	for _, key := range keys {
		if err := runReg("delete", key, "/f"); err != nil {
			return err
		}
	}
	return nil
}

type windowsContextEntry struct {
	key     string
	label   string
	command string
}

func (e windowsContextEntry) install(icon string) error {
	if err := runReg("add", e.key, "/ve", "/d", e.label, "/f"); err != nil {
		return err
	}
	if err := runReg("add", e.key, "/v", "Icon", "/d", icon, "/f"); err != nil {
		return err
	}
	if err := runReg("add", e.key+`\command`, "/ve", "/d", e.command, "/f"); err != nil {
		return err
	}
	return nil
}

func runReg(args ...string) error {
	cmd := exec.Command("reg", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("reg %v failed: %w: %s", args, err, output)
	}
	return nil
}

func windowsHiddenCommand(exe string, args ...string) string {
	quotedArgs := make([]string, 0, len(args))
	for _, arg := range args {
		quotedArgs = append(quotedArgs, "'"+strings.ReplaceAll(arg, "'", "''")+"'")
	}
	command := fmt.Sprintf(
		`Start-Process -WindowStyle Hidden -FilePath '%s' -ArgumentList @(%s)`,
		strings.ReplaceAll(exe, "'", "''"),
		strings.Join(quotedArgs, ","),
	)
	return fmt.Sprintf(
		`powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "%s"`,
		strings.ReplaceAll(command, `"`, `\"`),
	)
}
