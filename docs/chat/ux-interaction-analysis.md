# Chat 模式用户交互缺点分析

> **日期**：2026-07-24  
> **状态**：分析完成；**阶段 1（H1–H5）+ M1 已修复**（v1.16.4），其余见 [ux-fix-progress.md](./ux-fix-progress.md)  
> **范围**：Chat V2 主路径（`/chat-v2/*` + Svelte + WebSocket）对用户交互的可发现性、反馈与权限问题  
> **权威路径**：Chat V2；Legacy `/chat` 仅 301 到 `/chat-v2`，`pages/chat.tmpl.html` 已不在主路径

---

## 1. 交互架构（简述）

```text
Host (eqt chat / desktop GUI)
  ├─ 终端打印 QR + ChatJoinURL
  ├─ 打开浏览器/Wails iframe → /chat-v2/{token}?peer=desktop&hostToken=...
  └─ 挂载 HTTP Handler (pkg/chat/v2/http)

Mobile / 其他浏览器扫码
  └─ GET /chat-v2/{token}?join=...&theme=...&lang=...

控制面 (WebSocket /chat-v2/{token}/ws)
  connect / heartbeat / send_text / recall / kick
  start_transfer / cancel / report_progress / load_history
  ← message_* / presence / transfer_* / history_page / error

数据面 (HTTP)
  POST /upload/init → POST /upload          浏览器附件上传
  POST /attachments/local                  桌面 Host 登记本地路径
  GET  /files/{id}                        下载（可带限速）
  GET  /info                               配额/许可证轮询 (2s)
  GET  /qr.png                             会话二维码
```

**主界面结构**（`pkg/chat/v2/web/src/App.svelte`）：顶栏（额度 / 设备 / QR / 退出）→ `MessageList` → `MessageComposer`。

会话内消息类型：`text` / `file` / `system`（协议里还有 image/video/audio，前端未真正渲染）。

### 与经典 send/receive 对比

| | Classic send/receive | Chat |
|--|----------------------|------|
| 任务模型 | 单次、扫码→传完即结束 | 会话常驻、多轮文本+附件 |
| 进度反馈 | 上传页/下载页专页状态 | 气泡蒙版 + transfer 事件（且部分通知丢失） |
| 失败重试 | 通常重新开任务/扫码 | 需气泡菜单；重发文件有假路径 |
| 复杂度 | 低，路径短 | 高：WS 重连、额度、踢人、同 peer 互顶 |

---

## 2. 第一性原理结论

Chat 的控制面事件很多（WS 状态、传输进度、额度、presence），但 **用户可见反馈通道有断点**：

1. **错误/状态**：`systemMessages` 未进主界面  
2. **文件主路径**：藏在手势菜单里  
3. **连接生命周期**：切后台主动断连 + 恢复入口弱  
4. **权限与额度**：行为与用户心智/文档不完全一致  

整体感受：**长得像 IM，用起来却经常不确定「发生了什么、我该点哪里、还能不能发」**。

经典 send/receive 路径短、主按钮明确，失败就重开任务——适合「传完就走」。Chat 适合反复文本+多附件，但当前把复杂度堆在 discoverability、连接态和静默错误上。

---

## 3. 具体缺点（按严重度）

### 3.1 高

#### H1. 应用内通知系统「写了但没挂上」——错误与状态大量不可见

- **证据**：`chatStore.systemMessages` 与 `addSystemMessage()` 被大量调用（上传失败、WS 错误、心跳超时、重连等）；**唯一渲染处是 `TransferStatus.svelte`**，但 **`App.svelte` 从未 import/挂载它**。
- **行为后果**：用户以为「点了没反应」；上传失败、服务端 error、`Cannot send command. WebSocket is not open.` 等几乎都不会进入消息列表。
- **与项目规则冲突**：AGENTS 明确要求「用应用内通知，不要 alert」，但主 UI 没有可见的通知槽。

#### H2. 文件操作几乎只能靠「长按 / 右键 / 侧滑菜单」——主路径不可发现

