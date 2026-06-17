package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"eqt/application"
	"github.com/adrg/xdg"
	"gopkg.in/yaml.v2"
)

// Migrate function will look for an existing legacy configuration file
// and will migrate it to the new format
func Migrate(app application.App) (bool, error) {
	oldConfigFile := filepath.Join(xdg.ConfigHome, "eqt", "config.json")
	newConfigFile := DefaultConfigFile()
	// Check if old configuration file exists
	if _, err := os.Stat(oldConfigFile); os.IsNotExist(err) {
		return false, nil
	}
	oldConfigFileBytes, err := os.ReadFile(oldConfigFile)
	if err != nil {
		return false, err
	}
	var cfg Config
	if err := json.Unmarshal(oldConfigFileBytes, &cfg); err != nil {
		return false, err
	}
	newConfigFileBytes, err := yaml.Marshal(cfg)
	if err != nil {
		return false, err
	}
	if err := os.MkdirAll(filepath.Dir(newConfigFile), os.ModeDir|os.ModePerm); err != nil {
		return false, err
	}
	if err := os.WriteFile(newConfigFile, newConfigFileBytes, 0644); err != nil {
		return false, err
	}
	// Delete old file
	if err := os.Remove(oldConfigFile); err != nil {
		return false, err
	}
	return true, nil
}

func copyLegacyConfigIfNeeded(target string) error {
	if _, err := os.Stat(target); err == nil {
		return nil
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	for _, source := range []string{
		filepath.Join(xdg.ConfigHome, "eqt", "config.yml"),
		filepath.Join(xdg.ConfigHome, "eqt", "config.yaml"),
		filepath.Join(xdg.ConfigHome, "eqt", "config.json"),
	} {
		data, err := os.ReadFile(source)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		if filepath.Ext(source) == ".json" {
			var cfg Config
			if err := json.Unmarshal(data, &cfg); err != nil {
				return err
			}
			data, err = yaml.Marshal(cfg)
			if err != nil {
				return err
			}
		}
		if err := os.MkdirAll(filepath.Dir(target), os.ModeDir|os.ModePerm); err != nil {
			return err
		}
		return os.WriteFile(target, data, 0644)
	}
	return nil
}
