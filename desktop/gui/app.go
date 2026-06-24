package main

import (
	"context"
	"eqt/util"
	"eqt/version"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)
const chatSaveRetentionDays = 7

type App struct {
	ctx           context.Context
	client        *http.Client
	mu            sync.Mutex
	closeBehavior string
	forceQuit     bool
	logger        *FileLogger
	agent         *desktopAgent
}

type AgentTask struct {
	Action  string   `json:"action"`
	Paths   []string `json:"paths"`
	Browser *bool    `json:"browser,omitempty"`
}


type TaskRecord struct {
	ID                  int        `json:"id"`
	Action              string     `json:"action"`
	Paths               []string   `json:"paths"`
	State               string     `json:"state"`
	TransferState       string     `json:"transferState,omitempty"`
	TransferMessage     string     `json:"transferMessage,omitempty"`
	TransferMode        string     `json:"transferMode,omitempty"`
	TransferTarget      string     `json:"transferTarget,omitempty"`
	TransferArchiveName string     `json:"transferArchiveName,omitempty"`
	TransferCurrent     string     `json:"transferCurrent,omitempty"`
	TransferPercent     int        `json:"transferPercent,omitempty"`
	BytesDone           int64      `json:"bytesDone,omitempty"`
	BytesTotal          int64      `json:"bytesTotal,omitempty"`
	SavedFiles          []string   `json:"savedFiles,omitempty"`
	ChatState           string     `json:"chatState,omitempty"`
	ChatMessageCount    int        `json:"chatMessageCount,omitempty"`
	ChatDeviceCount     int        `json:"chatDeviceCount,omitempty"`
	ChatLastActivity    string     `json:"chatLastActivity,omitempty"`
	PageURL             string     `json:"pageUrl,omitempty"`
	Error               string     `json:"error,omitempty"`
	StartedAt           time.Time  `json:"startedAt"`
	FinishedAt          *time.Time `json:"finishedAt,omitempty"`
}

type AgentStatus struct {
	State          string       `json:"state"`
	Current        *TaskRecord  `json:"current,omitempty"`
	Chat           *TaskRecord  `json:"chat,omitempty"`
	Queued         int          `json:"queued"`
	History        []TaskRecord `json:"history,omitempty"`
	LastError      string       `json:"lastError,omitempty"`
	Version        string       `json:"version"`
	AgentStartedAt time.Time    `json:"agentStartedAt"`
	ClockTampered    bool         `json:"clockTampered"`
	IsPaid           bool         `json:"isPaid"`
	LicenseTier      string       `json:"licenseTier"`
	MaxDevices       int          `json:"maxDevices"`
	ActivatedDevices int          `json:"activatedDevices"`
}

type DesktopSettings struct {
	ConfigPath       string            `json:"configPath"`
	Interface        string            `json:"interface"`
	InterfaceOptions []InterfaceOption `json:"interfaceOptions"`
	Port             int               `json:"port"`
	Output           string            `json:"output"`
	Browser          bool              `json:"browser"`
	ChatAutoSave     bool              `json:"chatAutoSave"`
	CloseBehavior    string            `json:"closeBehavior"`
	ChatSender       string            `json:"chatSender"`
	ChatAvatar       string            `json:"chatAvatar"`
	DevMode                  bool              `json:"devMode"`
	DebugLog                 bool              `json:"debugLog"`
	ViewportDebug            bool              `json:"viewportDebug"`
	AutoUpdateMode           string            `json:"autoUpdateMode"`
	UpdateChannel            string            `json:"updateChannel"`
	LastUpdateCheckTime      int64             `json:"lastUpdateCheckTime"`
	UpdateCheckIntervalHours int               `json:"updateCheckIntervalHours"`
}

type InterfaceOption struct {
	Name  string `json:"name"`
	IP    string `json:"ip"`
	Label string `json:"label"`
}

