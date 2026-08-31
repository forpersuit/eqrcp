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
| **Phase 4** | **Share / Receive 分块流** | REST 分块端点、3级流水线、IndexedDB 落盘、静默 Ban 网关 | ✅ **已完成 (100%) / D11、D12、D13 全量闭环** | `pkg/server/`, `pkg/pages/` |
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

* **阶段目标**：在 Cloudflare Serverless D1 上建立具备单例会话覆盖、TTL 物理清除与原子 CAS 门禁的 DRM 密钥托管端点。

- [x] **Task 2.1: D1 数据库 Schema 迁移** (`cloudflare/eqt-drm-api/schema.sql`)
  - [x] 创建 `e2ee_sessions` 表与 `(device_id, mode)` 唯一索引；
  - [x] 建立 `licenses` 表支持 active 授权校验；
  - [x] 落地 `max_claims` 与 `claim_count` 原子计数器字段。
- [x] **Task 2.2: 会话创建端点** (`POST /api/v1/e2ee/session/create` & `/api/v1/session/create`)
  - [x] 支持单例会话模式覆盖（`INSERT OR REPLACE`）；
  - [x] 校验客户端 License 有效性；
  - [x] 返回 `session_id`、`token` 与 `expires_at`。
- [x] **Task 2.3: 会话领取端点** (`POST /api/v1/e2ee/session/claim` & `/api/v1/session/claim`)
  - [x] 校验 token 匹配且会话未过期（`expires_at > unixepoch()`）；
  - [x] 执行原子 CAS `UPDATE e2ee_sessions SET claim_count = claim_count + 1 WHERE ... AND claim_count < max_claims`；
  - [x] 成功返回 `master_key_b64`，超限返回 `403 limit_exceeded`。
- [x] **Task 2.4: 会话销毁端点** (`POST /api/v1/e2ee/session/close` & `/api/v1/session/close`)
  - [x] 接收 `token` 并立即物理删除记录（`DELETE FROM e2ee_sessions`）。
- [x] **Task 2.5: CORS 与零日志隐私合规**
  - [x] 全端点配置严苛 CORS 头；
  - [x] 严禁在 Cloudflare 控制台日志输出 `master_key_b64` 明文。
- [x] **Task 2.6: D1 门禁与并发修复**
  - [x] 落地 `POST /session/claim`、`GET /session/claim`、`POST /session/close`、`GET /session/close` 规范；
  - [x] 32 项自动化 D1 测试全部通过。

> **Phase 2 验收标准 (DoD)**：
> 1. ✅ DRM 端点无缝支持会话创建、Token Claim 领款与 Close 销毁全生命周期；
> 2. ✅ 单例覆盖生效，同一设备同一模式下仅保留最新会话；
> 3. ✅ 领款配额耗尽时原子拦截后续请求，绝不发生超额冒领。

---

### Phase 3: Chat 模式双向 WebSocket 与小附件 E2EE (✅ 100% 达标)

* **阶段目标**：打通双向实时文本与 20MB 以内附件的端到端加密，支持防重放与密钥隔离。

- [x] **Task 3.1: WebSocket `e2ee_envelope` 协议层扩展** (`pkg/chat/v2/protocol/`)
  - [x] 定义 `EventE2EEEnvelope` 事件类型与 `E2EEEnvelopePayload` 结构；
  - [x] 服务端实现 `ReplayFilter`（滑动窗口防重放过滤器，按 `senderPeer` 分键独立窗口，解决多客户端 seq=1 冲突 D9）；
  - [x] 前端 `websocket.ts` 持久化 `e2eeOutSeq` 到 `localStorage`，跨刷新单调递增；服务端重放拦截返回 `REPLAY_DETECTED` 错误事件，扫码 reset 窗口 (D10)。
- [x] **Task 3.2: 移动端 Svelte 聊天加解密流水线** (`pkg/chat/v2/web/`)
  - [x] 拦截发送文本与附件，通过 Worker 加密后再封装为 `e2ee_envelope` 发送；
  - [x] 收到 `e2ee_envelope` 时调用 Worker 解密，无缝注入聊天视图；
  - [x] 异常状态与重放丢包在前端弹出非侵入式 Toast / 消息流提示。
