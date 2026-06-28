package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"eqt/pkg/application"
	"eqt/pkg/body"
	"eqt/pkg/config"
	"eqt/pkg/logger"
	"eqt/pkg/server"
	"eqt/pkg/version"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const desktopAgentMaxQueue = 16
const desktopAgentMaxHistory = 20
const desktopAgentHistoryFilename = "desktop-agent-history.json"

type desktopAgent struct {
	mu           sync.Mutex
	baseFlags    application.Flags
	log          logger.Logger
	startedAt    time.Time
	busy         bool
	current      *TaskRecord
	chat         *TaskRecord
	queue        []AgentTask
	history      []TaskRecord
	nextID       int
	activeStop   func(string)
	chatStop     func(string)
	lastError    string
	historyPath  string
	notified     map[int]map[string]bool
	activeServer *server.Server
	ctx          context.Context
}

func newDesktopAgent(ctx context.Context) *desktopAgent {
	flags := application.Flags{}
	agent := &desktopAgent{
		baseFlags:   flags,
		log:         logger.New(flags.Quiet),
		startedAt:   time.Now(),
		historyPath: defaultDesktopAgentHistoryPath(),
		notified:    map[int]map[string]bool{},
		ctx:         ctx,
	}
	return agent
}

func defaultDesktopAgentHistoryPath() string {
	return filepath.Join(config.DefaultConfigDir(), desktopAgentHistoryFilename)
}

func (agent *desktopAgent) snapshotLocked() AgentStatus {
	var maxDev int
	var actDev int
	var expiresAt string
	if cert, ok := server.GetLocalLicenseInfo(); ok {
		maxDev = cert.MaxDevices
		actDev = cert.ActivatedDevices
		expiresAt = cert.ExpiresAt
	}

	response := AgentStatus{
		State:            "idle",
		Queued:           len(agent.queue),
		History:          cloneTaskRecords(agent.history),
		LastError:        agent.lastError,
		Version:          version.String(),
		AgentStartedAt:   agent.startedAt,
		ClockTampered:    server.GetClockTamperedStatus(),
		IsPaid:           server.GetPaidStatus(),
		LicenseTier:      server.GetLicenseTier(),
		MaxDevices:       maxDev,
		ActivatedDevices: actDev,
		UsedSeconds:          server.GetUsedSeconds(),
		UsedTransfers:        server.GetUsedTransfers(),
		UsedReceiveTransfers: server.GetUsedReceiveTransfers(),
		LicenseExpiresAt:     expiresAt,
	}
	if agent.busy {
		response.State = "busy"
		if agent.current != nil {
			current := cloneTaskRecord(*agent.current)
			response.Current = &current
		}
	}
	if agent.chat != nil {
		chat := cloneTaskRecord(*agent.chat)
		response.Chat = &chat
		if response.State == "idle" {
			response.State = "chat"
		}
	}
	return response
}

func cloneTaskRecords(records []TaskRecord) []TaskRecord {
	if len(records) == 0 {
		return nil
	}
	cloned := make([]TaskRecord, len(records))
	for index, record := range records {
		cloned[index] = cloneTaskRecord(record)
	}
	return cloned
}

func cloneTaskRecord(record TaskRecord) TaskRecord {
	record.Paths = append([]string(nil), record.Paths...)
	record.SavedFiles = append([]string(nil), record.SavedFiles...)
	record.TransferItemClientStats = append([]string(nil), record.TransferItemClientStats...)
	return record
}

func (agent *desktopAgent) touchLocked() {
	if agent.ctx != nil {
		status := agent.snapshotLocked()
		wailsruntime.EventsEmit(agent.ctx, "agent-status", status)
	}
}

func (agent *desktopAgent) addHistoryLocked(record TaskRecord) {
	record = cloneTaskRecord(record)
	// Force resolve all paths to absolute paths
	for i, p := range record.Paths {
		if !filepath.IsAbs(p) {
			if abs, err := filepath.Abs(p); err == nil {
				record.Paths[i] = abs
			}
		}
	}
	for i, p := range record.SavedFiles {
		if !filepath.IsAbs(p) {
			if abs, err := filepath.Abs(p); err == nil {
				record.SavedFiles[i] = abs
			}
		}
	}

	agent.history = append([]TaskRecord{record}, agent.history...)
	if len(agent.history) > desktopAgentMaxHistory {
		agent.history = agent.history[:desktopAgentMaxHistory]
	}
	if err := saveDesktopAgentHistory(agent.historyPath, agent.history); err != nil {
		agent.lastError = fmt.Sprintf("unable to save desktop agent history: %v", err)
	}
}

