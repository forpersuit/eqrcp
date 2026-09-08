package server

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"eqt/pkg/body"
	"eqt/pkg/config"
)

// TestLifecycleStateMatrix_ReceiveTus 验证 Receive 模式 Tus 协议全状态机不变量矩阵
func TestLifecycleStateMatrix_ReceiveTus(t *testing.T) {
	testCases := []struct {
		name                 string
		keepAlive            bool
		autoStop             bool
		scenario             string // "single_done", "multi_partial", "multi_all_done"
		expectedInitialState string
		expectShutdown       bool
	}{
		{
			name:                 "KeepAlive=true, AutoStop=false -> Single Done -> Stays Waiting, No Shutdown",
			keepAlive:            true,
			autoStop:             false,
			scenario:             "single_done",
			expectedInitialState: "waiting",
			expectShutdown:       false,
		},
		{
			name:                 "KeepAlive=true, AutoStop=true -> Single Done -> Completed, Triggers Shutdown",
			keepAlive:            true,
			autoStop:             true,
			scenario:             "single_done",
			expectedInitialState: "completed",
			expectShutdown:       true,
		},
		{
			name:                 "KeepAlive=false, AutoStop=false -> Single Done -> Completed, Triggers Shutdown",
			keepAlive:            false,
			autoStop:             false,
			scenario:             "single_done",
			expectedInitialState: "completed",
			expectShutdown:       true,
		},
		{
			name:                 "KeepAlive=true, AutoStop=true -> Multi Partial -> Stays Active/Waiting, No Shutdown",
			keepAlive:            true,
			autoStop:             true,
			scenario:             "multi_partial",
			expectedInitialState: "waiting",
			expectShutdown:       false,
		},
		{
			name:                 "KeepAlive=true, AutoStop=true -> Multi All Done -> Completed, Triggers Shutdown",
			keepAlive:            true,
			autoStop:             true,
			scenario:             "multi_all_done",
			expectedInitialState: "completed",
			expectShutdown:       true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			tempDir := t.TempDir()
			cfg := config.Config{
				Interface: "lo",
				Bind:      "127.0.0.1",
				Port:      0,
				Path:      "test-recv-matrix",
				KeepAlive: tc.keepAlive,
				Output:    tempDir,
			}
			srv, err := New(&cfg)
			if err != nil {
				t.Fatal(err)
			}
			defer srv.Shutdown()

			// 设置 AutoStop 初始状态
			srv.statusMu.Lock()
			srv.autoStop = tc.autoStop
			srv.status.AutoStop = tc.autoStop
			srv.status.State = "waiting"
			srv.statusMu.Unlock()

			// 执行不同场景
			switch tc.scenario {
			case "single_done":
				clientID := "client-single"
				srv.registerClientActivityWithID(clientID, httptest.NewRequest("GET", "/test", nil))

				doneReq := httptest.NewRequest("POST", srv.ReceiveURL+"?done=true&client_id="+clientID, nil)
				doneRec := httptest.NewRecorder()
				srv.mux.ServeHTTP(doneRec, doneReq)
				if doneRec.Code != http.StatusOK {
					t.Fatalf("unexpected done status: %d", doneRec.Code)
				}

			case "multi_partial":
				client1 := "client-1"
				client2 := "client-2"
				srv.registerClientActivityWithID(client1, httptest.NewRequest("GET", "/test1", nil))
				srv.registerClientActivityWithID(client2, httptest.NewRequest("GET", "/test2", nil))

				// Client 2 正在传输中 (state = transferring)
				srv.updateClientStatus(client2, nil, func(state *ClientTransferStateInfo) {
					state.State = "transferring"
				})

				// 仅 Client 1 上报 done
				doneReq := httptest.NewRequest("POST", srv.ReceiveURL+"?done=true&client_id="+client1, nil)
				doneRec := httptest.NewRecorder()
				srv.mux.ServeHTTP(doneRec, doneReq)
				if doneRec.Code != http.StatusOK {
					t.Fatalf("unexpected done status: %d", doneRec.Code)
				}

			case "multi_all_done":
				client1 := "client-1"
				client2 := "client-2"
				srv.registerClientActivityWithID(client1, httptest.NewRequest("GET", "/test1", nil))
				srv.registerClientActivityWithID(client2, httptest.NewRequest("GET", "/test2", nil))

				// Client 1 上报 done
				doneReq1 := httptest.NewRequest("POST", srv.ReceiveURL+"?done=true&client_id="+client1, nil)
				srv.mux.ServeHTTP(httptest.NewRecorder(), doneReq1)

				// Client 2 上报 done
				doneReq2 := httptest.NewRequest("POST", srv.ReceiveURL+"?done=true&client_id="+client2, nil)
				doneRec2 := httptest.NewRecorder()
				srv.mux.ServeHTTP(doneRec2, doneReq2)
				if doneRec2.Code != http.StatusOK {
					t.Fatalf("unexpected done status: %d", doneRec2.Code)
				}
			}

			// 验证系统不变量
			srv.statusMu.Lock()
			finalState := srv.status.State
			srv.statusMu.Unlock()

			if tc.expectShutdown {
				if finalState != "completed" {
					t.Fatalf("expected final state 'completed', got %q", finalState)
				}
			} else {
				if finalState == "completed" {
					t.Fatalf("invariant violated: state became 'completed' when shutdown was not expected!")
				}
				// 确保 stopChannel 绝无信号
				select {
				case <-srv.stopChannel:
					t.Fatal("invariant violated: stopChannel received shutdown signal when shutdown was not expected!")
				default:
					// OK
				}
			}
		})
	}
}

