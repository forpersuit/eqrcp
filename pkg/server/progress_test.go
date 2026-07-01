package server

import (
	"eqt/pkg/body"
	"net/http/httptest"
	"testing"
)

func TestParseRangeHeader(t *testing.T) {
	tests := []struct {
		name        string
		rangeHeader string
		wantRange   bool
		wantStart   int64
		wantEnd     int64
	}{
		{
			name:        "No Range Header",
			rangeHeader: "",
			wantRange:   false,
			wantStart:   0,
			wantEnd:     0,
		},
		{
			name:        "Standard Open Range",
			rangeHeader: "bytes=1000-",
			wantRange:   true,
			wantStart:   1000,
			wantEnd:     0,
		},
		{
			name:        "Standard Closed Range",
			rangeHeader: "bytes=2000-5000",
			wantRange:   true,
			wantStart:   2000,
			wantEnd:     5000,
		},
		{
			name:        "Invalid Range Format Type",
			rangeHeader: "items=0-50",
			wantRange:   false,
			wantStart:   0,
			wantEnd:     0,
		},
		{
			name:        "Invalid Non-Numeric Start",
			rangeHeader: "bytes=abc-",
			wantRange:   false,
			wantStart:   0,
			wantEnd:     0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/download", nil)
			if tt.rangeHeader != "" {
				req.Header.Set("Range", tt.rangeHeader)
			}

			got := ParseRangeHeader(req)
			if got.HasRange != tt.wantRange {
				t.Errorf("ParseRangeHeader().HasRange = %v, want %v", got.HasRange, tt.wantRange)
			}
			if got.StartByte != tt.wantStart {
				t.Errorf("ParseRangeHeader().StartByte = %d, want %d", got.StartByte, tt.wantStart)
			}
			if got.EndByte != tt.wantEnd {
				t.Errorf("ParseRangeHeader().EndByte = %d, want %d", got.EndByte, tt.wantEnd)
			}
		})
	}
}

func TestCalculatePercent(t *testing.T) {
	tests := []struct {
		done  int64
		total int64
		want  int
	}{
		{0, 100, 0},
		{50, 100, 50},
		{100, 100, 100},
		{120, 100, 100},
		{50, 0, 0},
		{-5, 100, 0},
	}

	for _, tt := range tests {
		got := CalculatePercent(tt.done, tt.total)
		if got != tt.want {
			t.Errorf("CalculatePercent(%d, %d) = %d, want %d", tt.done, tt.total, got, tt.want)
		}
	}
}

func TestResumableProgressFlow(t *testing.T) {
	s := &Server{
		clientStates:   make(map[string]*ClientTransferStateInfo),
		clientProgress: make(map[string]map[int]int64),
		expectedBytes:  make(map[int]int64),
		body:           body.Body{Paths: []string{"test_resumable_file.bin"}},
	}

	clientID := "cli_resumable_test"
	s.clientStates[clientID] = &ClientTransferStateInfo{}
	expectedBytes := int64(10000)
	s.expectedBytes[0] = expectedBytes

	// 场景 1：模拟客户端发起一个 Range: bytes=3000- 的断点续传请求
	req := httptest.NewRequest("GET", "/download", nil)
	req.Header.Set("Range", "bytes=3000-")

	rangeInfo := ParseRangeHeader(req)
	if !rangeInfo.HasRange || rangeInfo.StartByte != 3000 {
		t.Fatalf("Range header parse error in workflow, got startByte = %d", rangeInfo.StartByte)
	}

	// 模拟路由处理中的初始化
	s.setClientDownloadedBytes(clientID, 0, rangeInfo.StartByte)
	s.updateClientStatus(clientID, req, func(state *ClientTransferStateInfo) {
		state.State = "transferring"
		state.Current = "test_resumable_file.bin"
		state.BytesDone = rangeInfo.StartByte
		state.BytesTotal = expectedBytes
		state.Percent = transferPercent(state.BytesDone, state.BytesTotal)
	})

	state := s.getClientStatus(clientID)
	if state.BytesDone != 3000 || state.Percent != 30 {
		t.Errorf("After initialization, BytesDone = %d, Percent = %d; want 3000, 30", state.BytesDone, state.Percent)
	}

	// 场景 2：中途断开，只写了 2000 字节（此时已写累计 5000 字节，尚未达到 10000 字节）
	s.addClientDownloadedBytes(clientID, 0, 2000)
	currentProgress := s.clientProgress[clientID][0]

	// 模拟写入异常中断逻辑，需要确保不会将进度清零
	s.updateClientStatus(clientID, req, func(state *ClientTransferStateInfo) {
		state.State = "waiting"
		state.BytesDone = currentProgress
		state.Percent = transferPercent(state.BytesDone, state.BytesTotal)
		state.Message = "Transfer interrupted. Waiting for retry..."
	})

	state = s.getClientStatus(clientID)
	if state.State != "waiting" || state.BytesDone != 5000 || state.Percent != 50 {
		t.Errorf("After interruption, State = %q, BytesDone = %d, Percent = %d; want \"waiting\", 5000, 50", state.State, state.BytesDone, state.Percent)
	}

	// 场景 3：客户端重连下载剩下的 5000 字节
	req2 := httptest.NewRequest("GET", "/download", nil)
	req2.Header.Set("Range", "bytes=5000-")
	rangeInfo2 := ParseRangeHeader(req2)

	// 重连初始化进度
	s.setClientDownloadedBytes(clientID, 0, rangeInfo2.StartByte)
	s.updateClientStatus(clientID, req2, func(state *ClientTransferStateInfo) {
		state.State = "transferring"
		state.BytesDone = rangeInfo2.StartByte
		state.Percent = transferPercent(state.BytesDone, state.BytesTotal)
	})

	state = s.getClientStatus(clientID)
	if state.BytesDone != 5000 || state.State != "transferring" {
		t.Errorf("After reconnect, BytesDone = %d, State = %q; want 5000, \"transferring\"", state.BytesDone, state.State)
	}

	// 下载完成剩余的 5000 字节
	s.addClientDownloadedBytes(clientID, 0, 5000)
	finalWritten := s.clientProgress[clientID][0]

	if finalWritten >= expectedBytes {
		s.updateClientStatus(clientID, req2, func(state *ClientTransferStateInfo) {
			state.State = "completed"
			state.BytesDone = state.BytesTotal
			state.Percent = 100
		})
	}

	state = s.getClientStatus(clientID)
	if state.State != "completed" || state.BytesDone != 10000 || state.Percent != 100 {
		t.Errorf("At completion, State = %q, BytesDone = %d, Percent = %d; want \"completed\", 10000, 100", state.State, state.BytesDone, state.Percent)
	}
}
