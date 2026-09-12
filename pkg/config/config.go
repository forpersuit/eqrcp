package config

import (
	"errors"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"eqt/pkg/application"
	"eqt/pkg/logger"
	"eqt/pkg/util"
	"github.com/asaskevich/govalidator"
	"github.com/manifoldco/promptui"
	"github.com/spf13/viper"
)

type Config struct {
	Interface       string `yaml:",omitempty"`
	Port            int    `yaml:",omitempty"`
	Bind            string `yaml:",omitempty"`
	Mode            string `yaml:",omitempty"`
	KeepAlive       bool   `yaml:",omitempty"`
	Path            string `yaml:",omitempty"`
	Secure          bool   `yaml:",omitempty"`
	TlsKey          string `yaml:",omitempty"`
	TlsCert         string `yaml:",omitempty"`
	FQDN            string `yaml:",omitempty"`
	Output          string `yaml:",omitempty"`
	Reversed        bool   `yaml:",omitempty"`
	Lang            string `yaml:",omitempty"`
	EnableChatV2    bool   `yaml:"enableChatV2,omitempty"`
	EnableTelemetry bool   `yaml:"enableTelemetry,omitempty"`
}

var interactive bool = false

func New(app application.App) (Config, error) {
	log := logger.New(app.Flags.Quiet)
	v := GetViperInstance(app)
	var err error
	cfg := Config{}

	_, err = os.Stat(v.ConfigFileUsed())
	if os.IsNotExist(err) {
		if err := os.MkdirAll(filepath.Dir(v.ConfigFileUsed()), os.ModeDir|os.ModePerm); err != nil {
			return Config{}, err
		}
		file, err := os.Create(v.ConfigFileUsed())
		if err != nil {
			return Config{}, err
		}
		defer file.Close()
	}
	if err := v.ReadInConfig(); err != nil {
		return Config{}, fmt.Errorf("fatal error config file: %s", err)
	}
	// Load file
	cfg.Interface = v.GetString("interface")
	cfg.Bind = v.GetString("bind")
	cfg.Mode = strings.ToLower(strings.TrimSpace(v.GetString("mode")))
	cfg.Port = v.GetInt("port")
	cfg.KeepAlive = v.GetBool("keepAlive")
	cfg.Path = v.GetString("path")
	cfg.Secure = v.GetBool("secure")
	cfg.TlsKey = v.GetString("tls-key")
	cfg.TlsCert = v.GetString("tls-cert")
	cfg.FQDN = v.GetString("fqdn")
	cfg.Output = v.GetString("output")
	cfg.Reversed = v.GetBool("reversed")
	cfg.EnableChatV2 = v.GetBool("enableChatV2")

	// Override
	if app.Flags.Interface != "" {
		cfg.Interface = app.Flags.Interface
	}
	if app.Flags.Bind != "" {
		cfg.Bind = app.Flags.Bind
	}
	if app.Flags.Port != 0 {
		cfg.Port = app.Flags.Port
	}
	if app.Flags.KeepAlive {
		cfg.KeepAlive = true
	}
	if app.Flags.Path != "" {
		cfg.Path = app.Flags.Path
	}
	if app.Flags.Secure {
		cfg.Secure = true
	}
	if app.Flags.TlsKey != "" {
		cfg.TlsKey = app.Flags.TlsKey
	}
	if app.Flags.TlsCert != "" {
		cfg.TlsCert = app.Flags.TlsCert
	}
	if app.Flags.FQDN != "" {
		cfg.FQDN = app.Flags.FQDN
	}
	if app.Flags.Output != "" {
		cfg.Output = app.Flags.Output
	}
	if app.Flags.Reversed {
		cfg.Reversed = true
	}

	// Validate if configured interface exists on this host (only if not overridden by command line flag)
	if app.Flags.Interface == "" && cfg.Interface != "" && cfg.Interface != "any" {
		ifaces, err := util.Interfaces(true)
		if err == nil {
			exists := false
			for name := range ifaces {
				if name == cfg.Interface {
					exists = true
					break
				}
			}
			if !exists {
				cfg.Interface = ""
			}
		}
	}

	// Discover interface if it's not been set yet
	if !interactive {
		// Detect if we are running a desktop agent/status subcommand to avoid blockages
		isDesktopCmd := false
		for _, arg := range os.Args {
			if arg == "desktop" {
				isDesktopCmd = true
				break
			}
		}

		// Only run discovery and confirmation if not overridden by command line flag,
		// and NOT running a desktop-related control command.
		if app.Flags.Interface == "" && !isDesktopCmd {
			cfg.Interface, err = chooseInterface(app.Flags)
			if err != nil {
				return Config{}, err
			}
			v.Set("interface", cfg.Interface)
			if err := v.WriteConfig(); err != nil {
				log.Print(fmt.Sprintf("Warning: the configuration file could not be saved: %v\n", err))
			}
		}
	}

	return cfg, nil
}

