package cmd

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"eqt/pkg/version"
)

func TestWindowsExpectedLauncherPath(t *testing.T) {
	got := windowsExpectedLauncherPath(filepath.Join("root", "tools", "eqt.exe"))
	want := filepath.Join("root", "tools", "eqt.exe")
	if got != want {
		t.Fatalf("windowsExpectedLauncherPath() = %q, want %q", got, want)
	}
}

func TestWindowsCommandMatchesIgnoresOuterWhitespace(t *testing.T) {
	if !windowsCommandMatches("  command value\r\n", "command value") {
		t.Fatal("windowsCommandMatches() should ignore surrounding whitespace")
	}
	if windowsCommandMatches("command value", "other command") {
		t.Fatal("windowsCommandMatches() should reject different commands")
	}
}

func TestRegDeleteQueryArgs(t *testing.T) {
	tests := []struct {
		name string
		args []string
		want []string
		ok   bool
	}{
		{
			name: "key",
			args: []string{"delete", `HKCU\Software\Classes\*\shell\eqt-share`, "/f"},
			want: []string{"query", `HKCU\Software\Classes\*\shell\eqt-share`},
			ok:   true,
		},
		{
			name: "value",
			args: []string{"delete", `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, "/v", "eqt-agent", "/f"},
			want: []string{"query", `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, "/v", "eqt-agent"},
			ok:   true,
		},
		{
			name: "not delete",
			args: []string{"add", `HKCU\Software\Classes\*\shell\eqt-share`, "/f"},
			ok:   false,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, ok := regDeleteQueryArgs(test.args...)
			if ok != test.ok {
				t.Fatalf("regDeleteQueryArgs() ok = %v, want %v", ok, test.ok)
			}
			if strings.Join(got, "\x00") != strings.Join(test.want, "\x00") {
				t.Fatalf("regDeleteQueryArgs() = %#v, want %#v", got, test.want)
			}
		})
	}
}

func TestWindowsShellCommandUsesLauncherWhenAvailable(t *testing.T) {
	got := windowsShellCommand(`C:\tools\eqt.exe`, `C:\tools\eqt.exe`, "share", "%1")
	want := `"C:\tools\eqt.exe" "share" "%1"`
	if got != want {
		t.Fatalf("windowsShellCommand() = %q, want %q", got, want)
	}
}

func TestParseRegDefaultValueEnglishOutput(t *testing.T) {
	output := `HKEY_CURRENT_USER\Software\Classes\*\shell\eqt-share\command
    (Default)    REG_SZ    "E:\developer\results\eqt.exe" "share" "%1"
`
	want := `"E:\developer\results\eqt.exe" "share" "%1"`
	if got := parseRegDefaultValue(output); got != want {
		t.Fatalf("parseRegDefaultValue() = %q, want %q", got, want)
	}
}

func TestParseRegDefaultValueLocalizedOutput(t *testing.T) {
	output := `HKEY_CURRENT_USER\Software\Classes\*\shell\eqt-share\command
    (默认)    REG_SZ    "E:\developer\results\eqt.exe" "share" "%1"
`
	want := `"E:\developer\results\eqt.exe" "share" "%1"`
	if got := parseRegDefaultValue(output); got != want {
		t.Fatalf("parseRegDefaultValue() = %q, want %q", got, want)
	}
}

func TestFormatWindowsDesktopIntegrationStatusInstalled(t *testing.T) {
	env := fakeWindowsDesktopStatusEnv(t, `C:\tools\eqt.exe`, `C:\tools\eqt.exe`)
	got, err := formatWindowsDesktopIntegrationStatus(env)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"Windows desktop integration status",
		`- current executable: C:\tools\eqt.exe`,
		"- EQT Send (file): installed",
		"- Send to > Share with eqt: installed",
		"- eqt launcher: installed",
		"- Desktop agent runtime: not running",
		"eqt desktop agent-start",
		`path: C:\tools\eqt.exe`,
		"- summary: 6 installed, 0 needs repair, 0 not installed",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("status = %q, want to contain %q", got, want)
		}
	}
	if strings.Contains(got, ": needs repair") {
		t.Fatalf("status = %q, should not contain needs-repair entries", got)
	}
}

