---
name: eqt-dev
description: Guides EQT developer mode configurations, log system structures, logging paths (Windows & Linux), build/deploy/publish operation semantics, and dev tracing techniques. Use when you need to: (1) Publish to test environment or understand build vs deploy vs publish commands, (2) Check or debug local logs, (3) Inspect or troubleshoot auto-update, signature verification, and Cloudflare Pages deployments, or (4) Maintain Cloudflare Workers APIs.
---

# EQT 开发者模式与主控导航指南 (EQT DevMode & Navigation Guidelines)

本指南为 EQT 开发者模式、局域网传输架构以及核心调试流程的总领主控导航。

---

## 1. 操作语义与命令标准：编译、部署与发布 (Build, Deploy, Publish)

为杜绝操作脱节并确保生产与测试环境彻底隔离，全工程严格区分三层操作语义并全面落地 **GitHub Actions 云端自动化 + 差异化增量部署**：

| 语义 | 操作范围 | 对应命令 / 流水线 | 增量检测与环境隔离机制 |
| :--- | :--- | :--- | :--- |
| **本地编译 (Build)** | 仅编译本地代码，生成 Windows / 跨平台二进制与 zip 包 | `scripts/deploy-windows-results.sh` | 仅输出到本地（如 `/mnt/e/developer/results/`），远端与首页无变化 |
| **测试云端发布 (Test Publish)** | **云端全自动闭环**：检测变更 -> 编译 Windows 测试客户端 -> 上传 R2 -> 增量部署 CF 服务 | **push 到 `dev` 分支**<br>触发 `.github/workflows/deploy-test.yml` | 1. **增量编译**：仅当客户端（Go/GUI）代码修改时，才启动 Windows runner 编译测试包（带 `-tags eqtdev`）并推送到 R2 `downloads/test/`<br>2. **增量部署**：仅对发生代码变更的 Cloudflare 服务（drm-api / feedback-api / website / admin）执行部署，未变更模块自动跳过<br>3. **测试隔离**：绑定专属测试域名（`lic-test.eqt.net.im` / `test.eqt.net.im`），无人工审批门禁，秒级极速迭代 |
| **生产边缘部署 (Prod Deploy)** | 部署 Cloudflare 生产边缘服务 (Workers / Pages) | **push 到 `master` 分支**<br>触发 `.github/workflows/deploy.yml` | 1. CI 通过后触发，**受 GitHub `production` 环境人工审批门禁保护**<br>2. 同样支持路径变更检测，仅部署有改动的生产 Worker/Pages，未变动服务直接跳过 |
| **生产正式发布 (Prod Release)** | 编译生产正式客户端 -> GitHub Release -> R2 全球分发 -> 官网更新 | **push `v*` tag**<br>触发 `.github/workflows/release.yml` | 1. Windows runner 编译生产二进制（**绝无 `-tags eqtdev`**）<br>2. Ed25519 签名，发 GitHub Release<br>3. 上传至 R2 `downloads/v*/` 与 `downloads/latest/`<br>4. 部署生产官网 `eqt.net.im` |

### 统一命令入口 (Unified pnpm Lifecycle Commands)

根目录 `package.json` 提供标准化 `pnpm` 命令矩阵，消除各子目录与脚本的记忆负担：

| 命令 | 动作说明 | 底层映射 |
| :--- | :--- | :--- |
| `pnpm run publish:test` | **测试环境完整发布闭环**（编译物理包 -> 上传 R2 测试分发桶 -> 同步时间戳 -> 推送 dev 触发 CI/CD 全链路） | `scripts/publish-test.sh` |
| `pnpm run publish:prod` | **生产环境完整发布闭环**（推送 master -> 打版本 Tag 并推送触发 GitHub Actions 官方 Release 安全加签与分发流水线 -> 部署官网 -> 验证） | `scripts/publish-prod.sh` |
| `pnpm run publish:all` | **一键全量发布**：先执行测试发布，紧接着执行生产发布 | `scripts/publish-test.sh && scripts/publish-prod.sh` |
| `pnpm run deploy:test` | 纯边缘部署：部署测试环境 Cloudflare Workers 与 Pages | `wrangler deploy --env test` |
| `pnpm run deploy:prod` | 纯边缘部署：部署生产环境 Cloudflare Workers 与 Pages | `wrangler deploy` |
| `pnpm run build` | 本地完整编译：运行 Go 测试并生成 Windows 生产/测试物理产物至验收目录 | `scripts/deploy-windows-results.sh` |
| `pnpm run build:quick` | 本地快速编译：跳过测试快速生成 Windows 物理产物 | `scripts/deploy-windows-results.sh --no-tests` |
| `pnpm test` | 运行 Go 全模块自动化测试 | `go test ./...` |

> **关键准则**：
> 1. **测试发布全走云端**：日常开发只需运行 `pnpm run publish:test`（或直接使用 `scripts/git-push-smart.sh origin dev` 推送到 `dev` 分支），GitHub Actions 全自动完成差异化发布。
> 2. **差异化增量保障**：修改某个 Worker 时，流水线绝对不会空跑 5 分钟去编译 Windows GUI；修改文档或配置时，所有编译部署均秒级跳过。
> 3. **生产安全加签隔离**：生产二进制由 GitHub Actions 使用保存在 Secrets 中的正式私钥执行 Ed25519 安全加签，本地环境绝不保存生产私钥。运行 `pnpm run publish:prod` 会自动推送版本 Tag 触发该标准安全发布链路。

