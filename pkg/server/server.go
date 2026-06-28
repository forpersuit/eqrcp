package server

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"image/png"
	"io"
	"log"
	"net"
	"net/http"
	urlpkg "net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"eqt/pkg/qr"

	"eqt/pkg/body"
	"eqt/pkg/config"
	"eqt/pkg/pages"
	"eqt/pkg/util"
	"eqt/pkg/version"
	"gopkg.in/cheggaaa/pb.v1"
)

const maxUploadBytes int64 = 10 << 30
const defaultStatusGracePeriod = 15 * time.Second
const maxTransferHistory = 20

type ClientTransferStateInfo struct {
	State      string `json:"state"`
	BytesDone  int64  `json:"bytesDone"`
	BytesTotal int64  `json:"bytesTotal"`
	Percent    int    `json:"percent"`
	Current    string `json:"current,omitempty"`
	Message    string `json:"message"`
	DeviceName string `json:"deviceName,omitempty"`
}

// Server is the server
type Server struct {
	BaseURL string
	// SendURL is the URL used to send the file
	SendURL string
	// ReceiveURL is the URL used to Receive the file
	ReceiveURL string
	// ChatURL is the URL used for a browser chat session
	ChatURL        string
	ChatDebug      bool
	ViewportDebug  bool
	Lang           string
	instance       *http.Server
	mux            *http.ServeMux
	body           body.Body
	outputDir      string
	chatDir        string
	chatSession    *chatSession
	stopChannel    chan bool
	statusMu       sync.Mutex
	status         transferStatus
	history        []transferStatusRecord
	statusGrace    time.Duration
	statusHook     func(TransferStatusSnapshot)
	chatStatusHook func(ChatStatusSnapshot)
	chatHostRenameHook func(string)
	repeatRoute    string
	statusSeq      int64
	statusSubs     map[chan struct{}]struct{}
	// expectParallelRequests is set to true when eqt sends files, in order
	// to support downloading of parallel chunks
	expectParallelRequests bool
	transferCounted        bool
	downloadedItems        map[int]bool
	downloadedItemsMu      sync.Mutex
	downloadedBytes        map[int]int64
	downloadedBytesMu      sync.Mutex
	KeepAlive              bool
	autoStop               bool
	autoStopIgnoredClients map[string]bool
	clientMutex            sync.Mutex
	clientLastSeen         map[string]time.Time
	clientProgress         map[string]map[int]int64
	clientStates           map[string]*ClientTransferStateInfo
	clientStatesMu         sync.Mutex
	expectedBytesMu        sync.Mutex
	expectedBytes          map[int]int64
	registeredRoutes       map[string]bool
	initFirstTransferOnce sync.Once
	isFirstDailyTransfer  bool
}

// SetAutoStop enables or disables automatic server shutdown when all devices finish downloading.
func (s *Server) SetAutoStop(enabled bool) {
	s.statusMu.Lock()
	s.autoStop = enabled
	s.statusMu.Unlock()

	if enabled {
		s.clientMutex.Lock()
		if s.autoStopIgnoredClients == nil {
			s.autoStopIgnoredClients = make(map[string]bool)
		} else {
			for k := range s.autoStopIgnoredClients {
				delete(s.autoStopIgnoredClients, k)
			}
		}

		totalItems := len(s.body.Paths)
		if totalItems > 0 {
			for clientID := range s.clientLastSeen {
				completedForClient := 0
				if progress, ok := s.clientProgress[clientID]; ok {
					for i := 0; i < totalItems; i++ {
						clientBytes := progress[i]
						var size int64
						s.expectedBytesMu.Lock()
						if s.expectedBytes != nil {
							size = s.expectedBytes[i]
						}
						s.expectedBytesMu.Unlock()

						if size <= 0 {
							targetPath := s.body.Paths[i]
							if info, err := os.Stat(targetPath); err == nil {
								size = info.Size()
							}
						}

						if size > 0 && clientBytes >= size {
							completedForClient++
						}
					}
				}
				if completedForClient >= totalItems {
					s.autoStopIgnoredClients[clientID] = true
				}
			}
		}
		s.clientMutex.Unlock()

		// 打开开关意味着在所有设备都传输完成后，关闭服务
		if s.isAllActiveClientsFinished() {
			s.statusMu.Lock()
			s.status.State = "completed"
			s.status.Message = "Transfer completed."
			s.statusMu.Unlock()
			s.recordStatus()
			go s.signalStopAfterStatusGrace()
		}
	} else {
		s.clientMutex.Lock()
		if s.autoStopIgnoredClients != nil {
			for k := range s.autoStopIgnoredClients {
				delete(s.autoStopIgnoredClients, k)
			}
		}
		s.clientMutex.Unlock()
	}
}

type transferStatus struct {
	State               string   `json:"state"`
	Mode                string   `json:"mode,omitempty"`
	Title               string   `json:"title,omitempty"`
	Target              string   `json:"target,omitempty"`
	Archive             bool     `json:"archive,omitempty"`
	ArchiveName         string   `json:"archiveName,omitempty"`
	Items               []string `json:"items,omitempty"`
	DownloadedItems     []int    `json:"downloadedItems,omitempty"`
	ItemClientStats     []string `json:"itemClientStats,omitempty"`
	Current             string   `json:"current,omitempty"`
	Message             string   `json:"message"`
	BytesDone           int64    `json:"bytesDone"`
	BytesTotal          int64    `json:"bytesTotal"`
	Percent             int      `json:"percent"`
	SavedFiles          []string `json:"savedFiles,omitempty"`
	Version             string   `json:"version,omitempty"`
	TransferDeviceCount int      `json:"transferDeviceCount,omitempty"`
	AutoStop            bool     `json:"autoStop,omitempty"`
	ClientStates        map[string]*ClientTransferStateInfo `json:"clientStates,omitempty"`
}

type transferStatusRecord struct {
	State       string    `json:"state"`
	Mode        string    `json:"mode,omitempty"`
	Title       string    `json:"title,omitempty"`
	Target      string    `json:"target,omitempty"`
	Archive     bool      `json:"archive,omitempty"`
	ArchiveName string    `json:"archiveName,omitempty"`
	Items       []string  `json:"items,omitempty"`
	Current     string    `json:"current,omitempty"`
	Message     string    `json:"message"`
	BytesDone   int64     `json:"bytesDone"`
	BytesTotal  int64     `json:"bytesTotal"`
	Percent     int       `json:"percent"`
	SavedFiles  []string  `json:"savedFiles,omitempty"`
	FinishedAt  time.Time `json:"finishedAt"`
}

type serviceStatus struct {
	State   string                 `json:"state"`
	Current transferStatus         `json:"current"`
	History []transferStatusRecord `json:"history,omitempty"`
	Version string                 `json:"version"`
}

type TransferStatusSnapshot struct {
	State       string
	Mode        string
	Title       string
	Target      string
	Archive     bool
	ArchiveName string
	Items       []string
	Current     string
	Message     string
	BytesDone   int64
	BytesTotal  int64
	Percent     int
	SavedFiles  []string
	Version     string
	ItemClientStats []string
	TransferDeviceCount int
	AutoStop            bool
	ClientStates        map[string]*ClientTransferStateInfo
}

// ReceiveTo sets the output directory
func (s *Server) ReceiveTo(dir string) error {
	output, err := filepath.Abs(dir)
	if err != nil {
		return err
	}
	// Check if the output dir exists
	fileinfo, err := os.Stat(output)
	if err != nil {
		return err
	}
	if !fileinfo.IsDir() {
		return fmt.Errorf("%s is not a valid directory", output)
	}
	s.outputDir = output
	s.updateStatus(func(status *transferStatus) {
		status.Mode = "receive"
		status.Title = "Receive files"
		status.Target = output
		status.Message = "Scan to upload files to this folder."
	})
	return nil
}

