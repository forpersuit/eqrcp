package server

import (
	"net/http/httptest"
	"testing"
	"time"

	"eqt/pkg/body"
)

func TestParseDeviceName(t *testing.T) {
	tests := []struct {
		ua   string
		want string
	}{
		{
			ua:   "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1",
			want: "iPhone",
		},
		{
			ua:   "Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
			want: "Android",
		},
		{
			ua:   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
			want: "Windows",
		},
		{
			ua:   "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
			want: "Mac",
		},
		{
			ua:   "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
			want: "Linux",
		},
		{
			ua:   "Mozilla/5.0 (iPad; CPU OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1",
			want: "iPad",
		},
		{
			ua:   "Unknown UA String",
			want: "Mobile Device",
		},
	}

	for _, tt := range tests {
		got := parseDeviceName(tt.ua)
		if got != tt.want {
			t.Errorf("parseDeviceName(%q) = %q, want %q", tt.ua, got, tt.want)
		}
	}
}

func TestClientStatesCopy(t *testing.T) {
	s := &Server{
		clientStates: make(map[string]*ClientTransferStateInfo),
	}

	s.clientStates["cli_test"] = &ClientTransferStateInfo{
		State:      "transferring",
		BytesDone:  500,
		BytesTotal: 1000,
		Percent:    50,
		Current:    "file.txt",
		Message:    "Sending",
		DeviceName: "iPhone",
	}

	copied := s.copyClientStates()
	if copied == nil {
		t.Fatal("copyClientStates returned nil")
	}

	copiedState, ok := copied["cli_test"]
	if !ok {
		t.Fatal("copied states missing cli_test key")
	}

	if copiedState.State != "transferring" || copiedState.DeviceName != "iPhone" || copiedState.BytesDone != 500 {
		t.Errorf("copied state values mismatch: %+v", copiedState)
	}

	// Verify deep copy by mutating copy and asserting original is unchanged
	copiedState.State = "completed"
	if s.clientStates["cli_test"].State != "transferring" {
		t.Error("mutating copied state changed original state (not a deep copy)")
	}
}

func TestClientFinishedVerification(t *testing.T) {
	s := &Server{
		clientProgress: make(map[string]map[int]int64),
		expectedBytes:  make(map[int]int64),
		body: body.Body{
			Paths: []string{"file1.txt", "file2.txt"},
		},
	}

	clientID := "cli_123"

	// Init progress
	s.clientProgress[clientID] = make(map[int]int64)

	// Set expectations
	s.expectedBytes[0] = 1000
	s.expectedBytes[1] = 2000

	// Case 1: Progress is incomplete
	s.clientProgress[clientID][0] = 1000
	s.clientProgress[clientID][1] = 1500 // less than 2000

	if s.isClientFinished(clientID) {
		t.Error("isClientFinished returned true for incomplete progress")
	}

	// Case 2: Progress is complete
	s.clientProgress[clientID][1] = 2000
	if !s.isClientFinished(clientID) {
		t.Error("isClientFinished returned false for complete progress")
	}
}

func TestSingleDeviceAutoStopTrigger(t *testing.T) {
	stopChan := make(chan bool, 1)

	s := &Server{
		clientStates:   make(map[string]*ClientTransferStateInfo),
		clientProgress: make(map[string]map[int]int64),
		expectedBytes:  make(map[int]int64),
		autoStop:       true,
		body: body.Body{
			Paths: []string{"testfile.txt"},
		},
		stopChannel: stopChan,
	}

	clientID := "cli_test_stop"
	s.clientStates[clientID] = &ClientTransferStateInfo{}
	s.clientProgress[clientID] = make(map[int]int64)
	s.expectedBytes[0] = 500

	// Simulate complete download
	s.clientProgress[clientID][0] = 500

	// Emulate request context
	req := httptest.NewRequest("GET", "/download", nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X)")

	// Trigger completion handler logic block (ServeFile tail)
	if s.isClientFinished(clientID) {
		s.updateClientStatus(clientID, req, func(state *ClientTransferStateInfo) {
			state.State = "completed"
		})

		s.statusMu.Lock()
		autoStop := s.autoStop
		s.statusMu.Unlock()

		if autoStop {
			s.setStatus("completed", "Transfer completed.")
			go func() {
				s.signalStop()
			}()
		}
	}

	select {
	case <-stopChan:
		// Success: shutdown signal sent
	case <-time.After(2 * time.Second):
		t.Error("timeout waiting for auto-stop shutdown signal")
	}

	s.statusMu.Lock()
	state := s.status.State
	s.statusMu.Unlock()
	if state != "completed" {
		t.Errorf("global server status state = %q, want \"completed\"", state)
	}

	// Assert User-Agent parsing successfully occurred during updateClientStatus
	clientStatus := s.getClientStatus(clientID)
	if clientStatus.DeviceName != "iPhone (stop)" {
		t.Errorf("DeviceName = %q, want \"iPhone (stop)\"", clientStatus.DeviceName)
	}
}