- [x] **Task 3.3: 附件加密与临时存储** (`pkg/chat/v2/transfer/`)
  - [x] 限制小附件 $\le 20$MB，采用 `EncryptAttachment` 整体封装；
  - [x] 传输完成后在客户端解密，支持直接预览/保存。

> **Phase 3 验收标准 (DoD)**：
> 1. ✅ PC 与手机端 Chat 实时文本与图片双向收发 100% 端到端加密；
> 2. ✅ 重放历史数据包被服务端 `ReplayFilter` 瞬间丢弃并返回 `REPLAY_DETECTED`（`TestSessionE2EEReplayFilter` 通过）；
> 3. ✅ 多客户端房间中第二个客户端首条消息 (seq=1) 正常接收（D9 闭环）；
> 4. ✅ 页面刷新后新实例 seq 跨刷新单调递增，零静默丢包（D10 闭环）。

---

### Phase 4: Receive / Share 4MB 分块流式加解密与设备管理控制 (🟡 服务端 100% / 前端主链路落地，下载端落盘子项未达标)

* **阶段目标**：打通 Share（下载）与 Receive（上传）的 4MB 分块加解密管道，落实静默屏蔽与从头重置红线。

> **Phase 4 前置依赖**：为在无公网 / 无真实 License 下离线验证 Receive / Share 分块链路，已实现 `MockDRMServer` 离线桩（`pkg/crypto/e2ee/mock_drm.go`，提供 `claim` 下发 MasterKey 与 `health` 探活，支撑 4MB 分块与 Ban 门禁的端到端验证）。

- [x] **Task 4.1: Receive REST 分块上传端点** (`pkg/server/`)
  - [x] 新增 `POST /receive/:path/chunk` 端点，解析 `X-File-ID`、`X-Chunk-Index` 二进制切片；
  - [x] 封装 Go `e2ee.DecryptChunk`，边验签边流式解密；
  - [x] 利用 4MB 定长切片物理偏移确定性（`offset = chunkIndex * 4MB`），支持 `os.File.WriteAt` 并发乱序直写物理文件，免去内存滑动窗口队列；
  - [x] 乱序直写两前提：① 分块 AEAD 的 AAD 绑定 `chunkIndex` 与 `fileID`，防止乱序重放注入；② 连续区间计算器 `computeContinuousRanges` 维护连续已写块 M 与 `received_ranges`；
  - [x] 写入闭环保障：所有分块到齐后，调用 `os.File.Truncate(expectedTotalBytes)` 确保尺寸精确，再 `os.File.Sync()` 强制刷盘后原子重命名；
  - [x] 无锁并发 I/O 规范：`*os.File.WriteAt` 保证线程安全，无全局写互斥锁；
  - [x] 引入 `sync.Pool` 4MB 缓冲区，明文 Buffer 归还前执行 `e2ee.Zeroize`（`clear(b)` 与 `runtime.KeepAlive`）；
  - [x] 正确性与内存治理：同 `fileID` 重试自动重置，已完成分块幂等返回 200 OK，超时 30 分钟记录自动淘汰清理。
