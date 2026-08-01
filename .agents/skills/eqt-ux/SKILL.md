---
name: eqt-ux
description: Guidelines for EQT user interface, DOM rendering optimization, notification styles, mobile responsive layouts, and Chrome DevTools MCP E2E simulation testing.
---

# EQT UI & Notification Guidelines

本技能指南归纳 EQT 在桌面端 (Wails) 与移动端 (H5/Svelte) 中的界面渲染、状态同步、无感更新、多语言 (i18n) 及 E2E 仿真测试规范。

---

## 1. 全量重绘下的不稳定 UI 状态维护 (Volatile UI State & DOM Diff)

- **全局 State 与 DOM 分离**：
  - 将易变状态（更新检测/下载阶段、警告消息、按钮内容等）保存在全局 `state` 存储中，而非纯依赖 DOM 结构。
  - 构造面板（如 `renderSettingsPanel()`）时动态读取全局 `state`。设置控件绑定 input/change 事件，实时同步 DOM 最新值回内存（`syncSettingsFromDOM()`）。
  - **就地增量更新 (In-place Node Updates)**：高频或局部状态变更（如更新检测状态、按钮禁用）优先通过 `textContent` 或 `disabled` 就地更新目标 DOM，避免调用全量重绘 (`syncPanelSurface`) 导致滚动条弹跳（`scrollTop` 归零）或焦点丢失。
- **滚动条恢复与焦点保持**：
  - 必须替换容器时，在替换前保存滚动容器（如 `.overlay .modal`, `.workspace`, `.path-list`, `.sidebar-history`）的 `scrollTop`，在渲染后立即及延迟 Tick（如 `setTimeout(..., 0)` 与 `50`）中恢复。
  - **搜索焦点项定位**：用户点击搜索结果后，列表由过滤视图恢复为全量视图时，将焦点项 ID 存入全局变量（如 `lastFocusedTaskId`），全量渲染后通过 `targetLi.scrollIntoView({ behavior: 'auto', block: 'nearest' })` 滚动定位。
- **`morphdom` 增量 DOM Diff 与事件防重复绑定**：
  - 使用零依赖 DOM Diff 库 `morphdom` 替代 `innerHTML` 的直接覆写，避免 DOM 闪烁（如 Tooltip 闪烁、二维码重载）和输入框失焦。
  - 前端重写 `EventTarget.prototype.addEventListener` 与 `removeEventListener` 的拦截包装器。检测到同一类型绑定相同语义的回调函数（比较 `listener.toString()`）时，先移除旧回调，确保同一元素只挂载单一监听器，并安全捕获最新状态闭包。
- **局部渲染 vs 全量渲染 (Partial vs Full Rerender)**：
  - `openPanel()`/`closePanel()` 只通过 `syncPanelSurface()` 就地 patch `.overlay` 面板区域，**不会**重渲染顶栏等外层 DOM。
  - 因此通过顶层事件委托（如顶栏 `...` 下拉菜单）打开面板时，须在委托处理器内显式调用 `render()` 全量重渲染，否则依赖 `state` 的下拉菜单/按钮角标等外层 UI 无法随 `state` 恢复关闭。
- **高频重绘点击丢包与节流 (Throttle & Pointer events)**：
  - 后台高频推送状态导致 DOM 频繁重建时，由于 `mousedown` 与 `mouseup` 落在不同周期的 DOM 节点上，浏览器无法触发 `click` 事件。
  - **避坑规范**：易频繁刷新的交互面板上，使用 `pointerdown` 替代 `click` 监听；前台接收后台状态更新（如 `agent-status`）的分发处实施 250ms 渲染节流限制。
- **骨架与数值分离就地更新 (Skeleton-Value Separation)**：
  - **骨架重构**：仅在设备连接状态变化（`clientID` 集合增减）或文件条目数等结构化元数据改变时，才执行一次性 `innerHTML` 骨架重写。
  - **就地更新**：结构未改变时，通过预埋带唯一标识（如 `clientID`）的 HTML `id`，使用 `document.getElementById` 直接定位节点，更新其 `textContent` 或 `style.cssText`。
- **活动输入框焦点保护 (Active Input Protection)**：
  - 收到后台推送（`agent-status`）、心跳同步（`applyStatusData`）时，若 `shouldProtectActiveInput()` 判定当前 `document.activeElement` 为正在编辑的输入框/文本域，挂起全屏 DOM 重绘，将状态暂留内存。
