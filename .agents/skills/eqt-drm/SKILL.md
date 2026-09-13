---
name: eqt-drm
description: Guides EQT licensing architecture, offline cryptographic activation verification, client hardware fingerprint matching, and Cloudflare Serverless D1 database deployment. Use when you need to: (1) Maintain client-side hardware fingerprint matching (3-of-2 model) and offline .lic validation, (2) Configure or debug Cloudflare D1/Worker DRM APIs and Ed25519 signature verification, (3) Manage Paddle billing webhooks, subscription auto-renew, and upgrades, (4) Handle license portal self-service refunds and unbind quotas, or (5) Run DRM offline automated test suites and verify quality gates.
---

# EQT 授权与反破解开发指南 (EQT Licensing DRM Master Guide)

本指南为 EQT 商业授权架构、离线数字证书防伪、客户端硬件指纹比对、云端 D1 容灾及反破解安全防线的主控作战手册。

---

## 1. 授权防线第一性原理 (Core Principles & Cryptographic SSOT)

### 1.1 客户端设备指纹比对防线 (3-of-2 Hardware Fingerprint)
- **3 选 2 加权比对**：比对主板 UUID、CPU 序列号、系统盘物理 SerialNumber。
- **空值防呆铁律**：若运行权限不足导致某特征为空字符串 `""`，**绝对不能**判定为“相等”，必须跳过。只有两边非空且完全相等才计入，至少 2 项有效非空指纹匹配才合法。
- **客户端激活前置守卫**：激活前检查当前提取到的非空硬件指纹数。若有效指纹项 < 2，直接友好拦截，防止占用服务端席位却无法通过本地 `VerifyFingerprint` 落盘。
- **服务端权威设备 ID 空值规范**：`GetAuthorityDeviceID()` 未分配时必须返回 `""`，严禁返回中文伪标识符污染服务端数据。

### 1.2 离线 `.lic` 数字证书单一可信源 (SSOT)
- **环境命名空间物理隔离**：生产读写 `license.lic`，测试构建（`//go:build eqtdev`）读写 `license-test.lic`，杜绝测试覆盖生产证书；分发安装包路径与下载页面完全物理隔离。
- **Ed25519 双重密码学防篡改**：
  - **主证书签名 (`Signature`)**：载荷为 `license_code|tier|uuid_hash|cpu_hash|disk_hash|expires_at|max_devices`；
  - **对账确认签名 (`VerifySignature`)**：云端私钥签发 `OK|license_code|uuid_hash|cpu_hash|disk_hash|last_online_sync_time`，防用户手动修改 `LastOnlineSyncTime` 绕过对账。
- **网络故障与授权状态严格正交划分 (Network vs Auth Orthogonality)**：
  - **断网/抖动/5xx 走 7 天离线租约**：网络不可达时**严禁**抹盘，无条件保留本地证书继续使用；
  - **明确 403/404 才执行 `ResetLicense()`**：只有云端明确返回 403（已吊销/退款）或 404（已删除/已解绑）时才擦除证书并降级为免费版。
  - **验签单一前置守卫**：`doOnlineLicenseSync` 前置校验签名，若不合法返回 `ErrInvalidLicenseSignature` 并分流至 `RegisterDeviceOnline()` 依托 3 选 2 指纹自愈，严禁带非法证书强请求云端导致误删。

### 1.3 极简单向时钟防回拨与网络时间防篡改
- 证书记录 `LastSeenLocalTime`（间隔 1 分钟更新原子落盘）。本地系统时间倒流超 10 分钟或与网络时间偏差超 10 分钟，立即判定 `ClockTampered=true` 并锁死高级功能（仅合法激活才可解除）。
- **Share/Receive 防规避**：任务启动时 `usedSeconds < 600` 允许传输完毕，不物理切断；下一次启动若 `>= 600` 且未付费，文件数 > 5 或单文件 > 50MB 严格拦截。

---

## 2. 云端架构与核心防御不变式 (Active Architecture & Invariants)

### 2.1 Cloudflare D1 瞬态超时容灾与指数退避重试
- **边缘存储超时挑战**：D1 底层操作偶发 `D1 DB storage operation exceeded timeout which caused object to be reset`（> 30s）。
- **透明代理包装 (`wrapD1WithRetry`)**：
  - 在 `src/index.ts` 入口对 `env.DB` 统一注入代理，对 `.prepare()`, `.all()`, `.run()`, `.batch()` 实施指数退避重试（最多 2 次重试，基准 150ms + jitter）；
  - **错误分类**：瞬态错误（超时、`sqlite_busy`、锁、连接重置）重试；约束错误（`UNIQUE`, `FOREIGN KEY`, `NOT NULL`, 语法错）立即 Fail-Fast；
  - **写操作幂等性约束**：写语句必须具备幂等性（`UPSERT`, `INSERT OR IGNORE`, `WHERE NOT EXISTS`），避免超时重试造成写污染。

