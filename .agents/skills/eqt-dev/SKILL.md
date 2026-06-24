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
- **获取机制**：Wails App 直接通过内存中的 Agent（`desktopAgent` 实例）调用 `config.ReadDesktopSettings` 动态加载。若开启，系统会将后端 server 包的 `server.Log` 输出目标重定向到详细日志流中。

---

## 2. 日志系统运作特点与位置

### 2.1 临时落盘与位置机制
为了避免无谓的磁盘占用，同时保证崩溃后可追溯：
- **日志文件机制**：桌面端日志（`desktop.log`）路径由 `desktopLogFilePath()` 指明，标准日志和调试信息直接落盘在用户缓存目录下，消除由于进程跨界带来的重定向混乱。
- **文件命名与路径**：
  - **Windows**：落盘在 `%LOCALAPPDATA%/eqt/agent-*.log` 下。
  - **Linux / WSL**：落盘在 `~/.cache/eqt/agent-*.log` 下。
- **动态清理**：通常使用临时文件名（`agent-*.log`），开发调试时需直接前往上述目录并根据修改时间对齐最新生成的文件。

### 2.2 日志记录特征
在 `DevMode` 或 `DebugLog` 激活时，日志具备以下追溯特点：
1. **状态机转换日志**：记录内存 Agent 在任务推送、停止和状态改变时的内部生命周期（例如任务入队、运行、终结及错误诊断等）。
2. **更新与验签全链路**：
   - 记录检查更新时，版本号的语义化比对结果（如 `currentVersion -> targetVersion` 是否满足 `IsNewerVersion`）。
   - 记录下载更新包与签名时，从云端获取的资产包哈希长度、文件大小。
   - 记录 Ed25519 签名验证明细（如 128 字符 Hex 签名是否解码成功、验签通过/拒绝结果等）。
3. **静默进程拉起与清理**：记录 Windows 重命名原子更新（`.exe -> .exe.old`）的完整路径重命名步骤、启动新进程 and 清理 `.old` 的状态。

---

## 3. 自动更新与验签机制避坑 (Update & Signature Verification Troubleshooting)

### 3.1 验签失败的根本成因
当客户端在 `devMode` 或 `debugLog` 日志中显示 `VerifyUpdateSignature: Ed25519 signature verify result: false` 时，说明下载的 `.exe` 二进制文件与对应的 `.sig` 签名文件不匹配。
- **CI/CD 覆盖漏洞**：若发布新版本时重新触发了 GitHub Actions 自动编译工作流（`.github/workflows/release.yml`），工作流会重新编译并上传最新的二进制文件到 Release。如果工作流中**未执行加签步骤**重新计算哈希并生成对应的 `.sig`，则会造成 Release 页面上“新二进制”与“旧签名”并存。
- **解决方法**：工作流在编译 Windows 可执行文件并打包至 Release 时，必须紧跟 `go run scripts/generate-update-sig/main.go out/eqt-desktop-windows-amd64.exe` 进行自动加签，并把生成的 `.sig` 资产同步上传发布。

### 3.2 离线加签调试
若需在本地或生产中紧急修正已有的 Release 签名，可将目标 `.exe` 文件下载到本地，运行如下指令自动计算其哈希、利用内置 `testPrivateKeySeedHex` 进行 Ed25519 数字签名：
```bash
go run scripts/generate-update-sig/main.go <path/to/eqt-desktop-windows-amd64.exe>
```
运行后会在同级目录下生成同名 `.sig` 文件，随后在 GitHub Release 中使用 `gh release upload <tag> <file.sig> --clobber` 将其重新覆盖即可。

### 3.3 前端设置界面闪烁与重新渲染机制
- **重绘冲突**：由于前端采用粗暴的“全量覆写 `innerHTML`”模式，当后台进程通过 SSE 推送状态更新包并执行重新渲染时，会瞬间销毁原本展开的 Select 下拉菜单或处于输入状态的 Input 元素，造成严重的闪烁和焦点丢失。
- **解决方法**：在后台状态事件监听器中，检查如果当前激活的面板为设置（`state.activePanel === 'settings'` 或 `'redeem'`），则只更新内存状态，跳过全局大渲染，等待用户点击 `Save` 或通过局部机制进行重绘，完美解决交互冲突。

### 3.4 手动 Check Now 时遵循 Auto-Update 策略
- **手动/自动控制**：手动点击更新检测按钮（`Check now`）时，系统会根据当前的 `autoUpdateMode`（`off`/`notify` 仅提示，`download`/`silent` 自动触发下载）智能分流，确保在开发和生产环境下更新策略一致。

### 3.5 自动更新的运行链路与集成测试验证机制

