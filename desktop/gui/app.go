package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const agentBaseURL = "http://127.0.0.1:48176"
const chatSaveRetentionDays = 7

type App struct {
	ctx    context.Context
	client *http.Client
}

type AgentTask struct {
	Action string   `json:"action"`
	Paths  []string `json:"paths"`
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
	ChatLastActivity    string     `json:"chatLastActivity,omitempty"`
	PageURL             string     `json:"pageUrl,omitempty"`
	Error               string     `json:"error,omitempty"`
	StartedAt           time.Time  `json:"startedAt"`
	FinishedAt          *time.Time `json:"finishedAt,omitempty"`
}

type AgentStatus struct {
	State          string       `json:"state"`
	Current        *TaskRecord  `json:"current,omitempty"`
	Queued         int          `json:"queued"`
	History        []TaskRecord `json:"history,omitempty"`
	LastError      string       `json:"lastError,omitempty"`
	Version        string       `json:"version"`
	AgentStartedAt time.Time    `json:"agentStartedAt"`
}

type DesktopSettings struct {
	ConfigPath       string            `json:"configPath"`
	Interface        string            `json:"interface"`
	InterfaceOptions []InterfaceOption `json:"interfaceOptions"`
	Port             int               `json:"port"`
	Output           string            `json:"output"`
	Browser          bool              `json:"browser"`
	ChatAutoSave     bool              `json:"chatAutoSave"`
}

type InterfaceOption struct {
	Name  string `json:"name"`
	IP    string `json:"ip"`
	Label string `json:"label"`
}

type AppInfo struct {
	Product     string `json:"product"`
	Name        string `json:"name"`
	Description string `json:"description"`
	AgentURL    string `json:"agentUrl"`
	OS          string `json:"os"`
	Arch        string `json:"arch"`
	CLIPath     string `json:"cliPath,omitempty"`
}

func NewApp() *App {
	return &App{
		client: &http.Client{Timeout: 5 * time.Second},
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) showWindow() {
	if a.ctx == nil {
		return
	}
	wailsruntime.WindowShow(a.ctx)
}

func (a *App) emitTrayCommand(command string) {
	if a.ctx == nil {
		return
	}
	wailsruntime.EventsEmit(a.ctx, "eqt:tray-command", command)
}

func (a *App) AgentStatus() (AgentStatus, error) {
	if err := a.ensureAgent(); err != nil {
		return AgentStatus{}, err
	}
	var status AgentStatus
	if err := a.getJSON("/status", &status); err != nil {
		return AgentStatus{}, err
	}
	return status, nil
}

func (a *App) Share(paths []string) (AgentStatus, error) {
	if len(paths) == 0 {
		return AgentStatus{}, fmt.Errorf("choose at least one file or folder")
	}
	return a.postTask(AgentTask{Action: "share", Paths: paths})
}

func (a *App) Receive(output string) (AgentStatus, error) {
	paths := []string{}
	if output != "" {
		paths = []string{output}
	}
	return a.postTask(AgentTask{Action: "receive", Paths: paths})
}

func (a *App) Chat() (AgentStatus, error) {
	return a.postTask(AgentTask{Action: "chat"})
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
	if err := a.ensureAgent(); err != nil {
		return err
	}
	return a.postNoBody("/stop-current")
}

func (a *App) ClearHistory() error {
	if err := a.ensureAgent(); err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(a.ctx, http.MethodDelete, agentBaseURL+"/history", nil)
	if err != nil {
		return err
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("desktop agent returned %s", resp.Status)
	}
	return nil
}

func (a *App) RepeatTask(id int) (AgentStatus, error) {
	if id <= 0 {
		return AgentStatus{}, fmt.Errorf("invalid task id")
	}
	if err := a.ensureAgent(); err != nil {
		return AgentStatus{}, err
	}
	var status AgentStatus
	if err := a.postJSON(fmt.Sprintf("/tasks/%d/repeat", id), nil, &status); err != nil {
		return AgentStatus{}, err
	}
	return status, nil
}

func (a *App) RestartAgent() error {
	if err := a.ensureAgent(); err != nil {
		return err
	}
	return a.postNoBody("/restart")
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
	return cmd.Start()
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
	return cmd.Start()
}

func (a *App) ReadSettings() (DesktopSettings, error) {
	if err := a.ensureAgent(); err != nil {
		return DesktopSettings{}, err
	}
	var settings DesktopSettings
	if err := a.getJSON("/settings", &settings); err != nil {
		return DesktopSettings{}, err
	}
	return settings, nil
}

func (a *App) SaveSettings(settings DesktopSettings) (DesktopSettings, error) {
	if err := a.ensureAgent(); err != nil {
		return DesktopSettings{}, err
	}
	var saved DesktopSettings
	if err := a.postJSON("/settings", settings, &saved); err != nil {
		return DesktopSettings{}, err
	}
	return saved, nil
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
		Description: "Local QR-code file transfer for desktop and mobile devices.",
		AgentURL:    agentBaseURL,
		OS:          runtime.GOOS,
		Arch:        runtime.GOARCH,
	}
	if cli, err := findEqrcpCLI(); err == nil {
		info.CLIPath = cli
	}
	return info
}