### 2.2 资金流与履约 Fail-Loud 告警防线
- **核心履约绝不静默**：支付 Webhook、授权生成、激活码邮件、退款吊销等链路异常立即触发 Telegram 报警，未捕获异常升为 `CRITICAL`。
- **安全防炸准则**：Telegram 报错信息必须经 `escapeHtml()` 转义尖括号，敏感凭据（secret/token/key）自动打码，同类错误 10 分钟滑动窗口频控（最多 3 次）。

### 2.3 免费用户每日用量云端权威对账
- **两层防御**：本地 `chat_usage.json` 带 HMAC-SHA256 签名防篡改；云端 `free_daily_usage` 表原子累加并通过 `ED25519_PRIVATE_KEY` 对用量元数据签名。
- **客户端 Fail-Closed 校验**：客户端收到响应时，若签名为空或校验失败，强制丢弃响应，杜绝攻击者伪造响应清零用量。

### 2.4 兑换码生成工具 (License Code Generation)
- 使用 `./scripts/generate-license.sh` 快速生成兑换码并写入 D1（自动屏蔽 `CLOUDFLARE_API_TOKEN` 干扰），格式为 `EQT-TIER-YYYYMMDD-RANDOM-CHECK`。
- 带 `duration_days` 的激活码在首次激活时固化到期时间，后续对账严格继承，杜绝动态滚动续期。

---

## 3. 运维、测试与验收门禁 SOP (Verification & Quality Gate SOP)

### 3.1 一键执行全量离线回归验证
```bash
bash .agents/skills/eqt-drm/scripts/check-drm-offline.sh
```
- **通过标准**：
  1. Cloudflare Worker 端离线套件：`npm run test:offline` 20 套件 + 1 门禁全部通过；
  2. Go 端设备指纹与离线证书测试：`go test -count=1 ./pkg/server -run "Test.*License.*|Test.*Fingerprint.*"` 100% 通过。

### 3.2 测试环境隔离铁律 (Test Isolation)
- **安全不变式**：代码默认值恒为生产 `https://lic.eqt.net.im`；测试环境只能通过显式机制进入（wrangler `[env.test]` / Go `-tags eqtdev`）。
- **Wrangler 继承避坑**：`vars` / `d1_databases` 不继承；**`routes` 默认继承**，故测试环境必须显式 `routes = []` + `workers_dev = true`，且显式 `logpush = false`（测试无权限，避免 10023 部署报错）。
- **Go build tag 互斥成对声明**：`env_defaults.go`（`!eqtdev`）与 `env_defaults_dev.go`（`eqtdev`）必须成对声明，严禁孤儿无 tag 文件导致 redeclared 冲突。
- **发布顺序铁律**：**先配服务端 Secret 并部署 Worker → 再发布新版客户端**。避免客户端已开启 Fail-Closed 验签而服务端未配私钥导致拒签。

---

## 4. 深度技术参考导航 (References Navigation)

* **离线证书单一可信源 (SSOT) 与指纹防伪**: 参阅 [offline-license-ssot.md](references/offline-license-ssot.md)
  * *包含设备指纹 3 选 2 算法模型、Ed25519 签名与 VerifySignature、7 天离线租约、时钟防篡改、免费用量对账与 Share/Receive 限额拦截。*
* **Cloudflare Workers & D1 运维避坑与容灾告警**: 参阅 [cloudflare-workers-ops.md](references/cloudflare-workers-ops.md)
  * *包含环境变量 API Token 干扰规避、Secret 注入、测试环境 workers.dev 路由隔离大坑、D1 瞬态超时指数退避重试、资金流 Fail-Loud 告警防线。*
* **Paddle 支付履约、订阅续期与 0 元防呆**: 参阅 [paddle-billing-workflow.md](references/paddle-billing-workflow.md)
  * *包含 Webhook HMAC-SHA256 验签、年付→终身待生效升级、`scheduled_change` 自动续费双向同步、0 元订单退款屏蔽、兑换码生成管理。*
* **用户许可证自助门户、退款与生命周期规范**: 参阅 [license-portal-and-refund.md](references/license-portal-and-refund.md)
  * *包含无密码发信、Paddle Adjustments 退款细节、365 天滚轮解绑额度、渠道来源与环境解耦、沙箱 Beta 白名单约束、前后端契约规范。*
* **Admin 管理后台、审计留痕与 SPA 架构规范**: 参阅 [admin-management-and-audit.md](references/admin-management-and-audit.md)
  * *包含高危操作审计 D1 追溯、全球活跃设备 Live 视界、Cloudflare Access SPA 同源反代坑点、Dev 模式设备管理。*
* **匿名下载遥测、隐私保护与 R2 资产分发**: 参阅 [telemetry-and-r2-distribution.md](references/telemetry-and-r2-distribution.md)
  * *包含 R2 安装包分发加速、动态版本显示、TELEMETRY_SALT 零容忍拒写、3D 地球仪 SQLite 裸列特性与 90 天归档事务。*