- **红点与阶段文本就地补丁 (Incremental Badges)**：
  - 自动更新检测阶段变化（后台完成下载变为 `ready`）时，不触发全屏重绘，直接通过 `updateSettingsBadgeUI()` 为 `#open-settings` 增量 append/remove `.badge-dot` 节点。

---

## 2. 响应式布局、移动端适配与标题栏规范

- **GUI 侧边栏与 Workspace 弹性布局**：
  - 在 `.layout` 上使用 `grid-template-columns: minmax(0, 1fr) minmax(230px, 300px);`，使历史侧边栏 (`.side`) 在 230px 至 300px 间弹性缩放，优先保障 `.workspace` 宽度。
  - 设置 `.side` 高度为 `100%; max-height: 100%; min-height: 0;`。历史列表内部滚动 `flex: 1; min-height: 0; overflow-y: auto;`。
  - 单列断点设定为 `@media (max-width: 768px)`。在 `<=768px` 模式下限制历史记录高度 `max-height: 280px; overflow-y: auto;`。
- **防止移动端输入自动缩放**：
  - 视口宽度 `<= 820px` 时，所有 input / textarea 字体大小不得小于 `16px`，防止 iOS Safari 等移动浏览器强行放大页面。
- **手势居中弹窗 (Centered Mobile Modals)**：
  - 移动端视口下，二维码分享与退出确认弹窗在水平和垂直方向居中，边缘保留 16px 安全 Padding（宽度 `calc(100% - 32px)`，最大 `340px`），配合 `transform: scale(0.95) -> scale(1)` 微动画。
- **会话结束控件锁定**：
  - 手动退出会话（`chatSessionStatus !== 'active'`）时，所有输入控件（附件 label、textarea、提交按钮、文件输入框）显式设为 `disabled`（或 `pointer-events: none;`），占位符替换为“会话已结束”。
- **Android 虚拟键盘布局修正**：
  - 移除主视口 CSS 高度动画 (`transition: height`)。
  - 注册全局 `scroll` 监听，滚动时重置 `window.scrollY` 为 `0`。
  - 对 input/textarea 注册 `focusin` 监听，以 50ms 频率连续调用 `window.scrollTo(0, 0)`（持续 600ms），抵消浏览器异步滚动偏移。

---

## 3. 多语言 (i18n) 与 Locale 匹配规范

- **桌面 UI (Wails)**：
  - 使用 `t(key)` 词条替换。保存语言偏好时调用 `applyLanguageChange(newLang)` 刷新 DOM，并向 `#chat-iframe` 发送 `postMessage` 消息。
- **移动端页面 (`upload.tmpl.html` & `chat.tmpl.html`)**：
  - 默认根据 `navigator.language` 渲染语种。
  - 语种偏好统一读写 LocalStorage 的 `eqt_lang` 与 `eqt-page-lang` 双键。
  - 词条包必须与 `en` 英文包进行深度 Merge 兜底，防止缺译字段报错。
  - 前端读取语言标识时统一执行 `toLowerCase().split('-')[0]` 归一化（如 `zh-CN` -> `zh`）。
  - **Iframe URL 稳定性**：桌面端 `renderChat()` 渲染 `#chat-iframe` 时，**绝对禁止**将语言字段拼接进 `iframe.src` URL 查询参数中（否则重绘时会强制重载 iframe 导致 Svelte 状态丢失）。语种同步完全依赖 `postMessage({ type: 'update-lang', lang })` 无刷新静默推送。

---

## 4. 移动端限额拦截与动态解锁规范

- **就地拦截与心跳保活**：
  - 探测到 `limit_exceeded` 状态时，就地切换 UI（展示警告徽章，隐藏下载按钮，列表设为 `pointer-events: none; opacity: 0.5;`），不得使用 `window.location.href` 重定向独立错误页。
  - **心跳放行**：心跳轮询（`?ping=true`）不能被 `clearInterval` 杀死，后端也**绝不能**在超限时对心跳拦截 403。心跳需保持可达，以便 GUI 重置限额或激活后，移动端能自动恢复 UI (`restoreNormalUI()`)。

---

## 5. Chat V2 与 Receive 模式进度与传输 UX

- **Wails 嵌入式 Iframe 静默下载 Bridge**：
  - 内嵌 Svelte 页面中点击下载时，发送 `postMessage` (`{ type: 'download-file', url, messageId, name }`) 到父窗口。宿主调用 Wails 绑定 `DownloadChatAttachment(url, name)` 执行后台静默下载，避免弹出 WebView2 默认下载管理器。
  - 用户点击取消时，发送 `{ type: 'cancel-download', messageId }` 派发 Go 端取消信号，立即中断物理 HTTP 传输流。
