# EQT E2EE 端到端加密工程落地与进度监控看板 (Implementation Progress Tracker)

> **文档性质**：E2EE 特性开发实施主控看板（可执行、可监控、可追溯）  
> **制定日期**：2026-08-31  
> **目标分支**：`feat/e2ee`  
> **关联架构基准文档**：[20260901-e2ee-end-to-end-encryption-architecture.md](./20260901-e2ee-end-to-end-encryption-architecture.md)

---

## 1. 里程碑总体进度看板 (Milestone Status)

| 阶段 (Phase) | 阶段名称 | 核心目标与交付件 | 状态 (Status) | 责任模块 |
| :--- | :--- | :--- | :---: | :--- |
| **Phase 1** | **WASM 密码学引擎** | `libsodium.js` / HKDF 派生、4MB 分块 AEAD Worker、Go/JS 互通 | ⚠️ **核心完成 / 前端引擎不达标**（Task 1.4 阻断项） | `pkg/pages/assets/`, `pkg/crypto/e2ee/` |
| **Phase 2** | **DRM 云端会话端点** | D1 表结构、单例覆盖重建、TTL 物理销毁、零日志 CORS | ✅ **已完成 (100%)**（Task 2.6 补强） | `cloudflare/eqt-drm-api/` |
| **Phase 3** | **Chat 模式双向 E2EE** | WebSocket `e2ee_envelope`、Seq 防重放、Svelte 端加解密 | ⏳ **待启动 (Ready)** | `pkg/chat/v2/` |
| **Phase 4** | **Share / Receive 分块流** | REST 分块端点、3级流水线、IndexedDB 落盘、静默 Ban 网关 | ⏳ **待启动** | `pkg/server/`, `pkg/pages/` |
| **Phase 5** | **GUI 三态卡片与 CI 沙盒** | 三态徽章 (`🔒`/`⚠️`/`🔓`)、DRM 探活缓存、Mock DRM 测试套件 | ⏳ **待启动** | `desktop/gui/`, `cmd/` |

---

## 2. 分阶段任务清单与验收标准 (Actionable Task Checklist)

### Phase 1: WASM 密码学基础库与 HKDF 密钥派生引擎

* **阶段目标**：在浏览器非安全上下文（局域网 HTTP）下提供全速、安全、零拷贝的 XChaCha20-Poly1305 加解密与 HKDF 密钥派生底座。

- [x] **Task 1.1: 基础密码学引擎封装** (`pkg/pages/assets/crypto-engine.js` & `pkg/crypto/e2ee/e2ee.go`)
  - [x] 实现纯 JS / WASM 兼容的 RFC 8439 **XChaCha20-Poly1305** 与 BigInt 130-bit 高精度 Poly1305 验签引擎；
  - [x] 封装标准 **HKDF-SHA256 (RFC 5869)** 派生体系，从 `MasterKey` 派生 `K_send`, `K_recv`, `K_ws`, `K_auth`（Go 与 JS 互通向量 100% 吻合）；
  - [x] 封装 `wipe()` 显式内存物理清零。
- [x] **Task 1.2: 4MB 分块加解密 Web Worker 管道** (`pkg/pages/assets/crypto.worker.js`)
  - [x] 封装分块加解密纯函数：输入 `[PlaintextChunk, Nonce, Key, ChunkIndex]` $\rightarrow$ 输出 `[ChunkIndex(4B) | Nonce(24B) | Ciphertext | Tag(16B)]`；
  - [x] 主线程与 Worker 通信全面采用 `Transferable Objects`（`postMessage(buf, [buf])`）实现零内存拷贝；
  - [x] 显式生命周期管理：在传输完成、取消或页面卸载时触发 `worker.terminate()` 彻底回收内存；
  - [x] 终止前在 Worker 内部对密钥副本先执行 `wipe()` 物理清零，防 swap / 内存残留；
  - [x] 异常容错机制：捕获 `worker.onerror` 并支持 Worker 自动重新孵化（Auto-Respawn）与 3 次重试熔断防死锁。
