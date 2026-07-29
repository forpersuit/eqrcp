package p2p

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/pion/webrtc/v3"
)

type ConnectionState string

const (
	StateNew        ConnectionState = "new"
	StateConnecting ConnectionState = "connecting"
	StateConnected  ConnectionState = "connected"
	StateFailed     ConnectionState = "failed"
	StateClosed     ConnectionState = "closed"
)

type Engine struct {
	mu             sync.RWMutex
	PeerConnection *webrtc.PeerConnection
	DataChannel    *webrtc.DataChannel
	state          ConnectionState
	stunServers    []string
	onStateChange  func(ConnectionState)
	onDataChannel  func(*webrtc.DataChannel)
	onICECandidate func(*webrtc.ICECandidate)
	timeoutTimer   *time.Timer
	isClosed       bool
}

// DefaultSTUNServers fallback list when none provided.
var DefaultSTUNServers = []string{
	"stun:stun.cloudflare.com:3478",
	"stun:stun.l.google.com:19302",
	"stun:stun.qq.com:3478",
	"stun:stun.miwifi.com:3478",
}

// NewEngine initializes a new WebRTC P2P Engine.
func NewEngine(stunServers []string) (*Engine, error) {
	if len(stunServers) == 0 {
		stunServers = DefaultSTUNServers
	}

	iceServers := make([]webrtc.ICEServer, len(stunServers))
	for i, s := range stunServers {
		iceServers[i] = webrtc.ICEServer{URLs: []string{s}}
	}

	config := webrtc.Configuration{
		ICEServers: iceServers,
	}

	api := webrtc.NewAPI()
	pc, err := api.NewPeerConnection(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create PeerConnection: %w", err)
	}

	engine := &Engine{
		PeerConnection: pc,
		state:          StateNew,
		stunServers:    stunServers,
	}

	// Register ICE Connection State change callback
	pc.OnICEConnectionStateChange(func(iceState webrtc.ICEConnectionState) {
		engine.mu.Lock()
		defer engine.mu.Unlock()

		var newState ConnectionState
		switch iceState {
		case webrtc.ICEConnectionStateChecking:
			newState = StateConnecting
		case webrtc.ICEConnectionStateConnected, webrtc.ICEConnectionStateCompleted:
			newState = StateConnected
			if engine.timeoutTimer != nil {
				engine.timeoutTimer.Stop()
			}
		case webrtc.ICEConnectionStateFailed:
			newState = StateFailed
		case webrtc.ICEConnectionStateClosed, webrtc.ICEConnectionStateDisconnected:
			newState = StateClosed
		default:
			return
		}

		if engine.state != newState {
			engine.state = newState
			if engine.onStateChange != nil {
				go engine.onStateChange(newState)
			}
		}
	})

	// Handle ICE Candidates generated locally
	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		engine.mu.Lock()
		cb := engine.onICECandidate
		engine.mu.Unlock()
		if cb != nil {
			cb(c)
		}
	})

	// Handle remote incoming DataChannel

	pc.OnDataChannel(func(dc *webrtc.DataChannel) {
		engine.mu.Lock()
		engine.DataChannel = dc
		cb := engine.onDataChannel
		engine.mu.Unlock()

		if cb != nil {
			cb(dc)
		}
	})

	return engine, nil
}

// CreateDataChannel initializes a local DataChannel for the host.
func (e *Engine) CreateDataChannel(label string) (*webrtc.DataChannel, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.PeerConnection == nil {
		return nil, errors.New("PeerConnection is nil")
	}

	dc, err := e.PeerConnection.CreateDataChannel(label, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create DataChannel: %w", err)
	}
	e.DataChannel = dc
	return dc, nil
}

// CreateOffer generates a local WebRTC SDP Offer.
func (e *Engine) CreateOffer() (string, error) {
	offer, err := e.PeerConnection.CreateOffer(nil)
	if err != nil {
		return "", err
	}

	if err := e.PeerConnection.SetLocalDescription(offer); err != nil {
		return "", err
	}

	bytes, err := json.Marshal(offer)
	if err != nil {
		return "", err
	}
	return string(bytes), nil
}

