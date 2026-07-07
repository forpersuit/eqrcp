package transport

import (
	"context"
	"net/http"
	"time"

	"eqt/pkg/chat/v2/diag"
	"eqt/pkg/chat/v2/protocol"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

const (
	DefaultReadLimit = 64 << 10
)

// WebSocketConfig configures the v2 control-plane WebSocket handler.
type WebSocketConfig struct {
	Logger diag.Logger
	Now    func() time.Time
}

// WebSocketHandler handles v2 control-plane WebSocket connections.
type WebSocketHandler struct {
	logger diag.Logger
	now    func() time.Time
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
	return &WebSocketHandler{
		logger: logger,
		now:    now,
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

	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		diag.Emit(r.Context(), h.logger, diag.LevelWarn, "websocket accept failed", err,
			diag.F("path", r.URL.Path),
		)
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "closed")
	conn.SetReadLimit(DefaultReadLimit)

	ctx := context.Background()
	diag.Emit(ctx, h.logger, diag.LevelInfo, "websocket connected", nil,
		diag.F("path", r.URL.Path),
		diag.F("subprotocol", conn.Subprotocol()),
	)

	if err := h.writeHello(ctx, conn); err != nil {
		diag.Emit(ctx, h.logger, diag.LevelWarn, "websocket hello failed", err,
			diag.F("path", r.URL.Path),
		)
		return
	}

	for {
		var cmd protocol.CommandEnvelope
		if err := wsjson.Read(ctx, conn, &cmd); err != nil {
			diag.Emit(ctx, h.logger, diag.LevelInfo, "websocket disconnected", err,
				diag.F("path", r.URL.Path),
			)
			return
		}
		if !h.handleCommand(ctx, conn, cmd, r.URL.Path) {
			return
		}
	}
}

func (h *WebSocketHandler) writeHello(ctx context.Context, conn *websocket.Conn) error {
	return wsjson.Write(ctx, conn, protocol.EventEnvelope{
		Type: protocol.EventHello,
		Seq:  0,
		Time: h.now(),
	})
}

func (h *WebSocketHandler) handleCommand(ctx context.Context, conn *websocket.Conn, cmd protocol.CommandEnvelope, path string) bool {
	fields := []diag.Field{
		diag.F("path", path),
		diag.F("commandType", cmd.Type),
		diag.F("commandID", cmd.CommandID),
	}
	diag.Emit(ctx, h.logger, diag.LevelDebug, "websocket command received", nil, fields...)

	switch cmd.Type {
	case protocol.CommandConnect:
		return h.writeEvent(ctx, conn, protocol.EventEnvelope{
			Type:      protocol.EventHello,
			Seq:       0,
			Time:      h.now(),
			CommandID: cmd.CommandID,
		}, fields...)
	case protocol.CommandHeartbeat:
		return h.writeEvent(ctx, conn, protocol.EventEnvelope{
			Type:      protocol.EventHeartbeat,
			Seq:       0,
			Time:      h.now(),
			CommandID: cmd.CommandID,
		}, fields...)
	default:
		return h.writeEvent(ctx, conn, protocol.EventEnvelope{
			Type:      protocol.EventError,
			Seq:       0,
			Time:      h.now(),
			CommandID: cmd.CommandID,
			Error: &protocol.ErrorPayload{
				Code:    protocol.ErrorBadCommand,
				Message: "unsupported command",
			},
		}, fields...)
	}
}

func (h *WebSocketHandler) writeEvent(ctx context.Context, conn *websocket.Conn, event protocol.EventEnvelope, fields ...diag.Field) bool {
	if err := wsjson.Write(ctx, conn, event); err != nil {
		diag.Emit(ctx, h.logger, diag.LevelWarn, "websocket write failed", err, fields...)
		return false
	}
	diag.Emit(ctx, h.logger, diag.LevelDebug, "websocket event sent", nil,
		append(fields, diag.F("eventType", event.Type))...,
	)
	return true
}
