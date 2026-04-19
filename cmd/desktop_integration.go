package cmd

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
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
	launcher := windowsLauncherPath(exe)
	entries := windowsContextEntries(exe, launcher)
	for _, entry := range entries {
		if err := entry.install(exe); err != nil {
			return err
		}
	}
	if err := installWindowsSendToShare(exe, launcher); err != nil {
		return err
	}
	return nil
}

func uninstallWindowsDesktopIntegration() error {
	for _, entry := range windowsContextEntries("", "") {
		if err := runRegAllowMissing("delete", entry.key, "/f"); err != nil {
			return err
		}
	}
	if err := uninstallWindowsSendToShare(); err != nil {
		return err
	}
	return nil
}

func windowsDesktopIntegrationStatus() (string, error) {
	var builder strings.Builder
	builder.WriteString("Windows desktop integration status\n")
	for _, entry := range windowsContextEntries("", "") {
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
	sendTo, err := windowsSendToSharePath()
	if err != nil {
		builder.WriteString(fmt.Sprintf("- Send to > Share with eqrcp: unavailable (%v)\n", err))
		return builder.String(), nil
	}
	if _, err := os.Stat(sendTo); err != nil {
		builder.WriteString("- Send to > Share with eqrcp: not installed\n")
		builder.WriteString(fmt.Sprintf("  path: %s\n", sendTo))
	} else {
		builder.WriteString("- Send to > Share with eqrcp: installed\n")
		builder.WriteString(fmt.Sprintf("  path: %s\n", sendTo))
	}
	if exe, err := os.Executable(); err == nil {
		launcher := windowsLauncherPath(exe)
		if launcher == "" {
			builder.WriteString("- eqrcp launcher: not installed\n")
		} else {
			builder.WriteString("- eqrcp launcher: installed\n")
			builder.WriteString(fmt.Sprintf("  path: %s\n", launcher))
		}
	}
	return builder.String(), nil
}

func installWindowsSendToShare(exe string, launcher string) error {
	path, err := windowsSendToSharePath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(windowsSendToShareScript(exe, launcher)), 0644)
}

func uninstallWindowsSendToShare() error {
	path, err := windowsSendToSharePath()
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func windowsSendToSharePath() (string, error) {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		return "", fmt.Errorf("APPDATA is not set")
	}
	return filepath.Join(appData, "Microsoft", "Windows", "SendTo", "Share with eqrcp.vbs"), nil
}

func windowsSendToShareScript(exe string, launcher string) string {
	if launcher != "" {
		return fmt.Sprintf(`Set shell = CreateObject("WScript.Shell")
cmd = Quote(%s) & " share"
For Each arg In WScript.Arguments
    cmd = cmd & " " & Quote(arg)
Next
shell.Run cmd, 0, False

Function Quote(value)
    Quote = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
`, windowsVBString(launcher))
	}
	return fmt.Sprintf(`Set shell = CreateObject("WScript.Shell")
cmd = Quote(%s) & " desktop share"
For Each arg In WScript.Arguments
    cmd = cmd & " " & Quote(arg)
Next
shell.Run cmd, 0, False

Function Quote(value)
    Quote = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
`, windowsVBString(exe))
}

type windowsContextEntry struct {
	key     string
	label   string
	command string
}

func windowsContextEntries(exe string, launcher string) []windowsContextEntry {
	return []windowsContextEntry{
		{
			key:     `HKCU\Software\Classes\*\shell\eqrcp-share`,
			label:   "Share with eqrcp (file)",
			command: windowsShellCommand(exe, launcher, "share", "%1"),
		},
		{
			key:     `HKCU\Software\Classes\Directory\shell\eqrcp-share`,
			label:   "Share with eqrcp (directory)",
			command: windowsShellCommand(exe, launcher, "share", "%1"),
		},
		{
			key:     `HKCU\Software\Classes\Directory\shell\eqrcp-receive`,
			label:   "Receive here with eqrcp (directory)",
			command: windowsShellCommand(exe, launcher, "receive", "%1"),
		},
		{
			key:     `HKCU\Software\Classes\Directory\Background\shell\eqrcp-receive`,
			label:   "Receive here with eqrcp (directory background)",
			command: windowsShellCommand(exe, launcher, "receive", "%V"),
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

func runRegAllowMissing(args ...string) error {
	cmd := exec.Command("reg", args...)
	if output, err := cmd.CombinedOutput(); err != nil && !strings.Contains(string(output), "unable to find") && !strings.Contains(string(output), "not found") {
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

func windowsLauncherPath(exe string) string {
	if exe == "" {
		return ""
	}
	candidate := filepath.Join(filepath.Dir(exe), "eqrcp-launcher.exe")
	if _, err := os.Stat(candidate); err != nil {
		return ""
	}
	return candidate
}

func windowsShellCommand(exe string, launcher string, args ...string) string {
	if launcher != "" {
		quotedArgs := make([]string, 0, len(args))
		for _, arg := range args {
			quotedArgs = append(quotedArgs, `"`+arg+`"`)
		}
		return fmt.Sprintf(`"%s" %s`, launcher, strings.Join(quotedArgs, " "))
	}
	desktopArgs := append([]string{"desktop"}, args...)
	return windowsHiddenCommand(exe, desktopArgs...)
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

func windowsVBString(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}
