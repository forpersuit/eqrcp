package transport

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"eqt/pkg/chat/v2/diag"
	"eqt/pkg/chat/v2/protocol"
	"eqt/pkg/chat/v2/session"
	"eqt/pkg/chat/v2/transfer"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

const (
	DefaultReadLimit = 64 << 10
)

// WebSocketConfig configures the v2 control-plane WebSocket handler.
type WebSocketConfig struct {
	Logger                diag.Logger
	Now                   func() time.Time
	Sessions              *session.Manager
	Transfer              *transfer.Manager
	DebugLog              func() bool
	LogDir                func() string
	DisableSystemMessages bool
	IsClientKicked        func(token string) bool
	IsJoinKicked          func(join string) bool
	KickClient            func(token string, join string)
}

// WebSocketHandler handles v2 control-plane WebSocket connections.
type WebSocketHandler struct {
	logger         diag.Logger
	now            func() time.Time
	sessions       *session.Manager
	transfer       *transfer.Manager
	debugLog       func() bool
	logDir         func() string
	isClientKicked func(token string) bool
	isJoinKicked   func(join string) bool
	kickClientHost func(token string, join string)
}

// NewWebSocketHandler creates a v2 control-plane WebSocket handler.
func NewWebSocketHandler(cfg WebSocketConfig) *WebSocketHandler {
	logger := cfg.Logger
	if logger == nil {
		logger = diag.NopLogger{}
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	sessions := cfg.Sessions
	if sessions == nil {
		sessions = session.NewManager()
		sessions.DisableSystemMessages = cfg.DisableSystemMessages
	}
	transferMgr := cfg.Transfer
	if transferMgr == nil {
		transferMgr = transfer.NewManager()
	}
	debugLog := cfg.DebugLog
	if debugLog == nil {
		debugLog = func() bool { return false }
	}
	logDir := cfg.LogDir
	if logDir == nil {
		logDir = func() string { return "" }
	}
	return &WebSocketHandler{
		logger:         logger,
		now:            now,
		sessions:       sessions,
		transfer:       transferMgr,
		debugLog:       debugLog,
		logDir:         logDir,
		isClientKicked: cfg.IsClientKicked,
		isJoinKicked:   cfg.IsJoinKicked,
		kickClientHost: cfg.KickClient,
	}
}

func (h *WebSocketHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		diag.WriteError(w, r, h.logger, diag.NewError(protocol.ErrorBadCommand, http.StatusMethodNotAllowed, "method not allowed"),
			diag.F("method", r.Method),
			diag.F("path", r.URL.Path),
		)
		return
	}

	token := extractToken(r.URL.Path)
	h.ServeWS(w, r, token)
}

