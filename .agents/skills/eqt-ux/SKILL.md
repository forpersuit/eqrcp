---
name: eqt-ux
description: "Architectural guidelines, layout constraints, notification styles, mobile responsive viewports, and E2E verification for EQT user interfaces. Use when you need to: (1) Modify browser templates (`chat.tmpl.html`, `download.tmpl.html`), desktop GUI frontend (`main.js`), or Chat v2 Svelte components, (2) Debug mobile responsive layouts, iOS Safari virtual keyboard docking, or touch scrolling blockers, (3) Surface in-app notifications, progress bars, or error states without alert dialogs, (4) Manage attachment transfer states, batch zip downloads, or WebSocket lifecycle, or (5) Run Chrome DevTools MCP E2E simulation tests."
---

# EQT 界面交互、视口适配与前端工程主控指南 (EQT UX Master Guide)

本指南为 EQT 客户端界面（桌面端 Wails GUI、移动端 Safari/Chrome H5、Chat v2 Svelte、Web 管理后台）的交互规范、视口适配、状态流转与 E2E 验证的总领主控导航。

---

## 1. 核心交互第一性原理 (Core UX Principles & Philosophy)

- **零系统弹窗原则 (Zero Alerts)**: 严禁调用浏览器阻塞式 `alert()` 或确认弹窗。所有警示、超限、进度与错误提示统一通过应用内通知（Toast）、气泡状态或行内副标题呈现。
- **状态与渲染单向流 (State-Template Separation)**: 渲染模板函数仅充当 `Data -> DOM` 纯映射，禁止在模板中直接突变全局 `state`；严禁在 HTML 字符串中拼装内联 `onclick="..."`。
- **平台体验隔离 (Platform Isolation)**: 移动端视口逻辑（手势失焦、`touchmove` 拦截、顶栏折叠）严格通过 `isMobileLayout && !isEmbedded` 门控，严禁干扰桌面端（>820px）与 Wails 内嵌 GUI 原有交互。
- **气泡实体强驻留性 (Bubble Retention Guarantee)**: 文件与图片气泡一旦投递，具有强驻留性；接收端本地单向的下载任务取消/失败（`dlTx`），绝不影响文件气泡本体展示。

---

## 2. 核心架构不变式与布局规范摘要 (Active UX Invariants & Layout Summary)

### 2.1 移动端顶层画布锁定与三段式 Flex 结构
- **机制**: `@media (max-width: 820px)` 下，`html, body, #app` 声明 `position: fixed; inset: 0; width: 100%; height: 100%; overflow: hidden; overscroll-behavior: none;`，彻底从源头剥夺 WebKit 原生 `scrollIntoView` 抢跑的滚动作案空间。
- **三段式布局**: 顶栏 `.chat-head`（`flex: 0 0 auto`，固定置顶）、底部输入栏 `.composer`（`flex: 0 0 auto`，随视口抬升）、中间消息流 `.message-list-container`（`flex: 1 1 auto; min-height: 0;`，自适应吸收全部视口高度缩减）。常规视口下通过布局容器零位锁定（`pinLayoutScroll`）确保顶栏固定不动，仅收缩消息流。键盘唤起时通过 Svelte `bind:this={chatViewportEl}` 直接赋予最高特异性 inline style（`height = visualViewport.height`, `transform = translateY(offsetTop)`），杜绝外部 CSS 变量层叠失效；捕获阶段对 `.messages` 及各浮动面板（`.modal-body`、`.device-panel` 等）执行白名单放行，保障合法局部滚动。
- **规格来源**: `pkg/chat/v2/web/src/app.css` 与 `src/App.svelte`。

### 2.2 软键盘遮挡几何度量与日志探针
- **判定标准**: $Y_{\text{keyboard}} = \text{visualViewport.height} + \text{visualViewport.offsetTop}$，$Y_{\text{composer}} = \text{composerEl.bottom}$。$\text{overlap} = Y_{\text{composer}} - Y_{\text{keyboard}}$。若 $\text{overlap} \le 1\text{px}$ 判定为 `OK`，反之判定为 `BLOCKED`。
- **日志门控**: `[VIEWPORT-PROBE]` 像素日志由桌面端 `Enable Viewport Debug Box` 严格门控（生产环境 0 吞吐）；`vv-sync` 采用 120ms 防抖收敛，消除键盘动画过渡期的逐帧日志风暴。
- **规格来源**: `pkg/chat/v2/web/src/components/ViewportDebugOverlay.svelte` 与 `src/App.svelte`。