---

## 2. 开发者模式 (Developer Mode & DebugLog)

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

## 3. 大文件传输与断点续传技术规格 (Large File Transfer Specs)

1. **普通接收模式 (Receive 命令行/移动端上传方向)**：采用 **Tus 协议分片上传**，客户端使用 `tus-js-client`。服务端支持 Tus 并发上传与 Offset HEAD 对齐，支持大文件断点续传。
2. **Chat 模式附件发送 (上传方向)**：采用标准的单 HTTP `Multipart Form` 一次性上传。中途断开需重新上传。
   - **视频流式优化 (Play-on-Demand & Metadata)**：发送端利用浏览器离屏 video 提前提取元数据（`duration`、`width`、`height`）并广播。接收端使用元数据适配画幅，默认不预载大视频。点击播放时才按需流式拉取数据，依靠后端 HTTP Range 头部提供滑动窗口缓冲（15~30s），避免内存 OOM。
3. **大文件下载 (下载方向)**：
   - 服务端底层调用 `http.ServeFile`，支持 HTTP `Range` 与 `206 Partial Content`。
   - 客户端（Wails 与 H5 网页端下载）采用 `GET` 单次拉取。

---

## 4. 局域网网络绑定与 IP 解析 (LAN Network Binding)

在启动局域网互传/聊天服务（Share、Receive、Chat 模式）监听 `0.0.0.0` 时：
- **UDP 路由探测 (UDP Routing Probe)**：
  运行 `net.Dial("udp", "8.8.8.8:80")` 查询 OS 路由表，**不发送实际数据包 (耗时 < 0.1ms)**，返回用于外网通信的本地网卡 IP（如 `192.168.x.x`）。
- **活跃网卡扫描 (Active Interface Scan)**：
  若探测失败，扫描所有 `Up` 且非 `Loopback` 的网卡，获取第一个有效的 IPv4。
- **外部共识兜底**：
  仅在前两步都失败时调用 `go-external-ip` 进行公网查询，消除 NAT 离线延迟和报错。

---

## 5. 多模块 Go 工程 pkg 规范与 Windows/WSL 路径优化

1. **pkg 共享包隔离**：
   - 跨模块重用共享代码时，统一在 `pkg/` 下（如 `pkg/config`）定义。禁止使用 `internal/` 包。
2. **WSL explorer 调起**：
   - WSL 中需检测并使用 `wslpath -w <path>` 将 Linux 绝对路径转换为 Windows UNC 格式路径（如 `\\wsl.localhost\Ubuntu\...`）传给宿主机的 `explorer.exe`。
   - 对包含空格的路径，使用 `rundll32.exe url.dll,FileProtocolHandler <winPath>` 调起关联程序。
3. **回车键防误触机制**：
   - 在高风险二次确认对话框渲染后，必须显式对“取消”按钮设置聚焦（`focus()`），防误触回车键触发重置。

---

## 6. Wails 启动期事件竞态与崩溃上报调试 (Startup Event Race & Crash Report Debug)

- **竞态规则**：Wails 的 `OnStartup` 在 WebView 前端 JS 加载完成前异步触发，此时 `EventsEmit` 发出的前端事件会因监听器未注册而被静默丢弃（Wails JS 事件分发无队列）。
  若需让前端在启动时感知状态（如崩溃 dump 待上报），**必须由前端初始化时主动调用绑定方法**（如 `CheckCrashReport()`），事件通道仅作次要路径。
- **崩溃上报调试链路**：`config.yml` 开启 `dev: liyuelong` → 设置 → 开发者选项 →「触发崩溃测试」写入 `~/.local/eqt/crash.dump` → 重启 GUI 验证：`...` 菜单小蓝点 + 反馈面板预填。Go 端日志出现 `Pending crash dump found, notifying frontend` 但前端无反应，即为此竞态（事件丢失），不是 dump 未写入。

---

## 7. 详细技术细节导航 (Reference Files Navigation)

详细排坑指南、部署说明、表结构和测试方案，请查阅以下参考文档：

* **日志位置与系统运作**：参阅 [logging.md](references/logging.md)
  * *包含组件日志绝对落盘位置、追溯状态机转换方法。*
* **自动更新、签名防伪与 Pages 部署**：参阅 [updater.md](references/updater.md)
  * *包含 Ed25519 验签分析、Wails CI Headless 编译 Binding 避坑、Cloudflare Pages 分支覆盖与 Go embed 缓存刷新。*
* **Cloudflare Workers 反馈系统与存储**：参阅 [feedback_api.md](references/feedback_api.md)
  * *包含 D1 数据库设计、R2 对象存储接口定义、Telegram Bot 异步推送及集成测试。*
* **CDP 真机仿真与多设备自动化测试**：参阅 [e2e_testing.md](references/e2e_testing.md)
  * *包含 Chrome CDP 端口设置、`scripts/e2e-multi-device-simulation.js` 脚本并发与断点续传检验方法。*
