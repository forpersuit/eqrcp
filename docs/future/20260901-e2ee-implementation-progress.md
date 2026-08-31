# EQT E2EE 端到端加密工程落地与进度监控看板 (Implementation Progress Tracker)

> **文档性质**：E2EE 特性开发实施主控看板（可执行、可监控、可追溯）  
> **制定日期**：2026-08-31  
> **目标分支**：`feat/e2ee`  
> **关联架构基准文档**：[20260901-e2ee-end-to-end-encryption-architecture.md](./20260901-e2ee-end-to-end-encryption-architecture.md)

---

## 1. 里程碑总体进度看板 (Milestone Status)

| 阶段 (Phase) | 阶段名称 | 核心目标与交付件 | 状态 (Status) | 责任模块 |
| :--- | :--- | :--- | :---: | :--- |
| **Phase 1** | **WASM 密码学引擎** | `libsodium.js` (WASM) 封装、HKDF 派生、4MB 分块 AEAD Worker | ⏳ **待启动 (Ready)** | `pkg/pages/assets/` |
| **Phase 2** | **DRM 云端会话端点** | D1 表结构、单例覆盖重建、TTL 物理销毁、零日志 CORS | ⏳ **待启动** | `cloudflare/eqt-drm-api/` |
| **Phase 3** | **Chat 模式双向 E2EE** | WebSocket `e2ee_envelope`、Seq 防重放、Svelte 端加解密 | ⏳ **待启动** | `pkg/chat/v2/` |
| **Phase 4** | **Share / Receive 分块流** | REST 分块端点、3级流水线、IndexedDB 落盘、静默 Ban 网关 | ⏳ **待启动** | `pkg/server/`, `pkg/pages/` |
| **Phase 5** | **GUI 三态卡片与 CI 沙盒** | 三态徽章 (`🔒`/`⚠️`/`🔓`)、DRM 探活缓存、Mock DRM 测试套件 | ⏳ **待启动** | `desktop/gui/`, `cmd/` |

---

## 2. 分阶段任务清单与验收标准 (Actionable Task Checklist)

### Phase 1: WASM 密码学基础库与 HKDF 密钥派生引擎

* **阶段目标**：在浏览器非安全上下文（局域网 HTTP）下提供全速、安全、零拷贝的 XChaCha20-Poly1305 加解密与 HKDF 密钥派生底座。

- [ ] **Task 1.1: 基础密码学引擎封装** (`pkg/pages/assets/crypto-engine.js`)
  - [ ] 引入 `libsodium.js`，将 `sodium.wasm` 以 Base64 内联或 SHA-256 运行时校验载入，杜绝外部篡改；
  - [ ] 封装 `initCryptoEngine()`，支持 CDN 强缓存与骨架屏异步初始化；
  - [ ] 封装标准 **HKDF-SHA256 (RFC 5869)** 派生函数，从 `MasterKey` 派生 `K_send`, `K_recv`, `K_ws`, `K_auth`。
- [ ] **Task 1.2: 4MB 分块加解密 Web Worker 管道** (`pkg/pages/assets/crypto.worker.js`)
  - [ ] 封装分块加解密纯函数：输入 `[PlaintextChunk, Nonce, Key, ChunkIndex]` $\rightarrow$ 输出 `[ChunkIndex(4B) | Nonce(24B) | Ciphertext | Tag(16B)]`；
  - [ ] 主线程与 Worker 通信全面采用 `Transferable Objects`（`postMessage(buf, [buf])`）实现零内存拷贝；
  - [ ] 建立定长环形 ArrayBuffer 复用池，多 Worker 全局内存硬顶限制在 `< 64MB`，杜绝 WebKit OOM；
  - [ ] 显式生命周期管理：在传输完成、取消或页面卸载时触发 `worker.terminate()` 彻底回收 WASM 线性内存；
  - [ ] 注意：`terminate()` 仅回收内存 ≠ 密钥字节物理清零——终止前须在 Worker 内部对密钥副本先执行 `sodium.memzero()`（与 Task 1.3 主线程 `wipeKey` 互补，防 freed 页 / swap / 转储残留）；
  - [ ] 异常容错机制：捕获 `worker.onerror` 并支持 Worker 自动重新孵化（Auto-Respawn），失败分块自动重入等待队列，防止单次 Worker 异常挂起传输流水线；
  - [ ] Auto-Respawn 前提：主线程须保留 `MasterKey`（或可重派生副本）直至传输完成，不得在首次下发 Worker 后即按 意见 31 清零——新 Worker 孵化后须重新注入密钥并完成异步初始化，否则崩溃重孵化会因无密钥挂死；
  - [ ] Auto-Respawn 熔断防死锁：单个 Worker 实例或单次传输设置连续异常重试上限（3 次），熔断后向主线程抛出确定性异常并以端内 Toast 提示，杜绝“崩溃 $\rightarrow$ 重孵化 $\rightarrow$ 崩溃”死循环 CPU 耗尽。
