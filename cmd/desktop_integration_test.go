package cmd

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestWindowsExpectedLauncherPath(t *testing.T) {
	got := windowsExpectedLauncherPath(filepath.Join("root", "tools", "eqrcp.exe"))
	want := filepath.Join("root", "tools", "eqrcp-launcher.exe")
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

func TestWindowsShellCommandUsesLauncherWhenAvailable(t *testing.T) {
	got := windowsShellCommand(`C:\tools\eqrcp.exe`, `C:\tools\eqrcp-launcher.exe`, "share", "%1")
	want := `"C:\tools\eqrcp-launcher.exe" "--eqrcp-exe" "C:\tools\eqrcp.exe" "share" "%1"`
	if got != want {
		t.Fatalf("windowsShellCommand() = %q, want %q", got, want)
	}
}

func TestParseRegDefaultValueEnglishOutput(t *testing.T) {
	output := `HKEY_CURRENT_USER\Software\Classes\*\shell\eqrcp-share\command
    (Default)    REG_SZ    "E:\developer\results\eqrcp-launcher.exe" "--eqrcp-exe" "E:\developer\results\eqrcp.exe" "share" "%1"
`
	want := `"E:\developer\results\eqrcp-launcher.exe" "--eqrcp-exe" "E:\developer\results\eqrcp.exe" "share" "%1"`
	if got := parseRegDefaultValue(output); got != want {
		t.Fatalf("parseRegDefaultValue() = %q, want %q", got, want)
	}
}

func TestParseRegDefaultValueLocalizedOutput(t *testing.T) {
	output := `HKEY_CURRENT_USER\Software\Classes\*\shell\eqrcp-share\command
    (默认)    REG_SZ    "E:\developer\results\eqrcp-launcher.exe" "--eqrcp-exe" "E:\developer\results\eqrcp.exe" "share" "%1"
`
	want := `"E:\developer\results\eqrcp-launcher.exe" "--eqrcp-exe" "E:\developer\results\eqrcp.exe" "share" "%1"`
	if got := parseRegDefaultValue(output); got != want {
		t.Fatalf("parseRegDefaultValue() = %q, want %q", got, want)
	}
}

func TestFormatWindowsDesktopIntegrationStatusInstalled(t *testing.T) {
	env := fakeWindowsDesktopStatusEnv(t, `C:\tools\eqrcp.exe`, `C:\tools\eqrcp-launcher.exe`)
	got, err := formatWindowsDesktopIntegrationStatus(env)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"Windows desktop integration status",
		`- current executable: C:\tools\eqrcp.exe`,
		"- Share with eqrcp (file): installed",
		"- Send to > Share with eqrcp: installed",
		"- eqrcp launcher: installed",
		`path: C:\tools\eqrcp-launcher.exe`,
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
	if !strings.Contains(out.String(), "eqrcp ") {
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
	if !strings.Contains(out.String(), "eqrcp ") {
		t.Fatalf("desktop startup-status output = %q, want version header", out.String())
	}
}

func TestFormatWindowsDesktopIntegrationStatusMissingLauncher(t *testing.T) {
	exe := filepath.Join("tools", "eqrcp.exe")
	env := fakeWindowsDesktopStatusEnv(t, exe, "")
	got, err := formatWindowsDesktopIntegrationStatus(env)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"- eqrcp launcher: not installed",
		"expected path: " + filepath.Join("tools", "eqrcp-launcher.exe"),
		"place eqrcp-launcher.exe next to eqrcp.exe",
		"- summary: 5 installed, 0 needs repair, 1 not installed",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("status = %q, want to contain %q", got, want)
		}
	}
}

func TestFormatWindowsDesktopIntegrationStatusNeedsRepair(t *testing.T) {
	env := fakeWindowsDesktopStatusEnv(t, `C:\tools\eqrcp.exe`, `C:\tools\eqrcp-launcher.exe`)
	staleCommand := windowsShellCommand(`C:\old\eqrcp.exe`, `C:\old\eqrcp-launcher.exe`, "share", "%1")
	env.queryRegDefault = func(key string) (string, error) {
		if strings.Contains(key, `*\shell\eqrcp-share\command`) {
			return staleCommand, nil
		}
		return fakeWindowsRegCommands(`C:\tools\eqrcp.exe`, `C:\tools\eqrcp-launcher.exe`)[key], nil
	}

	got, err := formatWindowsDesktopIntegrationStatus(env)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"- Share with eqrcp (file): needs repair",
		`expected: "C:\tools\eqrcp-launcher.exe" "--eqrcp-exe" "C:\tools\eqrcp.exe" "share" "%1"`,
		"repair: run `eqrcp desktop install`",
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
	sendTo := filepath.Join(t.TempDir(), "Share with eqrcp.vbs")
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

func TestWindowsAgentStartupCommand(t *testing.T) {
	got := windowsAgentStartupCommand(`C:\tools\eqrcp.exe`)
	for _, want := range []string{
		"powershell.exe",
		"Start-Process",
		"-WindowStyle Hidden",
		`C:\tools\eqrcp.exe`,
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
			return `C:\tools\eqrcp.exe`, nil
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
		"eqrcp desktop startup-enable",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("startup status = %q, want to contain %q", got, want)
		}
	}
}

func TestFormatWindowsDesktopStartupStatusEnabled(t *testing.T) {
	exe := `C:\tools\eqrcp.exe`
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
			return `C:\tools\eqrcp.exe`, nil
		},
		queryRegValue: func(key string, name string) (string, error) {
			return windowsAgentStartupCommand(`C:\old\eqrcp.exe`), nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"- Agent startup: needs repair",
		`expected: ` + windowsAgentStartupCommand(`C:\tools\eqrcp.exe`),
		"repair: run `eqrcp desktop startup-enable`",
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

func (fakeFileInfo) Name() string       { return "Share with eqrcp.vbs" }
func (fakeFileInfo) Size() int64        { return 1 }
func (fakeFileInfo) Mode() os.FileMode  { return 0644 }
func (fakeFileInfo) ModTime() time.Time { return time.Time{} }
func (fakeFileInfo) IsDir() bool        { return false }
func (fakeFileInfo) Sys() any           { return nil }