// Send adds a handler for sending the file
func (s *Server) Send(p body.Body) {
	s.body = p
	s.expectParallelRequests = true
	total := int64(0)
	if info, err := os.Stat(p.Path); err == nil {
		total = info.Size()
	}
	s.updateStatus(func(status *transferStatus) {
		status.Mode = "send"
		status.Title = sendTitle(p.Filename)
		status.Target = p.Filename
		status.Archive = p.Archive
		status.ArchiveName = ""
		status.Items = append([]string(nil), p.Items...)
		if p.Archive {
			status.ArchiveName = p.Filename
			status.Message = "Scan to download this zip archive."
		} else {
			status.Message = "Scan to download this item."
		}
		status.BytesDone = 0
		status.BytesTotal = total
		status.Percent = 0
	})
}

// ServeQR creates handlers for serving the QR code control page.
func (s *Server) ServeQR(url string) error {
	s.SetStatusGracePeriod(defaultStatusGracePeriod)
	const (
		pagePath   = "/qr"
		imagePath  = "/qr/image"
		statusPath = "/qr/status"
		eventsPath = "/qr/events"
		stopPath   = "/qr/stop"
	)
	qrImg, err := qr.RenderImage(url)
	if err != nil {
		return err
	}
	s.mux.HandleFunc(imagePath, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		if err := png.Encode(w, qrImg); err != nil {
			log.Println(err)
		}
	})
	if transferURL, err := urlpkg.Parse(url); err == nil && transferURL.Path != "" {
		s.registerRoute(strings.TrimRight(transferURL.Path, "/")+"/status", s.statusHandler)
	}
	s.registerRoute(statusPath, s.statusHandler)
	s.mux.HandleFunc(eventsPath, func(w http.ResponseWriter, r *http.Request) {
		s.handleStatusEvents(w, r)
	})
	s.mux.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(s.getServiceStatus()); err != nil {
			log.Println(err)
		}
	})
	s.mux.HandleFunc(stopPath, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		s.setStatus("stopped", "Transfer stopped.")
		s.recordStatus()
		fmt.Fprintln(w, "Transfer stopped. You can close this page.")
		s.signalStop()
	})
	s.mux.HandleFunc(pagePath, func(w http.ResponseWriter, r *http.Request) {
		s.statusMu.Lock()
		repeatRoute := s.repeatRoute
		s.statusMu.Unlock()
		agentStatusRoute, agentTaskID, hasAgentStatus := agentStatusFromRepeatRoute(repeatRoute)
		htmlVariables := struct {
			URL              string
			NetworkHost      string
			QRImageRoute     string
			StatusRoute      string
			EventsRoute      string
			StopRoute        string
			RepeatRoute      string
			AgentStatusRoute string
			AgentTaskID      string
			HasAgentStatus   bool
			Version          string
		}{
			URL:              url,
			NetworkHost:      transferHost(url),
			QRImageRoute:     imagePath,
			StatusRoute:      statusPath,
			EventsRoute:      eventsPath,
			StopRoute:        stopPath,
			RepeatRoute:      repeatRoute,
			AgentStatusRoute: agentStatusRoute,
			AgentTaskID:      agentTaskID,
			HasAgentStatus:   hasAgentStatus,
			Version:          version.String(),
		}
		if err := serveTemplate("qr", pages.QR, w, htmlVariables); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			log.Printf("Template error: %v\n", err)
			s.signalStop()
			return
		}
	})
	return nil
}

// DisplayQR serves the QR control page and opens it in the browser.
func (s *Server) DisplayQR(url string) error {
	if err := s.ServeQR(url); err != nil {
		return err
	}
	return openBrowser(s.BaseURL + "/qr")
}

func (s *Server) SetStatusGracePeriod(duration time.Duration) {
	s.statusMu.Lock()
	defer s.statusMu.Unlock()
	s.statusGrace = duration
}

func (s *Server) SetStatusHook(hook func(TransferStatusSnapshot)) {
	s.statusMu.Lock()
	s.statusHook = hook
	status := cloneTransferStatus(s.status)
	s.statusMu.Unlock()
	if hook != nil {
		hook(snapshotTransferStatus(status))
	}
}

// SetChatStatusHook sets a callback for chat session status updates.
func (s *Server) SetChatStatusHook(hook func(ChatStatusSnapshot)) {
	s.statusMu.Lock()
	s.chatStatusHook = hook
	s.statusMu.Unlock()
}

func (s *Server) SetChatHostRenameHook(hook func(string)) {
	s.statusMu.Lock()
	defer s.statusMu.Unlock()
	s.chatHostRenameHook = hook
	if s.chatSession != nil {
		s.chatSession.hostRenameHook = hook
	}
}

func (s *Server) UpdateChatHostAvatar(avatar string) {
	s.statusMu.Lock()
	session := s.chatSession
	s.statusMu.Unlock()

	if session != nil {
		session.updateHostAvatar(session.hostToken, avatar)
	}
}

func (s *Server) SetRepeatRoute(route string) {
	s.statusMu.Lock()
	defer s.statusMu.Unlock()
	s.repeatRoute = route
}

func (s *Server) setStatus(state string, message string) {
	s.statusMu.Lock()
	s.status.State = state
	s.status.Message = message
	if state == "completed" {
		s.status.BytesDone = s.status.BytesTotal
		s.status.Percent = 100
	}
	s.statusSeq++
	status := cloneTransferStatus(s.status)
	hook := s.statusHook
	s.notifyStatusSubscribersLocked()
	s.statusMu.Unlock()
	notifyTransferStatusHook(hook, status)
}

func (s *Server) getStatus() transferStatus {
	s.statusMu.Lock()
	status := cloneTransferStatus(s.status)
	s.statusMu.Unlock()

	status.ItemClientStats = s.getItemClientStats()
	status.TransferDeviceCount = s.getConnectedDevicesCount()
	status.ClientStates = s.copyClientStates()
	return status
}

func (s *Server) getStatusWithSeq() (transferStatus, int64) {
	s.statusMu.Lock()
	status := cloneTransferStatus(s.status)
	seq := s.statusSeq
	s.statusMu.Unlock()

	status.ItemClientStats = s.getItemClientStats()
	status.TransferDeviceCount = s.getConnectedDevicesCount()
	status.ClientStates = s.copyClientStates()
	return status, seq
}

func (s *Server) getItemClientStats() []string {
	s.clientMutex.Lock()
	defer s.clientMutex.Unlock()

	if s.body.Paths == nil {
		return nil
	}
	totalItems := len(s.body.Paths)
	if totalItems == 0 {
		return nil
	}

	stats := make([]string, totalItems)
	now := time.Now()
	for i := 0; i < totalItems; i++ {
		finishedCount := 0
		deviceCount := 0
		targetPath := s.body.Paths[i]

		for clientID, lastSeen := range s.clientLastSeen {
			if now.Sub(lastSeen) > 6*time.Second {
				continue
			}
			deviceCount++
			progress, ok := s.clientProgress[clientID]
			if ok {
				clientBytes := progress[i]
				var size int64
				s.expectedBytesMu.Lock()
				if s.expectedBytes != nil {
					size = s.expectedBytes[i]
				}
				s.expectedBytesMu.Unlock()

				if size <= 0 {
					if info, err := os.Stat(targetPath); err == nil {
						size = info.Size()
					}
				}

				if size > 0 && clientBytes >= size {
					finishedCount++
				}
			}
		}
		stats[i] = fmt.Sprintf("%d/%d", finishedCount, deviceCount)
	}
	return stats
}

func (s *Server) getConnectedDevicesCount() int {
	s.clientMutex.Lock()
	defer s.clientMutex.Unlock()

	count := 0
	now := time.Now()
	for _, lastSeen := range s.clientLastSeen {
		if now.Sub(lastSeen) <= 8*time.Second {
			count++
		}
	}
	return count
}

func (s *Server) initFirstTransferFlag() {
	s.initFirstTransferOnce.Do(func() {
		s.isFirstDailyTransfer = (GetUsedTransfers() == 0)
	})
}

func (s *Server) isClientLimitExceeded(clientID string) bool {
	if limiterInstance.GetStatus().IsPaid {
		return false
	}
	s.initFirstTransferFlag()
	if s.isFirstDailyTransfer {
		return false
	}
	if clientID == "" {
		return false
	}

	s.clientMutex.Lock()
	defer s.clientMutex.Unlock()

	now := time.Now()
	if lastSeen, ok := s.clientLastSeen[clientID]; ok && now.Sub(lastSeen) <= 8*time.Second {
		return false
	}

	activeCount := 0
	for cid, lastSeen := range s.clientLastSeen {
		if cid != clientID && now.Sub(lastSeen) <= 8*time.Second {
			activeCount++
		}
	}

	return activeCount >= 2
}

