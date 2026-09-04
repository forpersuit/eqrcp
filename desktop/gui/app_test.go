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

	// 2. Pre-create rotated log files (e.g. desktop.log.1, desktop.log.2)
	rotPath1 := filepath.Join(tempDir, "desktop.log.1")
	rotPath2 := filepath.Join(tempDir, "desktop.log.2")
	_ = os.WriteFile(rotPath1, []byte("rotated log 1 content\n"), 0644)
	_ = os.WriteFile(rotPath2, []byte("rotated log 2 content\n"), 0644)

	// 3. Verify buildDiagnosticsZip with main log, rotated logs, and crash dump
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
	foundRot1 := false
	foundRot2 := false
	foundCrash := false
	foundEnv := false
	for _, f := range r.File {
		if f.Name == "logs/desktop.log" {
			foundLog = true
		}
		if f.Name == "logs/desktop.log.1" {
			foundRot1 = true
		}
		if f.Name == "logs/desktop.log.2" {
			foundRot2 = true
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
	if !foundRot1 {
		t.Errorf("expected logs/desktop.log.1 in zip")
	}
	if !foundRot2 {
		t.Errorf("expected logs/desktop.log.2 in zip")
	}
	if !foundCrash {
		t.Errorf("expected crash-dump.json in zip")
	}
	if !foundEnv {
		t.Errorf("expected environment.json in zip")
	}

	// 4. Verify buildDiagnosticsZip on empty log directory without crash dump
	emptyDir := t.TempDir()
	emptyZipPath := filepath.Join(emptyDir, "empty-diag.zip")
	if err := buildDiagnosticsZip(emptyZipPath, emptyDir, info, nil); err != nil {
		t.Fatalf("buildDiagnosticsZip on empty directory failed: %v", err)
	}
	rEmpty, err := zip.OpenReader(emptyZipPath)
	if err != nil {
		t.Fatalf("zip.OpenReader on empty zip failed: %v", err)
	}
	defer rEmpty.Close()

	emptyHasEnv := false
	emptyHasLog := false
	for _, f := range rEmpty.File {
		if f.Name == "environment.json" {
			emptyHasEnv = true
		}
		if strings.HasPrefix(f.Name, "logs/") {
			emptyHasLog = true
		}
	}
	if !emptyHasEnv {
		t.Errorf("expected environment.json in empty zip")
	}
	if emptyHasLog {
		t.Errorf("expected no logs/ entries in empty zip")
	}

	// 5. Verify GetLogTail on missing/non-existent log file
	missingApp := NewApp()
	missingLogger := NewFileLogger(filepath.Join(emptyDir, "nonexistent.log"), true)
	missingApp.logger = missingLogger
	defer missingLogger.Close()

	emptyTails, err := missingApp.GetLogTail(10)
	if err != nil {
		t.Fatalf("GetLogTail on non-existent file returned error: %v", err)
	}
	if len(emptyTails) != 0 {
		t.Fatalf("expected 0 lines from non-existent log, got %d", len(emptyTails))
	}
}
