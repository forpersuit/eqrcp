package session

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"

	"eqt/pkg/chat/v2/protocol"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// Client represents a connected WebSocket client.
type Client struct {
	ID        string
	Label     string
	Avatar    string
	Theme     string
	Peer      string
	Token     string
	Join      string
	LocalJoin string
	LastSeen  time.Time
	JoinTime  time.Time
	Kicked    bool

	sendChan  chan protocol.EventEnvelope
	done      chan struct{}
	closeOnce sync.Once
	conn      *websocket.Conn
}

// NewClient creates a new client.
func NewClient(info protocol.ClientInfo, conn *websocket.Conn) *Client {
	id := generateID()
	peer := info.Peer
	if peer == "" {
		peer = id[:8] // fallback to partial ID
	}
	return &Client{
		ID:        id,
		Label:     info.Label,
		Avatar:    info.Avatar,
		Theme:     info.Theme,
		Peer:      peer,
		Token:     info.Token,
		Join:      info.Join,
		LocalJoin: info.LocalJoin,
		LastSeen:  time.Now(),
		JoinTime:  time.Now(),
		sendChan:  make(chan protocol.EventEnvelope, 128),
		done:      make(chan struct{}),
		conn:      conn,
	}
}

// Send attempts to send an event to the client.
// Returns false if the send buffer is full or the client is closed.
func (c *Client) Send(event protocol.EventEnvelope) bool {
	select {
	case <-c.done:
		return false
	case c.sendChan <- event:
		return true
	default:
		// Try writing with a 200ms timeout to prevent instant drops during burst events like history replay
		select {
		case <-c.done:
			return false
		case c.sendChan <- event:
			return true
		case <-time.After(200 * time.Millisecond):
			// Send queue is full and timed out, close client connection to prevent starvation
			c.Close()
			return false
		}
	}
}

// CloseReasonReplaced is sent when a newer connection for the same peer
// takes over (same browser/device, single live socket per room).
const CloseReasonReplaced = "replaced_by_peer"

// Close closes the client's send queue and WebSocket connection.
func (c *Client) Close() {
	c.CloseWithReason(websocket.StatusNormalClosure, "closing connection")
}

// CloseReplaced closes the socket because another connection with the same
// peer registered. The client must not treat this as a force-kick and must
// not auto-reconnect (otherwise tabs fight for the single peer slot).
func (c *Client) CloseReplaced() {
	c.CloseWithReason(websocket.StatusNormalClosure, CloseReasonReplaced)
}

// CloseWithReason closes the client's send queue and WebSocket with an explicit code/reason.
func (c *Client) CloseWithReason(code websocket.StatusCode, reason string) {
	c.closeOnce.Do(func() {
		close(c.done)
		if c.conn != nil {
			_ = c.conn.Close(code, reason)
		}
	})
}

// WritePump runs the write loop for the client.
func (c *Client) WritePump(ctx context.Context) {
	for {
		select {
		case event, ok := <-c.sendChan:
			if !ok {
				return
			}
			writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := wsjson.Write(writeCtx, c.conn, event)
			cancel()
			if err != nil {
				c.Close()
				return
			}
		case <-c.done:
			return
		case <-ctx.Done():
			return
		}
	}
}

// ToDevice converts Client to a protocol.Device struct.
func (c *Client) ToDevice() protocol.Device {
	return protocol.Device{
		ID:       c.ID,
		Label:    c.Label,
		Avatar:   c.Avatar,
		Theme:    c.Theme,
		Peer:     c.Peer,
		LastSeen: c.LastSeen,
	}
}

func generateID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
