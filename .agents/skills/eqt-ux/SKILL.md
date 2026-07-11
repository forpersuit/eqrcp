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
  - **Fallback Scroll Restoration & Focus Positioning**: When replacing the workspace, modal, or lists is unavoidable, save and restore the `scrollTop` values of all potentially scrollable containers (e.g. `.overlay .modal`, `.workspace`, `.path-list`, `.sidebar-history`, `.locked-list`, `.file-list-view`, `.transfer-stage`) by selecting and storing them before the replacement, and restoring them immediately after rendering. For overlay/modal elements, also use delayed ticks (e.g., `setTimeout(..., 0)` and `setTimeout(..., 50)`) to ensure layout completion and prevent the browser from resetting the scroll to 0.
    - **Search Target Focus Preservation**: When the user clicks on a search result (e.g. within a history search dropdown) and the list later reverts from filtered to full view (like when clicking outside to close the search), a simple `scrollTop` restoration will fail because the filtered list had `scrollTop = 0`. In such cases, save the focused item ID in a global state variable (e.g. `lastFocusedTaskId`) on click, and after rendering the full list, scroll the matching item back into view using `targetLi.scrollIntoView({ behavior: 'auto', block: 'nearest' })` inside a delayed tick. Clear the focus ID when the user explicitly closes the search tool.
  - **morphdom 增量 DOM Diff 修补与事件防重复绑定劫持**：
    在原生 JS 的全局 `render()` 重载中，为了彻底避免 UI 重绘带来的闪烁（如 Tooltip 气泡闪烁、二维码重载闪动）和输入框失焦问题，应使用零依赖 of DOM Diff 库 `morphdom` 替代 `innerHTML` 的直接覆写。为了防止 DOM 节点被复用时导致事件监听器重复绑定（例如 `addEventListener` 绑定新的匿名箭头函数），必须在前端最头部重写 `EventTarget.prototype.addEventListener` 与 `removeEventListener` 的包装拦截器。在检测到为同一类型绑定相同语义的回调函数（通过对比 `listener.toString()`）时，先使用原生 `removeEventListener` 移除旧回调，确保任何时候同一元素只挂载单一监听器，且能够安全捕获最新的状态闭包。
  - **High-frequency DOM Rebuild Click Loss & Throttle (高频 DOM 重载点击丢包与局部重绘节流)**：
    - **成因**：当后台传输高频推送状态并引起 innerHTML 大面积覆盖重写时，由于按钮或行的 `mousedown` 与 `mouseup` 分属于不同重建周期的 DOM 节点，浏览器无法产生 `click` 事件导致折叠展开或按钮点击失效。
    - **避坑准则**：在此类局部列表或易频繁刷新的交互面板上，必须使用 `pointerdown` 代替 `click` 监听以瞬时响应事件；同时，在前台接收后台状态更新（如 `agent-status`）的分发处，对于传输中状态的局部重绘操作，必须实施 250ms 渲染节流限制，从源头上减少 DOM 闪动与物理重构，为滚动和点击手势预留充足的平滑生存时间窗。
  - **Skeleton-Value Separation Target-based In-place Updates (骨架与数值分离就地精准静默更新)**：
    - **核心理念**：为避免列表数据变化时重建 DOM 带来滚动打断、悬停抖动、选区丢失等交互问题，对于频繁更新的列表类 UI 交互，应采用“骨架与值分离”的刷新设计。
    - **设计准则**：
      1. **判定骨架重建**：只有当设备连接状态变化（如 `clientID` 集合增减）、文件条目数等结构化元数据发生改变时，才允许执行一次性的 `innerHTML` 骨架重构。
      2. **精准就地更新**：若结构化骨架未发生改变，禁止以任何形式重写外层容器的 `innerHTML`，必须为需要变动的文本、进度条、状态徽章等高频波动节点预埋带唯一标识（如 `clientID`）的 HTML `id`。在状态监听分发处，通过 `document.getElementById` 直接定位对应 DOM 节点，精准局部刷新其 `textContent`、`style.cssText` 或局部 `innerHTML`（仅限内部细微徽章）。
      3. **未来适配要求**：未来在开发任何包含高频状态流（如传输进度、连接数、性能指标）的 UI 界面时，均需以此就地静默更新机制为标准，绝对禁止暴力覆载容器 innerHTML。

  - **Avoiding High-frequency Lock Contention on UI Feeds**:
    - **Issue**: High-frequency updates on write streams (e.g. updating `BytesDone` inside `onWrite` per network write chunk) trigger severe lock contention on status mutexes (`statusMu` / `clientStatesMu`) up to thousands of times per second. This starves the desktop GUI's main thread status retrieval, locking/freezing the interface (making Wails GUI non-scrollable and unresponsive).
    - **Rule**: Never update client states or trigger status mutex locks on high-frequency stream events. Simplify UI displays by showing low-frequency state transitions (e.g., `transferring` on start, `completed`/`failed` on finish) instead of computing complex concurrent stream percentages. Keep byte counters atomic or locally bounded to prevent CPU lock contention.

