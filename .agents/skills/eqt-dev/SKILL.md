---
name: eqt-dev
description: Guides EQT developer mode configurations, log system structures, logging paths (Windows & Linux), and dev tracing techniques. Use when Codex needs to: (1) Check or debug local logs, (2) Inspect or troubleshoot auto-update, signature verification, and Cloudflare Pages deployments, (3) Integrate and run e2e-multi-device-simulation tests, or (4) Maintain Cloudflare Workers feedback APIs.
---

# EQT 开发者模式与主控导航指南 (EQT DevMode & Navigation Guidelines)

本指南为 EQT 开发者模式、局域网传输架构以及核心调试流程的总领主控导航。

---

## 1. 开发者模式 (Developer Mode & DebugLog)

### 1.1 开启方式
开发者模式（`DevMode`）及调试日志（`DebugLog`）通过运行期用户配置动态控制：
- **配置文件控制**：保存在客户端的 `settings.json`（对应结构体 `DesktopSettings`），可通过设置面板进行切换：
  - `devMode`: `true` (开启 WebView 调试面板和开发者选项)
  - `debugLog`: `true` (开启后台详尽请求/处理日志)
- **获取机制**：Wails App 直接通过内存中的 Agent（`desktopAgent` 实例）调用 `config.ReadDesktopSettings` 动态加载。若开启，系统会将后端 server 包的 `server.Log` 输出目标重定向到详细日志流中。

---

## 2. 大文件传输与断点续传技术规格 (Large File Transfer Specs)

1. **普通接收模式 (Receive 命令行/移动端上传方向)**：采用 **Tus 协议分片上传**，客户端使用 `tus-js-client`。服务端支持 Tus 并发上传与 Offset HEAD 对齐，**完美支持大文件断点续传**。
2. **Chat 模式附件发送 (上传方向)**：采用标准的单 HTTP `Multipart Form` 一次性上传。一旦中途断开，整个上传失败，必须重新从头上传。
3. **大文件下载 (下载方向)**：
   - 服务端底层调用 `http.ServeFile`，自动支持 HTTP `Range` 和 `206 Partial Content`。
   - 但客户端（Wails 与 H5 网页端下载）目前皆采用 `GET` 单次拉取，暂不支持断点续传。

---

## 3. 局域网网络绑定与 IP 解析 (LAN Network Binding)

在启动局域网互传/聊天服务（Share、Receive、Chat 模式）时，如果监听地址绑定为 `0.0.0.0`：
- **UDP 路由探测 (UDP Routing Probe)**：
  运行 `net.Dial("udp", "8.8.8.8:80")`。这是一个 OS 路由表查询，**不会发送任何实际数据包 (耗时 < 0.1ms)**，能精确秒级返回当前用于访问外网的本地网卡 IP（例如 `192.168.x.x`）。
- **活跃网卡扫描 (Active Interface Scan)**：
  若探测失败，扫描所有 `Up` 且非 `Loopback` 的网卡，获取第一个有效的 IPv4。
- **外部共识兜底**：
  仅在前两步都失败时调用 `go-external-ip` 进行公网查询，彻底消除 NAT 离线延迟和报错。

---

## 4. 多模块 Go 工程 pkg 规范与 Windows/WSL 路径优化

1. **pkg 共享包隔离**：
   - 跨模块（如 `eqt` 主模块与 `eqt-desktop` 模块）重用共享代码时，统一在 `pkg/` 下（如 `eqt/pkg/config`）定义。
   - 绝对禁止使用 `internal/` 包，避免 Go 编译器报 `use of internal package ... not allowed` 错误。
2. **WSL explorer 调起**：
   - WSL 中需检测并使用 `wslpath -w <path>` 将 Linux 绝对路径转换为标准的 Windows UNC 格式路径（如 `\\wsl.localhost\Ubuntu\...`）传给宿主机的 `explorer.exe`。
   - 对包含空格的路径，使用 `rundll32.exe url.dll,FileProtocolHandler <winPath>` 调起默认关联程序。
3. **回车键防误触机制**：
   - 在高风险二次确认对话框渲染后，必须显式对“取消”按钮设置聚焦（`focus()`），确保用户误触回车键时，默认触发“取消”而非重置。

---

## 5. 详细技术细节导航 (Reference Files Navigation)

如需获取具体的排坑指南、部署说明、表结构和测试方案，请使用 `view_file` 阅读以下独立参考文档：

* **日志位置与系统运作**：请查看 [logging.md](references/logging.md)
  * *包括 Windows/WSL 各组件日志绝对落盘位置、追溯状态机转换方法。*
* **自动更新、签名防伪与 Pages 部署**：请查看 [updater.md](references/updater.md)
  * *包括 Ed25519 验签成因分析、Wails CI Headless 编译 Binding 避坑、Cloudflare Pages 分支覆盖和 Go embed 缓存刷新。*
* **Cloudflare Workers 反馈系统与存储**：请查看 [feedback_api.md](references/feedback_api.md)
  * *包括 D1 数据库设计、R2 对象存储接口定义、Telegram Bot 异步推送及集成测试。*
* **CDP 真机仿真与多设备自动化测试**：请查看 [e2e_testing.md](references/e2e_testing.md)
  * *包括 Chrome CDP 端口设置、`scripts/e2e-multi-device-simulation.js` 脚本并发与断点续传检验方法。*
