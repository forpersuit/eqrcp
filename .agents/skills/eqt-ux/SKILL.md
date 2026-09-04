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
  - 收到后台推送（`agent-status`）、心跳同步（`applyStatusData`）时，即便是包含付费/篡改状态变更（`paidChanged`），若 `shouldProtectActiveInput()` 判定当前 `document.activeElement` 为正在编辑的输入框/文本域，必须挂起全屏 DOM 重绘，保护输入焦点与光标。
  - 所有带有未提交暂存状态的输入框（如 `#redeem-code`）必须绑定 `input` 事件实时同步当前输入至全局 `state` 内存（如 `state.tempRedeemCode`），形成 DOM 与 Memory 的双保险。
- **输入框失焦 (Blur) 与按钮点击事件防吞 (Click Event Swallowing Prevention)**：
  - 当用户在输入框聚焦输入完毕并直接点击操作按钮时，浏览器的底层触发顺序为：`mousedown`（目标为按钮子节点如 `<span>`）-> 输入框 `blur` -> `mouseup` -> `click`。
  - **规则**：严禁在输入框的 `blur` / `input` 事件处理器中无差别全量重写相关按钮的 `innerHTML`（如 `btn.innerHTML = '<span>...'`）。这会导致 `mousedown` 命中的子节点在 `blur` 时被销毁，浏览器无法判定同一节点闭合而**直接丢弃 `click` 事件**（导致用户必须点第二次才触发）。
  - **实践**：状态更新时优先判断并更新 `textContent`、`disabled` 或 `classList`，保持按钮内层 DOM 树的稳定性；同时为输入框配备 `keydown` (Enter) 快捷触发。
- **红点与阶段文本就地补丁 (Incremental Badges)**：
  - 自动更新检测阶段变化（后台完成下载变为 `ready`）时，不触发全屏重绘，直接通过 `updateSettingsBadgeUI()` 为 `#open-settings` 增量 append/remove `.badge-dot` 节点。
- **多语言切换与动态 DOM 状态即时同步 (i18n Dynamic Sync)**：
  - 在 `applyLanguage()` 中，除了替换带有 `[data-i18n]` 静态属性的节点外，必须显式调用动态渲染函数（如 `updateLimitUI`、`renderFiles`）。
  - **避坑原则**：严禁让动态生成的提示（如免费配额 Banner、文件超限 Badge）依赖下一次心跳轮询才被动更新语言，避免用户感知到数秒的多语言刷新延迟；若存在倒计时中的浮层/胶囊，切换语种时应就地替换文本，保持倒计时动画与秒数平滑连续。

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

