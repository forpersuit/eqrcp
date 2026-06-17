package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"eqt/application"
)

func TestDesktopSettingsReadAndWriteChatProfile(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.yml")
	if err := os.WriteFile(configPath, []byte("output: /tmp/old\ninterface: any\nmode: dev\nport: 19000\nbrowser: false\nchatAutoSave: false\ncloseBehavior: quit\nchatSender: Desk\nchatAvatar: D\n"), 0644); err != nil {
		t.Fatal(err)
	}

	app := application.New()
	app.Flags.Config = configPath

	settings, err := ReadDesktopSettings(app)
	if err != nil {
		t.Fatal(err)
	}
	if settings.ConfigPath != configPath || settings.Output != "/tmp/old" || settings.Interface != "any" || settings.Mode != "dev" || settings.Port != 19000 || settings.Browser || settings.ChatAutoSave || settings.CloseBehavior != DesktopCloseBehaviorQuit || settings.ChatSender != "Desk" || settings.ChatAvatar != "D" {
		t.Fatalf("settings = %#v, want config values", settings)
	}

	newOutput := t.TempDir()
	updated := DesktopSettings{
		Interface:     "any",
		Port:          19001,
		Output:        newOutput,
		Browser:       true,
		ChatAutoSave:  false,
		CloseBehavior: DesktopCloseBehaviorQuit,
		ChatSender:    " Alice ",
		ChatAvatar:    " A ",
	}
	saved, err := WriteDesktopSettings(app, updated)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Output != newOutput || saved.Interface != "any" || saved.Mode != "dev" || saved.Port != 19001 || !saved.Browser || saved.ChatAutoSave || saved.CloseBehavior != DesktopCloseBehaviorQuit || saved.ChatSender != "Alice" || saved.ChatAvatar != "A" {
		t.Fatalf("saved settings = %#v, want updated values", saved)
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"output: " + strings.ToLower(newOutput),
		"interface: any",
		"mode: dev",
		"port: 19001",
		"browser: true",
		"chatautosave: false",
		"closebehavior: quit",
		"chatsender: alice",
		"chatavatar: a",
	} {
		if !strings.Contains(strings.ToLower(string(data)), want) {
			t.Fatalf("config = %q, want to contain %q", string(data), want)
		}
	}
}

func TestDesktopInterfaceScorePrefersPrivatePhysicalAdapters(t *testing.T) {
	if got := desktopInterfaceScore("Wi-Fi", "192.168.1.20"); got <= 0 {
		t.Fatalf("desktopInterfaceScore(Wi-Fi private) = %d, want positive", got)
	}
	if got := desktopInterfaceScore("docker0", "172.17.0.1"); got >= 0 {
		t.Fatalf("desktopInterfaceScore(docker0) = %d, want negative", got)
	}
}

func TestDesktopSettingsWriteCreatesOutputDirIfMissing(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.yml")
	app := application.New()
	app.Flags.Config = configPath

	missingDir := filepath.Join(t.TempDir(), "nonexistent-subdir-to-create")
	updated := DesktopSettings{
		Interface:     "any",
		Port:          19001,
		Output:        missingDir,
		Browser:       true,
		ChatAutoSave:  false,
		CloseBehavior: DesktopCloseBehaviorQuit,
	}

	saved, err := WriteDesktopSettings(app, updated)
	if err != nil {
		t.Fatalf("expected WriteDesktopSettings to succeed and create directory, got err: %v", err)
	}

	info, statErr := os.Stat(missingDir)
	if statErr != nil {
		t.Fatalf("expected directory %q to be created, got error: %v", missingDir, statErr)
	}
	if !info.IsDir() {
		t.Fatalf("expected path %q to be a directory", missingDir)
	}
	if saved.Output != missingDir {
		t.Fatalf("saved.Output = %q, want %q", saved.Output, missingDir)
	}
}
