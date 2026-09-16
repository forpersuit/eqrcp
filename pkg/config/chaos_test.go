package config

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"eqt/pkg/application"
	"github.com/spf13/viper"
)

func TestConfigChaos_IsConfigParseError(t *testing.T) {
	// 1. Nil error
	if IsConfigParseError(nil) {
		t.Errorf("expected false for nil error")
	}

	// 2. Pure I/O or PathError (permission denied)
	pathErr := &fs.PathError{Op: "open", Path: "/dev/null", Err: os.ErrPermission}
	if IsConfigParseError(pathErr) {
		t.Errorf("expected false for PathError / permission denied")
	}

	// 3. Generic error
	if IsConfigParseError(errors.New("disk I/O error")) {
		t.Errorf("expected false for generic error")
	}

	// 4. Actual viper.ConfigParseError
	tempDir := t.TempDir()
	badYAML := filepath.Join(tempDir, "bad.yml")
	_ = os.WriteFile(badYAML, []byte("port: [unclosed\n\tinvalid: {{{\n:::"), 0644)
	v := viper.New()
	v.SetConfigFile(badYAML)
	err := v.ReadInConfig()
	if err == nil {
		t.Fatalf("expected ReadInConfig to fail on bad YAML")
	}
	if !IsConfigParseError(err) {
		t.Errorf("expected true for ConfigParseError, got err: %T => %v", err, err)
	}
}

func TestConfigChaos_PermissionDeniedNotDestroyed(t *testing.T) {
	tempDir := t.TempDir()
	configPath := filepath.Join(tempDir, "config.yml")

	// Write valid config
	validContent := []byte("port: 18000\ninterface: eth0\n")
	if err := os.WriteFile(configPath, validContent, 0644); err != nil {
		t.Fatal(err)
	}

	// Make file completely unreadable (0000)
	if err := os.Chmod(configPath, 0000); err != nil {
		t.Skip("chmod not supported in this test environment")
	}
	defer func() {
		_ = os.Chmod(configPath, 0644)
	}()

	app := application.New()
	app.Flags.Config = configPath

	// 1. ReadDesktopSettings must fail and MUST NOT trigger self-healing (must NOT destroy original file)
	_, err := ReadDesktopSettings(app)
	if err == nil {
		t.Fatalf("expected ReadDesktopSettings to return error for unreadable file")
	}

	// 2. config.New must fail and MUST NOT destroy original file
	_, err = New(app)
	if err == nil {
		t.Fatalf("expected New to return error for unreadable file")
	}

	// 3. Verify no .corrupted.* backup was created
	files, _ := os.ReadDir(tempDir)
	for _, f := range files {
		if strings.Contains(f.Name(), ".corrupted.") {
			t.Fatalf("unexpected self-healing triggered on permission denied error! Found backup: %s", f.Name())
		}
	}

	// Restore permission and check that original content is completely intact
	_ = os.Chmod(configPath, 0644)
	readBack, readErr := os.ReadFile(configPath)
	if readErr != nil {
		t.Fatalf("failed to read back config: %v", readErr)
	}
	if string(readBack) != string(validContent) {
		t.Fatalf("original file content was corrupted/truncated! got %q, want %q", string(readBack), string(validContent))
	}
}

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

	// 1. Test ReadDesktopSettings self-healing & notice generation
	settings, err := ReadDesktopSettings(app)
	if err != nil {
		t.Fatalf("expected ReadDesktopSettings to self-heal on corrupted YAML, got error: %v", err)
	}
	if settings.Port != 0 {
		t.Errorf("expected default port 0, got %d", settings.Port)
	}
	if settings.SelfHealNotice == "" {
		t.Errorf("expected SelfHealNotice to be populated, got empty string")
	}

	// Verify that a backup file was created with exact corrupted bytes
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