- **Web 管理后台 (Cloudflare Pages / Svelte 5)**：
  - **全站 i18n 接线与零硬编码**：所有业务卡片（如 3D 地球 `LicenseGlobeCard`、探针监控 `SystemHealth`、审计表格 `OpsAudit`）、模态框 `aria-label`、Tooltip、图表文字等必须全面接入 `$t()`。新增键时必须在 `zh.ts` 和 `en.ts` 中双向同步。
  - **Modal 焦点生命周期完整闭环**：当父组件采用条件销毁模式（`{#if showModal}<Modal open={true} ...>{/if}`）挂载弹窗时，`open` 属性恒为 `true` 且组件关闭是通过 DOM 卸载完成的。因此必须在 Svelte 5 `$effect` 的 cleanup 返回函数以及 `onDestroy` 钩子中执行 `previouslyFocused?.focus()`，确保弹窗销毁后焦点平稳归还给触发元素，防止焦点回落到 `<body>` 破坏无障碍体验。
  - **前后端审计动作枚举严密对齐**：前端动作筛选下拉菜单与 `AdminAuditAction` 类型必须与后端 Worker 实际写入的全部 9 种审计动作（`GENERATE`, `REVOKE`, `UNBIND`, `CLEAR_LOGS`, `QUERY_ACTIVATION_LOCATIONS`, `QUERY_LIVE_DEVICES`, `PRUNE`, `BLACKLIST_ADD`, `BLACKLIST_REMOVE`）严格 1:1 对齐，并通过 `$t` 支持本地化展示。
  - **审计摘要提取字段健壮性**：黑名单添加/解封等操作的 `details_json` 字段提取应防呆兼顾多重字段名（如 `d.email || d.device_id || d.target || row.target_id`），避免后端字段名微调导致摘要退化为兜底文案。

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
- **长文本气泡上下文菜单自适应展开与手势规范 (Bubble Context Menu Placement & Gesture Guidelines)**：
  - **手势触发规范**：移动端仅通过向左/右滑动气泡（`swipeable`）唤起操作菜单，禁用长按触发，防止与系统选词和页面手势冲突；桌面端支持右键直接触发。
  - **左右边框箭头对齐 (Side Arrows)**：菜单箭头始终位于菜单的左右两侧边框（`placement-left` / `placement-right`），箭头垂直高度（`--arrow-y`）精准对齐手指滑动触控点的 `clientY` 坐标，禁止出现上下边框箭头。
  - **移动端窄屏内侧自适应**：发送方（Mine）向左展开（`placement-left`），接收方（Other）向右展开（`placement-right`）；若外侧空间不足，自动贴合气泡内侧安全区域呈现。
  - **全局失焦即时关闭**：用户点击屏幕任何非菜单区域（包括气泡、消息空白区等）时，立即在 `pointerdown` 时触发 `closeMenu()` 干净关闭。

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

### E2E 移动端遥测与下载上报仿真测试步骤 (Telemetry & Download Verification)
1. **启动本地服务**：`go run . send <file> --bind 127.0.0.1 --port 18096 --keep-alive` 并提取 Token。
2. **浏览器页面导航**：通过 Chrome DevTools MCP `navigate_page` 访问 `http://127.0.0.1:18096/send/<token>`。
3. **页面加载与上报校验**：
   - 验证 `GET /assets/telemetry.js` 成功返回 200。
   - 调用 `list_network_requests` 检查首个 `POST /client-log` 上报，验证 Payload 包含 `PAGE_LOAD` 事件且返回 204。
4. **下载交互与上报校验**：
   - 通过 `click` 触发下载按钮，验证连续触发包含 `DOWNLOAD_CLICK` 与 `TRANSFER` 的 `POST /client-log` 上报。
5. **视觉截屏归档**：调用 `take_screenshot` 抓取已下载完成的 UI 视图并保存归档。

---

## 7. 推广分享海报卡 (Share Poster Card) 布局与下载一致性