- [ ] **Task 1.3: 内存安全与防御性清零**
  - [ ] 实现 `wipeKey(keyUint8Array)` 显式调用 `sodium.memzero()` 物理擦除 WASM 线性内存；
  - [ ] 编写跨浏览器（iOS Safari、Android Chrome、Edge、Firefox）局域网 HTTP 兼容性测试脚本。

> **Phase 1 验收标准 (DoD)**：
> 1. 在本地 HTTP 页面成功加载并初始化 libsodium WASM；
> 2. 4MB 分块单核加密吞吐 $\ge 60$MB/s，解密验签失败时能准确抛出 Authentication Tag 异常；
> 3. Worker 内存稳定在 35MB 以内，任务结束后 `worker.terminate()` 内存无泄漏。

---

### Phase 2: DRM 会话密钥与生命周期端点

* **阶段目标**：在 Cloudflare Worker D1 上实现高并发、低延迟、单例覆盖重建与阅后即焚的盲中继密钥分发服务。

- [ ] **Task 2.1: D1 数据库表结构与索引** (`cloudflare/eqt-drm-api/`)
  - [ ] 创建表 `e2ee_sessions`，包含字段 `(session_id, device_id, mode, master_key, claim_count, max_claims, status, expires_at, created_at)`；
  - [ ] 创建唯一联合索引 `UNIQUE(device_id, mode)`，支撑单例覆盖重建。
- [ ] **Task 2.2: 会话创建端点** (`POST /api/v1/e2ee/session/create`)
  - [ ] 校验 Desktop 设备 License 授权与请求频率；
  - [ ] 生成安全强随机 256-bit `MasterKey` 与短期凭据；
  - [ ] 执行 `INSERT ... ON CONFLICT(device_id, mode) DO UPDATE` 原子作废旧会话并写入全新会话；
  - [ ] 10% 概率抽样触发 `DELETE FROM e2ee_sessions WHERE expires_at < unixepoch()` 惰性清理。
- [ ] **Task 2.3: 会话领取端点** (`POST /api/v1/e2ee/session/:id/claim`)
  - [ ] 接收移动端 `X-Client-Instance-Id` (UUID)；
  - [ ] 原子 CAS 递增 `claim_count` 并校验 `claim_count < max_claims`；
  - [ ] 领取前先校验 `expires_at > unixepoch()`，过期会话返回 `410 Gone`（惰性 GC 抽样清理可能尚未执行，防止在密钥过期窗口内被领取）；
  - [ ] 支持同设备刷新重载容错；
  - [ ] 下发 `MasterKey`，响应头携带标准 CORS (`Access-Control-Allow-Origin: *`)。
- [ ] **Task 2.4: 主动关闭与零日志隐私合规** (`POST /api/v1/e2ee/session/:id/close`)
  - [ ] PC 退出或关闭会话时触发 `close`，校验 `close_token` 后物理删除会话记录；
  - [ ] 审计 DRM Worker 日志，确保不记录客户端 IP、文件名或传输载荷（应用层 Zero-Telemetry）。
- [ ] **Task 2.5: 健康探活端点** (`HEAD /health`)
  - [ ] 返回 `200` 与版本号（不含敏感信息），供桌面端 Phase 5.1 后台 30s 探活使用（架构文档 §5.2 之外被 §9 意见假定存在，此处补入实施契约）；
  - [ ] 遵循统一 CORS 与零日志策略。

> **Phase 2 验收标准 (DoD)**：
> 1. `wrangler deploy` 成功部署并通过单元测试；
> 2. 并发 claim 压测达到 100 QPS 且配额 CAS 严格不击穿；
> 3. PC 再次创建会话时旧会话立即失效。

---

### Phase 3: Chat 模式双向 WebSocket 与剪贴板 E2EE

* **阶段目标**：在局域网 Chat 模式下实现消息、剪贴板与附件的端到端透明加解密。

- [ ] **Task 3.1: 协议封装与防重放机制** (`pkg/chat/v2/protocol/`)
  - [ ] 定义 `e2ee_envelope` 结构体：`{ seq, timestamp, nonce, ciphertext, tag }`；
  - [ ] 将 `seq || timestamp` 绑定至 AEAD 附加认证数据 (AAD)；
  - [ ] 接收端建立滑动窗口校验，拦截乱序与重放密文帧。
- [ ] **Task 3.2: 文本与剪贴板加解密集成**
  - [ ] Go 服务端实现盲中继转发（不解密聊天与剪贴板 payload）；
  - [ ] Svelte 前端在 Web Worker 中对输入文本/剪贴板透明加密后发送；
  - [ ] 接收端 Svelte 前端解密后渲染进 UI，错误时显示“⚠️ 解密失败”。
