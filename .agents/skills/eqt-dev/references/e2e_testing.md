# EQT 端到端仿真与交付效果测试指南 (EQT E2E Simulation & Verification Guide)

本指南详述 EQT 局域网 Share/Receive 传输相关的端到端仿真测试规程，包括并发多设备、断点续传及 Chrome CDP 真机操作仿真。

---

## 1. 本地与多设备自动化测试脚本 (`scripts/e2e-multi-device-simulation.js`)

仓库内置并发多设备模拟脚本，用于对分块传输、断点续传以及 Wails 状态进行压力对齐测试：
- **运行方式**：
  ```bash
  node scripts/e2e-multi-device-simulation.js
  ```
- **核心验证链路**：
  1. **并发多会话模拟**：同时初始化独立设备会话（设备 A：上传文本；设备 B：上传大文件）。
  2. **网络中断与 HEAD 断点续传**：模拟设备 B 上传途中网络断开，重连后自动发送 Tus HEAD 请求对齐偏移量（Offset），基于该偏移量发送剩余 PATCH 分片并归档。
  3. **并发状态树校验 (State Tree Polling)**：以 150ms 频率轮询 `/send/<token>/status` 校验 `bytesDone`, `bytesTotal`, `percent`, `state` 随断点续传实时更新。
  4. **全局 Keep-Alive 验证**：启动服务端时传入 `--keep-alive`，防止单个设备完成传输后服务提前退出导致其他设备挂断。

---

## 2. Chrome CDP 页面端到端真机效果仿真

为对移动端 UI（添加文件、发送状态、Done 重载）进行全真操作与视觉核验：
1. **多网卡 any 接口绑定**：在 WSL 中启动服务时指定 `--bind 0.0.0.0`：
   ```bash
   go run ./cmd/eqt receive --bind 0.0.0.0 --output ./test_downloads --port 18080
   ```
2. **连接 Chrome MCP 并清理陈旧标签页**：
   - 调试服务端口 9222。
   - 使用 `list_pages` 检索标签，对历史测试页面使用 `close_page` 关闭。
3. **导航至接收端动态路由**：
   - `new_page` 导航至 `http://127.0.0.1:18080/receive/<Token>`。
4. **JS 动态内容填充与点击模拟**：
   - 使用 `evaluate_script` 评估表单赋值与点击提交：
     ```javascript
     () => {
         document.getElementById('plaintext-title').value = 'chrome_text';
         document.getElementById('plaintext-text').value = 'This is a test of E2E CDP simulation.';
         document.getElementById('submit').click();
     }
     ```
5. **归档终态 410 兼容与 Done 成功卡片核验**：
   - 数据发送完成后，Tus 客户端发送 `POST ?done=true`。若服务端已收齐进入 `completed` 终态，done 接口返回 `410 Gone`。
   - 验证页面 XHR 接收 410 时被 `onload` 捕获，正确绘制成“✓ 传输完成”绿色卡片。
   - 使用 `take_screenshot` 截取 Viewport 图像确认排版与语言。
   - 检查目标输出目录确认文件大小与哈希一致。
