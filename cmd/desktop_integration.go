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

	"eqt/pkg/version"
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
			builder.WriteString("  repair: run `eqt desktop install` from the executable you want Explorer to use.\n")
		}
	}
	sendTo, err := env.sendToPath()
	if err != nil {
		builder.WriteString(fmt.Sprintf("- Send to > Share with eqt: unavailable (%v)\n", err))
		return builder.String(), nil
	}
	if _, err := env.stat(sendTo); err != nil {
		summary.notInstalled++
		builder.WriteString("- Send to > Share with eqt: not installed\n")
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
		builder.WriteString(fmt.Sprintf("- Send to > Share with eqt: %s\n", state))
		builder.WriteString(fmt.Sprintf("  path: %s\n", sendTo))
		if state == "needs repair" {
			builder.WriteString("  repair: run `eqt desktop install` from the executable you want Explorer to use.\n")
		}
	}
	if exeErr == nil {
		summary.installed++
		builder.WriteString("- eqt launcher: installed\n")
		builder.WriteString(fmt.Sprintf("  path: %s\n", exe))
	}
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
			builder.WriteString("  start: run `eqt desktop agent-start` or trigger a right-click share/receive action.\n")
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
		builder.WriteString("  repair: run `eqt desktop agent-stop`, then `eqt desktop agent-start`, or trigger a fresh right-click action.\n")
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
	return filepath.Join(appData, "Microsoft", "Windows", "SendTo", "Share with eqt.vbs"), nil
}

func windowsSendToShareScript(exe string, launcher string) string {
	if launcher != "" {
		if launcher == exe {
			return fmt.Sprintf(`Set shell = CreateObject("WScript.Shell")
cmd = Quote(%s) & " share"
For Each arg In WScript.Arguments
    cmd = cmd & " " & Quote(arg)
Next
shell.Run cmd, 0, False

Function Quote(value)
    Quote = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
`, windowsVBString(exe))
		}
		return fmt.Sprintf(`Set shell = CreateObject("WScript.Shell")
cmd = Quote(%s) & " --eqt-exe " & Quote(%s) & " share"
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
			key:     `HKCU\Software\Classes\*\shell\eqt-share`,
			label:   "EQT Send (file)",
			command: windowsShellCommand(exe, launcher, "share", "%1"),
		},
		{
			key:     `HKCU\Software\Classes\Directory\shell\eqt-share`,
			label:   "EQT Send (directory)",
			command: windowsShellCommand(exe, launcher, "share", "%1"),
		},
		{
			key:     `HKCU\Software\Classes\Directory\shell\eqt-receive`,
			label:   "EQT Receive (directory)",
			command: windowsShellCommand(exe, launcher, "receive", "%1"),
		},
		{
			key:     `HKCU\Software\Classes\Directory\Background\shell\eqt-receive`,
			label:   "EQT Receive (directory background)",
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
	configureDesktopAgentBackgroundCommand(cmd)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("reg %v failed: %w: %s", args, err, output)
	}
	return nil
}

func runRegAllowMissing(args ...string) error {
	if !regDeleteTargetExists(args...) {
		return nil
	}
	cmd := exec.Command("reg", args...)
	configureDesktopAgentBackgroundCommand(cmd)
	if output, err := cmd.CombinedOutput(); err != nil {
		if !regDeleteTargetExists(args...) {
			return nil
		}
		return fmt.Errorf("reg %v failed: %w: %s", args, err, output)
	}
	return nil
}

func regDeleteTargetExists(args ...string) bool {
	queryArgs, ok := regDeleteQueryArgs(args...)
	if !ok {
		return true
	}
	cmd := exec.Command("reg", queryArgs...)
	configureDesktopAgentBackgroundCommand(cmd)
	return cmd.Run() == nil
}

func regDeleteQueryArgs(args ...string) ([]string, bool) {
	if len(args) < 2 || strings.ToLower(args[0]) != "delete" {
		return nil, false
	}
	queryArgs := []string{"query", args[1]}
	for index := 2; index < len(args)-1; index++ {
		if strings.EqualFold(args[index], "/v") || strings.EqualFold(args[index], "/ve") {
			queryArgs = append(queryArgs, args[index])
			if strings.EqualFold(args[index], "/v") {
				queryArgs = append(queryArgs, args[index+1])
			}
			break
		}
	}
	return queryArgs, true
}

func queryRegDefault(key string) (string, error) {
	cmd := exec.Command("reg", "query", key, "/ve")
	configureDesktopAgentBackgroundCommand(cmd)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", err
	}
	return parseRegDefaultValue(string(output)), nil
}

func queryRegValue(key string, name string) (string, error) {
	cmd := exec.Command("reg", "query", key, "/v", name)
	configureDesktopAgentBackgroundCommand(cmd)
	output, err := cmd.CombinedOutput()
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
	// 合并为单二进制后，exe 自身就兼任了 launcher 的静默启动与转发功能
	return exe
}

func windowsExpectedLauncherPath(exe string) string {
	return exe
}

func windowsCommandMatches(actual string, expected string) bool {
	return strings.TrimSpace(actual) == strings.TrimSpace(expected)
}

func windowsShellCommand(exe string, launcher string, args ...string) string {
	if launcher != "" {
		if launcher == exe {
			// 单个可执行文件模式：直接调用自身
			quotedArgs := make([]string, 0, len(args))
			for _, arg := range args {
				quotedArgs = append(quotedArgs, `"`+arg+`"`)
			}
			return fmt.Sprintf(`"%s" %s`, exe, strings.Join(quotedArgs, " "))
		}
		launcherArgs := append([]string{"--eqt-exe", exe}, args...)
		quotedArgs := make([]string, 0, len(launcherArgs))
		for _, arg := range launcherArgs {
			quotedArgs = append(quotedArgs, `"`+arg+`"`)
		}
		return fmt.Sprintf(`"%s" %s`, launcher, strings.Join(quotedArgs, " "))
	}
	// 单二进制合并后 launcher 恒为 exe；即便为空也不引入隐藏 PowerShell 中转
	quotedArgs := make([]string, 0, len(args))
	for _, arg := range args {
		quotedArgs = append(quotedArgs, `"`+arg+`"`)
	}
	return fmt.Sprintf(`"%s" %s`, exe, strings.Join(quotedArgs, " "))
}

func windowsVBString(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

// Exported wrapper APIs for in-process memory calls in desktop GUI mode

func InstallDesktopIntegration() error {
	return installDesktopIntegration()
}

func UninstallDesktopIntegration() error {
	return uninstallDesktopIntegration()
}

func DesktopIntegrationStatus() (string, error) {
	return desktopIntegrationStatus()
}
