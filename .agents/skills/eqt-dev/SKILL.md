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