- **box-sizing 陷阱**：`.share-poster-card` 必须设 `box-sizing: border-box`（本项目其他组件均单独设置，唯独此卡曾遗漏）。若漏设，`min-height: 340px` 只约束内容盒，实际渲染高度 = 340 + 上下 padding + 边框 ≈ 412px，导致 logo 与底部边框间距空出 130px+。排查"卡片比预期高"类问题时优先用 `getComputedStyle(el).boxSizing` 验证。
- **垂直居中**：内容块（二维码 175px + 20px 间距 + logo 48px ≈ 243px）在 340px 卡内用 `justify-content: center` 垂直居中，实测节奏 ≈ 48/20/50。固定高度卡片务必居中，否则内容被 flex-start 钉在顶部、底部空出一大块。
- **二维码网址与离线生成 (100% Offline QR Generation)**：
  - 推广海报与官网链接统一为 `www.eqt.net.im`。
  - 二维码生成优先调用 Wails 原生绑定的 Go 端 `GenerateQRCodePNG(content, size)`（基于 `github.com/skip2/go-qrcode` 高容错 `qrcode.Highest` 算法），直接返回 Base64 Data URL。
  - **零外部网络依赖**：即使在完全断网/离线机房环境下，也能毫秒级本地合成带 Logo 徽章的高清海报二维码并保存，杜绝依赖第三方外部 QR API。
  - **占位图 Base64 化 (Placeholder SVG Must Be Base64-Encoded)**：面板占位二维码必须使用 `data:image/svg+xml;base64,<...>` 编码（内容与 `components/share.js` 的 `placeholderQRSvg` 一致），**严禁**在 HTML `src` 属性中内联 UTF-8 SVG——SVG 内含双引号会提前截断 `src` 属性值，浏览器会把 SVG 内 `<rect>` 等解析为散落 DOM 元素，并在二维码与横向 logo 之间渲染出 `alt="EQT Website QR Code" />` 裸文本；此损坏 DOM 会干扰分享卡片布局与关闭按钮命中区域（表现为"首次打开显示字符、二次打开关闭无响应"）。排查时用 `document.querySelector('.share-qr-wrapper').querySelectorAll('rect').length` 应恒为 0。
  - **失败降级约定**：
    - 图片一律经 `loadImageElement(src)` 加载，失败返回 `null` 而非让 `ctx.drawImage(broken)` 抛 `InvalidStateError`（离线时第三方 QR API 加载失败必然 broken，直接 drawImage 会让整个合成/下载失败）。
    - 本地 `GenerateQRCodePNG` 不可用（返回非 string）且离线时，`getMergedQRCodeDataURL` **不 fallback 外部 API**（必然失败），返回 `null`。
    - `prepareMergedQRCode` 收到 `null` 置 `qrPrepareFailed=true` 并渲染失败提示（`qr_generate_failed_tip`，已在 7 语种 i18n），`renderSharePanel` 据 `!qrPrepareFailed` 防止重复触发。
    - `online` 事件重置 `qrPrepareFailed=false` 并 `render()`，面板自动重新生成二维码。
- **单权威模块与散落图标稳定性**：
  - `desktop/gui/frontend/src/components/share.js` 为推广海报与分享弹窗的单一权威实现，严禁在 `main.js` 中复制或残留旧 Share 实现。
  - 散落图标采用模块级变量 `cachedScatteredHtml` 缓存首次随机排布结果，杜绝在 `prepareMergedQRCode` 完成或状态重绘时因反复 `Math.random` 产生图标瞬移跳变。

---

## 8. 离线状态 UI 门控 (Offline UI Gating)

- **联网判定约定**: 统一使用 `navigator.onLine`（主 GUI `main.js` 的 `isOnline()` 与 chat v2 `App.svelte` 的 `isOnlineNow`）。离线时免费额度倒计时/消耗 pill 隐藏。
- **主 GUI (Wails)**:
  - `isOnline()` 辅助函数 + `window.addEventListener('online'/'offline', () => render())` 全量重绘。
  - 离线时隐藏: 顶栏兑换按钮 `#open-redeem`、设置面板 `#open-redeem-inline`、授权面板刷新 `#refresh-license-btn`、购买/管理 `#buy-license-btn`/`#manage-license-portal-btn`、套餐对比 `#plan-go-redeem`、反馈菜单项。
  - 保留: 套餐对比入口 `#toggle-plan-info`（静态内容，无需联网）。
- **Chat v2 (Svelte)**:
  - 离线时额度倒计时隐藏，标题栏 badge 内容直接改为展示当前生效的 **Tier 级别**（`FREE` / `PLUS` / `PRO`），点击后打开套餐详情面板，呈现**当前套餐在 Chat 模式下的具体限制与权益内容**；在断网/离线状态下，每日免费额度、剩余时间与下方描述区域（`freeQuotaHint`）及外链全部隐藏，仅保留基础状态徽章。

---

## 9. 官网与客户门户静态资源缓存与共享脚本加载规范 (Website & Portal Script Versioning & Ordering)

- **共享脚本修改同步 bump `?v=` 版本号 (Cache Busting Guarantee)**：
  - 当修改 `cloudflare/eqt-website/js/` 下的共享公共脚本（如 `email-otp.js`, `checkout-verify.js`, `api-base.js`）时，**必须**同步更新所有引入该脚本的 HTML 页面（如 `pricing.html`, `portal.html`）中的 `?v=X.Y.Z` 版本号。
  - **合理性**：Cloudflare Pages 与主流浏览器对静态 JS 采用强缓存策略；若漏改 `?v=`，存量用户与 CDN 命中旧版本缓存，会导致前端 Bug 修复或安全调整对线上用户完全不生效。
