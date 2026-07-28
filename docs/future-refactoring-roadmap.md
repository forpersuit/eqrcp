# EQT 未来优化与重构路线图 (Future Refactoring & Architecture Roadmap)

> **文档状态**：草案 / 规划路线图  
> **创建日期**：2026-07-29  
> **适用范围**：EQT Desktop (Wails GUI)、Chat V2 引擎及系统前端架构  

---

## 1. 概述与背景

随着 EQT 功能的持续扩展（包含 P2P 传输、Chat V2 会话、自动升级、DRM 许可认证等），原有的前端架构在维护性与渲染性能上遇到了技术瓶颈。

目前桌面 GUI 端（`desktop/gui/frontend/src/main.js`）采用了传统的 **Vanilla JS + 动态 HTML 模板字符串 + `morphdom` 全局 Diff** 的渲染架构。随着业务增加，单文件代码已膨胀至 6500+ 行，且全局 `render()` 重写易引发无差别的 DOM 树重新比对，在复杂交互（如内嵌 `<iframe id="chat-iframe">`）时产生了意料之外的重载与连接打断问题。

本文档记录了未来系统架构优化与重构的核心方向，指导桌面端及全栈系统的长期工程化升级。

---

## 2. 重点重构方向

### 方向一：桌面端 GUI 宿主壳现代化重构 (`main.js` -> Svelte 框架)

#### 2.1 现状与痛点
- **单体文件膨胀**：`main.js` 承担了顶部导航、模式切换、工作区渲染、设置/关于 Modal、历史记录面板、拖拽上传等所有桌面外壳逻辑，违背了模块化与单一职责原则。
- **全局 Diff 开销**：每当倒计时定时器（如 `chatUsageTimer`）、状态轮询（`pollAgentStatus`）或通知提醒改变时，都会调用 `render()` 生成全页 HTML 字符串并交由 `morphdom` 比较。
- **Dom 状态丢失隐患**：依赖 `morphdom` 比较 DOM 节点可能导致内嵌 iframe、输入框焦点或滚动位置发生非可控重置（此前已通过在 `morphdom` 引入 `onBeforeElUpdated` 拦截钩子进行了规避，但非长久之计）。

#### 2.2 重构方案与设计目标
将 `desktop/gui/frontend` 整体从 Vanilla JS + `morphdom` 迁移升级为基于 **Svelte 5 响应式框架** 构建的现代化前端应用：

1. **组件化拆分 (Componentization)**：
   - `App.svelte`：桌面客户端根容器，管理全局主题与视口布局。
   - `TopBar.svelte`：顶部导航栏、传输模式切换按钮（Share / Receive / Chat）、许可等级 Badge 及顶部菜单。
   - `Workspace.svelte`：主工作区容器，对 Chat 模式下的 `<iframe id="chat-iframe">` 实施真正的静态常驻挂载。
   - `SettingsModal.svelte` / `AboutModal.svelte`：独立的弹窗组件，按需挂载。
   - `SidePanel.svelte`：侧边栏历史记录、设备列表与任务进度。
2. **响应式状态管理 (State Management)**：
   - 使用 Svelte Store / Runes 替代全局单体 `state` 对象。
   - 实现粒度精准的数据绑定：如定时器变化时仅刷新 `TimerBadge.svelte` 组件，彻底消除全局 DOM 比对。
3. **架构统一**：
   - 使桌面 GUI 宿主壳与内嵌的 Chat V2 界面（`pkg/chat/v2/web`）统一采用 Svelte 技术栈，降低团队技术栈复杂度与开发维护成本。

---

### 方向二：过渡期 `main.js` 局部 DOM 替换优化

在全面实施 Svelte 框架重构之前的过渡阶段，对现有的 `main.js` 实施渐进式渲染性能优化：

1. **高频更新剥离**：
   - 将 `chatUsageTimer`（使用时长倒计时）、`chatQRPulseTimer`（二维码脉冲）等秒级定时器的触发逻辑改写为**原生 DOM 局部替换**（如 `document.querySelector('.chat-usage-timer').textContent = ...`），禁用其内部对全局 `render()` 的调用。
2. **通知栏与状态轮询优化**：
   - 状态轮询（`pollAgentStatus`）仅在后端状态字段（如传输进度、许可变化）发生实质改变时才触发必要的 DOM 节点更新，避免无意义的频繁 Diff。

---

### 方向三：Chat 模式控制面与数据面的深度解耦与 I/O 隔离

#### 3.1 后台 I/O 与 WebSocket 控制面隔离
- **痛点**：在进行大文件/大图传输时，本地磁盘拷贝（如 `quickCopyFile`）或大文件解密写盘若短暂抢占主线程或事件循环，可能导致 WebSocket 心跳包未能按时响应，触发假超时断连。
- **重构目标**：
  - 将所有文件解密、本地 IO 复制及 HTTP 二进制流传输完全下沉至独立的后台协程（Goroutine）及 Web Worker 中。
  - 保证 WebSocket 控制面（`/chat-v2/{token}/ws`）具有最高通信优先级，心跳与 ACK 响应不受任何大文件传输阻塞。

#### 3.2 移动端切后台 Presence 静默化
- 优化移动端/浏览器切后台（触发 `page_hidden`）导致的频繁断连与重连展示，支持在系统消息层进行频繁重连提示的智能防抖与合并展示，提升聊天会话流的视觉连贯性。

---

## 3. 演进路线图与阶段规划

```
  ┌──────────────────────────────────────────────────────────────────┐
  │ 阶段一：局部防御与性能止血 (已完成)                               │
  │ • 给 morphdom 增加 onBeforeElUpdated 钩子，保护 iframe 不被重写   │
  │ • 高频倒计时初步实施局部 DOM 刷新                                  │
  └─────────────────────────────────┬────────────────────────────────┘
                                    │
                                    ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │ 阶段二：桌面 GUI 前端 Svelte 组件化重构                           │
  │ • 重构 desktop/gui/frontend 架构，替换 Vanilla JS + morphdom     │
  │ • 拆分 TopBar、SettingsModal、Workspace、SidePanel 等组件        │
  │ • 建立基于 Svelte Store 的桌面端响应式数据流                       │
  └─────────────────────────────────┬────────────────────────────────┘
                                    │
                                    ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │ 阶段三：全栈通信与 I/O 彻底隔离                                    │
  │ • 优化 Chat V2 后台 Task 与 WebSocket 控制面优先级                 │
  │ • 完善大文件流传输与离线/重连 Presence 智能合并                   │
  └──────────────────────────────────────────────────────────────────┘
```

---

## 4. 交付与验收标准

当执行上述重构时，必须遵守以下质量标准：
1. **零功能退化 (Zero Regression)**：不得破坏或削弱原有任何已有的安全校验、DRM 授权、传输逻辑或基础 UI 布局。
2. **前后端架构规范**：严格遵循项目中关于“前端模块化分离”、“渲染与数据状态分离”及“Go 非阻塞异步网络调用”的开发规范。
3. **测试覆盖**：重构完成后，须通过 `go test ./...` 全量单元测试，并参照 `eqt-ux` 规范执行 Chrome MCP E2E 响应式 UI 模拟验证。