func (a *App) postTask(task AgentTask) (AgentStatus, error) {
	if err := a.ensureAgent(); err != nil {
		return AgentStatus{}, err
	}
	var status AgentStatus
	if err := a.postJSON("/tasks", task, &status); err != nil {
		return AgentStatus{}, err
	}
	return status, nil
}

func (a *App) ensureAgent() error {
	if a.health() == nil {
		return nil
	}
	cli, err := findEqrcpCLI()
	if err != nil {
		return err
	}
	cmd := exec.Command(cli, "desktop", "agent-start", "-B")
	if launcher, ok := findEqrcpLauncher(cli); ok {
		cmd = exec.Command(launcher, "--eqrcp-exe", cli, "agent-start", "-B")
	}
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start desktop agent: %w", err)
	}
	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("start desktop agent: %w", err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if a.health() == nil {
			return nil
		}
		time.Sleep(150 * time.Millisecond)
	}
	return fmt.Errorf("desktop agent did not become ready")
}

func (a *App) health() error {
	req, err := http.NewRequestWithContext(a.ctx, http.MethodGet, agentBaseURL+"/health", nil)
	if err != nil {
		return err
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("desktop agent health returned %s", resp.Status)
	}
	return nil
}

func (a *App) getJSON(path string, out interface{}) error {
	req, err := http.NewRequestWithContext(a.ctx, http.MethodGet, agentBaseURL+path, nil)
	if err != nil {
		return err
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("desktop agent returned %s", resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (a *App) postJSON(path string, in interface{}, out interface{}) error {
	var body *bytes.Reader
	if in == nil {
		body = bytes.NewReader(nil)
	} else {
		data, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(a.ctx, http.MethodPost, agentBaseURL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("desktop agent returned %s", resp.Status)
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (a *App) postNoBody(path string) error {
	req, err := http.NewRequestWithContext(a.ctx, http.MethodPost, agentBaseURL+path, nil)
	if err != nil {
		return err
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("desktop agent returned %s", resp.Status)
	}
	return nil
}

func findEqrcpCLI() (string, error) {
	if configured := os.Getenv("EQRCP_CLI"); configured != "" {
		return configured, nil
	}
	if exe, err := os.Executable(); err == nil {
		name := "eqrcp"
		if runtime.GOOS == "windows" {
			name = "eqrcp.exe"
		}
		candidate := filepath.Join(filepath.Dir(exe), name)
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}
	if path, err := exec.LookPath("eqrcp"); err == nil {
		return path, nil
	}
	return "", fmt.Errorf("eqrcp CLI was not found; set EQRCP_CLI or place eqrcp next to the desktop app")
}

func findEqrcpLauncher(cli string) (string, bool) {
	if runtime.GOOS != "windows" || cli == "" {
		return "", false
	}
	candidate := filepath.Join(filepath.Dir(cli), "eqrcp-launcher.exe")
	if _, err := os.Stat(candidate); err == nil {
		return candidate, true
	}
	return "", false
}

func openPathCommand(path string) (*exec.Cmd, error) {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("explorer.exe", path), nil
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
		return exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", path), nil
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