- [ ] **Task 3.3: 附件分级传输管道**
  - [ ] 小附件 ($\le 20$MB)：前端单块加密，直接 POST 至 `/upload`（单块封包复用 `[Nonce(24B) | Ciphertext | Tag(16B)]` 信封，无 4MB 分块头 `ChunkIndex`，与分块格式严格区分）；
  - [ ] 大附件 ($> 20$MB)：复用 4MB 分块流式加密管道，支持断点恢复。

> **Phase 3 验收标准 (DoD)**：
> 1. Wireshark 抓包局域网 WebSocket 数据帧，全量显示为高熵随机密文；
> 2. 聊天消息、图片与剪贴板同步正常展示，时延增加 $< 5$ms。

---

### Phase 4: Receive / Share 4MB 分块流式加解密与设备管理控制

* **阶段目标**：打通 Share（下载）与 Receive（上传）的 4MB 分块加解密管道，落实静默屏蔽与从头重置红线。

> **Phase 4 前置依赖**：为在无公网 / 无真实 License 下离线验证 Receive / Share 分块链路，将 Phase 5.4 的 `MockDRMServer` 最小化桩提前到本阶段起始实现（仅提供 `claim` 下发 MasterKey 与 `health` 探活，即可支撑 4MB 分块与 Ban 门禁的端到端验证）；完整自动化回归套件仍归 Phase 5.4。

- [ ] **Task 4.1: Receive REST 分块上传端点** (`pkg/server/`)
  - [ ] 新增 `POST /receive/:path/chunk` 端点，解析 `X-File-ID`、`X-Chunk-Index` 二进制切片；
  - [ ] 封装 Go `ChunkedXChaChaReader`，边验签边流式解密；
  - [ ] 利用 4MB 定长切片物理偏移确定性（`offset = chunkIndex * 4MB`），支持 `os.File.WriteAt` 并发乱序直写物理文件，免去内存滑动窗口队列；
  - [ ] 乱序直写两前提：① 分块 AEAD 的 AAD 须绑定 `chunkIndex`（含会话/文件 ID），防止「合法块被重放到错误偏移」仍通过逐块验签；② 保留一个极小连续位图跟踪器维护「最大连续块 M」——`chunk_status`（Task 4.3）只以连续 M 为准，按「最高已写块」续传会在空洞处产生文件洞，最终仅 `file_sha256` 兜底；
  - [ ] 写入闭环保障：当所有分块到齐后，显式调用 `os.File.Truncate(expectedTotalBytes)` 确保文件尺寸精确等于期望总长（幂等、仅定尺寸，**不填充中间空洞**——中间空洞由 Task 4.3 `received_ranges` 定向补发闭合），再 `os.File.Sync()` 强制刷盘后按 §7.5 原子重命名；
  - [ ] 无锁并发 I/O 规范：`*os.File.WriteAt` 底层基于操作系统原生 `pwrite64` (Linux) / `WriteFile` (Windows) 保证线程安全，Go 服务端处理并发分块落盘时严禁套用全局写文件互斥锁，确保多 goroutine 磁盘吞吐最大化；
  - [ ] 引入 `sync.Pool` 4MB 缓冲区，明文 Buffer 归还前执行 `clear(b)` 与 `runtime.KeepAlive`。
- [ ] **Task 4.2: 移动端 3 级流水线并发与存储落盘** (`pkg/pages/upload.tmpl.html` & `download.tmpl.html`)
  - [ ] 实现 Read $\rightarrow$ Encrypt $\rightarrow$ POST 3 级并发流水线；
  - [ ] 实现 weak Wi-Fi 超时连续失败自适应降级为 1 并发；
  - [ ] 实现基于 IndexedDB 的流式分件落盘（$\ge 500$MB），针对 iOS Safari 纯 HTTP 明确标注 1GB 边界。
- [ ] **Task 4.3: 设备显性化与静默屏蔽门禁** (`pkg/server/server.go`)
  - [ ] 请求头提取 `X-Client-Instance-Id` 与设备名，新设备首次接入触发 GUI Toast / CLI 高亮日志；
  - [ ] 联动现有设备改名接口 `POST /api/device/rename`，即时无刷新更新 PC 卡片；
  - [ ] 实现 `sessionBannedClients` 内存门禁（`sync.RWMutex` 保护），屏蔽时切断后续块（返回 403）；
  - [ ] 落实 §7.5 红线：Receive 被屏蔽时立即删除 `.tmp` 临时文件；解封后 `chunk_status` 强制返回 $M=0$，强制从 Chunk 0 重置；
  - [ ] `chunk_status` 响应支持返回主连续游标 `continuous_index: M` 及可选区间 `received_ranges`，允许客户端针对性补发空洞分块，避免大文件因偶发丢单块导致全量后置块重传（解封重置时 `received_ranges` 与 `M` 一并归零，与服务端已删的 `.tmp` 保持一致）。