## Mobile Layout Adaptations & Titlebar Constraints
- **Branding & License Badges**: Add high-contrast license tier badges (e.g. using `.license-badge` with `var(--accent)`) next to the brand logo or title text. On mobile views, place it next to EQT title. On desktop GUI views, place it to the left of the 'Chat Status' sidebar panel header, scaling it down slightly (`font-size: 9px;`) to match the smaller layout context. Hide irrelevant timer status capsules (`.limit-status-pill`) when a paid plan is active, showing only the badge.
- **Prevent Action Overflows**:
  - Keep titles and badges strictly non-wrapping by applying `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`.
  - For narrow viewports (e.g. `<= 360px`), hide low-priority action buttons (such as `#share-session` session sharing button which is rarely used on visitor mobile devices) and scale down logos/gaps slightly to allocate sufficient space for the remaining actions.
  - **Mobile Input Scaling Prevention & Panel Positioning**: To prevent mobile browsers (e.g. iOS Safari) from automatically zooming in when focusing an input field, all inputs (such as the device name rename input) must have a font-size of at least `16px` on viewport widths `<= 820px`. Tap targets (e.g., input and action buttons in a rename form) should also be scaled up to `36px` to improve ergonomics. Additionally, small popup panels like `.device-panel` must use adaptive percentage-based boundaries (e.g., `left: 8px; right: 8px; width: auto; min-width: 0;`) instead of hardcoded minimum widths to prevent overflow cut-offs on narrow screens.
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
- **Chat iframe Native File Picker & Download Bridge**:
  - The chat page runs inside a Wails-hosted iframe, so `chat.tmpl.html` and `App.svelte` must not call `window.parent.go` or Wails bindings directly.
  - **Native File Picking**: For GUI-only native actions such as selecting local chat attachments, send a trusted `postMessage` request (e.g. `{ type: 'select-files' }`) from the iframe to `desktop/gui/frontend/src/main.js`; the parent window calls the Wails binding (for example `SelectFiles`) and posts the result back with a request ID. Local GUI attachments should register paths through `/attachments/local`; they must not enter the TUS upload queue or show sender-side upload percentages.
  - **Native Silent Downloading (Preventing Edge/WebView2 browser popups)**: Under Wails GUI embedding mode, files must NOT be downloaded using local standard `<a>` tag click downloads as this triggers default WebView2 browser download managers and popups. Instead, post a message (`{ type: 'download-file', url, messageId, name }`) to the parent window; the parent calls the Go backend Wails binding `DownloadChatAttachment(url, name)` to execute background silent downloading. Upon success, parent posts `{ type: 'download-success', messageId, path }` back, and Svelte registers this path on the file message to display a file location folder button next to the download button.
    - **Active Download Cancellation and Stop Button Interaction**: During active silent downloads in Wails GUI, the Save button in the embedded `chat.tmpl.html` changes its icon to a cancel close mark (via `.btn-cancel-download` class) and its title/aria-label to "Cancel". Clicking it triggers a `{ type: 'cancel-download', messageId }` postMessage, which invokes the Wails binding `CancelChatDownload(messageID)`. The Go backend tracks each active HTTP download client query context via a cancellable context map (`App.downloads`). When Cancel is requested, or when the entire chat session stops (`StopChat` / `quit`), the context is immediately cancelled, successfully terminating the HTTP transfer stream and physical TCP connection to prevent the background download thread from running forever.
    - **Local Domain Origin Verification Trap**: When comparing `e.origin` with URL origin to verify download trust (e.g. inside `isTrustedChatURL`), local dev configurations might cause loopback address mismatch (e.g. `http://localhost:18081` vs `http://127.0.0.1:18081`). Ensure origin domains are normalized (treating `localhost` and `127.0.0.1` as identical) before making strict equivalence comparisons.
