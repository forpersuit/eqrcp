---
name: eqt-drm
description: Guides EQT licensing architecture, offline cryptographic activation verification, and Cloudflare Serverless D1 database deployment.
---

# EQT 授权与反破解开发指南 (EQT Licensing DRM Skill)

本技能指南面向 AI 开发助手，指导如何维护和修改 EQT 的 DRM 授权、反破解方案，以及管理 Cloudflare 后端接口。

---

## 1. 客户端设备指纹比对规范 (Client Hardware Fingerprint)

- **第一性原理防线**：在进行 **3选2 加权设备指纹校验**（主板 UUID、CPU 序列号、系统盘物理 SerialNumber）时，必须注意空值的校验回避：
  - 若运行权限原因导致某项硬件特征提取返回空字符串 `""`，此字段**绝对不能**在比对时判定为“相等”，必须直接跳过。
  - 只有两边非空且完全相等时，匹配项才能计入。
  - 至少有 2 项有效的非空指纹相匹配，才允许判定设备合法。
- **测试覆盖**：确保针对 Windows 和 Linux 的测试覆盖，并运行 [license_test.go](file:///home/yelon/develop/me/eqrcp/pkg/server/license_test.go) 中的加权模型边界案例。

---

## 2. 离线 `.lic` 数字证书单一可信源 (SSOT) 与时钟防篡改

- **单一可信源 (SSOT)**：`license.lic` 数字证书缓存为全局授权、对账及防时钟回拨的**唯一可信源 (SSOT)**。
- **Ed25519 签名与双重密码学保护**：
  - **主证书签名 (`Signature`)**：签名载荷必须与 Workers 生成时严格对称（`license_code|tier|uuid_hash|cpu_hash|disk_hash|expires_at|max_devices`）。
  - **对账确认签名 (`VerifySignature`)**：云端通过 `/api/v1/verify` 接口使用私钥签发带有服务器最新时间的对账载荷（`OK|license_code|uuid_hash|cpu_hash|disk_hash|last_online_sync_time`）。
  - **抗手动修改机制**：为防止用户本地用文本编辑器手动修改 `.lic` 里的对账时间 `LastOnlineSyncTime`，客户端每次校验必须使用内置公钥校验 `VerifySignature` 对应的载荷合法性。任何非云端私钥签发的修改均会在微秒级被识破并降级。
- **静默对账与 7 天租约宽限**：
  - 应用拉起时（通过 `hardware.go` 后台线程）先做 `VerifyLocalLicense()`，若本地存在 `.lic`，**强制**执行一次 `ForceOnlineLicenseSync()`（忽略 12 小时节流）。在线状态是吊销/Portal 解绑的权威来源（SSOT）；仅当网络失败时才回退到离线 7 天租约。
  - 后续后台静默对账仍走 `StartOnlineLicenseSync()` / `doOnlineLicenseSync(false)`，保留 12 小时最低间隔，避免频繁网络交互。
  - About 面板标题旁「刷新」按钮调用 `RefreshLicenseStatus()`：优先在线强制对账，失败再 `VerifyLocalLicense()` 离线校验。Dev「在线对账」同样走 `ForceOnlineLicenseSync()`。
  - 对账网络超时失败不影响使用。客户端支持 7 天内静默免网脱机运行：`time.Now() - LastOnlineSyncTime <= 7 * 24 * time.Hour`。若超时则自动强行降级。
  - 对账返回 403/404（授权被吊销或设备解绑）则立即执行 `ResetLicense()` 擦除证书并降级为 Unpaid 免费版。
  - `VerifyLocalLicense()` 任意失败路径（含无 `.lic` 文件）必须 `SetPaidStatus(false)`，防止内存付费态与磁盘不一致。
  - 前端 `localStorage` 仅缓存 UI 元数据（如 redeemedAt 展示），**禁止**在启动时用 localStorage 向 Go 端 `SetPaidStatus(true)` 抢权。
- **极简单向时钟防回拨与网络时间防篡改**：
  - 证书内元数据字段 `LastSeenLocalTime` 记录最后一次运行时间。每次成功校验后（若距离上次写入超过 1 分钟，以减少磁盘 IO），客户端自动更新并原子性落盘。
  - 本地校验时，若判定当前系统时间倒流（`time.Now() < LastSeenLocalTime - 10 minutes`），立刻判定为篡改并调用 `SetClockTampered(true)` 降级并永久锁死高级付费功能。
  - **联网配额与防篡改对齐**：未激活免费版用户在脱机断网状态下只提供基础 Free 传输功能（不授予每日 10 分钟高级限额全功能）；在线状态下系统自动通过 `getNetworkTimeOrStartFetch()` 获取准确网络时间 Date 标头。若检测到本地系统时间与网络时间偏差超过 10 分钟，自动判定为 `ClockTampered` 并锁死。
  - **废弃暗记清理**：保持 `.lic` 作为离线授权唯一可信源 (SSOT)，不再引入额外的私有暗记文件。
- **测试兼容模式**：单元测试或 mock 状态下（`os.Getenv("EQT_TESTING") == "true"`），若本地无 `.lic`，自动降级到传统模式支持模拟付费判定，在测试环境中自动豁免 7 天租约及防时钟回拨强制检查，以免破坏 CI。
- **Share/Receive 模式防规避与防呆拦截机制**：
  - **无物理时限中断**：为保障用户体验连贯性，在 10 分钟（600秒）限额内，若某次传输任务启动时 `usedSeconds < 600`，本次传输允许无限制传输完毕，不得强行调用 `signalStop()` 在中途物理切断。
  - **下一次任务额度拦截**：下一次新任务启动时，若 `usedSeconds >= 600` 且未付费：
    - **桌面端 Share 启动拦截**：`Share()` API 启动时，递归检查待分享文件总路径。若文件个数超过 5 个或单个文件大于 50MB，直接返回 error 阻断服务启动。
    - **移动端上传拦截**：在 POST `/receive/...` 请求入口处锁死 `quotaExceededAtStart`。若其为 `true`：在 Multipart 循环中，若已写入文件达到 5 个时拒绝后续接收并报错 403 阻断；在 Chunk 级文件写入 IO 循环中，若单个文件写入累计超过 50MB（52,428,800 字节），强行关闭文件、报错 413 退出并触发 `signalStop()`。

---

## 3. Cloudflare D1 & Workers 运维避坑与调试

### 3.1 环境变量 API Token 干扰
Wrangler CLI 会优先读取终端环境变量的 `CLOUDFLARE_API_TOKEN`，如其失效或权限（如读取 `memberships`）不足，会报 D1/Worker 拒绝访问。
- **规避手段**：在命令前手动强行清除此变量环境，强制让 Wrangler 使用本地登录凭据或依赖显式传入的凭据：
  ```bash
  CLOUDFLARE_API_TOKEN="" npx wrangler ...
  ```

### 3.2 交互式 Secret 注入
在 Cloudflare Worker 中通过管道无交互写入敏感凭据的语法：
```sh
echo -n "your_secret_value" | npx wrangler secret put KEY_NAME
```
若目标 Worker "eqt-drm-api" 尚未激活或创建，Wrangler 会自动在非交互上下文中选择同意并建立同名 Worker 挂载秘钥。

### 3.3 Cloudflare R2 存储与 CI/CD 资产分发 (R2 Storage & Asset Sync)
为了确保私有仓库下的 EQT 客户端可以被公共下载与顺利执行自动更新：
- **GitHub Secrets 密钥依赖**：必须在 GitHub 仓库中配置以下凭据供 `.github/workflows/release.yml` 自动上传编译产物到 Cloudflare R2 存储桶：
  - `CF_ACCOUNT_ID`: Cloudflare 账户 ID。
  - `R2_BUCKET_NAME`: 分发安装包的 R2 存储桶名。
  - `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`: 用于 S3 兼容上传的 R2 访问密钥对。
- **自动更新链接重定向**：在云端 `eqt-drm-api` Worker 环境变量中配置 `R2_PUBLIC_URL`（如 `https://pub.eqt.net.im`）。
  - 配置后 `/api/v1/update/check` 返回的 `download_url` 将被自动改写为 R2 的加速直链。
  - 若未配置，则回退使用 GitHub Releases 直链。
- **静态网页直链**：产品介绍页面（`cloudflare/eqt-website/index.html`）使用指向 R2 存储桶的公共直链，免受 GitHub 私有库 404 限制及免去 Worker CPU 超时影响。
- **分发下载域名接管模式**：为规避 Pages master 全量部署对 `downloads/` 目录的覆盖及 Pages 25MB 单文件上限，`download.eqt.net.im` 解析已合并路由到 `eqt-drm-api` Worker 下：
  - **R2 自动化上传**：大文件二进制与签名资产在 GitHub Actions `release.yml` 阶段通过 `wrangler r2 object put` 自动化同步发布到 R2 存储桶。
  - **动态官网版本显示**：官网页面 `index.html` 采用异步 fetch 获取 `/update-metadata.json` 中的最新版本号并动态渲染到下载按钮中。
  - **302 重定向**：Worker 拦截 `download.eqt.net.im` 流量：
    - 将 `/update-metadata.json` 解析并生成带一分钟边缘缓存的动态 JSON（支持 CORS）。
    - 将 `/downloads/:version/:filename` 动态 302 重定向到配置的 R2 存储加速域名，若无 R2 环境变量则回退重定向到 GitHub Releases。

### 3.4 结账前邮箱强制验证与统一多语言邮件模板
- **发信凭据绝对隔离**：SMTP 凭证保存在 Cloudflare Worker 后端，前端仅发起请求。
- **统一多语言发信模版 (SSOT)**：Worker 中维护 `CHECKOUT_EMAIL_I18N` 字典。前端发送 `POST /api/v1/checkout/send-code` 时附带 `lang`。未知语言静默降级（Fallback）到 `en` 英文模板。
- **结账邮箱自动填充与锁定**：前端弹窗完成 `POST /api/v1/checkout/verify-code` 校验后，透传已被验证的 `verifiedEmail` 并锁定 Paddle 收银台邮箱不可修改：`Paddle.Checkout.open({ items: [...], customer: { email: verifiedEmail }, settings: { allowLogout: false } })`。

### 3.5 全量 DRM & Admin API E2E 自动化测试套件
- **测试路径**：
  - 用户侧 DRM 流程测试：`cloudflare/eqt-drm-api/tests/e2e-drm-test.js` (`npm run test:e2e`)
  - 管理端 Admin 契约测试：`cloudflare/eqt-drm-api/tests/e2e-admin-test.js` (`npm run test:admin`)
- **Admin 测试覆盖**：鉴权 fail-closed 拦截、Health 探针、手动发码 `POST /admin/generate`、检索 `GET /admin/licenses`、解绑 `POST /admin/unbind`、吊销 `POST /admin/revoke`、日志清理 `DELETE /admin/error-logs`、高危操作审计查询 `GET /admin/audit-logs`。

### 3.6 管理后台 (Admin) 操作审计留痕与全量指标探针
- **高危操作审计追溯 (SSOT Audit Log)**：
  - D1 数据表 `admin_audit_logs` 记录管理端高权限操作：`GENERATE`（手动发码）、`REVOKE`（吊销授权）、`UNBIND`（解绑设备）、`CLEAR_LOGS`（清空错误日志）。
  - 处理路由时使用 `ctx.waitUntil(logAdminAudit(env, action, targetType, targetId, details, clientIp))` 异步落盘，防范操作抵赖。
  - 提供 `GET /api/v1/admin/audit-logs` 供检索，支持按 `action` 过滤及关键词模糊检索与分页。
- **Health 探针与 Overview 实时 KPI 架构**：
  - 在 `GET /api/v1/admin/health` 中提供运营指标：`total_licenses`, `active_licenses`, `today_activations`, `total_error_logs`, `errors_24h`。
  - **快速指标查询 (`?probe=0` / `?quick=1`)**：Overview 概览页默认带 `?probe=0`，直接返回 D1 统计指标并跳过阻塞式外部 SMTP/Paddle 网络探测，使仪表盘在毫秒级秒开；Worker 内部对全量探针实施 15s 内存缓存，防止连续刷新压垮外部 SMTP/API。
  - 在 `schema.sql` 中为 `buyer_email_hash`, `created_at`, `admin_audit_logs(created_at)` 显式创建 B-Tree 索引。

### 3.7 Admin 后台与 Cloudflare Access SPA 同源反代坑点
- **生产 API Base 配置规则**：`cloudflare/eqt-admin/.env` 中的 `VITE_API_BASE` 在生产部署时**必须留空** (`VITE_API_BASE=`)。生产环境中 SPA 必须发起同源 `/api/v1/admin/*` 请求，由 Pages 同源 Function (`functions/api/[[path]].ts`) 代理并注入 `Cf-Access-Jwt-Assertion` 标头到后端 `lic.eqt.net.im` Worker。
- **Svelte 5 全局环境响应式状态 (`env.svelte.ts`)**：Admin 环境切换（生产/沙箱）使用 Svelte 5 `$state` 模块（`adminEnv.current`）驱动，主视口通过 `{#key \`${adminEnv.current}-\${currentTab}\`}` 驱动子组件重新挂载与拉取，禁止在 `$effect` 内部同步修改普通 `$state` 导致响应式追踪断裂。
- **禁止硬编码后端跨域域名**：若误设为 `VITE_API_BASE=https://lic.eqt.net.im`，打包出的静态 JavaScript 会跨域绕过 Pages 反代，导致无法携带 `admin.eqt.net.im` 的 Access Cookie 或 Header，触发 401 `ACCESS_JWT_REQUIRED` 甚至陷入前端刷新死循环。
- **401 防刷新死循环**：`adminFetch` 捕获 401 严禁强行 `window.location.reload()` 或变更 `location.href`；必须在 UI 暴露出具体 error payload 便于定位诊断。

### 3.8 测试环境分离(workers.dev + eqtdev build tag)
- **安全不变式**：代码默认值恒为生产 `https://lic.eqt.net.im`；测试环境只能通过显式机制进入（wrangler `[env.test]` / Go `-tags eqtdev` / 环境变量）。"漏配"方向永远安全——release 忘加 tag 仍是生产。
- **wrangler `[env.test]` 大坑**：`vars` / `d1_databases` / `r2_buckets` 是 **non-inheritable**，必须显式重声明；而 **`routes` 是 inheritable**——若测试环境不显式 `routes = []` + `workers_dev = true`，测试 Worker 会继承生产自定义域名并**抢占生产**。**`logpush` 同样 inheritable**，但测试账户无 Logpush 权限（`code 10023`），`[env.test]` 必须显式 `logpush = false` 否则部署报错。改动 `wrangler.toml` 的 `[env.test]` 后必跑 `wrangler deploy --env test --dry-run` 确认 resolved routes 为空。
- **Go build tag 互斥机制**：环境默认值拆两个文件，`env_defaults.go`（`//go:build !eqtdev`）与 `env_defaults_dev.go`（`//go:build eqtdev`）**必须成对加 tag**——无 tag 的文件恒编译，与 tag 文件同包会 `redeclared` 冲突。
- **验证公钥随 tag 切换**：`defaultPublicKeyHex` / `defaultUpdatePublicKeyHex` 也拆到上面两个文件。release 恒用生产公钥验证（激活证书+更新签名）；eqtdev 构建用测试专用公钥 `ce07f0...`（对应测试 worker 的 seed `2cf5baa8...`）。因此测试激活码只能被测试构建验证，生产构建不会误认测试码。**测试 worker 的 `ED25519_PRIVATE_KEY` 必须是 32-byte seed 的 hex** —— `hexToUint8Array` 只校验长度偶数、不校验字符合法性，误贴 base64 PKCS8 会静默产生垃圾私钥（签名不被任何公钥验证），排查「签名失败」时优先核对 secret 是否为纯 hex。
- **环境操作 SSOT**：测试/生产对照、如何测试、生产清理见 `docs/deploy/environment-runbook.md`（操作前必读）；正式运营上线前待办见 `docs/deploy/go-live-checklist.md`。**wrangler 4.x 已移除 `d1 backup` 子命令**（`create`/`restore`/`list` 全没了），备份一律改用 `npx wrangler d1 export <db> --remote --output=...`；恢复演练用 `sqlite3 drill.sqlite < backup.sql` 载入核对行数。**`.github/workflows/d1-backup.yml` 已于 2026-08-08 从 `d1 backup create` 改写为 `d1 export`**（原写法在新 wrangler 下每日备份静默失败）。生产库任何 DELETE 前先导出备份，删除顺序：`activations` → `license_upgrades` → `unbind_records` → `licenses`（外键约束）。历史教训：2026-07-21 E2E MCP 测试码曾残留生产 D1，任何浏览器 E2E/探针测试只许写 `-test` 库。2026-08-08 已全清生产 D1/R2 测试残留（licenses 39 行等，无真实数据）。
- **Paddle sandbox 判据与双向硬阻断 (`assertEnvironmentAlignment`)**：
  - 沙箱密钥以 `pdl_sdbx_` 开头，测试 Worker 据此将激活码 `source` 标为 `'test'`（生产 live 密钥标 `'purchase'`）；
  - **第一性原理 Fail-Fast 防御**：生产 Worker 严禁注入 `pdl_sdbx_*` 密钥或 Sandbox 测试价格 ID；测试 Worker（`ENVIRONMENT='test'`）严禁注入 `pdl_live_*` 密钥或 Live 生产价格 ID。入口处不匹配直接阻断并记录 CRITICAL 告警。
- **测试套件统一加载 `.env.test` (SSOT)**：测试命令统一采用 Node 20+ 原生 `--env-file=../../.env.test` 驱动，杜绝孤儿配置与手工 shell 注入。
- **Wails 支持 `-tags`**：`wails dev -tags eqtdev` / `wails build -tags eqtdev` 切测试 Worker；`release.yml` 的 build 严禁加任何 tag 注入（文件内已有注释防误改）。
- 完整搭建步骤见 `docs/deploy/test-environment.md` 与 `docs/deploy/gui-environment.md`（测试资源创建由用户按文档执行，不在代码仓库内）。


---

## 4. 兑换码生成与管理工具 (License Code Generation)

使用 [generate-license.sh](file:///home/yelon/develop/me/eqrcp/scripts/generate-license.sh) 自动化脚本快速生成兑换码，并自动屏蔽 `CLOUDFLARE_API_TOKEN` 环境变量干扰安全写入 Cloudflare D1：

```sh
# 生成默认 PLUS 永久授权码并写入云端 D1
./scripts/generate-license.sh

# 生成 PRO 级别、限制绑定 1 台设备的临时兑换码并写入本地 D1 测试
./scripts/generate-license.sh -t PRO -m 1 -e "2027-06-25T12:00:00Z" --local
```

生成格式为 `EQT-TIER-YYYYMMDD-RANDOM-CHECK`（`CHECK` 为前 3 项拼接后取 MD5 前 4 位大写字符校验）。

---

## 5. Paddle 支付履约 Webhook、订阅续期与年付→终身待生效升级

在 Cloudflare Workers (`eqt-drm-api`) 和 D1 数据库中实现专有通道：
- **D1 字段与扩展表**：`paddle_transaction_id`（交易 ID）、`paddle_subscription_id`（订阅 ID）以及 `license_upgrades` 表（记录年付转终身的待生效升级，包含字段 `user_email`, `target_license_code`, `lifetime_txn_id`, `purchased_at`, `effective_at`, `status`）。
- **年付→终身待生效升级 (§6.7 架构)**：
  1. **全额买断与状态隔离**：用户在年付订阅期间全额购买终身升级，不会立即覆盖现有年付到期日，终身权益在当前年付到期时刻（`effective_at` 快照）生效；
  2. **14 天退款窗口期阻断**：新购 14 天退款窗口期内的年付码不可直接升级，引导用户先退款再直接购买终身版；
  3. **防双重扣款 (Auto-renew OFF)**：建立待生效升级时，服务端自动取消该激活码在 Paddle 侧下一个账期的自动续费 (`auto_renew = 0`)；
  4. **惰性生效 (Lazy Flip)**：客户端在 `verify` / `activate` 时触发 `checkAndApplyPendingUpgrade`，当 `now >= effective_at` 时翻转 `expires_at = 'LIFETIME'` 且更新 `license_upgrades.status = 'applied'`，无须 cron 任务；
  5. **退款撤回**：若待生效期间终身升级交易被退款，`license_upgrades.status` 改为 `'cancelled'`，目标年付激活码保持原年付期效与功能。
- **路由设计**：
  1. `/api/v1/paddle/webhook` (POST)：接收 `Paddle-Signature` 利用 HMAC-SHA256 验签。履约 `transaction.completed` 时判断 Lifetime/Yearly 或 `target_license_code` 升级参数。捕获 `transaction.refunded` 或 `subscription.canceled` 时更新状态。
  2. `/api/v1/paddle/license-query` (GET)：接收 `transaction_id`，供前端支付完成（`checkout.completed`）时轮询弹出新授权码。

---

## 6. 许可证查询与退款自服务门户 (License Portal & Self-service Refund)

> **文档 SSOT**：[`docs/portal/`](../../docs/portal/README.md)（overview / api-contract / progress）。

在 `cloudflare/eqt-website/portal.html` 及 `eqt-drm-api` 后端提供许可证管理与自助退款自服务门户：
- **无密码登录**：D1 表 `verification_codes`（发信验证码）与 `user_sessions`（24 小时过期 Session Token）。
- **前置发码校验**：Portal 发码 `POST /api/v1/auth/send-code` 校验 `licenses` 表是否有购买记录（无记录拦截并返回 `no_purchase_history`）。Pricing 发码 `POST /api/v1/checkout/send-code` 为购前验证，不校验购买记录。
- **解绑与退款归属权校验**：`POST /user/unbind-device` 与 `POST /user/refund` 必须校验 session 邮箱对该 license 的所有权（`buyer_email_hash` 或 `buyer_email`），失败报 403 `not_license_owner`。
- **Workers 内置 SMTPS 发信**：利用 Workers `connect` API 通过 465 端口（Implicit TLS）直接与外部 SMTP 服务器建立 safe TCP 连接发送握手与邮件包。
- **Paddle Adjustments API 退款细节**：
  - 检测 `PADDLE_API_KEY` 前缀（`pdl_sdbx_`）自动路由至沙箱 `sandbox-api.paddle.com` 或生产 API `api.paddle.com`。
  - 创建退款（`POST /adjustments`）时，`items` 数组的 `item_id`（`txnitm_...` 格式）必须从 `GET /transactions/{id}` 的 `data.details.line_items` 数组里读取。
  - 合成/测试单号（`txn_test_*` 等）走本地吊销路径返回 `refund_test_local_success`；真实单号（`txn_01...`）才调用 Paddle。
- **反滥用规则**：滚动 365 天内已激活过的 purchase 退款/拒付 ≥3 次拦截。未激活退款不计次。
- **激活邮箱传输**：在 D1 的 `licenses` 表中追加 `buyer_email` 并在客户端激活时写入本地 `license.lic`。客户端 Ed25519 离线验签 payload 保持原有 7 字段拼接模式（不包含 `buyer_email`），保证向后兼容。

---

## 7. 全生命周期邮件提醒通知设计

- **发信时机**：
  1. **付款成功**：Webhook `transaction.completed` 触发，发送激活码及客户端激活指引。
  2. **新设备激活**：`/api/v1/activate` 确认 `!isAlreadyActivated` 后触发，发送包含脱敏设备指纹的防盗刷提醒。
  3. **退款吊销**：`/api/v1/user/refund` 或 Webhook 退款/注销触发，发送失效警示邮件。
- **Serverless 异步规范**：所有邮件发送均包裹在 Workers `ctx.waitUntil(...)` 中异步执行，不得阻塞 HTTP 主线程。

---

## 8. 设备解绑额度与 7 语言邮件国际化

- **365 天滚轮解绑额度 (Rolling Unbind Limit)**：每张授权码过去 365 天内最多允许解绑设备 4 次 (`MAX_YEARLY_UNBINDS = 4`)。解绑记录持久化在 D1 `unbind_records` 表，满 365 天后额度自动恢复。
- **设备恢复机制**：解绑仅释放 1 台设备名额，重新在目标设备上输入授权码激活即可恢复。
- **7 语言邮件国际化**：所有系统邮件（验证码、结账、设备通知）支持 7 种语言 (`zh`, `en`, `ja`, `ko`, `es`, `de`, `fr`)，并自动对齐 Portal 界面语种。

---

## 9. 授权来源渠道 (Source) 与运行环境 (Environment) 解耦规范

- **环境与渠道正交分离 (Orthogonal Separation)**：
  - **`source`（来源渠道）**：表达激活码获取的商业途径，取值包括：
    - `purchase`（官网购买）：由 Paddle Webhook 履约创建或包含真实 Paddle 交易号（`txn_01...`，包含 Sandbox 沙箱测试购买与 Live 生产购买）。
    - `admin`（官方生成 / VIP 赠予）：由管理后台手动或客服接口生成。
    - `promo`（活动兑换）：带兑换窗口与天数的限时活动码。
    - `test`（测试夹具）：仅用于自动化测试夹具/合成测试单据（`txn_test_*`、`sub_test_*`）。
  - **`normalizeLicenseSource` 归一化**：服务端与 Portal 遇到 `txn_01...` 格式交易单号时，即使历史数据被写入过 `test`，也自动规整为 `purchase`，保证测试沙箱购买的激活码在用户中心与管理后台均正确显示为购买途径。
- **Portal 测试环境自适应标识**：
  - 页面通过 `window.EQT_IS_TEST`（`js/api-base.js` 解析）判断测试环境。
  - 当为测试环境时，Header Logo 旁动态渲染高亮 `TEST` 徽章，页面主区域顶部展示测试环境提示横幅，支持 7 种语言实时国际化切换。
