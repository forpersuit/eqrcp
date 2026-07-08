package main

import (
	"bytes"
	"context"
	"encoding/json"
	"eqt/cmd"
	"eqt/pkg/application"
	"eqt/pkg/config"
	"eqt/pkg/server"
	"eqt/pkg/util"
	"eqt/pkg/version"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)
const chatSaveRetentionDays = 7

var (
	cmdInstallDesktopIntegration   = cmd.InstallDesktopIntegration
	cmdUninstallDesktopIntegration = cmd.UninstallDesktopIntegration
	cmdInstallDesktopStartup       = cmd.InstallDesktopStartup
	cmdUninstallDesktopStartup     = cmd.UninstallDesktopStartup
	cmdDesktopStartupStatus        = cmd.DesktopStartupStatus
	cmdDesktopIntegrationStatus    = cmd.DesktopIntegrationStatus
)

type App struct {
	ctx           context.Context
	client        *http.Client
	mu            sync.Mutex
	closeBehavior string
	forceQuit     bool
	logger        *FileLogger
	agent         *desktopAgent
	downloadsMu   sync.Mutex
	downloads     map[string]context.CancelFunc
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
	TransferItemClientStats []string   `json:"itemClientStats,omitempty"`
	TransferDeviceCount int        `json:"transferDeviceCount,omitempty"`
	TransferAutoStop    bool       `json:"transferAutoStop,omitempty"`
	TransferClientStates map[string]*server.ClientTransferStateInfo `json:"clientStates,omitempty"`
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
	State            string       `json:"state"`
	Current          *TaskRecord  `json:"current,omitempty"`
	Chat             *TaskRecord  `json:"chat,omitempty"`
	Queued           int          `json:"queued"`
	History          []TaskRecord `json:"history,omitempty"`
	LastError        string       `json:"lastError,omitempty"`
	Version          string       `json:"version"`
	AgentStartedAt   time.Time    `json:"agentStartedAt"`
	ClockTampered    bool         `json:"clockTampered"`
	IsPaid           bool         `json:"isPaid"`
	LicenseTier      string       `json:"licenseTier"`
	MaxDevices       int          `json:"maxDevices"`
	ActivatedDevices int          `json:"activatedDevices"`
	UsedSeconds          int          `json:"usedSeconds"`
	UsedTransfers        int          `json:"usedTransfers"`
	UsedReceiveTransfers int          `json:"usedReceiveTransfers"`
	LicenseExpiresAt     string       `json:"licenseExpiresAt,omitempty"`
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
	LastSuccessfulVersion    string            `json:"lastSuccessfulVersion"`
	Lang                     string            `json:"lang"`
	ShowHistory              bool              `json:"showHistory"`
	EnableChatV2             bool              `json:"enableChatV2"`
	ChatDownloadDir          string            `json:"chatDownloadDir"`
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
	a.downloads = make(map[string]context.CancelFunc)
	go func() {
		if err := a.agent.loadHistory(); err != nil {
			wailsruntime.LogError(ctx, fmt.Sprintf("[GUI] Failed to load agent history: %v", err))
		}
	}()

	// 启动成功，延迟 5 秒后更新 LastSuccessfulVersion 并清理旧的备份文件
	go func() {
		time.Sleep(5 * time.Second)
		settings, err := a.agent.readSettings()
		if err == nil {
			currentVer := version.Version()
			if settings.LastSuccessfulVersion != currentVer {
				settings.LastSuccessfulVersion = currentVer
				if _, err := a.agent.writeSettings(settings); err != nil {
					wailsruntime.LogError(ctx, fmt.Sprintf("[GUI] Failed to save LastSuccessfulVersion: %v", err))
				} else {
					wailsruntime.LogInfo(ctx, fmt.Sprintf("[GUI] Successfully verified and saved LastSuccessfulVersion to %s", currentVer))
				}
			}
		}
		// 清理旧包
		server.CleanLingeringOldExecutables()
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

	a.downloadsMu.Lock()
	for _, cancel := range a.downloads {
		if cancel != nil {
			cancel()
		}
	}
	a.downloads = nil
	a.downloadsMu.Unlock()

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

func validateSharePathsForFreeTier(paths []string) error {
	var totalFiles int
	var checkPath func(string) error
	checkPath = func(p string) error {
		info, err := os.Stat(p)
		if err != nil {
			return err
		}
		if info.IsDir() {
			entries, err := os.ReadDir(p)
			if err != nil {
				return err
			}
			for _, entry := range entries {
				err := checkPath(filepath.Join(p, entry.Name()))
				if err != nil {
					return err
				}
			}
		} else {
			totalFiles++
			if totalFiles > 5 {
				return fmt.Errorf("文件数量超过免费版限制（单次最多 5 个文件）。购买 Plus 即可解锁无限制传输。 (File count exceeds 5 files limit. Upgrade to Plus to unlock.)")
			}
			if info.Size() > 50*1024*1024 {
				return fmt.Errorf("文件 %s 体积（%d MB）超过免费版限制（单文件最大 50MB）。购买 Plus 即可解锁无限制传输。 (File size exceeds 50MB limit. Upgrade to Plus to unlock.)", info.Name(), info.Size()/(1024*1024))
			}
		}
		return nil
	}

	for _, p := range paths {
		if err := checkPath(p); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) Share(paths []string) (AgentStatus, error) {
	if len(paths) == 0 {
		return AgentStatus{}, fmt.Errorf("choose at least one file or folder")
	}
	if a.agent == nil {
		return AgentStatus{}, fmt.Errorf("agent not initialized")
	}
	isPaid := server.GetPaidStatus()
	usedTransfers := server.GetUsedTransfers()
	if !isPaid && usedTransfers >= 5 {
		if err := validateSharePathsForFreeTier(paths); err != nil {
			return AgentStatus{}, err
		}
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
	var dir string
	settingsApp := application.New()
	settings, err := config.ReadDesktopSettings(settingsApp)
	if err == nil && settings.ChatDownloadDir != "" {
		dir = settings.ChatDownloadDir
	} else {
		d, err := currentChatSaveDirectory()
		if err != nil {
			return "", err
		}
		dir = d
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	_ = cleanupOldChatSaveDirectories(chatSaveRetentionDays)
	return dir, nil
}

func (a *App) DownloadChatAttachment(rawURL string, filename string) (string, error) {
	a.logInfo(fmt.Sprintf("[GUI] DownloadChatAttachment: rawURL=%q, filename=%q", rawURL, filename))
	parsed, err := chatAttachmentDownloadURL(rawURL)
	if err != nil {
		a.logError(fmt.Sprintf("[GUI] DownloadChatAttachment: URL parsing failed: %v", err))
		return "", err
	}
	dir, err := a.ChatSaveDirectory()
	if err != nil {
		a.logError(fmt.Sprintf("[GUI] DownloadChatAttachment: ChatSaveDirectory failed: %v", err))
		return "", err
	}
	if filename == "" {
		filename = filepath.Base(parsed.Path)
	}
	target, err := uniquePath(dir, safeFilename(filename))
	if err != nil {
		a.logError(fmt.Sprintf("[GUI] DownloadChatAttachment: uniquePath failed: %v", err))
		return "", err
	}
	a.logInfo(fmt.Sprintf("[GUI] DownloadChatAttachment: target target path=%q", target))
	if err := a.downloadChatAttachmentTo(parsed.String(), target); err != nil {
		a.logError(fmt.Sprintf("[GUI] DownloadChatAttachment: download failed: %v", err))
		return "", err
	}
	a.logInfo(fmt.Sprintf("[GUI] DownloadChatAttachment: successfully saved attachment to %q", target))
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

type chatDownloadProgressWriter struct {
	ctx       context.Context
	messageID string
	total     int64
	written   int64
}

func (pw *chatDownloadProgressWriter) Write(p []byte) (n int, err error) {
	n = len(p)
	pw.written += int64(n)
	if pw.total > 0 && pw.messageID != "" {
		pct := int(float64(pw.written) / float64(pw.total) * 100)
		wailsruntime.EventsEmit(pw.ctx, "chat-download-progress", map[string]interface{}{
			"messageId": pw.messageID,
			"progress":  pct,
		})
	}
	return n, nil
}

func (a *App) downloadChatAttachmentTo(rawURL string, target string) error {
	parsed, _ := url.Parse(rawURL)
	messageID := ""
	if parsed != nil {
		messageID = parsed.Query().Get("messageId")
	}
	a.logInfo(fmt.Sprintf("[GUI] downloadChatAttachmentTo starting: messageID=%q, rawURL=%q, target=%q", messageID, rawURL, target))

	key := messageID
	if key == "" {
		key = rawURL
	}
	downloadCtx, cancel := context.WithCancel(a.ctx)
	a.downloadsMu.Lock()
	if a.downloads == nil {
		a.downloads = make(map[string]context.CancelFunc)
	}
	a.downloads[key] = cancel
	a.downloadsMu.Unlock()
	defer func() {
		a.downloadsMu.Lock()
		delete(a.downloads, key)
		a.downloadsMu.Unlock()
		cancel()
	}()

	// 优先进行本地直拷贝优化（Link/Copy）
	if messageID != "" && a.agent != nil && a.agent.activeServer != nil {
		if localPath, ok := a.agent.activeServer.GetChatAttachmentPath(messageID); ok && localPath != "" {
			a.logInfo(fmt.Sprintf("[GUI] downloadChatAttachmentTo: local attachment found at path=%q. Attempting quickCopyFile...", localPath))
			err := quickCopyFile(localPath, target)
			if err == nil {
				a.logInfo(fmt.Sprintf("[GUI] downloadChatAttachmentTo: quickCopyFile success! target=%q", target))
				// 发送 100% 进度事件
				wailsruntime.EventsEmit(a.ctx, "chat-download-progress", map[string]interface{}{
					"messageId": messageID,
					"progress":  100,
				})
				// Notify the server about this fast local download to trigger websocket events for other clients
				a.agent.activeServer.NotifyQuickDownload(messageID)
				return nil
			}
			a.logError(fmt.Sprintf("[GUI] downloadChatAttachmentTo: quickCopyFile failed, falling back to HTTP: %v", err))
		} else {
			a.logInfo("[GUI] downloadChatAttachmentTo: local attachment path not registered or empty in activeServer")
		}
	}

	a.logInfo("[GUI] downloadChatAttachmentTo: initiating HTTP stream download...")
	req, err := http.NewRequestWithContext(downloadCtx, http.MethodGet, rawURL, nil)
	if err != nil {
		if messageID != "" {
			wailsruntime.EventsEmit(a.ctx, "chat-download-progress", map[string]interface{}{
				"messageId": messageID,
				"progress":  -1,
			})
		}
		return err
	}
	resp, err := (&http.Client{Timeout: 0}).Do(req)
	if err != nil {
		if messageID != "" {
			wailsruntime.EventsEmit(a.ctx, "chat-download-progress", map[string]interface{}{
				"messageId": messageID,
				"progress":  -1,
			})
		}
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		if messageID != "" {
			wailsruntime.EventsEmit(a.ctx, "chat-download-progress", map[string]interface{}{
				"messageId": messageID,
				"progress":  -1,
			})
		}
		return fmt.Errorf("attachment download returned %s", resp.Status)
	}
	out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		if messageID != "" {
			wailsruntime.EventsEmit(a.ctx, "chat-download-progress", map[string]interface{}{
				"messageId": messageID,
				"progress":  -1,
			})
		}
		return err
	}

	pw := &chatDownloadProgressWriter{
		ctx:       a.ctx,
		messageID: messageID,
		total:     resp.ContentLength,
	}

	_, copyErr := io.Copy(io.MultiWriter(out, pw), resp.Body)
	closeErr := out.Close()
	if copyErr != nil {
		if messageID != "" {
			wailsruntime.EventsEmit(a.ctx, "chat-download-progress", map[string]interface{}{
				"messageId": messageID,
				"progress":  -1,
			})
		}
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	return nil
}

func quickCopyFile(src, dst string) error {
	_ = os.Remove(dst)
	if err := os.Link(src, dst); err == nil {
		return nil
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
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

func (a *App) SetAutoStop(enabled bool) (AgentStatus, error) {
	if a.agent == nil {
		return AgentStatus{}, fmt.Errorf("agent not initialized")
	}
	a.agent.SetAutoStop(enabled)
	return a.AgentStatus()
}

func (a *App) StopChat() error {
	if a.agent == nil {
		return fmt.Errorf("agent not initialized")
	}

	a.downloadsMu.Lock()
	for _, cancel := range a.downloads {
		if cancel != nil {
			cancel()
		}
	}
	a.downloads = make(map[string]context.CancelFunc)
	a.downloadsMu.Unlock()

	if !a.agent.stopChat("stopped") {
		return fmt.Errorf("no active chat to stop")
	}
	return nil
}

func (a *App) CancelChatDownload(messageID string) error {
	a.downloadsMu.Lock()
	defer a.downloadsMu.Unlock()
	if cancel, ok := a.downloads[messageID]; ok && cancel != nil {
		cancel()
		delete(a.downloads, messageID)
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

func convertCrossPlatformPath(path string) string {
	if path == "" {
		return ""
	}
	if runtime.GOOS == "windows" {
		// Convert WSL path /mnt/c/... to C:\...
		re := regexp.MustCompile(`^/mnt/([a-zA-Z])(?:/(.*))?$`)
		if m := re.FindStringSubmatch(path); m != nil {
			drive := strings.ToUpper(m[1])
			rest := m[2]
			if rest == "" {
				return drive + ":\\"
			}
			return drive + ":\\" + strings.ReplaceAll(rest, "/", "\\")
		}
		return filepath.Clean(strings.ReplaceAll(path, "/", "\\"))
	} else {
		// Convert Windows path C:\... to /mnt/c/...
		re := regexp.MustCompile(`^([a-zA-Z]):(?:[\\/](.*))?$`)
		if m := re.FindStringSubmatch(path); m != nil {
			drive := strings.ToLower(m[1])
			rest := m[2]
			if rest == "" {
				return "/mnt/" + drive
			}
			return "/mnt/" + drive + "/" + strings.ReplaceAll(rest, "\\", "/")
		}
	}
	return path
}

func (a *App) OpenPath(path string) error {
	a.logInfo(fmt.Sprintf("[GUI] OpenPath called with raw path: %s", path))
	if path == "" {
		return fmt.Errorf("path is empty")
	}

	path = convertCrossPlatformPath(path)
	a.logInfo(fmt.Sprintf("[GUI] OpenPath translated path: %s", path))

	// Clean and resolve to absolute path if relative
	cleaned := filepath.Clean(path)
	if !filepath.IsAbs(cleaned) {
		if abs, err := filepath.Abs(cleaned); err == nil {
			cleaned = abs
		}
	}

	// Try to create the directory if it doesn't exist yet, to ensure explorer can open it directly
	_ = os.MkdirAll(cleaned, 0755)

	// Determine starting target folder
	target := cleaned
	info, err := os.Stat(target)
	if err != nil || !info.IsDir() {
		target = filepath.Dir(cleaned)
	}

	// Walk up to find the closest existing directory
	for {
		if target == "." || target == "/" || target == "" || len(target) <= 3 { // e.g. "C:\"
			break
		}
		info, err := os.Stat(target)
		if err == nil && info.IsDir() {
			break
		}
		parent := filepath.Dir(target)
		if parent == target {
			break
		}
		target = parent
	}

	// Fallback to current working directory if still not valid
	info, err = os.Stat(target)
	if err != nil || !info.IsDir() {
		if wd, err := os.Getwd(); err == nil {
			target = wd
		}
	}

	a.logInfo(fmt.Sprintf("[GUI] OpenPath resolved target directory: %s", target))
	
	info, err = os.Stat(target)
	if err != nil || !info.IsDir() {
		return fmt.Errorf("directory does not exist: %s", target)
	}

	cmd, err := openPathCommand(target)
	if err != nil {
		a.logError(fmt.Sprintf("[GUI] OpenPath: failed to create command: %v", err))
		return err
	}
	if err := cmd.Start(); err != nil {
		a.logError(fmt.Sprintf("[GUI] OpenPath: failed to start command: %v", err))
		return err
	}
	return cmd.Process.Release()
}

func (a *App) OpenFile(path string) error {
	a.logInfo(fmt.Sprintf("[GUI] OpenFile called with raw path: %s", path))
	if path == "" {
		return fmt.Errorf("path is empty")
	}

	path = convertCrossPlatformPath(path)
	a.logInfo(fmt.Sprintf("[GUI] OpenFile translated path: %s", path))

	// Clean and resolve to absolute path if relative
	cleaned := filepath.Clean(path)
	if !filepath.IsAbs(cleaned) {
		if abs, err := filepath.Abs(cleaned); err == nil {
			cleaned = abs
		}
	}

	info, err := os.Stat(cleaned)
	if err != nil {
		// File does not exist, fall back to opening its closest existing parent directory
		a.logInfo(fmt.Sprintf("[GUI] OpenFile: %s does not exist, falling back to OpenPath", cleaned))
		return a.OpenPath(cleaned)
	}
	if info.IsDir() {
		return a.OpenPath(cleaned)
	}
	a.logInfo(fmt.Sprintf("[GUI] OpenFile resolved target file: %s", cleaned))
	cmd, err := openFileCommand(cleaned)
	if err != nil {
		a.logError(fmt.Sprintf("[GUI] OpenFile: failed to create command: %v", err))
		return err
	}
	if err := cmd.Start(); err != nil {
		a.logError(fmt.Sprintf("[GUI] OpenFile: failed to start command: %v", err))
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
	status, err := cmdDesktopIntegrationStatus()
	if err != nil {
		return DesktopIntegrationStatus{}, err
	}
	output := fmt.Sprintf("%s\n%s", version.String(), status)
	return parseDesktopIntegrationStatus(output), nil
}

func (a *App) SetRightClickIntegrationEnabled(enabled bool) (DesktopIntegrationStatus, error) {
	var err error
	if enabled {
		err = cmdInstallDesktopIntegration()
	} else {
		err = cmdUninstallDesktopIntegration()
	}
	if err != nil {
		return DesktopIntegrationStatus{}, err
	}
	return a.RightClickIntegrationStatus()
}

func (a *App) StartupStatus() (DesktopIntegrationStatus, error) {
	status, err := cmdDesktopStartupStatus()
	if err != nil {
		return DesktopIntegrationStatus{}, err
	}
	output := fmt.Sprintf("%s\n%s", version.String(), status)
	return parseDesktopStartupStatus(output), nil
}

func (a *App) SetStartupEnabled(enabled bool) (DesktopIntegrationStatus, error) {
	var err error
	if enabled {
		err = cmdInstallDesktopStartup()
	} else {
		err = cmdUninstallDesktopStartup()
	}
	if err != nil {
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

type GUIFileInfo struct {
	Path      string `json:"path"`
	Name      string `json:"name"`
	Size      string `json:"size"`
	SizeBytes int64  `json:"sizeBytes"`
}

func (a *App) GetFileInfos(paths []string) ([]GUIFileInfo, error) {
	var result []GUIFileInfo
	for _, p := range paths {
		if p == "" {
			continue
		}
		fi, err := os.Stat(p)
		if err != nil {
			continue
		}
		
		var sizeBytes int64
		if fi.IsDir() {
			_ = filepath.Walk(p, func(_ string, info os.FileInfo, walkErr error) error {
				if walkErr == nil && !info.IsDir() {
					sizeBytes += info.Size()
				}
				return nil
			})
		} else {
			sizeBytes = fi.Size()
		}
		
		var sizeStr string
		if sizeBytes < 1024 {
			sizeStr = fmt.Sprintf("%d B", sizeBytes)
		} else {
			units := []string{"KB", "MB", "GB", "TB"}
			f := float64(sizeBytes)
			idx := 0
			for f >= 1024 && idx < len(units) {
				f /= 1024
				idx++
			}
			sizeStr = fmt.Sprintf("%.1f %s", f, units[idx-1])
		}
		
		result = append(result, GUIFileInfo{
			Path:      p,
			Name:      filepath.Base(p),
			Size:      sizeStr,
			SizeBytes: sizeBytes,
		})
	}
	return result, nil
}

func (a *App) ValidateFreeTier(paths []string) string {
	isPaid := server.GetPaidStatus()
	usedTransfers := server.GetUsedTransfers()
	if !isPaid && usedTransfers >= 5 {
		if err := validateSharePathsForFreeTier(paths); err != nil {
			return err.Error()
		}
	}
	return ""
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

func (a *App) RefreshLicenseStatus() (AgentStatus, error) {
	a.logInfo("[GUI] RefreshLicenseStatus called")
	if a.agent == nil {
		return AgentStatus{}, fmt.Errorf("agent not initialized")
	}
	server.VerifyLocalLicense()
	a.agent.mu.Lock()
	status := a.agent.snapshotLocked()
	a.agent.mu.Unlock()
	return status, nil
}


func (a *App) DevSetUsedSeconds(seconds int) (AgentStatus, error) {
	a.logInfo(fmt.Sprintf("[GUI] DevSetUsedSeconds called with %d", seconds))
	if a.agent == nil {
		return AgentStatus{}, fmt.Errorf("agent not initialized")
	}
	server.SetUsedSeconds(seconds)
	if seconds == 0 {
		server.SetUsedTransfers(0)
		server.SetUsedReceiveTransfers(0)
	} else {
		server.SetUsedTransfers(5)
		server.SetUsedReceiveTransfers(5)
	}
	return a.agent.snapshotLocked(), nil
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

func isWSL() bool {
	if _, err := os.Stat("/proc/sys/fs/binfmt_misc/WSLInterop"); err == nil {
		return true
	}
	if os.Getenv("WSL_DISTRO_NAME") != "" {
		return true
	}
	return false
}

func openPathCommand(path string) (*exec.Cmd, error) {
	switch runtime.GOOS {
	case "windows":
		winPath := filepath.Clean(strings.ReplaceAll(path, "/", "\\"))
		cmd := exec.Command("explorer.exe", winPath)
		return cmd, nil
	case "darwin":
		return exec.Command("open", path), nil
	case "linux":
		if isWSL() {
			out, err := exec.Command("wslpath", "-w", path).Output()
			if err == nil {
				winPath := strings.TrimSpace(string(out))
				if winPath != "" {
					return exec.Command("explorer.exe", winPath), nil
				}
			}
			return exec.Command("explorer.exe", path), nil
		}
		return exec.Command("xdg-open", path), nil
	default:
		return nil, fmt.Errorf("opening paths is not supported on %s", runtime.GOOS)
	}
}

func openFileCommand(path string) (*exec.Cmd, error) {
	switch runtime.GOOS {
	case "windows":
		winPath := filepath.Clean(strings.ReplaceAll(path, "/", "\\"))
		cmd := exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", winPath)
		return cmd, nil
	case "darwin":
		return exec.Command("open", path), nil
	case "linux":
		if isWSL() {
			out, err := exec.Command("wslpath", "-w", path).Output()
			if err == nil {
				winPath := strings.TrimSpace(string(out))
				if winPath != "" {
					return exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", winPath), nil
				}
			}
			return exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", path), nil
		}
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

type FeedbackPayload struct {
	Category    string             `json:"category"`
	Contact     string             `json:"contact"`
	Message     string             `json:"message"`
	Timestamp   string             `json:"timestamp"`
	ImageData   string             `json:"imageData,omitempty"`
	ImageFormat string             `json:"imageFormat,omitempty"`
	ClientInfo  FeedbackClientInfo `json:"clientInfo"`
}

type FeedbackClientInfo struct {
	Version string `json:"version"`
	OS      string `json:"os"`
}

// SubmitFeedback submits feedback to the Cloudflare Worker API.
// It is called by the frontend via Wails bindings to avoid CORS issues and log request details.
func (a *App) SubmitFeedback(category, contact, message, imageData, imageFormat string) (string, error) {
	if a.logger != nil {
		a.logger.Info(fmt.Sprintf("[Feedback] Submitting feedback: category=%s, contact=%s, messageLength=%d, hasImage=%t", category, contact, len(message), imageData != ""))
	}

	payload := FeedbackPayload{
		Category:    category,
		Contact:     contact,
		Message:     message,
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
		ImageData:   imageData,
		ImageFormat: imageFormat,
		ClientInfo: FeedbackClientInfo{
			Version: version.Version(),
			OS:      fmt.Sprintf("%s/%s", runtime.GOOS, runtime.GOARCH),
		},
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		if a.logger != nil {
			a.logger.Error(fmt.Sprintf("[Feedback] Failed to marshal feedback payload: %v", err))
		}
		return "", fmt.Errorf("failed to marshal payload: %w", err)
	}

	req, err := http.NewRequest("POST", "https://feedback.eqt.net.im/goal", bytes.NewBuffer(jsonData))
	if err != nil {
		if a.logger != nil {
			a.logger.Error(fmt.Sprintf("[Feedback] Failed to create HTTP request: %v", err))
		}
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	startTime := time.Now()
	resp, err := a.client.Do(req)
	if err != nil {
		if a.logger != nil {
			a.logger.Error(fmt.Sprintf("[Feedback] HTTP POST request failed after %v: %v", time.Since(startTime), err))
		}
		return "", fmt.Errorf("network request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		if a.logger != nil {
			a.logger.Error(fmt.Sprintf("[Feedback] Server returned status %d after %v. Response: %s", resp.StatusCode, time.Since(startTime), string(respBody)))
		}
		return "", fmt.Errorf("server error (%d): %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Status   string `json:"status"`
		ImageURL string `json:"imageUrl,omitempty"`
	}

	if err := json.Unmarshal(respBody, &result); err != nil {
		if a.logger != nil {
			a.logger.Error(fmt.Sprintf("[Feedback] Failed to unmarshal server response: %v. Raw response: %s", err, string(respBody)))
		}
		return "", fmt.Errorf("invalid server response: %w", err)
	}

	if a.logger != nil {
		a.logger.Info(fmt.Sprintf("[Feedback] Feedback submitted successfully in %v. ImageURL: %s", time.Since(startTime), result.ImageURL))
	}

	return result.ImageURL, nil
}