- **原生二次确认框 (Native Confirmation Dialogs)**:
  - 在需要用户强确认的操作（如切换运行模式）时，严禁使用浏览器原生 `confirm()`。应当在 Go 端通过 `wailsruntime.MessageDialog` 封装一个 RPC 方法（例如 `Confirm`），由 JS 异步调用以呈现操作系统原生的对话框，避免网页弹窗打断与卡死，提升应用的原生质感。
- **WebView 物理文件拖拽稳定性 (Reliable Webview Drag & Drop)**:
  - **问题成因**：在 Wails 应用中，即使在容器上声明了 `style="--wails-drop-target: drop"`，拖拽文件时如果落在该容器内部 of 子元素（如文字标题、小图标）上，拖放事件仍极易被 WebView 吃掉导致失效。
  - **解决方案**：除了在容器（如 `.drop-target`）上设置 `--wails-drop-target` 外，必须通过 CSS 给其内部所有子元素配置 `pointer-events: none;`（例如 `.drop-target * { pointer-events: none; }`）。这能够强行将拖拽焦点和鼠标事件穿透到父级拖拽容器，实现平滑、稳定地接收桌面物理文件。
- **嵌入式 iframe 的高度塌陷与拉伸自适应 (Embedded iframe Height Resizing stability)**:
  - **问题成因**：在 Wails 桌面端，Chat v2 等界面运行在嵌入式的 iframe 中。当用户拖拽窗口边缘调整大小时，如果子页面的 `html` / `body` / `#app` 等容器没有强制 `100%` 高度，或者受限于浏览器的高度循环计算，在窗口被拉小后再拉大时，iframe 极易在变矮时的物理像素高度上“死锁”，导致消息区域塌陷缩小且无法自动复原。同时，在输入框因多行输入或 resize 变高时，若消息历史区域（`.messages`）的底边距写死（未关联 `--composer-height`），将导致底部最新消息被输入框遮挡。此外，若 resize 发生时消息历史区域没有同步滚动到底部，会导致上方出现大量空白，并给用户造成区域塌陷的视觉假象。
  - **解决方案**：
    1. **强制高度继承**：在子页面 CSS 中，为 `html.embedded-chat`, `html.embedded-chat body`, `html.embedded-chat .chat-viewport`, `html.embedded-chat #app` 统统设置 `height: 100% !important; min-height: 0 !important; overflow: hidden !important;`。
    2. **绑定输入框高度（防止遮挡与双重扣除冲突）**：若界面输入框采用绝对定位（`position: fixed/absolute`）覆盖在列表之上，必须将消息历史区域（`.messages`）的 `padding-bottom` 和 `scroll-padding-bottom` 设置为 `var(--composer-height, var(--messages-bottom-space))`。但如果整个聊天视口采用的是 CSS Grid (`grid-template-rows: auto minmax(0, 1fr) auto;`) 等非重叠轨道排版，输入框已经在下方独占一行，则**严禁**在消息列表中引入 `--composer-height` 的底部 padding，否则当输入框变高或窗口缩小时会发生双重扣除高度的冲突，导致有效的聊天消息区域发生严重坍缩并出现大片空白；在此 Grid 模式下列表只需使用固定的 `--messages-bottom-space` 作为垫底距离即可。
    3. **自动滚动贴底**：在 resize 或输入框尺寸重算逻辑的末尾，通过 JS 获取滚动容器并强制贴底滚动：`const messagesEl = document.querySelector('.messages'); if (messagesEl) { messagesEl.scrollTop = messagesEl.scrollHeight; }`。

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
  - **History Device Grouping**: For the completed transfer history records, they should also display files grouped by client devices. To preserve device-to-file mapping after transfer completion, make sure the desktop agent's history serialization/cloning (`cloneTaskRecord`) deep copies `SavedFiles` in `ClientTransferStateInfo`, and `renderHistoryFiles` inside `history.js` parses and renders the grouped lists accordingly.