- **证据**：`MessageList.svelte` 文件气泡只渲染 FILE 图标 + 文件名 + 状态文字；**没有内联下载/取消按钮**；`openMessageMenu` 才提供下载/取消/撤回。
- **行为后果**：新用户不知道怎么下载；移动端依赖 600ms 长按或侧滑阈值——摩擦高、误触/漏操作多。
- **对比**：classic receive 上传页是显式大按钮，路径一目了然。

#### H3. 切后台 / 切标签会主动掐断 WebSocket

- **证据**：`websocket.ts` 在 `visibilitychange → hidden` 时 **主动 `ws.close`**，且 `isSuspended` 时 **不自动重连**，要等 `visible` 再 `connect()`。
- **行为后果**：手机回微信、切应用、锁屏再亮屏 → 短暂「静默离线」；期间发消息会失败（且失败通知见 H1）；对「聊天」心智是强负反馈。

#### H4. 文本发送：多行 textarea 下 Enter 不发送，且无快捷键约定

- **证据**：`MessageComposer.svelte` 仅 `form on:submit`；`<textarea>` **无 `keydown` 处理**；浏览器默认 Enter 换行，**不会 submit**。
- **行为后果**：用户习惯 IM（Enter 发送 / Shift+Enter 换行）时会卡住，只能点发送按钮；桌面键盘效率明显差于预期。

#### H5. 任意客户端可踢人——权限与文案不一致

- **证据**：
  - 后端 `CommandKickClient` **不校验 host**（`transport/websocket.go`）。
  - 前端设备面板对每个非本机设备都显示踢下线（`App.svelte`）。
  - 部分文档写「桌面 host 可强制下线；远程页可查看但不能踢」——**与代码不符**。
- **行为后果**：手机用户可互踢/踢 host；被踢后 join token 作废，须重扫；信任模型混乱。

---

### 3.2 中

#### M1. 断线恢复：重连用尽后无恢复入口

- 最多约 10 次指数退避（上限 15s）；达上限只 `addSystemMessage('...Please refresh page.')`（且 H1 不可见）；`resumeConnection` **仅**服务 `replaced` banner。
- 网络抖动后可能卡在 `connState=disconnected`，顶栏仅标题变灰（`.chat-head.offline`），**无「重新连接」按钮**。

#### M2. 同浏览器多标签：静默互顶

- 同 `peer` 后到者踢先到者，`CloseReasonReplaced`；旧标签停重连，出 banner + 按钮。
- 合理策略，但**首次**用户会懵；且 `localStorage.chat_peer` 使同机多窗口默认算同一设备。

#### M3. 上传中对接收方「不可见」——进度零感知

- 服务端 `isEventVisibleTo`：`uploading` 文件只给 sender / desktop。
- 前端过滤：非 embedded 且 `uploading || !downloaded` 的对方文件直接不渲染。
- 对方发大文件时本端气泡区**长时间空白**；经典「正在接收…」心智缺失（虽避免旁路噪声，但交互上像「消息丢了」）。

#### M4. 浏览器端下载进度与状态容易失真

- 非 embedded 走 `<a download>` + `startTransfer`；进度依赖服务端 transfer 事件；浏览器下载器失败时前端不一定能可靠标 `failed`。
- 气泡可能显示 completed，但系统下载失败；或反过来；与桌面 GUI 的 `download-progress` postMessage 路径不对等。

#### M5. 「重新发送文件」名不副实

- `handleResendFile` 用 `sendText(JSON.stringify({type:'file',...}))`，**不重新选文件、不触发 upload**。
- 撤回/取消后点「重发」，对端可能只看到一段 JSON 文本或伪文件气泡，**拿不到文件**。

#### M6. 多文件并发上传、无串行队列

- `MessageComposer` 对 `multiple` 文件逐个 `dispatch('sendFile')`；`handleSendFile` 各自 XHR，无串行 `uploadQueue`。
- 多选大文件时并行占带宽/内存，移动端易卡、易断 WS；进度气泡互相抢视觉。

#### M7. Free 额度说明与产品文案不一致 + 手机不显示倒计时

- 部分文档曾写超额后 messaging suspended；实现与 [free-tier-usage-analysis.md](./free-tier-usage-analysis.md)：超额只 **附件 100KB/s + ≤2MB**，**文本不限**。
- `showQuotaPill = !isPaid && !isMobileLayout`：**手机标题栏不显示剩余时间**。
- 用户被文档误导；手机最容易不知不觉进降级，直到传大文件被 413。