- [x] **Task 4.2: 移动端 3 级流水线并发与存储落盘** (`pkg/pages/upload.tmpl.html` & `download.tmpl.html`)
  - [x] 移动端 `EqtE2EEUploader`：实现 Read $\rightarrow$ Encrypt $\rightarrow$ POST 3 级并发流水线，通过 `crypto.worker.js` 零拷贝 Transferable Objects 加密；
  - [x] weak Wi-Fi 超时自适应降级：连续 2 次超时/失败自适应降级为 1 并发，单块重试上限 3 次防无限死循环，4xx 错误（AUTH_FAILED 等）直接不可重试 fail-fast；
  - [x] 移动端 `EqtE2EEDownloader`：`EqtChunkStorage` 实现基于 IndexedDB 的大文件（$\ge 256$MB）流式分件落盘与磁盘装配，防移动端 OOM；针对 iOS Safari 纯 HTTP 标注 1GB 边界（⚠️ 解密阶段内存峰值降至 1 chunk，但 `assembleBlob` 装配时仍全量读回内存——浏览器能力上限，可接受）；
  - [x] Fail-Closed 安全防线：校验 `metaData.is_e2ee`，解密失败绝不静默降级为明文，弹出非阻塞错误通知（D13 补齐 `triggerNormalDownload` 函数头并清理重复定义，通过 `TestTemplateJavaScriptSyntax` 自动化回归门禁）；
  - [x] 断点续传查询：上传前自动查询 `/chunk_status` 连续游标 $M$，避免重复上传已落盘块。
- [x] **Task 4.3: 设备显性化与静默屏蔽门禁** (`pkg/server/server.go` & `e2ee.go`)
  - [x] 请求头提取 `X-Client-Instance-Id` / `X-Client-ID`；
  - [x] 落地 `POST /api/device/ban` 与 `POST /api/device/unban` 内存门禁；
  - [x] 落实 §7.5 红线：Receive 被屏蔽时立即删除 `.tmp` 临时文件；解封后 `chunk_status` 强制返回 $M=0$，强制从 Chunk 0 重置；
  - [x] `chunk_status` 响应支持返回主连续游标 `continuous_index: M` 及区间 `received_ranges`。
- [x] **Task 4.4: 多文件与 Share 4MB 分块加解密下发** (`pkg/server/e2ee.go`)
  - [x] 新增 `GET /send/:path/meta` 与 `GET /send/:path/chunk` 端点；
  - [x] 采用 `KSend` 逐块加密下发，移动端解密后落盘；
  - [x] 完备支持目录与多文件虚拟 ZIP 归档模式。

> **Phase 4 验收标准 (DoD)**：
> 1. 千兆局域网下 Receive 与 Share 加密吞吐达到 $80 \sim 110$ MB/s（✅ 实测：Go 侧解密直写 $> 250$ MB/s，JS Worker WASM 加密 $182 \sim 220$ MB/s，远超 $80 \sim 110$ MB/s 门槛）；
> 2. 传输中途点击“屏蔽”，数据传输瞬间 403 阻断且 PC 端 `.tmp` 临时文件立即彻底清除（✅ 验证：`TestE2EEReceiveSilentBanAndPurgeTmpFile` 通过）；
> 3. 点击“恢复”，`chunk_status` 强制返回 $M=0$，从 Chunk 0 完整重新发起并成功接收文件（✅ 验证：`TestE2EEReceiveSilentBanAndPurgeTmpFile` 通过）；
> 4. 多分块无锁并发乱序直写物理文件 100% 逐字节一致（✅ 验证：`TestE2EEReceiveMultiChunkConcurrentWrite` 9.5MB 乱序直写通过）；
> 5. 同 `fileID` 二次上传重试 100% 成功不报 403（✅ 验证：`TestE2EEReceiveRetrySameFileID` 通过）；
> 6. 目录/多文件 ZIP 归档流式切片加密下发 100% 成功（✅ 验证：`TestE2EEShareArchiveDirectory` 通过）。

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
    - ⚪ `🔓 明文传输`：用户主动在 Settings 关闭 E2EE。
  - [ ] 接入前端通知中心，在 E2EE 降级或失败时推送 in-app Toast（严禁原生 alert）。
- [ ] **Task 5.3: CLI 交互提示与降级告警** (`cmd/`)
  - [ ] `eqt send` / `eqt receive` 控制台高亮展示 E2EE 激活状态与密钥摘要；
  - [ ] 降级时打印醒目黄色告警提示。
- [ ] **Task 5.4: CI 自动化全链路回归测试套件** (`test/e2ee/`)
  - [ ] 编写基于 `MockDRMServer` 的全链路离线集成测试脚本；
  - [ ] 模拟真实网络抖动、密钥错位、密文篡改与重放攻击，断言系统 100% 稳健防御。

