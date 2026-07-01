package server

import (
	"eqt/pkg/body"
	"eqt/pkg/config"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
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

func TestServerResumableMultiDeviceIntegration(t *testing.T) {
	// 1. 创建测试目录，自动探测 /mnt/e/developer/results
	testDir := "/mnt/e/developer/results"
	if _, err := os.Stat(testDir); err != nil {
		testDir = t.TempDir()
	}

	// 准备测试文件 (单文件与多文件)
	singleFile := filepath.Join(testDir, "test_resumable_single.bin")
	_ = os.WriteFile(singleFile, make([]byte, 1024*1024), 0644) // 1MB 零字节文件

	file1 := filepath.Join(testDir, "test_file1.txt")
	file2 := filepath.Join(testDir, "test_file2.txt")
	_ = os.WriteFile(file1, []byte("resumable file 1 content"), 0644)
	_ = os.WriteFile(file2, []byte("resumable file 2 content"), 0644)

	// ==========================================
	// 场景一：单文件下载模式下的多设备进度隔离与断点续传
	// ==========================================
	t.Run("SingleFileDownload", func(t *testing.T) {
		cfg := &config.Config{
			Interface: "any",
			Port:      0,
			KeepAlive: true,
		}
		app, err := New(cfg)
		if err != nil {
			t.Fatal(err)
		}
		payload, err := body.FromArgs([]string{singleFile}, false)
		if err != nil {
			t.Fatal(err)
		}
		app.Send(payload)
		defer app.Shutdown()

		assertClientStatus := func(clientID string, wantBytes int64, wantState string) {
			t.Helper()
			var lastState ClientTransferStateInfo
			for start := time.Now(); time.Since(start) < 1*time.Second; time.Sleep(10 * time.Millisecond) {
				lastState = app.getClientStatus(clientID)
				if lastState.BytesDone == wantBytes && lastState.State == wantState {
					return
				}
			}
			t.Errorf("Client %s status mismatch. Got BytesDone=%d, State=%s; want BytesDone=%d, State=%s",
				clientID, lastState.BytesDone, lastState.State, wantBytes, wantState)
		}

		// 模拟设备 A (client_id=device_A) 发起断点下载：下载前 200KB 字节后主动关闭连接
		reqDownA, _ := http.NewRequest(http.MethodGet, app.SendURL+"?download=1&client_id=device_A", nil)
		reqDownA.Header.Set("Range", "bytes=0-204799") // 只请求前 200KB 字节
		respDownA, err := http.DefaultClient.Do(reqDownA)
		if err != nil {
			t.Fatal(err)
		}
		bodyA, _ := io.ReadAll(respDownA.Body)
		respDownA.Body.Close()
		t.Logf("Device A First Download Status: %s, Body Length: %d", respDownA.Status, len(bodyA))

		// 模拟设备 B (client_id=device_B) 发起全量下载
		reqDownB, _ := http.NewRequest(http.MethodGet, app.SendURL+"?download=1&client_id=device_B", nil)
		respDownB, err := http.DefaultClient.Do(reqDownB)
		if err != nil {
			t.Fatal(err)
		}
		bodyB, _ := io.ReadAll(respDownB.Body)
		respDownB.Body.Close()
		t.Logf("Device B Download Status: %s, Body Length: %d", respDownB.Status, len(bodyB))

		// 检查 Device A 进度（应停留在 204800 字节，状态为 waiting，没有发生回滚清零）
		assertClientStatus("device_A", 204800, "waiting")

		// 检查 Device B 进度（应为 1048576 字节且已完成）
		assertClientStatus("device_B", 1048576, "completed")

		// 模拟设备 A 网络恢复，继续下载剩余的 800KB
		reqResumeA, _ := http.NewRequest(http.MethodGet, app.SendURL+"?download=1&client_id=device_A", nil)
		reqResumeA.Header.Set("Range", "bytes=204800-")
		respResumeA, err := http.DefaultClient.Do(reqResumeA)
		if err != nil {
			t.Fatal(err)
		}
		bodyResumeA, _ := io.ReadAll(respResumeA.Body)
		respResumeA.Body.Close()
		t.Logf("Device A Resume Download Status: %s, Body Length: %d", respResumeA.Status, len(bodyResumeA))

		// 验证设备 A 最终也应顺利完成下载
		assertClientStatus("device_A", 1048576, "completed")
	})

	// ==========================================
	// 场景二：多文件打包下载模式下的多设备进度隔离与断点续传
	// ==========================================
	t.Run("MultiFileZipDownload", func(t *testing.T) {
		cfg := &config.Config{
			Interface: "any",
			Port:      0,
			KeepAlive: true,
		}
		app, err := New(cfg)
		if err != nil {
			t.Fatal(err)
		}
		payload, err := body.FromArgs([]string{file1, file2}, false)
		if err != nil {
			t.Fatal(err)
		}
		app.Send(payload)
		defer app.Shutdown()

		// 模拟设备 A (client_id=device_A_zip) 下载第一个分片
		reqDownA, _ := http.NewRequest(http.MethodGet, app.SendURL+"?download=1&item=0&client_id=device_A_zip", nil)
		respDownA, err := http.DefaultClient.Do(reqDownA)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.ReadAll(respDownA.Body)
		respDownA.Body.Close()

		// 模拟设备 B (client_id=device_B_zip) 下载第二个分片
		reqDownB, _ := http.NewRequest(http.MethodGet, app.SendURL+"?download=1&item=1&client_id=device_B_zip", nil)
		respDownB, err := http.DefaultClient.Do(reqDownB)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.ReadAll(respDownB.Body)
		respDownB.Body.Close()

		// 验证 Device A 拥有其独立的已下载项（应只含有索引 0）
		itemsA := app.getClientDownloadedItems("device_A_zip")
		if len(itemsA) != 1 || itemsA[0] != 0 {
			t.Errorf("Device A downloaded items mismatch, got %v, want [0]", itemsA)
		}

		// 验证 Device B 拥有其独立的已下载项（应只含有索引 1）
		itemsB := app.getClientDownloadedItems("device_B_zip")
		if len(itemsB) != 1 || itemsB[0] != 1 {
			t.Errorf("Device B downloaded items mismatch, got %v, want [1]", itemsB)
		}
	})
}
