// Package chathttp contains experimental HTTP routes for chat v2.
package chathttp

import (
	"context"
	"encoding/json"
	"flag"
	"image/png"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"eqt/pkg/chat/v2/bandwidth"
	"eqt/pkg/chat/v2/diag"
	"eqt/pkg/chat/v2/protocol"
	"eqt/pkg/chat/v2/session"
	"eqt/pkg/chat/v2/transfer"
	"eqt/pkg/chat/v2/transport"
	"eqt/pkg/chat/v2/web"
	"eqt/pkg/qr"
)

const Version = "v2"

// Config controls the experimental chat v2 handler.
type Config struct {
	BasePath             string
	Logger               diag.Logger
	IsPaidOrUnrestricted func() bool
	HostToken            func() string
	DebugLog             func() bool
	LogDir               func() string
}

type rendezvous struct {
	readerChan chan io.ReadCloser
	errChan    chan error
}

// Handler is an isolated, unmounted chat v2 HTTP handler.
type Handler struct {
	basePath             string
	logger               diag.Logger
	sessions             *session.Manager
	transfer             *transfer.Manager
	scheduler            *bandwidth.Scheduler
	ws                   *transport.WebSocketHandler
	isPaidOrUnrestricted func() bool
	hostToken            func() string
	mu                   sync.Mutex
	rendezvousMap        map[string][]*rendezvous
}