func GetViperInstance(app application.App) *viper.Viper {
	var configType string
	var configFile string
	v := viper.New()
	if app.Flags.Config != "" {
		configFile = app.Flags.Config
		configType = filepath.Ext(configFile)[1:]
		if configType == "" {
			configType = "yml"
		}
	} else {
		configType = "yml"
		configFile = DefaultConfigFile()
	}
	v.SetConfigType(configType)
	v.SetConfigFile(configFile)
	v.AutomaticEnv()
	v.SetEnvPrefix(app.Name)
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_", "-", "_"))
	return v
}

// DefaultConfigDir returns the unified base application data and configuration directory.
// Priority order:
// 1. EQT_CONFIG_DIR env var (primarily for test isolation and custom directory overrides)
var migrateLegacyOnce sync.Once

func copyDirRecursive(srcDir, dstDir string) error {
	entries, err := os.ReadDir(srcDir)
	if err != nil {
		return err
	}
	// Q2: Enforce 0700 permissions on all newly created directories to protect private keys and config
	_ = os.MkdirAll(dstDir, 0700)
	for _, entry := range entries {
		src := filepath.Join(srcDir, entry.Name())
		dst := filepath.Join(dstDir, entry.Name())
		if entry.IsDir() {
			_ = copyDirRecursive(src, dst)
			continue
		}
		if _, err := os.Stat(dst); os.IsNotExist(err) {
			if data, err := os.ReadFile(src); err == nil {
				perm := os.FileMode(0644)
				if strings.HasSuffix(entry.Name(), ".pem") || strings.HasSuffix(entry.Name(), ".key") {
					perm = 0600
				}
				_ = os.WriteFile(dst, data, perm)
			}
		}
	}
	return nil
}

// maybeMigrateLegacyConfig copies configuration files and certificates from legacy locations
// (~/.local/eqt for config, ~/.config/eqt/certs for TLS certificates) to targetDir
// if the target directory does not yet contain them.
// Note: When EQT_CONFIG_DIR is set, this migration is bypassed by design to maintain test isolation (Q8).
func maybeMigrateLegacyConfig(targetDir string) {
	migrateLegacyOnce.Do(func() {
		home, err := os.UserHomeDir()
		if err != nil || home == "" {
			return
		}

		// 1. Migrate config from legacy ~/.local/eqt
		legacyConfigDir := filepath.Join(home, ".local", "eqt")
		if filepath.Clean(legacyConfigDir) != filepath.Clean(targetDir) {
			if _, err := os.Stat(filepath.Join(targetDir, "config.yml")); os.IsNotExist(err) {
				if fi, err := os.Stat(legacyConfigDir); err == nil && fi.IsDir() {
					_ = copyDirRecursive(legacyConfigDir, targetDir)
				}
			}
		}

		// 2. Migrate certs from legacy ~/.config/eqt/certs
		legacyCertsDir := filepath.Join(home, ".config", "eqt", "certs")
		targetCertsDir := filepath.Join(targetDir, "certs")
		if filepath.Clean(legacyCertsDir) != filepath.Clean(targetCertsDir) {
			// Pre-check (Q2): Skip full tree traversal if target certs directory already exists and is non-empty
			targetExists := false
			if entries, err := os.ReadDir(targetCertsDir); err == nil && len(entries) > 0 {
				targetExists = true
			}
			if !targetExists {
				if fi, err := os.Stat(legacyCertsDir); err == nil && fi.IsDir() {
					_ = copyDirRecursive(legacyCertsDir, targetCertsDir)
				}
			}
		}
	})
}

