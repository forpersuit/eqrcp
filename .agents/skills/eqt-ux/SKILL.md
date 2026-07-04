---
name: eqt-ux
description: Guidelines for EQT user interface, notification styles, and UX rules, emphasizing in-app system messages over blocking alert dialogs.
---

# EQT UI & Notification Guidelines

## No Alert-style Interruptions
- Avoid using browser-level `alert()`, `confirm()`, or `prompt()` dialogs for regular user notifications, warnings, or errors.
- Always prefer non-intrusive, in-app messaging patterns:
  - For chat-related issues (e.g., file size limit exceeded, network warning), append a system notification message directly into the chat message list using the `showSystemNotice(msg)` helper.
  - For configuration or non-critical state warnings, use in-app toast overlays or non-blocking banners.
- Only use standard dialog elements (like error click/touch callbacks on badge status) when explicitly designed for user-interactive diagnostic lookups.

## Handling Volatile UI State During Full Rerender
- **Issue**: Full DOM overwriting (using `innerHTML` replacements) causes temporary form changes, button loading states, scroll positions, and focus states to be destroyed.
- **Rule**:
  - Keep volatile state (such as update checking/downloading stages, warning messages, buttons content, etc.) synchronized in the global `state` store rather than keeping them purely inside the DOM.
  - Dynamically read from the global `state` when constructing panels (e.g. `renderSettingsPanel()`).
  - Wire change/input event listeners on settings controls to eagerly write back latest DOM values to memory (e.g. via `syncSettingsFromDOM()`). This prevents user configuration changes from being wiped out by a sudden global page redraw before clicking "Save".
  - **In-place Node Updates**: For high-frequency or local state changes (e.g. update check statuses, buttons), prefer updating target DOM elements directly in-place (e.g. via `textContent` or `disabled` status) instead of calling a full re-render or overlay recreation (`syncPanelSurface`). This avoids layout-timing scroll jumps (which clamp `scrollTop` to 0 because of unfinished layout passes when DOM is replaced) and preserves focus.
  - **Fallback Scroll Restoration**: When replacing the workspace, modal, or lists is unavoidable, save and restore the `scrollTop` values of all potentially scrollable containers (e.g. `.overlay .modal`, `.workspace`, `.path-list`, `.sidebar-history`, `.locked-list`, `.file-list-view`, `.transfer-stage`) by selecting and storing them before the replacement, and restoring them immediately after rendering. For overlay/modal elements, also use delayed ticks (e.g., `setTimeout(..., 0)` and `setTimeout(..., 50)`) to ensure layout completion and prevent the browser from resetting the scroll to 0.
  - **morphdom 增量 DOM Diff 修补与事件防重复绑定劫持**：
    在原生 JS 的全局 `render()` 重载中，为了彻底避免 UI 重绘带来的闪烁（如 Tooltip 气泡闪烁、二维码重载闪动）和输入框失焦问题，应使用零依赖的 DOM Diff 库 `morphdom` 替代 `innerHTML` 的直接覆写。为了防止 DOM 节点被复用时导致事件监听器重复绑定（例如 `addEventListener` 绑定新的匿名箭头函数），必须在前端最头部重写 `EventTarget.prototype.addEventListener` 与 `removeEventListener` 的包装拦截器。在检测到为同一类型绑定相同语义的回调函数（通过对比 `listener.toString()`）时，先使用原生 `removeEventListener` 移除旧回调，确保任何时候同一元素只挂载单一监听器，且能够安全捕获最新的状态闭包。

  - **Avoiding High-frequency Lock Contention on UI Feeds**:
    - **Issue**: High-frequency updates on write streams (e.g. updating `BytesDone` inside `onWrite` per network write chunk) trigger severe lock contention on status mutexes (`statusMu` / `clientStatesMu`) up to thousands of times per second. This starves the desktop GUI's main thread status retrieval, locking/freezing the interface (making Wails GUI non-scrollable and unresponsive).
    - **Rule**: Never update client states or trigger status mutex locks on high-frequency stream events. Simplify UI displays by showing low-frequency state transitions (e.g., `transferring` on start, `completed`/`failed` on finish) instead of computing complex concurrent stream percentages. Keep byte counters atomic or locally bounded to prevent CPU lock contention.