- **物理上行上传物理取消 (Physical Upload Active Abort)**：
  - 客户端取消上传时，除了向 WebSocket 发送取消消息外，必须物理调用 `xhr.abort()` 强行终止 TCP 上行流量，并在 `onabort` / `onerror` 中设置 `isAborted` 哨兵屏蔽无意义错误提示。
- **传输完成状态自愈 (WebSocket 重连修复)**：
  - 移动端锁屏重连时，后端重放历史事件需对 `Transfer` 事件放行（`e.Message != nil || e.Transfer != nil`）。
  - 前端计算下载完结状态时，结合 `msg.downloaded` 与 `completedMap[msg.id]`。若物理传输早已成功结束，主动将 UI 从悬空的“传输中”纠正为“已就绪”状态。

---

## 6. Chrome DevTools MCP E2E 仿真测试模板

### E2E Chat v2 仿真测试步骤 (3-Device Verification)
1. **启动本地服务**：后台启动 `go run ./cmd/eqt/ chat --port 18081 --bind 127.0.0.1 --keep-alive` 并解析随机 URL Token。
2. **在 Chrome (9222) 打开 3 个 Tab**：
   - **Device 1 (GUI Side)**: `http://127.0.0.1:18081/chat-v2/<token>?peer=desktop`
   - **Device 2 (Mobile A)**: `http://127.0.0.1:18081/chat-v2/<token>?peer=peer-A`
   - **Device 3 (Mobile B)**: `http://127.0.0.1:18081/chat-v2/<token>?peer=peer-B`
3. **关闭 QR 弹窗蒙版**：定位 `button[title="Close"]` 并调用点击。
4. **发送与接收对齐测试**：
   - 在 Mobile A 页面输入 "Hello from A"，校验 Mobile A 画面居右（`.message.mine`），Mobile B 与 GUI 画面居左。
   - 在 GUI 页面输入 "Reply from GUI"，校验 GUI 画面居右，Mobile A 与 Mobile B 画面居左。
5. **清理环境**：终止后台 Go 进程。

### E2E Receive 模式仿真测试步骤
1. **启动本地服务**：`go run . receive --bind 0.0.0.0 --port 18080 --keep-alive` 并提取 Token。
2. **初始化发送页面**：`new_page` 导航至 `http://127.0.0.1:18080/receive/<token>`。
3. **交互与提交**：通过 `evaluate_script` 给 `#plaintext-text` 赋值并点击 `#submit`。
4. **验证 Done 成功卡片**：数据提交完成后，验证重定向至 `?done=true`，截取 Viewport 图像确认绿色成功卡片。

---

## 7. 推广分享海报卡 (Share Poster Card) 布局与下载一致性

- **box-sizing 陷阱**：`.share-poster-card` 必须设 `box-sizing: border-box`（本项目其他组件均单独设置，唯独此卡曾遗漏）。若漏设，`min-height: 340px` 只约束内容盒，实际渲染高度 = 340 + 上下 padding + 边框 ≈ 412px，导致 logo 与底部边框间距空出 130px+。排查"卡片比预期高"类问题时优先用 `getComputedStyle(el).boxSizing` 验证。
- **垂直居中**：内容块（二维码 175px + 20px 间距 + logo 48px ≈ 243px）在 340px 卡内用 `justify-content: center` 垂直居中，实测节奏 ≈ 48/20/50。固定高度卡片务必居中，否则内容被 flex-start 钉在顶部、底部空出一大块。
- **下载图与 DOM 展示一致性**（`downloadSharePosterImage` Canvas 手动绘制）：
  - logo 必须按 `object-fit: contain` 等比计算（在 175×48 盒内先按宽算高、超 48 再按高回算宽），禁止写死 `175×44`（会把 logo 水平拉长 1.25×）。
  - 二维码绘制用 `ctx.roundRect(..., 8)` + `ctx.clip()` 复刻 DOM `.share-qr-img` 的 `border-radius: 8px`。
  - 散落图标图标池必须与 DOM `generateRandomScatteredIcons` 的列表一致。
  - 卡片尺寸用 `getBoundingClientRect()` 实时读取，修好 DOM 布局后下载图自动跟随；但下载函数的内部偏移需与最终布局方案（如居中）保持一致。
- **验证路径**：在 `desktop/gui/frontend` 下起 `npm run dev -- --port 5199`，Chrome 打开后 hook `HTMLCanvasElement.prototype.toDataURL` 捕获真实下载 PNG，再解码采样像素比对二维码/logo 边界与间距。
