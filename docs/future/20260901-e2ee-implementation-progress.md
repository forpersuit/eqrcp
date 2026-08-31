# EQT E2EE 端到端加密工程落地与进度监控看板 (Implementation Progress Tracker)

> **文档性质**：E2EE 特性开发实施主控看板（可执行、可监控、可追溯）  
> **制定日期**：2026-08-31  
> **目标分支**：`feat/e2ee`  
> **关联架构基准文档**：[20260901-e2ee-end-to-end-encryption-architecture.md](./20260901-e2ee-end-to-end-encryption-architecture.md)

---

## 1. 里程碑总体进度看板 (Milestone Status)

| 阶段 (Phase) | 阶段名称 | 核心目标与交付件 | 状态 (Status) | 责任模块 |
| :--- | :--- | :--- | :---: | :--- |
| **Phase 1** | **WASM 密码学引擎** | `libsodium.js` (WASM Sumo) / HKDF 派生、4MB 分块 AEAD Worker、Go/JS 互通 | ✅ **已完成 (100%)** | `pkg/pages/assets/`, `pkg/crypto/e2ee/` |
| **Phase 2** | **DRM 云端会话端点** | D1 表结构、多模式单例覆盖、TTL 物理销毁、CAS 配额门禁、零日志 CORS | ✅ **已完成 (100%)** | `cloudflare/eqt-drm-api/` |
| **Phase 3** | **Chat 模式双向 E2EE** | WebSocket `e2ee_envelope`、Seq 防重放、Svelte 端加解密 | ✅ **已完成 (100%) / D9、D10 blocker 全量闭环** | `pkg/chat/v2/` |
| **Phase 4** | **Share / Receive 分块流** | REST 分块端点、3级流水线、IndexedDB 落盘、静默 Ban 网关 | ⏳ **待启动** | `pkg/server/`, `pkg/pages/` |
| **Phase 5** | **GUI 三态卡片与 CI 沙盒** | 三态徽章 (`🔒`/`⚠️`/`🔓`)、DRM 探活缓存、Mock DRM 测试套件 | ⏳ **待启动** | `desktop/gui/`, `cmd/` |

---

## 2. 分阶段任务清单与验收标准 (Actionable Task Checklist)

### Phase 1: WASM 密码学基础库与 HKDF 密钥派生引擎

* **阶段目标**：在浏览器非安全上下文（局域网 HTTP）下提供全速、安全、零拷贝的 XChaCha20-Poly1305 加解密与 HKDF 密钥派生底座。

- [x] **Task 1.1: 基础密码学引擎封装** (`pkg/pages/assets/crypto-engine.js` & `pkg/crypto/e2ee/e2ee.go`)
  - [x] 引入基于标准 WebAssembly 编译的 **libsodium WASM (RFC 8439 XChaCha20-Poly1305)** 恒定时间密码学引擎；
  - [x] 封装标准 **HKDF-SHA256 (RFC 5869)** 派生体系，从 `MasterKey` 派生 `K_send`, `K_recv`, `K_ws`, `K_auth`（Go 与 JS 互通向量 100% 吻合）；
  - [x] 封装 `wipe()` 显式内存物理清零（`sodium.memzero`）。
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
- [x] **Task 1.4: 前端引擎达标改造与恒定时间 WASM 落地** (`pkg/pages/assets/`)
  - [x] 替换为独立打包的 **libsodium WASM 运行时** (`pkg/pages/assets/libsodium.js`)，消除 BigInt 非恒定时间时序侧信道风险；
  - [x] 前端 4MB 单核分块实测性能：**加密吞吐 182.4 MB/s / 解密吞吐 260.9 MB/s**（555c78f3 复核 `interop_test.js` 实测），远超 DoD $\ge 60$MB/s 标准；
  - [x] 完备的 JS 侧篡改向量测试 (`interop_test.js`)：密文篡改 1 bit、Tag 篡改 1 bit、ChunkIndex 错位、FileID AAD 错位、密钥错位 100% 拒验；
  - [x] Worker 生命周期物理清零与异常熔断机制全面验证通过。
- [x] **Task 1.5: HKDF 彻底移出 `crypto.subtle`（消除 Insecure-Context 陷阱）** (`pkg/pages/assets/crypto-engine.js`)
  - [x] 将 HKDF Extract 与 Expand 彻底重构为基于 **libsodium WASM 原生 `crypto_auth_hmacsha256`** 实现，完全解耦 `crypto.subtle`；
  - [x] 100% 恒定时间、零侧信道，在局域网纯 HTTP（`http://192.168.x.x`）非安全上下文下完美运行；
  - [x] 在 `interop_test.js` 中增加 `global.crypto.subtle = undefined` 仿真测试，验证非安全环境下 HKDF 初始化与分块加解密 100% 成功。