## Mobile Layout Adaptations & Titlebar Constraints
- **Branding & License Badges**: Add high-contrast license tier badges (e.g. using `.license-badge` with `var(--accent)`) next to the brand logo or title text. On mobile views, place it next to EQT title. On desktop GUI views, place it to the left of the 'Chat Status' sidebar panel header, scaling it down slightly (`font-size: 9px;`) to match the smaller layout context. Hide irrelevant timer status capsules (`.limit-status-pill`) when a paid plan is active, showing only the badge.
- **Prevent Action Overflows**:
  - Keep titles and badges strictly non-wrapping by applying `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`.
  - For narrow viewports (e.g. `<= 360px`), hide low-priority action buttons (such as `#share-session` session sharing button which is rarely used on visitor mobile devices) and scale down logos/gaps slightly to allocate sufficient space for the remaining actions.
- **Modals & Collapsible Panels Layout**:
  - Ensure mobile responsive modals/panels (such as `.session-backdrop.open .side`) preserve grid structures: do not rawly override `display` to `block` in media queries as it clears `grid-gap` spacing and compresses buttons; maintain `display: grid` with appropriate gaps (e.g. `gap: 14px`) to preserve spacing.
- **Tooltips & Truncation Safe Layouts**:
  - Tooltips with long messages must not use `white-space: nowrap` inside small container margins, as it will get cut off by screen boundaries. Instead, use responsive tooltips with wrapping styles (`white-space: normal; width: 220px;`) and position them to the bottom-left (`.has-tooltip-bottom-left`) to avoid overlapping window margins.
  - To prevent accidental horizontal scrollbars in single-column flex/grid pages, enforce `overflow-x: hidden` on the root workspace `.workspace` and major stages, and ensure that flex text elements use `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` strictly to avoid text overflows from pushing layout boxes.

## Real-time Viewport & Setting Sync (Viewport Debug Toggling)
- **Problem**: When settings like "Enable Viewport Debug Box" are toggled in the desktop GUI Settings, mobile clients currently connected need to sync this state dynamically without requiring a manual page reload.
- **Solution**:
  - Expose the dynamic configurations on the Go server `/health` route (e.g. `"viewportDebug": s.ViewportDebug`).
  - In client-side JS (`updateChatStatus(data)`), detect the change dynamically by comparing `enabled !== viewportDebugEnabled`.
  - When state changes, manipulate DOM class attributes directly (add/remove `.open`, `aria-hidden`), update layout constraints inline, and fire viewport metric adjustments (e.g., `handleViewportChange()`) without forcing a full client page refresh.

## Multi-language (i18n) & Locale Matching
- **Desktop UI (Wails)**:
  - 界面语言首选项（例如 Settings 页面下的 `Lang` 字段）在后台 `config/settings.go` 中持久化并同步给前端。
  - 使用 `t(key)` 进行界面词条替换。在保存语言选项时，通过 `applyLanguageChange(newLang)` 立刻执行重绘 `render()` 刷新 DOM，并向当前存在的 `#chat-iframe` 发送 `postMessage` 同步事件，支持零重启无缝热切换。
