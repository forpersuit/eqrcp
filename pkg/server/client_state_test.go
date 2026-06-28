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
