---
name: eqt-dev
description: Guides EQT developer mode configurations, log system structures, logging paths (Windows & Linux), and dev tracing techniques. Use when Codex needs to: (1) Check or debug local logs, (2) Inspect or troubleshoot auto-update, signature verification, and Cloudflare Pages deployments, (3) Integrate and run e2e-multi-device-simulation tests, or (4) Maintain Cloudflare Workers feedback APIs.
---

# EQT 开发者模式与主控导航指南 (EQT DevMode & Navigation Guidelines)

本指南为 EQT 开发者模式、局域网传输架构以及核心调试流程的总领主控导航。

---

## 1. 开发者模式 (Developer Mode & DebugLog)

### 1.1 配置文件路径与开启方式 (Config Path SSOT & Trigger)
- **唯一配置与数据存储根目录 (SSOT)**：所有平台的配置文件、离线数字证书（`.lic`）及历史记录均**严格且统一存放在用户家目录的 `.local/eqt/` 下**：
  - **Windows**: `C:\Users\<用户名>\.local\eqt\`
  - **Linux / macOS**: `~/.local/eqt/`
- **主配置文件与格式**：主配置文件固定为 **`config.yml`**（YAML 格式）。
- **开发者模式（`DevMode`）开启语法**：
  在 `config.yml` 文件中配置以下这行 YAML 语法：
  ```yaml
  dev: liyuelong
  ```
  只有 `dev` 值为 `"liyuelong"` 时才会激活 `DevMode`。开启后在 GUI【设置】底部解锁绿框【开发者选项】（包含在线对账 `☁️` 等工具）。

---

## 2. 大文件传输与断点续传技术规格 (Large File Transfer Specs)

1. **普通接收模式 (Receive 命令行/移动端上传方向)**：采用 **Tus 协议分片上传**，客户端使用 `tus-js-client`。服务端支持 Tus 并发上传与 Offset HEAD 对齐，支持大文件断点续传。
2. **Chat 模式附件发送 (上传方向)**：采用标准的单 HTTP `Multipart Form` 一次性上传。中途断开需重新上传。
   - **视频流式优化 (Play-on-Demand & Metadata)**：发送端利用浏览器离屏 video 提前提取元数据（`duration`、`width`、`height`）并广播。接收端使用元数据适配画幅，默认不预载大视频。点击播放时才按需流式拉取数据，依靠后端 HTTP Range 头部提供滑动窗口缓冲（15~30s），避免内存 OOM。
3. **大文件下载 (下载方向)**：
   - 服务端底层调用 `http.ServeFile`，支持 HTTP `Range` 与 `206 Partial Content`。
   - 客户端（Wails 与 H5 网页端下载）采用 `GET` 单次拉取。

---

## 3. 局域网网络绑定与 IP 解析 (LAN Network Binding)

在启动局域网互传/聊天服务（Share、Receive、Chat 模式）监听 `0.0.0.0` 时：
- **UDP 路由探测 (UDP Routing Probe)**：
  运行 `net.Dial("udp", "8.8.8.8:80")` 查询 OS 路由表，**不发送实际数据包 (耗时 < 0.1ms)**，返回用于外网通信的本地网卡 IP（如 `192.168.x.x`）。
- **活跃网卡扫描 (Active Interface Scan)**：
  若探测失败，扫描所有 `Up` 且非 `Loopback` 的网卡，获取第一个有效的 IPv4。
- **外部共识兜底**：
  仅在前两步都失败时调用 `go-external-ip` 进行公网查询，消除 NAT 离线延迟和报错。

---

## 4. 多模块 Go 工程 pkg 规范与 Windows/WSL 路径优化

1. **pkg 共享包隔离**：
   - 跨模块重用共享代码时，统一在 `pkg/` 下（如 `pkg/config`）定义。禁止使用 `internal/` 包。
2. **WSL explorer 调起**：
   - WSL 中需检测并使用 `wslpath -w <path>` 将 Linux 绝对路径转换为 Windows UNC 格式路径（如 `\\wsl.localhost\Ubuntu\...`）传给宿主机的 `explorer.exe`。
   - 对包含空格的路径，使用 `rundll32.exe url.dll,FileProtocolHandler <winPath>` 调起关联程序。
3. **回车键防误触机制**：
   - 在高风险二次确认对话框渲染后，必须显式对“取消”按钮设置聚焦（`focus()`），防误触回车键触发重置。

---

## 5. 详细技术细节导航 (Reference Files Navigation)

详细排坑指南、部署说明、表结构和测试方案，请查阅以下参考文档：

* **日志位置与系统运作**：参阅 [logging.md](references/logging.md)
  * *包含组件日志绝对落盘位置、追溯状态机转换方法。*
* **自动更新、签名防伪与 Pages 部署**：参阅 [updater.md](references/updater.md)
  * *包含 Ed25519 验签分析、Wails CI Headless 编译 Binding 避坑、Cloudflare Pages 分支覆盖与 Go embed 缓存刷新。*
* **Cloudflare Workers 反馈系统与存储**：参阅 [feedback_api.md](references/feedback_api.md)
  * *包含 D1 数据库设计、R2 对象存储接口定义、Telegram Bot 异步推送及集成测试。*
* **CDP 真机仿真与多设备自动化测试**：参阅 [e2e_testing.md](references/e2e_testing.md)
  * *包含 Chrome CDP 端口设置、`scripts/e2e-multi-device-simulation.js` 脚本并发与断点续传检验方法。*