- **Mobile Pages (`upload.tmpl.html` & `chat.tmpl.html`)**:
  - 默认根据打开网页的浏览器语言首选项 `navigator.language` 来动态渲染对应的语种。
  - 扫码接入的 receive 模式（`upload.tmpl.html`）和 done 模式（`done.tmpl.html`）应在右下角显示可进行语种切换的下拉框 `<select>`。
  - **偏好持久化规范**：统一读取 `eqt_lang` (或兼容读取 `eqt-page-lang`) 作为偏好标识。切换语种时，必须同时在 LocalStorage 中写入 `eqt_lang` 和 `eqt-page-lang` 双键，以确保用户跨页面跳动时无缝继承语种偏好。
  - **兜底翻译机制**：为了稳妥应对翻译缺漏，小语种词条加载时必须与最完备的 `en` 英文词条包进行安全深度 Merge 兜底，防止出现 JS 未定义键 of 报错，并保证漏译词条显示为英文而非空白。
  - **Iframe 消息接收**：内嵌在桌面 GUI 内的 `chat.tmpl.html` 必须监听 `window.addEventListener('message')` 中类型为 `update-lang` 的广播，当外部宿主语言切换时同步调用 `updateLanguage()` 瞬间热重载。

## 移动端接收管理与限额特权及状态展示规范 (Mobile Upload Management, Quota Banner & Limits Handling)
- **传输异常友好呈现**：文件上传失败或异常（网络中断、大小超限、服务端 500 写入失败）时，严禁使用原生弹窗或直接把 raw 错误文本打在表单下方。必须直接将整个界面重绘为带有红色“✕”圆形徽章的“传输失败卡片”（样式与 Done 成功卡片对称），给普通用户呈现易懂的本地化解释（如局域网未联通、磁盘满、或文件超大等提示），并提供醒目的“返回并重试”按钮以快速重载页面恢复输入状态。
- **待传输列表累加与删除控制**：
  - 移动端选择文件和粘贴内容应使用统一内存数组 `accumulatedFiles` 进行管理与提交。
  - **付费特权检测**：严格通过后端注入的 `IsPaid` 与 `ClockTampered` 计算出设备实际的付费授权特权状态：`isPaidMode = isPaid && !clockTampered`。**绝对不能**将剩余额度（如 `usedTransfers < 5`）误计入付费模式，因为免费用户即使有额度，也受单文件最大 50MB 以及单次最多 5 个文件的免费模式限制。
  - **超限阻断**：在 `isPaidMode` 为 `false` 时，拖入的文件超过 50MB 或文件数超过 5 个应当在列表上立即以红色虚框和警告语向用户阻断，在 Transfer 提交时亦强制卡关拦截。
- **就地限额通告栏与状态同步 (Mobile Quota Banner & State Sync)**：
  - 对于未激活 Plus 授权的免费设备，移动端应渲染一个醒目的、符合设计美学的限额状态通告栏（`#quota-banner`）。
  - 当今日剩余免费接收次数 > 0 时，显示剩余可用次数提示；当次数耗尽时，通告栏切换为超限红色警告，并彻底锁死移动端页面的所有输入域、文件列表和 Transfer 传输按钮。
  - 在客户端心跳轮询（ping）中，服务端需要动态向客户端同步当前的限额剩余次数与付费状态。移动端在探测到最新的限额数值发生改变或由于在 GUI 端发生重置/激活操作时，自动通过 `updateLimitUI()` 更新本地 UI 并安全恢复/锁死功能，无需用户手动刷新网页。
- **传输完成界面设备 ID 渲染 (Done Page Device ID Rendering)**：在移动端传输完成的成功界面中，必须显示当前客户端 `clientID` 的后四位（如 `Device ID: XXXX`）。为了保证模板渲染的向下兼容性并避免 Go 模板反射结构体字段缺失报错，严禁在模板中直接嵌入 Go 的 `{{.ClientID}}` 语法进行渲染；必须采用 JavaScript 双重容错机制：优先从 `window.currentClientID` 全局变量中提取，若不存在则降级通过 `getQueryParam('client_id')` 从当前 URL 参数中解析出 `clientID`，再执行截取和多语言词条渲染。


## Wails App Modal and Drag-Drop Guidelines (Wails原生确认弹窗与拖拽最佳实践)
- **原生二次确认框 (Native Confirmation Dialogs)**:
  - 在需要用户强确认的操作（如切换运行模式）时，严禁使用浏览器原生 `confirm()`。应当在 Go 端通过 `wailsruntime.MessageDialog` 封装一个 RPC 方法（例如 `Confirm`），由 JS 异步调用以呈现操作系统原生的对话框，避免网页弹窗打断与卡死，提升应用的原生质感。