func (agent *desktopAgent) loadHistory() error {
	history, err := loadDesktopAgentHistory(agent.historyPath)
	if err != nil {
		return err
	}
	nextID := agent.nextID
	for _, record := range history {
		if record.ID > nextID {
			nextID = record.ID
		}
	}
	if len(history) > desktopAgentMaxHistory {
		history = history[:desktopAgentMaxHistory]
	}
	agent.mu.Lock()
	defer agent.mu.Unlock()
	agent.history = cloneTaskRecords(history)
	agent.nextID = nextID
	agent.touchLocked()
	return nil
}

func (agent *desktopAgent) clearHistory() error {
	agent.mu.Lock()
	agent.history = nil
	agent.lastError = ""
	historyPath := agent.historyPath
	agent.touchLocked()
	agent.mu.Unlock()
	return saveDesktopAgentHistory(historyPath, nil)
}

type desktopAgentHistoryStore struct {
	History []TaskRecord `json:"history"`
}

func loadDesktopAgentHistory(path string) ([]TaskRecord, error) {
	if path == "" {
		return nil, nil
	}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var store desktopAgentHistoryStore
	if err := json.Unmarshal(data, &store); err != nil {
		return nil, err
	}
	// Force resolve all paths loaded from disk to absolute paths
	for i := range store.History {
		for j, p := range store.History[i].Paths {
			if !filepath.IsAbs(p) {
				if abs, err := filepath.Abs(p); err == nil {
					store.History[i].Paths[j] = abs
				}
			}
		}
		for j, p := range store.History[i].SavedFiles {
			if !filepath.IsAbs(p) {
				if abs, err := filepath.Abs(p); err == nil {
					store.History[i].SavedFiles[j] = abs
				}
			}
		}
	}
	return cloneTaskRecords(store.History), nil
}