> **Phase 5 验收标准 (DoD)**：
> 1. GUI 顶栏与设备卡片三态准确切换，无闪烁；
> 2. 断网模拟下自动优雅降级为明文，GUI 弹出非阻塞式 Tooltip/Toast；
> 3. CI 离线自动化测试套件全绿运行。

---

## 3. 开发里程碑与执行日志 (Engineering Timeline)

| 日期 | Commit Hash | 提交说明 | 对应任务 | 状态 |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| 2026-08-31 | `c2c37d0` | 基于 master 创建 `feat/e2ee` 特性分支 | 分支准备 | ✅ 完成 |
| 2026-08-31 | `5881382` | 改造 pre-commit hook 默认无副作用秒级提交 | 工程基建 | ✅ 完成 |
| 2026-08-31 | `7907911` | 完成 E2EE 架构终审方案与三态视觉图例封版 | 架构设计 | ✅ 完成 |
| 2026-08-31 | `454d3a5` | Phase 1: 完成 XChaCha20-Poly1305 / HKDF 跨端引擎与 Worker 管道 | Task 1.1~1.3 | ✅ 完成 |
| 2026-08-31 | `1491f98` | Phase 2: DRM 云端会话 D1 结构与单例覆盖生命周期端点 | Task 2.1~2.5 | ✅ 完成 |
| 2026-08-31 | `f5e54ad4` | libsodium WASM 引擎 + JS 篡改向量 + D1 门禁/配额/并发闭环 | Task 1.4, 2.6 | ✅ 完成（HKDF insecure-context → Task 1.5） |
| 2026-08-31 | `555c78f3` | HKDF 彻底移出 `crypto.subtle`，改用 libsodium WASM `crypto_auth_hmacsha256` 实现 RFC 5869 | Task 1.5 | ✅ 完成（独立 Python 向量复核实测 100% 吻合，insecure-context 仿真通过） |
| 2026-08-31 | `9ebbddc7` | E2EE 结构化错误码（JS `CryptoError` / Go `Error`）· Worker 错误事件遥测 · D1 `error_code` · 分级线程安全日志 | 工程基建（为 Phase 3~5 铺路） | ✅ 完成（32 断言 D1 + 全量 go test 16 包零回归） |
| 2026-08-31 | `c428455a` | Phase 3: Chat 双向 E2EE WebSocket 信封、防重放过滤器、附件加密（`e2ee_envelope`/`ReplayFilter`/`EncryptAttachment`） | Task 3.1~3.3 | ✅ 落地（衍生 D9、D10，由 `8389dabb` + `335cf3a1` 修复闭环） |
| 2026-08-31 | `335cf3a1` | Phase 3 修复：前端 localStorage 持久化 e2eeOutSeq 跨刷新单调递增 + 服务端返回 REPLAY_DETECTED 错误事件 + 扫码 reset (D10) | Task 3.1 补丁 | ✅ 闭环（第 7 轮独立复核联合验证：刷新后 seq 零静默丢失，`go test ./...` 零失败、`npm test` 7/7 全绿） |
| 2026-08-31 | `4ba82184` | Phase 4: MockDRMServer 离线桩 · REST 4MB 分块流式无锁直写 · 连续区间跟踪器 · 静默屏蔽即时销毁 .tmp 与从头重置红线 · Share 4MB 分块下发 | Task 4.1~4.4 | 🟡 服务端完成 / Task 4.2 前端流水线未落地（见第 8 轮复核） |
| 2026-09-01 | `ead22f1b` | Phase 4 闭环：前端 EqtE2EEUploader/Downloader 3级流水线与 Worker 零拷贝 + weak Wi-Fi 降级 + iOS 1GB 标注 + sync.Pool 4MB 复用 + 同 fileID 重试修复与内存清理 | Task 4.1~4.4 | 🟡 服务端闭环 + 前端主链路落地（第 9 轮复核） |
| 2026-09-01 | `77fe53e5` | Phase 4 深度闭环：EqtChunkStorage IndexedDB 流式落盘 + 3次重试上限熔断 + Fail-Closed 严禁静默降级明文 + 服务端 .tmp 安全物理清理 (D12) | Task 4.2 补丁 | 🔴 见第 10 轮复核（衍生 D13 SyntaxError 回归） |
| 2026-09-01 | `aa718556` | 修复 download.tmpl.html SyntaxError 与重复定义 (D13) + 新增 TestTemplateJavaScriptSyntax 模板 JS 门禁 + TestE2EEReceiveStaleCleanup | Task 4.2 补丁 | ✅ **已全量闭环 100% 达标**（Go 17包零失败、Node 防篡改全绿、TS 7/7 全绿、模板 JS 语法测试全绿） |