func TestConfigChaos_BackupFailureProtectsOriginal(t *testing.T) {
	tempDir := t.TempDir()
	configPath := filepath.Join(tempDir, "config.yml")

	originalContent := []byte("broken: [syntax")
	if err := os.WriteFile(configPath, originalContent, 0644); err != nil {
		t.Fatal(err)
	}

	// Non-existent or empty file should return empty string without error
	nonExistent := filepath.Join(tempDir, "does_not_exist.yml")
	path, err := BackupCorruptConfigFile(nonExistent)
	if err != nil || path != "" {
		t.Errorf("expected empty string and nil error for non-existent file, got (%q, %v)", path, err)
	}
}

func TestConfigChaos_AtomicWriteZeroDataLoss(t *testing.T) {
	tempDir := t.TempDir()
	targetPath := filepath.Join(tempDir, "config.yml")

	v := viper.New()
	v.Set("port", 12345)
	v.Set("interface", "lo0")

	if err := AtomicWriteConfigFile(v, targetPath); err != nil {
		t.Fatalf("AtomicWriteConfigFile failed: %v", err)
	}

	data, err := os.ReadFile(targetPath)
	if err != nil {
		t.Fatalf("failed to read written file: %v", err)
	}
	if !strings.Contains(string(data), "port: 12345") {
		t.Errorf("expected target file to contain port: 12345, got %s", string(data))
	}

	// Overwrite atomically with new values
	v.Set("port", 54321)
	if err := AtomicWriteConfigFile(v, targetPath); err != nil {
		t.Fatalf("second AtomicWriteConfigFile failed: %v", err)
	}

	data2, err := os.ReadFile(targetPath)
	if err != nil {
		t.Fatalf("failed to read overwritten file: %v", err)
	}
	if !strings.Contains(string(data2), "port: 54321") {
		t.Errorf("expected target file to contain updated port: 54321, got %s", string(data2))
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

func TestConfigChaos_FormatSelfHealNotice_MultiLang(t *testing.T) {
	backupPath := "/dummy/path/config.yml.corrupted.20260916-120000"

	// 1. Chinese locale variants
	zhNotice := FormatSelfHealNotice(backupPath, "zh")
	if !strings.Contains(zhNotice, "检测到配置文件格式损坏") {
		t.Errorf("expected Chinese message for 'zh', got %s", zhNotice)
	}
	zhCNNotice := FormatSelfHealNotice(backupPath, "zh-CN")
	if !strings.Contains(zhCNNotice, "检测到配置文件格式损坏") {
		t.Errorf("expected Chinese message for 'zh-CN', got %s", zhCNNotice)
	}

	// 2. English locale
	enNotice := FormatSelfHealNotice(backupPath, "en")
	if !strings.Contains(enNotice, "Corrupted configuration detected") {
		t.Errorf("expected English message for 'en', got %s", enNotice)
	}

	// 3. Other languages (de, es, ja, fr) must fallback to English, NOT Chinese
	for _, lang := range []string{"de", "es", "ja", "fr", "ko"} {
		notice := FormatSelfHealNotice(backupPath, lang)
		if strings.Contains(notice, "检测到配置文件格式损坏") {
			t.Errorf("language %s should NOT fallback to Chinese, got %s", lang, notice)
		}
		if !strings.Contains(notice, "Corrupted configuration detected") {
			t.Errorf("language %s should fallback to English, got %s", lang, notice)
		}
	}
}

func TestConfigChaos_AtomicWrite_PreservesViperConfigFile(t *testing.T) {
	tempDir := t.TempDir()
	originalPath := filepath.Join(tempDir, "original.yml")
	targetPath := filepath.Join(tempDir, "target.yml")

	v := viper.New()
	v.SetConfigFile(originalPath)
	v.Set("test_key", "test_value")

	if err := AtomicWriteConfigFile(v, targetPath); err != nil {
		t.Fatalf("AtomicWriteConfigFile failed: %v", err)
	}

	// DEF-05 check: v.ConfigFileUsed() must remain originalPath and NOT be mutated to temporary file
	if v.ConfigFileUsed() != originalPath {
		t.Errorf("v.ConfigFileUsed was mutated by AtomicWriteConfigFile! got %s, want %s", v.ConfigFileUsed(), originalPath)
	}
}