> **Phase 1 验收标准 (DoD)**：
> 1. ✅ 本地 HTTP 页面加载 libsodium WASM 成功（wasm 内嵌于 `libsodium.js`，无外部 `.wasm` 依赖）；本机实测 4MB 单核**加密 182.4 MB/s / 解密 260.9 MB/s**（555c78f3 复核实测，≥60MB/s DoD 达标）；
> 2. ✅ Go 端与前端 JS 跨端互通 100% 吻合（`TestCrossLanguageInterop` 100% PASS）；
> 3. ✅ 篡改 1 bit 密文、Tag 或 AAD 均 100% 抛出验签失败异常（JS 侧 `interop_test.js` 篡改向量全过）；
> 4. ✅ **Insecure-Context 局域网 HTTP 兼容性 100% 达标**：在 `crypto.subtle = undefined` 环境下无缝初始化并完成全流程加解密（Task 1.5 闭环）。

---

### Phase 2: DRM 会话密钥与生命周期端点

* **阶段目标**：在 Cloudflare Worker D1 上实现高并发、低延迟、单例覆盖重建与阅后即焚的盲中继密钥分发服务。

- [x] **Task 2.1: D1 数据库表结构与索引** (`cloudflare/eqt-drm-api/schema.sql`)
  - [x] 创建表 `e2ee_sessions`，包含字段 `(session_id, license_code, device_id, mode, master_key_b64, close_token_hash, k_auth_hash, claim_count, max_claims, status, expires_at, created_at)`；
  - [x] 创建唯一索引 `UNIQUE(device_id, mode)`（D4: 同一 PC 可并发 send/receive/chat 会话不冲突）与 `idx_e2ee_expires`。
- [x] **Task 2.2: 会话创建端点** (`POST /api/v1/e2ee/session/create`)
  - [x] 严格 Fail-Closed 校验 License 状态（必须存在且 `status = 'active'` 且未过期，拦截 non-existent, suspended, revoked, expired）；
  - [x] 执行 `INSERT ... ON CONFLICT(device_id, mode) DO UPDATE` 原子作废同模式旧会话并重置 10 分钟 TTL；
  - [x] 设置 `max_claims`（默认 5 台）与 `master_key_b64` 盲中继载荷，后台异步执行惰性 GC 清理。
- [x] **Task 2.3: 会话领取端点** (`POST /api/v1/e2ee/session/:id/claim` & `GET /api/v1/session/claim`)
  - [x] 原子 CAS 递增 `claim_count`（`claim_count < max_claims AND expires_at > unixepoch() AND status = 'active'`）；
  - [x] 超限精准拦截：配额耗尽返回 `403 limit_exceeded`，会话过期返回 `410 expired`，未找到返回 `404`；
  - [x] 基于 TLS 1.3 HTTPS 安全信道透明盲中继返回 `master_key_b64` 与 `k_auth_hash`，手机端零中介直接解码投入 WASM 引擎。
- [x] **Task 2.4: 主动关闭与确定性状态校验** (`POST /api/v1/e2ee/session/close`)
  - [x] 校验 `close_token` 或 `k_auth_hash` 凭据，物理删除指定会话；
  - [x] 凭据错误或会话不存在时根据 `changes === 0` 严格返回 404（杜绝假成功）；
  - [x] 保持应用层 Zero-Telemetry，严禁记录任何明文私钥或文件载荷。
- [x] **Task 2.5: 健康探活端点** (`HEAD /health` & `GET /api/v1/e2ee/session/health`)
  - [x] 返回 `200 OK` 状态 `healthy`，供桌面端后台 30s 极速探活。
- [x] **Task 2.6: 门禁与协议补强闭环** (`cloudflare/eqt-drm-api/`)
  - [x] 明确 TLS 1.3 盲中继规范，手机端直接解 Base64 初始化 libsodium WASM；
  - [x] `close` 凭据校验严格检查 `changes > 0`，消除假成功；
  - [x] 离线自动化测试套件涵盖全量 27 项断言（含 Fail-Closed License 校验、CAS Quota 耗尽、Multi-Mode 并发等）。

> **Phase 2 验收标准 (DoD)**：
> 1. ✅ Cloudflare D1 本地 SQLite 离线自动化测试套件通过率 100%（27 个断言全绿）；
> 2. ✅ 多模式单例覆盖与并发隔离（`(device_id, mode)`）验证通过；
> 3. ✅ 严格 Fail-Closed License 门禁与确定性 Close 物理删除验证通过。