func TestSetAutoStopLiveTrigger(t *testing.T) {
	stopChan := make(chan bool, 1)

	s := &Server{
		clientStates:           make(map[string]*ClientTransferStateInfo),
		clientProgress:         make(map[string]map[int]int64),
		expectedBytes:          make(map[int]int64),
		clientLastSeen:         make(map[string]time.Time),
		autoStopIgnoredClients: make(map[string]bool),
		autoStop:               false,
		body: body.Body{
			Paths: []string{"testfile.txt"},
		},
		stopChannel: stopChan,
	}

	clientID := "cli_live_test"
	s.clientLastSeen[clientID] = time.Now()
	s.clientStates[clientID] = &ClientTransferStateInfo{}
	s.clientProgress[clientID] = make(map[int]int64)
	s.expectedBytes[0] = 500

	// 1. Simulate complete download
	s.clientProgress[clientID][0] = 500

	// 2. SetAutoStop is false, so calling it should NOT trigger stop
	s.SetAutoStop(false)
	select {
	case <-stopChan:
		t.Error("stopChannel received signal even though autoStop is false")
	case <-time.After(100 * time.Millisecond):
		// Expected
	}

	// 3. Now toggling SetAutoStop to true.
	// Since download was completed before SetAutoStop(true) was toggled, this client should be IGNORED
	// and it should NOT trigger immediate shutdown.
	s.SetAutoStop(true)

	select {
	case <-stopChan:
		t.Error("stopChannel received signal even though the completed client should be ignored")
	case <-time.After(150 * time.Millisecond):
		// Expected: no immediate stop signal
	}

	// 4. Now simulate a NEW client completing download. This should trigger shutdown.
	newClientID := "cli_live_test_new"
	s.clientMutex.Lock()
	s.clientLastSeen[newClientID] = time.Now()
	s.clientStates[newClientID] = &ClientTransferStateInfo{}
	s.clientProgress[newClientID] = make(map[int]int64)
	s.clientMutex.Unlock()

	s.clientProgress[newClientID][0] = 500

	if s.isClientFinished(newClientID) {
		s.updateClientStatus(newClientID, nil, func(state *ClientTransferStateInfo) {
			state.State = "completed"
		})

		allDownloaded := s.isAllActiveClientsFinished()
		if allDownloaded {
			s.statusMu.Lock()
			autoStop := s.autoStop
			s.statusMu.Unlock()
			if autoStop {
				s.setStatus("completed", "Transfer completed.")
				go s.signalStop()
			}
		}
	}

	select {
	case <-stopChan:
		// Success: new client triggered shutdown
	case <-time.After(2 * time.Second):
		t.Error("timeout waiting for new client auto-stop shutdown signal")
	}

	s.statusMu.Lock()
	state := s.status.State
	s.statusMu.Unlock()
	if state != "completed" {
		t.Errorf("global server status state = %q, want \"completed\"", state)
	}
}

func TestMultiDeviceAutoStopRules(t *testing.T) {
	stopChan := make(chan bool, 1)

	s := &Server{
		clientStates:   make(map[string]*ClientTransferStateInfo),
		clientProgress: make(map[string]map[int]int64),
		expectedBytes:  make(map[int]int64),
		clientLastSeen: make(map[string]time.Time),
		autoStop:       true,
		body: body.Body{
			Paths: []string{"testfile.txt"},
		},
		stopChannel: stopChan,
	}

	// 1. Register two active clients
	cliA := "cli_A"
	cliB := "cli_B"
	s.clientLastSeen[cliA] = time.Now()
	s.clientLastSeen[cliB] = time.Now()
	s.clientStates[cliA] = &ClientTransferStateInfo{}
	s.clientStates[cliB] = &ClientTransferStateInfo{}
	s.clientProgress[cliA] = make(map[int]int64)
	s.clientProgress[cliB] = make(map[int]int64)
	s.expectedBytes[0] = 500

	// 2. Client A finishes downloading.
	s.clientProgress[cliA][0] = 500
	
	// Single client finished in multiple clients setting must NOT close channel
	if s.isClientFinished(cliA) {
		s.updateClientStatus(cliA, nil, func(state *ClientTransferStateInfo) {
			state.State = "completed"
		})
		
		// Simulated ServeFile completion logic
		allDownloaded := s.isAllActiveClientsFinished()
		if allDownloaded {
			s.statusMu.Lock()
			autoStop := s.autoStop
			s.statusMu.Unlock()
			if autoStop {
				s.setStatus("completed", "Transfer completed.")
				go s.signalStop()
			}
		}
	}

	// Verify channel remains open
	select {
	case <-stopChan:
		t.Error("stopChannel received signal prematurely when only client A completed")
	case <-time.After(100 * time.Millisecond):
		// Expected: channel remains active
	}

	// Verify server state is NOT completed
	s.statusMu.Lock()
	state1 := s.status.State
	s.statusMu.Unlock()
	if state1 == "completed" {
		t.Error("server status state changed to completed prematurely")
	}

	// 3. Client B also finishes downloading (meaning all active clients finished).
	s.clientProgress[cliB][0] = 500
	if s.isClientFinished(cliB) {
		s.updateClientStatus(cliB, nil, func(state *ClientTransferStateInfo) {
			state.State = "completed"
		})

		allDownloaded := s.isAllActiveClientsFinished()
		if allDownloaded {
			s.statusMu.Lock()
			autoStop := s.autoStop
			s.statusMu.Unlock()
			if autoStop {
				s.setStatus("completed", "Transfer completed.")
				go s.signalStop()
			}
		}
	}

	// Verify channel is closed successfully now
	select {
	case <-stopChan:
		// Success: all devices finished, channel closed
	case <-time.After(2 * time.Second):
		t.Error("timeout waiting for auto-stop signal after all devices finished")
	}

	s.statusMu.Lock()
	state2 := s.status.State
	s.statusMu.Unlock()
	if state2 != "completed" {
		t.Errorf("server state = %q, want \"completed\" after all clients finished", state2)
	}
}