// DefaultConfigDir returns the unified base application data and configuration directory.
// Priority order:
// 1. EQT_CONFIG_DIR env var (primarily for test isolation and custom directory overrides; bypasses legacy migration)
// 2. Standard user config directory via os.UserConfigDir():
//   - Windows: %APPDATA%\eqt (e.g. C:\Users\<user>\AppData\Roaming\eqt)
//   - Linux/POSIX: ~/.config/eqt (or $XDG_CONFIG_HOME/eqt)
//   - macOS: ~/Library/Application Support/eqt
//
// 3. User home directory fallback (~/.config/eqt)
// 4. Current directory fallback (./eqt)
// Note: EQT_CONFIG_DIR is intended for testing or explicit custom deployment overrides.
func DefaultConfigDir() string {
	if envDir := os.Getenv("EQT_CONFIG_DIR"); envDir != "" {
		return envDir
	}
	var target string
	if dir, err := os.UserConfigDir(); err == nil && dir != "" {
		target = filepath.Join(dir, "eqt")
	} else if home, err := os.UserHomeDir(); err == nil && home != "" {
		target = filepath.Join(home, ".config", "eqt")
	} else if current, err := user.Current(); err == nil && current.HomeDir != "" {
		target = filepath.Join(current.HomeDir, ".config", "eqt")
	} else {
		target = filepath.Join(".", "eqt")
	}
	maybeMigrateLegacyConfig(target)
	return target
}

// DefaultLogsDir returns the unified directory for application logs (xxx/eqt/logs).
func DefaultLogsDir() string {
	return filepath.Join(DefaultConfigDir(), "logs")
}

// DefaultCertsDir returns the unified directory for LAN-TLS certificates (xxx/eqt/certs).
func DefaultCertsDir() string {
	return filepath.Join(DefaultConfigDir(), "certs")
}

func DefaultConfigFile() string {
	return filepath.Join(DefaultConfigDir(), "config.yml")
}

