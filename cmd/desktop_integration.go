package cmd

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"eqrcp/version"
)

const windowsStartupRunKey = `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
const windowsStartupValueName = "eqrcp-agent"

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

func installDesktopStartup() error {
	switch runtime.GOOS {
	case "windows":
		return installWindowsDesktopStartup()
	default:
		return fmt.Errorf("desktop startup is not implemented for %s yet", runtime.GOOS)
	}
}

func uninstallDesktopStartup() error {
	switch runtime.GOOS {
	case "windows":
		return uninstallWindowsDesktopStartup()
	default:
		return fmt.Errorf("desktop startup is not implemented for %s yet", runtime.GOOS)
	}
}

func desktopStartupStatus() (string, error) {
	switch runtime.GOOS {
	case "windows":
		return windowsDesktopStartupStatus()
	default:
		return fmt.Sprintf("Desktop startup status is not implemented for %s yet.\n", runtime.GOOS), nil
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

func installWindowsDesktopStartup() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	return runReg("add", windowsStartupRunKey, "/v", windowsStartupValueName, "/t", "REG_SZ", "/d", windowsAgentStartupCommand(exe), "/f")
}

func uninstallWindowsDesktopStartup() error {
	return runRegAllowMissing("delete", windowsStartupRunKey, "/v", windowsStartupValueName, "/f")
}

func windowsDesktopStartupStatus() (string, error) {
	env := windowsDesktopStartupStatusEnv{
		executable:    os.Executable,
		queryRegValue: queryRegValue,
	}
	return formatWindowsDesktopStartupStatus(env)
}

func windowsDesktopIntegrationStatus() (string, error) {
	env := windowsDesktopStatusEnv{
		executable:      os.Executable,
		launcherPath:    windowsLauncherPath,
		queryRegDefault: queryRegDefault,
		queryRegValue:   queryRegValue,
		agentStatus:     fetchDesktopAgentStatus,
		sendToPath:      windowsSendToSharePath,
		stat:            os.Stat,
		readFile:        os.ReadFile,
	}
	return formatWindowsDesktopIntegrationStatus(env)
}

type windowsDesktopStatusEnv struct {
	executable      func() (string, error)
	launcherPath    func(string) string
	queryRegDefault func(string) (string, error)
	queryRegValue   func(string, string) (string, error)
	agentStatus     func() (desktopAgentResponse, error)
	sendToPath      func() (string, error)
	stat            func(string) (os.FileInfo, error)
	readFile        func(string) ([]byte, error)
}

func formatWindowsDesktopIntegrationStatus(env windowsDesktopStatusEnv) (string, error) {
	var builder strings.Builder
	summary := windowsDesktopStatusSummary{}
	builder.WriteString("Windows desktop integration status\n")
	exe, exeErr := env.executable()
	launcher := ""
	if exeErr != nil {
		builder.WriteString(fmt.Sprintf("- current executable: unavailable (%v)\n", exeErr))
	} else {
		launcher = env.launcherPath(exe)
		builder.WriteString(fmt.Sprintf("- current executable: %s\n", exe))
	}
	expectedEntries := windowsContextEntries(exe, launcher)
	statusEntries := windowsContextEntries("", "")
	for index, entry := range statusEntries {
		commandKey := entry.key + `\command`
		command, err := env.queryRegDefault(commandKey)
		if err != nil {
			summary.notInstalled++
			builder.WriteString(fmt.Sprintf("- %s: not installed\n", entry.label))
			builder.WriteString(fmt.Sprintf("  key: %s\n", entry.key))
			continue
		}
		state := "installed"
		if exeErr == nil && !windowsCommandMatches(command, expectedEntries[index].command) {
			state = "needs repair"
		}
		summary.add(state)
		builder.WriteString(fmt.Sprintf("- %s: %s\n", entry.label, state))
		builder.WriteString(fmt.Sprintf("  key: %s\n", entry.key))
		builder.WriteString(fmt.Sprintf("  command: %s\n", command))
		if state == "needs repair" {
			builder.WriteString(fmt.Sprintf("  expected: %s\n", expectedEntries[index].command))
			builder.WriteString("  repair: run `eqrcp desktop install` from the executable you want Explorer to use.\n")
		}
	}
	sendTo, err := env.sendToPath()
	if err != nil {
		builder.WriteString(fmt.Sprintf("- Send to > Share with eqrcp: unavailable (%v)\n", err))
		return builder.String(), nil
	}
	if _, err := env.stat(sendTo); err != nil {
		summary.notInstalled++
		builder.WriteString("- Send to > Share with eqrcp: not installed\n")
		builder.WriteString(fmt.Sprintf("  path: %s\n", sendTo))
	} else {
		state := "installed"
		if exeErr == nil {
			content, err := env.readFile(sendTo)
			if err != nil {
				state = "needs repair"
			} else if !windowsCommandMatches(string(content), windowsSendToShareScript(exe, launcher)) {
				state = "needs repair"
			}
		}
		summary.add(state)
		builder.WriteString(fmt.Sprintf("- Send to > Share with eqrcp: %s\n", state))
		builder.WriteString(fmt.Sprintf("  path: %s\n", sendTo))
		if state == "needs repair" {
			builder.WriteString("  repair: run `eqrcp desktop install` from the executable you want Explorer to use.\n")
		}
	}
	if exeErr == nil {
		expectedLauncher := windowsExpectedLauncherPath(exe)
		if launcher == "" {
			summary.notInstalled++
			builder.WriteString("- eqrcp launcher: not installed\n")
			builder.WriteString(fmt.Sprintf("  expected path: %s\n", expectedLauncher))
			builder.WriteString("  impact: Explorer can still use the hidden PowerShell fallback, but native launcher error dialogs are unavailable.\n")
			builder.WriteString("  repair: place eqrcp-launcher.exe next to eqrcp.exe and run `eqrcp desktop install` again.\n")
		} else {
			summary.installed++
			builder.WriteString("- eqrcp launcher: installed\n")
			builder.WriteString(fmt.Sprintf("  path: %s\n", launcher))
		}
	}
	builder.WriteString(formatWindowsDesktopStartupStatusSection(windowsDesktopStartupStatusEnv{
		executable: func() (string, error) {
			return exe, exeErr
		},
		queryRegValue: env.queryRegValue,
	}))
	builder.WriteString(formatWindowsDesktopAgentRuntimeStatus(env))
	builder.WriteString(fmt.Sprintf("- summary: %d installed, %d needs repair, %d not installed\n", summary.installed, summary.needsRepair, summary.notInstalled))
	return builder.String(), nil
}

func formatWindowsDesktopAgentRuntimeStatus(env windowsDesktopStatusEnv) string {
	var builder strings.Builder
	builder.WriteString("- Desktop agent runtime: ")
	if env.agentStatus == nil {
		builder.WriteString("unavailable\n")
		return builder.String()
	}
	status, err := env.agentStatus()
	if err != nil {
		if errors.Is(err, os.ErrNotExist) || strings.Contains(err.Error(), "desktop agent is not running") {
			builder.WriteString("not running\n")
			builder.WriteString("  start: run `eqrcp desktop agent-start` or trigger a right-click share/receive action.\n")
			return builder.String()
		}
		builder.WriteString(fmt.Sprintf("unavailable (%v)\n", err))
		return builder.String()
	}
	builder.WriteString("running\n")
	builder.WriteString(fmt.Sprintf("  state: %s\n", status.State))
	builder.WriteString(fmt.Sprintf("  queued: %d\n", status.Queued))
	builder.WriteString(fmt.Sprintf("  version: %s\n", status.Version))
	if !status.AgentStartedAt.IsZero() {
		builder.WriteString(fmt.Sprintf("  started: %s\n", status.AgentStartedAt.Format(time.RFC3339)))
	}
	currentVersion := version.String()
	if status.Version != "" && currentVersion != "" && status.Version != currentVersion {
		builder.WriteString("  status: needs restart\n")
		builder.WriteString(fmt.Sprintf("  current executable version: %s\n", currentVersion))
		builder.WriteString("  repair: run `eqrcp desktop agent-stop`, then `eqrcp desktop agent-start`, or trigger a fresh right-click action.\n")
	}
	if status.Current != nil {
		builder.WriteString(fmt.Sprintf("  current task: #%d %s %s\n", status.Current.ID, status.Current.Action, status.Current.State))
	}
	if status.LastError != "" {
		builder.WriteString(fmt.Sprintf("  last error: %s\n", status.LastError))
	}
	return builder.String()
}

type windowsDesktopStatusSummary struct {
	installed    int
	needsRepair  int
	notInstalled int
}

func (summary *windowsDesktopStatusSummary) add(state string) {
	switch state {
	case "needs repair":
		summary.needsRepair++
	case "not installed":
		summary.notInstalled++
	default:
		summary.installed++
	}
}

type windowsDesktopStartupStatusEnv struct {
	executable    func() (string, error)
	queryRegValue func(string, string) (string, error)
}

func formatWindowsDesktopStartupStatus(env windowsDesktopStartupStatusEnv) (string, error) {
	var builder strings.Builder
	builder.WriteString("Windows desktop agent startup status\n")
	builder.WriteString(formatWindowsDesktopStartupStatusSection(env))
	return builder.String(), nil
}

func formatWindowsDesktopStartupStatusSection(env windowsDesktopStartupStatusEnv) string {
	var builder strings.Builder
	builder.WriteString("- Agent startup: ")
	exe, exeErr := env.executable()
	command, err := env.queryRegValue(windowsStartupRunKey, windowsStartupValueName)
	if err != nil {
		builder.WriteString("disabled\n")
		builder.WriteString(fmt.Sprintf("  key: %s\n", windowsStartupRunKey))
		builder.WriteString(fmt.Sprintf("  value: %s\n", windowsStartupValueName))
		builder.WriteString("  enable: run `eqrcp desktop startup-enable` from the executable you want Windows to start.\n")
		return builder.String()
	}
	expected := ""
	state := "enabled"
	if exeErr == nil {
		expected = windowsAgentStartupCommand(exe)
		if !windowsCommandMatches(command, expected) {
			state = "needs repair"
		}
	}
	builder.WriteString(state + "\n")
	builder.WriteString(fmt.Sprintf("  key: %s\n", windowsStartupRunKey))
	builder.WriteString(fmt.Sprintf("  value: %s\n", windowsStartupValueName))
	builder.WriteString(fmt.Sprintf("  command: %s\n", command))
	if exeErr != nil {
		builder.WriteString(fmt.Sprintf("  current executable: unavailable (%v)\n", exeErr))
	}
	if state == "needs repair" {
		builder.WriteString(fmt.Sprintf("  expected: %s\n", expected))
		builder.WriteString("  repair: run `eqrcp desktop startup-enable` from the executable you want Windows to start.\n")
	}
	return builder.String()
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

func queryRegValue(key string, name string) (string, error) {
	output, err := exec.Command("reg", "query", key, "/v", name).CombinedOutput()
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

func windowsAgentStartupCommand(exe string) string {
	return windowsHiddenCommand(exe, "desktop", "agent")
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
