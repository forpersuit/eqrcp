package cmd

import (
	"path/filepath"
	"testing"
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
