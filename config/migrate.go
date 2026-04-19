package config

import (
	"encoding/json"
	"os"
	"path/filepath"

	"eqrcp/application"
	"github.com/adrg/xdg"
	"gopkg.in/yaml.v2"
)

// Migrate function will look for an existing legacy configuration file
// and will migrate it to the new format
func Migrate(app application.App) (bool, error) {
	oldConfigFile := filepath.Join(xdg.ConfigHome, "eqrcp", "config.json")
	newConfigFile := filepath.Join(xdg.ConfigHome, "eqrcp", "config.yml")
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
	if err := os.WriteFile(newConfigFile, newConfigFileBytes, 0644); err != nil {
		return false, err
	}
	// Delete old file
	if err := os.Remove(oldConfigFile); err != nil {
		return false, err
	}
	return true, nil
}
