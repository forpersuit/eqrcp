---
name: eqt-lan-tls
description: Architectural guidelines, disaster recovery, authoritative DNS operation, and ACME DNS-01 wildcard TLS provisioning for EQT LAN-TLS Loopback. Use when Codex needs to: (1) Configure, debug, or deploy authoritative DNS nodes (ns1/ns2) and systemd services, (2) Manage ACME wildcard certificates (*.direct.eqt.net.im) and GTS/Let's Encrypt multi-account failover, (3) Maintain Cloudflare Worker DRM/provisioning APIs (D1 rate limits, SingleFlight, 3-state circuit breaker, 2PC leasing), (4) Audit TLS crypto signatures, hardware fingerprint binding, or CSR verification, or (5) Run offline automated test suites and verify quality gates.
---

# EQT LAN-TLS 回环架构与安全运维主控指南 (LAN-TLS Master Guide)

本指南为 EQT 局域网传输安全（LAN-TLS 回环解析、单机私钥自生成、云端通配符与设备专属证书置备、双机权威 DNS 灾备与多层防护）的总领主控导航。

---

## 1. 核心架构第一性原理 (Core Principles & Philosophy)

- **Tailscale 路线 (Zero-Leak)**: 私钥本地 ECDSA P-256 自生成，永不出机。云端仅对 PKCS#10 CSR 验签并代理 ACME DNS-01 签发，杜绝中心化私钥泄露。
- **公信通配符证书与回环解析**: 权威 DNS 将 `*.direct.eqt.net.im` 与 `<node-id>.direct.eqt.net.im` 通过双机 NS 委派直接解析到内网私有 IP（`192.168.x.x` / `10.x.x.x` / `127.0.0.1`），无公网中继。
- **Mozilla PSL 官方合规收录**: `direct.eqt.net.im` 收录于 Mozilla Public Suffix List PRIVATE section，权威节点常驻 `_psl` TXT 记录，杜绝跨设备 Cookie/Origin 渗透。
- **Fail-Soft 优雅降级**: 证书临期或异常时平滑退回标准 HTTP 传输，保障物理局域网传输永不中断。

---

## 2. 现役五层生产防御架构与核心不变式 (Active 5-Layer Defense & Invariants)

### 2.1 Layer 1: SingleFlight 内存态并发去重 (In-Memory Request Coalescing)
- **机制**: Worker 内存态 `SingleFlight<T>`，对同一 `node_id` 或 CA 置备请求合并飞行任务。
- **不变式**: 仅作用于同一 isolate 实例内；跨 POP/跨 isolate 由底层 D1 保证强一致。

### 2.2 Layer 2: D1 2PC CAS 两阶段记账模型 (2-Phase Commitment & Leasing)
- **阶段一 (Reserve Lease)**: `UPDATE rate_limits SET count = count + 1, lease_expires_at = ? WHERE key = ? AND count < limit` 原子 CAS 抢占租约（超时默认 180s）。
- **阶段二 (Commit / Release)**:
  - 成功时 Commit（消除租约，写实计数）；
  - 失败时 Release（带 `WHERE lease_expires_at = ?` 严格守卫回滚，严禁无守卫清零干扰新窗口）。
- **可逆自愈 (Sweep)**: 超时未释放的孤儿租约自动被后续请求 CAS 冲正回收。

### 2.3 Layer 3: 内存令牌桶限流 (Token Bucket Rate Limiter)
- **参数**: 容量 5，填充速率受控。
- **不变式**: 桶满时并发请求由单次 CAS 扣减，严禁反向突发放大。

### 2.4 Layer 4: 三态断路器 (3-State Circuit Breaker)
- **状态转移**: `CLOSED` (正常) -> `OPEN` (熔断冷却 300s) -> `HALF_OPEN` (半开单探针) -> `CLOSED`。
- **单探针闸门 (Single Probe Gate)**: `OPEN -> HALF_OPEN` 状态变更仅允许由 CAS 抢占单枚 180s 租约的请求作为探针；其余并发一律快速失败（503）。
- **仅计服务侧故障**: 严格仅统计 CA 端 5xx、超时及真实 429 速率限制；客户端 4xx/400 业务错误严禁计入 failure_count 污染熔断状态。

### 2.5 Layer 5: 双机权威 DNS 高可用与 ACME 容灾 (DNS & ACME High Availability)
- **双节点委派**: `ns1.eqt.net.im` (Ubuntu 53) 与 `ns2.eqt.net.im` (Ubuntu 53)，RFC 1035 双 NS 冗余，HTTP 管理端口强锁 `127.0.0.1:5380`。
- **ACME 账户三地冷备**: 生产豁免账户私钥严格同步至 ns1、ns2 与离线运维机（权限 0400）。

