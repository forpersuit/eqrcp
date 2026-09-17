# Chrome DevTools MCP E2E 仿真测试指南 (E2E Simulation Testing Guide)

## 目录 (Table of Contents)
- [1. E2E 仿真测试第一性原理](#1-e2e-仿真测试第一性原理)
- [2. Chat v2 3 设备对齐仿真流程](#2-chat-v2-3-设备对齐仿真流程)
- [3. Receive 模式接收与提交仿真流程](#3-receive-模式接收与提交仿真流程)
- [4. 移动端遥测与下载上报仿真流程](#4-移动端遥测与下载上报仿真流程)
- [5. 视觉与视口回归核对清单](#5-视觉与视口回归核对清单)

---

## 1. E2E 仿真测试第一性原理

- **真实引擎**: 依托 Chrome 远程调试端口 9222，在真实 Blink/WebKit 渲染树中回放真实的用户操作序列，而非基于 JSDOM 的伪造 Mock 环境。
- **环境隔离**: 测试过程中动态分配临时随机端口或 Token，测试完成后严格清理后台 Go 进程与测试产生的暂存文件。

---

## 2. Chat v2 3 设备对齐仿真流程

- **场景**: 验证 Desktop GUI 与两台移动端设备（Mobile A、Mobile B）在同一房间内的双向消息投递、气泡左右对齐与状态同步。
- **步骤**:
  1. **启动服务**: 后台执行 `go run ./cmd/eqt/ chat --port 18081 --bind 127.0.0.1 --keep-alive` 并解析随机 Token。
  2. **打开 3 个浏览器页面**:
     - 桌面端 (GUI): `http://127.0.0.1:18081/chat-v2/<token>?peer=desktop`
     - 移动端 A (Mobile A): `http://127.0.0.1:18081/chat-v2/<token>?peer=peer-A`
     - 移动端 B (Mobile B): `http://127.0.0.1:18081/chat-v2/<token>?peer=peer-B`
  3. **关闭初始模态**: 对每个页面调用 `click` 关闭二维码分享浮层。
  4. **双向发送校验**:
     - 在 Mobile A 输入 "Hello from A" 并发送，校验 Mobile A 页面显示在右侧（`.message.mine`），Mobile B 与 GUI 页面显示在左侧；
     - 在 GUI 输入 "Reply from GUI" 并发送，校验 GUI 页面显示在右侧，Mobile A 与 B 页面显示在左侧。
  5. **环境清理**: 终止后台 Go 进程。

---

## 3. Receive 模式接收与提交仿真流程

- **场景**: 验证移动端扫码进入 Receive 模式后，文本与文件的提交落盘流程。
- **步骤**:
  1. **启动服务**: `go run . receive --bind 0.0.0.0 --port 18080 --keep-alive` 并提取 Token。
  2. **导航至页面**: `new_page` 访问 `http://127.0.0.1:18080/receive/<token>`。
  3. **数据输入与提交**: 通过 `evaluate_script` 给 `#plaintext-text` 赋值并点击 `#submit`。
  4. **校验完成卡片**: 提交后页面重定向至 `?done=true`，截取 Viewport 图像确认绿色成功卡片。
  5. **环境清理**: 终止后台进程并清理接收目录。

---

## 4. 移动端遥测与下载上报仿真流程

- **场景**: 验证移动端页面加载与下载触发时的遥测日志上报。
- **步骤**:
  1. **启动服务**: `go run . send <file> --bind 127.0.0.1 --port 18096 --keep-alive` 并提取 Token。
  2. **页面导航**: 通过 `navigate_page` 访问 `http://127.0.0.1:18096/send/<token>`。
  3. **页面加载上报校验**:
     - 验证 `GET /assets/telemetry.js` 成功返回 200；
     - 通过 `list_network_requests` 检查首个 `POST /client-log` 上报，验证 Payload 包含 `PAGE_LOAD` 事件且返回 204。
  4. **下载交互校验**:
     - 通过 `click` 触发下载按钮，验证连续触发包含 `DOWNLOAD_CLICK` 与 `TRANSFER` 的 `POST /client-log` 上报。
  5. **视觉截屏与清理**: 调用 `take_screenshot` 抓取已下载完成的 UI 视图并保存归档。

---

## 5. 视觉与视口回归核对清单

- **移动端窄屏视口 (375x667)**: 验证 iPhone 7 尺寸下顶栏按钮是否自动收折为纯图标横向菜单。
- **软键盘高度压缩模拟**: 模拟 `visualViewport.height = 370` 时，输入框 `.composer` 是否随底边抬升，历史消息是否收缩至顶栏下方。
- **无滚动外溢**: 验证 `html, body, #app` 无纵向晃动或橡皮筋弹跳。
