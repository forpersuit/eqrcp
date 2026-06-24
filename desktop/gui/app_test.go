package main

import (
	"context"
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

func TestParseDesktopStartupStatus(t *testing.T) {
	status := parseDesktopStartupStatus("Windows desktop agent startup status\n- Agent startup: enabled")
	if !status.Supported || !status.Enabled || status.NeedsRepair {
		t.Fatalf("status = %#v, want enabled", status)
	}

	status = parseDesktopStartupStatus("Windows desktop agent startup status\n- Agent startup: needs repair")
	if !status.Supported || status.Enabled || !status.NeedsRepair {
		t.Fatalf("status = %#v, want repair state", status)
	}

	status = parseDesktopStartupStatus("Windows desktop agent startup status\n- Agent startup: disabled")
	if !status.Supported || status.Enabled || status.NeedsRepair {
		t.Fatalf("status = %#v, want disabled", status)
	}
}

func TestDesktopIntegrationCommands(t *testing.T) {
	t.Setenv("EQT_CLI", "/tmp/eqt")
	oldRunner := desktopCommandRunner
	defer func() { desktopCommandRunner = oldRunner }()

	var calls []string
	desktopCommandRunner = func(ctx context.Context, cli string, args ...string) (string, error) {
		calls = append(calls, cli+" "+strings.Join(args, " "))
		switch args[len(args)-1] {
		case "status":
			return "Windows desktop integration status\n- summary: 6 installed, 0 needs repair, 0 not installed", nil
		case "startup-status":
			return "Windows desktop agent startup status\n- Agent startup: enabled", nil
		default:
			return "ok", nil
		}
	}

	app := NewApp()
	if status, err := app.SetRightClickIntegrationEnabled(true); err != nil || !status.Enabled {
		t.Fatalf("SetRightClickIntegrationEnabled(true) = %#v, %v", status, err)
	}
	if _, err := app.SetRightClickIntegrationEnabled(false); err != nil {
		t.Fatalf("SetRightClickIntegrationEnabled(false) error = %v", err)
	}
	if status, err := app.SetStartupEnabled(true); err != nil || !status.Enabled {
		t.Fatalf("SetStartupEnabled(true) = %#v, %v", status, err)
	}
	if _, err := app.SetStartupEnabled(false); err != nil {
		t.Fatalf("SetStartupEnabled(false) error = %v", err)
	}

	got := strings.Join(calls, "\n")
	for _, want := range []string{
		"/tmp/eqt desktop install",
		"/tmp/eqt desktop status",
		"/tmp/eqt desktop uninstall",
		"/tmp/eqt desktop startup-enable",
		"/tmp/eqt desktop startup-status",
		"/tmp/eqt desktop startup-disable",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("calls = %q, want to contain %q", got, want)
		}
	}
}
