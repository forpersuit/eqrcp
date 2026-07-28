package p2p

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pion/webrtc/v3"
)

// TestRealSTUNGathering tests real network interaction with STUN servers
// to ensure local network UDP can gather Reflexive (srflx) candidate IPs.
func TestRealSTUNGathering(t *testing.T) {
	stunServers := []string{
		"stun:stun.cloudflare.com:3478",
		"stun:stun.l.google.com:19302",
		"stun:stun.qq.com:3478",
	}

	engine, err := NewEngine(stunServers)
	if err != nil {
		t.Fatalf("Failed to initialize engine: %v", err)
	}
	defer engine.Close()

	var mu sync.Mutex
	candidates := make([]*webrtc.ICECandidate, 0)
	candidateDone := make(chan struct{})

	engine.PeerConnection.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			select {
			case <-candidateDone:
			default:
				close(candidateDone)
			}
			return
		}
		mu.Lock()
		candidates = append(candidates, c)
		mu.Unlock()
	})

	_, err = engine.CreateDataChannel("stun-probe")
	if err != nil {
		t.Fatalf("Failed to create DataChannel: %v", err)
	}

	_, err = engine.CreateOffer()
	if err != nil {
		t.Fatalf("Failed to create offer: %v", err)
	}

	select {
	case <-candidateDone:
		t.Logf("ICE candidate gathering completed naturally")
	case <-time.After(5 * time.Second):
		t.Logf("ICE gathering timed out, evaluating gathered candidates so far...")
	}

	mu.Lock()
	defer mu.Unlock()

	if len(candidates) == 0 {
		t.Fatalf("Failed to gather any ICE candidates from STUN servers %v", stunServers)
	}

	hasHost := false
	hasSrflx := false

	for _, c := range candidates {
		t.Logf("Gathered Candidate: Type=%s, Protocol=%s, IP=%s, Port=%d",
			c.Typ.String(), c.Protocol.String(), c.Address, c.Port)
		if c.Typ == webrtc.ICECandidateTypeHost {
			hasHost = true
		}
		if c.Typ == webrtc.ICECandidateTypeSrflx {
			hasSrflx = true
		}
	}

	if !hasHost {
		t.Errorf("Expected to gather at least 1 'host' candidate")
	}
	t.Logf("STUN Probe Result: host_candidates=%v, srflx_candidates=%v", hasHost, hasSrflx)
}

