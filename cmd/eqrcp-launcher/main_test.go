package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseArgsWithExplicitEqrcpExe(t *testing.T) {
	exe, args, err := parseArgs([]string{"--eqrcp-exe", `C:\Tools\renamed.exe`, "share", `C:\tmp\a.txt`})
	if err != nil {
		t.Fatalf("parseArgs() error = %v", err)
	}
	if exe != `C:\Tools\renamed.exe` {
		t.Fatalf("parseArgs() exe = %q", exe)
	}
	if len(args) != 2 || args[0] != "share" || args[1] != `C:\tmp\a.txt` {
		t.Fatalf("parseArgs() args = %#v", args)
	}
}

func TestParseArgsWithoutExplicitEqrcpExe(t *testing.T) {
	exe, args, err := parseArgs([]string{"receive", `C:\tmp`})
	if err != nil {
		t.Fatalf("parseArgs() error = %v", err)
	}
	if exe != "" {
		t.Fatalf("parseArgs() exe = %q, want empty", exe)
	}
	if len(args) != 2 || args[0] != "receive" || args[1] != `C:\tmp` {
		t.Fatalf("parseArgs() args = %#v", args)
	}
}

func TestParseArgsMissingExplicitEqrcpExe(t *testing.T) {
	_, _, err := parseArgs([]string{"--eqrcp-exe"})
	if err == nil || !strings.Contains(err.Error(), "missing value for --eqrcp-exe") {
		t.Fatalf("parseArgs() error = %v, want missing --eqrcp-exe error", err)
	}
}

func TestFormatErrorIncludesCommandLogAndDetails(t *testing.T) {
	dir := t.TempDir()
	logPath := filepath.Join(dir, "launcher.log")
	if err := os.WriteFile(logPath, []byte("first line\nlast line\n"), 0644); err != nil {
		t.Fatal(err)
	}

	got := formatError(
		errors.New("exit status 1"),
		logPath,
		`C:\Tools\renamed eqrcp.exe`,
		[]string{"desktop", "share", `C:\tmp\my file.txt`},
	)

	for _, want := range []string{
		"eqrcp failed: exit status 1",
		`Command: "C:\Tools\renamed eqrcp.exe" desktop share "C:\tmp\my file.txt"`,
		"Log: " + logPath,
		"Details:\nfirst line\nlast line\n",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("formatError() = %q, want to contain %q", got, want)
		}
	}
}

func TestReadTailLimitsOutput(t *testing.T) {
	path := filepath.Join(t.TempDir(), "launcher.log")
	if err := os.WriteFile(path, []byte("0123456789"), 0644); err != nil {
		t.Fatal(err)
	}

	got := readTail(path, 4)
	if got != "6789" {
		t.Fatalf("readTail() = %q, want %q", got, "6789")
	}
}

func TestRunLauncherReportsArgumentError(t *testing.T) {
	got := runLauncher([]string{"--eqrcp-exe"})
	if !strings.Contains(got, "missing value for --eqrcp-exe") {
		t.Fatalf("runLauncher() = %q, want missing --eqrcp-exe error", got)
	}
}
