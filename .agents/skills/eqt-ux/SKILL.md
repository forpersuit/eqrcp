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
  - **Fallback Scroll Restoration**: When replacing the overlay/modal is unavoidable, restore `scrollTop` immediately and also in subsequent ticks (e.g. `setTimeout(..., 0)` and `setTimeout(..., 50)`) to ensure the browser has completed its layout calculation and will not clamp `scrollTop` back to 0.

## Mobile Layout Adaptations & Titlebar Constraints
- **Branding & License Badges**: Add high-contrast license tier badges (e.g. using `.license-badge` with `var(--accent)`) next to the brand logo or title text. On mobile views, place it next to EQT title. On desktop GUI views, place it to the left of the 'Chat Status' sidebar panel header, scaling it down slightly (`font-size: 9px;`) to match the smaller layout context. Hide irrelevant timer status capsules (`.limit-status-pill`) when a paid plan is active, showing only the badge.
- **Prevent Action Overflows**:
  - Keep titles and badges strictly non-wrapping by applying `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`.
  - For narrow viewports (e.g. `<= 360px`), hide low-priority action buttons (such as `#share-session` session sharing button which is rarely used on visitor mobile devices) and scale down logos/gaps slightly to allocate sufficient space for the remaining actions.
- **Modals & Collapsible Panels Layout**:
  - Ensure mobile responsive modals/panels (such as `.session-backdrop.open .side`) preserve grid structures: do not rawly override `display` to `block` in media queries as it clears `grid-gap` spacing and compresses buttons; maintain `display: grid` with appropriate gaps (e.g. `gap: 14px`) to preserve spacing.

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

## 移动端接收管理与失败卡片规范 (Mobile Upload Management & Failure Cards)
- **传输异常友好呈现**：文件上传失败或异常（网络中断、大小超限、服务端 500 写入失败）时，严禁使用原生弹窗或直接把 raw 错误文本打在表单下方。必须直接将整个界面重绘为带有红色“✕”圆形徽章的“传输失败卡片”（样式与 Done 成功卡片对称），给普通用户呈现易懂的本地化解释（如局域网未联通、磁盘满、或文件超大等提示），并提供醒目的“返回并重试”按钮以快速重载页面恢复输入状态。
- **待传输列表累加与删除控制 (Plus 特权)**：
  - 移动端选择文件和粘贴内容应使用统一内存数组 `accumulatedFiles` 进行管理与提交。
  - **特权检测**：通过后端注入的 `IsPaid`, `ClockTampered` 与 `UsedSeconds` 计算出 `isPlusMode = (IsPaid && !ClockTampered) || (UsedSeconds < 300)`。
  - **累加删除**：在 `isPlusMode` 为 `true` 时，允许用户多次点击选择文件，新选中的文件将追加到 `accumulatedFiles` 中，且在 DOM 渲染列表中为每一项提供单独的删除按钮；
  - **超额回退**：在 `isPlusMode` 为 `false` 时，禁用累加和删除功能。即每次选择文件都将先清空数组（覆盖添加），且不渲染任何删除按钮。


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
- **后端双重物理卡关 (Backend Double Guarding)**：
  - 除了状态轮询，后端在接收物理下载 GET 请求（如 `?download=1` 物理文件拉取）时，也必须对当前 `clientID` 做出超限判定，并在超限时直接拦截，向客户端发出 `403 Forbidden` 标准错误响应，防止绕过网页端逻辑物理盗载。

