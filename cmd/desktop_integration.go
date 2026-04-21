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
	exe, exeErr := os.Executable()
	launcher := ""
	if exeErr != nil {
		builder.WriteString(fmt.Sprintf("- current executable: unavailable (%v)\n", exeErr))
	} else {
		launcher = windowsLauncherPath(exe)
		builder.WriteString(fmt.Sprintf("- current executable: %s\n", exe))
	}
	expectedEntries := windowsContextEntries(exe, launcher)
	statusEntries := windowsContextEntries("", "")
	for index, entry := range statusEntries {
		commandKey := entry.key + `\command`
		command, err := queryRegDefault(commandKey)
		if err != nil {
			builder.WriteString(fmt.Sprintf("- %s: not installed\n", entry.label))
			builder.WriteString(fmt.Sprintf("  key: %s\n", entry.key))
			continue
		}
		state := "installed"
		if exeErr == nil && !windowsCommandMatches(command, expectedEntries[index].command) {
			state = "needs repair"
		}
		builder.WriteString(fmt.Sprintf("- %s: %s\n", entry.label, state))
		builder.WriteString(fmt.Sprintf("  key: %s\n", entry.key))
		builder.WriteString(fmt.Sprintf("  command: %s\n", command))
		if state == "needs repair" {
			builder.WriteString(fmt.Sprintf("  expected: %s\n", expectedEntries[index].command))
			builder.WriteString("  repair: run `eqrcp desktop install` from the executable you want Explorer to use.\n")
		}
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
		state := "installed"
		if exeErr == nil {
			content, err := os.ReadFile(sendTo)
			if err != nil {
				state = "needs repair"
			} else if !windowsCommandMatches(string(content), windowsSendToShareScript(exe, launcher)) {
				state = "needs repair"
			}
		}
		builder.WriteString(fmt.Sprintf("- Send to > Share with eqrcp: %s\n", state))
		builder.WriteString(fmt.Sprintf("  path: %s\n", sendTo))
		if state == "needs repair" {
			builder.WriteString("  repair: run `eqrcp desktop install` from the executable you want Explorer to use.\n")
		}
	}
	if exeErr == nil {
		expectedLauncher := windowsExpectedLauncherPath(exe)
		if launcher == "" {
			builder.WriteString("- eqrcp launcher: not installed\n")
			builder.WriteString(fmt.Sprintf("  expected path: %s\n", expectedLauncher))
			builder.WriteString("  impact: Explorer can still use the hidden PowerShell fallback, but native launcher error dialogs are unavailable.\n")
			builder.WriteString("  repair: place eqrcp-launcher.exe next to eqrcp.exe and run `eqrcp desktop install` again.\n")
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
cmd = Quote(%s) & " --eqrcp-exe " & Quote(%s) & " share"
For Each arg In WScript.Arguments
    cmd = cmd & " " & Quote(arg)
Next
shell.Run cmd, 0, False

Function Quote(value)
    Quote = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
`, windowsVBString(launcher), windowsVBString(exe))
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
	return parseRegDefaultValue(string(output)), nil
}

func parseRegDefaultValue(output string) string {
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		fields := strings.Fields(line)
		for index, field := range fields {
			if strings.HasPrefix(field, "REG_") && index+1 < len(fields) {
				return strings.Join(fields[index+1:], " ")
			}
		}
	}
	return strings.TrimSpace(output)
}

func windowsLauncherPath(exe string) string {
	candidate := windowsExpectedLauncherPath(exe)
	if candidate == "" {
		return ""
	}
	if _, err := os.Stat(candidate); err != nil {
		return ""
	}
	return candidate
}

func windowsExpectedLauncherPath(exe string) string {
	if exe == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(exe), "eqrcp-launcher.exe")
}

func windowsCommandMatches(actual string, expected string) bool {
	return strings.TrimSpace(actual) == strings.TrimSpace(expected)
}

func windowsShellCommand(exe string, launcher string, args ...string) string {
	if launcher != "" {
		launcherArgs := append([]string{"--eqrcp-exe", exe}, args...)
		quotedArgs := make([]string, 0, len(launcherArgs))
		for _, arg := range launcherArgs {
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