- **严格按照依赖拓扑顺序加载脚本 (Strict Script Load Ordering)**：
  - 静态页面引入脚本必须遵循自底向上的依赖顺序：
    1. `js/api-base.js`（统一环境与 Host 解析）
    2. `js/email-otp.js`（通用 OTP 发码、验码、冷却倒计时控制器）
    3. `js/checkout-verify.js`（依赖 `window.EmailOtp` 的支付前邮箱验证组件）
    4. 页面主体 `<script>`
- **显式模块可用性检查与本地化降级提示 (Explicit Module Availability Check)**：
  - 任何依赖外部共享模块的组件或页面逻辑，严禁使用虚假的 `: Object` 表达式隐式伪装降级。
  - 必须显式检测 `window.EmailOtp && window.EmailOtp.Controller`；若未加载（网络拦截或加载异常），记录明确 console 告警，并在用户触发交互时通过多语言字典（`module_load_err`）向用户展示友好的重试提示，杜绝抛出裸 `TypeError`。

---

## 10. 桌面端应用内日志查看与排查诊断弹窗规范 (In-App Log Viewer & Diagnostics Modal)

- **独立组件化与状态渲染分离 (Component & State Isolation)**：
  - 日志查看器业务逻辑必须剥离至独立模块（如 `desktop/gui/frontend/src/components/log_viewer.js`），严禁向 `main.js` 堆砌状态与模板。
  - 纯渲染函数（`renderLogViewerOverlay()`）仅做 `Data -> HTML` 单向映射；状态修改统一由控制器方法调度（`openLogViewer`, `closeLogViewer`, `setLogFilter`, `setLogSearch`, `toggleAutoRefresh`）。
- **`morphdom` 增量 Diff 焦点与值保护**：
  - 全量重绘触发时，必须在 `onBeforeElUpdated` 中对日志搜索框（`#log-viewer-search`）进行聚焦与内容保护（`toEl.value = fromEl.value; return true;`），防止用户在连续输入检索时因后台轮询刷新丢失焦点与已输入内容。
- **标准事件代理与零内联 `onclick`**：
  - 弹窗内的筛选 Chip、刷新、一键复制、导出诊断包及关闭按钮，统一在 `main.js` 的 `addEventListener('click')`、`'input'`、`'change'` 及 `'keydown'`（Escape 快捷键关闭）中代理分发，严禁拼装 HTML 内联 `onclick`。
- **轻量反馈与剪贴板多重兜底 (Zero Alerts & Clipboard Fallback)**：
  - 日志复制与排查包导出反馈统一通过应用内通知（`showToast`）呈现，杜绝调用阻塞式的浏览器级 `alert()` 弹窗。
  - 复制日志内容时优先走现代 `navigator.clipboard.writeText`，若遭遇权限拒绝或 API 缺失则降级到隐藏 `textarea` + `document.execCommand('copy')` 方案，并在任何异常时弹出 Toast 提示，杜绝任何静默失败。
- **终端滚动保持与智能吸附 (Smart Stick-to-Bottom)**：
  - 终端容器（`#log-viewer-terminal`）须注册到主渲染器的滚动选择器列表（`scrollableSelectors`）。
  - 拉取最新日志后实施智能吸附：刷新前判定当前视口是否处于底部附近（距底 ≤40px）；仅在显式强制（初次打开或手动点击刷新）或原先就在底部附近时执行滚底（`scrollTop = scrollHeight`）。若用户正在向上翻阅排查历史日志，则保持阅读位置，杜绝 3s 自动轮询强行打断阅读。

---

## 11. 文件流式传输与 GUI 进度条零延迟更新规范 (Streaming Progress & GUI Feedback)