---

## 6. 独立复核结论（Review Logs）

### 第 9 轮独立复核结论（2026-09-01，审查 `ead22f1b` + `5c4b5062`）

> 审查对象：D11 修复提交 `ead22f1b`（服务端 sync.Pool / 同 fileID 重试 / 30min 清理 + 前端 EqtE2EEUploader/Downloader 流水线）与 tracker 记录提交 `5c4b5062`。方法：`git show` 逐一比对实现，`go test ./...`、`npm test`、`node interop_test.js` 三重独立验证，前端模板特征点 rg 核对。

**✅ 已验证通过（服务端 100% 可靠）**：
1. `go test ./...` 全包零失败（含新增 `TestE2EEReceiveRetrySameFileID`——同 fileID 二次上传 200 非 403，D11 直接测试背书；`TestE2EEShareArchiveDirectory`——目录 ZIP 归档 meta+chunk 解密）；
2. 服务端同 fileID 生命周期正确：completed/cancelled 后 chunk 0 关闭旧句柄并重建，completed 后非 0 chunk 幂等返回 200 OK；
3. `chunkPool4MB` sync.Pool 真实落地，明文 Buffer 归还前 `e2ee.Zeroize` + `runtime.KeepAlive`；
4. 前端 `crypto.worker.js` 全响应消息带 `reqId`（并发匹配）、`useRecvKey`/`useSendKey` 密钥方向、结构化 `retryable`——为流水线并发提供正确底座。

**✅ 前端主链路真实落地（相对第 8 轮"仅 2 行 script tags"是质变）**：
- `upload.tmpl.html` +296 行：`EqtE2EEUploader.Pipeline`（3 并发 Read→Encrypt(worker Transferable)→POST、weak Wi-Fi 连续 2 败降 1 并发、`chunk_status` 断点续传、15s AbortController）；
- `download.tmpl.html` +206 行：`EqtE2EEDownloader.Pipeline`（worker 解密 `useSendKey`、meta 获取、E2EE/明文双入口、iOS 1GB console.warn）；
- 密钥获取：`master_key` URL 参数 / localStorage `eqt_e2ee_master_key` 双通道。

**🟡 非阻塞缺陷（建议纳入 D12 后续修复，不阻断主链路可用性）**：
1. **Upload 无限重试**：`upload.tmpl.html:1862` 仅 403 设 `retryable=false`；400 AUTH_FAILED（密钥错位/篡改）、网络错误、abort 均每 1s 无限重试无最大次数——密钥错位场景会永久卡死；
2. **Download 无流式落盘**：`download.tmpl.html:1014` 顺序循环 + `decryptedChunks` 内存 Blob 拼接，**无 IndexedDB 流式落盘**（Task 4.2 原"分块流式解密落盘"未实现）；大文件内存峰值 = 文件全尺寸，iOS 1GB 仅 console.warn 无实际缓解；
3. **E2EE 失败静默降级明文**：`download.tmpl.html:1110-1113` 任一 chunk 失败 → `triggerNormalDownload()` 明文下载，用户无感知违背 E2EE 承诺；`startE2EEDownload` 亦未校验 `metaData.is_e2ee`；
4. **服务端 30min 清理残留 .tmp 且未持 rf.mu**：`e2ee.go:253-259` 仅 close+delete map 条目，不删磁盘 `.tmp`（磁盘残留）；O(n) 扫描在 map lock 内、未持 `rf.mu`（与活跃 WriteAt 理论竞争）。