- [ ] **Task 4.4: 多文件流式 ZIP 归档传输**
  - [ ] PC 端在内存中以虚拟流式 ZIP 容器逐块加密下发，移动端解密后单文件下载，规避多文件拦截弹窗。

> **Phase 4 验收标准 (DoD)**：
> 1. 千兆局域网下 Receive 与 Share 加密吞吐达到 $80 \sim 110$ MB/s；
> 2. 传输中途点击“屏蔽”，数据传输瞬间阻断且 PC 端无脏临时文件残留；
> 3. 点击“恢复”，移动端从 Chunk 0 完整重新发起并成功接收文件。

---

### Phase 5: Settings 开关、GUI 三态设备卡片与自动化测试沙盒

* **阶段目标**：完成桌面 GUI/CLI 交互闭环、三态视觉反馈与自动化 CI 测试。

- [ ] **Task 5.1: Settings 配置与后台探活防抖** (`pkg/config/settings.go`)
  - [ ] 新增 `EnableE2EE` 配置项与 Settings 开关；
  - [ ] 后台协程 30 秒周期探活 DRM 服务（`HEAD https://drm.eqt.net.im/health`），内存缓存状态。
- [ ] **Task 5.2: 桌面 GUI 三态视觉徽章与设备卡片** (`desktop/gui/frontend/src/`)
  - [ ] 设备卡片与顶栏实现三态语义：
    - 🟢 `🔒 E2EE`：加密正常；
    - 🟡 `⚠️ 降级传输`：因断网或 DRM 不可达被迫降级（Tooltip 显示原因）；
    - ⚪ `🔓 标准局域网`：自愿明文（未购买或主动关闭）；
  - [ ] 卡片上提供 `[ 🚫 屏蔽 ]` / `[ ✅ 恢复 ]` 交互切换按钮。
- [ ] **Task 5.3: 操作系统级调度与保活**
  - [ ] Windows 端调用 `SetProcessInformation(ProcessPowerThrottling)` 与 `ES_SYSTEM_REQUIRED` 防后台休眠与降频；
  - [ ] 移动端调用 `navigator.wakeLock.request('screen')` 保活。
- [ ] **Task 5.4: 本地离线 Mock DRM 与全自动化测试套件** (`pkg/server/`)
  - [ ] 封装内存型 `MockDRMServer`；
  - [ ] 编写全套自动化回归测试：
    - `TestE2EE_ChunkedTransferSuccess`
    - `TestE2EE_TamperedCiphertextAuthFailure`
    - `TestE2EE_SilentBanAndChunk0Reset`
    - `TestE2EE_InFlightBan_ContextCancelAndFileCleanup`
    - `TestE2EE_OfflineDRMFallback`
  - [ ] 确保 `go test ./...` 100% 通过且现有明文/tus 链路零回归。

> **Phase 5 验收标准 (DoD)**：
> 1. GUI 界面三态徽章与屏蔽操作实时联动且无任何原生 `alert()` 弹窗；
> 2. `go test ./...` 全绿通过，本地无公网也能跑通所有 E2EE 测试用例。

---

## 3. 提交与变更日志 (Implementation Timeline)

| 日期 | Commit Hash | 提交说明 | 对应任务 | 状态 |
| :--- | :--- | :--- | :--- | :---: |
| 2026-08-31 | `c2c37d0` | 基于 master 创建 `feat/e2ee` 特性分支 | 分支准备 | ✅ 完成 |
| 2026-08-31 | `5881382` | 改造 pre-commit hook 默认无副作用秒级提交 | 工程基建 | ✅ 完成 |
| 2026-08-31 | `7907911` | 完成 E2EE 架构终审方案与三态视觉图例封版 | 架构设计 | ✅ 完成 |
| 待推进 | — | Phase 1: libsodium WASM 与 HKDF 引擎 | Task 1.1~1.3 | ⏳ 待开始 |

---

## 4. 实施阶段准入准出与交付守则 (Engineering Guidelines)

1. **零回归原则 (Rule 13)**：修改 `pkg/server/` 或前端模板时，必须确保原有明文局域网传输与 `tus.min.js` 断点续传链路完全不受影响；
2. **零副作用提交**：日常提交保持快速（$<0.05$s），仅在需要部署 Windows 验收产物时使用 `EQT_DEPLOY_ON_COMMIT=1`；
3. **推送规范**：在 WSL 环境下推送到 GitHub 必须统一使用 `./scripts/git-push-smart.sh origin feat/e2ee`；
4. **进度同步**：每完成一个子任务，在本文档中更新对应 `[x]` 复选框并记录 Commit Hash，确保研发进度 100% 透明可控。