func TestDesktopStatusCommandIncludesVersion(t *testing.T) {
	var out bytes.Buffer
	desktopStatusCmd.SetOut(&out)
	desktopStatusCmd.SetErr(&out)

	if err := desktopStatusCmd.RunE(desktopStatusCmd, nil); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "eqt ") {
		t.Fatalf("desktop status output = %q, want version header", out.String())
	}
}

func TestDesktopStartupStatusCommandIncludesVersion(t *testing.T) {
	var out bytes.Buffer
	desktopStartupStatusCmd.SetOut(&out)
	desktopStartupStatusCmd.SetErr(&out)

	if err := desktopStartupStatusCmd.RunE(desktopStartupStatusCmd, nil); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "eqt ") {
		t.Fatalf("desktop startup-status output = %q, want version header", out.String())
	}
}

func TestFormatWindowsDesktopIntegrationStatusMissingLauncher(t *testing.T) {
	exe := filepath.Join("tools", "eqt.exe")
	env := fakeWindowsDesktopStatusEnv(t, exe, "")
	got, err := formatWindowsDesktopIntegrationStatus(env)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"- eqt launcher: installed",
		"path: " + exe,
		"- summary: 6 installed, 0 needs repair, 0 not installed",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("status = %q, want to contain %q", got, want)
		}
	}
}

func TestFormatWindowsDesktopIntegrationStatusNeedsRepair(t *testing.T) {
	env := fakeWindowsDesktopStatusEnv(t, `C:\tools\eqt.exe`, `C:\tools\eqt.exe`)
	staleCommand := windowsShellCommand(`C:\old\eqt.exe`, `C:\old\eqt.exe`, "share", "%1")
	env.queryRegDefault = func(key string) (string, error) {
		if strings.Contains(key, `*\shell\eqt-share\command`) {
			return staleCommand, nil
		}
		return fakeWindowsRegCommands(`C:\tools\eqt.exe`, `C:\tools\eqt.exe`)[key], nil
	}

	got, err := formatWindowsDesktopIntegrationStatus(env)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"- EQT Send (file): needs repair",
		`expected: "C:\tools\eqt.exe" "share" "%1"`,
		"repair: run `eqt desktop install`",
		"- summary: 5 installed, 1 needs repair, 0 not installed",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("status = %q, want to contain %q", got, want)
		}
	}
}

func fakeWindowsDesktopStatusEnv(t *testing.T, exe string, launcher string) windowsDesktopStatusEnv {
	t.Helper()
	registry := fakeWindowsRegCommands(exe, launcher)
	sendTo := filepath.Join(t.TempDir(), "Share with eqt.vbs")
	launcherPath := launcher
	return windowsDesktopStatusEnv{
		executable: func() (string, error) {
			return exe, nil
		},
		launcherPath: func(string) string {
			return launcherPath
		},
		queryRegDefault: func(key string) (string, error) {
			value, ok := registry[key]
			if !ok {
				return "", errors.New("missing registry key")
			}
			return value, nil
		},
		queryRegValue: func(key string, name string) (string, error) {
			return "", errors.New("missing registry value")
		},
		agentStatus: func() (desktopAgentResponse, error) {
			return desktopAgentResponse{}, errors.New("desktop agent is not running: dial tcp 127.0.0.1:48176: connect: connection refused")
		},
		sendToPath: func() (string, error) {
			return sendTo, nil
		},
		stat: func(path string) (os.FileInfo, error) {
			if path != sendTo {
				return nil, os.ErrNotExist
			}
			return fakeFileInfo{}, nil
		},
		readFile: func(path string) ([]byte, error) {
			if path != sendTo {
				return nil, os.ErrNotExist
			}
			return []byte(windowsSendToShareScript(exe, launcher)), nil
		},
	}
}