// ServeWS handles WebSocket upgrading and control-plane loop for a specific token.
func (h *WebSocketHandler) ServeWS(w http.ResponseWriter, r *http.Request, token string) {
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		diag.Emit(r.Context(), h.logger, diag.LevelWarn, "websocket accept failed", err,
			diag.F("path", r.URL.Path),
			diag.F("token", token),
		)
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "closed")
	conn.SetReadLimit(DefaultReadLimit)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	diag.Emit(ctx, h.logger, diag.LevelInfo, "websocket connected", nil,
		diag.F("path", r.URL.Path),
		diag.F("token", token),
		diag.F("subprotocol", conn.Subprotocol()),
	)

	// Send initial hello
	if err := h.writeHello(ctx, conn); err != nil {
		diag.Emit(ctx, h.logger, diag.LevelWarn, "websocket hello failed", err,
			diag.F("path", r.URL.Path),
			diag.F("token", token),
		)
		return
	}

	var cl *session.Client
	var sess *session.Session

	defer func() {
		if cl != nil && sess != nil {
			sess.Unregister(cl)
			fmt.Printf("[WebSocket LEFT] RoomToken=%s, ClientID=%s, Peer=%s\n", token, cl.ID, cl.Peer)
			diag.Emit(ctx, h.logger, diag.LevelInfo, "client unregistered and disconnected", nil,
				diag.F("path", r.URL.Path),
				diag.F("token", token),
				diag.F("clientID", cl.ID),
			)
		} else {
			fmt.Printf("[WebSocket Disconnected] RoomToken=%s (without client session)\n", token)
			diag.Emit(ctx, h.logger, diag.LevelInfo, "websocket disconnected", nil,
				diag.F("path", r.URL.Path),
				diag.F("token", token),
			)
		}
	}()

	for {
		var cmd protocol.CommandEnvelope
		if err := wsjson.Read(ctx, conn, &cmd); err != nil {
			// Read error, exit loop (connection will be closed by deferred cleanups)
			return
		}

		fields := []diag.Field{
			diag.F("path", r.URL.Path),
			diag.F("token", token),
			diag.F("commandType", cmd.Type),
			diag.F("commandID", cmd.CommandID),
		}
		if cl != nil {
			fields = append(fields, diag.F("clientID", cl.ID))
		}
		diag.Emit(ctx, h.logger, diag.LevelDebug, "websocket command received", nil, fields...)

		switch cmd.Type {
		case protocol.CommandConnect:
			if cl != nil {
				h.sendError(ctx, conn, cmd.CommandID, protocol.ErrorBadCommand, "already connected")
				continue
			}
			if h.isClientKicked != nil && h.isClientKicked(cmd.Client.Token) {
				h.sendError(ctx, conn, cmd.CommandID, protocol.ErrorUnauthorized, "device was forced offline")
				conn.Close(websocket.StatusPolicyViolation, "device was forced offline")
				return
			}
			if h.isJoinKicked != nil && cmd.Client.Join != "" && h.isJoinKicked(cmd.Client.Join) {
				h.sendError(ctx, conn, cmd.CommandID, protocol.ErrorUnauthorized, "join token expired")
				conn.Close(websocket.StatusPolicyViolation, "join token expired")
				return
			}
			cl = session.NewClient(cmd.Client, conn)
			sess = h.sessions.GetOrCreate(token)
			sess.AssignTheme(cl, cmd.Client)

			go cl.WritePump(ctx)

			cl.Send(protocol.EventEnvelope{
				Type:      protocol.EventHello,
				Seq:       sess.MessageStore.CurrentSeq(),
				Time:      h.now(),
				CommandID: cmd.CommandID,
			})
			diag.Emit(ctx, h.logger, diag.LevelDebug, "websocket event sent", nil,
				append(fields, diag.F("eventType", protocol.EventHello))...,
			)

			sess.Register(cl, cmd.AfterSeq, cmd.JoinSeq)
			fmt.Printf("[WebSocket JOINED] RoomToken=%s, ClientID=%s, Peer=%s, Label=%s\n", token, cl.ID, cl.Peer, cl.Label)

		case protocol.CommandHeartbeat:
			event := protocol.EventEnvelope{
				Type:      protocol.EventHeartbeat,
				Seq:       0,
				Time:      h.now(),
				CommandID: cmd.CommandID,
			}
			if cl != nil {
				cl.Send(event)
			} else {
				_ = wsjson.Write(ctx, conn, event)
			}
			diag.Emit(ctx, h.logger, diag.LevelDebug, "websocket event sent", nil,
				append(fields, diag.F("eventType", event.Type))...,
			)

		case protocol.CommandSendText:
			if cl == nil || sess == nil {
				h.sendError(ctx, conn, cmd.CommandID, protocol.ErrorBadCommand, "not connected")
				continue
			}
			sess.SendText(cl, cmd.Text, cmd.CommandID)

		case protocol.CommandRecallMessage:
			if cl == nil || sess == nil {
				h.sendError(ctx, conn, cmd.CommandID, protocol.ErrorBadCommand, "not connected")
				continue
			}
			if cmd.MessageID == "" {
				h.sendError(ctx, conn, cmd.CommandID, protocol.ErrorBadCommand, "missing messageId")
				continue
			}
			sess.RecallMessage(cl.Peer, cmd.MessageID, cmd.CommandID)

		case protocol.CommandStartTransfer:
			if cl == nil || sess == nil {
				h.sendError(ctx, conn, cmd.CommandID, protocol.ErrorBadCommand, "not connected")
				continue
			}
			if cmd.TransferID == "" {
				h.sendError(ctx, conn, cmd.CommandID, protocol.ErrorBadCommand, "missing transferId")
				continue
			}

			// Pre-create the download job if it does not exist yet to prevent race conditions
			if strings.HasPrefix(cmd.TransferID, "dl-") {
				job, err := h.transfer.GetJob(cmd.TransferID)
				if err != nil || job.State == protocol.TransferCancelled || job.State == protocol.TransferFailed || job.State == protocol.TransferCompleted {
					// Extract message ID from transfer ID (format: dl-<messageId>-<clientId> or dl-<messageId>)
					fileID := strings.TrimPrefix(cmd.TransferID, "dl-")
					suffix := "-" + cl.Peer
					fileID = strings.TrimSuffix(fileID, suffix)

					if msg, exists := sess.MessageStore.Find(fileID); exists && msg != nil {
						h.transfer.CreateJob(sess.Token, cmd.TransferID, fileID, cl.Peer, msg.FileName, msg.Size)
					}
				}
			}

			err := h.transfer.StartJob(cmd.TransferID)
			if err != nil {
				h.sendError(ctx, conn, cmd.CommandID, protocol.ErrorBadCommand, err.Error())
				continue
			}

		case protocol.CommandCancelTransfer:
			if cl == nil || sess == nil {
				h.sendError(ctx, conn, cmd.CommandID, protocol.ErrorBadCommand, "not connected")
				continue
			}
			if cmd.TransferID == "" {
				h.sendError(ctx, conn, cmd.CommandID, protocol.ErrorBadCommand, "missing transferId")
				continue
			}
			err := h.transfer.CancelJob(cmd.TransferID)
			if err != nil {
				h.sendError(ctx, conn, cmd.CommandID, protocol.ErrorBadCommand, err.Error())
				continue
			}
		case protocol.CommandUpdateClient:
			if cl == nil || sess == nil {
				h.sendError(ctx, conn, cmd.CommandID, protocol.ErrorBadCommand, "not connected")
				continue
			}
			if cmd.Client.Label == "" {
				h.sendError(ctx, conn, cmd.CommandID, protocol.ErrorBadCommand, "missing label")
				continue
			}
			sess.UpdateClient(cl, cmd.Client.Label, cmd.Client.Avatar)
		case protocol.CommandKickClient:
			if cl == nil || sess == nil {
				h.sendError(ctx, conn, cmd.CommandID, protocol.ErrorBadCommand, "not connected")
				continue
			}
			if targetClient := sess.GetClient(cmd.ClientID); targetClient != nil {
				if h.kickClientHost != nil {
					h.kickClientHost(targetClient.Token, targetClient.Join)
				}
			}
			sess.KickClient(cmd.ClientID)

		case protocol.CommandAck:
			if cl == nil || sess == nil {
				h.sendError(ctx, conn, cmd.CommandID, protocol.ErrorBadCommand, "not connected")
				continue
			}
			diag.Emit(ctx, h.logger, diag.LevelInfo, fmt.Sprintf("[WebSocket ACK RECEIVED] Client ID=%s (Peer=%s) acknowledged receipt of messageID=%s", cl.ID, cl.Peer, cmd.MessageID), nil, fields...)

		case protocol.CommandLoadHistory:
			if cl == nil || sess == nil {
				h.sendError(ctx, conn, cmd.CommandID, protocol.ErrorBadCommand, "not connected")
				continue
			}
			sess.LoadHistory(cl, cmd.JoinSeq, cmd.BeforeSeq, cmd.Limit, cmd.CommandID)

		case protocol.CommandLog:
			if cl != nil {
				h.writeClientLog(token, cl.Peer, cmd.Text)
				if h.debugLog() {
					diag.Emit(ctx, h.logger, diag.LevelInfo, fmt.Sprintf("[MOBILE:%s] %s", cl.Peer, cmd.Text), nil, fields...)
				}
			}

		case protocol.CommandReportProgress:
			if cl == nil || sess == nil {
				h.sendError(ctx, conn, cmd.CommandID, protocol.ErrorBadCommand, "not connected")
				continue
			}
			if cmd.MessageID == "" {
				h.sendError(ctx, conn, cmd.CommandID, protocol.ErrorBadCommand, "missing messageId")
				continue
			}
			jobID := "ul-" + cmd.MessageID
			_ = h.transfer.UpdateProgress(jobID, cmd.BytesDone)

		default:
			event := protocol.EventEnvelope{
				Type:      protocol.EventError,
				Seq:       0,
				Time:      h.now(),
				CommandID: cmd.CommandID,
				Error: &protocol.ErrorPayload{
					Code:    protocol.ErrorBadCommand,
					Message: "unsupported command",
				},
			}
			if cl != nil {
				cl.Send(event)
			} else {
				_ = wsjson.Write(ctx, conn, event)
			}
			diag.Emit(ctx, h.logger, diag.LevelDebug, "websocket event sent", nil,
				append(fields, diag.F("eventType", event.Type))...,
			)
		}
	}
}