- [x] **Task 1.3: 密码学单测与跨语言互通测试** (`pkg/crypto/e2ee/`)
  - [x] Go 单测与基准测试：`TestHKDFStandardVectors`、`TestChunkEncryptionDecryption`、`TestTamperedCiphertext`、`TestTamperedChunkIndexAAD`、`TestPacketEncryptionDecryption`；
  - [x] 跨语言互通测试：`TestCrossLanguageInterop`（Go 加密 $\rightarrow$ Node.js 解密，Node.js 加密 $\rightarrow$ Go 解密，100% 互通）；
  - [x] Go 4MB 单核加密吞吐达到 **1,278 MB/s**，解密吞吐 **1,150 MB/s**，全绿通过。

> **Phase 1 验收标准 (DoD)——恢复原版前端要求并逐项核查**：
> 1. ✅ Go 端与前端 JS 成功实现标准 XChaCha20-Poly1305 与 HKDF-SHA256 跨端互通（`TestCrossLanguageInterop` Go⇄Node 100% 通过）；
> 2. ✅ Go 4MB 单核加密 1,278 MB/s / 解密 1,150 MB/s，篡改 1 bit 密文或 AAD 均 100% 抛验签失败（Go 侧 `TestTamperedChunkIndexAAD`）；
> 3. ❌ **原 DoD「本地 HTTP 页面成功加载并初始化 libsodium WASM」未满足**——实现改为纯 JS BigInt 引擎，未引入 libsodium WASM；
> 4. ❌ **原 DoD「前端 4MB 分块单核加密吞吐 ≥ 60MB/s」未满足**——实测纯 JS 引擎仅 **9.2 MB/s（加密）/ 9.8 MB/s（解密）**（Node v24 桌面 V8，移动端 Safari/Chrome 预计更低），离 60MB/s 差约 6.5 倍、离 Phase 4 的 80~110MB/s 差约一个数量级；且 BigInt Poly1305（`(a+n)*r mod P`）**非恒定时间**，存在时序侧信道，与「防 Wi-Fi 嗅探」的卖点相悖 → 强制纳入 **Task 1.4 换回恒定时间 WASM 引擎**；
> 5. ⏳ Worker 内存稳定 ≤35MB / 任务结束 `terminate()` 无泄漏：待 Task 1.4 落地后复测。

- [ ] **Task 1.4: 前端引擎达标改造（恒定时间 WASM，阻断项）** (`pkg/pages/assets/`)
  - [ ] 将前端加解密引擎替换为**恒定时间**实现（首选 libsodium WASM，与架构 §4.3 / 意见 1 一致；SRI + Base64 内联或运行时 SHA-256 校验）——纯 JS BigInt Poly1305 实测仅 ~9 MB/s 且非恒定时间，既不满足原 DoD ≥60MB/s，也不满足 Phase 4 的 80~110MB/s；
  - [ ] 新增 JS 侧篡改向量测试：密文 / AAD / ChunkIndex 各翻转 1 bit 必须 100% 抛验签失败（当前篡改测试仅覆盖 Go 侧，JS 引擎缺少防伪向量验证）；
  - [ ] 复测 Worker 内存峰值 ≤35MB，任务结束 `terminate()` 后无泄漏；
  - [ ] 维持 HKDF / XChaCha20 互通向量 100% 吻合（Go ⇄ 新引擎回归）。

> **Task 1.4 退出标准**：前端 4MB 单核加密 ≥ 60MB/s（基准值；移动端现场实测不低于 30MB/s）、恒定时间实现、篡改 1 bit 100% 拒验、`go test ./...` 与互通测试全绿。

---

### Phase 2: DRM 会话密钥与生命周期端点

* **阶段目标**：在 Cloudflare Worker D1 上实现高并发、低延迟、单例覆盖重建与阅后即焚的盲中继密钥分发服务。