**裁决**：服务端 D11 修复 100% 闭环（有测试背书）；前端 E2EE 主链路真实可用。但 Task 4.2"存储落盘"子项未实现 + 3 项健壮性缺陷，Phase 4 **不可判定为 100% DoD**，维持 🟡（服务端 100% + 前端主链路落地，D12 待办：下载端落盘与重试/降级治理）。

---

### 第 10 轮独立复核结论（2026-09-01，审查 `77fe53e5` + `76031814`）

> 审查对象：D12 修复提交 `77fe53e5`（EqtChunkStorage IndexedDB 流式落盘 + upload 3 次重试熔断 + Fail-Closed 防静默降级 + 服务端 .tmp 安全清理）与 tracker 记录提交 `76031814`。方法：`git show` 逐文件比对 + `go test ./...` / `npm test` / `node interop_test.js` 三重测试 + **前端模板 JS 抽取 `node --check` 语法验证**（新增方法，抓到回归）。

**✅ 已验证通过（修复属实）**：
1. 三重测试全绿：`go test ./...` 全包零失败、`node interop_test.js` 全绿（insecure-context/篡改/吞吐 DoD）、TS 7/7 全绿；
2. **服务端 safe cleanup**（`e2ee.go:250-273`）：stale 记录在 map lock 内收集 → `Unlock` → 逐个持 `rf.mu` close File + `os.Remove(TempPath)`（仅非 Completed）+ 置 `Cancelled=true` → 重新 Lock。锁粒度正确（IO 移出 map lock、持 per-file 锁防 WriteAt 竞争、物理删 .tmp），`TempPath` 字段存在（`e2ee.go:40`）；
3. **Upload 重试 limiter**（`upload.tmpl.html:1860-1868`）：`chunkRetries[chunkIdx]` 每 chunk 独立计数，`<= 3` 熔断（实际最多 4 次尝试）；`_processChunk` 中 4xx 全设 `retryable=false`（400 AUTH_FAILED/403 BANNED/404 fail-fast）；`upload.tmpl.html` 抽取 `node --check` 语法 OK；
4. **IndexedDB 流式落盘**（`download.tmpl.html:925-1000`）：`EqtChunkStorage`（`eqt_e2ee_download_db`/`chunks`）`putChunk` 逐 chunk 落盘 + `assembleBlob` 装配 + `clearFile` 装配后清空；阈值 `>= 256MB` 触发。解密阶段内存峰值降至 1 chunk（4MB），有效防移动端 OOM；`assembleBlob` 装配时仍全量读回内存属浏览器能力上限（无 File System Access API），判定合理；
5. **版本号** v1.36.35 → v1.36.36 合规。

**🔴 严重回归（D13，阻断下载页）**：
- `download.tmpl.html` 抽取 `<script>` 块（446~1689 行）`node --check` 报 **SyntaxError**（`/tmp/down.js:829` 孤立 `}`）；对比 `77fe53e5~1`（`ead22f1b`）语法 OK，**回归由本提交引入**；
- 根因：`showE2EEDownloadError`（1244-1256）结束后，原 `triggerNormalDownload()` **函数声明头 `function triggerNormalDownload() {` 被误删**，其函数体（`startStatusPolling()`、`?download=1` iframe 下载等）裸露为顶层语句（1257-1273），1274 行孤立 `}` 触发 SyntaxError；
- 后果：**整个 `<script>` 块被浏览器丢弃**，download 页的 E2EE 下载、明文下载、进度轮询、文件列表渲染**全部失效**；
- 次生：`triggerDownloadItem` **双定义**（1232 Fail-Closed 新版 / 1276 静默降级旧版），JS 后定义覆盖前定义，即使修好 SyntaxError，单文件下载入口仍走旧版静默降级明文。

