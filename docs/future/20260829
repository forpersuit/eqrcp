# 通知 / 错误 / 日志 基础设施重构方向

> 状态：待重构（本次明确不做）
> 记录日期：2026-08-29
> 背景：开发者提出 HCI「极简降噪」治理（成功横幅冗余、异常分层、默认落盘日志），逐条核实后确认方向正确，但多数改动牵动前后端基础设施，暂缓实施，沉淀方向待后续重构落地。

---

## 1. 目标

- 确定性主动操作（用户主动停止、清空等）静默跳转，不弹成功横幅；视觉状态跳变本身就是反馈。
- 底层技术错误（socket reset / timeout / decode error 等）不渲染到 UI 顶部红条，只落本地日志；需要用户决策的业务错误才做轻量内联提示。
- 技术性日志默认落盘到标准应用数据目录，提供「打开日志目录」快捷入口，日常 UI 纯净，偶发故障可查。

## 2. 现状与问题（已核实，file:line 证据）

### 2.1 成功横幅：`state.notice`
- 字段定义 `desktop/gui/frontend/src/state.js:14`；渲染为绿色 `<div class="notice success">`，`main.js:616` / `main.js:5727`（CSS `.notice.success`，`src/app.css:1357-1367`）。
- 确定性操作后仍挂横幅：`stopCurrent`→`task_stopped`（main.js:4900）、`stopChat`→`chat_stopped`（main.js:4908）、`clearHistory`→`history_cleared`（main.js:4925）。
- 注意：并非全部横幅冗余。`repeatTask`（main.js:4934，回报新任务 ID）、`restoreSharePaths`（main.js:4971，回报恢复数量）传达视觉无法自证的信息，应保留。判据 = 结果是否被界面状态自明编码。

### 2.2 错误红条：`state.error`（核心基础设施缺陷）
- 字段定义 `state.js:13`；渲染为红色 `<div class="notice error">`，`main.js:617` / `main.js:5730`（CSS `.notice.error`，app.css:1368）。
- `run()` 兜底把所有异常扁平化为字符串：`state.error = error?.message || String(error)`（main.js:5429-5451，@5443）；另有 `'Failed to start chat session: ' + err`（main.js:4596）。
- `formatErrorMessage`（main.js:2905-2933）只翻译 `ERR_FREE_LIMIT_SIZE` / `ERR_FREE_LIMIT_FILES` 两种业务码，其余错误原文透传 → 技术字符串（`context deadline exceeded` 等）会直接上红条。
- **根因**：Wails 前后端边界只有扁平错误字符串，没有结构化错误分类（error code / category），前端无法区分「基础设施错误」与「业务决策错误」。
- 隐藏隐患：Go 侧 `StopChat` 无活动对话时返回 `"no active chat to stop"`（desktop/gui/app.go:836-854 → agent.go:670-679），经 `run()` 变红条——「无操作可做」不该按错误显示。

### 2.3 日志：基础设施未配合
- `desktop/gui/main.go:137-148` `desktopLogFilePath()`：默认 `os.UserCacheDir()/eqt/desktop.log`（Linux≈`~/.cache/eqt/`，Windows≈`%LOCALAPPDATA%\eqt\`），可被 `settings.LogDir` 覆盖（`SetLogDir` main.go:51-81）。**与标准约定 `%APPDATA%\eqt\logs\` / `~/.config/eqt/logs/` 不一致，且不可混用**。
- desktop agent 后台日志：`os.UserCacheDir()/eqt/agent-*.log`（cmd/desktop_agent.go:2236-2250）。
- Chat 运行时日志**默认关闭**（opt-in）：`settings.DebugLog`（pkg/config/settings.go:30）门控 `pkg/chat/v2/transport/websocket.go:333/413` 与 `pkg/chat/v2/http/routes.go:127-131`；`pkg/logger/logger.go` 只写 stdout/可选 writer，不落盘。
- 「打开日志目录」入口已存在于「设置→开发者」区（`#dev-open-dir`，main.js:2306 / handler 3720-3731，另有单文件按钮 `btn-open-single-log` main.js:2320 / 3710-3719），但 **About 面板（renderAboutPanel，main.js:2603-2654）没有入口**。

### 2.4 已有可复用件
- 崩溃上报链路已在：`desktop/crash/sender.go`（含 `ReadLogTail` 读取日志尾部上报）。

## 3. 重构方向

### 方向 A：移除冗余成功横幅（低风险，可先行）
- 删除 `stopCurrent` / `stopChat` / `clearHistory` 三处的 `state.notice` 赋值，回到 Start 界面保持纯净。
- **保留** `repeatTask`、`restoreSharePaths`、`settings_saved` 等传达非自证信息的提示。
- 不新建横幅渲染机制，仅收敛赋值点 + 顶层横幅渲染（main.js:616/617、5726-5731）。

### 方向 B：错误分层治理（中高风险，核心重构）
- Go 侧建立**结构化错误协议**：给 Wails 绑定返回的 error 附加稳定 code / category（建议独立 error 包，枚举分类如 `infra` / `business` / `noop`），Wails 绑定层序列化为 `{ code, category, message, log }`。
- 前端按分类路由：`infra` → 只落日志 + 可选 telemetry，不渲染红条；`business` → 具体输入框/控件下方内联轻提示（Inline Text）；`noop`（如 `no active chat to stop`）→ 静默忽略。
- 迁移顺序：新增分类协议与少量绑定改造 → 替换现有 `run()` 扁平兜底 → 逐动作切换分类。期间保留 `formatErrorMessage` 作为业务文案兜底。
- 注意「端口被占用」归类：属环境错误而非用户决策错误（用户改不了输入，需关进程），但展示形式仍应是局部提示而非全局红条。

### 方向 C：默认落盘日志 + About 快捷入口（中风险）
- 默认开启**技术性** INFO/ERROR 落盘（连接、错误、状态流转），Chat **明文与网络报文保持 opt-in**（现有 debugLog 语义保留，涉及隐私，见 §4）。
- 日志目录收敛到标准应用数据目录（`%APPDATA%\eqt\logs\` / `~/.config/eqt/logs/`），与现有 UserCacheDir 路径二选一，**迁移后废弃旧路径**，避免排障找错目录。
- About 面板增加「打开日志目录」按钮（复用现有 `#dev-open-dir` 的打开机制，抽成通用入口）。

## 4. 硬约束 / 隐私边界

- Telemetry / 崩溃上报**不得静默**：崩溃上报已有且应保留；新增遥测须 opt-in 并披露（项目已有隐私警告先例：i18n `privacy_warning_desc`）。
- Chat 明文内容默认不落盘（仅技术日志默认开启），避免隐私回退。
- 与既有规则一致：不用 alert 弹窗；一切面向用户的通知走应用内渠道。

## 5. 建议执行顺序

1. 方向 A（纯前端，零风险）→ 可随时独立完成。
2. 方向 C 的 About 入口 + 默认技术日志落盘（不牵动错误协议）。
3. 方向 B（错误分类协议）→ 单独评估，是真正的基础设施重构，需要前后端协同改造与回归。

## 6. 本次明确不做（非目标）

- 本次不改动任何通知/错误/日志运行时代码，UI 行为保持现状。
- 不迁移日志目录，不新增 About 入口，不建立错误分类协议。
