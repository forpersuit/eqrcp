package main

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseDesktopIntegrationStatus(t *testing.T) {
	status := parseDesktopIntegrationStatus("Windows desktop integration status\n- summary: 6 installed, 0 needs repair, 0 not installed")
	if !status.Supported || !status.Enabled || status.NeedsRepair {
		t.Fatalf("status = %#v, want supported enabled clean", status)
	}

	status = parseDesktopIntegrationStatus("Windows desktop integration status\n- summary: 4 installed, 1 needs repair, 1 not installed")
	if !status.Supported || status.Enabled || !status.NeedsRepair {
		t.Fatalf("status = %#v, want supported repair state", status)
	}

	status = parseDesktopIntegrationStatus("Desktop integration status is not implemented for linux yet.")
	if status.Supported || status.Enabled || status.NeedsRepair {
		t.Fatalf("status = %#v, want unsupported", status)
	}
}

func TestDesktopIntegrationCommands(t *testing.T) {
	oldInstallInt := cmdInstallDesktopIntegration
	oldUninstallInt := cmdUninstallDesktopIntegration
	oldIntStatus := cmdDesktopIntegrationStatus

	defer func() {
		cmdInstallDesktopIntegration = oldInstallInt
		cmdUninstallDesktopIntegration = oldUninstallInt
		cmdDesktopIntegrationStatus = oldIntStatus
	}()

	var calls []string
	cmdInstallDesktopIntegration = func() error {
		calls = append(calls, "InstallDesktopIntegration")
		return nil
	}
	cmdUninstallDesktopIntegration = func() error {
		calls = append(calls, "UninstallDesktopIntegration")
		return nil
	}
	cmdDesktopIntegrationStatus = func() (string, error) {
		calls = append(calls, "DesktopIntegrationStatus")
		return "Windows desktop integration status\n- summary: 6 installed, 0 needs repair, 0 not installed", nil
	}

	app := NewApp()
	if status, err := app.SetRightClickIntegrationEnabled(true); err != nil || !status.Enabled {
		t.Fatalf("SetRightClickIntegrationEnabled(true) = %#v, %v", status, err)
	}
	if _, err := app.SetRightClickIntegrationEnabled(false); err != nil {
		t.Fatalf("SetRightClickIntegrationEnabled(false) error = %v", err)
	}

	got := strings.Join(calls, "\n")
	for _, want := range []string{
		"InstallDesktopIntegration",
		"UninstallDesktopIntegration",
		"DesktopIntegrationStatus",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("calls = %q, want to contain %q", got, want)
		}
	}
}

func TestAppClearPendingUpdate(t *testing.T) {
	app := NewApp()
	if err := app.ClearPendingUpdate(); err != nil {
		t.Fatalf("ClearPendingUpdate failed: %v", err)
	}
}

func TestAppQuitApp(t *testing.T) {
	app := NewApp()
	// QuitApp should safely invoke cleanup without panics
	app.QuitApp()
	if !app.forceQuit {
		t.Fatalf("expected forceQuit to be true after QuitApp")
	}
}

func TestGetLogTailAndBuildDiagnosticsZip(t *testing.T) {
	tempDir := t.TempDir()
	logPath := filepath.Join(tempDir, "desktop.log")
	linesData := "line 1\nline 2\nline 3\nline 4\nline 5\n"
	if err := os.WriteFile(logPath, []byte(linesData), 0644); err != nil {
		t.Fatalf("failed to write test log file: %v", err)
	}

	app := NewApp()
	logger := NewFileLogger(logPath, true)
	app.logger = logger
	defer logger.Close()

	// 1. Verify GetLogTail
	tails, err := app.GetLogTail(3)
	if err != nil {
		t.Fatalf("GetLogTail failed: %v", err)
	}
	if len(tails) != 3 {
		t.Fatalf("expected 3 lines, got %d: %v", len(tails), tails)
	}
	if tails[len(tails)-1] != "line 5" {
		t.Fatalf("expected last line to be 'line 5', got %q", tails[len(tails)-1])
	}

	// 2. Verify buildDiagnosticsZip
	zipPath := filepath.Join(tempDir, "diag.zip")
	info := AppInfo{
		Product: "EQT Test",
		Version: "v1.36.34",
		OS:      "linux",
		Arch:    "amd64",
	}
	rawDump := map[string]any{"reason": "test-panic"}

	if err := buildDiagnosticsZip(zipPath, tempDir, info, rawDump); err != nil {
		t.Fatalf("buildDiagnosticsZip failed: %v", err)
	}

	// Read and verify zip contents
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		t.Fatalf("zip.OpenReader failed: %v", err)
	}
	defer r.Close()

	foundLog := false
	foundCrash := false
	foundEnv := false
	for _, f := range r.File {
		if f.Name == "logs/desktop.log" {
			foundLog = true
		}
		if f.Name == "crash-dump.json" {
			foundCrash = true
		}
		if f.Name == "environment.json" {
			foundEnv = true
		}
	}
	if !foundLog {
		t.Errorf("expected logs/desktop.log in zip")
	}
	if !foundCrash {
		t.Errorf("expected crash-dump.json in zip")
	}
	if !foundEnv {
		t.Errorf("expected environment.json in zip")
	}
}