// NewHandler creates an experimental chat v2 handler.
func NewHandler(cfg Config) *Handler {
	basePath := strings.TrimRight(cfg.BasePath, "/")
	if basePath == "" {
		basePath = "/chat-v2"
	}
	logger := cfg.Logger
	if logger == nil {
		logger = diag.NopLogger{}
	}
	sessions := session.NewManager()
	sessions.Logger = logger
	transferMgr := transfer.NewManager()
	sched := bandwidth.NewScheduler(10 * 1024 * 1024) // 10MB/s default global limit
	sched.Logger = logger

	transferMgr.RegisterCallback(func(token string, et protocol.EventType, ev protocol.TransferEvent) {
		sess := sessions.GetOrCreate(token)
		diag.Emit(context.Background(), logger, diag.LevelDebug, "[Callback] Transfer callback triggered", nil,
			diag.F("token", token), diag.F("eventType", et), diag.F("jobID", ev.ID), diag.F("messageID", ev.MessageID))

		if ev.MessageID != "" && strings.HasPrefix(ev.ID, "dl-") && et == protocol.EventTransferCompleted {
			diag.Emit(context.Background(), logger, diag.LevelInfo, "[Callback] Download transfer completed, marking as downloaded", nil,
				diag.F("token", token), diag.F("jobID", ev.ID), diag.F("messageID", ev.MessageID))
			if msg := sess.MessageStore.MarkDownloaded(ev.MessageID); msg != nil {
				diag.Emit(context.Background(), logger, diag.LevelInfo, "[Callback] Message marked downloaded, broadcasting EventMessageUpdated", nil,
					diag.F("token", token), diag.F("messageID", ev.MessageID))
				sess.Broadcast(protocol.EventEnvelope{
					Type:    protocol.EventMessageUpdated,
					Time:    time.Now(),
					Message: msg,
				})
			} else {
				diag.Emit(context.Background(), logger, diag.LevelWarn, "[Callback] Failed to mark message downloaded, message not found in store", nil,
					diag.F("token", token), diag.F("messageID", ev.MessageID))
			}
		}
		diag.Emit(context.Background(), logger, diag.LevelDebug, "[Callback] Broadcasting transfer event", nil,
			diag.F("token", token), diag.F("eventType", et), diag.F("jobID", ev.ID))
		sess.Broadcast(protocol.EventEnvelope{
			Type:     et,
			Transfer: &ev,
			Time:     time.Now(),
		})
	})

	var debugLogFn func() bool
	if cfg.DebugLog != nil {
		debugLogFn = cfg.DebugLog
	} else {
		debugLogFn = func() bool { return false }
	}

	return &Handler{
		basePath:             basePath,
		logger:               logger,
		sessions:             sessions,
		transfer:             transferMgr,
		scheduler:            sched,
		ws:                   transport.NewWebSocketHandler(transport.WebSocketConfig{Logger: logger, Sessions: sessions, Transfer: transferMgr, DebugLog: debugLogFn, LogDir: cfg.LogDir}),
		isPaidOrUnrestricted: cfg.IsPaidOrUnrestricted,
		hostToken:            cfg.HostToken,
		rendezvousMap:        make(map[string][]*rendezvous),
	}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	token, suffix, ok := h.route(r.URL.Path)
	if !ok || token == "" {
		http.NotFound(w, r)
		return
	}
	fields := []diag.Field{
		diag.F("method", r.Method),
		diag.F("path", r.URL.Path),
		diag.F("token", token),
	}
	diag.Emit(r.Context(), h.logger, diag.LevelDebug, "request received", nil, fields...)

	if strings.HasPrefix(suffix, "/files/") {
		fileID := strings.TrimPrefix(suffix, "/files/")
		h.handleDownload(w, r, token, fileID, fields...)
		return
	}

	if suffix == "/attachments/local" {
		h.handleLocalAttachmentRegister(w, r, token, fields...)
		return
	}

	if suffix == "/upload/stream" {
		h.handleUploadStream(w, r, token, fields...)
		return
	}

	if suffix == "/upload/init" {
		h.handleUploadInit(w, r, token, fields...)
		return
	}

	if suffix == "/upload" {
		h.handleUpload(w, r, token, fields...)
		return
	}

	distPath := "./pkg/chat/v2/web/dist"
	if _, err := os.Stat(distPath + "/index.html"); err == nil {
		if token == "assets" || token == "favicon.png" {
			localFile := distPath + "/" + token + suffix
			if _, err := os.Stat(localFile); err == nil {
				http.ServeFile(w, r, localFile)
				return
			}
		}
		if suffix == "" || suffix == "/" {
			http.ServeFile(w, r, distPath+"/index.html")
			return
		}
		localFile := distPath + suffix
		if _, err := os.Stat(localFile); err == nil {
			http.ServeFile(w, r, localFile)
			return
		}
	} else if !isRunningInTest() {
		if subFS, err := fs.Sub(web.Dist, "dist"); err == nil {
			if f, err := subFS.Open("index.html"); err == nil {
				f.Close()
				fileServer := http.FileServer(http.FS(subFS))
				if token == "assets" || token == "favicon.png" {
					r2 := r.Clone(r.Context())
					r2.URL.Path = "/" + token + suffix
					fileServer.ServeHTTP(w, r2)
					return
				}
				if suffix == "" || suffix == "/" {
					if fHtml, err := subFS.Open("index.html"); err == nil {
						defer fHtml.Close()
						if stat, err := fHtml.Stat(); err == nil {
							if seeker, ok := fHtml.(io.ReadSeeker); ok {
								http.ServeContent(w, r, "index.html", stat.ModTime(), seeker)
								return
							}
						}
					}
				}
				filePath := strings.TrimPrefix(suffix, "/")
				if f2, err := subFS.Open(filePath); err == nil {
					f2.Close()
					r2 := r.Clone(r.Context())
					r2.URL.Path = suffix
					fileServer.ServeHTTP(w, r2)
					return
				}
			}
		}
	}

	switch suffix {
	case "", "/":
		h.writeSkeleton(w, r, token, fields...)
	case "/health":
		h.writeHealth(w, r, token, fields...)
	case "/ws":
		h.ws.ServeWS(w, r, token)
	case "/qr.png":
		h.handleQRImage(w, r, token, fields...)
	default:
		http.NotFound(w, r)
	}
}

func (h *Handler) route(path string) (string, string, bool) {
	if path != h.basePath && !strings.HasPrefix(path, h.basePath+"/") {
		return "", "", false
	}
	rest := strings.TrimPrefix(path, h.basePath)
	rest = strings.TrimPrefix(rest, "/")
	if rest == "" {
		return "", "", true
	}
	token, suffix, _ := strings.Cut(rest, "/")
	if suffix != "" {
		suffix = "/" + suffix
	}
	return token, suffix, true
}

func (h *Handler) writeSkeleton(w http.ResponseWriter, r *http.Request, token string, fields ...diag.Field) {
	if r.Method != http.MethodGet {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusMethodNotAllowed, "method not allowed"), fields...)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(harnessHTML))
	diag.Emit(r.Context(), h.logger, diag.LevelInfo, "skeleton response sent", nil, fields...)
}

const harnessHTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Chat v2 Test Harness</title>
    <style>
        body { font-family: sans-serif; max-width: 600px; margin: 20px auto; padding: 0 10px; background: #fafafa; }
        .box { border: 1px solid #ccc; padding: 15px; margin-bottom: 15px; border-radius: 5px; background: #fff; }
        #messages { height: 250px; overflow-y: scroll; border: 1px solid #ddd; padding: 10px; margin-bottom: 10px; background: #fdfdfd; }
        .msg { margin-bottom: 8px; font-size: 14px; }
        .msg-sender { font-weight: bold; color: #333; }
        .msg-text { margin-left: 5px; color: #555; }
        .system { color: #888; font-style: italic; }
        input[type="text"] { width: 70%; padding: 5px; }
        button { padding: 5px 15px; }
    </style>
</head>
<body>
    <h2>Chat v2 Test Harness</h2>
    <div id="status" class="box">Status: Disconnected</div>
    
    <div id="join-form" class="box">
        <label>Nickname: <input type="text" id="label-input" value="Device_" /></label>
        <button id="connect-btn">Connect</button>
    </div>

    <div id="chat-box" class="box" style="display:none;">
        <div id="devices-list" style="margin-bottom:10px; font-size:12px; color:#666;">Online: 0</div>
        <div id="messages"></div>
        <input type="text" id="msg-input" placeholder="Type a message..." />
        <button id="send-btn">Send</button>
    </div>

    <script>
        const token = window.location.pathname.split('/')[2];
        const labelInput = document.getElementById('label-input');
        const connectBtn = document.getElementById('connect-btn');
        const statusDiv = document.getElementById('status');
        const joinForm = document.getElementById('join-form');
        const chatBox = document.getElementById('chat-box');
        const devicesList = document.getElementById('devices-list');
        const messagesDiv = document.getElementById('messages');
        const msgInput = document.getElementById('msg-input');
        const sendBtn = document.getElementById('send-btn');

        labelInput.value = 'Device_' + Math.floor(Math.random() * 1000);

        let ws;
        let clientLabel = '';
        let nextCommandId = 1;

        connectBtn.addEventListener('click', () => {
            clientLabel = labelInput.value.trim() || 'Anonymous';
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = protocol + '//' + window.location.host + '/chat-v2/' + token + '/ws';
            
            statusDiv.textContent = 'Connecting...';
            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                statusDiv.textContent = 'Connected, sending registration...';
            };

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                console.log('Received:', data);
                
                if (data.type === 'hello' && !data.commandId) {
                    ws.send(JSON.stringify({
                        type: 'connect',
                        commandId: 'conn-' + nextCommandId++,
                        client: {
                            token: token,
                            label: clientLabel,
                            peer: 'peer-' + clientLabel
                        }
                    }));
                } else if (data.type === 'hello' && data.commandId) {
                    statusDiv.textContent = 'Connected as ' + clientLabel;
                    joinForm.style.display = 'none';
                    chatBox.style.display = 'block';
                } else if (data.type === 'presence_changed') {
                    const devices = data.presence.devices || [];
                    devicesList.textContent = 'Online: ' + devices.length + ' (' + devices.map(d => d.label).join(', ') + ')';
                } else if (data.type === 'message_added') {
                    const msg = data.message;
                    appendMessage(msg.sender, msg.text);
                } else if (data.type === 'error') {
                    appendSystemMessage('Error: ' + data.error.message);
                }
            };

            ws.onerror = (err) => {
                statusDiv.textContent = 'Error: ' + JSON.stringify(err);
            };

            ws.onclose = () => {
                statusDiv.textContent = 'Disconnected';
                joinForm.style.display = 'block';
                chatBox.style.display = 'none';
            };
        });

        sendBtn.addEventListener('click', sendMessage);
        msgInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') sendMessage();
        });

        function sendMessage() {
            const text = msgInput.value.trim();
            if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
            
            ws.send(JSON.stringify({
                type: 'send_text',
                commandId: 'send-' + nextCommandId++,
                text: text
            }));
            msgInput.value = '';
        }

        function appendMessage(sender, text) {
            const div = document.createElement('div');
            div.className = 'msg';
            div.innerHTML = '<span class="msg-sender">' + sender + ':</span><span class="msg-text">' + text + '</span>';
            messagesDiv.appendChild(div);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        function appendSystemMessage(text) {
            const div = document.createElement('div');
            div.className = 'msg system';
            div.textContent = text;
            messagesDiv.appendChild(div);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }
    </script>
</body>
</html>`

func (h *Handler) writeHealth(w http.ResponseWriter, r *http.Request, token string, fields ...diag.Field) {
	if r.Method != http.MethodGet {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusMethodNotAllowed, "method not allowed"), fields...)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"version": Version,
		"token":   token,
		"status":  "skeleton",
	})
	diag.Emit(r.Context(), h.logger, diag.LevelInfo, "health response sent", nil, fields...)
}

func isRunningInTest() bool {
	if os.Getenv("EQT_TESTING") == "true" {
		return true
	}
	if flag.Lookup("test.v") != nil {
		return true
	}
	exe := filepath.Base(os.Args[0])
	if strings.Contains(exe, ".test") || strings.HasPrefix(exe, "test") {
		return true
	}
	return false
}

func (h *Handler) handleQRImage(w http.ResponseWriter, r *http.Request, token string, fields ...diag.Field) {
	if r.Method != http.MethodGet {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusMethodNotAllowed, "method not allowed"), fields...)
		return
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	joinURL := scheme + "://" + r.Host + h.basePath + "/" + token
	if r.URL.RawQuery != "" {
		joinURL += "?" + r.URL.RawQuery
	}

	qrImg, err := qr.RenderImage(joinURL)
	if err != nil {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorInternal, http.StatusInternalServerError, err.Error()), fields...)
		return
	}

	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-cache")
	if err := png.Encode(w, qrImg); err != nil {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorInternal, http.StatusInternalServerError, err.Error()), fields...)
		return
	}
	diag.Emit(r.Context(), h.logger, diag.LevelInfo, "QR image rendered and sent", nil, append(fields, diag.F("url", joinURL))...)
}

// GetAttachmentPath retrieves the absolute local path for a chat attachment by ID.
func (h *Handler) GetAttachmentPath(id string) (string, bool) {
	if h.sessions == nil {
		return "", false
	}
	return h.sessions.GetAttachmentPathByID(id)
}

// NotifyQuickDownload simulates a transfer job for a fast local copy, triggering broadcast events.
func (h *Handler) NotifyQuickDownload(messageID string) {
	fields := []diag.Field{
		diag.F("messageID", messageID),
	}
	diag.Emit(context.Background(), h.logger, diag.LevelInfo, "[NotifyQuickDownload] Entered", nil, fields...)

	if h.sessions == nil || h.transfer == nil {
		diag.Emit(context.Background(), h.logger, diag.LevelWarn, "[NotifyQuickDownload] Aborted: sessions or transfer manager is nil", nil, fields...)
		return
	}

	token, filePath, ok := h.sessions.GetAttachmentTokenAndPath(messageID)
	if !ok {
		diag.Emit(context.Background(), h.logger, diag.LevelWarn, "[NotifyQuickDownload] Aborted: GetAttachmentTokenAndPath failed (message not found in any session)", nil, fields...)
		return
	}

	fields = append(fields, diag.F("token", token), diag.F("filePath", filePath))
	diag.Emit(context.Background(), h.logger, diag.LevelInfo, "[NotifyQuickDownload] Attachment resolved successfully", nil, fields...)

	jobID := "dl-" + messageID
	filename := "download-" + messageID + ".bin"
	var size int64 = 1024 * 1024
	if info, err := os.Stat(filePath); err == nil {
		filename = info.Name()
		size = info.Size()
	} else {
		diag.Emit(context.Background(), h.logger, diag.LevelWarn, "[NotifyQuickDownload] Failed to stat file, using defaults", err, fields...)
	}

	fields = append(fields, diag.F("jobID", jobID), diag.F("filename", filename), diag.F("size", size))
	diag.Emit(context.Background(), h.logger, diag.LevelInfo, "[NotifyQuickDownload] Running simulated transfer job events", nil, fields...)

	// Trigger full event lifecycle to notify all connected clients (e.g. mobile)
	h.transfer.CreateJob(token, jobID, messageID, "", filename, size)
	_ = h.transfer.StartJob(jobID)
	_ = h.transfer.CompleteJob(jobID)

	diag.Emit(context.Background(), h.logger, diag.LevelInfo, "[NotifyQuickDownload] Simulated job events completed successfully", nil, fields...)
}