- **WebView 物理文件拖拽稳定性 (Reliable Webview Drag & Drop)**:
  - **问题成因**：在 Wails 应用中，即使在容器上声明了 `style="--wails-drop-target: drop"`，拖拽文件时如果落在该容器内部 of 子元素（如文字标题、小图标）上，拖放事件仍极易被 WebView 吃掉导致失效。
  - **解决方案**：除了在容器（如 `.drop-target`）上设置 `--wails-drop-target` 外，必须通过 CSS 给其内部所有子元素配置 `pointer-events: none;`（例如 `.drop-target * { pointer-events: none; }`）。这能够强行将拖拽焦点和鼠标事件穿透到父级拖拽容器，实现平滑、稳定地接收桌面物理文件。

## 移动端就地超限拦截与动态解锁规范 (Mobile Device-Limit Handling & Live Recovery)
- **避免直接重定向 (Avoid Direct Redirection)**：当并发连接或使用额度超限时，移动端网页严禁直接使用 `window.location.href` 重定向到独立的静态错误页，这会导致页面脱离心跳状态，失去与后端的“热解锁”联系。
- **就地状态拦截与防抖渲染 (In-place Interception & Debounced UI Toggle)**：
  - 轮询心跳（如 `/status`）探测到 `limit_exceeded` 状态时，应在本地就地切换 UI。
  - 声明防抖状态标识（如 `isLimitUIActive`）限制多余的 DOM 刷新操作。
  - 在 `showLimitExceededUI()` 中将页面切换为超限警告视图：用警告徽章（⚠️）替换当前状态，隐藏常规下载按钮，动态展示升级引导，并将文件列表项加上 `pointer-events: none; opacity: 0.5;` 视觉与点击锁死。
- **心跳保活与自动解锁回暖 (Polling Keepalive & Live Unlock)**：
  - 拦截限制期间，网页轮询心跳不得被杀死（不能 `clearInterval`）。
  - 当其他活跃设备离开或停止从而释放额度时，超限设备的心跳拉取到最新正常状态，立即自动触发 `restoreNormalUI()`：将警告图标、隐藏的常规动作按钮、文件列表的可点击性、多语言提示热还原为正常，实现免刷新的动态自动功能解锁。
- **后端双重物理卡关与心跳放行 (Backend Double Guarding & Heartbeat Bypass)**：
  - 除了状态轮询，后端在接收物理下载/上传等物理传输请求（如 `?download=1` 物理文件拉取、分块及 POST 上传）时，也必须对当前 `clientID` 做出超限判定，并在超限时直接拦截，向客户端发出 `403 Forbidden` 标准错误响应。
  - **关键点：必须放行心跳请求**。对于无害的状态同步心跳接口（如 `?ping=true` 接口），后端绝对不能在超限时进行 `403` 拦截。心跳必须始终保持可达并返回最新的状态，否则一旦 403 阻断心跳，移动端前台将无法感知 GUI 端的重置限额（Reset）或授权升级状态，导致设备被永久锁死。


## Mobile Multi-file Non-ZIP Download Constraints & Serial Queue Guidelines
- **Multi-file Download Issues**: Mobile browsers (especially iOS Safari and WeChat) block concurrent download triggers.
- **Serial Queue**: Sequentialize multiple file triggers by waiting for each file to reach the `transferred` status before starting the next.
- **Keep-alive Param**: Append client ID to hidden iframe sources to preserve session identity.

## Receive Mode Progress UX & Mobile Progress Indicators
- **Receive Mode Device Grouping**:
  - Display progress and received files grouped by client device in the desktop GUI, mapping individual `SavedFiles` and `Current` status inside each `ClientTransferStateInfo`.
  - Perform surgical UI updates (`updateReceiveTransferActiveUI`) to avoid global page redraws and maintain scroll positions.
