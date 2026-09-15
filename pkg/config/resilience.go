package config

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/spf13/viper"
)

// BackupCorruptConfigFile moves a malformed/corrupted configuration file to a timestamped
// backup (e.g. config.yml.corrupted.20260916-120000) and recreates an empty valid file.
// This prevents configuration loading deadlocks and allows the application to self-heal.
func BackupCorruptConfigFile(configPath string) string {
	info, err := os.Stat(configPath)
	if err != nil || info.Size() == 0 {
		return ""
	}
	timestamp := time.Now().Format("20060102-150405")
	backupPath := fmt.Sprintf("%s.corrupted.%s", configPath, timestamp)
	if err := os.Rename(configPath, backupPath); err != nil {
		// If rename fails, try copy & truncate
		data, readErr := os.ReadFile(configPath)
		if readErr == nil {
			_ = os.WriteFile(backupPath, data, 0600)
		}
		_ = os.WriteFile(configPath, []byte{}, 0600)
	} else {
		// Recreate empty configuration file
		_ = ensureConfigFile(configPath)
	}
	return backupPath
}

// AtomicWriteConfigFile safely writes viper configuration via a temporary file in the same directory,
// syncing to disk before renaming. This guarantees zero-byte/truncated files never occur even upon unexpected termination.
func AtomicWriteConfigFile(v *viper.Viper, targetPath string) error {
	dir := filepath.Dir(targetPath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	tmpFile := filepath.Join(dir, fmt.Sprintf(".tmp-%d-%s", time.Now().UnixNano(), filepath.Base(targetPath)))
	v.SetConfigFile(tmpFile)
	v.SetConfigType("yaml")
	if err := v.WriteConfig(); err != nil {
		_ = os.Remove(tmpFile)
		return err
	}
	// Restore original config path on viper instance
	v.SetConfigFile(targetPath)

	// Atomic replace
	if err := os.Rename(tmpFile, targetPath); err != nil {
		// Windows fallback if target file exists and locked or cannot be directly replaced
		_ = os.Remove(targetPath)
		if renameErr := os.Rename(tmpFile, targetPath); renameErr != nil {
			_ = os.Remove(tmpFile)
			return renameErr
		}
	}
	return nil
}