- **底层 HTTP 流式分块与 `io.ReaderFrom` 陷阱防范**：
  - `http.ServeFile` 或类似流式服务中，封装的 `progressResponseWriter` 切忌将 `ReadFrom(r io.Reader)` 直接委托给底层的 `rf.ReadFrom(r)`。Go 标准库底层驱动会一次性阻塞读取整段文件直至 EOF，导致传输期间包装层的 `onWrite` 进度监听完全失活（仅在 100% 结束时回调一次）。
  - **规则**：必须在 `ReadFrom` 中采用定长分块（如 256KB）循环读取并通过 `w.Write()` 递增推送，确保每写入一个 chunk 立即触发 `onWrite`，实时更新瞬时速率与已完成字节。
- **GUI 初始传输状态防御性展示 (Zero-percent Bar vs Dashed Line)**：
  - 前端渲染设备传输列表（`renderDeviceProgressHtml`）时，只要设备处于 `transferring` 状态且具备有效的 `bytesTotal > 0`，必须立即渲染 0% 起步的平滑进度条。
  - **避坑规范**：严禁加入 `(client.bytesDone || 0) > 0` 这一严苛前置条件，否则在传输初态或微小数据段传输时，进度条会被误判并呈现为虚线占位（直到下载完成才突然跳 100%）。
- **快照与克隆链路中传输速率字段完整性 (Speed Metadata Preservation)**：
  - 在 Server（`cloneTransferStatus`, `snapshotTransferStatus`）及桌面端 Agent（`cloneTaskRecord`, `observeTransferStatus`）的结构体克隆链路中，必须显式拷贝 `Speed` 与 `SpeedFormatted`。
  - 在传输中断、失败或完成（`completed`/`failed`/`waiting`）的生命周期切换点，必须显式重置速率（`Speed = 0`, `SpeedFormatted = ""`），避免传输完成后速率徽章残留。

---

## 12. 移动端息屏恢复状态同步与安全文件落盘规范 (Screen Wake-up Sync & Robust Mobile Download)

- **移动端息屏冻结与前台唤醒主动同步**：
  - 移动浏览器（iOS Safari、Android Chrome、Edge）在手机息屏或退至后台时，会强制挂起或降频 JS 定时器（`setInterval`/`setTimeout`）。
  - **规则**：严禁仅依赖 `setInterval` 被动等待状态轮询。页面必须注册 `visibilitychange`、`pageshow` 与 `focus` 事件；在 `document.visibilityState === 'visible'` 唤醒恢复的第 0 毫秒，立即主动触发一次 `pollStatus(true)` 状态同步。
  - **完成态渲染闭环**：`showCompletedUI` 必须同步更新 `download-progress-bytes` 为 `total / total` 并将状态文字更新为完成态，杜绝仅拉满进度条宽度而下方字节数与状态仍然残留息屏前数值的瑕疵。
- **杜绝隐藏 Iframe 3 秒销毁陷阱**：
  - 严禁通过动态生成隐藏 `<iframe>` 并在 `setTimeout(..., 3000)` 销毁它的方式触发文件下载。在 Chromium/Edge 移动端上，宿主 frame 销毁会直接向网络栈发送 Abort 信号，中途掐断下载请求，导致文件无法落盘保存。
  - 必须使用顶级 DOM 模拟带 `download` 属性的 `<a>` 标签点击手势（或直接顶级导航），结合服务端 `Content-Disposition: attachment` 与 `X-Content-Type-Options: nosniff`，确保移动端浏览器系统级下载管理器接管并完整保存文件。
- **RFC 6266 / RFC 5987 纯 ASCII 回退与 UTF-8 编码**：
  - HTTP `Content-Disposition` 标头中，`filename="..."` 必须进行纯 ASCII 防护（过滤非 ASCII 字符），完整的 Unicode 文件名由 `filename*=UTF-8''<percent-encoded>` 提供，防止 Edge 移动版等严苛客户端由于 HTTP 标头非 ASCII 字节而丢弃响应或损坏文件名。