func TestFormatWindowsDesktopIntegrationStatusRunningAgent(t *testing.T) {
	env := fakeWindowsDesktopStatusEnv(t, `C:\tools\eqt.exe`, `C:\tools\eqt.exe`)
	started := time.Date(2026, 4, 24, 9, 30, 0, 0, time.UTC)
	env.agentStatus = func() (desktopAgentResponse, error) {
		return desktopAgentResponse{
			State:          "busy",
			Queued:         1,
			Version:        version.String(),
			AgentStartedAt: started,
			Current: &desktopAgentTaskRecord{
				ID:     7,
				Action: "share",
				State:  "running",
			},
		}, nil
	}

	got, err := formatWindowsDesktopIntegrationStatus(env)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"- Desktop agent runtime: running",
		"  state: busy",
		"  queued: 1",
		"  version: " + version.String(),
		"  started: 2026-04-24T09:30:00Z",
		"  current task: #7 share running",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("status = %q, want to contain %q", got, want)
		}
	}
}

func TestFormatWindowsDesktopIntegrationStatusStaleAgentVersion(t *testing.T) {
	env := fakeWindowsDesktopStatusEnv(t, `C:\tools\eqt.exe`, `C:\tools\eqt.exe`)
	env.agentStatus = func() (desktopAgentResponse, error) {
		return desktopAgentResponse{
			State:   "idle",
			Version: "eqt old-build [date: 2026-04-20T00:00:00Z]",
		}, nil
	}

	got, err := formatWindowsDesktopIntegrationStatus(env)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"- Desktop agent runtime: running",
		"  status: needs restart",
		"  current executable version: " + version.String(),
		"eqt desktop agent-stop",
		"eqt desktop agent-start",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("status = %q, want to contain %q", got, want)
		}
	}
}

func TestWindowsAgentStartupCommand(t *testing.T) {
	got := windowsAgentStartupCommand(`C:\tools\eqt.exe`)
	for _, want := range []string{
		"powershell.exe",
		"Start-Process",
		"-WindowStyle Hidden",
		`C:\tools\eqt.exe`,
		"'desktop'",
		"'agent'",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("windowsAgentStartupCommand() = %q, want to contain %q", got, want)
		}
	}
}