- **Mobile Circular Upload Progress (XHR-based)**:
  - Track upload progress via `XMLHttpRequest`'s `upload.onprogress`.
  - Estimate sequential multipart upload progress using virtual boundaries scaled by a calculated factor (`e.total / totalFilesSize`).
  - Disable input elements and replace file delete buttons with SVG circular progress rings during active uploads, transitioning to a green ✓ on success and a red ✕ on failure.


## Receive Mode E2E UI Simulation via Chrome MCP (9222)
### Definition of Simulation Testing:
In EQT, a physical UI simulation involves running the compiled backend Go server on a local port (e.g. `18081`), and using the `chrome-devtools-mcp` tools connected to Chrome on port `9222` to spin up two virtual devices:
1. **The Desktop Receiver Viewer** (connecting to status APIs or rendering views).
2. **The Mobile Sender Client** (navigating to `/receive/<token>` to emulate file drops and composer text submission).
By automating page navigation, element clicking, text typing, and file selection in Chrome via MCP, we verify real-time layout changes, progress bar updates, multi-line list render states, and redirect-done page lists.

### How to request Chrome MCP UI Validation:
The user can trigger this validation by asking: "执行 Chrome MCP 仿真测试验证 UI 并截图" or adding `/chrome-test` to their request instructions.

### E2E UI Testing Step-by-Step Template:
1. **Start Local Service**: Spawn `go run . receive --port 18081 --keep-alive` asynchronously and parse the terminal output to extract the random URL Token (e.g., `LXwihruqXqxPpm3XpDXNu5Bh`).
2. **Initialize Sender Page**: In Chrome (9222), create a new tab using `new_page` and navigate to the upload page: `http://127.0.0.1:18081/receive/<token>`.
3. **Interact and Upload**:
   - Use `type_text` on `#plaintext-text` to write diagnostic testing text.
   - Use `click` on `#submit` to trigger TUS/Multipart upload submission.
4. **Capture Completed Card**:
   - Wait for redirection to `?done=true`.
   - Take a screenshot of the completed card page showing the list of files.
   - Save the screenshot to the artifacts directory as `receive_done_screenshot.png`.
5. **Verify GUI Status Feed**:
   - Query `/send/<token>/status` via fetch or navigate to `/` to check the receiver viewport.
   - Verify that the device progress block contains the device name (e.g. `"Linux (unknown)"` or similar parsed UA) and the details lists are correct.
6. **Clean Up**: Terminate the background Go process.

### Headless Sandbox Throttling & Mock Validation Tips:
- **Tus Upload Throttling in Loopback**: Chrome DevTools network emulation ignores `localhost` loopback traffic. To simulate slower network speeds for UI validation, wrap `http.Request.Body` in Go server (`handleTusUpload` routing) with a `throttledReader` that restricts maximum read buffer size per call (e.g., 32KB) and forces a `time.Sleep` (e.g. 10ms) to limit throughput to ~3.2MB/s.
- **Bypassing Tus Resume/Fingerprint Cache**: In test scripts, Tus might bypass uploads via instant resume matching. Force raw PATCH stream uploads by modifying the `fingerprint` option in `tus.Upload` to return a `Promise.resolve("unique-stamp-" + Date.now())`.
- **Handling Headless Chrome 0-Byte Sandbox Restrictions**: When Chrome is run under container/WSL headless modes, security sandbox constraints may cause `upload_file` targets to read as `0` bytes (empty files), triggering instant mock success. To force data flow simulation, check `uploadBlob.size === 0` in JS upload handlers and dynamically overlay a 105MB zero-filled virtual blob (`new Blob([new Uint8Array(105*1024*1024)])` to test 100MB+ large files) or construct more than 5 virtual files (e.g. 6 files, some with 55MB size to satisfy > 50MB and > 5 files count constraint verification) to force a full simulated PATCH stream upload and test limit blockings.