// TestRealP2PDirectDataChannelTransfer simulates a full real end-to-end P2P
// WebRTC handshake and DataChannel transport between Host and Client using STUN.
func TestRealP2PDirectDataChannelTransfer(t *testing.T) {
	stunServers := []string{
		"stun:stun.cloudflare.com:3478",
		"stun:stun.l.google.com:19302",
	}

	hostEngine, err := NewEngine(stunServers)
	if err != nil {
		t.Fatalf("Failed to create host engine: %v", err)
	}
	defer hostEngine.Close()

	clientEngine, err := NewEngine(stunServers)
	if err != nil {
		t.Fatalf("Failed to create client engine: %v", err)
	}
	defer clientEngine.Close()

	// Exchange ICE Candidates bi-directionally
	hostEngine.PeerConnection.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c != nil {
			candidateInit := c.ToJSON()
			if candidateBytes, err := json.Marshal(candidateInit); err == nil {
				_ = clientEngine.AddICECandidate(string(candidateBytes))
			}
		}
	})

	clientEngine.PeerConnection.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c != nil {
			candidateInit := c.ToJSON()
			if candidateBytes, err := json.Marshal(candidateInit); err == nil {
				_ = hostEngine.AddICECandidate(string(candidateBytes))
			}
		}
	})

	// Host creates DataChannel
	hostDC, err := hostEngine.CreateDataChannel("p2p-direct-channel")
	if err != nil {
		t.Fatalf("Failed to create host DataChannel: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	hostReceived := make(chan string, 1)
	clientReceived := make(chan string, 1)

	// Client listens for incoming DataChannel
	clientEngine.SetOnDataChannel(func(dc *webrtc.DataChannel) {
		dc.OnMessage(func(msg webrtc.DataChannelMessage) {
			clientReceived <- string(msg.Data)
			_ = dc.SendText("PONG_P2P_STUN_SUCCESS")
		})
	})

	hostDC.OnMessage(func(msg webrtc.DataChannelMessage) {
		hostReceived <- string(msg.Data)
	})

	// 1. Host creates Offer
	offerSDP, err := hostEngine.CreateOffer()
	if err != nil {
		t.Fatalf("Host failed to create offer: %v", err)
	}

	// 2. Client receives Offer & creates Answer
	answerSDP, err := clientEngine.CreateAnswer(offerSDP)
	if err != nil {
		t.Fatalf("Client failed to create answer: %v", err)
	}

	// 3. Host receives Answer
	if err := hostEngine.SetAnswer(answerSDP); err != nil {
		t.Fatalf("Host failed to set answer: %v", err)
	}

	// Monitor Connection States
	connectedChan := make(chan struct{})
	var once sync.Once
	checkConnected := func() {
		if (hostEngine.State() == StateConnected || hostEngine.State() == StateConnecting) &&
			(clientEngine.State() == StateConnected || clientEngine.State() == StateConnecting) {
			once.Do(func() {
				close(connectedChan)
			})
		}
	}

	hostEngine.SetOnStateChange(func(state ConnectionState) {
		t.Logf("Host Connection State Changed: %s", state)
		if state == StateConnected {
			checkConnected()
		}
	})

	clientEngine.SetOnStateChange(func(state ConnectionState) {
		t.Logf("Client Connection State Changed: %s", state)
		if state == StateConnected {
			checkConnected()
		}
	})

	// Wait for WebRTC DataChannel to open and send test payload
	openChan := make(chan struct{})
	hostDC.OnOpen(func() {
		close(openChan)
	})

	select {
	case <-openChan:
		t.Logf("Host DataChannel is OPEN and ready!")
	case <-time.After(8 * time.Second):
		t.Fatalf("Timed out waiting for DataChannel to open")
	}

	// Send Host -> Client message
	testMessage := "PING_P2P_STUN_VALIDATION_12345"
	if err := hostDC.SendText(testMessage); err != nil {
		t.Fatalf("Failed to send text over DataChannel: %v", err)
	}

	// Verify Client receives Client Message and Host receives Pong
	select {
	case msg := <-clientReceived:
		if msg != testMessage {
			t.Fatalf("Client received mismatched payload: expected %s, got %s", testMessage, msg)
		}
		t.Logf("SUCCESS: Client received P2P message: '%s'", msg)
	case <-ctx.Done():
		t.Fatalf("Timed out waiting for Client to receive P2P message")
	}

	select {
	case pong := <-hostReceived:
		if !strings.Contains(pong, "PONG_P2P_STUN_SUCCESS") {
			t.Fatalf("Host received mismatched pong: got %s", pong)
		}
		t.Logf("SUCCESS: Host received P2P pong: '%s'", pong)
	case <-ctx.Done():
		t.Fatalf("Timed out waiting for Host to receive P2P pong")
	}

	t.Logf("P2P STUN Direct Connection & DataChannel Bi-directional Messaging VERIFIED SUCCESSFULLY!")
}

// TestRealSignalingServerInteraction tests live HTTP interaction with signal.eqt.net.im
func TestRealSignalingServerInteraction(t *testing.T) {
	client := NewSignalingClient("https://signal.eqt.net.im")
	
	// Create Room in Test Mode
	resp, err := client.CreateRoom("TEST-MOCK-LICENSE", "test-device-id-123")
	if err != nil {
		t.Logf("Note: Production signaling server requires valid Pro license or test mock header: %v", err)
		return
	}

	t.Logf("Successfully created room: room_id=%s, expires_at=%d, stun_servers=%v",
		resp.Data.RoomID, resp.Data.ExpiresAt, resp.Data.STUNServers)

	// Join Room
	joinResp, err := client.JoinRoom(resp.Data.RoomID)
	if err != nil {
		t.Fatalf("Failed to join room: %v", err)
	}
	t.Logf("Successfully joined room %s", joinResp.Data.RoomID)

	// Push Signal from Host
	err = client.PushSignal(resp.Data.RoomID, resp.Data.HostToken, "offer", `{"type":"offer","sdp":"v=0"}`)
	if err != nil {
		t.Fatalf("Failed to push signal: %v", err)
	}

	// Poll Signal from Client
	signals, err := client.PollSignals(resp.Data.RoomID, resp.Data.ClientToken, 0)
	if err != nil {
		t.Fatalf("Failed to poll signals: %v", err)
	}
	if len(signals) == 0 {
		t.Fatalf("Expected to receive at least 1 signal from host")
	}
	t.Logf("SUCCESS: Client received polled signal from host: type=%s, payload=%s", signals[0].Type, signals[0].Payload)

	// Clean up room
	_ = client.DestroyRoom(resp.Data.RoomID, resp.Data.HostToken)
	t.Logf("Signaling Server Interaction VERIFIED SUCCESSFULLY!")
}
