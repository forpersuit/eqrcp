---
name: eqt-drm
description: Guides EQT licensing architecture, offline cryptographic activation verification, and Cloudflare Serverless D1 database deployment.
---

# EQT 授权与反破解开发指南 (EQT Licensing DRM Skill)

本技能指南面向 AI 开发助手，指导如何维护和修改 EQT 的 DRM 授权、反破解方案，以及管理 Cloudflare 后端接口。

---

## 1. 客户端设备指纹比对规范 (Client Hardware Fingerprint)

- **第一性原理防线**：在进行 **3选2 加权设备指纹校验**（主板 UUID、CPU 序列号、系统盘物理 SerialNumber）时，必须注意空值的校验回避：
  - 如果由于运行权限原因导致某项硬件特征提取返回空字符串 `""`，此字段**绝对不能**在比对时判定为“相等”，必须直接跳过。
  - 只有两边非空且完全相等时，匹配项才能计入。
  - 至少有 2 项有效的非空指纹相匹配，才允许判定设备合法。
- **配置一致性**：一旦设备指纹修改，必须确保针对 Windows 和 Linux 的测试覆盖，并运行 [license_test.go](file:///home/yelon/develop/me/eqrcp/pkg/server/license_test.go) 中的加权模型边界案例。

---

## 2. 离线 `.lic` 数字证书单一可信源 (SSOT) 与时钟防篡改

- **单一可信源 (SSOT)**：彻底废除了本地 `chat_usage.json` 双备份以及家目录隐藏防线文件 `.eqt_sys_state` 的防篡改与证书校验代码。`license.lic` 数字证书缓存成为全局授权、对账及防时钟回拨的**唯一可信源 (SSOT)**。
- **Ed25519 签名与双重密码学保护**：
  - **主证书签名 (`Signature`)**：签名载荷必须与 Workers 生成时严格对称（`license_code|tier|uuid_hash|cpu_hash|disk_hash|expires_at|max_devices`）。
  - **对账确认签名 (`VerifySignature`)**：云端通过 `/api/v1/verify` 接口使用私钥签发带有服务器最新时间的对账载荷（`OK|license_code|uuid_hash|cpu_hash|disk_hash|last_online_sync_time`）。
  - **抗手动修改机制**：为防止用户本地用文本编辑器手动修改 `.lic` 里的对账时间 `LastOnlineSyncTime`，客户端每次校验必须使用内置公钥校验 `VerifySignature` 对应的载荷合法性。任何非云端私钥签发的修改均会在微秒级被识破并降级。
- **静默对账与 7 天租约宽限**：
  - 应用拉起时（通过 `hardware.go` 后台线程）先做 `VerifyLocalLicense()`，若本地存在 `.lic`，**强制**执行一次 `ForceOnlineLicenseSync()`（忽略 12 小时节流）。在线状态是吊销/Portal 解绑的权威来源（SSOT）；仅当网络失败时才回退到离线 7 天租约。
  - 后续后台静默对账仍走 `StartOnlineLicenseSync()` / `doOnlineLicenseSync(false)`，保留 12 小时最低间隔，避免频繁网络交互。
  - About 面板标题旁「刷新」按钮调用 `RefreshLicenseStatus()`：优先在线强制对账，失败再 `VerifyLocalLicense()` 离线校验。Dev「在线对账」同样走 `ForceOnlineLicenseSync()`。
  - 对账网络超时失败不影响使用。客户端支持 7 天内静默免网脱机运行，计算公式为：`time.Now() - LastOnlineSyncTime <= 7 * 24 * time.Hour`。若超时则自动强行降级。
  - 对账返回 403/404（授权被吊销或设备解绑）则立即执行 `ResetLicense()` 擦除证书并降级为 Unpaid 免费版。
  - `VerifyLocalLicense()` 任意失败路径（含无 `.lic` 文件）必须 `SetPaidStatus(false)`，防止内存付费态与磁盘不一致。
  - 前端 `localStorage` 仅缓存 UI 元数据（如 redeemedAt 展示），**禁止**在启动时用 localStorage 向 Go 端 `SetPaidStatus(true)` 抢权。
- **极简单向时钟防回拨与网络时间防篡改**：
  - 证书内元数据字段 `LastSeenLocalTime` 记录最后一次运行时间。每次成功校验后（若距离上次写入超过 1 分钟，以减少磁盘 IO），客户端自动更新并原子性落盘。
  - 本地校验时，若判定当前系统时间倒流（`time.Now() < LastSeenLocalTime - 10 minutes`），立刻判定为篡改并调用 `SetClockTampered(true)` 降级并永久锁死高级付费功能。
  - **联网配额与防篡改对齐**：未激活免费版用户在脱机断网状态下只提供基础 Free 传输功能（不授予每日 10 分钟高级限额全功能）；在线状态下系统自动通过 `getNetworkTimeOrStartFetch()` 获取准确网络时间 Date 标头。若检测到本地系统时间与网络时间偏差超过 10 分钟，自动判定为 `ClockTampered` 并锁死。
  - **废弃死代码清理**：彻底物理清理了 `~/.eqt_sys_state` 隐藏暗记文件及 XOR 混淆死代码，坚决保持 `.lic` 作为离线授权唯一可信源 (SSOT)。
- **测试兼容模式**：在单元测试或 mock 状态下（`os.Getenv("EQT_TESTING") == "true"`），若本地没有 `.lic` 文件，必须自动降级到传统模式，支持模拟付费判定，不可在测试环境中强求真实公私钥签名，且自动豁免 7天租约及防时钟回拨的强制性检查，以免破坏基础 CI。
- **Share/Receive 模式防规避与防呆拦截机制**：
  - **无物理时限中断**：为了保障用户体验连贯性，在 10 分钟（600秒）限额内，如果某次传输任务（如移动端上传 POST 或桌面端 Share）在启动那一刻 `usedSeconds < 600`，本次传输必须被允许无限制传输完毕，不得强行调用 `signalStop()` 在中途物理切断。
  - **下一次任务额度拦截**：下一次新任务启动时，若 `usedSeconds >= 600` 且未付费：
    - **桌面端 Share 启动拦截**：在 `Share()` API 启动时，递归检查待分享文件的总路径。若文件个数超过 5 个或单个文件大于 50MB，则直接返回 error 阻断服务启动。
    - **移动端上传拦截**：在 POST `/receive/...` 请求入口处锁死 `quotaExceededAtStart`。若其为 `true`：在 Multipart 循环中，若已写入文件达到 5 个时拒绝后续接收并报错 403 阻断；在 Chunk 级文件写入 IO 循环中，若单个文件写入累计超过 50MB（52,428,800字节），即刻强行关闭文件、报错 413 退出并触发 `signalStop()`。
    - **单元测试保障**：为该防规避设计编写单元测试（包括文件数超限、单文件超限、开始低额度中途超额无缝传输完），保护相关边界不被后续回归破坏。

---

## 3. Cloudflare D1 & Workers 运维避坑与调试

在通过 Wrangler 部署和修改云端 API 时，极易遇到凭证和部署管道的阻碍，必须采取以下开发经验：

### 3.1 环境变量 API Token 干扰
Wrangler CLI 会优先读取终端环境变量的 `CLOUDFLARE_API_TOKEN`，如其失效或权限（如读取 `memberships`）不足，会报 D1/Worker 拒绝访问。

- **规避手段**：在命令前手动强行清除此变量环境，强制让

### 3.5 结账前邮箱强制验证与统一多语言邮件模板 (Checkout Email Verification & Multi-language i18n)

为防止买家填错邮箱导致收不到激活码，并在结账前强化设备绑定安全性，引入了结账前强制邮箱验证机制：
- **发信凭据绝对隔离 (First Principle)**：所有的 SMTP 凭证保存在 Cloudflare Worker 后端，前端仅发起请求。
- **统一多语言发信模版 (Single Source of Truth)**：在 Worker 中维护 `CHECKOUT_EMAIL_I18N` 字典。前端发送 `POST /api/v1/checkout/send-code` 时带着用户当前的语言标识 `lang`（如 `zh`, `ja`, `en`）。发信引擎匹配字典并插入 6 位验证码。如果遇到新语言，系统静默平滑降级（Fallback）到 `en` 英文模板，未来增加新语言只需在字典中加一行，底层代码 0 修改。
- **结账邮箱自动填充与锁定**：前端弹窗完成 `POST /api/v1/checkout/verify-code` 校验后，自动透传已被验证的 `verifiedEmail` 并通过 `settings: { allowLogout: false }` 锁定 Paddle 收银台邮箱不可修改：`Paddle.Checkout.open({ items: [...], customer: { email: verifiedEmail }, settings: { allowLogout: false } })`。

### 3.6 全量 DRM & Admin API E2E 自动化测试套件 (Comprehensive DRM & Admin E2E Testing Suite)

为确保云端 Worker API 及 Admin 管理路由部署后的功能完备性、日志记录以及防范回归风险，固化了全量 E2E 自动化测试机制：
- **测试路径**：
  - 用户侧 DRM 流程测试：`cloudflare/eqt-drm-api/tests/e2e-drm-test.js` （指令：`npm run test:e2e`）
  - 管理端 Admin 契约测试：`cloudflare/eqt-drm-api/tests/e2e-admin-test.js` （指令：`npm run test:admin`）
- **测试指令**：在 `cloudflare/eqt-drm-api` 目录下运行 `npm run test:e2e` 或 `npm run test:admin`。
- **Admin 测试覆盖**：鉴权 fail-closed 拦截、Health 探针及配置徽章、手动发码 `POST /admin/generate`、按 `created_at DESC` 检索 `GET /admin/licenses`、按 `activation_id` 解绑 `POST /admin/unbind`、吊销 404/200 `POST /admin/revoke`、日志查询与清空 `DELETE /admin/error-logs`、高危操作审计查询 `GET /admin/audit-logs`。
- **开发准则**：任何 DRM Worker 代码与 Admin 路由变更部署前后，须运行测试断言通过方可交付。

### 3.7 管理后台 (Admin) 操作审计留痕与全量指标探针 (Admin Audit Logs & Health Metrics)

- **高危操作审计追溯 (SSOT Audit Log)**：
  - D1 数据表 `admin_audit_logs` 记录由管理端触发的所有高权限操作：`GENERATE`（手动发码）、`REVOKE`（吊销授权）、`UNBIND`（解绑设备）、`CLEAR_LOGS`（清空错误日志）。
  - 后端在路由处理时使用 `ctx.waitUntil(logAdminAudit(env, action, targetType, targetId, details, clientIp))` 异步落盘，记录客户端请求 IP、目标授权码/设备ID与操作详情 JSON，防范单 Secret/多运维场景下的操作抵赖。
  - 提供 `GET /api/v1/admin/audit-logs` 供后台管理与运维检索，支持按 `action` 过滤及关键词模糊检索与分页。
- **Health 探针与 Overview 实时 KPI 架构**：
  - 在 `GET /api/v1/admin/health` 中提供深度运营指标：
    - `total_licenses`: 全库总发码量
    - `active_licenses`: 状态为 active 的有效授权数
    - `today_activations`: 今日新增设备激活数
    - `total_error_logs`: 异常日志积压总量
    - `errors_24h`: 最近 24 小时新增的系统异常日志数
  - 在 `schema.sql` 中为 `buyer_email_hash`, `created_at`, `admin_audit_logs(created_at)` 显式创建 B-Tree 索引，确保在海量库表数据下查询控制在微秒级返回。

---

## 4. 版本与发布交付规范

- 一旦有功能增加，必须同步升级 `pkg/version/version.go` 中的小版本号（如升级到 `v1.14.9`）。
- 提交前须确认全量 Go 单元测试通过：`go test ./...`。
- 官网部署：使用 `CLOUDFLARE_API_TOKEN="" npx wrangler pages deploy cloudflare/eqt-website --project-name eqt` 部署至 Cloudflare Pages。
- Worker 部署：在 `cloudflare/eqt-drm-api` 目录下执行 `CLOUDFLARE_API_TOKEN="" npx wrangler deploy`。

### 3.2 交互式 Secret 注入
在 Cloudflare Worker 中通过管道无交互写入敏感凭据的语法：
```sh
echo -n "your_secret_value" | npx wrangler secret put KEY_NAME
```
若目标 Worker "eqt-drm-api" 尚未激活或创建，Wrangler 会自动在非交互上下文中选择同意 (`yes`) 并自动建立同名 Worker 挂载秘钥，无需额外干预。

### 3.3 Cloudflare R2 存储与 CI/CD 资产分发 (R2 Storage & Asset Sync)
为了确保私有仓库下的 EQT 客户端可以被公共下载与顺利执行自动更新：
- **GitHub Secrets 密钥依赖**：必须在 GitHub 仓库中配置以下凭据，以供 `.github/workflows/release.yml` 自动上传编译产物到 Cloudflare R2 存储桶：
  - `CF_ACCOUNT_ID`: Cloudflare 账户 ID。
  - `R2_BUCKET_NAME`: 用于分发安装包的 R2 存储桶名.
  - `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`: 用于 S3 兼容上传的 R2 访问密钥对。
- **自动更新链接重定向**：在云端 `eqt-drm-api` Worker 环境变量中配置 `R2_PUBLIC_URL`（例如 `https://pub.eqt.net.im`）。
  - 若配置了此变量，`/api/v1/update/check` 返回的 `download_url` 将被自动改写为 R2 的加速直链。
  - 若未配置，则回退使用私有 GitHub Releases 直链。
- **静态网页直链**：产品介绍页面（`cloudflare/eqt-website/index.html`）应始终使用指向 R2 存储桶的公共直链（如 `https://pub.eqt.net.im/downloads/latest/eqt-desktop-windows-amd64.exe`），从而免受 GitHub 私有库 404 限制及免去 Worker 的 CPU 超时影响。
- **分发下载域名接管模式**：为规避 Pages master 全量部署对 `downloads/` 目录的覆盖、以及 Pages 的 25MB 单文件上限，`download.eqt.net.im` 的解析已被合并路由到 `eqt-drm-api` Worker 下。
  - **R2 自动化上传**：大文件二进制与签名资产在 GitHub Actions `release.yml` 阶段会通过 `wrangler r2 object put` 自动化同步发布 to R2 存储桶中，供国内或非 GitHub 地区高速直连下载。
  - **动态官网版本显示**：官网页面 `index.html` 采用非阻塞异步 fetch 机制获取 `/update-metadata.json` 中的最新版本号并动态渲染到下载按钮中。此机制在 `applyLang` 底部绑定，确保用户切换多语言时版本号显示不会被重置覆盖。
  - **302 重定向**：Worker 拦截 `download.eqt.net.im` 流量并处理请求：
    - 将 `/update-metadata.json` 解析并生成带一分钟边缘缓存的动态 JSON（支持 CORS 供官网请求）。
    - 将 `/downloads/:version/:filename` 动态 302 重定向到配置的 R2 存储加速域名，若无 R2 环境变量则回退重定向到 GitHub Releases。
    这确保了发布新版本时大文件托管免受 Pages 单文件限制，并且任何时候推送代码至 master 均不会造成下载大文件丢失。

---

## 4. 兑换码生成与管理工具 (License Code Generation)

为了配合云端授权管理，我们提供了一个自动化脚本 [generate-license.sh](file:///home/yelon/develop/me/eqrcp/scripts/generate-license.sh) 用于快速生成兑换码，并自动屏蔽 `CLOUDFLARE_API_TOKEN` 的环境变量干扰以安全写入 Cloudflare D1 云端数据库。

### 使用方法：
在项目根目录或 `scripts/` 目录下运行：
```sh
# 生成默认的 PLUS 永久授权码并写入云端 D1
./scripts/generate-license.sh

# 生成 PRO 级别、限制绑定 1 台设备的临时兑换码并写入本地 D1 测试
./scripts/generate-license.sh -t PRO -m 1 -e "2027-06-25T12:00:00Z" --local
```

### 特征算法：
生成格式为 `EQT-TIER-YYYYMMDD-RANDOM-CHECK`：
1. `TIER`: PLUS 或 PRO。
2. `YYYYMMDD`: 8 位当前日期。
3. `RANDOM`: 6 位随机大写字符。
4. `CHECK`: 前 3 项拼接后取 MD5 前 4 位大写字符，用以校验防错漏。

---

## 5. Paddle 支付履约 Webhook 与 License 查询对账 (Paddle Webhook & License Query Integration)

为了打通自动支付履约和退款/取消订阅吊销授权码的业务流，我们在 Cloudflare Workers (`eqt-drm-api`) 和 D1 数据库中实现了专有通道：

### 5.1 D1 数据库字段扩展
对 `licenses` 表追加了以下两个字段：
- `paddle_transaction_id TEXT DEFAULT NULL`: 关联的 Paddle 交易 ID，唯一履约凭证。
- `paddle_subscription_id TEXT DEFAULT NULL`: 关联的 Paddle 订阅 ID，唯一维护和续期凭证。

### 5.2 核心云端路由设计
1. **`/api/v1/paddle/webhook` (POST)**:
   - **签名校验**：接收 `Paddle-Signature` 头部，利用 `HMAC-SHA256` 以及 Webhook Secret 验证包体完整性（允许最大 5 分钟的时钟偏差）。
   - **履约 (`transaction.completed`)**：提取交易中的 `price_id`，对比 `PRICE_LIFETIME_ID` 或 `PRICE_YEARLY_ID`：
     - 若为 Lifetime，则生成无有效期的 `PLUS` 授权（`LIFETIME`）。
     - 若为 Yearly，则生成有效天数为 `365` 天的 `PLUS` 授权，并计算一年的到期日。
     - 将买家邮箱散列哈希存入 `buyer_email_hash`，并关联写入 D1 `licenses`。
   - **退款与吊销 (`transaction.refunded` / `subscription.canceled`)**：
     - 捕获退款或订阅中止（`canceled` / `past_due` / `paused`）事件，并执行 SQL：`UPDATE licenses SET status = 'revoked' WHERE paddle_transaction_id = ? OR paddle_subscription_id = ?`。这使得客户端在下一次 `/api/v1/verify` 对账同步时收到 403 强制擦除离线密钥。
2. **`/api/v1/paddle/license-query` (GET)**:
   - 接收 `transaction_id` 参数。
   - 提供安全、只读的对账查询，用于前端支付完成（`checkout.completed`）时的即时轮询，在网页端无需刷新即可向用户优雅弹出新生成的授权兑换码。

### 5.3 生产环境部署依赖
部署 Webhook 到线上之前，必须完成以下配置：
1. 登录 Paddle Dashboard 创建 Webhook 目的地指往 `https://lic.eqt.net.im/api/v1/paddle/webhook`，并订阅 `transaction.completed`, `transaction.refunded`, `subscription.canceled`, `subscription.updated` 事件。
2. 提取生成的 Webhook Secret 并作为敏感变量存入 Worker：
   ```sh
   echo -n "pdl_ntfset_xxxxxx" | npx wrangler secret put PADDLE_WEBHOOK_SECRET
   ```

---

## 6. 许可证查询与退款自服务门户 (License Portal & Self-service Refund)

> **文档 SSOT**：[`docs/portal/`](../../../docs/portal/README.md)（overview / api-contract / progress）。改 Portal 行为前先读契约与进度清单。

我们实现了一个支持多语言、现代化的许可证管理与自助退款自服务门户（`cloudflare/eqt-website/portal.html`）以及配套的后端验证/退款 API（在 `eqt-drm-api` 中）。

### 6.1 D1 表结构扩展
为支持安全的无密码邮箱验证码登录，追加了以下表结构：
* `verification_codes`: 存放临时生成的 6 位发信验证码及其有效期。
* `user_sessions`: 存放用户成功校验后颁发的 24 小时过期 Session Token。

### 6.5 Portal 登录前置购买校验与 Pricing 流程防阻断隔离
为提升防刷能力和避免向非购买用户盲发验证码：
* **Portal 登录发码 (`POST /api/v1/auth/send-code`)**：在发送验证码前，强制根据 `email` 的 SHA-256 希值/明文在 `licenses` 表中查询是否有购买记录 (`buyer_email_hash` 或 `buyer_email`)。若未购买过，拦截并直接返回多语言错误提示 `no_purchase_history`；若已购买，正常发送 6 位验证码。与 checkout 一样有 **60s 发码冷却**（`created_at`）。
* **Pricing 结账发码 (`POST /api/v1/checkout/send-code`)**：属于购买前的邮箱真实性验证，**不校验** `licenses` 购买记录，任何合法格式邮箱均可正常获取发码。
* **Ownership 第一性原理**：`POST /user/unbind-device` 与 `POST /user/refund` 必须校验 session 邮箱对该 license 的所有权（`buyer_email_hash` 或 `buyer_email`）；失败 403 `not_license_owner`。无归属字段的码仅 Admin 可操作。解绑额外要求 `status === 'active'`。
* **验证码隔离**：D1 `verification_codes` 主键实际存 `portal:{email}` / `checkout:{email}`，防止两流程互相覆盖。
* **OTP 失败限流**：`verify-code` 同 IP+purpose+email 15 分钟内 8 次失败 → 429（Worker isolate 内计数）。
* **Portal 退款邮件**：自助退款成功后除 Paddle adjustment 外，异步发 7 语吊销通知（`REFUND_REVOKE_EMAIL_I18N`）。
* **Logout**：`POST /api/v1/auth/logout` 删除 `user_sessions`（幂等）。
* **激活网络元数据**：`POST /activate` 写入 `client_ip`（CF-Connecting-IP）、`ip_country`（CF-IPCountry）、`user_agent`（截断 256）。Admin Licenses 列表 20s 静默刷新并展示设备网络行；旧激活可空。

### 6.2 极简 Workers 内置 SMTPS 发信
利用 Workers `connect` API 通过 465 端口（Implicit TLS）直接与外部 SMTP 邮件服务器建立安全 TCP 连接进行握手和发信：
* **TLS 握手**：`connect({ hostname: host, port: 465 }, { secureTransport: "on" })` 在连接的同时发起 TLS 握手。
* **SMTP 协议流**：依次读取欢迎响应并发送 `EHLO` -> `AUTH LOGIN` -> Base64(User) -> Base64(Pass) -> `MAIL FROM` -> `RCPT TO` -> `DATA` -> 数据帧及句点点断 `.` -> `QUIT`。此方案无任何第三方 NPM 依赖包，完全自包含且极度稳定。

### 6.3 Paddle Adjustments API 退款细节
* **API 地址自动转换**：通过检测 `PADDLE_API_KEY` 前缀（`pdl_sdbx_`）自动路由至沙箱 `sandbox-api.paddle.com` 或生产 API `api.paddle.com`。
* **退款行项 ID 陷阱**：在创建退款（`POST /adjustments`）时，其 `items` 数组的 `item_id` 属性格式为 `txnitm_...`。该 ID **不能**从 `GET /transactions/{id}` 的 `data.items` 列表中直接提取（items 数组仅有 price schema，无 item ID）；**必须**从 `data.details.line_items` 数组里读取每个 item 的 `id` (以 `txnitm_` 开头)，否则将报 items 校验失败及 item_id 缺失错误。
* **合成/测试交易单号**：E2E 夹具常用 `txn_test_*` / `txn_chrome_*` / `txn_mock_*` / `txn_e2e_*`。这些 ID **绝不能**打真实 Paddle Adjustments（会返回 `invalid_url`，前端表现为“点了没反应/授权不变”）。Portal `POST /user/refund` 对合成单号走**本地吊销**路径并返回 `refund_test_local_success`；真实单号须匹配 `txn_01…` 才调用 Paddle。对外错误必须经 `sanitizeRefundPublicError`，禁止把 Paddle 原始 JSON 直接塞进 toast。
* **授权来源 `source`**：`purchase|promo|admin|test`（方案 SSOT：`docs/payment/license-source-and-refund-policy.md`）。仅 `purchase`+真 `txn_01` 可 Portal 退款；promo 有兑换窗且不累加；终身同 tier 拒叠。吊销写 `revoked_at`。
* **滥用退款黑名单**：滚动 **365 天**内 purchase 类吊销 ≥2（邮箱或设备 3 选 2）则拦截激活；条款见 `terms.html` / `refund.html`。
* **排查口令**：`CLOUDFLARE_API_TOKEN="" npx wrangler d1 execute eqt-drm-db --remote --command "SELECT license_code,status,source,paddle_transaction_id,revoked_at FROM licenses WHERE license_code='…'"` + `system_error_logs` 中 `PADDLE_API_ERROR`。

### 6.4 激活邮箱传输与离线签名兼容性设计
为了在 EQT 软件的激活状态中显示购买授权对应的邮箱，采用了**非签名的明文元数据传输**设计，以达成 100% 的向后兼容性（Zero Regression）：
* **数据落盘**：在 D1 的 `licenses` 表中追加了 `buyer_email` 字段。在 Webhook 履约时保存真实邮箱。在客户端激活时明文带回，并写入本地 `license.lic` 中的 `buyer_email` 字段。
* **签名兼容（零退化原则）**：客户端 Ed25519 的离线验签 payload 依然保持原有的 7 字段拼接模式（即不包含 `buyer_email`），从而彻底避免了修改签名串格式导致线上已激活的老客户端本地证书验签失败的风险。

---

## 7. 全生命周期邮件提醒通知设计 (Full Lifecycle Email Notifications)

为了提升激活码使用的安全防范并提供即时订单反馈，DRM 服务端集成了付费、新设备绑定激活、退款及订阅注销的全生命周期邮件提醒机制：

- **发信时机与触发点**：
  1. **付款成功（新购买）**：在 `/api/v1/paddle/webhook` 的 `transaction.completed` 事件下触发，向用户发送包含激活码、套餐详情和客户端激活指引的邮件。
  2. **新设备激活（绑定增加）**：在 `/api/v1/activate`（POST）接口中，当判定 `!isAlreadyActivated` 为真（新设备首次绑定）且 activations 记录成功写入数据库后触发。发送激活成功与安全防盗刷邮件，包含脱敏后的设备指纹（仅显示前 6 位以保护隐私），并提供自服务门户链接。
  3. **退款吊销与失效**：在 `/api/v1/user/refund` 用户自助退款、以及 Webhook 的 `transaction.refunded`（退款事件）和 `subscription.canceled`（订阅注销）中状态变更为 `revoked` 时触发，发送失效警示邮件，通知客户端将在下次联网时强制擦除本地证书降级。
- **Serverless 后台异步执行规范**：
  - 所有的 DRM 邮件发送（调用 `sendDRMEmail`）均需包裹在 Workers 的 `ctx.waitUntil(...)` 中异步执行。
  - 绝对禁止同步阻塞 HTTP 核心请求主线程，以保证 Webhook 握手在毫秒级内返回 200，并避免因 SMTP 服务交互时延引发 Paddle 履约重试或客户端请求超时。

---

## 8. 设备解绑额度与 7 语言邮件国际化 (Unbind Quota & 7-Language Email i18n)

- **365 天滚轮解绑额度 (Rolling Unbind Limit)**：
  - 每张授权码过去 365 天内最多允许解绑设备 4 次 (`MAX_YEARLY_UNBINDS = 4`)。
  - 解绑记录持久化在 D1 的 `unbind_records` 表（包含 `license_code`, `activation_id`, `device_id`, `unbound_at`）。
  - 扣减的 1 次解绑额度将在该次解绑满 365 天后自动恢复重新计入（使用 `unbound_at >= ONE_YEAR_MS` 过滤）。
- **设备恢复机制 (Device Restoration)**：
  - 解绑仅释放 1 台设备的名额，不会物理销毁客户端的设备识别能力。如需恢复付费权限，用户只需在目标设备上打开 EQT 客户端并重新输入该授权码激活即可。
- **全生命周期统一邮件样式与 7 语言国际化**：
  - 使用 `renderEmailWrapper(title, contentHtml)` 渲染统一响应式 600px HTML 邮件样式（包含 EQT 品牌 Header、绿条分割线、多语言正文和 Footer）。
  - 所有系统邮件（验证码 `AUTH_CODE_EMAIL_I18N`、结账 `CHECKOUT_EMAIL_I18N`、设备绑定/解绑通知 `DEVICE_NOTIFICATION_I18N`）全面支持 7 种语言 (`zh`, `en`, `ja`, `ko`, `es`, `de`, `fr`)，并自动对齐 Portal 用户界面的语种。
  - Portal 自助服务页面 (`portal.html`) 使用玻璃拟物风自定义模态框 `#unbind-modal` 替换原生 `confirm()` 对话框，并在面板上实时显示 365 天内剩余解绑次数徽章与解绑/恢复政策说明。