func saveDesktopAgentHistory(path string, history []TaskRecord) error {
	if path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(desktopAgentHistoryStore{History: cloneTaskRecords(history)}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}

func (agent *desktopAgent) taskIDForAction(action string) int {
	agent.mu.Lock()
	defer agent.mu.Unlock()
	if action == "chat" {
		if agent.chat == nil {
			return 0
		}
		return agent.chat.ID
	}
	if agent.current == nil {
		return 0
	}
	return agent.current.ID
}

func (agent *desktopAgent) settingsApp() application.App {
	settingsApp := application.New()
	settingsApp.Flags = agent.baseFlags
	return settingsApp
}

func (agent *desktopAgent) readSettings() (DesktopSettings, error) {
	s, err := config.ReadDesktopSettings(agent.settingsApp())
	if err != nil {
		return DesktopSettings{}, err
	}
	return convertConfigSettings(s), nil
}

func convertConfigSettings(s config.DesktopSettings) DesktopSettings {
	var opts []InterfaceOption
	for _, opt := range s.InterfaceOptions {
		opts = append(opts, InterfaceOption{
			Name:  opt.Name,
			IP:    opt.IP,
			Label: opt.Label,
		})
	}
	return DesktopSettings{
		ConfigPath:               s.ConfigPath,
		Interface:                s.Interface,
		InterfaceOptions:         opts,
		Port:                     s.Port,
		Output:                   s.Output,
		Browser:                  s.Browser,
		ChatAutoSave:             s.ChatAutoSave,
		CloseBehavior:            s.CloseBehavior,
		ChatSender:               s.ChatSender,
		ChatAvatar:               s.ChatAvatar,
		DevMode:                  s.DevMode,
		DebugLog:                 s.DebugLog,
		ViewportDebug:            s.ViewportDebug,
		AutoUpdateMode:           s.AutoUpdateMode,
		UpdateChannel:            s.UpdateChannel,
		LastUpdateCheckTime:      s.LastUpdateCheckTime,
		UpdateCheckIntervalHours: s.UpdateCheckIntervalHours,
		Lang:                     s.Lang,
	}
}

func convertAppSettings(s DesktopSettings) config.DesktopSettings {
	var opts []config.DesktopInterfaceOption
	for _, opt := range s.InterfaceOptions {
		opts = append(opts, config.DesktopInterfaceOption{
			Name:  opt.Name,
			IP:    opt.IP,
			Label: opt.Label,
		})
	}
	return config.DesktopSettings{
		ConfigPath:               s.ConfigPath,
		Interface:                s.Interface,
		InterfaceOptions:         opts,
		Port:                     s.Port,
		Output:                   s.Output,
		Browser:                  s.Browser,
		ChatAutoSave:             s.ChatAutoSave,
		CloseBehavior:            s.CloseBehavior,
		ChatSender:               s.ChatSender,
		ChatAvatar:               s.ChatAvatar,
		DevMode:                  s.DevMode,
		DebugLog:                 s.DebugLog,
		ViewportDebug:            s.ViewportDebug,
		AutoUpdateMode:           s.AutoUpdateMode,
		UpdateChannel:            s.UpdateChannel,
		LastUpdateCheckTime:      s.LastUpdateCheckTime,
		UpdateCheckIntervalHours: s.UpdateCheckIntervalHours,
		Lang:                     s.Lang,
	}
}

func (agent *desktopAgent) writeSettings(settings DesktopSettings) (DesktopSettings, error) {
	cfgSettings := convertAppSettings(settings)
	saved, err := config.WriteDesktopSettings(agent.settingsApp(), cfgSettings)
	if err != nil {
		return DesktopSettings{}, err
	}
	agent.mu.Lock()
	srv := agent.activeServer
	chatTaskRunning := agent.chat != nil && agent.chat.State == "running"
	agent.mu.Unlock()

	if srv != nil {
		if chatTaskRunning {
			agent.log.Infof("writeSettings: Updating chat host avatar to: %s", settings.ChatAvatar)
			srv.UpdateChatHostAvatar(settings.ChatAvatar)
		}
		agent.log.Infof("writeSettings: Updating server ViewportDebug flag to: %v", settings.ViewportDebug)
		srv.ViewportDebug = settings.ViewportDebug
	}
	return convertConfigSettings(saved), nil
}

func (agent *desktopAgent) handleChatHostRename(newName string) {
	agent.log.Infof("handleChatHostRename: updating persistent chatSender to %q", newName)
	settings, err := agent.readSettings()
	if err != nil {
		agent.log.Errorf("handleChatHostRename: failed to read settings: %v", err)
		return
	}
	settings.ChatSender = newName
	if _, err := agent.writeSettings(settings); err != nil {
		agent.log.Errorf("handleChatHostRename: failed to write settings: %v", err)
	} else {
		agent.log.Infof("handleChatHostRename: settings updated successfully with new chatSender")
	}
}

func (agent *desktopAgent) pushTask(task AgentTask) (AgentStatus, error) {
	// Resolve relative paths to absolute paths immediately
	for i, p := range task.Paths {
		if !filepath.IsAbs(p) {
			if abs, err := filepath.Abs(p); err == nil {
				task.Paths[i] = abs
			}
		}
	}
	if err := validateDesktopAgentTask(task); err != nil {
		return AgentStatus{}, err
	}
	agent.mu.Lock()
	if task.Action == "chat" && agent.chat != nil && agent.chat.State == "running" {
		agent.lastError = ""
		agent.touchLocked()
		status := agent.snapshotLocked()
		agent.mu.Unlock()
		return status, nil
	}
	agent.lastError = ""
	if task.Action == "chat" {
		agent.startChatLocked(task)
	} else {
		if len(agent.queue) >= desktopAgentMaxQueue {
			agent.mu.Unlock()
			return AgentStatus{}, fmt.Errorf("desktop agent queue is full")
		}
		agent.queue = append(agent.queue, task)
		if agent.busy {
			agent.replaceActiveLocked("replaced")
		}
		agent.startNextLocked()
	}
	agent.touchLocked()
	status := agent.snapshotLocked()
	agent.mu.Unlock()
	return status, nil
}

func (agent *desktopAgent) startNextLocked() {
	if agent.busy || len(agent.queue) == 0 {
		return
	}
	task := agent.queue[0]
	agent.queue = agent.queue[1:]
	agent.nextID++
	record := TaskRecord{
		ID:        agent.nextID,
		Action:    task.Action,
		Paths:     append([]string(nil), task.Paths...),
		State:     "running",
		StartedAt: time.Now(),
	}
	agent.busy = true
	agent.current = &record
	agent.notifyRecordLocked(record)
	go agent.execute(task, record.ID)
}

func (agent *desktopAgent) startChatLocked(task AgentTask) {
	agent.nextID++
	record := TaskRecord{
		ID:        agent.nextID,
		Action:    task.Action,
		Paths:     append([]string(nil), task.Paths...),
		State:     "running",
		StartedAt: time.Now(),
	}
	agent.chat = &record
	agent.notifyRecordLocked(record)
	go agent.executeChat(task, record.ID)
}

func (agent *desktopAgent) execute(task AgentTask, id int) {
	err := agent.runTask(task)
	agent.mu.Lock()
	defer agent.mu.Unlock()
	if agent.current != nil && agent.current.ID == id {
		finishedAt := time.Now()
		agent.current.FinishedAt = &finishedAt
		if agent.current.State == "running" {
			if err != nil {
				agent.current.State = "failed"
				agent.current.Error = err.Error()
				agent.lastError = err.Error()
			} else if isTerminalDesktopTransferState(agent.current.TransferState) {
				agent.current.State = agent.current.TransferState
			} else {
				agent.current.State = "completed"
			}
		}
		agent.addHistoryLocked(*agent.current)
		agent.notifyRecordLocked(*agent.current)
		delete(agent.notified, agent.current.ID)
		agent.busy = false
		agent.current = nil
		agent.activeStop = nil
		agent.startNextLocked()
		agent.touchLocked()
	}
}

func (agent *desktopAgent) executeChat(task AgentTask, id int) {
	err := agent.runTask(task)
	agent.mu.Lock()
	defer agent.mu.Unlock()
	if agent.chat != nil && agent.chat.ID == id {
		finishedAt := time.Now()
		agent.chat.FinishedAt = &finishedAt
		if agent.chat.State == "running" {
			if err != nil {
				agent.chat.State = "failed"
				agent.chat.Error = err.Error()
				agent.lastError = err.Error()
			} else {
				agent.chat.State = "completed"
			}
		}
		agent.addHistoryLocked(*agent.chat)
		agent.notifyRecordLocked(*agent.chat)
		delete(agent.notified, agent.chat.ID)
		agent.chat = nil
		agent.chatStop = nil
		agent.touchLocked()
	}
}

func (agent *desktopAgent) stopCurrent(state string) bool {
	agent.mu.Lock()
	defer agent.mu.Unlock()
	if agent.busy {
		agent.replaceActiveLocked(state)
		agent.touchLocked()
		return true
	}
	if agent.chat == nil {
		return false
	}
	agent.replaceChatLocked(state)
	agent.touchLocked()
	return true
}

func (agent *desktopAgent) stopChat(state string) bool {
	agent.mu.Lock()
	defer agent.mu.Unlock()
	if agent.chat == nil {
		return false
	}
	agent.replaceChatLocked(state)
	agent.touchLocked()
	return true
}

func (agent *desktopAgent) repeatTask(id int) (AgentStatus, error) {
	agent.mu.Lock()
	defer agent.mu.Unlock()
	if len(agent.queue) >= desktopAgentMaxQueue {
		return AgentStatus{}, fmt.Errorf("desktop agent queue is full")
	}
	var repeated *AgentTask
	if agent.current != nil && agent.current.ID == id {
		task := AgentTask{Action: agent.current.Action, Paths: append([]string(nil), agent.current.Paths...)}
		repeated = &task
	}
	if repeated == nil && agent.chat != nil && agent.chat.ID == id {
		task := AgentTask{Action: agent.chat.Action, Paths: append([]string(nil), agent.chat.Paths...)}
		repeated = &task
	}
	if repeated == nil {
		for _, record := range agent.history {
			if record.ID == id {
				task := AgentTask{Action: record.Action, Paths: append([]string(nil), record.Paths...)}
				repeated = &task
				break
			}
		}
	}
	if repeated == nil {
		return AgentStatus{}, fmt.Errorf("desktop agent task #%d was not found", id)
	}
	if err := validateDesktopAgentTask(*repeated); err != nil {
		return AgentStatus{}, err
	}
	agent.lastError = ""
	if repeated.Action == "chat" {
		if agent.chat != nil {
			agent.replaceChatLocked("replaced")
		}
		agent.startChatLocked(*repeated)
	} else {
		agent.queue = append(agent.queue, *repeated)
		if agent.busy {
			agent.replaceActiveLocked("replaced")
		}
		agent.startNextLocked()
	}
	agent.touchLocked()
	return agent.snapshotLocked(), nil
}

func (agent *desktopAgent) replaceActiveLocked(state string) {
	if agent.current != nil && agent.current.State == "running" {
		agent.current.State = state
		finishedAt := time.Now()
		agent.current.FinishedAt = &finishedAt
	}
	if agent.activeStop == nil {
		return
	}
	stop := agent.activeStop
	go stop(state)
}

func (agent *desktopAgent) replaceChatLocked(state string) {
	if agent.chat != nil && agent.chat.State == "running" {
		agent.chat.State = state
		finishedAt := time.Now()
		agent.chat.FinishedAt = &finishedAt
	}
	if agent.chatStop == nil {
		return
	}
	stop := agent.chatStop
	go stop(state)
}

func (agent *desktopAgent) finalizeActiveLocked(state string) {
	agent.replaceActiveLocked(state)
	if agent.current == nil {
		return
	}
	record := *agent.current
	agent.addHistoryLocked(record)
	agent.notifyRecordLocked(record)
	delete(agent.notified, record.ID)
	agent.busy = false
	agent.current = nil
	agent.activeStop = nil
}

func (agent *desktopAgent) finalizeChatLocked(state string) {
	agent.replaceChatLocked(state)
	if agent.chat == nil {
		return
	}
	record := *agent.chat
	agent.addHistoryLocked(record)
	agent.notifyRecordLocked(record)
	delete(agent.notified, record.ID)
	agent.chat = nil
	agent.chatStop = nil
}

func (agent *desktopAgent) observeTransferStatus(taskID int, status server.TransferStatusSnapshot) {
	agent.mu.Lock()
	defer agent.mu.Unlock()
	if agent.current == nil || agent.current.ID != taskID {
		return
	}
	agent.current.TransferState = status.State
	agent.current.TransferMessage = status.Message
	agent.current.TransferMode = status.Mode
	agent.current.TransferTarget = status.Target
	agent.current.TransferArchiveName = status.ArchiveName
	agent.current.TransferCurrent = status.Current
	agent.current.TransferPercent = status.Percent
	agent.current.BytesDone = status.BytesDone
	agent.current.BytesTotal = status.BytesTotal
	agent.current.SavedFiles = append([]string(nil), status.SavedFiles...)
	agent.current.TransferItemClientStats = append([]string(nil), status.ItemClientStats...)
	agent.current.TransferDeviceCount = status.TransferDeviceCount
	agent.current.TransferAutoStop = status.AutoStop
	agent.current.TransferClientStates = make(map[string]*server.ClientTransferStateInfo)
	for k, v := range status.ClientStates {
		if v != nil {
			agent.current.TransferClientStates[k] = &server.ClientTransferStateInfo{
				State:      v.State,
				BytesDone:  v.BytesDone,
				BytesTotal: v.BytesTotal,
				Percent:    v.Percent,
				Current:    v.Current,
				Message:    v.Message,
				DeviceName: v.DeviceName,
			}
		}
	}
	if isTerminalDesktopTransferState(status.State) && agent.current.State == "running" {
		agent.current.State = status.State
		finishedAt := time.Now()
		agent.current.FinishedAt = &finishedAt
	}
	agent.notifyTransferStatusLocked(*agent.current)
	if isTerminalDesktopTransferState(agent.current.State) {
		record := *agent.current
		agent.addHistoryLocked(record)
		agent.notifyRecordLocked(record)
		delete(agent.notified, record.ID)
		agent.busy = false
		agent.current = nil
		agent.activeStop = nil
		agent.startNextLocked()
		agent.touchLocked()
		return
	}
	agent.touchLocked()
}

func (agent *desktopAgent) SetAutoStop(enabled bool) {
	agent.mu.Lock()
	srv := agent.activeServer
	agent.mu.Unlock()
	if srv != nil {
		srv.SetAutoStop(enabled)
	}
}

func (agent *desktopAgent) observeChatStatus(taskID int, status server.ChatStatusSnapshot) {
	agent.mu.Lock()
	defer agent.mu.Unlock()
	if agent.chat == nil || agent.chat.ID != taskID {
		return
	}
	agent.chat.ChatState = status.State
	agent.chat.ChatMessageCount = status.MessageCount
	agent.chat.ChatDeviceCount = status.DeviceCount
	if !status.LastActivity.IsZero() {
		agent.chat.ChatLastActivity = status.LastActivity.Format(time.RFC3339)
	}
	if isTerminalDesktopChatState(status.State) && agent.chat.State == "running" {
		agent.chat.State = desktopTaskStateForChatState(status.State)
		finishedAt := time.Now()
		agent.chat.FinishedAt = &finishedAt
		record := *agent.chat
		agent.addHistoryLocked(record)
		agent.notifyRecordLocked(record)
		delete(agent.notified, record.ID)
		agent.chat = nil
		agent.chatStop = nil
		agent.touchLocked()
		return
	}
	agent.touchLocked()
}

func (agent *desktopAgent) notifyRecordLocked(record TaskRecord) {
	title, message := desktopAgentNotification(record)
	if title == "" || message == "" {
		return
	}
	_ = notifyDesktop(title, message)
}

func (agent *desktopAgent) notifyTransferStatusLocked(record TaskRecord) {
	key := record.TransferState
	switch key {
	case "transferring", "completed", "stopped", "failed":
	default:
		return
	}
	if agent.notified[record.ID] == nil {
		agent.notified[record.ID] = map[string]bool{}
	}
	if agent.notified[record.ID][key] {
		return
	}
	title, message := desktopAgentTransferNotification(record)
	if title == "" || message == "" {
		return
	}
	agent.notified[record.ID][key] = true
	_ = notifyDesktop(title, message)
}

func (agent *desktopAgent) runTask(task AgentTask) error {
	taskID := agent.taskIDForAction(task.Action)
	agent.log.Infof("runTask: preparing to execute task %d (action: %q)", taskID, task.Action)
	agentApp := application.New()
	agentApp.Flags = agent.baseFlags
	agentApp.Flags.Browser = false
	if task.Browser != nil {
		agentApp.Flags.Browser = *task.Browser
	}
	if task.Action == "receive" {
		agentApp.Flags.Output = task.Paths[0]
	}
	desktopSettings, err := agent.readSettings()
	if err != nil {
		agent.log.Errorf("runTask: failed to read desktop settings (using defaults): %v", err)
		desktopSettings = DesktopSettings{}
	}
	agent.log.Infof("runTask: creating new qrcp configuration...")
	cfg, err := config.New(agentApp)
	if err != nil {
		agent.log.Errorf("runTask: failed to create qrcp config: %v", err)
		return err
	}
	agent.log.Infof("runTask: instantiating qrcp server...")
	cfg.Lang = desktopSettings.Lang
	srv, err := server.New(&cfg)
	if err != nil {
		agent.log.Errorf("runTask: failed to instantiate server: %v", err)
		return err
	}
	agent.mu.Lock()
	agent.activeServer = srv
	agent.mu.Unlock()
	defer func() {
		agent.mu.Lock()
		if agent.activeServer == srv {
			agent.activeServer = nil
		}
		agent.mu.Unlock()
	}()
	srv.ChatDebug = desktopSettings.DebugLog
	srv.ViewportDebug = desktopSettings.ViewportDebug
	agent.log.Infof("runTask: server instance created. BaseURL=%s", srv.BaseURL)
	srv.SetStatusHook(func(status server.TransferStatusSnapshot) {
		agent.observeTransferStatus(taskID, status)
	})
	srv.SetRepeatRoute("")
	agent.setTaskStop(task.Action, func(state string) {
		agent.log.Infof("runTask: stop callback triggered for action %q (target state: %s)", task.Action, state)
		if task.Action == "chat" {
			srv.ShutdownChat(state)
			return
		}
		srv.Shutdown()
	})
	switch task.Action {
	case "share":
		agent.setTaskPageURL(task.Action, srv.BaseURL+"/qr")
		payload, err := body.FromArgs(task.Paths, agentApp.Flags.Zip)
		if err != nil {
			agent.log.Errorf("runTask (share): failed to create payload from args: %v", err)
			srv.Shutdown()
			return err
		}
		srv.Send(payload)
		if err := serveDesktopTaskQR(srv, srv.SendURL, agentApp.Flags.Browser); err != nil {
			agent.log.Errorf("runTask (share): failed to serve QR: %v", err)
			srv.Shutdown()
			return err
		}
	case "receive":
		agent.setTaskPageURL(task.Action, srv.BaseURL+"/qr")
		if err := srv.ReceiveTo(cfg.Output); err != nil {
			agent.log.Errorf("runTask (receive): failed to prepare receive path: %v", err)
			srv.Shutdown()
			return err
		}
		if err := serveDesktopTaskQR(srv, srv.ReceiveURL, agentApp.Flags.Browser); err != nil {
			agent.log.Errorf("runTask (receive): failed to serve QR: %v", err)
			srv.Shutdown()
			return err
		}
	case "chat":
		chatPageURLBuilder := func() string {
			return desktopChatPageURL(srv.ChatJoinURL(), srv.ChatHostToken(), desktopSettings.ChatSender, desktopSettings.ChatAvatar)
		}
		agent.log.Infof("runTask (chat): chat join URL = %s", srv.ChatJoinURL())
		if agentApp.Flags.Browser {
			agent.log.Infof("runTask (chat): launching chat in browser...")
			if err := srv.DisplayChatWithURL(chatPageURLBuilder); err != nil {
				agent.log.Errorf("runTask (chat): DisplayChatWithURL failed: %v", err)
				srv.Shutdown()
				return err
			}
		} else {
			agent.log.Infof("runTask (chat): starting chat server listener...")
			if err := srv.Chat(); err != nil {
				agent.log.Errorf("runTask (chat): Chat server failed to start: %v", err)
				srv.Shutdown()
				return err
			}
		}
		chatPageURL := chatPageURLBuilder()
		agent.log.Infof("runTask (chat): chat server active. chatPageURL = %s", chatPageURL)
		agent.setTaskPageURL(task.Action, chatPageURL)
		srv.SetChatHostRenameHook(func(newName string) {
			agent.handleChatHostRename(newName)
		})
		srv.SetChatStatusHook(func(status server.ChatStatusSnapshot) {
			agent.observeChatStatus(taskID, status)
		})
	default:
		srv.Shutdown()
		agent.log.Errorf("runTask: unsupported action %q", task.Action)
		return fmt.Errorf("unsupported desktop action %q", task.Action)
	}
	agent.log.Infof("runTask: server Wait loop entered...")
	waitErr := srv.Wait()
	if waitErr != nil {
		agent.log.Errorf("runTask: server Wait exited with error: %v", waitErr)
	} else {
		agent.log.Infof("runTask: server Wait exited normally")
	}
	return waitErr
}

func (agent *desktopAgent) setTaskStop(action string, stop func(string)) {
	agent.mu.Lock()
	defer agent.mu.Unlock()
	if action == "chat" {
		agent.chatStop = stop
	} else {
		agent.activeStop = stop
	}
}

func (agent *desktopAgent) setTaskPageURL(action string, pageURL string) {
	agent.mu.Lock()
	defer agent.mu.Unlock()
	if action == "chat" {
		if agent.chat != nil {
			agent.chat.PageURL = pageURL
		}
	} else {
		if agent.current != nil {
			agent.current.PageURL = pageURL
		}
	}
	agent.touchLocked()
}

func (agent *desktopAgent) checkForUpdates() (GUIUpdateCheckResult, error) {
	res, err := server.CheckForUpdates(true, version.Version())
	if err != nil {
		return GUIUpdateCheckResult{}, err
	}
	return GUIUpdateCheckResult{
		NewVersionAvailable: res.NewVersionAvailable,
		Version:             res.Version,
		Changelog:           res.Changelog,
		AssetURL:            res.AssetURL,
		AssetName:           res.AssetName,
		AssetSize:           res.AssetSize,
		SignatureURL:        res.SignatureURL,
	}, nil
}

func (agent *desktopAgent) downloadUpdate(assetURL, signatureURL, assetName string) (string, error) {
	return server.DownloadUpdate(assetURL, signatureURL, assetName)
}

func (agent *desktopAgent) installUpdate(assetName string) error {
	agent.mu.Lock()
	hasActiveTransfer := false
	if agent.current != nil && agent.current.State != "completed" && agent.current.State != "failed" && agent.current.State != "" {
		hasActiveTransfer = true
	}
	agent.mu.Unlock()

	if hasActiveTransfer {
		return fmt.Errorf("cannot install update during active transfer")
	}

	go func() {
		time.Sleep(500 * time.Millisecond)
		err := server.InstallAndRestart(assetName)
		if err != nil {
			agent.log.Errorf("installUpdate failed to install: %v", err)
		}
	}()
	return nil
}

func (agent *desktopAgent) setPaidStatus(paid bool, redeemedAt, codeDate, tier string) {
	server.SetPaidStatus(paid, redeemedAt, codeDate, tier)
}

func (agent *desktopAgent) activateLicense(code string) error {
	return server.ActivateLicenseOnline(code)
}

func (agent *desktopAgent) resetLicense() {
	server.ResetLicense()
}

func isTerminalDesktopTransferState(state string) bool {
	return state == "completed" || state == "stopped" || state == "failed"
}

func isTerminalDesktopChatState(state string) bool {
	return state == "ended" || state == "stopped" || state == "failed" || state == "replaced"
}

func desktopTaskStateForChatState(state string) string {
	switch state {
	case "ended":
		return "completed"
	case "stopped", "failed", "replaced":
		return state
	default:
		return "running"
	}
}

func validateDesktopAgentTask(task AgentTask) error {
	switch task.Action {
	case "share":
		if len(task.Paths) == 0 {
			return fmt.Errorf("share task requires at least one path")
		}
	case "receive":
		if len(task.Paths) != 1 {
			return fmt.Errorf("receive task requires exactly one directory")
		}
	case "chat":
		if len(task.Paths) != 0 {
			return fmt.Errorf("chat task does not accept paths")
		}
	default:
		return fmt.Errorf("unsupported desktop action %q", task.Action)
	}
	return nil
}

func serveDesktopTaskQR(srv *server.Server, url string, openBrowser bool) error {
	if openBrowser {
		return srv.DisplayQR(url)
	}
	return srv.ServeQR(url)
}

func desktopAgentNotification(record TaskRecord) (string, string) {
	if record.Action == "chat" {
		return "", ""
	}
	action := desktopAgentActionLabel(record.Action)
	target := desktopAgentPathsSummary(record.Paths)
	switch record.State {
	case "running":
		return "eqt transfer ready", fmt.Sprintf("%s ready: %s", action, target)
	case "completed":
		if record.TransferState == "completed" {
			return "", ""
		}
		return "eqt transfer completed", fmt.Sprintf("%s completed: %s", action, target)
	case "failed":
		if record.TransferState == "failed" {
			return "", ""
		}
		if record.Error != "" {
			return "eqt transfer failed", fmt.Sprintf("%s failed: %s", action, record.Error)
		}
		return "eqt transfer failed", fmt.Sprintf("%s failed: %s", action, target)
	case "stopped":
		if record.TransferState == "stopped" {
			return "", ""
		}
		return "eqt transfer stopped", fmt.Sprintf("%s stopped: %s", action, target)
	case "replaced":
		return "eqt transfer replaced", fmt.Sprintf("%s replaced by a newer task: %s", action, target)
	default:
		return "", ""
	}
}

func desktopAgentTransferNotification(record TaskRecord) (string, string) {
	action := desktopAgentActionLabel(record.Action)
	target := desktopAgentPathsSummary(record.Paths)
	if record.TransferCurrent != "" {
		target = record.TransferCurrent
	}
	switch record.TransferState {
	case "transferring":
		return "eqt transfer started", fmt.Sprintf("%s started: %s", action, target)
	case "completed":
		if len(record.SavedFiles) == 1 {
			return "eqt transfer completed", fmt.Sprintf("%s completed: %s", action, record.SavedFiles[0])
		}
		if len(record.SavedFiles) > 1 {
			return "eqt transfer completed", fmt.Sprintf("%s completed: %d files", action, len(record.SavedFiles))
		}
		return "eqt transfer completed", fmt.Sprintf("%s completed: %s", action, target)
	case "stopped":
		return "eqt transfer stopped", fmt.Sprintf("%s stopped: %s", action, target)
	case "failed":
		if record.TransferMessage != "" {
			return "eqt transfer failed", fmt.Sprintf("%s failed: %s", action, record.TransferMessage)
		}
		return "eqt transfer failed", fmt.Sprintf("%s failed: %s", action, target)
	default:
		return "", ""
	}
}

func desktopAgentActionLabel(action string) string {
	switch action {
	case "share":
		return "Share"
	case "receive":
		return "Receive"
	case "chat":
		return "Chat"
	default:
		return action
	}
}

func desktopAgentPathsSummary(paths []string) string {
	switch len(paths) {
	case 0:
		return "no paths"
	case 1:
		return paths[0]
	default:
		return fmt.Sprintf("%d items", len(paths))
	}
}

func desktopChatPageURL(baseURL string, hostToken string, sender string, avatar string) string {
	parsed, err := url.Parse(baseURL)
	if err != nil {
		query := "?peer=desktop&hostToken=" + url.QueryEscape(hostToken)
		if sender = strings.TrimSpace(sender); sender != "" {
			query += "&sender=" + url.QueryEscape(sender)
		}
		if avatar = strings.TrimSpace(avatar); avatar != "" {
			query += "&avatar=" + url.QueryEscape(avatar)
		}
		return baseURL + query
	}
	params := parsed.Query()
	params.Set("peer", "desktop")
	params.Set("hostToken", hostToken)
	if sender = strings.TrimSpace(sender); sender != "" {
		params.Set("sender", sender)
	}
	if avatar = strings.TrimSpace(avatar); avatar != "" {
		params.Set("avatar", avatar)
	}
	parsed.RawQuery = params.Encode()
	return parsed.String()
}