// CreateAnswer generates a local WebRTC SDP Answer in response to an Offer.
func (e *Engine) CreateAnswer(offerSDP string) (string, error) {
	var sdpText string
	var payload struct {
		Type string `json:"type"`
		SDP  string `json:"sdp"`
	}

	if err := json.Unmarshal([]byte(offerSDP), &payload); err == nil && payload.SDP != "" {
		sdpText = payload.SDP
	} else {
		sdpText = offerSDP
	}

	// Unwrap double JSON stringification if present
	for i := 0; i < 3; i++ {
		trimmed := strings.TrimSpace(sdpText)
		if strings.HasPrefix(trimmed, "{") {
			var subPayload struct {
				Type string `json:"type"`
				SDP  string `json:"sdp"`
			}
			if err := json.Unmarshal([]byte(trimmed), &subPayload); err == nil && subPayload.SDP != "" {
				sdpText = subPayload.SDP
				continue
			}
		}
		if strings.HasPrefix(trimmed, "\"") {
			var unescaped string
			if err := json.Unmarshal([]byte(trimmed), &unescaped); err == nil && unescaped != "" {
				sdpText = unescaped
				continue
			}
		}
		break
	}

	// Fallback fix if client SDP lacks ice-ufrag, mid, fingerprint or data channel m-line
	if !strings.Contains(sdpText, "a=ice-ufrag:") {
		sdpText += "\r\na=ice-ufrag:eqtP2pUfrag\r\na=ice-pwd:eqtP2pPassword123456789\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=sctp-port:5000\r\n"
	}
	if !strings.Contains(sdpText, "a=mid:") {
		sdpText += "a=mid:0\r\n"
	}
	if !strings.Contains(sdpText, "a=fingerprint:") {
		sdpText += "a=fingerprint:sha-256 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00\r\n"
	}

	offer := webrtc.SessionDescription{
		Type: webrtc.SDPTypeOffer,
		SDP:  sdpText,
	}

	prefix := sdpText
	if len(prefix) > 50 {
		prefix = prefix[:50]
	}
	log.Printf("[WAN P2P Engine] Extracted SDP Text len=%d, prefix=%q", len(sdpText), prefix)

	if err := e.PeerConnection.SetRemoteDescription(offer); err != nil {
		return "", fmt.Errorf("failed to set remote description: %w (SDP len=%d)", err, len(sdpText))
	}

	answer, err := e.PeerConnection.CreateAnswer(nil)
	if err != nil {
		return "", err
	}

	if err := e.PeerConnection.SetLocalDescription(answer); err != nil {
		return "", err
	}

	bytes, err := json.Marshal(answer)
	if err != nil {
		return "", err
	}
	return string(bytes), nil
}

// SetAnswer receives and applies the remote SDP Answer.
func (e *Engine) SetAnswer(answerSDP string) error {
	var answer webrtc.SessionDescription
	if err := json.Unmarshal([]byte(answerSDP), &answer); err != nil {
		return fmt.Errorf("invalid answer SDP: %w", err)
	}
	return e.PeerConnection.SetRemoteDescription(answer)
}

// AddICECandidate adds a remote ICE candidate.
func (e *Engine) AddICECandidate(candidateJSON string) error {
	var candidate webrtc.ICECandidateInit
	if err := json.Unmarshal([]byte(candidateJSON), &candidate); err != nil {
		return fmt.Errorf("invalid ICE candidate: %w", err)
	}
	return e.PeerConnection.AddICECandidate(candidate)
}

// StartHolePunchTimeout sets a timer for hole punching (default 15s).
func (e *Engine) StartHolePunchTimeout(duration time.Duration) {
	e.mu.Lock()
	defer e.mu.Unlock()

	if duration <= 0 {
		duration = 15 * time.Second
	}

	e.timeoutTimer = time.AfterFunc(duration, func() {
		e.mu.Lock()
		defer e.mu.Unlock()

		if e.state != StateConnected && e.state != StateClosed {
			e.state = StateFailed
			if e.onStateChange != nil {
				go e.onStateChange(StateFailed)
			}
		}
	})
}

// SetOnStateChange registers callback for connection state transitions.
func (e *Engine) SetOnStateChange(cb func(ConnectionState)) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.onStateChange = cb
}

// SetOnDataChannel registers callback for incoming DataChannel.
func (e *Engine) SetOnDataChannel(cb func(*webrtc.DataChannel)) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.onDataChannel = cb
}

// SetOnICECandidate registers callback for locally generated ICE Candidates.
func (e *Engine) SetOnICECandidate(cb func(*webrtc.ICECandidate)) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.onICECandidate = cb
}

// State returns current connection state.
func (e *Engine) State() ConnectionState {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.state
}

// Close gracefully closes the PeerConnection.
func (e *Engine) Close() error {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.isClosed {
		return nil
	}
	e.isClosed = true
	e.state = StateClosed

	if e.timeoutTimer != nil {
		e.timeoutTimer.Stop()
	}
	if e.PeerConnection != nil {
		return e.PeerConnection.Close()
	}
	return nil
}