func (h *WebSocketHandler) writeHello(ctx context.Context, conn *websocket.Conn) error {
	err := wsjson.Write(ctx, conn, protocol.EventEnvelope{
		Type: protocol.EventHello,
		Seq:  0,
		Time: h.now(),
	})
	if err == nil {
		diag.Emit(ctx, h.logger, diag.LevelDebug, "websocket event sent", nil,
			diag.F("eventType", protocol.EventHello),
		)
	}
	return err
}

func (h *WebSocketHandler) sendError(ctx context.Context, conn *websocket.Conn, commandID string, code protocol.ErrorCode, message string) {
	_ = wsjson.Write(ctx, conn, protocol.EventEnvelope{
		Type:      protocol.EventError,
		Seq:       0,
		Time:      h.now(),
		CommandID: commandID,
		Error: &protocol.ErrorPayload{
			Code:    code,
			Message: message,
		},
	})
	diag.Emit(ctx, h.logger, diag.LevelDebug, "websocket event sent", nil,
		diag.F("commandID", commandID),
		diag.F("eventType", protocol.EventError),
	)
}

func extractToken(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) >= 2 {
		return parts[len(parts)-2]
	}
	return "test-token"
}

func (h *WebSocketHandler) writeClientLog(token string, peer string, text string) {
	if !h.debugLog() {
		return
	}
	if peer == "" {
		peer = "unknown"
	}
	safePeer := sanitizeFilename(peer)

	var logDir string
	if h.logDir != nil {
		logDir = h.logDir()
	}
	if logDir == "" {
		dir, err := os.UserCacheDir()
		if err != nil {
			dir = os.TempDir()
		}
		logDir = filepath.Join(dir, "eqt")
	}

	sessionLogDir := logDir
	if token != "" {
		sessionLogDir = filepath.Join(logDir, fmt.Sprintf("session-%s", sanitizeFilename(token)))
	}
	_ = os.MkdirAll(sessionLogDir, 0755)

	logFilePath := filepath.Join(sessionLogDir, fmt.Sprintf("device-%s.log", safePeer))
	f, err := os.OpenFile(logFilePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return
	}
	defer f.Close()

	timestamp := time.Now().Format("2006-01-02 15:04:05.000")
	_, _ = fmt.Fprintf(f, "[%s] %s\n", timestamp, text)
}

func sanitizeFilename(s string) string {
	return strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r == ':' || r == '*' || r == '?' || r == '"' || r == '<' || r == '>' || r == '|' {
			return '_'
		}
		return r
	}, s)
}
