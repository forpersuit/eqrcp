# EQT 端到端仿真与交付效果测试指南 (EQT E2E Simulation & Verification Guide)

本指南详述 EQT 局域网 Share/Receive 传输相关的端到端仿真测试规程，包括并发多设备、断点续传及 Chrome CDP 真机操作仿真。

---

## 1. 本地与多设备自动化测试脚本 (`scripts/e2e-multi-device-simulation.js`)
为尽可能模拟真实传输场景并验证数据连通性，仓库内置了并发多设备模拟脚本。该脚本基于 Node.js 异步请求，用于对分块传输、断点续传以及 Wails 状态进行压力对齐测试：
- **运行方式**：
  ```bash
  node scripts/e2e-multi-device-simulation.js
  ```
- **核心验证链路**：
  1. **并发多会话模拟**：同时初始化两个完全独立的设备会话（设备 A：`client_device_A` 上传 40KB 文本；设备 B：`client_device_B` 上传 800KB 大文件）。
  2. **网络丢包与 HEAD 断点续传**：模拟设备 B 上传 300KB 后网络突然断开（连接切断），重连后设备 B 自动向服务端发送 Tus HEAD 请求，对齐已保存的文件偏移量（Offset = 307200），随后基于该偏移完成剩下 500KB 分片的 PATCH 发送，并最终调用 done 接口归档。
  3. **并发状态树校验 (State Tree Polling)**：脚本以 150ms 频率轮询服务端的 `/send/<token>/status` 接口，打印多设备并发时的 client 状态树，检验 `bytesDone`, `bytesTotal`, `percent`, `state` 是否随断点和续传实时更新。
  4. **全局 Keep-Alive 验证**：在启动时必须传入全局标志 `--keep-alive`，防止在多设备并发上传中，单个设备传满设定文件数后服务端立刻自动退出导致其他设备发生 `socket hang up`。

---

## 2. Chrome CDP 页面端到端真机效果仿真
为了对移动端 UI（如添加文件、发送状态、 Done 重载）进行全真操作与视觉交付核对：
1. **多网卡 any 接口绑定**：在 WSL 中拉起 Go 接收端时，必须带上 `--bind 0.0.0.0`，从而映射端口至 localhost，确保 Windows 上的 Chrome 能够路由：
   ```bash
   go run ./cmd/eqt receive --bind 0.0.0.0 --output ./test_downloads --port 18080
   ```
2. **连接 Chrome MCP 并清理陈旧标签页**：
   - 启动 Windows 端的 Chrome 调试服务（端口 9222）。
   - 在测试导航前，使用 Chrome MCP 的 `list_pages` 查看当前标签。对于残留的历史测试页面，**必须首先使用 `close_page` 将其关闭**，确保当前的活动 Execution Context 干净且唯一。
3. **导航至接收端动态路由**：
   - 调用 `new_page` 导航至：`http://127.0.0.1:18080/receive/<Token>`。
4. **JS 动态内容填充与点击模拟**：
   - 避免使用不可靠的 selector fill，直接通过 `evaluate_script` 在页面上下文中评估执行表单赋值与点击逻辑：
     ```javascript
     () => {
         document.getElementById('plaintext-title').value = 'chrome_text';
         document.getElementById('plaintext-text').value = 'This is a test of E2E CDP simulation.';
         document.getElementById('submit').click();
     }
     ```
5. **归档终态 410 兼容与 Done 成功卡片核验**：
   - 数据发送完成后，Tus 客户端会顺序调起 `POST ?done=true` 发送结束通知。由于此时服务端可能已因为收齐文件进入 `completed` 终态，done 接口会正常返回 `410 Gone`。
   - 验证页面接收到 410 时，能够被页面 JS 里的 XHR `onload` 正确截获，且不闪红报错，而是正常重绘出“✓ 传输完成”绿色对勾成功卡片。
   - 调用 `take_screenshot` 截取 Viewport 图像，确认交付的界面排版、语言、按钮等效果。
   - 检查本地 `./test_downloads` 文件夹，确认生成的文件大小、哈希与页面输入的完全一致。