#### M8. 2MB 拒绝错误偏「英文工程文案」，且前端无前置校验

- `attachments.go` 直接返回 `"file size exceeds 2MB free limit. Please upgrade."`；前端选文件后才 init，**无本地预检与中文提示气泡**。
- 免费用户体验像「坏了」而不是「额度策略」。

---

### 3.3 低

| ID | 问题 | 行为后果 |
|----|------|----------|
| L1 | 拖放在浏览器页几乎无效 | `App.svelte` drop 只 `preventDefault`；拖文件无反馈 |
| L2 | 协议有 image/video/audio，UI 一律当 FILE | 无预览/点播，都要菜单下载 |
| L3 | 设备详情「并发连接数: 1」写死 | 误导调试与多标签理解 |
| L4 | 输入框自定义右键菜单 | 可能挡系统/辅助功能；Clipboard 失败时粘贴坏掉 |
| L5 | 踢下线/退出后恢复路径长 | 误操作成本高；无撤销踢人 |
| L6 | 连接状态反馈过弱 | 仅标题 offline 样式；无「连接中…」条 |
| L7 | 历史分页 discoverability 低 | 滚到顶自动加载；无显式「加载更早消息」 |

---

## 4. 严重度一览

| 严重度 | 问题 ID |
|--------|---------|
| **高** | H1 通知槽未挂载；H2 文件动作不可发现；H3 切后台断 WS；H4 Enter 不发送；H5 踢人权限全开 |
| **中** | M1 重连耗尽无按钮；M2 多标签互顶；M3 上传中对方不可见；M4 浏览器下载状态漂移；M5 假重发；M6 并行多传；M7 额度文案/手机无倒计时；M8 2MB 错误体验 |
| **低** | L1–L7（拖放、媒体预览、假并发数、自定义右键、踢后恢复、连接态、历史分页） |

---

## 5. 关键代码锚点

| 主题 | 路径 |
|------|------|
| 主壳 / 额度 pill / 踢人 UI | `pkg/chat/v2/web/src/App.svelte` |
| 消息列表 / 菜单 / 文件过滤 | `pkg/chat/v2/web/src/components/MessageList.svelte` |
| 输入框 / 发送 / 多文件 | `pkg/chat/v2/web/src/components/MessageComposer.svelte` |
| 系统通知渲染（未挂载） | `pkg/chat/v2/web/src/components/TransferStatus.svelte` |
| systemMessages store | `pkg/chat/v2/web/src/state/chatStore.ts` |
| WS / visibility / kick 命令 | `pkg/chat/v2/web/src/services/websocket.ts` |
| 服务端 kick 处理 | `pkg/chat/v2/transport/websocket.go` |
| 附件大小限制 | `pkg/chat/v2` attachments 相关 HTTP 处理 |

---

## 6. 建议修复方向（概要）

完整勾选与验收见 [ux-fix-progress.md](./ux-fix-progress.md)。优先顺序：

1. **H1**：`systemMessages` 做成消息列表内系统气泡 / toast，或真正挂载 `TransferStatus`  
2. **H2**：文件气泡内联主操作（下载 / 进度 / 取消）；菜单留给次要动作  
3. **H3**：切后台可降心跳频率，勿无条件断连  
4. **H4**：桌面 Enter 发送、Shift+Enter 换行（移动端可保持换行+按钮）  
5. **H5**：Kick 仅 host（`peer===desktop` 或 hostToken），与产品文案对齐  
6. **M1**：断线 banner + 一键重连  
7. **M3**：上传中对接收方显示「对方正在发送 xxx…」占位  
8. **M5/M6/M8**：修 resend、串行上传队列、选文件预检 + 中文系统气泡  
9. **M7**：手机也显示额度 pill 或降级态；文档与实现一致  

---

## 7. 修订记录

| 日期 | 说明 |
| :--- | :--- |
| 2026-07-24 | 首版：基于 Chat V2 代码的用户交互缺点分析 |
| 2026-07-24 | H1–H5 + M1 已按进度文档落地（见 ux-fix-progress） |