func TestFormatWindowsDesktopStartupStatusDisabled(t *testing.T) {
	got, err := formatWindowsDesktopStartupStatus(windowsDesktopStartupStatusEnv{
		executable: func() (string, error) {
			return `C:\tools\eqt.exe`, nil
		},
		queryRegValue: func(key string, name string) (string, error) {
			return "", errors.New("missing registry value")
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"Windows desktop agent startup status",
		"- Agent startup: disabled",
		windowsStartupRunKey,
		windowsStartupValueName,
		"eqt desktop startup-enable",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("startup status = %q, want to contain %q", got, want)
		}
	}
}

func TestFormatWindowsDesktopStartupStatusEnabled(t *testing.T) {
	exe := `C:\tools\eqt.exe`
	got, err := formatWindowsDesktopStartupStatus(windowsDesktopStartupStatusEnv{
		executable: func() (string, error) {
			return exe, nil
		},
		queryRegValue: func(key string, name string) (string, error) {
			if key != windowsStartupRunKey || name != windowsStartupValueName {
				return "", errors.New("unexpected registry query")
			}
			return windowsAgentStartupCommand(exe), nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"- Agent startup: enabled",
		"command: " + windowsAgentStartupCommand(exe),
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("startup status = %q, want to contain %q", got, want)
		}
	}
	if strings.Contains(got, "needs repair") {
		t.Fatalf("startup status = %q, should not need repair", got)
	}
}

func TestFormatWindowsDesktopStartupStatusNeedsRepair(t *testing.T) {
	got, err := formatWindowsDesktopStartupStatus(windowsDesktopStartupStatusEnv{
		executable: func() (string, error) {
			return `C:\tools\eqt.exe`, nil
		},
		queryRegValue: func(key string, name string) (string, error) {
			return windowsAgentStartupCommand(`C:\old\eqt.exe`), nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"- Agent startup: needs repair",
		`expected: ` + windowsAgentStartupCommand(`C:\tools\eqt.exe`),
		"repair: run `eqt desktop startup-enable`",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("startup status = %q, want to contain %q", got, want)
		}
	}
}

func fakeWindowsRegCommands(exe string, launcher string) map[string]string {
	values := map[string]string{}
	for _, entry := range windowsContextEntries(exe, launcher) {
		values[entry.key+`\command`] = entry.command
	}
	return values
}

type fakeFileInfo struct{}

func (fakeFileInfo) Name() string       { return "Share with eqt.vbs" }
func (fakeFileInfo) Size() int64        { return 1 }
func (fakeFileInfo) Mode() os.FileMode  { return 0644 }
func (fakeFileInfo) ModTime() time.Time { return time.Time{} }
func (fakeFileInfo) IsDir() bool        { return false }
func (fakeFileInfo) Sys() any           { return nil }

// --- B4a: Linux + macOS autostart ---

func TestLinuxAutostartContentRoundTrip(t *testing.T) {
	exe := "/opt/eqt/eqt"
	content := linuxAutostartContent(exe)
	if !strings.Contains(content, "[Desktop Entry]") {
		t.Fatalf("missing [Desktop Entry] header: %s", content)
	}
	if !strings.Contains(content, "Type=Application") {
		t.Fatalf("missing Type=Application: %s", content)
	}
	got := parseDesktopEntryExec(content)
	want := exe + " desktop agent"
	if got != want {
		t.Fatalf("parseDesktopEntryExec() = %q, want %q", got, want)
	}
}

func TestParseDesktopEntryExecMissingExec(t *testing.T) {
	if got := parseDesktopEntryExec("[Desktop Entry]\nType=Application\n"); got != "" {
		t.Fatalf("parseDesktopEntryExec() = %q, want empty", got)
	}
}

func TestInstallUninstallLinuxDesktopStartupRoundTrip(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("XDG_CONFIG_HOME not honoured on windows")
	}
	tmp := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmp)

	if err := installLinuxDesktopStartup(); err != nil {
		t.Fatalf("install returned %v", err)
	}
	path, err := linuxAutostartPath()
	if err != nil {
		t.Fatalf("path %v", err)
	}
	if !strings.HasPrefix(path, tmp) {
		t.Fatalf("path %q not under XDG_CONFIG_HOME %q", path, tmp)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("autostart file missing after install: %v", err)
	}
	if !strings.Contains(string(data), "Exec=") {
		t.Fatalf("autostart file content unexpected: %s", data)
	}

	if err := uninstallLinuxDesktopStartup(); err != nil {
		t.Fatalf("uninstall returned %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("autostart file still present after uninstall: err=%v", err)
	}

	if err := uninstallLinuxDesktopStartup(); err != nil {
		t.Fatalf("second uninstall returned %v", err)
	}
}

func TestFormatLinuxDesktopStartupStatusStates(t *testing.T) {
	exe := "/bin/eqt"
	expectedExec := exe + " desktop agent"

	cases := []struct {
		name     string
		readErr  error
		fileBody string
		wantSub  string
	}{
		{name: "not installed", readErr: os.ErrNotExist, wantSub: "state: not installed"},
		{name: "installed", fileBody: "[Desktop Entry]\nExec=" + expectedExec + "\n", wantSub: "state: installed"},
		{name: "needs repair", fileBody: "[Desktop Entry]\nExec=/other/eqt desktop agent\n", wantSub: "state: needs repair"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			env := linuxStartupStatusEnv{
				executable: func() (string, error) { return exe, nil },
				pathFn:     func() (string, error) { return "/tmp/eqt.desktop", nil },
				readFile: func(string) ([]byte, error) {
					if tc.readErr != nil {
						return nil, tc.readErr
					}
					return []byte(tc.fileBody), nil
				},
			}
			out, err := formatLinuxDesktopStartupStatus(env)
			if err != nil {
				t.Fatalf("format returned %v", err)
			}
			if !strings.Contains(out, tc.wantSub) {
				t.Fatalf("status missing %q: %s", tc.wantSub, out)
			}
		})
	}
}

func TestDarwinAutostartContentRoundTrip(t *testing.T) {
	exe := "/Applications/eqt.app/Contents/MacOS/eqt"
	content := darwinAutostartContent(exe)
	if !strings.Contains(content, "<key>Label</key>") {
		t.Fatalf("missing Label key: %s", content)
	}
	if !strings.Contains(content, "<string>"+darwinLaunchAgentLabel+"</string>") {
		t.Fatalf("missing label value: %s", content)
	}
	if got := parseLaunchAgentFirstProgram(content); got != exe {
		t.Fatalf("parseLaunchAgentFirstProgram() = %q, want %q", got, exe)
	}
}

func TestParseLaunchAgentFirstProgramXMLEscapes(t *testing.T) {
	content := darwinAutostartContent("/path/A & B/eqt")
	if got := parseLaunchAgentFirstProgram(content); got != "/path/A & B/eqt" {
		t.Fatalf("round-trip mismatch: got %q", got)
	}
}

func TestInstallUninstallDarwinDesktopStartupRoundTrip(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("HOME not honoured on windows")
	}
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)

	if err := installDarwinDesktopStartup(); err != nil {
		t.Fatalf("install returned %v", err)
	}
	path, err := darwinAutostartPath()
	if err != nil {
		t.Fatalf("path %v", err)
	}
	if !strings.HasPrefix(path, tmp) {
		t.Fatalf("path %q not under HOME %q", path, tmp)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("LaunchAgent missing after install: %v", err)
	}
	if !strings.Contains(string(data), "<key>RunAtLoad</key>") {
		t.Fatalf("plist content unexpected: %s", data)
	}

	if err := uninstallDarwinDesktopStartup(); err != nil {
		t.Fatalf("uninstall returned %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("plist still present after uninstall: err=%v", err)
	}

	if err := uninstallDarwinDesktopStartup(); err != nil {
		t.Fatalf("second uninstall returned %v", err)
	}
}

func TestFormatDarwinDesktopStartupStatusStates(t *testing.T) {
	exe := "/Applications/eqt.app/Contents/MacOS/eqt"
	installed := darwinAutostartContent(exe)
	stale := darwinAutostartContent("/old/eqt")

	cases := []struct {
		name     string
		readErr  error
		fileBody string
		wantSub  string
	}{
		{name: "not installed", readErr: os.ErrNotExist, wantSub: "state: not installed"},
		{name: "installed", fileBody: installed, wantSub: "state: installed"},
		{name: "needs repair", fileBody: stale, wantSub: "state: needs repair"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			env := darwinStartupStatusEnv{
				executable: func() (string, error) { return exe, nil },
				pathFn:     func() (string, error) { return "/tmp/eqt.plist", nil },
				readFile: func(string) ([]byte, error) {
					if tc.readErr != nil {
						return nil, tc.readErr
					}
					return []byte(tc.fileBody), nil
				},
			}
			out, err := formatDarwinDesktopStartupStatus(env)
			if err != nil {
				t.Fatalf("format returned %v", err)
			}
			if !strings.Contains(out, tc.wantSub) {
				t.Fatalf("status missing %q: %s", tc.wantSub, out)
			}
		})
	}
}