func (s *Server) isReceiveClientLimitExceeded(clientID string) bool {
	usage := limiterInstance.GetStatus()
	if usage.IsPaid {
		return false
	}
	if clientID == "" {
		return false
	}

	s.clientMutex.Lock()
	defer s.clientMutex.Unlock()

	now := time.Now()
	if lastSeen, ok := s.clientLastSeen[clientID]; ok && now.Sub(lastSeen) <= 8*time.Second {
		return false
	}

	activeCount := 0
	for cid, lastSeen := range s.clientLastSeen {
		if cid != clientID && now.Sub(lastSeen) <= 8*time.Second {
			activeCount++
		}
	}

	quotaExceeded := usage.UsedReceiveTransfers >= 5

	if quotaExceeded {
		return activeCount >= 1
	}

	return activeCount >= 2
}

func (s *Server) terminalStatus() (transferStatus, bool) {
	status := s.getStatus()
	return status, isTerminalTransferState(status.State)
}

func isTerminalTransferState(state string) bool {
	return state == "completed" || state == "stopped" || state == "failed"
}

func writeTerminalTransfer(w http.ResponseWriter, status transferStatus) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusGone)
	switch status.State {
	case "stopped":
		fmt.Fprintln(w, "This transfer was stopped. Start a new eqt transfer to continue.")
	case "failed":
		fmt.Fprintln(w, "This transfer failed. Start a new eqt transfer to continue.")
	default:
		fmt.Fprintln(w, "This one-time transfer has already completed. Start a new eqt transfer to continue.")
	}
}

func interruptedTransferError(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, io.ErrUnexpectedEOF)
}

func (s *Server) handleStatusEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	clientID := s.registerClientActivity(r, w)
	lastSeq := int64(-1)
	send := func() bool {
		status, seq := s.getStatusWithSeq()
		if seq == lastSeq {
			return true
		}
		lastSeq = seq

		status.DownloadedItems = s.getClientDownloadedItems(clientID)
		if !isTerminalTransferState(status.State) {
			cState := s.getClientStatus(clientID)
			if cState.State != "waiting" {
				status.State = cState.State
				status.BytesDone = cState.BytesDone
				status.BytesTotal = cState.BytesTotal
				status.Percent = cState.Percent
				status.Current = cState.Current
				status.Message = cState.Message
			} else {
				if s.isClientFinished(clientID) {
					status.State = "completed"
					status.BytesDone = status.BytesTotal
					status.Percent = 100
					status.Message = "Transfer completed."
				} else {
					status.State = "waiting"
					status.BytesDone = 0
					status.Percent = 0
					status.Message = "Waiting for transfer to start."
				}
			}
		}

		if s.isClientLimitExceeded(clientID) {
			status.State = "limit_exceeded"
			status.Message = "Device limit exceeded."
		}

		if _, err := fmt.Fprint(w, "data: "); err != nil {
			return false
		}
		if err := json.NewEncoder(w).Encode(status); err != nil {
			return false
		}
		if _, err := fmt.Fprint(w, "\n"); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}
	if !send() {
		return
	}
	events, unsubscribe := s.subscribeStatusEvents()
	defer unsubscribe()
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-events:
			if !send() {
				return
			}
		case <-heartbeat.C:
			if _, err := fmt.Fprint(w, ": keep-alive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (s *Server) subscribeStatusEvents() (<-chan struct{}, func()) {
	ch := make(chan struct{}, 1)
	s.statusMu.Lock()
	if s.statusSubs == nil {
		s.statusSubs = map[chan struct{}]struct{}{}
	}
	s.statusSubs[ch] = struct{}{}
	s.statusMu.Unlock()
	return ch, func() {
		s.statusMu.Lock()
		delete(s.statusSubs, ch)
		close(ch)
		s.statusMu.Unlock()
	}
}

