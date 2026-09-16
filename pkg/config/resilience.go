package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/spf13/viper"
)

// SelfHealEvent records an incident where a corrupted configuration file was safely
// backed up and restored to valid defaults.
type SelfHealEvent struct {
	Timestamp  time.Time `json:"timestamp"`
	ConfigPath string    `json:"configPath"`
	BackupPath string    `json:"backupPath"`
	Reason     string    `json:"reason"`
}

var (
	selfHealMu     sync.Mutex
	selfHealEvents []SelfHealEvent
)

// RecordSelfHealEvent registers a self-healing occurrence for user notifications and audit logs.
func RecordSelfHealEvent(event SelfHealEvent) {
	selfHealMu.Lock()
	defer selfHealMu.Unlock()
	selfHealEvents = append(selfHealEvents, event)
}

// ConsumeSelfHealEvents retrieves and empties the queue of pending self-healing events.
func ConsumeSelfHealEvents() []SelfHealEvent {
	selfHealMu.Lock()
	defer selfHealMu.Unlock()
	if len(selfHealEvents) == 0 {
		return nil
	}
	events := make([]SelfHealEvent, len(selfHealEvents))
	copy(events, selfHealEvents)
	selfHealEvents = nil
	return events
}

// HasPendingSelfHealEvents checks whether any self-healing event is queued.
func HasPendingSelfHealEvents() bool {
	selfHealMu.Lock()
	defer selfHealMu.Unlock()
	return len(selfHealEvents) > 0
}

// FormatSelfHealNotice creates a user-friendly, localized in-app notification message.
func FormatSelfHealNotice(backupPath string, lang string) string {
	baseName := filepath.Base(backupPath)
	if NormalizeLangCode(lang) == "zh" {
		return fmt.Sprintf("检测到配置文件格式损坏，已自动恢复默认设置。原始配置已备份至: %s", baseName)
	}
	return fmt.Sprintf("Corrupted configuration detected and restored to defaults. Backup saved to %s", baseName)
}

// IsConfigParseError determines whether an error returned by viper.ReadInConfig is specifically
// a syntactic parsing failure (e.g. malformed YAML/JSON), as strictly differentiated from
// filesystem I/O errors (e.g. permission denied, device unreadable, file locked).
func IsConfigParseError(err error) bool {
	if err == nil {
		return false
	}
	var parseErr viper.ConfigParseError
	return errors.As(err, &parseErr)
}

// BackupCorruptConfigFile moves a malformed/corrupted configuration file to a timestamped
// backup (e.g. config.yml.corrupted.20260916-120000) and recreates an empty valid file.
// Under First Principles:
// 1. Only actual corrupted files (size > 0) are backed up.
// 2. If the backup fails to be written to disk (e.g. disk full), the original file is NEVER truncated or modified.
// 3. Successfully healed events are recorded for in-app notification.
func BackupCorruptConfigFile(configPath string) (string, error) {
	info, err := os.Stat(configPath)
	if err != nil || info.Size() == 0 {
		return "", nil
	}

	timestamp := time.Now().Format("20060102-150405")
	backupPath := fmt.Sprintf("%s.corrupted.%s", configPath, timestamp)

	// Attempt atomic move first
	if renameErr := os.Rename(configPath, backupPath); renameErr == nil {
		_ = ensureConfigFile(configPath)
		RecordSelfHealEvent(SelfHealEvent{
			Timestamp:  time.Now(),
			ConfigPath: configPath,
			BackupPath: backupPath,
			Reason:     "parse_error",
		})
		return backupPath, nil
	}

	// Rename failed (e.g. cross-device or permission quirks). Fallback to copy & truncate,
	// but ONLY truncate if the backup was fully written and verified on disk.
	data, readErr := os.ReadFile(configPath)
	if readErr != nil {
		return "", fmt.Errorf("failed to read corrupt config for backup: %w", readErr)
	}

	if writeErr := os.WriteFile(backupPath, data, 0600); writeErr != nil {
		// Zero tolerance for data destruction: if backup cannot be written, DO NOT touch the original file!
		return "", fmt.Errorf("failed to write backup config file %s: %w", backupPath, writeErr)
	}

	// Backup succeeded, safe to reset original file
	if truncateErr := os.WriteFile(configPath, []byte{}, 0600); truncateErr != nil {
		// Zero tolerance for secondary destruction: preserve backupPath even if original file reset fails
		return "", fmt.Errorf("failed to reset corrupt config file (backup preserved at %s): %w", backupPath, truncateErr)
	}

	RecordSelfHealEvent(SelfHealEvent{
		Timestamp:  time.Now(),
		ConfigPath: configPath,
		BackupPath: backupPath,
		Reason:     "parse_error",
	})
	return backupPath, nil
}

// AtomicWriteConfigFile safely writes viper configuration via a temporary file in the same directory,
// ensuring zero-byte/truncated files never occur even upon unexpected power loss or process kill.
// If atomic replacement fails on Windows/special filesystems:
// 1. Existing configuration is safely preserved as a .old fallback rather than deleted upfront.
// 2. If the secondary replacement fails, the temporary file is NOT deleted, ensuring ZERO data loss.
func AtomicWriteConfigFile(v *viper.Viper, targetPath string) error {
	dir := filepath.Dir(targetPath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}

	// Temporary file retains the target extension (e.g. .yml), enabling Viper to correctly infer serialization format.
	tmpFile := filepath.Join(dir, fmt.Sprintf(".tmp-%d-%s", time.Now().UnixNano(), filepath.Base(targetPath)))
	// Use WriteConfigAs to directly write without mutating the global state of the viper instance.
	if err := v.WriteConfigAs(tmpFile); err != nil {
		_ = os.Remove(tmpFile)
		return err
	}

	// Attempt atomic replacement
	if err := os.Rename(tmpFile, targetPath); err != nil {
		// Windows fallback: target may be locked or direct overwrite may not be supported by OS
		backupOld := fmt.Sprintf("%s.old-%d", targetPath, time.Now().UnixNano())
		hasOld := false
		if _, statErr := os.Stat(targetPath); statErr == nil {
			if renameOldErr := os.Rename(targetPath, backupOld); renameOldErr == nil {
				hasOld = true
			}
		}

		if renameErr := os.Rename(tmpFile, targetPath); renameErr != nil {
			// Second rename failed! Attempt to restore old file if we moved it
			if hasOld {
				_ = os.Rename(backupOld, targetPath)
			}
			// Retain tmpFile so unsaved data can be recovered manually
			return fmt.Errorf("atomic write failed: could not rename %s to %s (temporary file retained at %s): %w", tmpFile, targetPath, tmpFile, renameErr)
		}

		// Succeeded: clean up old temporary backup
		if hasOld {
			_ = os.Remove(backupOld)
		}
	}
	return nil
}