---

#### Phase 3: Chat 模式双向 WebSocket 与剪贴板 E2EE (✅ 100% 达标 / D9、D10 blocker 全量闭环)

* **阶段目标**：在局域网 Chat 模式下实现消息、剪贴板与附件的端到端透明加解密。

- [x] **Task 3.1: 协议封装与防重放机制** (`pkg/chat/v2/protocol/`)
  - [x] 定义 `e2ee_envelope` 结构体：`{ seq, timestamp, nonce, ciphertext, tag }`；
  - [x] 将 `seq || timestamp` (16 字节 BigEndian) 强绑定至 AEAD 附加认证数据 (AAD)；
  - [x] 接收端建立 128 位滑动窗口校验器 (`ReplayFilter`)，按 `senderPeer` 分键隔离独立窗口，拦截乱序、时间戳偏差 (>30s) 与重放密文帧（修复 D9 blocker）；
  - [x] **闭环 D10**：前端 `e2eeOutSeq` 持久化至 `localStorage`（`eqt_e2ee_seq_${token}_${peer}`），页面刷新/重入房间无缝自增；服务端在重放拦截时返回 `REPLAY_DETECTED` 错误事件，客户端自适应前向校准；`isNewScan` 扫码建立连接时服务端原子重置 peer 窗口。
- [x] **Task 3.2: 文本与剪贴板加解密集成**
  - [x] Go 服务端实现盲中继转发 (`sess.HandleE2EEEnvelope` & `sess.BroadcastRaw`)，不解密密文帧；
  - [x] Svelte 前端在 Web Worker 中对输入文本/剪贴板透明加密后发送 (`ENCRYPT_E2EE_ENVELOPE`)；
  - [x] 接收端 Svelte 前端解密后渲染进 UI，解密失败时展示“⚠️ 解密失败”而非崩溃。
- [x] **Task 3.3: 附件分级传输管道**
  - [x] 小附件 ($\le 20$MB)：前端单块加密，直接 POST 至 `/upload`（单块封包复用 `[Nonce(24B) | Ciphertext | Tag(16B)]` 信封，无 4MB 分块头 `ChunkIndex`，与分块格式严格区分，Go 侧与 JS 侧均提供 `EncryptAttachment`/`DecryptAttachment`）；
  - [x] 大附件 ($> 20$MB)：复用 4MB 分块流式加密管道，与 Phase 4 统一对接。

> **Phase 3 验收标准 (DoD)**：
> 1. Wireshark 抓包局域网 WebSocket 数据帧，全量显示为高熵随机密文（✅ 验证：全量传输 `e2ee_envelope` 容器，载荷为 Base64 密文）；
> 2. 聊天消息、图片与剪贴板同步正常展示，时延增加 $< 5$ms（✅ 验证：单帧加密/解密耗时 $\le 0.15$ms）；
> 3. 多客户端并发聊天各拥有独立 `seq` 空间，同房间多设备 `seq=1` 零碰撞无误判（✅ 验证：`TestSessionE2EEMultiClientIndependentSeq` 与 `TestWebSocketE2EEEnvelopeBlindRelayAndAntiReplay` 全绿通过）；
> 4. 页面刷新/重入房间 seq 跨生命周期单调自增，零静默丢包（✅ 验证：`TestSessionE2EEReconnectAndNewScanReset` + TS `e2eeEnvelope.test.ts` 全绿通过）。

> **第 5 轮独立复核结论（`c428455a`，2026-08-31）**：
> - ✅ Go↔JS 信封 AAD（`BuildPacketAAD` vs `_makePacketAAD`，`[uint64_be(seq)|int64_be(ts)]` 16B）逐字节一致；附件信封 `[Nonce(24B)|Ct+Tag(16B)]`、AAD=`fileID` 两端一致；
> - ✅ 附件真实跨语言互通双向通过（临时验证：Go Encrypt(kSend)→JS Decrypt、JS Encrypt(kRecv)→Go Decrypt，100% 还原）；
> - ✅ `node interop_test.js` 全绿（新增 §8 附件、§9 E2EEEnvelope，吞吐 206.2/279.1 MB/s）；前端 7 项 TS 测试全绿；
> - ✅ **D9 blocker 已闭环修复**：Go 服务端 `Session` 将 `ReplayFilter` 改为并发安全的 `peerReplayFilters map[string]*ReplayFilter`，按 `senderPeer` 建立独立滑动窗口，多客户端并发 `seq=1` 零误判，单客户端重放探测仍然 100% 精准拦截（8389dabb）。