// TestLifecycleStateMatrix_ReceiveMultipart 验证 Receive 模式 Multipart 表单上传状态机
func TestLifecycleStateMatrix_ReceiveMultipart(t *testing.T) {
	tempDir := t.TempDir()
	cfg := config.Config{
		Interface: "lo",
		Bind:      "127.0.0.1",
		Port:      0,
		Path:      "test-recv-multipart",
		KeepAlive: true,
		Output:    tempDir,
	}
	srv, err := New(&cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Shutdown()

	if err := srv.ReceiveTo(tempDir); err != nil {
		t.Fatal(err)
	}

	// 1. KeepAlive=true, AutoStop=false -> Multipart 上传完成后必须维持 waiting
	srv.statusMu.Lock()
	srv.autoStop = false
	srv.status.AutoStop = false
	srv.status.State = "waiting"
	srv.statusMu.Unlock()

	bodyBuf := &bytes.Buffer{}
	writer := multipart.NewWriter(bodyBuf)
	part, _ := writer.CreateFormFile("files[]", "testfile.txt")
	part.Write([]byte("hello world multipart test"))
	writer.Close()

	req := httptest.NewRequest("POST", srv.ReceiveURL+"?client_id=cli-multipart-1", bodyBuf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	srv.mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("multipart upload failed: %d, body: %s", rec.Code, rec.Body.String())
	}

	srv.statusMu.Lock()
	stateAfterUpload := srv.status.State
	srv.statusMu.Unlock()

	if stateAfterUpload != "waiting" {
		t.Fatalf("expected state 'waiting' after multipart upload with autoStop=false, got %q", stateAfterUpload)
	}

	select {
	case <-srv.stopChannel:
		t.Fatal("stopChannel fired after multipart upload when autoStop=false!")
	default:
		// OK
	}

	// 2. 动态开启 SetAutoStop(true)
	// 因为此前上传完成的客户端在打开开关时会被置入 autoStopIgnoredClients，所以不应立即停止
	srv.SetAutoStop(true)

	srv.statusMu.Lock()
	stateAfterToggle := srv.status.State
	srv.statusMu.Unlock()

	if stateAfterToggle == "completed" {
		t.Fatalf("SetAutoStop(true) immediately triggered completed for past uploaded client!")
	}
}

// TestLifecycleStateMatrix_Send 验证 Send 模式（文件下载）生命周期状态机不变量
func TestLifecycleStateMatrix_Send(t *testing.T) {
	testFile := filepath.Join(t.TempDir(), "sample.txt")
	if err := os.WriteFile(testFile, []byte("matrix test content"), 0644); err != nil {
		t.Fatal(err)
	}

	testCases := []struct {
		name           string
		keepAlive      bool
		autoStop       bool
		expectShutdown bool
	}{
		{
			name:           "Send: KeepAlive=true, AutoStop=false -> Finished -> Stays Waiting, No Shutdown",
			keepAlive:      true,
			autoStop:       false,
			expectShutdown: false,
		},
		{
			name:           "Send: KeepAlive=true, AutoStop=true -> Finished -> Completed, Triggers Shutdown",
			keepAlive:      true,
			autoStop:       true,
			expectShutdown: true,
		},
		{
			name:           "Send: KeepAlive=false, AutoStop=false -> Finished -> Completed, Triggers Shutdown",
			keepAlive:      false,
			autoStop:       false,
			expectShutdown: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := config.Config{
				Interface: "lo",
				Bind:      "127.0.0.1",
				Port:      0,
				Path:      "test-send-matrix",
				KeepAlive: tc.keepAlive,
			}
			srv, err := New(&cfg)
			if err != nil {
				t.Fatal(err)
			}
			defer srv.Shutdown()

			srv.Send(body.Body{
				Path:     testFile,
				Filename: "sample.txt",
				Paths:    []string{testFile},
			})

			srv.statusMu.Lock()
			srv.autoStop = tc.autoStop
			srv.status.AutoStop = tc.autoStop
			srv.status.State = "waiting"
			srv.statusMu.Unlock()

			clientID := "client-send-1"
			srv.registerClientActivityWithID(clientID, httptest.NewRequest("GET", "/test", nil))

			// 标记客户端完成下载
			srv.updateClientStatus(clientID, nil, func(state *ClientTransferStateInfo) {
				state.State = "completed"
			})

			// 触发完成门禁评估 (与真实流程一致)
			srv.statusMu.Lock()
			autoStop := srv.autoStop
			srv.statusMu.Unlock()

			isAll := srv.isAllActiveClientsFinished()
			if !srv.KeepAlive || (autoStop && isAll) {
				srv.setStatus("completed", "Transfer completed.")
			} else {
				srv.setStatus("waiting", "Transfer completed. Waiting for more files.")
			}

			// 验证系统不变量
			srv.statusMu.Lock()
			finalState := srv.status.State
			srv.statusMu.Unlock()

			if tc.expectShutdown {
				if finalState != "completed" {
					t.Fatalf("expected final state 'completed', got %q", finalState)
				}
			} else {
				if finalState == "completed" {
					t.Fatalf("invariant violated: state became 'completed' when shutdown was not expected!")
				}
				// 确保 stopChannel 绝无信号
				select {
				case <-srv.stopChannel:
					t.Fatal("invariant violated: stopChannel received shutdown signal when shutdown was not expected!")
				default:
					// OK
				}
			}
		})
	}
}