> ### ⚠️ 第 43 轮审查方更正（对上方 §2.2 / §2.4 的机制描述 · 2026-09-14 · 基线 `v1.36.129`）
>
> **上方 §2.2 与 §2.4 有三处机制描述与实现不符，不得作为规格源使用（详见 `review-history.md` 第三十一轮 / bugs 文档 §二十三 R43-1）。追加式更正，原文保留不改（红线【155】）。**
>
> 1. **§2.2 的 `lease_expires_at` 租约模型不存在**：「`UPDATE rate_limits SET count = count + 1, lease_expires_at = ? WHERE …`」「超时默认 180s 租约」「孤儿租约 Sweep 冲正回收」三者**均为虚构** —— `rg -n 'lease_expires_at' cloudflare/eqt-drm-api/schema.sql cloudflare/eqt-drm-api/src/` **零命中**。真实现：`schema.sql:65-69` 的 `rate_limits` 只有 `key / count / window_start`；`src/utils/rate-limit.ts:250-257` 为单语句 `INSERT INTO rate_limits … ON CONFLICT(key) DO UPDATE SET count = CASE … END`，**无租约列、无 180s 记账租约、无 Sweep 回收器**。（180s 是**断路器探针租约**，在 `src/utils/circuit-breaker.ts:68-71`，与限流记账无关 —— 勿跨节挪借。）
> 2. **§2.4 的「熔断冷却 300s」无出处**：`rg -n '300' src/utils/circuit-breaker.ts` **零命中**；真实退避为 **90s**（上游 429 的 `Retry-After`）/ **30s**（上游 5xx 连续失败）。
> 3. **§2.4 的「快速失败（503）」状态码错误**：熔断开路拒绝为 **429** + `reason_key='ca_circuit_open'`（`src/routes/cert.ts:959`，`tests/cert-provision-offline.js` `T21.3d` 断言）；`rg -n 'status: 503' src/routes/cert.ts` **零命中**。
>
> **阶段三实现须以 `rate-limit.ts` / `circuit-breaker.ts` 源码与 `schema.sql` 为唯一规格源，不得引用 §2.2 / §2.4 的机制描述。**
>
> 另：§3.2 第 3 步原引「红线【48】」为**悬空引用**（本库编号域为 ①~㊿ 与【51】~【159】，不存在【48】），审查方已就地修正为 **㊽**（`references/red-lines-ledger.md:153`）。

---

## 3. 质量门禁与离线全套自动化验证 SOP (Verification & Quality Gate SOP)

在修改任何 LAN-TLS 核心逻辑（Go 端 `pkg/cert`、Worker 端 `cert.ts`、`circuit-breaker.ts`、`rate-limit.ts`）后，必须执行以下验收流程：

### 3.1 一键执行全量离线回归
```bash
bash .agents/skills/eqt-lan-tls/scripts/check-tls-offline.sh
```
- **通过标准**:
  1. Cloudflare Worker 离线测试：20 个测试套件 + 1 个 typecheck 门禁全部通过（633 passed assertions，0 failed）；
  2. Go 端 `pkg/cert` 单元测试：`go test -count=1 ./pkg/cert/...` 100% 通过。

### 3.2 审查与防退化核查四步法 (The 4-Step Verification Method)
1. **反向探针自证判别力 (红线【157】)**: 凡声称修复缺陷的测试断言，必须先还原缺陷验证测试能否翻红，杜绝夹具伪装的“假通过”。
2. **写语句与真实表结构反查 (红线【68】【157】)**: 凡涉及 D1 数据库操作，必须逐列与 `schema.sql` 对齐，反查真实的 `UPDATE/INSERT` 写语句而非仅看读语句。
3. **孤儿产物枚举 (红线㊽ ／ 原引【48】)**: 任何删除、收紧或变更身份的改动，必须枚举并处理磁盘存量证书、既有绑定与孤儿行的迁移或兼容。
4. **恒真校验识别 (红线【72】)**: 严禁将来自请求体自身公钥的自签名当作身份防线；身份必须依赖服务端 D1 持久化的绑定锚点。

---

## 4. 核心排坑与工程红线摘要 (Key Engineering Traps)

- **Windows GUI 日志句柄安全**: 在 `-H=windowsgui` 进程中 `os.Stderr` 为非法句柄，禁止直接使用 `io.MultiWriter(os.Stderr, ...)`，必须使用容错的 `safeMultiWriter` 防止文件日志全盘丢失。
- **WebView2 代理穿透**: Windows 本地开启 Clash 等系统代理时，必须追加 `--proxy-bypass-list` 排除 `*.direct.eqt.net.im;*.lan.eqt.im`，杜绝 WebView2 挂起。
- **Safari 附件下载沙箱**: HTTPS 下附件下载严禁返回 `Cache-Control: no-cache/no-store`，必须使用 `Cache-Control: private, no-transform` 并移除 `Pragma`，否则 WebKit 直接中断下载。
- **Fail-Soft 绝不吞没可观测性**: 离线降级时必须保留完整的结构化错误审计日志，严禁静默忽略底层失败。

---

## 5. 深度技术与审查参考导航 (References Navigation)

* **权威 DNS 双机部署、ACME 容灾与系统集成**: 参阅 [authoritative-dns-ha.md](references/authoritative-dns-ha.md)
  * *包含 ns1/ns2 节点 IP、Systemd 守护配置、Let's Encrypt 账户三地容灾、WebView2/移动端代理穿透。*
* **159 条审查红线与工程方法论总账本**: 参阅 [red-lines-ledger.md](references/red-lines-ledger.md)
  * *完整收录 ①~㊿ 及 【51】~【159】全部审查红线、触发场景、反例与不可逆操作判据。（第 43 轮后为【51】~【162】）*
* **历史审查、落地复核与实测闭环全景**: 参阅 [review-history.md](references/review-history.md)
  * *完整记录第 1 轮至第 30 轮（对应外部第 42 轮）独立复核留痕、代码 diff 评审与锚点回读。*
* **WebKit / Safari HTTPS 下载与媒体安全规范**: 参阅 [webkit-safari-attachment.md](references/webkit-safari-attachment.md)
  * *包含 WebKit 沙箱下载限制、MIME 嗅探防范、CSP Sandbox 隔离与被动加载零 Job 解耦。*