func Wizard(app application.App) error {
	interactive = true
	cfg, err := New(app)
	if err != nil {
		return err
	}
	v := GetViperInstance(app)
	// Choose interface
	cfg.Interface, err = chooseInterface(app.Flags)
	if err != nil {
		return err
	}
	v.Set("interface", cfg.Interface)
	if err := v.WriteConfig(); err != nil {
		return err
	}
	// Ask for bind address
	validateBind := func(input string) error {
		if input == "" {
			return nil
		}
		if !govalidator.IsIPv4(input) {
			return errors.New("invalid address")
		}
		return nil
	}
	promptBind := promptui.Prompt{
		Validate: validateBind,
		Label:    "Enter bind address (this will override the chosen interface address)",
		Default:  cfg.Bind,
	}
	if promptBindResultString, err := promptBind.Run(); err == nil {
		if promptBindResultString != "" {
			v.Set("bind", promptBindResultString)
		}
	}
	// Ask for port
	validatePort := func(input string) error {
		_, err := strconv.ParseUint(input, 10, 16)
		if err != nil {
			return errors.New("invalid number")
		}
		return nil
	}
	promptPort := promptui.Prompt{
		Validate: validatePort,
		Label:    "Choose port, 0 means random port",
		Default:  fmt.Sprintf("%d", cfg.Port),
	}
	if promptPortResultString, err := promptPort.Run(); err == nil {
		if port, err := strconv.ParseUint(promptPortResultString, 10, 16); err == nil {
			if port > 0 {
				v.Set("port", port)
			}
		}
	}
	// Ask for fully qualified domain name
	validateFqdn := func(input string) error {
		if input != "" && !govalidator.IsDNSName(input) {
			return errors.New("invalid domain")
		}
		return nil
	}
	promptFqdn := promptui.Prompt{
		Validate: validateFqdn,
		Label:    "Choose fully-qualified domain name",
		Default:  cfg.FQDN,
	}
	if promptFqdnString, err := promptFqdn.Run(); err == nil {
		if promptFqdnString != "" {
			v.Set("fqdn", promptFqdnString)
		}

	}
	promptPath := promptui.Prompt{
		Label:   "Choose URL path, empty means random",
		Default: cfg.Path,
	}
	if promptPathResultString, err := promptPath.Run(); err == nil {
		if promptPathResultString != "" {
			v.Set("path", promptPathResultString)
		}
	}
	// Ask for keep alive
	promptKeepAlive := promptui.Select{
		Items: []string{"No", "Yes"},
		Label: "Should the server keep alive after transferring?",
	}
	if _, promptKeepAliveResultString, err := promptKeepAlive.Run(); err == nil {
		if promptKeepAliveResultString == "Yes" {
			v.Set("keepAlive", true)
		}
	}
	// HTTPS
	// Ask if path is readable and is a file
	pathIsReadableFile := func(input string) error {
		if input == "" {
			return errors.New("invalid path")
		}
		path, err := filepath.Abs(util.Expand(input))
		if err != nil {
			return err
		}
		fmt.Println(path)
		fileinfo, err := os.Stat(path)
		if err != nil {
			return err
		}
		if fileinfo.Mode().IsDir() {
			return fmt.Errorf("%s is a directory", input)
		}
		return nil
	}
	promptSecure := promptui.Select{
		Items: []string{"No", "Yes"},
		Label: "Should files be securely transferred with HTTPS?",
	}
	if _, promptSecureResultString, err := promptSecure.Run(); err == nil {
		if promptSecureResultString == "Yes" {
			v.Set("secure", true)
		}
		cfg.Secure = v.GetBool("secure")
	}
	if cfg.Secure {
		// TLS Cert
		promptTlsCert := promptui.Prompt{
			Label:    "Choose TLS certificate path. Empty if not using HTTPS.",
			Default:  cfg.TlsCert,
			Validate: pathIsReadableFile,
		}
		if promptTlsCertString, err := promptTlsCert.Run(); err == nil {
			v.Set("tls-cert", util.Expand(promptTlsCertString))
		}
		// TLS key
		promptTlsKey := promptui.Prompt{
			Label:    "Choose TLS certificate key. Empty if not using HTTPS.",
			Default:  cfg.TlsKey,
			Validate: pathIsReadableFile,
		}
		if promptTlsKeyString, err := promptTlsKey.Run(); err == nil {
			v.Set("tls-key", util.Expand(promptTlsKeyString))
		}
	}
	validateIsDir := func(input string) error {
		if input == "" {
			return nil
		}
		path, err := filepath.Abs(input)
		if err != nil {
			return err
		}
		f, err := os.Stat(path)
		if err != nil {
			return err
		}
		if !f.IsDir() {
			return errors.New("path is not a directory")
		}
		return nil
	}
	// Ask for default output directory
	promptOutput := promptui.Prompt{
		Label:    "Choose default output directory for received files, empty does not set a default",
		Default:  cfg.Output,
		Validate: validateIsDir,
	}
	if promptOutputResultString, err := promptOutput.Run(); err == nil {
		if promptOutputResultString != "" {
			output, _ := filepath.Abs(promptOutputResultString)
			v.Set("output", output)
		}
	}
	promptReversed := promptui.Select{
		Items: []string{"No", "Yes"},
		Label: "Reverse QR code (black text on white background)?",
	}
	if _, promptReversedResultString, err := promptReversed.Run(); err == nil {
		if promptReversedResultString == "Yes" {
			v.Set("reversed", true)
		}
		cfg.Reversed = v.GetBool("reversed")
	}

	return v.WriteConfig()
}