func (s *Server) notifyStatusSubscribersLocked() {
	for ch := range s.statusSubs {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func (s *Server) getServiceStatus() serviceStatus {
	s.statusMu.Lock()
	defer s.statusMu.Unlock()
	return serviceStatus{
		State:   s.status.State,
		Current: cloneTransferStatus(s.status),
		History: append([]transferStatusRecord(nil), s.history...),
		Version: version.String(),
	}
}

func (s *Server) updateStatus(update func(*transferStatus)) {
	s.statusMu.Lock()
	update(&s.status)

	// 动态计算基于活跃客户端的全局进度
	activeClients := s.getActiveClients()
	if len(activeClients) > 0 {
		var totalBytesDone int64
		var totalBytesTotal int64
		for _, cid := range activeClients {
			done, tot := s.getClientDownloadedAndTotal(cid)
			totalBytesDone += done
			totalBytesTotal += tot
		}
		if totalBytesTotal > 0 {
			s.status.BytesDone = totalBytesDone
			s.status.BytesTotal = totalBytesTotal
		}
	}

	s.status.Percent = transferPercent(s.status.BytesDone, s.status.BytesTotal)
	s.status.ItemClientStats = s.getItemClientStats()
	s.status.TransferDeviceCount = s.getConnectedDevicesCount()
	s.status.AutoStop = s.autoStop
	s.statusSeq++
	status := cloneTransferStatus(s.status)
	hook := s.statusHook
	s.notifyStatusSubscribersLocked()
	s.statusMu.Unlock()
	notifyTransferStatusHook(hook, status)
}

func (s *Server) recordStatus() {
	s.statusMu.Lock()
	defer s.statusMu.Unlock()
	record := transferStatusRecord{
		State:       s.status.State,
		Mode:        s.status.Mode,
		Title:       s.status.Title,
		Target:      s.status.Target,
		Archive:     s.status.Archive,
		ArchiveName: s.status.ArchiveName,
		Items:       append([]string(nil), s.status.Items...),
		Current:     s.status.Current,
		Message:     s.status.Message,
		BytesDone:   s.status.BytesDone,
		BytesTotal:  s.status.BytesTotal,
		Percent:     s.status.Percent,
		SavedFiles:  append([]string(nil), s.status.SavedFiles...),
		FinishedAt:  time.Now(),
	}
	s.history = append([]transferStatusRecord{record}, s.history...)
	if len(s.history) > maxTransferHistory {
		s.history = s.history[:maxTransferHistory]
	}
}

func cloneTransferStatus(status transferStatus) transferStatus {
	status.SavedFiles = append([]string(nil), status.SavedFiles...)
	status.Items = append([]string(nil), status.Items...)
	status.DownloadedItems = append([]int(nil), status.DownloadedItems...)
	status.ItemClientStats = append([]string(nil), status.ItemClientStats...)
	status.Version = version.String()
	if status.ClientStates != nil {
		m := make(map[string]*ClientTransferStateInfo)
		for k, v := range status.ClientStates {
			if v != nil {
				m[k] = &ClientTransferStateInfo{
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
		status.ClientStates = m
	}
	return status
}

func snapshotTransferStatus(status transferStatus) TransferStatusSnapshot {
	var clientStates map[string]*ClientTransferStateInfo
	if status.ClientStates != nil {
		clientStates = make(map[string]*ClientTransferStateInfo)
		for k, v := range status.ClientStates {
			if v != nil {
				clientStates[k] = &ClientTransferStateInfo{
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
	}
	return TransferStatusSnapshot{
		State:               status.State,
		Mode:                status.Mode,
		Title:               status.Title,
		Target:              status.Target,
		Archive:             status.Archive,
		ArchiveName:         status.ArchiveName,
		Items:               append([]string(nil), status.Items...),
		Current:             status.Current,
		Message:             status.Message,
		BytesDone:           status.BytesDone,
		BytesTotal:          status.BytesTotal,
		Percent:             status.Percent,
		SavedFiles:          append([]string(nil), status.SavedFiles...),
		Version:             status.Version,
		ItemClientStats:     append([]string(nil), status.ItemClientStats...),
		TransferDeviceCount: status.TransferDeviceCount,
		AutoStop:            status.AutoStop,
		ClientStates:        clientStates,
	}
}

func notifyTransferStatusHook(hook func(TransferStatusSnapshot), status transferStatus) {
	if hook == nil {
		return
	}
	hook(snapshotTransferStatus(status))
}

func (s *Server) signalStopAfterStatusGrace() {
	s.statusMu.Lock()
	delay := s.statusGrace
	state := s.status.State
	s.statusMu.Unlock()
	if delay > 0 && state == "completed" {
		time.Sleep(delay)
	}
	s.signalStop()
}

func (s *Server) markItemDownloaded(index int) bool {
	s.downloadedItemsMu.Lock()
	if s.downloadedItems == nil {
		s.downloadedItems = make(map[int]bool)
	}
	total := len(s.body.Paths)
	if index == -1 {
		for idx := 0; idx < total; idx++ {
			s.downloadedItems[idx] = true
		}
	} else {
		s.downloadedItems[index] = true
	}
	count := len(s.downloadedItems)

	// Collect currently downloaded items indices
	var items []int
	for idx, val := range s.downloadedItems {
		if val {
			items = append(items, idx)
		}
	}
	s.downloadedItemsMu.Unlock()

	s.updateStatus(func(status *transferStatus) {
		status.DownloadedItems = items
	})

	s.clientMutex.Lock()
	totalClients := len(s.clientLastSeen)
	s.clientMutex.Unlock()

	if totalClients == 0 {
		return count >= total
	}

	return s.isAllActiveClientsFinished()
}

func (s *Server) isAllActiveClientsFinished() bool {
	s.clientMutex.Lock()
	defer s.clientMutex.Unlock()

	totalClients := 0
	for clientID := range s.clientLastSeen {
		if s.autoStop && s.autoStopIgnoredClients[clientID] {
			continue
		}
		totalClients++
	}
	if totalClients == 0 {
		return false
	}

	totalItems := len(s.body.Paths)
	if totalItems == 0 {
		return true
	}

	now := time.Now()
	activeCount := 0
	finishedActiveCount := 0
	finishedTotalCount := 0

	for clientID, lastSeen := range s.clientLastSeen {
		if s.autoStop && s.autoStopIgnoredClients[clientID] {
			continue
		}
		isActive := now.Sub(lastSeen) <= 8*time.Second
		if isActive {
			activeCount++
		}

		completedForClient := 0
		if progress, ok := s.clientProgress[clientID]; ok {
			for i := 0; i < totalItems; i++ {
				clientBytes := progress[i]
				var size int64
				s.expectedBytesMu.Lock()
				if s.expectedBytes != nil {
					size = s.expectedBytes[i]
				}
				s.expectedBytesMu.Unlock()

				if size <= 0 {
					targetPath := s.body.Paths[i]
					if info, err := os.Stat(targetPath); err == nil {
						size = info.Size()
					}
				}

				if size > 0 && clientBytes >= size {
					completedForClient++
				}
			}
		}

		if completedForClient >= totalItems {
			finishedTotalCount++
			if isActive {
				finishedActiveCount++
			}
		}
	}

	// Case 1: All ever-connected clients have completed their downloads.
	if finishedTotalCount == totalClients {
		return true
	}

	// Case 2: There are active clients, and all of them have completed their downloads.
	if activeCount > 0 && finishedActiveCount == activeCount {
		return true
	}

	return false
}

func (s *Server) registerClientActivity(r *http.Request, w http.ResponseWriter) string {
	clientID := s.getClientID(r, w)
	if s.isClientLimitExceeded(clientID) {
		return clientID
	}
	s.clientMutex.Lock()
	if s.clientLastSeen == nil {
		s.clientLastSeen = make(map[string]time.Time)
	}
	_, existed := s.clientLastSeen[clientID]
	s.clientLastSeen[clientID] = time.Now()
	s.clientMutex.Unlock()

	if !existed {
		s.updateStatus(func(status *transferStatus) {})
	}
	return clientID
}

func (s *Server) getClientID(r *http.Request, w http.ResponseWriter) string {
	if qID := r.URL.Query().Get("client_id"); qID != "" {
		http.SetCookie(w, &http.Cookie{
			Name:     "eqt_client_id",
			Value:    qID,
			Path:     "/",
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			MaxAge:   3600,
		})
		return qID
	}
	cookie, err := r.Cookie("eqt_client_id")
	if err == nil && cookie.Value != "" {
		return cookie.Value
	}
	randStr, randErr := util.GetRandomURLPath()
	var suffix string
	if randErr == nil {
		suffix = randStr
	} else {
		suffix = "fallback"
	}
	newID := fmt.Sprintf("cli_%d_%s", time.Now().UnixNano(), suffix)
	http.SetCookie(w, &http.Cookie{
		Name:     "eqt_client_id",
		Value:    newID,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   3600,
	})
	return newID
}

func parseDeviceName(ua string) string {
	if strings.Contains(ua, "iPhone") {
		return "iPhone"
	}
	if strings.Contains(ua, "iPad") {
		return "iPad"
	}
	if strings.Contains(ua, "Android") {
		return "Android"
	}
	if strings.Contains(ua, "Macintosh") {
		return "Mac"
	}
	if strings.Contains(ua, "Windows") {
		return "Windows"
	}
	if strings.Contains(ua, "Linux") {
		return "Linux"
	}
	return "Mobile Device"
}

func (s *Server) updateClientStatus(clientID string, r *http.Request, update func(*ClientTransferStateInfo)) {
	s.clientStatesMu.Lock()
	defer s.clientStatesMu.Unlock()

	state, ok := s.clientStates[clientID]
	if !ok {
		state = &ClientTransferStateInfo{
			State:   "waiting",
			Message: "Waiting for transfer to start.",
		}
		s.clientStates[clientID] = state
	}
	if state.DeviceName == "" && r != nil {
		ua := r.Header.Get("User-Agent")
		devType := parseDeviceName(ua)
		suffix := ""
		if len(clientID) > 4 {
			suffix = " (" + clientID[len(clientID)-4:] + ")"
		}
		state.DeviceName = devType + suffix
	}
	update(state)
}

func (s *Server) getClientStatus(clientID string) ClientTransferStateInfo {
	s.clientStatesMu.Lock()
	defer s.clientStatesMu.Unlock()

	state, ok := s.clientStates[clientID]
	if !ok {
		return ClientTransferStateInfo{
			State:   "waiting",
			Message: "Waiting for transfer to start.",
		}
	}
	return *state
}

func (s *Server) copyClientStates() map[string]*ClientTransferStateInfo {
	s.clientStatesMu.Lock()
	defer s.clientStatesMu.Unlock()

	if len(s.clientStates) == 0 {
		return nil
	}
	m := make(map[string]*ClientTransferStateInfo)
	for k, v := range s.clientStates {
		if v != nil {
			m[k] = &ClientTransferStateInfo{
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
	return m
}

func (s *Server) addClientDownloadedBytes(clientID string, itemIndex int, written int64) {
	s.clientMutex.Lock()
	defer s.clientMutex.Unlock()
	if s.clientProgress == nil {
		s.clientProgress = make(map[string]map[int]int64)
	}
	if s.clientProgress[clientID] == nil {
		s.clientProgress[clientID] = make(map[int]int64)
	}
	s.clientProgress[clientID][itemIndex] += written
}

func (s *Server) resetClientDownloadedBytes(clientID string, itemIndex int) {
	s.clientMutex.Lock()
	defer s.clientMutex.Unlock()
	if s.clientProgress == nil {
		s.clientProgress = make(map[string]map[int]int64)
	}
	if s.clientProgress[clientID] == nil {
		s.clientProgress[clientID] = make(map[int]int64)
	}
	s.clientProgress[clientID][itemIndex] = 0
}

func (s *Server) isClientFinished(clientID string) bool {
	s.clientMutex.Lock()
	defer s.clientMutex.Unlock()

	if s.body.Paths == nil {
		return false
	}
	totalItems := len(s.body.Paths)
	if totalItems == 0 {
		return false
	}

	progress, ok := s.clientProgress[clientID]
	if !ok {
		return false
	}

	completedForClient := 0
	for i := 0; i < totalItems; i++ {
		clientBytes := progress[i]
		var size int64
		s.expectedBytesMu.Lock()
		if s.expectedBytes != nil {
			size = s.expectedBytes[i]
		}
		s.expectedBytesMu.Unlock()

		if size <= 0 {
			targetPath := s.body.Paths[i]
			if info, err := os.Stat(targetPath); err == nil {
				size = info.Size()
			}
		}

		if size > 0 && clientBytes >= size {
			completedForClient++
		}
	}
	return completedForClient >= totalItems
}

func (s *Server) getClientDownloadedItems(clientID string) []int {
	s.clientMutex.Lock()
	defer s.clientMutex.Unlock()

	if s.body.Paths == nil {
		return nil
	}
	totalItems := len(s.body.Paths)
	if totalItems == 0 {
		return nil
	}

	progress, ok := s.clientProgress[clientID]
	if !ok {
		return nil
	}

	var items []int
	for i := 0; i < totalItems; i++ {
		clientBytes := progress[i]
		var size int64
		s.expectedBytesMu.Lock()
		if s.expectedBytes != nil {
			size = s.expectedBytes[i]
		}
		s.expectedBytesMu.Unlock()

		if size <= 0 {
			targetPath := s.body.Paths[i]
			if info, err := os.Stat(targetPath); err == nil {
				size = info.Size()
			}
		}

		if size > 0 && clientBytes >= size {
			items = append(items, i)
		}
	}
	return items
}

func (s *Server) getActiveClients() []string {
	s.clientMutex.Lock()
	defer s.clientMutex.Unlock()

	var active []string
	now := time.Now()
	for clientID, lastSeen := range s.clientLastSeen {
		if now.Sub(lastSeen) <= 8*time.Second {
			active = append(active, clientID)
		}
	}
	return active
}

func (s *Server) getClientDownloadedAndTotal(clientID string) (int64, int64) {
	s.clientMutex.Lock()
	defer s.clientMutex.Unlock()

	if s.body.Paths == nil {
		return 0, 0
	}
	totalItems := len(s.body.Paths)
	if totalItems == 0 {
		return 0, 0
	}

	progress, ok := s.clientProgress[clientID]
	var downloaded int64
	var total int64

	for i := 0; i < totalItems; i++ {
		var size int64
		s.expectedBytesMu.Lock()
		if s.expectedBytes != nil {
			size = s.expectedBytes[i]
		}
		s.expectedBytesMu.Unlock()

		if size <= 0 {
			targetPath := s.body.Paths[i]
			if info, err := os.Stat(targetPath); err == nil {
				size = info.Size()
			}
		}
		total += size

		if ok {
			clientBytes := progress[i]
			if clientBytes > size {
				clientBytes = size
			}
			downloaded += clientBytes
		}
	}

	return downloaded, total
}

func (s *Server) statusHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	clientID := s.registerClientActivity(r, w)
	w.Header().Set("Content-Type", "application/json")

	status := s.getStatus()
	status.DownloadedItems = s.getClientDownloadedItems(clientID)

	if !isTerminalTransferState(status.State) {
		cState := s.getClientStatus(clientID)
		if cState.State != "waiting" {
			status.State = cState.State
			status.BytesDone = cState.BytesDone
			status.BytesTotal = cState.BytesTotal
			status.Percent = cState.Percent
			status.Current = cState.Current
			status.Message = cState.Message
		} else {
			if s.isClientFinished(clientID) {
				status.State = "completed"
				status.BytesDone = status.BytesTotal
				status.Percent = 100
				status.Message = "Transfer completed."
			} else {
				status.State = "waiting"
				status.BytesDone = 0
				status.Percent = 0
				status.Message = "Waiting for transfer to start."
			}
		}
	}

	if s.isClientLimitExceeded(clientID) {
		status.State = "limit_exceeded"
		status.Message = "Device limit exceeded."
	}

	if err := json.NewEncoder(w).Encode(status); err != nil {
		log.Println(err)
	}
}

func (s *Server) registerRoute(pattern string, handler http.HandlerFunc) {
	s.clientMutex.Lock()
	if s.registeredRoutes == nil {
		s.registeredRoutes = make(map[string]bool)
	}
	if s.registeredRoutes[pattern] {
		s.clientMutex.Unlock()
		return
	}
	s.registeredRoutes[pattern] = true
	s.clientMutex.Unlock()
	s.mux.HandleFunc(pattern, handler)
}

// Wait for transfer to be completed, it waits forever if kept awlive
func (s *Server) Wait() error {
	<-s.stopChannel
	if err := s.instance.Shutdown(context.Background()); err != nil {
		log.Println(err)
	}
	if s.body.DeleteAfterTransfer {
		if err := s.body.Delete(); err != nil {
			return err
		}
	}
	if s.chatDir != "" {
		if err := os.RemoveAll(s.chatDir); err != nil {
			return err
		}
	}
	return nil
}

// Shutdown the server
func (s *Server) Shutdown() {
	s.stopChatSession("stopped")
	s.signalStop()
}

// ShutdownChat stops the server and records a chat-specific terminal state.
func (s *Server) ShutdownChat(state string) {
	s.stopChatSession(state)
	s.signalStop()
}

func (s *Server) stopChatSession(state string) {
	s.statusMu.Lock()
	session := s.chatSession
	s.statusMu.Unlock()
	if session != nil {
		session.end(state)
	}
}

func (s *Server) signalStop() {
	select {
	case s.stopChannel <- true:
	default:
	}
}

// New instance of the server
func New(cfg *config.Config) (*Server, error) {

	app := &Server{}
	app.Lang = cfg.Lang
	app.KeepAlive = cfg.KeepAlive
	app.downloadedItems = make(map[int]bool)
	app.downloadedBytes = make(map[int]int64)
	app.clientLastSeen = make(map[string]time.Time)
	app.autoStopIgnoredClients = make(map[string]bool)
	app.clientProgress = make(map[string]map[int]int64)
	app.clientStates = make(map[string]*ClientTransferStateInfo)
	app.expectedBytes = make(map[int]int64)
	// Get the address of the configured interface to bind the server to.
	// If `bind` configuration parameter has been configured, it takes precedence
	bind, err := util.GetInterfaceAddress(cfg.Interface)
	if err != nil {
		return &Server{}, err
	}
	if cfg.Bind != "" {
		bind = cfg.Bind
	}
	// Create a listener. If `port: 0`, a random one is chosen
	listener, err := net.Listen("tcp", fmt.Sprintf("%s:%d", bind, cfg.Port))
	if err != nil {
		return nil, err
	}
	// Set the value of computed port
	port := listener.Addr().(*net.TCPAddr).Port
	// Set the host
	host := fmt.Sprintf("%s:%d", bind, port)
	// Get a random path to use
	path := cfg.Path
	if path == "" {
		path, err = util.GetRandomURLPath()
		if err != nil {
			return nil, err
		}
	}
	// Set the hostname
	hostname := fmt.Sprintf("%s:%d", bind, port)
	// Use external IP when using `interface: any`, unless a FQDN is set
	if bind == "0.0.0.0" && cfg.FQDN == "" {
		fmt.Println("Retrieving the external IP...")
		extIP, err := util.GetExternalIP()
		if err != nil {
			return nil, err
		}
		extIPString := extIP.String()
		fmtstring := "%s:%d"
		if strings.Count(extIPString, ":") >= 2 {
			// IPv6 address, wrap it in [] to add a port
			fmtstring = "[%s]:%d"
		}
		hostname = fmt.Sprintf(fmtstring, extIPString, port)
	}
	// Use a fully-qualified domain name if set
	if cfg.FQDN != "" {
		hostname = fmt.Sprintf("%s:%d", cfg.FQDN, port)
	}
	// Set URLs
	protocol := "http"
	if cfg.Secure {
		protocol = "https"
	}
	app.BaseURL = fmt.Sprintf("%s://%s", protocol, hostname)
	app.SendURL = fmt.Sprintf("%s/send/%s",
		app.BaseURL, path)
	app.ReceiveURL = fmt.Sprintf("%s/receive/%s",
		app.BaseURL, path)
	app.ChatURL = fmt.Sprintf("%s/chat/%s",
		app.BaseURL, path)
	app.ChatDebug = strings.EqualFold(cfg.Mode, "dev")
	app.ViewportDebug = strings.EqualFold(cfg.Mode, "dev")
	// Create a server
	mux := http.NewServeMux()
	app.mux = mux
	registerBrandAssets(mux)
	httpserver := &http.Server{
		Addr:              host,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       2 * time.Minute,
		TLSConfig: &tls.Config{
			MinVersion:               tls.VersionTLS12,
			CurvePreferences:         []tls.CurveID{tls.CurveP521, tls.CurveP384, tls.CurveP256},
			PreferServerCipherSuites: true,
			CipherSuites: []uint16{
				tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
				tls.TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA,
				tls.TLS_RSA_WITH_AES_256_GCM_SHA384,
				tls.TLS_RSA_WITH_AES_256_CBC_SHA,
			},
		},
		TLSNextProto: make(map[string]func(*http.Server, *tls.Conn, http.Handler)),
	}
	// Create channel to send message to stop server
	app.stopChannel = make(chan bool, 1)
	app.setStatus("waiting", "Waiting for a device to connect.")
	// Create cookie used to verify request is coming from first client to connect
	cookie := http.Cookie{Name: "eqt", Value: ""}
	// Gracefully shutdown when an OS signal is received or when "q" is pressed
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt)
	go func() {
		<-sig
		app.signalStop()
	}()

	// The handler adds and removes from the sync.WaitGroup
	// When the group is zero all requests are completed
	// and the server is shutdown
	var waitgroup sync.WaitGroup
	waitgroup.Add(1)
	var initCookie sync.Once
	// Create handlers
	app.registerRoute("/send/"+path+"/status", app.statusHandler)
	mux.HandleFunc("/send/"+path, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("stop") != "" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"status":"ok"}`))
			app.setStatus("stopped", "Transfer stopped by user.")
			app.recordStatus()
			go func() {
				time.Sleep(500 * time.Millisecond)
				app.signalStop()
			}()
			return
		}
		usage := limiterInstance.GetStatus()
		app.initFirstTransferFlag()


		if !cfg.KeepAlive {
			if status, done := app.terminalStatus(); done {
				writeTerminalTransfer(w, status)
				return
			}
		}
		if r.Method == http.MethodGet && r.URL.Query().Get("download") == "" {
			var sizes []string
			var fileSize string
			for _, p := range app.body.Paths {
				var sizeStr string
				if fi, err := os.Stat(p); err == nil {
					if fi.IsDir() {
						sizeStr = "Directory"
					} else {
						sizeStr = formatByteSize(fi.Size())
					}
				} else {
					sizeStr = "-"
				}
				sizes = append(sizes, sizeStr)
			}
			if len(app.body.Paths) == 1 {
				fileSize = sizes[0]
			}

			htmlVariables := struct {
				Route         string
				File          string
				Files         []string
				Sizes         []string
				FileSize      string
				Count         int
				Lang          string
				IsPaid        bool
				LicenseTier   string
				UsedTransfers int
				ClockTampered bool
			}{
				Route:         "/send/" + path,
				File:          app.body.Filename,
				Files:         app.body.Items,
				Sizes:         sizes,
				FileSize:      fileSize,
				Count:         len(app.body.Items),
				IsPaid:        usage.IsPaid,
				LicenseTier:   usage.LicenseTier,
				UsedTransfers: usage.UsedTransfers,
				ClockTampered: usage.ClockTampered,
			}
			if cookie, err := r.Cookie("eqt-lang"); err == nil && cookie.Value != "" {
				htmlVariables.Lang = cookie.Value
			} else {
				htmlVariables.Lang = app.Lang
			}
			clientID := app.getClientID(r, w)
			for idx := 0; idx < len(app.body.Paths); idx++ {
				app.resetClientDownloadedBytes(clientID, idx)
			}
			if err := serveTemplate("download", pages.Download, w, htmlVariables); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				log.Printf("Template error: %v\n", err)
			}
			return
		}

		clientID := app.getClientID(r, w)
		if app.isClientLimitExceeded(clientID) {
			http.Error(w, "Device limit exceeded. Upgrade to Plus/Pro at https://eqt.net.im to unlock.", http.StatusForbidden)
			return
		}

		servePath := app.body.Path
		downloadName := app.body.Filename
		var tempZipToRemove string

		itemIndexStr := r.URL.Query().Get("item")
		if itemIndexStr != "" {
			index, err := strconv.Atoi(itemIndexStr)
			if err != nil || index < 0 || index >= len(app.body.Paths) {
				http.Error(w, "invalid item index", http.StatusBadRequest)
				return
			}
			targetPath := app.body.Paths[index]
			fileInfo, err := os.Stat(targetPath)
			if err != nil {
				http.Error(w, "item not found", http.StatusNotFound)
				return
			}
			if fileInfo.IsDir() {
				tempZip, err := util.ZipFiles([]string{targetPath})
				if err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				servePath = tempZip
				downloadName = strings.TrimSuffix(filepath.Base(targetPath), string(filepath.Separator)) + ".zip"
				tempZipToRemove = tempZip
			} else {
				servePath = targetPath
				downloadName = filepath.Base(targetPath)
			}
		}

		if tempZipToRemove != "" {
			defer os.Remove(tempZipToRemove)
		}

		var expectedBytes int64
		if info, err := os.Stat(servePath); err == nil {
			expectedBytes = info.Size()
		}

		// Anti-bypass limit checks for free users who exceeded 5 free transfers limit
		if !usage.IsPaid && usage.UsedTransfers >= 5 {
			if expectedBytes > 50*1024*1024 {
				http.Error(w, "File size exceeds 50MB free limit after 5 free transfers. Upgrade to Plus to unlock this limit.", http.StatusForbidden)
				app.setStatus("failed", "File size exceeds 50MB limit.")
				app.recordStatus()
				app.signalStop()
				return
			}
			if len(app.body.Items) > 5 {
				http.Error(w, "File count exceeds 5 files free limit after 5 free transfers. Upgrade to Plus to unlock this limit.", http.StatusForbidden)
				app.setStatus("failed", "File count exceeds 5 files limit.")
				app.recordStatus()
				app.signalStop()
				return
			}
		}

		app.statusMu.Lock()
		alreadyCounted := app.transferCounted
		if !alreadyCounted {
			app.transferCounted = true
		}
		app.statusMu.Unlock()
		if !alreadyCounted && !usage.IsPaid {
			IncrementUsedTransfers(1)
		}
		app.setStatus("transferring", "Sending file to connected device.")
		app.updateStatus(func(status *transferStatus) {
			status.Current = downloadName
			status.BytesDone = 0
			status.BytesTotal = expectedBytes
		})
		isItemDownload := r.URL.Query().Get("item") != ""
		isMultiFile := len(app.body.Paths) > 1
		if !cfg.KeepAlive && strings.HasPrefix(r.Header.Get("User-Agent"), "Mozilla") && !isItemDownload && !isMultiFile {
			if cookie.Value == "" {
				initCookie.Do(func() {
					value, err := util.GetSessionID()
					if err != nil {
						log.Println("Unable to generate session ID", err)
						app.signalStop()
						return
					}
					cookie.Value = value
					http.SetCookie(w, &cookie)
				})
			} else {
				// Check for the expected cookie and value
				// If it is missing or doesn't match
				// return a 400 status
				rcookie, err := r.Cookie(cookie.Name)
				if err != nil {
					http.Error(w, err.Error(), http.StatusBadRequest)
					return
				}
				if rcookie.Value != cookie.Value {
					http.Error(w, "mismatching cookie", http.StatusBadRequest)
					return
				}
				// If the cookie exits and matches
				// this is an aadditional request.
				// Increment the waitgroup
				waitgroup.Add(1)
			}
			// Remove connection from the waitgroup when done
			defer waitgroup.Done()
		}
		clientID = app.getClientID(r, w)
		currentIndex := 0
		if isMultiFile && itemIndexStr != "" {
			if idx, err := strconv.Atoi(itemIndexStr); err == nil {
				currentIndex = idx
			}
		}

		// Reset accumulated bytes if it is a fresh download request (from start of file)
		rangeHeader := r.Header.Get("Range")
		isZipDownload := isMultiFile && itemIndexStr == ""
		if rangeHeader == "" || strings.HasPrefix(rangeHeader, "bytes=0-") {
			app.downloadedBytesMu.Lock()
			if app.downloadedBytes == nil {
				app.downloadedBytes = make(map[int]int64)
			}
			if isZipDownload {
				for idx := 0; idx < len(app.body.Paths); idx++ {
					app.downloadedBytes[idx] = 0
					app.resetClientDownloadedBytes(clientID, idx)
				}
			} else {
				app.downloadedBytes[currentIndex] = 0
				app.resetClientDownloadedBytes(clientID, currentIndex)
			}
			app.downloadedBytesMu.Unlock()

			app.updateClientStatus(clientID, r, func(state *ClientTransferStateInfo) {
				state.State = "transferring"
				state.Current = downloadName
				state.BytesDone = 0
				state.BytesTotal = expectedBytes
				state.Percent = 0
				state.Message = "Sending file to connected device."
			})
		} else {
			app.updateClientStatus(clientID, r, func(state *ClientTransferStateInfo) {
				state.State = "transferring"
				state.Current = downloadName
				state.BytesTotal = expectedBytes
				state.Percent = transferPercent(state.BytesDone, state.BytesTotal)
				state.Message = "Sending file to connected device."
			})
		}

		w.Header().Set("Content-Disposition", contentDisposition(downloadName))
		app.expectedBytesMu.Lock()
		if app.expectedBytes == nil {
			app.expectedBytes = make(map[int]int64)
		}
		if isZipDownload {
			for idx := 0; idx < len(app.body.Paths); idx++ {
				app.expectedBytes[idx] = expectedBytes
			}
		} else {
			app.expectedBytes[currentIndex] = expectedBytes
		}
		app.expectedBytesMu.Unlock()

		progressWriter := &progressResponseWriter{
			ResponseWriter: w,
			onWrite: func(written int64) {
				// Track cumulative bytes specifically for this item index
				app.downloadedBytesMu.Lock()
				if app.downloadedBytes == nil {
					app.downloadedBytes = make(map[int]int64)
				}
				if isZipDownload {
					for idx := 0; idx < len(app.body.Paths); idx++ {
						app.downloadedBytes[idx] += written
						app.addClientDownloadedBytes(clientID, idx, written)
					}
				} else {
					app.downloadedBytes[currentIndex] += written
					app.addClientDownloadedBytes(clientID, currentIndex, written)
				}
				app.downloadedBytesMu.Unlock()
			},
		}
		http.ServeFile(progressWriter, r, servePath)
		if r.Method == http.MethodHead {
			return
		}

		app.downloadedBytesMu.Lock()
		itemWritten := app.downloadedBytes[currentIndex]
		app.downloadedBytesMu.Unlock()

		if progressWriter.err != nil {
			// Clear accumulated progress immediately on transfer errors/cancellations
			app.downloadedBytesMu.Lock()
			if isZipDownload {
				for idx := 0; idx < len(app.body.Paths); idx++ {
					app.downloadedBytes[idx] = 0
					app.resetClientDownloadedBytes(clientID, idx)
				}
			} else {
				app.downloadedBytes[currentIndex] = 0
				app.resetClientDownloadedBytes(clientID, currentIndex)
			}
			app.downloadedBytesMu.Unlock()

			app.updateClientStatus(clientID, r, func(state *ClientTransferStateInfo) {
				state.State = "waiting"
				state.BytesDone = 0
				state.Percent = 0
				state.Message = "Transfer interrupted. Waiting for retry..."
			})
			app.setStatus("waiting", "Transfer interrupted. Waiting for retry...")
			app.recordStatus()
			return
		}

		if itemWritten < expectedBytes {
			app.updateClientStatus(clientID, r, func(state *ClientTransferStateInfo) {
				state.State = "waiting"
				state.BytesDone = 0
				state.Percent = 0
				state.Message = "Transfer interrupted. Waiting for retry..."
			})
			app.setStatus("waiting", "Transfer interrupted. Waiting for retry...")
			app.recordStatus()
			return
		}

		allDownloaded := false

		if isMultiFile {
			if isZipDownload {
				allDownloaded = app.markItemDownloaded(-1)
			} else if itemIndexStr != "" {
				allDownloaded = app.markItemDownloaded(currentIndex)
			}
		} else {
			allDownloaded = app.markItemDownloaded(0)
		}

		if app.isClientFinished(clientID) {
			app.updateClientStatus(clientID, r, func(state *ClientTransferStateInfo) {
				state.State = "completed"
				state.BytesDone = state.BytesTotal
				state.Percent = 100
				state.Message = "Transfer completed."
			})
		}

		if allDownloaded {
			app.updateClientStatus(clientID, r, func(state *ClientTransferStateInfo) {
				state.State = "completed"
				state.BytesDone = state.BytesTotal
				state.Percent = 100
				state.Message = "Transfer completed."
			})
			app.statusMu.Lock()
			autoStop := app.autoStop
			app.statusMu.Unlock()
			if autoStop || !app.KeepAlive {
				app.setStatus("completed", "Transfer completed.")
				app.recordStatus()
				go app.signalStopAfterStatusGrace()
			} else {
				// Keep alive when autoStop is disabled, status stays in waiting
				app.setStatus("waiting", fmt.Sprintf("Item %s downloaded. Waiting for more connections.", downloadName))
				app.recordStatus()
			}
		} else {
			app.setStatus("waiting", fmt.Sprintf("Item %s downloaded. Waiting for other items.", downloadName))
			app.recordStatus()
		}
	})
	// Upload handler (serves the upload page)
	mux.HandleFunc("/receive/"+path, func(w http.ResponseWriter, r *http.Request) {
		if !cfg.KeepAlive {
			if status, done := app.terminalStatus(); done {
				writeTerminalTransfer(w, status)
				return
			}
		}
		clientID := app.getClientID(r, w)
		if app.isReceiveClientLimitExceeded(clientID) {
			http.Error(w, "Device limit exceeded. Only 1 device is allowed for transfers under free quota exceeded state. Upgrade to Plus/Pro to unlock.", http.StatusForbidden)
			return
		}
		app.registerClientActivity(r, w)
		usage := limiterInstance.GetStatus()
		if r.URL.Query().Get("ping") != "" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"status":        "ok",
				"isPaid":        usage.IsPaid,
				"usedTransfers": usage.UsedReceiveTransfers,
			})
			return
		}
		htmlVariables := struct {
			Route         string
			File          string
			Files         []string
			Count         int
			Lang          string
			IsPaid        bool
			LicenseTier   string
			UsedTransfers int
			ClockTampered bool
		}{
			Route:         "/receive/" + path,
			IsPaid:        usage.IsPaid,
			LicenseTier:   usage.LicenseTier,
			UsedTransfers: usage.UsedReceiveTransfers,
			ClockTampered: usage.ClockTampered,
		}
		if cookie, err := r.Cookie("eqt-lang"); err == nil && cookie.Value != "" {
			htmlVariables.Lang = cookie.Value
		} else {
			htmlVariables.Lang = app.Lang
		}
		switch r.Method {
		case "POST":
			startUsage := limiterInstance.GetStatus()
			quotaExceededAtStart := !startUsage.IsPaid && startUsage.UsedReceiveTransfers >= 5
			app.statusMu.Lock()
			alreadyCounted := app.transferCounted
			if !alreadyCounted {
				app.transferCounted = true
			}
			app.statusMu.Unlock()
			if !alreadyCounted && !startUsage.IsPaid {
				IncrementUsedReceiveTransfers(1)
			}
			app.setStatus("transferring", "Receiving files from connected device.")
			app.updateStatus(func(status *transferStatus) {
				status.BytesDone = 0
				status.BytesTotal = r.ContentLength
				status.Percent = 0
				status.SavedFiles = nil
			})
			filenames, err := util.ReadFilenames(app.outputDir)
			if err != nil {
				fmt.Fprintf(w, "Unable to read output directory: %v\n", err)
				log.Printf("Unable to read output directory: %v\n", err)
				app.setStatus("failed", "Unable to read output directory.")
				app.recordStatus()
				app.signalStop()
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
			reader, err := r.MultipartReader()
			if err != nil {
				fmt.Fprintf(w, "Upload error: %v\n", err)
				log.Printf("Upload error: %v\n", err)
				state := "failed"
				message := "Upload failed."
				if interruptedTransferError(err) || r.Context().Err() != nil {
					state = "stopped"
					message = "Upload interrupted before completion."
				}
				app.setStatus(state, message)
				app.recordStatus()
				app.signalStop()
				return
			}
			transferredFiles := []string{}
			progressBar := pb.New64(r.ContentLength)
			progressBar.ShowCounters = false
			for {
				part, err := reader.NextPart()
				if err == io.EOF {
					break
				}
				// If part.FileName() is empty, skip this iteration.
				if part.FileName() == "" {
					continue
				}
				if quotaExceededAtStart {
					if len(transferredFiles) >= 5 {
						http.Error(w, "File count exceeds 5 files free limit after 5 free transfers. Upgrade to Plus to unlock this limit.", http.StatusForbidden)
						app.setStatus("failed", "File count exceeds 5 files limit.")
						app.recordStatus()
						app.signalStop()
						return
					}
				}
				// Prepare the destination
				out, fileName, err := createUniqueFile(app.outputDir, filepath.Base(part.FileName()), filenames)
				if err != nil {
					// Output to server
					fmt.Fprintf(w, "Unable to create the file for writing: %s\n", err)
					// Output to console
					log.Printf("Unable to create the file for writing: %s\n", err)
					// Send signal to server to shutdown
					app.setStatus("failed", "Unable to create the file for writing.")
					app.recordStatus()
					app.signalStop()
					return
				}
				// Add name of new file
				filenames = append(filenames, fileName)
				// Write the content from POSTed file to the out
				fmt.Println("Transferring file: ", out.Name())
				app.updateStatus(func(status *transferStatus) {
					status.Current = fileName
					status.Message = "Receiving " + fileName + "."
				})
				progressBar.Prefix(out.Name())
				progressBar.Start()
				buf := make([]byte, 32*1024)
				var currentFileWritten int64
				for {
					// Read a chunk
					n, err := part.Read(buf)
					if err != nil && err != io.EOF {
						// Output to server
						status := http.StatusInternalServerError
						var maxBytesErr *http.MaxBytesError
						if errors.As(err, &maxBytesErr) {
							status = http.StatusRequestEntityTooLarge
						}
						http.Error(w, fmt.Sprintf("Unable to write file to disk: %v", err), status)
						// Output to console
						fmt.Printf("Unable to write file to disk: %v", err)
						out.Close()
						// Send signal to server to shutdown
						state := "failed"
						message := "Upload failed."
						if interruptedTransferError(err) || r.Context().Err() != nil {
							state = "stopped"
							message = "Upload interrupted before completion."
						}
						app.setStatus(state, message)
						app.recordStatus()
						app.signalStop()
						return
					}
					if n == 0 {
						break
					}
					// Write a chunk
					if _, err := out.Write(buf[:n]); err != nil {
						// Output to server
						fmt.Fprintf(w, "Unable to write file to disk: %v", err)
						// Output to console
						log.Printf("Unable to write file to disk: %v", err)
						out.Close()
						// Send signal to server to shutdown
						app.setStatus("failed", "Unable to write file to disk.")
						app.recordStatus()
						app.signalStop()
						return
					}
					currentFileWritten += int64(n)
					if quotaExceededAtStart && currentFileWritten > 50*1024*1024 {
						out.Close()
						http.Error(w, "File size exceeds 50MB free limit after 5 free transfers. Upgrade to Plus to unlock this limit.", http.StatusRequestEntityTooLarge)
						app.setStatus("failed", "File size exceeds 50MB limit.")
						app.recordStatus()
						app.signalStop()
						return
					}
					app.updateStatus(func(status *transferStatus) {
						status.BytesDone += int64(n)
						if status.BytesTotal > 0 && status.BytesDone > status.BytesTotal {
							status.BytesDone = status.BytesTotal
						}
					})
					progressBar.Add(n)
				}
				if err := out.Close(); err != nil {
					fmt.Fprintf(w, "Unable to close file: %v", err)
					log.Printf("Unable to close file: %v", err)
					app.setStatus("failed", "Unable to close file.")
					app.recordStatus()
					app.signalStop()
					return
				}
				transferredFiles = append(transferredFiles, out.Name())
				app.updateStatus(func(status *transferStatus) {
					status.SavedFiles = append([]string(nil), transferredFiles...)
				})
			}
			progressBar.FinishPrint("File transfer completed")
			// Set the value of the variable to the actually transferred files
			htmlVariables.File = strings.Join(transferredFiles, ", ")
			htmlVariables.Files = transferredFiles
			htmlVariables.Count = len(transferredFiles)
			if err := serveTemplate("done", pages.Done, w, htmlVariables); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				log.Printf("Template error: %v\n", err)
				app.setStatus("failed", "Unable to render completion page.")
				app.recordStatus()
				app.signalStop()
				return
			}
			app.setStatus("completed", "Transfer completed.")
			app.updateStatus(func(status *transferStatus) {
				status.SavedFiles = append([]string(nil), transferredFiles...)
				if len(transferredFiles) == 1 {
					status.Message = "Received 1 file."
				} else {
					status.Message = fmt.Sprintf("Received %d files.", len(transferredFiles))
				}
			})
			app.recordStatus()
			if !cfg.KeepAlive {
				go app.signalStopAfterStatusGrace()
			}
		case "GET":
			if err := serveTemplate("upload", pages.Upload, w, htmlVariables); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				log.Printf("Template error: %v\n", err)
				app.setStatus("failed", "Unable to render upload page.")
				app.recordStatus()
				app.signalStop()
				return
			}
		}
	})
	// Wait for all wg to be done, but do not automatically close the server
	// as multi-file transfers require all files to finish before completed shutdown.
	go func() {
		waitgroup.Wait()
	}()
	go func() {
		netListener := tcpKeepAliveListener{listener.(*net.TCPListener)}
		if cfg.Secure {
			if err := httpserver.ServeTLS(netListener, cfg.TlsCert, cfg.TlsKey); err != http.ErrServerClosed {
				log.Println("error starting the server:", err)
				app.signalStop()
			}
		} else {
			if err := httpserver.Serve(netListener); err != http.ErrServerClosed {
				log.Println("error starting the server", err)
				app.signalStop()
			}
		}
	}()
	// Start background ticker to periodically refresh status and devices count (every 3 seconds)
	go func() {
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-app.stopChannel:
				return
			case <-ticker.C:
				app.updateStatus(func(status *transferStatus) {})
			}
		}
	}()

	app.instance = httpserver
	return app, nil
}

func registerBrandAssets(mux *http.ServeMux) {
	mux.HandleFunc("/assets/eqt-logo-mark.png", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "public, max-age=86400")
		_, _ = w.Write(pages.LogoMark)
	})
	mux.HandleFunc("/assets/eqt-logo-horizontal.png", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "public, max-age=86400")
		_, _ = w.Write(pages.LogoHorizontal)
	})
	mux.HandleFunc("/favicon.png", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "public, max-age=86400")
		_, _ = w.Write(pages.Favicon)
	})
}

// openBrowser navigates to a url using the default system browser
func openBrowser(url string) error {
	var err error
	switch runtime.GOOS {
	case "linux":
		err = exec.Command("xdg-open", url).Start()
	case "windows":
		err = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		err = exec.Command("open", url).Start()
	default:
		err = fmt.Errorf("failed to open browser on platform: %s", runtime.GOOS)
	}
	return err
}

func formatByteSize(bytes int64) string {
	if bytes < 1024 {
		return fmt.Sprintf("%d B", bytes)
	}
	units := []string{"KB", "MB", "GB", "TB"}
	f := float64(bytes)
	idx := 0
	for f >= 1024 && idx < len(units) {
		f /= 1024
		idx++
	}
	return fmt.Sprintf("%.1f %s", f, units[idx-1])
}
