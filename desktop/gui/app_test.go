package main

import (
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