#### 3.5.1 自动更新核心运行链路
自动更新采用“前端 UI -> Wails Go App 内存 Agent -> 云端/GitHub API”的单进程集中调用架构：
1. **版本检测**：前端触发 `CheckForUpdates` Wails 绑定方法。App 内存 Agent 会直接调用 `server.CheckForUpdates` 请求 `EQT_LICENSE_SERVER`（默认是云端中转 Worker 接口 `/api/v1/update/check`），如果最新发布版本高于当前运行版本，根据当前客户端 `GOOS` 和 `GOARCH` 过滤并匹配出主二进制资产与配套的 `.sig` 签名文件资产，返回两者的绝对下载链接。
2. **包下载与验签**：在 `DownloadUpdate` 中，内存 Agent 直接异步下载二进制包及签名文件并调用 `server.DownloadUpdate`。使用内置的 Ed25519 公钥（`defaultUpdatePublicKeyHex`）对包的 SHA-256 哈希值进行验签，确认包内容未被篡改后，存放到本地缓存路径。
3. **安全替换与重启**：内存 Agent 检测当前是否有活跃的局域网传输任务，若有则拒绝安装更新。若应用处于空闲状态，在调用 `server.InstallAndRestart` 后，开始安装：
   - **Windows**：将当前运行的 `.exe` 重命名为 `.exe.old`，写入新二进制，然后启动新进程退出旧进程，并在下次启动时清理 `.old`。
   - **POSIX (Linux/macOS)**：写入 `.new` 临时文件，并通过 `os.Rename` 原子覆盖旧的二进制。

#### 3.5.2 本地与集成测试验证方法
- **单元测试 (`server/update_test.go`)**：通过 `TestVerifyUpdateSignature`、`TestCheckForUpdates` 和 `TestDownloadUpdate` 验证签名校验合法性、语义化版本反降级逻辑、及下载写入完整性。
- **集成测试 (`cmd/desktop_agent_test.go`)**：在 `TestDesktopAgentUpdateEndpoints` 中通过 `httptest` 创建 Mock Update 服务，临时修改 `EQT_LICENSE_SERVER` 环境变量重定向客户端，并使用测试私钥种子对测试包加签，模拟并发访问 `/update/check`、`/update/download` 及有任务冲突/空闲时的 `/update/install`。

---

## 4. 大文件传输与断点续传技术规格说明 (Large File Transfer & Resumable Transfer Limitations)

### 4.1 服务端断点续传支持
- **基础实现**：后端的 `server.go` 与 `chat.go` 在提供文件下载（`/send/` 路由）和聊天附件下载（`/attachments/` 路由）时，均调用了 Go 标准库的 `http.ServeFile`。
- **Range 响应**：Go 标准库 `ServeFile` 会针对客户端发送的 HTTP `Range` 请求头自动返回 `206 Partial Content` 以及 `Accept-Ranges: bytes`。这在服务端底层完美支持了文件的断点下载。

### 4.2 业务链路中的暂不支持项 (目前限制)
虽然服务端底层具备 Range 处理能力，但在 EQT 目前的局域网 Chat 业务闭环中，大文件传输在以下环节**并不支持断点续传**：
1. **大文件发送 (上传方向)**：Chat 模式下的文件发送为标准的单 HTTP `Multipart Form` 一次性上传。服务端由 `handleAttachmentUpload` 接收并通过 `r.ParseMultipartForm` 解析。一旦网络在上传中途瞬断，整个上传失败，用户需要重新从头发送整个文件。
2. **大文件接收 (Wails 客户端下载)**：Wails 客户端在下载附件时（由 `downloadChatAttachmentTo` 执行），采用了标准的 HTTP GET 请求，并通过 `io.Copy(out, resp.Body)` 将流一次性拉取并写入。若下载中途断开，不具备 Range 断点重新下载继续合并的逻辑，会导致任务报错并从头开始。
3. **大文件接收 (H5 网页端下载)**：采用的是标准 `<a download>` 的原生浏览器下载方式，在复杂的局域网 IP 重置、Wi-Fi 波动环境中很容易中断且难以自动恢复，需要额外的分片暂存机制方能稳定实现。

---

## 5. 局域网网络绑定与 IP 解析性能优化 (LAN Network Binding & IP Resolution Optimization)

在启动局域网互传/聊天服务（Share、Receive、Chat 模式）时，如果监听地址绑定为 `0.0.0.0` (any)：

### 5.1 历史性能瓶颈
- **外部共识查询瓶颈**：原版 `qrcp` 在绑定到 `0.0.0.0` 时，会通过外部共识库（`go-external-ip`）向公网上的多个服务器（如 OpenDNS、Google、ipify）发起 HTTP/DNS 请求来查询外网 WAN IP。
- **导致的后果**：在局域网互传场景中，设备通常处于内网，公网 WAN IP 因 NAT 屏蔽根本无法直接访问。此外，该查询在网络延迟高或代理网络下会造成 **1~3秒以上的严重启动延迟**，且在完全离线状态下会导致服务直接报错无法启动。

### 5.2 瞬间 IP 解析最佳实践 (Instant local IP resolution)
为了实现不到 1 毫秒的零延迟启动并完美支持离线运行，EQT 采用分级 IP 发现逻辑：
1. **UDP 路由探测 (UDP Routing Probe)**：
   - 运行 `net.Dial("udp", "8.8.8.8:80")`。
   - **特点**：这纯粹是 OS 路由表查询，**不会发送任何实际网络数据包，耗时小于 0.1ms**，且离线状态下只要有默认网关存在即可成功。它能精确返回 OS 当前用于访问外网的本地网卡 IP（例如 `192.168.x.x`），这正是其他局域网设备连接所需的最佳 IP。
2. **活跃网卡扫描 (Active interface scan)**：
   - 如果 UDP 探测因完全无默认路由而失败，扫描所有 `Up` 且非 `Loopback` 的网络接口，获取第一个 valid IPv4 地址。
3. **外部共识兜底 (External consensus fallback)**：
   - 仅在上述两步都失败时，才调用 `go-external-ip` 进行公网查询。

这保证了互传与聊天服务在任何局域网或离线环境下都能瞬间秒开。

