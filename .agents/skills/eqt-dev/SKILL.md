---
name: eqt-dev
description: Guides EQT developer mode configurations, log system structures, logging paths (Windows & Linux), and dev tracing techniques.
---

# EQT 开发者模式与日志系统指南 (EQT DevMode & Logging Guidelines)

本技能指南指导开发助手如何控制客户端的开发者模式（DevMode）以及快速定位、排查和细化 EQT 的日志系统。

---

## 1. 开发者模式 (Developer Mode & DebugLog)

### 1.1 开启方式
开发者模式（DevMode）及调试日志（DebugLog）并非由编译宏锁死，而是通过运行期用户配置动态控制：
- **配置文件控制**：保存在客户端的 `settings.json`（对应结构体 `DesktopSettings`），可通过设置面板进行切换：
  - `devMode`: `true` (开启 WebView 调试面板和开发者选项)
  - `debugLog`: `true` (开启后台详尽请求/处理日志)
- **获取机制**：后端路由（如 `cmd/desktop_agent.go` 中的 `/settings`）通过 `config.ReadDesktopSettings` 动态加载。若开启，系统会将后端 server 包的 `server.Log` 输出目标重定向到详细日志流中。

---

## 2. 日志系统运作特点与位置

### 2.1 临时落盘与位置机制
为了避免无谓的磁盘占用，同时保证崩溃后可追溯：
- **进程重定向**：后台运行的 `desktop agent` 守护进程的标准输出（Stdout）和标准错误（Stderr）会被重定向到一个动态命名的日志文件中。
- **文件命名与路径**：
  - **Windows**：落盘在 `%LOCALAPPDATA%/eqt/agent-*.log` 下。
  - **Linux / WSL**：落盘在 `~/.cache/eqt/agent-*.log` 下。
- **动态清理**：通常使用临时文件名（`agent-*.log`），开发调试时需直接前往上述目录并根据修改时间对齐最新生成的文件。

### 2.2 日志记录特征
在 `DevMode` 或 `DebugLog` 激活时，日志具备以下追溯特点：
1. **网络拦截流**：记录每次 HTTP 请求（如 `/settings`、`/update/check`、`/update/download`）的 Method、Path、RemoteAddr、响应状态码，以及 CORS 过滤的具体判定。
2. **更新与验签全链路**：
   - 记录检查更新时，版本号的语义化比对结果（如 `currentVersion -> targetVersion` 是否满足 `IsNewerVersion`）。
   - 记录下载更新包与签名时，从云端获取的资产包哈希长度、文件大小。
   - 记录 Ed25519 签名验证明细（如 128 字符 Hex 签名是否解码成功、验签通过/拒绝结果等）。
3. **静默进程拉起与清理**：记录 Windows 重命名原子更新（`.exe -> .exe.old`）的完整路径重命名步骤、启动新进程 and 清理 `.old` 的状态。