type AppInfo struct {
	Product     string `json:"product"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Description string `json:"description"`
	AgentURL    string `json:"agentUrl"`
	OS          string `json:"os"`
	Arch        string `json:"arch"`
	CLIPath     string `json:"cliPath,omitempty"`
	LogPath     string `json:"logPath,omitempty"`
}

type DesktopIntegrationStatus struct {
	Supported   bool   `json:"supported"`
	Enabled     bool   `json:"enabled"`
	NeedsRepair bool   `json:"needsRepair"`
	Detail      string `json:"detail"`
}

var desktopCommandRunner = runDesktopCommand

func NewApp() *App {
	return &App{
		client:        &http.Client{Timeout: 5 * time.Second},
		closeBehavior: "tray",
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.agent = newDesktopAgent(ctx)
	go func() {
		if err := a.agent.loadHistory(); err != nil {
			wailsruntime.LogError(ctx, fmt.Sprintf("[GUI] Failed to load agent history: %v", err))
		}
	}()
}

func (a *App) showWindow() {
	if a.ctx == nil {
		return
	}
	wailsruntime.WindowUnminimise(a.ctx)
	wailsruntime.WindowShow(a.ctx)
}

func (a *App) beforeClose(ctx context.Context) bool {
	if a.consumeForceQuit() || a.currentCloseBehavior() == "quit" {
		return false
	}
	wailsruntime.WindowHide(ctx)
	return true
}

func (a *App) quit() {
	a.mu.Lock()
	a.forceQuit = true
	a.mu.Unlock()

	if a.agent != nil {
		a.agent.mu.Lock()
		if a.agent.activeServer != nil {
			a.agent.activeServer.Shutdown()
		}
		a.agent.mu.Unlock()
	}

	killLingeringProcesses()

	if a.ctx != nil {
		wailsruntime.Quit(a.ctx)
	}
}

func killLingeringProcesses() {
	if isWindows() {
		cmd := exec.Command("taskkill", "/F", "/IM", "eqt.exe", "/IM", "eqt-launcher.exe")
		util.HideCommand(cmd)
		_ = cmd.Run()
	} else {
		cmd := exec.Command("killall", "-9", "eqt")
		util.HideCommand(cmd)
		_ = cmd.Run()
	}
}

func (a *App) consumeForceQuit() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.forceQuit {
		return false
	}
	a.forceQuit = false
	return true
}

func (a *App) currentCloseBehavior() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.closeBehavior
}

func (a *App) setCloseBehavior(value string) {
	if value != "quit" {
		value = "tray"
	}
	a.mu.Lock()
	a.closeBehavior = value
	a.mu.Unlock()
}

func (a *App) emitTrayCommand(command string) {
	if a.ctx == nil {
		return
	}
	wailsruntime.EventsEmit(a.ctx, "eqt:tray-command", command)
}

func (a *App) AgentStatus() (AgentStatus, error) {
	if a.agent == nil {
		return AgentStatus{}, fmt.Errorf("agent not initialized")
	}
	a.agent.mu.Lock()
	defer a.agent.mu.Unlock()
	return a.agent.snapshotLocked(), nil
}

func (a *App) Share(paths []string) (AgentStatus, error) {
	if len(paths) == 0 {
		return AgentStatus{}, fmt.Errorf("choose at least one file or folder")
	}
	if a.agent == nil {
		return AgentStatus{}, fmt.Errorf("agent not initialized")
	}
	return a.agent.pushTask(AgentTask{Action: "share", Paths: paths})
}

func (a *App) Receive(output string) (AgentStatus, error) {
	paths := []string{}
	if output != "" {
		paths = []string{output}
	}
	if a.agent == nil {
		return AgentStatus{}, fmt.Errorf("agent not initialized")
	}
	return a.agent.pushTask(AgentTask{Action: "receive", Paths: paths})
}

func (a *App) Chat() (AgentStatus, error) {
	a.logInfo("[GUI] Chat() called. Submitting chat task to agent.")
	if a.agent == nil {
		return AgentStatus{}, fmt.Errorf("agent not initialized")
	}
	status, err := a.agent.pushTask(AgentTask{Action: "chat"})
	if err != nil {
		a.logError(fmt.Sprintf("[GUI] Chat task failed to start: %v", err))
		return AgentStatus{}, err
	}
	a.logInfo("[GUI] Chat task started successfully.")
	return status, nil
}



func (a *App) ChatSaveDirectory() (string, error) {
	dir, err := currentChatSaveDirectory()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	_ = cleanupOldChatSaveDirectories(chatSaveRetentionDays)
	return dir, nil
}

func (a *App) DownloadChatAttachment(rawURL string, filename string) (string, error) {
	parsed, err := chatAttachmentDownloadURL(rawURL)
	if err != nil {
		return "", err
	}
	dir, err := a.ChatSaveDirectory()
	if err != nil {
		return "", err
	}
	if filename == "" {
		filename = filepath.Base(parsed.Path)
	}
	target, err := uniquePath(dir, safeFilename(filename))
	if err != nil {
		return "", err
	}
	if err := a.downloadChatAttachmentTo(parsed.String(), target); err != nil {
		return "", err
	}
	return target, nil
}

func (a *App) SaveChatAttachmentAs(rawURL string, filename string) (string, error) {
	parsed, err := chatAttachmentDownloadURL(rawURL)
	if err != nil {
		return "", err
	}
	if filename == "" {
		filename = filepath.Base(parsed.Path)
	}
	target, err := wailsruntime.SaveFileDialog(a.ctx, wailsruntime.SaveDialogOptions{
		Title:           "Save attachment as",
		DefaultFilename: safeFilename(filename),
	})
	if err != nil {
		return "", err
	}
	if target == "" {
		return "", nil
	}
	if err := a.downloadChatAttachmentTo(parsed.String(), target); err != nil {
		return "", err
	}
	return target, nil
}

func chatAttachmentDownloadURL(rawURL string) (*url.URL, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("unsupported attachment URL scheme %q", parsed.Scheme)
	}
	query := parsed.Query()
	query.Set("download", "1")
	parsed.RawQuery = query.Encode()
	return parsed, nil
}

func (a *App) downloadChatAttachmentTo(rawURL string, target string) error {
	req, err := http.NewRequestWithContext(a.ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("attachment download returned %s", resp.Status)
	}
	out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, resp.Body)
	closeErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	return nil
}

func (a *App) StopCurrent() error {
	if a.agent == nil {
		return fmt.Errorf("agent not initialized")
	}
	if !a.agent.stopCurrent("stopped") {
		return fmt.Errorf("no task currently running to stop")
	}
	return nil
}

func (a *App) StopChat() error {
	if a.agent == nil {
		return fmt.Errorf("agent not initialized")
	}
	if !a.agent.stopChat("stopped") {
		return fmt.Errorf("no active chat to stop")
	}
	return nil
}

func (a *App) ClearHistory() error {
	if a.agent == nil {
		return fmt.Errorf("agent not initialized")
	}
	return a.agent.clearHistory()
}

func (a *App) RepeatTask(id int) (AgentStatus, error) {
	if id <= 0 {
		return AgentStatus{}, fmt.Errorf("invalid task id")
	}
	if a.agent == nil {
		return AgentStatus{}, fmt.Errorf("agent not initialized")
	}
	return a.agent.repeatTask(id)
}

func (a *App) RestartAgent() error {
	return nil
}

func (a *App) ShutdownAgent() error {
	return nil
}

func (a *App) OpenURL(rawURL string) error {
	return a.openExternal(rawURL, map[string]bool{"http": true, "https": true})
}

func (a *App) OpenExternal(rawURL string) error {
	return a.openExternal(rawURL, map[string]bool{"http": true, "https": true, "mailto": true})
}

func (a *App) openExternal(rawURL string, allowed map[string]bool) error {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return err
	}
	if !allowed[parsed.Scheme] {
		return fmt.Errorf("unsupported URL scheme %q", parsed.Scheme)
	}
	wailsruntime.BrowserOpenURL(a.ctx, rawURL)
	return nil
}

func (a *App) OpenPath(path string) error {
	if path == "" {
		return fmt.Errorf("path is empty")
	}
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	target := path
	if !info.IsDir() {
		target = filepath.Dir(path)
	}
	cmd, err := openPathCommand(target)
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

func (a *App) OpenFile(path string) error {
	if path == "" {
		return fmt.Errorf("path is empty")
	}
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return a.OpenPath(path)
	}
	cmd, err := openFileCommand(path)
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

func (a *App) ReadSettings() (DesktopSettings, error) {
	if a.agent == nil {
		return DesktopSettings{}, fmt.Errorf("agent not initialized")
	}
	settings, err := a.agent.readSettings()
	if err != nil {
		return DesktopSettings{}, err
	}
	a.setCloseBehavior(settings.CloseBehavior)
	return settings, nil
}

func (a *App) SaveSettings(settings DesktopSettings) (DesktopSettings, error) {
	if a.agent == nil {
		return DesktopSettings{}, fmt.Errorf("agent not initialized")
	}
	saved, err := a.agent.writeSettings(settings)
	if err != nil {
		return DesktopSettings{}, err
	}
	a.setCloseBehavior(saved.CloseBehavior)
	return saved, nil
}

func (a *App) RightClickIntegrationStatus() (DesktopIntegrationStatus, error) {
	output, err := a.runEqtDesktopCommand("status")
	if err != nil {
		return DesktopIntegrationStatus{}, err
	}
	return parseDesktopIntegrationStatus(output), nil
}

func (a *App) SetRightClickIntegrationEnabled(enabled bool) (DesktopIntegrationStatus, error) {
	command := "uninstall"
	if enabled {
		command = "install"
	}
	if _, err := a.runEqtDesktopCommand(command); err != nil {
		return DesktopIntegrationStatus{}, err
	}
	return a.RightClickIntegrationStatus()
}

func (a *App) StartupStatus() (DesktopIntegrationStatus, error) {
	output, err := a.runEqtDesktopCommand("startup-status")
	if err != nil {
		return DesktopIntegrationStatus{}, err
	}
	return parseDesktopStartupStatus(output), nil
}

func (a *App) SetStartupEnabled(enabled bool) (DesktopIntegrationStatus, error) {
	command := "startup-disable"
	if enabled {
		command = "startup-enable"
	}
	if _, err := a.runEqtDesktopCommand(command); err != nil {
		return DesktopIntegrationStatus{}, err
	}
	return a.StartupStatus()
}

func (a *App) runEqtDesktopCommand(args ...string) (string, error) {
	cli, err := findEqtCLI()
	if err != nil {
		return "", err
	}
	commandArgs := append([]string{"desktop"}, args...)
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return desktopCommandRunner(ctx, cli, commandArgs...)
}

func (a *App) SelectFiles() ([]string, error) {
	return wailsruntime.OpenMultipleFilesDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "Choose files to share",
	})
}

func (a *App) SelectShareDirectory() (string, error) {
	return wailsruntime.OpenDirectoryDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "Choose folder to share",
	})
}

func (a *App) SelectReceiveDirectory() (string, error) {
	return wailsruntime.OpenDirectoryDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "Choose receive folder",
	})
}

func (a *App) AppInfo() AppInfo {
	info := AppInfo{
		Product:     "EQT",
		Name:        "Easy QR Transfer",
		Version:     version.Version(),
		Description: "Local QR-code file transfer for desktop and mobile devices.",
		AgentURL:    "",
		OS:          runtime.GOOS,
		Arch:        runtime.GOARCH,
		LogPath:     desktopLogFilePath(),
	}
	if cli, err := findEqtCLI(); err == nil {
		info.CLIPath = cli
	}
	return info
}

type GUIUpdateCheckResult struct {
	NewVersionAvailable bool   `json:"new_version_available"`
	Version             string `json:"version"`
	Changelog           string `json:"changelog"`
	AssetURL            string `json:"asset_url"`
	AssetName           string `json:"asset_name"`
	AssetSize           int64  `json:"asset_size"`
	SignatureURL        string `json:"signature_url"`
}

func (a *App) CheckForUpdates() (GUIUpdateCheckResult, error) {
	if a.agent == nil {
		return GUIUpdateCheckResult{}, fmt.Errorf("agent not initialized")
	}
	return a.agent.checkForUpdates()
}

func (a *App) DownloadUpdate(result GUIUpdateCheckResult) (string, error) {
	if a.agent == nil {
		return "", fmt.Errorf("agent not initialized")
	}
	return a.agent.downloadUpdate(result.AssetURL, result.SignatureURL, result.AssetName)
}

func (a *App) InstallUpdate(assetName string) error {
	if a.agent == nil {
		return fmt.Errorf("agent not initialized")
	}
	return a.agent.installUpdate(assetName)
}

func (a *App) SetPaidStatus(paid bool, redeemedAt string, codeDate string, tier string) error {
	a.logInfo(fmt.Sprintf("[GUI] SetPaidStatus called with paid=%v redeemedAt=%s codeDate=%s tier=%s", paid, redeemedAt, codeDate, tier))
	if a.agent == nil {
		return fmt.Errorf("agent not initialized")
	}
	a.agent.setPaidStatus(paid, redeemedAt, codeDate, tier)
	return nil
}

func (a *App) ActivateLicense(code string) error {
	a.logInfo(fmt.Sprintf("[GUI] ActivateLicense called with code=%s", code))
	if a.agent == nil {
		return fmt.Errorf("agent not initialized")
	}
	return a.agent.activateLicense(code)
}

func (a *App) ResetLicense() error {
	a.logInfo("[GUI] ResetLicense called")
	if a.agent == nil {
		return fmt.Errorf("agent not initialized")
	}
	a.agent.resetLicense()
	return nil
}

func findEqtCLI() (string, error) {
	if configured := os.Getenv("EQT_CLI"); configured != "" {
		return configured, nil
	}
	if exe, err := os.Executable(); err == nil {
		name := "eqt"
		if runtime.GOOS == "windows" {
			name = "eqt.exe"
		}
		candidate := filepath.Join(filepath.Dir(exe), name)
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}
	if path, err := exec.LookPath("eqt"); err == nil {
		return path, nil
	}
	return "", fmt.Errorf("eqt CLI was not found; set EQT_CLI or place eqt next to the desktop app")
}

func findEqtLauncher(cli string) (string, bool) {
	if runtime.GOOS != "windows" || cli == "" {
		return "", false
	}
	candidate := filepath.Join(filepath.Dir(cli), "eqt-launcher.exe")
	if _, err := os.Stat(candidate); err == nil {
		return candidate, true
	}
	return "", false
}

func runDesktopCommand(ctx context.Context, cli string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, cli, args...)
	util.HideCommand(cmd)
	output, err := cmd.CombinedOutput()
	text := strings.TrimSpace(string(output))
	if err != nil {
		if text == "" {
			return "", err
		}
		return text, fmt.Errorf("%w: %s", err, text)
	}
	return text, nil
}

func parseDesktopIntegrationStatus(output string) DesktopIntegrationStatus {
	status := DesktopIntegrationStatus{
		Supported: !strings.Contains(output, "not implemented"),
		Detail:    output,
	}
	if !status.Supported {
		return status
	}
	installed, needsRepair, notInstalled, ok := parseDesktopSummary(output)
	if ok {
		status.Enabled = installed > 0 && needsRepair == 0 && notInstalled == 0
		status.NeedsRepair = needsRepair > 0
		return status
	}
	status.Enabled = strings.Contains(output, ": installed") && !strings.Contains(output, ": needs repair") && !strings.Contains(output, ": not installed")
	status.NeedsRepair = strings.Contains(output, ": needs repair")
	return status
}

func parseDesktopStartupStatus(output string) DesktopIntegrationStatus {
	status := DesktopIntegrationStatus{
		Supported: !strings.Contains(output, "not implemented"),
		Detail:    output,
	}
	if !status.Supported {
		return status
	}
	for _, line := range strings.Split(output, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "- Agent startup:") {
			value := strings.TrimSpace(strings.TrimPrefix(trimmed, "- Agent startup:"))
			status.Enabled = value == "enabled"
			status.NeedsRepair = value == "needs repair"
			return status
		}
	}
	status.Enabled = strings.Contains(output, "Agent startup: enabled")
	status.NeedsRepair = strings.Contains(output, "Agent startup: needs repair")
	return status
}

func parseDesktopSummary(output string) (installed int, needsRepair int, notInstalled int, ok bool) {
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "- summary:") {
			continue
		}
		_, err := fmt.Sscanf(line, "- summary: %d installed, %d needs repair, %d not installed", &installed, &needsRepair, &notInstalled)
		return installed, needsRepair, notInstalled, err == nil
	}
	return 0, 0, 0, false
}

func openPathCommand(path string) (*exec.Cmd, error) {
	switch runtime.GOOS {
	case "windows":
		cmd := exec.Command("explorer.exe", path)
		util.HideCommand(cmd)
		return cmd, nil
	case "darwin":
		return exec.Command("open", path), nil
	case "linux":
		return exec.Command("xdg-open", path), nil
	default:
		return nil, fmt.Errorf("opening paths is not supported on %s", runtime.GOOS)
	}
}

func openFileCommand(path string) (*exec.Cmd, error) {
	switch runtime.GOOS {
	case "windows":
		cmd := exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", path)
		util.HideCommand(cmd)
		return cmd, nil
	case "darwin":
		return exec.Command("open", path), nil
	case "linux":
		return exec.Command("xdg-open", path), nil
	default:
		return nil, fmt.Errorf("opening files is not supported on %s", runtime.GOOS)
	}
}

func currentChatSaveDirectory() (string, error) {
	root, err := chatSaveRoot()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, time.Now().Format("2006-01-02")), nil
}

func chatSaveRoot() (string, error) {
	return filepath.Join(os.TempDir(), "EQT Chat"), nil
}

func cleanupOldChatSaveDirectories(retentionDays int) error {
	root, err := chatSaveRoot()
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	cutoff := time.Now().AddDate(0, 0, -retentionDays)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		day, err := time.Parse("2006-01-02", entry.Name())
		if err != nil || !day.Before(cutoff) {
			continue
		}
		_ = os.RemoveAll(filepath.Join(root, entry.Name()))
	}
	return nil
}

func safeFilename(name string) string {
	name = strings.TrimSpace(filepath.Base(name))
	if name == "" || name == "." || name == string(filepath.Separator) {
		return "attachment"
	}
	replacer := strings.NewReplacer("/", "_", `\`, "_", ":", "_", "*", "_", "?", "_", `"`, "_", "<", "_", ">", "_", "|", "_")
	name = replacer.Replace(name)
	if len([]rune(name)) > 160 {
		ext := filepath.Ext(name)
		base := strings.TrimSuffix(name, ext)
		runes := []rune(base)
		limit := 160 - len([]rune(ext))
		if limit < 1 {
			limit = 1
		}
		if len(runes) > limit {
			base = string(runes[:limit])
		}
		name = base + ext
	}
	return name
}

func uniquePath(dir string, name string) (string, error) {
	for index := 0; ; index++ {
		candidate := name
		if index > 0 {
			ext := filepath.Ext(name)
			base := strings.TrimSuffix(name, ext)
			candidate = fmt.Sprintf("%s(%d)%s", base, index, ext)
		}
		path := filepath.Join(dir, candidate)
		if _, err := os.Stat(path); err != nil {
			if os.IsNotExist(err) {
				return path, nil
			}
			return "", err
		}
	}
}

func (a *App) logInfo(message string) {
	if a.logger != nil {
		a.logger.Info(message)
	}
}

func (a *App) logWarning(message string) {
	if a.logger != nil {
		a.logger.Warning(message)
	}
}

func (a *App) logError(message string) {
	if a.logger != nil {
		a.logger.Error(message)
	}
}

func (a *App) logDebug(message string) {
	if a.logger != nil {
		a.logger.Debug(message)
	}
}

func desktopAgentPortFilePath() string {
	dir, err := os.UserCacheDir()
	if err != nil {
		dir = os.TempDir()
	}
	return filepath.Join(dir, "eqt", "agent.port")
}