- **Mobile Circular Upload Progress (XHR-based)**:
  - Track upload progress via `XMLHttpRequest`'s `upload.onprogress`.
  - Estimate sequential multipart upload progress using virtual boundaries scaled by a calculated factor (`e.total / totalFilesSize`).
  - Disable input elements and replace file delete buttons with SVG circular progress rings during active uploads, transitioning to a green ✓ on success and a red ✕ on failure.

## Chat Mode Progress UX & Bidirectional Progress Indicators
- **Bidirectional Progress Support**:
  - In Chat mode, both sending (uploading) and receiving (downloading) attachments show real-time progress.
  - Progress is displayed visually on the attachment description text (the file description element underneath the bubble) by styling it as a text-clipped progress bar using a CSS gradient background.
- **Browser Download Stability**:
  - Do not use browser-side XHR/fetch + Blob/ObjectURL for regular chat attachment downloads. Safari/WebKit can crash with `webkitblobresource` errors on large or parallel Blob downloads.
  - For non-Wails browsers, prefer native `<a href download>` direct HTTP downloads so the browser download manager handles streaming. Put bandwidth limits on the server stream path, not in browser memory buffering. Wails/native Go downloads may still emit local progress from the Go HTTP client.
- **Simplified Download & Automatic Dynamic Speed Allocation**:
  - In Chat Mode, attachment bubbles should only present a single, unified "Download", "Retry", or "Redownload" action button rather than presenting two redundant paths (e.g., standard vs. VIP).
  - The UI does not determine the transmission tier. The backend automatically decides the transmission speed limit dynamically: if the system is paid or within the daily 5-minute free window, it transmits at maximum speed (PRO/PLUS Policy); otherwise, it defaults to standard rate-limiting (Free Policy, 512KB/s).
- **Percentage Display Positioning**:
  - Real-time progress percentages (e.g. `45%`) are displayed adjacent to the attachment description text.
  - Position percentages according to layout flow:
    - **Sending side (Mine, right-aligned)**: The percentage is displayed to the **left** of the description text (in the center direction of the screen).
    - **Receiving side (Not Mine, left-aligned)**: The percentage is displayed to the **right** of the description text (in the center direction of the screen).
  - Use Flexbox `row-reverse` dynamically via CSS `.mine` structure to handle this layout switch automatically by simply placing the percentage element immediately after the description element in HTML.
- **Finished State Visual Persistence**:
  - Once transfer (upload/download) is finished, keep the color of the description text as the highlight theme color (`fillClr`) instead of reverting it to the default muted gray (`var(--muted)`), establishing a persistent visual cue for successfully transferred attachments.