- [x] **Task 2.1: D1 数据库表结构与索引** (`cloudflare/eqt-drm-api/schema.sql`)
  - [x] 创建表 `e2ee_sessions`，包含字段 `(session_id, license_code, device_id, claim_token_hash, encrypted_master_key, k_auth_hash, expires_at, created_at)`；
  - [x] 创建唯一索引 `UNIQUE(device_id)` 与索引 `idx_e2ee_claim_token`、`idx_e2ee_expires`，支撑单例覆盖重建。
- [x] **Task 2.2: 会话创建端点** (`POST /api/v1/session/create`)
  - [x] 校验 Desktop 设备 License 授权与参数有效性；
  - [x] 执行 `INSERT ... ON CONFLICT(device_id) DO UPDATE` 原子作废旧会话并写入全新会话；
  - [x] 设置 10 分钟 TTL，后台惰性触发 `DELETE FROM e2ee_sessions WHERE expires_at < unixepoch()` 清理。
- [x] **Task 2.3: 会话领取端点** (`GET /api/v1/session/claim?token=...`)
  - [x] 接收移动端 Token 并计算 SHA-256 匹配 `claim_token_hash`；
  - [x] 领取前实时校验 `expires_at > unixepoch()`，过期会话严格返回 `410 Gone`；
  - [x] 下发 `encrypted_master_key` 与 `k_auth_hash`，响应头携带标准 CORS (`Access-Control-Allow-Origin: *`)。
- [x] **Task 2.4: 主动关闭与零日志隐私合规** (`POST /api/v1/session/close`)
  - [x] PC 退出或关闭会话时触发 `close`，校验凭据后物理删除会话记录（即刻 404）；
  - [x] 保持应用层 Zero-Telemetry，严禁记录任何明文私钥或文件载荷。
- [x] **Task 2.5: 健康探活端点** (`HEAD /health` & `GET /api/v1/session/health`)
  - [x] 返回 `200 OK` 状态 `healthy`，供桌面端后台 30s 探活使用。
- [ ] **Task 2.6: claim 主密钥解包与门禁补强（Phase 2 完成度核查）** (`cloudflare/eqt-drm-api/src/routes/session.ts`)
  - [ ] **claim 返回 `encrypted_master_key` 密文但全程无解包步骤**：手机端无法从响应中获得可用明文 MasterKey，密钥引导链路不完整——须服务端在 claim 时用 Worker 密钥环境变量解包后返回明文，或明确定义手机侧解包协议（当前实现二者皆缺，Phase 2 的 100% 完成度因此失真）；
  - [ ] `close` 凭据错误（`k_auth_hash` 不匹配）时 `DELETE` 影响 0 行却仍返回 `200 {ok:true}`——应检查 `meta.changes > 0` 并返回 404/403，否则「主动关闭已校验凭据」的 DoD 声明不成立；
  - [ ] `create` 的 license 门禁过弱：`lic.status === 'revoked'` 之外，license 不存在 / `suspended` 也放行——付费 E2EE 门禁应在服务端强制 `status = 'active'`（Phase 5 客户端开关未落地前，DRM 是唯一拦截面）；
  - [ ] 补充离线断言：非 active / 不存在 license 的 `create` → `403`。