### 2.3 WebKit 16px 字号硬约束与视口自愈复位
- **机制**: `input, textarea, select` 必须声明 `font-size: 16px !important;`，阻断 iOS 聚焦时自动放大 1.25x。移动端发送消息后显式调用 `blur()` 并调度多阶（0ms/120ms/320ms）`window.scrollTo(0, 0)` 自愈复位。
- **规格来源**: `pkg/chat/v2/web/src/app.css` 与 `src/App.svelte`。

### 2.4 状态指示矢量化与具名导入静态防线
- **机制**: 状态指示（TLS 加密、连接、开关）严禁使用系统彩色 Emoji（🔒、⚠️），统一采用内联矢量 SVG；通过 `scripts/audit-frontend-imports.mjs` 在部署主链上静态校验全部具名导入，阻断未导出符号逃逸。
- **规格来源**: `desktop/gui/frontend/src/main.js` 与 `scripts/audit-frontend-imports.mjs`。

---

## 3. 质量门禁与自动化验证 SOP (Verification & Quality Gate SOP)

在修改任何前端界面、CSS 样式、模板或传输状态逻辑后，必须执行以下验收流程：

### 3.1 前端单元测试与打包检查
```bash
npm --prefix pkg/chat/v2/web test && npm --prefix pkg/chat/v2/web run build
```
- **通过标准**: 全部测试套件 100% 通过（断言数与套件数以实测为准，不硬编码复述），Svelte check 0 错误，Vite 构建产物顺利生成。

### 3.2 桌面端构建与 Windows 产物物理验证
```bash
scripts/deploy-windows-results.sh
```
- **通过标准**: 产出生产版 `EQT.exe` 与测试版 `eqt-test.exe`，并成功打包至 `/mnt/e/developer/results/eqt-desktop-windows-amd64.zip`。

---

## 4. 核心排坑与工程红线摘要 (Key Engineering Traps)

- **移动端文件输入框沙箱**: 严禁使用 `display: none` 隐藏 `<input type="file">`（iOS Safari 会拦截其 `.click()`）；必须使用微尺寸透明隐藏（`0.1px`）并由原生 `<label for="...">` 驱动。
- **息屏唤醒防假完成**: iOS Safari 弹窗或息屏唤醒时对并发请求返回 `status: 0`；严禁在网络错误分支中触发完成渲染，唯有服务端确凿返回 `state === 'completed'` 方可判定完成。
- **海报占位图 Base64 编码**: 占位二维码必须采用 `data:image/svg+xml;base64,...` 编码；严禁在 `src` 中内联含双引号的 UTF-8 SVG，避免属性截断破坏关闭按钮点击区域。
- **流式服务分块推送**: 包装 `http.ResponseWriter` 进度监听时切忌直接委托 `io.ReaderFrom`，必须采用定长分块（256KB）循环写入，确保每写入一个 chunk 实时更新瞬时速率。
- **全局滚动捕获与节点类型防护**: 在 `document.addEventListener('scroll', handler, { capture: true })` 捕获滚动事件时，顶层 `e.target` 为 `HTMLDocument`（非 `Element`），无 `classList` 与 `closest` 属性；必须首先判断 `e.target instanceof Element` 或进行可选链保护，杜绝抛出 `TypeError` 阻断事件循环。
- **动态纵向滚动放行**: `touchmove` 拦截必须结合 `isScrollableElement` 动态检测；若祖先容器计算样式 `overflowY` 为 `'auto'/'scroll'` 且存在溢出，直接放行，杜绝弹窗无法滑动。

---

## 5. 深度技术与参考导航 (References Navigation)

- **移动端视口、键盘贴合、动态滚动与几何度量**: 参阅 [mobile-layout-keyboard.md](references/mobile-layout-keyboard.md)
  * *何时加载: 修改移动端媒体查询、软键盘弹出抬升、touchmove 拦截与动态滚动放行、视口几何探针时。*
- **桌面端 GUI 界面、DOM Diff、状态同步与独立组件**: 参阅 [desktop-gui-interaction.md](references/desktop-gui-interaction.md)
  * *何时加载: 修改 Wails 桌面端、`morphdom` 增量 Diff、日志查看器、任务托盘、离线门控时。*
- **附件传输、流式进度反馈与气泡生命周期**: 参阅 [attachment-transfer-ux.md](references/attachment-transfer-ux.md)
  * *何时加载: 修改文件上传/下载进度展示、气泡生命周期、批量下载、WebSocket 切后台保活时。*
- **Chrome DevTools MCP E2E 仿真测试实战指南**: 参阅 [e2e-simulation-guide.md](references/e2e-simulation-guide.md)
  * *何时加载: 执行基于 9222 端口的 E2E 多端仿真对齐测试、Receive 模式与遥测校验时。*