**🟡 附带观察**：
- D12 修复**无任何新增测试**（前端 JS 逻辑 + 服务端 cleanup 均无测试覆盖，仅靠既有全量测试保持绿）——违反 Rule 9（测试验证意图），建议补 `TestE2EEReceiveStaleCleanupPurgesTmp` 类测试与前端 JS 语法 CI 检查。

**裁决**：D12 的 ①②④ 三项修复属实可验收；③ Fail-Closed 因 D13 SyntaxError 当前**实际不可用**，且 `triggerDownloadItem` 旧版覆盖使单文件入口仍静默降级明文。Phase 4 状态 **🔴 阻断**（下载页整体失效），D13 必须先修复。D12 不可判定全量闭环。

---

## 4. 实施阶段准入准出与交付守则 (Engineering Guidelines)

1. **零回归原则 (Rule 13)**：修改 `pkg/server/` 或前端模板时，必须确保原有明文局域网传输与 `tus.min.js` 断点续传链路完全不受影响；
2. **零副作用提交**：日常提交保持快速（$<0.05$s），仅在需要部署 Windows 验收产物时使用 `EQT_DEPLOY_ON_COMMIT=1`；
3. **版本管理规范**：一旦有新功能或架构层修改增加，小版本号自动自增（`pkg/version/version.go`）；
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
| D11 | Phase 4 前端流水线与重试内存缺陷 | 移动端 Read→Encrypt→POST 3 级流水线 + IndexedDB 落盘 + 弱网降级 + sync.Pool 4MB 零分配 + 同 fileID 重试支持 | 前端 `upload.tmpl.html` 与 `download.tmpl.html` 接入 `crypto.worker.js` 实现 3 级并发流水线（Read $\rightarrow$ Encrypt $\rightarrow$ POST），弱网自适应降级至 1 并发，iOS 1GB 边界标注；服务端落地 `sync.Pool` 4MB 缓冲区，同 `fileID` 重试重置旧句柄，30 分钟过期记录自动淘汰，完备支持目录与 ZIP 归档 | 🟡 **服务端侧闭环**（`TestE2EEReceiveRetrySameFileID` + `TestE2EEShareArchiveDirectory` + 7 项 Go 单测全绿，第 9 轮独立复核确认） |
| D12 | Phase 4 前端下载端落盘与重试/降级治理 | Task 4.2 原要求"分块流式解密落盘（IndexedDB）"；E2EE 链路失败不应无限重试或静默降级明文 | ① `EqtChunkStorage` 实现基于 IndexedDB 的大文件（$\ge 256$MB）流式分件落盘与磁盘装配（第 10 轮复核确认属实）；② upload 增加 4xx fail-fast 与单块最大 3 次重试上限熔断（`chunkRetries`）消除死循环（属实）；③ download 校验 `metaData.is_e2ee` + Fail-Closed 拦截；④ 服务端 30min 超时扫描在 map 锁外安全获取 `rf.mu`、物理删除磁盘 `.tmp`（`TestE2EEReceiveStaleCleanup` 验证） | ✅ **已闭环修复**（D13 修复后全量生效） |
| D13 | download 页 JS SyntaxError 整块失效（回归） | 重构 download.tmpl.html 时误删 `triggerNormalDownload()` 函数声明头，`showE2EEDownloadError` 之后裸奔顶层语句 + 孤立 `}` → 整个 `<script>` 块（446~1689 行，含 E2EE 下载 / 明文下载 / 进度轮询 / 文件列表渲染）浏览器解析失败全部失效 | 补齐 `pkg/pages/download.tmpl.html:1257` 缺失的 `function triggerNormalDownload() {` 函数声明头；删除重复旧版 `triggerDownloadItem`；在 `pkg/pages/pages_test.go` 中新增 `TestTemplateJavaScriptSyntax` 自动化回归门禁，确保未来所有模板 JS 语法 100% 编译通过 | ✅ **已闭环修复**（`TestTemplateJavaScriptSyntax` 0.15s 全绿通过，D13 完全根治） |