## Chat Mode E2E UI Simulation via Chrome MCP
### E2E Chat v2 UI Testing Step-by-Step (3-Device Verification):
1. **Start Local Service**: Spawn `go run ./cmd/eqt/ chat --port 18081 --bind 127.0.0.1 --keep-alive` asynchronously and parse the terminal output to extract the random URL Token (e.g., `Ic6mFk6TEG74JXumFfF8ZEhB`).
2. **Open Three Pages in Chrome**:
   - **Device 1 (GUI Side)**: Open a tab navigating to: `http://127.0.0.1:18081/chat-v2/<token>?peer=desktop`
   - **Device 2 (Mobile A)**: Open a tab navigating to: `http://127.0.0.1:18081/chat-v2/<token>?peer=peer-A` (Simulates Mobile Client A scanning QR to join)
   - **Device 3 (Mobile B)**: Open a tab navigating to: `http://127.0.0.1:18081/chat-v2/<token>?peer=peer-B` (Simulates Mobile Client B scanning QR to join)
3. **QR Backdrop Modal Closing**: For all three opened tabs, locate the close button via selector `button[title="Close"]` and click it using `evaluate_script` to reveal the main chat list and composer.
4. **Sender & Receiver Display Alignment Test**:
   - **Step A**: Select Mobile A's tab (Device 2) and send a message "Hello from A". Verify that on Mobile A's screen, the message displays on the right side (`.message.mine` class is present).
   - **Step B**: Select Mobile B's tab (Device 3). Verify that the message "Hello from A" is received and displays on the left side (no `.mine` class, `.message` only).
   - **Step C**: Select GUI Side's tab (Device 1). Verify that the message "Hello from A" is received and displays on the left side (no `.mine` class).
   - **Step D**: Send a message "Reply from GUI" from the GUI Side's tab. Verify that on the GUI side it displays on the right side (`.mine`), and on both Mobile A and Mobile B tabs it displays on the left side.
   - **Step E (Color Sweep Verification)**: Verify that the theme variables (`--accent`, `--wash`) calculated on each tab are unique and different (e.g., Mobile A gets a different color wash than Mobile B).
5. **Clean Up**: Terminate the background Go process.

### Critical Styling & Store Binding Verification Checklist:
- **CSS Nesting Check**: Ensure no missing closing curly braces `}` in `app.css` (e.g. inside media queries or hover classes) as it leaks nested selector constraints and breaks global backdrop displays (`display: none` overridden to `block`).
- **Store Bindings**: Verify that `messages={$messages}` and `txState={$transfers}` are explicitly bound to `<MessageList>` in `App.svelte` so the message list reactively populates in the DOM tree.


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
- **Mocking Wails Runtime for Browser Dev Server Preview**: When previewing the Wails frontend in a standard browser (e.g. running `npm run dev`), the Wails runtime API (`window.go` and `window.runtime`) is absent and will cause load/runtime errors. Inject a JS Proxy and Mock objects early (e.g. in `index.html`) to intercept calls:
  - Mock `window.runtime.EventsOnMultiple` to capture callbacks (which handles wrapper calls to `EventsOn`).
  - Use a `Proxy` on `window.go.main.App` that dynamically returns `() => Promise.resolve({})` for any accessed property, avoiding undefined-function crashes when frontend invokes Wails Go backend methods.