> **第 6 轮独立复核结论（`8389dabb`，2026-08-31）**：
> - ✅ **D9 修复独立验证通过**：`peerReplayFilters` 按 `senderPeer` 分键，`TestSessionE2EEMultiClientIndependentSeq` 全绿；
> - 🔴 **新发现 D10 blocker（当时未修复）**：前端 `e2eeOutSeq` 仅存于实例级，页面刷新后新实例 seq 重置 → 被会话级持久窗口误判重放静默丢弃（`reconnect_seq_verify_test.go` 复现：instance #2 seq 1..10 全被拒）。**仅给出两套修复方案，未实现**；
> - ⚠️ 因此当时 **Phase 3 暂不能判定 100% 达标**。

> **第 7 轮独立复核与闭环结论（`335cf3a1`，2026-08-31）**：
> - ✅ **D10 修复独立验证通过（方案 A localStorage 持久化落地）**：
>   - 前端 `e2eeOutSeq` 持久化至 `localStorage`（键名 `eqt_e2ee_seq_${token}_${peer}`），构造函数从 `savedSeq + 1` 恢复，`getNextE2EESeq()` 用 `Math.max(current+1, memSeq)` 单调自增；
>   - 服务端重放拦截时返回 `REPLAY_DETECTED` 错误事件，前端收到后 `+=1000` 前向校准并在 UI 提示重试（盲中继只读 seq/timestamp 不解密，AEAD 在接收端验证）；
>   - `isNewScan` 扫码注册时服务端按 peer 原子删除窗口（`Register` + `client.IsNewScan`）；
>   - **联合验证零静默丢失**：临时 `d10_cross_refresh_test.go` 将前端 seq 计数器 × 服务端 `ReplayFilter` 串起来，模拟刷新后新实例 seq 11..20 全部 accepted（验后即删）；`go test ./...` 零失败、`npm test` 7/7 全绿；
>   - Phase 3 判定 **100% 达标**。

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
- [ ] **Task 5.4: 本地离线 Mock DRM 与全自动化测试沙盒** (`pkg/server/`)
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
| :--- | :--- | :--- | :--- | :--- | :---: |
| 2026-08-31 | `c2c37d0` | 基于 master 创建 `feat/e2ee` 特性分支 | 分支准备 | ✅ 完成 |
| 2026-08-31 | `5881382` | 改造 pre-commit hook 默认无副作用秒级提交 | 工程基建 | ✅ 完成 |
| 2026-08-31 | `7907911` | 完成 E2EE 架构终审方案与三态视觉图例封版 | 架构设计 | ✅ 完成 |
| 2026-08-31 | `454d3a5` | Phase 1: 完成 XChaCha20-Poly1305 / HKDF 跨端引擎与 Worker 管道 | Task 1.1~1.3 | ✅ 完成 |
| 2026-08-31 | `1491f98` | Phase 2: DRM 云端会话 D1 结构与单例覆盖生命周期端点 | Task 2.1~2.5 | ✅ 完成 |
| 2026-08-31 | `f5e54ad4` | libsodium WASM 引擎 + JS 篡改向量 + D1 门禁/配额/并发闭环 | Task 1.4, 2.6 | ✅ 完成（HKDF insecure-context → Task 1.5） |
| 2026-08-31 | `555c78f3` | HKDF 彻底移出 `crypto.subtle`，改用 libsodium WASM `crypto_auth_hmacsha256` 实现 RFC 5869 | Task 1.5 | ✅ 完成（独立 Python 向量复核实测 100% 吻合，insecure-context 仿真通过） |
| 2026-08-31 | `9ebbddc7` | E2EE 结构化错误码（JS `CryptoError` / Go `Error`）· Worker 错误事件遥测 · D1 `error_code` · 分级线程安全日志 | 工程基建（为 Phase 3~5 铺路） | ✅ 完成（32 断言 D1 + 全量 go test 16 包零回归） |
| 2026-08-31 | `c428455a` | Phase 3: Chat 双向 E2EE WebSocket 信封、防重放过滤器、附件加密（`e2ee_envelope`/`ReplayFilter`/`EncryptAttachment`） | Task 3.1~3.3 | ✅ 落地（衍生 D9、D10，由 `8389dabb` + `335cf3a1` 修复闭环） |
| 2026-08-31 | `8389dabb` | Phase 3 修复：ReplayFilter 按 `senderPeer` 分键建立独立滑动窗口，解决多客户端 seq=1 冲突 (D9) | Task 3.1 补丁 | ✅ 闭环（独立复核验证通过） |
| 2026-08-31 | `335cf3a1` | Phase 3 修复：前端 localStorage 持久化 e2eeOutSeq 跨刷新单调递增 + 服务端返回 REPLAY_DETECTED 错误事件 + 扫码 reset (D10) | Task 3.1 补丁 | ✅ 闭环（第 7 轮独立复核联合验证：刷新后 seq 零静默丢失，`go test ./...` 零失败、`npm test` 7/7 全绿） |

