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

func desktopIntegrationStatus() (string, error) {
	switch runtime.GOOS {
	case "windows":
		return windowsDesktopIntegrationStatus()
	default:
		return fmt.Sprintf("Desktop integration status is not implemented for %s yet.\n", runtime.GOOS), nil
	}
}

func installWindowsDesktopIntegration() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	entries := windowsContextEntries(exe)
	for _, entry := range entries {
		if err := entry.install(exe); err != nil {
			return err
		}
	}
	return nil
}

func uninstallWindowsDesktopIntegration() error {
	for _, entry := range windowsContextEntries("") {
		if err := runReg("delete", entry.key, "/f"); err != nil {
			return err
		}
	}
	return nil
}

func windowsDesktopIntegrationStatus() (string, error) {
	var builder strings.Builder
	builder.WriteString("Windows desktop integration status\n")
	for _, entry := range windowsContextEntries("") {
		commandKey := entry.key + `\command`
		command, err := queryRegDefault(commandKey)
		if err != nil {
			builder.WriteString(fmt.Sprintf("- %s: not installed\n", entry.label))
			builder.WriteString(fmt.Sprintf("  key: %s\n", entry.key))
			continue
		}
		builder.WriteString(fmt.Sprintf("- %s: installed\n", entry.label))
		builder.WriteString(fmt.Sprintf("  key: %s\n", entry.key))
		builder.WriteString(fmt.Sprintf("  command: %s\n", command))
	}
	return builder.String(), nil
}

type windowsContextEntry struct {
	key     string
	label   string
	command string
}

func windowsContextEntries(exe string) []windowsContextEntry {
	return []windowsContextEntry{
		{
			key:     `HKCU\Software\Classes\*\shell\eqrcp-share`,
			label:   "Share with eqrcp (file)",
			command: windowsHiddenCommand(exe, "desktop", "share", "%1"),
		},
		{
			key:     `HKCU\Software\Classes\Directory\shell\eqrcp-share`,
			label:   "Share with eqrcp (directory)",
			command: windowsHiddenCommand(exe, "desktop", "share", "%1"),
		},
		{
			key:     `HKCU\Software\Classes\Directory\shell\eqrcp-receive`,
			label:   "Receive here with eqrcp (directory)",
			command: windowsHiddenCommand(exe, "desktop", "receive", "%1"),
		},
		{
			key:     `HKCU\Software\Classes\Directory\Background\shell\eqrcp-receive`,
			label:   "Receive here with eqrcp (directory background)",
			command: windowsHiddenCommand(exe, "desktop", "receive", "%V"),
		},
	}
}

func (e windowsContextEntry) install(icon string) error {
	menuLabel := e.label
	if index := strings.Index(menuLabel, " ("); index >= 0 {
		menuLabel = menuLabel[:index]
	}
	if err := runReg("add", e.key, "/ve", "/d", menuLabel, "/f"); err != nil {
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

func queryRegDefault(key string) (string, error) {
	output, err := exec.Command("reg", "query", key, "/ve").CombinedOutput()
	if err != nil {
		return "", err
	}
	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) >= 3 && fields[0] == "(Default)" {
			return strings.Join(fields[2:], " "), nil
		}
	}
	return strings.TrimSpace(string(output)), nil
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