func TestAutoStopWhenAllInactiveButFinished(t *testing.T) {
	stopChan := make(chan bool, 1)

	s := &Server{
		clientStates:           make(map[string]*ClientTransferStateInfo),
		clientProgress:         make(map[string]map[int]int64),
		expectedBytes:          make(map[int]int64),
		clientLastSeen:         make(map[string]time.Time),
		autoStopIgnoredClients: make(map[string]bool),
		autoStop:               false,
		body: body.Body{
			Paths: []string{"testfile.txt"},
		},
		stopChannel: stopChan,
	}

	// 1. Register two clients
	cliA := "cli_A"
	cliB := "cli_B"
	// Set last seen to 10 seconds ago (inactive)
	s.clientLastSeen[cliA] = time.Now().Add(-10 * time.Second)
	s.clientLastSeen[cliB] = time.Now().Add(-10 * time.Second)
	s.clientStates[cliA] = &ClientTransferStateInfo{}
	s.clientStates[cliB] = &ClientTransferStateInfo{}
	s.clientProgress[cliA] = make(map[int]int64)
	s.clientProgress[cliB] = make(map[int]int64)
	s.expectedBytes[0] = 500

	// 2. Both completed downloading
	s.clientProgress[cliA][0] = 500
	s.clientProgress[cliB][0] = 500

	// 3. Trigger SetAutoStop(true). Since they were already completed, they should be ignored, and no stop signal should fire.
	s.SetAutoStop(true)

	select {
	case <-stopChan:
		t.Error("stopChannel received signal even though all completed clients should be ignored at SetAutoStop(true) toggle-on")
	case <-time.After(150 * time.Millisecond):
		// Expected: no immediate stop signal
	}

	// 4. Register a new client cliC and complete its download. This should trigger shutdown.
	cliC := "cli_C"
	s.clientMutex.Lock()
	s.clientLastSeen[cliC] = time.Now()
	s.clientStates[cliC] = &ClientTransferStateInfo{}
	s.clientProgress[cliC] = make(map[int]int64)
	s.clientMutex.Unlock()

	s.clientProgress[cliC][0] = 500

	if s.isClientFinished(cliC) {
		s.updateClientStatus(cliC, nil, func(state *ClientTransferStateInfo) {
			state.State = "completed"
		})

		allDownloaded := s.isAllActiveClientsFinished()
		if allDownloaded {
			s.statusMu.Lock()
			autoStop := s.autoStop
			s.statusMu.Unlock()
			if autoStop {
				s.setStatus("completed", "Transfer completed.")
				go s.signalStop()
			}
		}
	}

	select {
	case <-stopChan:
		// Success
	case <-time.After(2 * time.Second):
		t.Error("timeout waiting for new client auto-stop shutdown signal")
	}

	s.statusMu.Lock()
	state := s.status.State
	s.statusMu.Unlock()
	if state != "completed" {
		t.Errorf("global server status state = %q, want \"completed\"", state)
	}
}

func TestSetAutoStopReceiveMode(t *testing.T) {
	stopChan := make(chan bool, 1)

	s := &Server{
		clientStates:           make(map[string]*ClientTransferStateInfo),
		clientProgress:         make(map[string]map[int]int64),
		expectedBytes:          make(map[int]int64),
		clientLastSeen:         make(map[string]time.Time),
		autoStopIgnoredClients: make(map[string]bool),
		autoStop:               false,
		body: body.Body{
			Paths: []string{}, // Receive mode: empty paths
		},
		stopChannel: stopChan,
	}
	s.status.Mode = "receive"

	clientID := "cli_receive_test"
	s.clientLastSeen[clientID] = time.Now()
	s.clientStates[clientID] = &ClientTransferStateInfo{}

	// Toggling SetAutoStop to true should NOT trigger shutdown because paths is empty (receive mode)
	s.SetAutoStop(true)

	select {
	case <-stopChan:
		t.Error("stopChannel received signal in receive mode immediately when SetAutoStop was toggled to true")
	case <-time.After(150 * time.Millisecond):
		// Expected
	}
}



