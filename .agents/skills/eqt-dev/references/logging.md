# EQT 日志系统技术参考 (EQT Logging Technical Reference)

本指南详述 EQT 桌面端与各平台下的日志落盘机制、路径规范及动态追溯技巧。

---

## 1. 统一落盘与位置机制 (SSOT)

为了避免无谓的磁盘占用，同时保证崩溃后可追溯：
- **日志文件基准路径 (SSOT)**：所有平台日志均统一存放在用户家目录的 `.local/eqt/` 路径下，彻底消除由于进程跨界带来的重定向混乱。
- **文件命名与路径**：
  - **Windows**：主桌面端日志落盘在 `%USERPROFILE%\.local\eqt\desktop.log`，各会话的代理运行日志落盘在 `%USERPROFILE%\.local\eqt\agent-*.log`。
  - **Linux / macOS**：主运行日志落盘在 `~/.local/eqt/desktop.log`，各会话代理运行日志落盘在 `~/.local/eqt/agent-*.log`。
- **动态清理与快速检索**：主进程日志追加记录在 `desktop.log` 中。开发调试时，在终端运行 `tail -f ~/.local/eqt/desktop.log`（WSL/Linux）或在 Windows 下监控对应文件，可查看 Wails/Go 与 WebView 内的 runtime 异常交互。

---

## 2. 日志记录特征

在 `DevMode` 或 `DebugLog` 激活时，日志具备以下追溯特点：
1. **状态机转换日志**：记录内存 Agent 在任务推送、停止和状态改变时的内部生命周期（如任务入队、运行、终结及错误诊断等）。
2. **更新与验签全链路**：
   - 记录检查更新时，版本号的语义化比对结果（如 `currentVersion -> targetVersion` 是否满足 `IsNewerVersion`）。
   - 记录下载更新包与签名时，从云端获取的资产包哈希长度、文件大小。
   - 记录 Ed25519 签名验证明细（如 128 字符 Hex 签名是否解码成功、验签结果等）。
3. **静默进程拉起与清理**：记录 Windows 重命名原子更新（`.exe -> .exe.old`）的路径重命名步骤、启动新进程及清理 `.old` 的状态。

---

## 3. Chat V2 跨端统一日志系统 (Chat V2 Unified Logging)

当 **DebugLog** 或 **DevMode** 开关启用时，Chat V2 日志系统自动落盘并建立统一的三端（GUI/CLI、服务端、移动浏览器端）融合日志链路：

- **落盘位置**：
  - **GUI 模式**：所有组件（GUI 后台、服务端 HTTP/WS 诊断、移动浏览器回传日志）一并追加写入统一的 `desktop.log` 中。会话关闭后日志仍保留，可通过 About 页的“打开日志文件”按钮分析。
  - **CLI 模式**：输出到 `~/.local/eqt/cli.log`。
  - **自定义保存路径**：在 Dev 模式的设置面板中配置“自定义日志保存路径 (LogDir)”，新启动的会话以及 `desktop.log`/`cli.log` 会自动使用新路径。
- **会话级物理隔离 (Session Isolation)**：
  - 移动浏览器回传的设备日志，服务端在 `LogDir` 目录下按会话 Token 归类：`logDir/session-<token>/device-<peer>.log`。
  - 每个会话启动时使用独一无二的随机 token，实现物理上目录级别的隔离。
- **移动端 (MOBILE) 离线日志缓冲机制**：
  - 移动浏览器 H5 页面（`App.svelte` / `websocket.ts`）维护日志队列 `pendingLogs`。
  - 断网或未就绪时日志存入队列，连接建立后（`onopen`）批量 Flush 回传给服务端。
- **服务端日志融合路由**：
  - 服务端 WebSocket 收到 `CommandLog` 后，写入单独设备日志的同时，调用 `diag.Emit()` 以 `[MOBILE:<peer>]` 前缀向主 `diag.Logger` 路由，统一追加至 `desktop.log` 或 `cli.log`。
- **动态开关控制**：
  - 关闭“启用调试日志”开关时，`FileLogger` 的 `Write` 方法自动拦截磁盘写入（降级为 nop），直到重新开启。
