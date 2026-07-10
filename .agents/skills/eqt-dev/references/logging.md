# EQT 日志系统技术参考 (EQT Logging Technical Reference)

本指南详述 EQT 桌面端与各平台下的日志落盘机制、路径规范及动态追溯技巧。

---

## 1. 临时落盘与位置机制
为了避免无谓的磁盘占用，同时保证崩溃后可追溯：
- **日志文件机制**：桌面端日志（`desktop.log`）路径由 `desktopLogFilePath()` 指明，标准日志和调试信息直接落盘在用户缓存目录下，消除由于进程跨界带来的重定向混乱。
- **文件命名与路径**：
  - **Windows**：主桌面端日志落盘在 `%LOCALAPPDATA%/eqt/desktop.log` 中，各会话的代理运行日志落盘在 `%LOCALAPPDATA%/eqt/agent-*.log` 下。
  - **Linux / WSL**：主运行日志落盘在 `~/.cache/eqt/desktop.log` 中，各会话代理运行日志落盘在 `~/.cache/eqt/agent-*.log` 下。
- **动态清理与快速检索**：主进程日志会追加记录在 `desktop.log` 中。开发调试时，在终端运行 `tail -f ~/.cache/eqt/desktop.log`（WSL/Linux）或在 Windows 下监控对应文件，可获得第一手 Wails/Go 与 WebView 内的 runtime 异常交互。

## 2. 日志记录特征
在 `DevMode` 或 `DebugLog` 激活时，日志具备以下追溯特点：
1. **状态机转换日志**：记录内存 Agent 在任务推送、停止和状态改变时的内部生命周期（例如任务入队、运行、终结及错误诊断等）。
2. **更新与验签全链路**：
   - 记录检查更新时，版本号的语义化比对结果（如 `currentVersion -> targetVersion` 是否满足 `IsNewerVersion`）。
   - 记录下载更新包与签名时，从云端获取的资产包哈希长度、文件大小。
   - 记录 Ed25519 签名验证明细（如 128 字符 Hex 签名是否解码成功、验签通过/拒绝结果等）。
3. **静默进程拉起与清理**：记录 Windows 重命名原子更新（`.exe -> .exe.old`）的完整路径重命名步骤、启动新进程 and 清理 `.old` 的状态。

## 3. Chat V2 跨端统一日志系统 (Chat V2 Unified Logging)

当 **DebugLog** 或 **DevMode** 开关启用时，Chat V2 日志系统将启动自动落盘并建立统一的三端（GUI/CLI、服务端、移动浏览器端）融合日志链路：

- **落盘位置**：
  - **GUI 模式**：所有组件（GUI 后台、服务端 HTTP/WS 诊断、移动浏览器回传日志）一并追加写入统一的 `desktop.log` 中。会话关闭后日志依然保留，可随时通过 About 页的“打开日志文件”按钮打开分析。
  - **CLI 模式**：自动创建并输出到用户缓存目录下的 `cli.log`（例如 `~/.cache/eqt/cli.log` 或 `%LOCALAPPDATA%/eqt/cli.log`），实现每次启动运行皆可追溯。
  - **自定义保存路径**：在 Dev 模式的设置面板中，增加了“自定义日志保存路径 (LogDir)”配置项。用户输入并失焦后，新启动的会话以及 `desktop.log`/`cli.log` 会自动使用新路径，并在 About 页直接链接展示该自定义目录下的日志文件。
- **会话级物理隔离 (Session Isolation)**：
  - 针对移动浏览器回传的每个设备（Peer）日志，服务端在 `LogDir` 目录下自动按会话 Token 维度归类：`logDir/session-<token>/device-<peer>.log`。
  - 每一个会话在每次启动创建时都有独一无二的随机 token（如扫码的 room token），这使得不同会话周期、不同会话房间的移动端日志实现了物理上目录级别的强隔离，极易查找和分析。
- **移动端 (MOBILE) 离线日志缓冲机制**：
  - 移动浏览器端的 H5 页面中（`App.svelte` / `websocket.ts`）提供日志队列 `pendingLogs`。
  - 当 WebSocket 连接断开或尚未就绪时，发生的动作与异常日志先存入队列，防止丢失。在重新连接上 WebSocket 的瞬间（`onopen` 手续完成），批量 Flush 回传给服务端。
  - 传输完成（下载成功、下载失败）等事件会自动触发 `client.sendLog()` 回传。
- **服务端日志融合路由**：
  - 服务端 WebSocket 处理器接收到移动端的 `CommandLog` 后，在写入单独的设备日志外，还会调用 `diag.Emit()` 以 `[MOBILE:<peer>]` 为前缀向主 `diag.Logger` 路由。
  - 主 `diag.Logger` 自动追加至统一的 `desktop.log`（GUI 模式）或 `cli.log`（CLI 模式）中。
- **动态开关控制**：
  - 当用户在 GUI 界面动态关闭“启用调试日志”开关时，`FileLogger` 的 `Write` 方法会自动拦截所有的磁盘写入（降级为 nop），直到用户再次开启，实现完全的实时热切换控制。

