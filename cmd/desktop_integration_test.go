package cmd

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
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

func TestWindowsShellCommandNoPowerShell(t *testing.T) {
	exe := `C:\tools\eqt.exe`
	// 自启动功能移除后，shell 右键命令必须是直接调用二进制，禁止出现
	// PowerShell 中转或 -ExecutionPolicy Bypass（Defender Behavior:Win32/DefenseEvasion.A!ml 触发源）。
	got := windowsShellCommand(exe, exe, "share", "file")
	for _, forbidden := range []string{"powershell", "PowerShell", "Bypass", "Start-Process", "WindowStyle"} {
		if strings.Contains(got, forbidden) {
			t.Fatalf("windowsShellCommand() = %q, must not contain %q", got, forbidden)
		}
	}
	if !strings.Contains(got, exe) {
		t.Fatalf("windowsShellCommand() = %q, want to contain %q", got, exe)
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