- **Vite relative assets path (base: "./") routing trap**: When Vite builds assets to `dist/assets/` using relative paths, and Go handles dynamic routes by cutting the token (e.g. `/chat-v2/:token/`), the browser's request for `assets/` will cut `assets` as the token. To prevent 404 responses or incorrect stylesheet MIME type (text/plain) rejections, intercept special token names (such as `"assets"`, `"favicon.png"`) inside `ServeHTTP` and restore their file paths to `distPath + "/" + token + suffix`.
- **E2E Chat v2 Large File Rendezvous Simulation Verification Method**:
  - **Problem**: Running Chrome E2E simulation tests for large file streaming in headless mode may fail because standard `<a>` tag click downloads are blocked by headless Chrome's default security rules. Also, initiating parallel download commands and stream POSTs too quickly can lead to a Race Condition if the WebSocket `start_transfer` command arrives before the HTTP GET handler has called `CreateJob`.
  - **Solution**:
    1. **Eliminate Race Condition**: The Go server should resolve the exact file size from `MessageStore` beforehand so that standard HTTP GET headers (`Content-Length`) are committed properly at the top of the route handler. Protect the proxy write pipeline using `io.LimitReader(senderStream, msg.Size)` to guarantee that no extra bytes are written, physically preventing `wrote more than declared Content-Length` panic crashes.
    2. **Headless Stream Consumer**: In the simulated browser page context, bypass native `link.click()` by evaluating an asynchronous `fetch` stream consumer that reads and discards chunks from the `/files/:messageId` route:
       ```javascript
       fetch(downloadURL).then(async response => {
         const reader = response.body.getReader();
         while (true) {
           const { done } = await reader.read();
           if (done) break;
         }
       });
       ```
       This keeps the TCP receive window open and pulls the stream correctly through the server's bandwidth controller.
    3. **Simulating Network Drops**: Force-killing the uploading `curl` process during active streaming will trigger an `unexpected EOF` in Go's `io.Copy`. Verify that the UI reactive WebSocket listener successfully updates the target bubble to a red `传输失败 ⚠️` badge and popup tooltip displaying the exact error message.




## Receive Mode Keep-Alive, Auto-Stop, and Client-ID Accumulation
- **Client-ID Reuse and File Accumulation**: 
  - When the same client (reusing `clientID` via Cookies) starts a new transfer scan in `receive` mode, the server must NOT reset `cs.SavedFiles` or `cs.Files` to `nil` in the `init` handshake.
  - Retain the previously completed files and append the new files to `cs.Files`.
  - Calculate `cs.BytesTotal` and `cs.BytesDone` as the sum of all previously completed files plus the new files, so the progress bar seamlessly continues from the completed percentage.
- **Auto-Stop Multi-Device Coordination**:
  - Toggling `autoStop` to true in `receive` mode should only trigger shutdown when all connected devices have finished (i.e. `isAllActiveClientsFinished()` returns `true`).
  - An active device is considered completed if its state is `"completed"`.
  - If a device completes its transfer and the server keeps running (`KeepAlive` is active and `autoStop` is false/pending other devices), the global server status state must transition to `"waiting"` (e.g. `"Transfer completed. Waiting for more files."`) rather than `"completed"` to prevent the Wails GUI from prematurely archiving the session and generating infinite loop notifications.
- **Desktop Agent State Clean-Up**:
  - In `desktopAgent.observeTransferStatus`, once a session reaches any terminal state (`stopped`, `replaced`, `completed`, `failed`), all ongoing task references (`agent.current`, `agent.busy`, `agent.activeStop`) must be fully cleared. This ensures that final notifications and history writes occur exactly once.

## Bypass Device File Message Synchronization (旁路设备文件消息同步规范)
- **Problem**: In chat v2 mode, to prevent bypass devices (C) from seeing messy progress indicators, upload messages are filtered on the server and not sent to C. Once B (desktop GUI) finishes downloading, the file becomes ready for everyone.
- **Rules**:
  1. **Duplicate Add Avoidance**: In `/upload/init`, do not add the message to the store twice. Let the broadcast mechanism be the sole entry point to avoid sequence duplication.
  2. **Event Progression**: Upon download completion by B, mark the message as downloaded (`Downloaded = true`) in the store and broadcast `EventMessageUpdated` (not `EventMessageAdded`) to notify all clients.
  3. **Robust Frontend Insertion**: Since bypass device C did not receive the upload init message, C's local message list is empty. The frontend `updateMessage` store method must dynamically check if the incoming updated message exists; if it does not exist, it must append and sort the message in the list. This ensures C instantly reveals the ready-to-download file bubble.
  4. **State-level Filter Alignment**: In `MessageList.svelte`, keep `isDownloaded = false` for C (which is `!isEmbedded`) until C itself has finished downloading, rendering the standard download arrow button for C.