> **Phase 2 验收标准 (DoD)**：
> 1. Cloudflare D1 本地 SQLite 模拟与 esbuild 离线自动化测试套件通过率 100%（23 个断言全绿）；
> 2. 单例覆盖（同一设备再次启动会话旧 Token 立即 404）已通过自动化验证；
> 3. PC 退出主动 close 物理删除已通过自动化验证。

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
  - [ ] 无锁并发 I/O 规范：`*os.File.WriteAt` 底层基于操作系统原生 `pwrite64` (Linux) / `WriteFile` (Windows) 保证线程安全，Go 服务端处理并发分块落盘时严禁套用全局写文件互斥锁，确保多 goroutine 磁盘吞吐最大化（前提：同一 `*os.File` 全程只走 `WriteAt` 定点写，严禁混用 `Write`/`Seek` 共享文件游标——锁自由仅对定点写成立；末块 `Truncate`/`Sync`/重命名须在全部并发写 goroutine 完成（通过 per-file 活跃写入计数器/`sync.WaitGroup` 安全 join）之后执行）；
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
| 2026-08-31 | `454d3a5` | Phase 1: 完成 XChaCha20-Poly1305 / HKDF 跨端引擎与 Worker 管道 | Task 1.1~1.3 | ⚠️ 核心完成（前端引擎不达标 → Task 1.4） |
| 2026-08-31 | `1491f98` | Phase 2: DRM 云端会话 D1 结构与单例覆盖生命周期端点 | Task 2.1~2.5 | ✅ 完成（Task 2.6 补强） |
| 待推进 | — | Phase 3: Chat 模式双向 WebSocket 与小附件 E2EE | Task 3.1~3.4 | ⏳ 待开始 |

---

## 4. 实施阶段准入准出与交付守则 (Engineering Guidelines)

1. **零回归原则 (Rule 13)**：修改 `pkg/server/` 或前端模板时，必须确保原有明文局域网传输与 `tus.min.js` 断点续传链路完全不受影响；
2. **零副作用提交**：日常提交保持快速（$<0.05$s），仅在需要部署 Windows 验收产物时使用 `EQT_DEPLOY_ON_COMMIT=1`；
3. **推送规范**：在 WSL 环境下推送到 GitHub 必须统一使用 `./scripts/git-push-smart.sh origin feat/e2ee`；
4. **进度同步**：每完成一个子任务，在本文档中更新对应 `[x]` 复选框并记录 Commit Hash，确保研发进度 100% 透明可控。

---

## 5. 实现偏差记录与架构同步清单 (Implementation Deltas vs Architecture v2)

以下为 Phase 1/2 实现与[架构基准文档](./20260901-e2ee-end-to-end-encryption-architecture.md) §5.2 契约的偏差。处置原则（Rule 7）：逐项裁决为「有意取舍 → 补架构文档」或「回归 → 修复」，不静默平均。

| # | 偏差项 | 架构设计 | 实际实现 | 处置 |
| :-- | :--- | :--- | :--- | :--- |
| D1 | 前端引擎 | libsodium WASM（§4.3 / 意见 1：恒定时间、近 C 性能） | 纯 JS BigInt Poly1305（实测 9.2 MB/s、非恒定时间） | **回归 → Task 1.4 换回恒定时间 WASM** |
| D2 | Session 端点路径 | `/api/v1/e2ee/session/*` | `/api/v1/session/*` | 有意简化 → 同步 `docs/admin/api-contract.md` / `docs/portal/api-contract.md` |
| D3 | Claim 流程 | POST + 设备实例 ID + `max_claims` 配额 | `GET ?token=` + `claim_token_hash`，无领取配额 | 有意简化（10min TTL 内 token 可被无限领取）→ 需在架构文档补风险标注 |
| D4 | 会话唯一性 | `UNIQUE(device_id, mode)`（一设备可并发 send / receive / chat 会话） | `UNIQUE(device_id)`（一设备仅 1 活跃会话；同机并发会覆盖旧 token → 404） | 需裁决：接受「1 PC 1 会话」并补架构文档，或补回 `mode` 列 |
| D5 | 主密钥存储 | 明文 `master_key` 列 | `encrypted_master_key`（at-rest 加密，**强于原设计**） | 保留为改进；解包流程见 Task 2.6 |
| D6 | 领取代验 | 依赖惰性 GC | `expires_at > unixepoch()` 实时校验，过期严格 `410 Gone` | 符合架构 ✅ |
| D7 | License 门禁 | 付费功能服务端强制拦截 | 仅拦截 `revoked`；license 不存在 / `suspended` 放行 | **回归 → Task 2.6 强制 `status='active'`** |