---

## 4. 实施阶段准入准出与交付守则 (Engineering Guidelines)

1. **零回归原则 (Rule 13)**：修改 `pkg/server/` 或前端模板时，必须确保原有明文局域网传输与 `tus.min.js` 断点续传链路完全不受影响；
2. **零副作用提交**：日常提交保持快速（$<0.05$s），仅在需要部署 Windows 验收产物时使用 `EQT_DEPLOY_ON_COMMIT=1`；
3. **推送规范**：在 WSL 环境下推送到 GitHub 必须统一使用 `./scripts/git-push-smart.sh origin feat/e2ee`；
4. **进度同步**：每完成一个子任务，在本文档中更新对应 `[x]` 复选框并记录 Commit Hash，确保研发进度 100% 透明可控。

---

## 5. 实现偏差记录与处置决议清单 (Resolved Deltas vs Architecture v2)

| # | 偏差项 | 架构设计 | 最终落地实现 | 裁决与状态 |
| :-- | :--- | :--- | :--- | :--- |
| D1 | 前端引擎 | libsodium WASM（恒定时间、近 C 性能） | 打包独立 `libsodium.js` (WASM)，多轮实测加密 177~197 MB/s / 解密 233~278 MB/s（`interop_test.js` 基准，随负载波动） | ✅ 达标修复 (Task 1.4)；衍生 D8 |
| D8 | HKDF 派生 | WASM 内恒定时间实现（不依赖 WebCrypto） | 修复 AEAD 时改用 `crypto.subtle.deriveBits` 派生子密钥，insecure-context（LAN HTTP）下 `crypto.subtle` 为 `undefined`，`init()` 实测抛 TypeError | **✅ 已闭环 → Task 1.5 移出 `crypto.subtle`（libsodium `crypto_auth_hmacsha256` 实现 RFC 5869），555c78f3 独立向量复核实测通过** |
| D2 | Session 端点路径 | `/api/v1/e2ee/session/*` | 同时兼容 `/api/v1/e2ee/session/*` 与 `/api/v1/session/*` | ✅ 双向兼容 |
| D3 | Claim 流程 | `max_claims` 领取配额与 CAS 递增 | 原子 CAS `claim_count < max_claims`，超限精准返回 `403 limit_exceeded` | ✅ 达标修复 (Task 2.6) |
| D4 | 会话唯一性 | `UNIQUE(device_id, mode)` | 表结构与索引为 `UNIQUE(device_id, mode)`，同 PC 并发多模式完全隔离 | ✅ 达标修复 (Task 2.6) |
| D5 | 主密钥存储 | TLS 1.3 盲中继传输 | `master_key_b64` 经 TLS 1.3 直达移动端，手机端原生 WASM 直接初始化 | ✅ 达标闭环 (Task 2.6) |
| D6 | 领取代验 | 实时过期校验 | `expires_at > unixepoch()` 实时校验，过期严格 `410 Gone` | ✅ 达标通过 |
| D7 | License 门禁 | 服务端强制拦截非 active 授权 | 严格校验 `licenses` 表 `status='active'` 且未过期，拦截 non-existent/revoked/suspended/expired | ✅ 达标修复 (Task 2.6) |
| D9 | Chat seq 防重放空间 | 每个发送者独立 seq 空间与防重放窗口 | `ReplayFilter` 改为 Session 内按 `senderPeer` 分键的并发安全 map 结构；多客户端各自独立从 seq=1 递增，房间内多设备零冲突误判 | ✅ **已闭环修复**（8389dabb，`TestSessionE2EEMultiClientIndependentSeq` + transport 端到端验证通过） |
| D10 | 同 peer 刷新 seq 重置 | seq 空间跨实例稳定（刷新/重连后新实例不应被旧窗口误拒） | 前端 `e2eeOutSeq` 持久化到 `localStorage`（键名 `eqt_e2ee_seq_${token}_${peer}`），页面刷新/重入房间后自动从 `savedSeq + 1` 恢复并单调递增；服务端在重放拦截时返回 `REPLAY_DETECTED` 错误事件，客户端自适应前向校准；`isNewScan` 扫码建立连接时服务端原子重置 peer 窗口 | ✅ **已闭环修复**（335cf3a1，`TestSessionE2EEReconnectAndNewScanReset` + TS `e2eeEnvelope.test.ts` 全绿） |


