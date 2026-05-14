package config

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"eqrcp/application"
	"eqrcp/util"
)

type DesktopSettings struct {
	ConfigPath       string                   `json:"configPath"`
	Interface        string                   `json:"interface"`
	InterfaceOptions []DesktopInterfaceOption `json:"interfaceOptions"`
	Mode             string                   `json:"mode,omitempty"`
	Port             int                      `json:"port"`
	Output           string                   `json:"output"`
	Browser          bool                     `json:"browser"`
	ChatAutoSave     bool                     `json:"chatAutoSave"`
	CloseBehavior    string                   `json:"closeBehavior"`
	ChatSender       string                   `json:"chatSender"`
	ChatAvatar       string                   `json:"chatAvatar"`
}

const (
	DesktopCloseBehaviorTray = "tray"
	DesktopCloseBehaviorQuit = "quit"
)

type DesktopInterfaceOption struct {
	Name  string `json:"name"`
	IP    string `json:"ip"`
	Label string `json:"label"`
}

func ReadDesktopSettings(app application.App) (DesktopSettings, error) {
	v := getViperInstance(app)
	if err := ensureConfigFile(v.ConfigFileUsed()); err != nil {
		return DesktopSettings{}, err
	}
	if err := v.ReadInConfig(); err != nil {
		return DesktopSettings{}, fmt.Errorf("fatal error config file: %s", err)
	}
	options, err := desktopInterfaceOptions(app.Flags.ListAllInterfaces)
	if err != nil {
		return DesktopSettings{}, err
	}
	browser := true
	if v.IsSet("browser") {
		browser = v.GetBool("browser")
	}
	chatAutoSave := true
	if v.IsSet("chatAutoSave") {
		chatAutoSave = v.GetBool("chatAutoSave")
	}
	closeBehavior := DesktopCloseBehaviorTray
	if v.IsSet("closeBehavior") {
		closeBehavior = normalizeDesktopCloseBehavior(v.GetString("closeBehavior"))
		if closeBehavior == "" {
			closeBehavior = DesktopCloseBehaviorTray
		}
	}
	chatSender := strings.TrimSpace(v.GetString("chatSender"))
	chatAvatar := strings.TrimSpace(v.GetString("chatAvatar"))
	selectedInterface := v.GetString("interface")
	if selectedInterface == "" {
		selectedInterface = defaultDesktopInterface(options)
	}
	output := v.GetString("output")
	if output == "" {
		output = DefaultDesktopOutputDirectory()
	}
	return DesktopSettings{
		ConfigPath:       v.ConfigFileUsed(),
		Interface:        selectedInterface,
		InterfaceOptions: options,
		Mode:             strings.ToLower(strings.TrimSpace(v.GetString("mode"))),
		Port:             v.GetInt("port"),
		Output:           output,
		Browser:          browser,
		ChatAutoSave:     chatAutoSave,
		CloseBehavior:    closeBehavior,
		ChatSender:       chatSender,
		ChatAvatar:       chatAvatar,
	}, nil
}

func WriteDesktopSettings(app application.App, settings DesktopSettings) (DesktopSettings, error) {
	if settings.Port < 0 || settings.Port > 65535 {
		return DesktopSettings{}, fmt.Errorf("port must be between 0 and 65535")
	}
	closeBehavior := normalizeDesktopCloseBehavior(settings.CloseBehavior)
	if closeBehavior == "" {
		return DesktopSettings{}, fmt.Errorf("close behavior must be %q or %q", DesktopCloseBehaviorTray, DesktopCloseBehaviorQuit)
	}
	if err := validateDesktopInterface(app, settings.Interface); err != nil {
		return DesktopSettings{}, err
	}
	output := settings.Output
	if output == "" {
		output = DefaultDesktopOutputDirectory()
	}
	output, err := filepath.Abs(output)
	if err != nil {
		return DesktopSettings{}, err
	}
	if err := validateDesktopOutput(output); err != nil {
		return DesktopSettings{}, err
	}
	v := getViperInstance(app)
	if err := ensureConfigFile(v.ConfigFileUsed()); err != nil {
		return DesktopSettings{}, err
	}
	if err := v.ReadInConfig(); err != nil {
		return DesktopSettings{}, fmt.Errorf("fatal error config file: %s", err)
	}
	v.Set("interface", settings.Interface)
	if mode := strings.ToLower(strings.TrimSpace(settings.Mode)); mode != "" {
		v.Set("mode", mode)
	}
	v.Set("port", settings.Port)
	v.Set("output", output)
	v.Set("browser", settings.Browser)
	v.Set("chatAutoSave", settings.ChatAutoSave)
	v.Set("closeBehavior", closeBehavior)
	v.Set("chatSender", strings.TrimSpace(settings.ChatSender))
	v.Set("chatAvatar", strings.TrimSpace(settings.ChatAvatar))
	if err := v.WriteConfig(); err != nil {
		return DesktopSettings{}, err
	}
	return ReadDesktopSettings(app)
}

func normalizeDesktopCloseBehavior(value string) string {
	switch value {
	case "", DesktopCloseBehaviorTray:
		return DesktopCloseBehaviorTray
	case DesktopCloseBehaviorQuit:
		return DesktopCloseBehaviorQuit
	default:
		return ""
	}
}

func DefaultDesktopOutputDirectory() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		if cwd, err := os.Getwd(); err == nil {
			return cwd
		}
		return "."
	}
	downloads := filepath.Join(home, "Downloads")
	if info, err := os.Stat(downloads); err == nil && info.IsDir() {
		return downloads
	}
	return home
}

func validateDesktopOutput(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("output %q is not a directory", path)
	}
	return nil
}

func validateDesktopInterface(app application.App, name string) error {
	if name == "" || name == "any" {
		return nil
	}
	options, err := desktopInterfaceOptions(app.Flags.ListAllInterfaces)
	if err != nil {
		return err
	}
	for _, option := range options {
		if option.Name == name {
			return nil
		}
	}
	return fmt.Errorf("interface %q is not available", name)
}

func desktopInterfaceOptions(listAll bool) ([]DesktopInterfaceOption, error) {
	interfaces, err := util.Interfaces(listAll)
	if err != nil {
		return nil, err
	}
	options := []DesktopInterfaceOption{{
		Name:  "any",
		IP:    "0.0.0.0",
		Label: "any (0.0.0.0)",
	}}
	names := make([]string, 0, len(interfaces))
	for name := range interfaces {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		ip := interfaces[name]
		options = append(options, DesktopInterfaceOption{
			Name:  name,
			IP:    ip,
			Label: fmt.Sprintf("%s (%s)", name, ip),
		})
	}
	return options, nil
}

func defaultDesktopInterface(options []DesktopInterfaceOption) string {
	for _, option := range options {
		if option.Name != "any" {
			return option.Name
		}
	}
	if len(options) > 0 {
		return options[0].Name
	}
	return ""
}

func ensureConfigFile(path string) error {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		if err := os.MkdirAll(filepath.Dir(path), os.ModeDir|os.ModePerm); err != nil {
			return err
		}
		file, err := os.Create(path)
		if err != nil {
			return err
		}
		return file.Close()
	} else if err != nil {
		return err
	}
	return nil
}
