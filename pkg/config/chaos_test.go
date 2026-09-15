package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"eqt/pkg/application"
)

func TestConfigChaos_CorruptedYAML_SelfHealing(t *testing.T) {
	tempDir := t.TempDir()
	configPath := filepath.Join(tempDir, "config.yml")

	// Write syntactically invalid YAML
	corruptBytes := []byte("port: [unclosed\n\tinvalid: {{{\n:::")
	if err := os.WriteFile(configPath, corruptBytes, 0644); err != nil {
		t.Fatal(err)
	}

	app := application.New()
	app.Flags.Config = configPath

	// 1. Test ReadDesktopSettings self-healing
	settings, err := ReadDesktopSettings(app)
	if err != nil {
		t.Fatalf("expected ReadDesktopSettings to self-heal on corrupted YAML, got error: %v", err)
	}
	if settings.Port != 0 {
		t.Errorf("expected default port 0, got %d", settings.Port)
	}

	// Verify that a backup file was created
	files, _ := os.ReadDir(tempDir)
	foundBackup := false
	for _, f := range files {
		if strings.Contains(f.Name(), ".corrupted.") {
			foundBackup = true
			content, _ := os.ReadFile(filepath.Join(tempDir, f.Name()))
			if string(content) != string(corruptBytes) {
				t.Errorf("backup content mismatch: got %q, want %q", string(content), string(corruptBytes))
			}
			break
		}
	}
	if !foundBackup {
		t.Errorf("expected .corrupted.* backup file in %s, found: %v", tempDir, files)
	}

	// 2. Re-corrupt and test config.New self-healing
	if err := os.WriteFile(configPath, corruptBytes, 0644); err != nil {
		t.Fatal(err)
	}
	cfg, err := New(app)
	if err != nil {
		t.Fatalf("expected New to self-heal on corrupted YAML, got error: %v", err)
	}
	if cfg.Port != 0 {
		t.Errorf("expected default port 0, got %d", cfg.Port)
	}

	// 3. Re-corrupt and test WriteDesktopSettings self-healing recovery
	if err := os.WriteFile(configPath, corruptBytes, 0644); err != nil {
		t.Fatal(err)
	}
	recoveredSettings := DesktopSettings{
		Interface:     "any",
		Port:          18000,
		Output:        tempDir,
		CloseBehavior: DesktopCloseBehaviorTray,
	}
	saved, writeErr := WriteDesktopSettings(app, recoveredSettings)
	if writeErr != nil {
		t.Fatalf("expected WriteDesktopSettings to heal and overwrite corrupted config, got error: %v", writeErr)
	}
	if saved.Port != 18000 {
		t.Errorf("expected saved port 18000, got %d", saved.Port)
	}

	// Verify that the file is now clean, valid YAML
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "port: 18000") {
		t.Errorf("expected config to contain port: 18000, got: %s", string(data))
	}
}

func TestConfigChaos_MismatchedTypes(t *testing.T) {
	tempDir := t.TempDir()
	configPath := filepath.Join(tempDir, "config.yml")

	// Types mismatch: port is a string "invalid", browser is an array, enableTLS is a dictionary
	mismatchedContent := `
port: "not_a_port"
browser: ["not", "a", "bool"]
enableTLS: {nested: "dict"}
output: 12345
closeBehavior: 9999
`
	if err := os.WriteFile(configPath, []byte(mismatchedContent), 0644); err != nil {
		t.Fatal(err)
	}

	app := application.New()
	app.Flags.Config = configPath

	settings, err := ReadDesktopSettings(app)
	if err != nil {
		t.Fatalf("expected ReadDesktopSettings to tolerate mismatched types, got error: %v", err)
	}
	if settings.Port != 0 {
		t.Errorf("expected port to default to 0 on string mismatch, got %d", settings.Port)
	}
	if settings.CloseBehavior != DesktopCloseBehaviorTray {
		t.Errorf("expected closeBehavior to default to tray, got %q", settings.CloseBehavior)
	}

	cfg, err := New(app)
	if err != nil {
		t.Fatalf("expected New to tolerate mismatched types, got error: %v", err)
	}
	if cfg.Port != 0 {
		t.Errorf("expected port to default to 0 on string mismatch, got %d", cfg.Port)
	}
}

func TestConfigChaos_EmptyFile(t *testing.T) {
	tempDir := t.TempDir()
	configPath := filepath.Join(tempDir, "config.yml")

	// Empty file (0 bytes)
	if err := os.WriteFile(configPath, []byte(""), 0644); err != nil {
		t.Fatal(err)
	}

	app := application.New()
	app.Flags.Config = configPath

	settings, err := ReadDesktopSettings(app)
	if err != nil {
		t.Fatalf("expected ReadDesktopSettings to succeed on empty file, got: %v", err)
	}
	if settings.Port != 0 {
		t.Errorf("expected port 0, got %d", settings.Port)
	}

	cfg, err := New(app)
	if err != nil {
		t.Fatalf("expected New to succeed on empty file, got: %v", err)
	}
	if cfg.Port != 0 {
		t.Errorf("expected port 0, got %d", cfg.Port)
	}
}

func TestConfigChaos_PortBounding(t *testing.T) {
	tempDir := t.TempDir()
	configPath := filepath.Join(tempDir, "config.yml")

	// Negative port and overflow port
	negativePortContent := `port: -9999`
	if err := os.WriteFile(configPath, []byte(negativePortContent), 0644); err != nil {
		t.Fatal(err)
	}

	app := application.New()
	app.Flags.Config = configPath

	settings, err := ReadDesktopSettings(app)
	if err != nil {
		t.Fatalf("expected ReadDesktopSettings to succeed, got: %v", err)
	}
	if settings.Port != 0 {
		t.Errorf("expected negative port to be clamped to 0, got %d", settings.Port)
	}

	cfg, err := New(app)
	if err != nil {
		t.Fatalf("expected New to succeed, got: %v", err)
	}
	if cfg.Port != 0 {
		t.Errorf("expected negative port to be clamped to 0 in cfg.Port, got %d", cfg.Port)
	}

	// Overflow port
	overflowPortContent := `port: 99999`
	if err := os.WriteFile(configPath, []byte(overflowPortContent), 0644); err != nil {
		t.Fatal(err)
	}
	settings, err = ReadDesktopSettings(app)
	if err != nil {
		t.Fatalf("expected ReadDesktopSettings to succeed, got: %v", err)
	}
	if settings.Port != 0 {
		t.Errorf("expected overflow port 99999 to be clamped to 0, got %d", settings.Port)
	}
}
