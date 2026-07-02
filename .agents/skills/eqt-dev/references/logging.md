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
