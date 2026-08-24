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
  - **客户端激活前置守卫**：在向服务端发送激活请求前，客户端必须先校验当前提取到的非空硬件指纹数量。若有效指纹项 < 2，直接返回友好错误拦截请求，防止向服务端占用了席位但本地无法通过 `VerifyFingerprint` 落盘。
  - **服务端权威设备 ID 空值规范**：`GetAuthorityDeviceID()` 在未分配时必须返回 `""`（空字符串），严禁返回 `"未注册"` 等中文字面量作为设备标识符污染服务端数据。
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
  - **启动生命周期与 LicenseReady 标志**：
    - 后端启动时提供 `IsLicenseReady()` / `SetLicenseReady(bool)`，初始为 `false`；当指纹预计算与本地证书校验完成时置为 `true` 并推送状态事件。
    - 前端顶栏 Tier Badge 必须在 `status.licenseReady === true` 时才渲染（未就绪时不显示任何 Badge，杜绝启动时从虚假 FREE 跳变到 PLUS/PRO 的视觉闪烁）。
    - `syncLicenseFromStatus()` 必须在 `status.licenseReady === true` 且 `!status.isPaid` 时才清空本地缓存，避免启动未就绪时误删 localStorage。
  - 前端 `localStorage` 仅缓存 UI 元数据（如 redeemedAt 展示），**禁止**在启动时用 localStorage 向 Go 端 `SetPaidStatus(true)` 抢权。
- **极简单向时钟防回拨与网络时间防篡改**：
  - 证书内元数据字段 `LastSeenLocalTime` 记录最后一次运行时间。每次成功校验后（若距离上次写入超过 1 分钟，以减少磁盘 IO），客户端自动更新并原子性落盘。
  - 本地校验时，若判定当前系统时间倒流（`time.Now() < LastSeenLocalTime - 10 minutes`），立刻判定为篡改并调用 `SetClockTampered(true)` 降级并永久锁死高级付费功能。`SetPaidDetails` 在 `paid=false` 时严禁重置 `ClockTampered` 状态，仅在合法有效付费激活时才允许解除。
  - **联网配额与防篡改对齐**：未激活免费版用户在脱机断网状态下只提供基础 Free 传输功能（不授予每日 10 分钟高级限额全功能）；在线状态下系统自动通过 `getNetworkTimeOrStartFetch()` 获取准确网络时间 Date 标头。若检测到本地系统时间与网络时间偏差超过 10 分钟，自动判定为 `ClockTampered` 并锁死。
  - **解绑设备同步降级**：所有端（Portal、设备自主解绑、Admin 管理后台）在解绑设备时，必须在单次原子事务（`DB.batch`）中同步将 `device_registry` 对应设备降级为 `free` 并清除 `license_code` / `email`。
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

### 3.6 管理后台 (Admin) 操作审计留痕、跨地域多活视界与全量分页契约
- **高危操作审计追溯 (SSOT Audit Log)**：
  - D1 数据表 `admin_audit_logs` 记录管理端高权限操作：`GENERATE`（手动发码）、`REVOKE`（吊销授权）、`UNBIND`（解绑设备）、`CLEAR_LOGS`（清空错误日志）。
  - 处理路由时使用 `ctx.waitUntil(logAdminAudit(env, action, targetType, targetId, details, clientIp))` 异步落盘，防范操作抵赖。
  - 提供 `GET /api/v1/admin/audit-logs` 供检索，支持按 `action` 过滤及关键词模糊检索与分页。
- **全球活跃设备视界与跨地域多活连接 (`/api/v1/admin/devices/live`)**：
  - 基于 `device_registry` 经纬度、活跃窗口（1h/12h/24h/7d）与 `license_code` 进行聚合。
  - 同一激活码多地在线时生成 `cross_region_arcs`（携带 `email`），前端 Badge 点击弹出 Modal 详情并展示脱敏授权码与邮箱，支持一键复制完整码及自动跳转至授权码管理模块检索。
- **Admin 与 Portal 列表数据全量分页契约 (Pagination Contract)**：
  - 管理端（`/error-logs`、`/audit-logs`、`/blacklist`、`/licenses`）与用户自助端（`GET /api/v1/user/licenses`）统一遵循服务端分页契约：返回 `{ success: true, [items]: [], total, limit, offset }`，分别由前端 `Pagination.svelte` 与 `portal.html` 动态分页条统一驱动上下页、范围计算与总数展示。
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
- **生产 `logpush = true` 的 Wrangler 版本坑（2026-08-23）**：账户无 Logpush 权限（`code 10023`）。wrangler **v3 legacy 部署路径会 PUT `script-settings` 尝试开启 logpush → 生产部署失败**；wrangler **v4（versions API）不写 `script-settings` → 静默跳过**。症状：`eqt-feedback-api` 用 wrangler 3 部署失败于 `script-settings`，`eqt-drm-api` 用 wrangler 4 却成功（线上两者 `script-settings.logpush` 实测均 `false`）。修复：统一升级到 wrangler 4.x（需同步升 `@cloudflare/workers-types` 到 ^5，否则 peer 冲突）。排查「某 worker 部署失败而另一 worker 正常」时先对比两边 package.json 的 wrangler 版本。
- **GitHub Actions Deploy 全链路失败排查（2026-08-23）**：`deploy.yml` 由 `workflow_run` 触发（仅 CI 成功且为 push 事件），任一步骤失败即整链停止（`concurrency: deploy-master` 防重）。当「静态 HTML 已上线但 worker/function 未更新」时：用 `gh run list --workflow=deploy.yml --json conclusion` 查历史，若长期 failure 则 `gh run view <id> --log` 看失败步骤；Worker 认证错误 `code 10000` 表示 `CLOUDFLARE_API_TOKEN` secret 过期。本地有效 token 在 `.env` 的 `CLOUDFLARE_USER_API_TOKEN_EQT`（User Token，`/user/tokens/verify` 会 401 属正常——无 user 级权限，但不影响资源读写在）。更新 secret：`echo "<token>" | gh secret set CLOUDFLARE_API_TOKEN`。验证 token 只读权限可 GET workers/services 列表；验证写权限用 `wrangler pages deploy ./ --project-name=eqt --branch=preview-test`（preview 分支不碰生产）。


---

## 4. 兑换码生成与管理工具 (License Code Generation)

使用 [generate-license.sh](file:///home/yelon/develop/me/eqrcp/scripts/generate-license.sh) 自动化脚本快速生成兑换码，并自动屏蔽 `CLOUDFLARE_API_TOKEN` 环境变量干扰安全写入 Cloudflare D1：

```sh
# 生成默认 PLUS 永久授权码并写入云端 D1
./scripts/generate-license.sh

# 生成 PRO 级别、限制绑定 1 台设备的临时兑换码并写入本地 D1 测试
./scripts/generate-license.sh -t PRO -m 1 -e "2027-06-25T12:00:00Z" --local
```

生成格式为 `EQT-TIER-YYYYMMDD-RANDOM-CHECK`（`CHECK` 为前 3 项拼接后取 SHA-256 前 4 位大写字符校验）。

- **设备解绑闭环**：支持 `/api/v1/device/unbind` (POST) 端点，客户端重置激活时携带硬件指纹自动静默释放服务端 activations 席位并回退 device_registry 状态。
- **固化有效期计算**：带 `duration_days` 的激活码（如 promo / admin 活动码）在首次激活时基于 `activated_at` 固化到期时间，后续 verify 在线对账严格继承该固化值，杜绝动态滚动续期。

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
  1. `/api/v1/paddle/webhook` (POST)：接收 `Paddle-Signature` 利用 HMAC-SHA256 验签。履约 `transaction.completed` 时判断 Lifetime/Yearly 或 `target_license_code` 升级参数。捕获 `transaction.refunded` 或 `subscription.canceled` 时更新状态：
     - **取消订阅语义区分**：`data.effective_from === 'immediately'` 时立即吊销授权并同步将 `device_registry` 降级为 `free`；`next_billing_period`（或默认停续）仅置 `auto_renew = 0` 并保留本期权益至 `expires_at`。
  2. **自动续费开关必须双向同步 Paddle scheduled_change**（2026-08-23 线上复现的 bug 教训）：
     - **关闭**（`auto_renew=0`）：调 Paddle `POST /subscriptions/{id}/cancel`（`effective_from: next_billing_period`，保留本期权益）后，再本地 D1 `auto_renew=0`。
     - **重新开启**（`auto_renew=1`）：**必须同时**调 Paddle `PATCH /subscriptions/{id}` 传 `{"scheduled_change": null}` 移除已排定的周期末取消，再本地 `auto_renew=1`。只改 D1 会导致 UI 显示「自动续费：开启」但 Paddle 周期末仍取消订阅，续费永远不会发生。
     - **恢复已排定取消的官方 API**：`PATCH /subscriptions/{subscription_id}` body `{"scheduled_change": null}`（与 cancel/pause 的 POST 不同，移除类变更用 PATCH）。
     - **回归测试入口**：`npm run test:portal:toggle:offline`（esbuild bundle portal.ts + `node:sqlite`，stub `global.fetch` 断言 OFF→POST cancel、ON→PATCH `scheduled_change:null`、非 purchase 403 且不调 Paddle）。
  2. `/api/v1/paddle/license-query` (GET)：接收 `transaction_id`，供前端支付完成（`checkout.completed`）时轮询弹出新授权码。
  3. `/api/v1/verify` (POST)：客户端对账时透传 `device_id`，与云端硬件漂移容忍机制（`device_id` 匹配 + 至少 1 项非空指纹匹配）闭环对接。

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
- **沙箱与生产真实订单 Refund / Cancel 策略（沙箱走沙箱，生产走生产）**：
  - **真实订单全真模拟**：只要交易号/订阅号符合 Paddle 真实格式（`txn_01...` / `sub_01...`），Portal 上的退款 (`/api/v1/user/refund`) 与取消订阅 (`/api/v1/user/cancel-subscription`) **必须打向对应的真实 Paddle API**（沙箱环境使用 `sandbox-api.paddle.com` 创建 Adjustment 或取消订阅，生产环境使用 `api.paddle.com`）。
  - **严禁对沙箱真实订单执行本地假吊销 (No Local Revoke Bypass for Sandbox Txns)**：确保沙箱环境能够 100% 模拟生产全链路，并由 Paddle 沙箱正常触发 `adjustment.updated` / `subscription.canceled` 等 Webhook 事件实现闭环。
  - **合成夹具专用通道**：本地 `local_only` 瞬时吊销通道仅保留给离线自动化单测的合成 ID（`txn_test_*`、`sub_test_*`），与真实业务解耦。
- **Portal 测试环境自适应标识**：
  - 页面通过 `window.EQT_IS_TEST`（`js/api-base.js` 解析）判断测试环境。
  - 当为测试环境时，Header Logo 旁动态渲染高亮 `TEST` 徽章，页面主区域顶部展示测试环境提示横幅，支持 7 种语言实时国际化切换。

### 9.1 沙箱 Beta 测试白名单约束 (Sandbox Beta Tester Whitelist Constraint)

> **文档 SSOT**：[`docs/test/sandbox-beta-license.md`](../../docs/test/sandbox-beta-license.md)。

测试版激活的防外泄机制：白名单实时查询替代静态 `bound_device_id`，约束叠加在 source/environment 之上。
- **触发判定 `needsSandboxConstraint(source, env, url)`**：`source === 'test'`（测试夹具码）**或** `isTestEnvironment(env, url)`（测试 Worker，覆盖 Paddle sandbox 购买码）→ 任一命中即受约束。即测试码在所有环境受约束、所有码在测试环境受约束。
- **白名单表 `sandbox_beta_testers`**：`(device_id, email, notes, status DEFAULT 'active', created_at)`。`email` 唯一索引 + `device_id` 非唯一普通索引（一个 device 可挂多个 email）。支持在更新已有邮箱时自动 UPSERT 更新绑定的 `device_id` 与备注。
- **实时校验 `assertSandboxTesterAllowed`**：`SELECT * FROM sandbox_beta_testers WHERE LOWER(email)=? AND status='active'` → 记录存在且有 `device_id` 且与**服务端权威 `device_id`**（`registerOrRefreshDevice` 返回值，绝不信任客户端自报）一致才放行，否则 403。白名单校验放在 `!isAlreadyActivated` 分支**外层**——删除登记即阻断已激活设备的再激活与 verify，实现「删设备即失效」。
- **统一标准生命周期管理**：测试激活码遵循标准的 `expires_at` / `duration_days` 生命周期，管理后台可按需发放测试时长（默认 30 天），并通过删除白名单或一键吊销实现实时强行收回权限。
- **Admin 发码顺序「先登记后发码」**：`mint-test-license` 必须先行校验 `sandbox_beta_testers` 存在对应 `(device_id, LOWER(email), status='active')` 记录，否则 400。
- **测试入口**：`npm run test:sandbox:offline`（esbuild 三文件 + `node --experimental-sqlite`），测试组覆盖白名单校验、删白名单阻断激活/verify、仅 email 无 device 不可激活、Paddle 测试购买受白名单约束等。
- **写 helper 时的坑**：`corsHeaders`、`net` 是 handler 局部作用域而非模块级——新 helper 若要用 CORS 头或 `activationClientMeta(request)`，须显式作为参数传入并在两处调用点传值。

---

## 10. 官网与客户门户前后端契约规范 (Website & Portal Contract Guidelines)

- **结构化错误码解耦 (Structured Error Codes)**：
  - **401 Unauthorized / Session Expired**：后端在用户端与管理端 401 响应中必须附带 `error_code: "UNAUTHORIZED"` 或 `error_code: "SESSION_EXPIRED"`（管理端 Cloudflare Access 鉴权响应附带 `error_code: "ACCESS_JWT_REQUIRED"` / `"ACCESS_JWT_INVALID"`）。前端必须优先依据 `res.status === 401` 或 `data.error_code` 进行会话失效拦截和清理登出，严禁依赖多语言错误文案（如 `includes("Session")`）进行业务分支判定。
  - **429 Rate Limiting**：后端 429 响应统一携带 `error_code: "RATE_LIMITED"` 或 `error_code: "TOO_MANY_ATTEMPTS"`。前端依据状态码或错误码启动冷却倒计时，防止字符串多语言不匹配导致冷却定时器异常复位。
- **XSS 纵深防御 (`escapeHtml`)**：
  - 静态页面中通过模板字符串向 `innerHTML` 插入由后端返回的动态字段（如 `license_code`, `device_id`, `paddle_transaction_id`, `paddle_subscription_id`, `revoke_reason` 等）前，必须经由 `escapeHtml()` 函数进行字符实体转义，防止潜在的 DOM 级 XSS。
- **结账与操作防重入单飞锁 (Single-Flight Mutex)**：
  - 在发起异步结账（如 `verifyAndPay`）、退款、取消订阅等不可逆外部交互时，前端组件必须维护 `isVerifying` 或 `inFlight` 互斥锁，并在入口处主动清除防抖计时器，避免并发双击引发多次结账或重复请求。
- **全站语言偏好存储规范 (SSOT Language Key)**：
  - 全站静态页面统一使用 `eqt-lang` 作为 `localStorage` 与 Cookie 的标准键名，读取时向下兼容历史键名 `eqt_lang` 与 `eqt-page-lang`。

---

## 11. Cloudflare D1 瞬态超时容灾与指数退避重试 (D1 Exponential Backoff Retry)

- **边缘存储瞬态超时挑战**：Cloudflare D1 底层 Durable Object 存储操作在特定物理节点网络拥塞或负载抖动时，可能抛出 `D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.`（操作超过 30s 阈值重置）。
- **透明代理重试机制 (`wrapD1WithRetry`)**：
  - 在 `src/index.ts` 顶层 `fetch()` 入口处通过 `wrapD1WithRetry(env.DB)` 实施透明代理包装。
  - 对 `.prepare().bind().first()`, `.all()`, `.run()`, `.raw()`, `.batch()`, `.exec()` 实施统一轻量级指数退避重试（默认最大重试 2 次，总计 3 次尝试，基准间隔 150ms 并附带抖动 jitter）。
  - **错误分类鉴别 (`isRetryableD1Error`)**：
    - **瞬态可重试**：`exceeded timeout`, `object to be reset`, `storage reset`, `D1_RESET`, `database is locked`, `sqlite_busy`, `network connection lost`, `connection reset`, `fetch failed`。
    - **立即终止 (Fail-Fast)**：`UNIQUE constraint failed`, `FOREIGN KEY constraint failed`, `NOT NULL constraint failed`, `CHECK constraint failed`, `syntax error`。
  - **单例与无状态缓存**：使用 `WeakMap` 缓存包装后的 proxy 实例，确保同请求同实例内幂等无开销。
  - **写操作幂等性约束 (Write Idempotency Constraint)**：重试机制对写操作 (`run`, `exec`, `batch`) 生效时，要求底层 SQL 语句必须具备幂等性（如使用 `INSERT OR REPLACE` / `INSERT OR IGNORE` / `UPSERT` / 条件 `UPDATE`），避免在网络超时抖动重试时发生重复插入或非预期的写污染。对于 `activations` INSERT，采用 SQL 条件子句 `WHERE ... AND NOT EXISTS (...)` 防范写超时重试导致的重复激活行，并在 `changes === 0` 时二次检索确认设备激活状态。对于 `device_registry` 新设备注册，采用 `INSERT OR IGNORE` 确保二次重试无异常副作用。

---

## 12. 资金流与履约告警防线 (Money Path Fail-Loud Telegram Alerts)

- **第一性原则 (Fail-Loud Money Path)**：支付收单、授权生成、激活码邮件寄送、退款/吊销等资金与核心履约链路，绝不允许发生“静默失败”。
- **分类升级规则 (`isMoneyPathCategory`)**：
  - 凡命中资金流范畴（`PADDLE_WEBHOOK`、`PADDLE_PRICE_MISCONFIGURATION`、`PADDLE_AMOUNT_MISMATCH`、`SMTP_EMAIL_FAIL`、`DRM_ACTIVATE_FAIL`、`REFUND_MISS_TARGET`、`LICENSE_MINT_FAIL`）的异常，即使日志标记为 `ERROR`，在 `logSystemError` 中必须同步触发 Telegram 实时报警。
  - 顶级未捕获异常（如 Webhook 解析/D1 写入崩毁、SMTP 多次重试彻底断连）强制升级为 `CRITICAL` 级别。
- **Telegram 防炸与 HTML 实体转义约束**：
  - **HTML 严格转义 (`escapeHtml`)**：Telegram Bot API 在 `parse_mode: 'HTML'` 下对未闭合或非法尖括号极度敏感，遇到 `<script>`、`<unknown_tag>` 或含有 `<` / `>` 的异常堆栈/SQL 报错时会直接返回 `400 Bad Request: can't parse entities` 导致报警静默失效。所有外来报错消息、Category、Trace ID、上下文均必须先过 `escapeHtml()` 转义。
  - **敏感字段脱敏 (Secret Redaction)**：告警上下文中的敏感键（包含 `secret|token|password|auth|key`）必须自动截断打码，严禁将明文凭据通过 Telegram 外部接口外泄。
  - **智能滑动窗口频控 (Sliding Window Throttling)**：对每个错误类别建立内存桶（10 分钟最多 3 次），确保首发异常 0 延迟秒级触达，同时防范连环网络雪崩打爆 Telegram Bot 调用额度。

---

## 13. Dev 模式服务端动态鉴权与开发/测试设备管理 (Dev Mode & Device Allowlist)

### 13.1 彻底移除客户端本地硬编码 (Anti-Reverse Engineering)
- **历史问题**：旧版本客户端硬编码判定 `dev == "liyuelong"` 字符串，极易被逆向分析人员通过 `strings` 或 IDA 静态扫描检出。
- **动态授权架构**：彻底拔除本地硬编码，将 Dev 模式权限改为由服务端（DRM API）统一根据权威 Device ID 进行动态鉴权。
- **两重白名单保障**：
  1. **D1 数据库管理**：`sandbox_beta_testers` 表（已增加 `is_dev INTEGER NOT NULL DEFAULT 0` 字段）。
  2. **环境变量静态兜底**：Worker 环境变量 `DEV_DEVICE_IDS`（逗号分隔的 32 位 hex Device ID）。

### 13.2 DRM 接口动态下发与客户端激活
- 服务端在 `/api/v1/device/register`（免费设备注册）、`/api/v1/verify`（在线对账）、`/api/v1/activate`（激活）及 `/api/v1/dev/check-device` 端点中，自动比对 Device ID 并下发 `is_dev: boolean` 字段。
- 客户端在启动匿名注册与在线对账成功后，接收 `is_dev` 并动态调用 `SetServerDevAuthorized(is_dev)`，即时解锁 GUI 前端开发者选项与调试功能。

### 13.3 Admin 控制台独立管理页面
- Admin 后台左侧新增独立的 **🛠️ 开发与测试设备** (`devDevices`) 导航栏，不再混入「授权码管理」页面。
- 提供全套 REST 管理接口：
  - `GET /api/v1/admin/dev-devices`：获取开发与测试设备列表。
  - `POST /api/v1/admin/dev-devices`：录入新设备（支持输入 Device ID、绑定邮箱、备注说明与 Dev 授权开关）。
  - `POST /api/v1/admin/dev-devices/:id/toggle-dev`：一键无缝切换 Dev 模式授权状态。
  - `DELETE /api/v1/admin/dev-devices/:id`：从白名单中删除设备记录。
- **全环境通用**：生产环境 (`production`) 与测试沙箱 (`test`) 均具备完整的开发/测试设备管理能力，数据物理隔离。

---

## 14. 免费用户每日用量云端权威对账与 Ed25519 签名安全规范 (Free Daily Usage Authoritative Sync)

### 14.1 防篡改体系与 Fail-Closed 验签
- **两层防御模型**：
  1. **本地层 (HMAC-SHA256)**：`chat_usage.json` 落盘带硬件密钥派生的 HMAC 签名，任何文本编辑器修改立即触发 `ClockTampered=true` 并锁死为超限状态（600s/5次）。
  2. **云端层 (SSOT + Ed25519 签名)**：客户端通过 `POST /api/v1/device/sync-usage` 上报增量，D1 `free_daily_usage` 表原子累加。服务端使用 `ED25519_PRIVATE_KEY` 对 `{device_id, usage_date, used_seconds, used_transfers, quota_exceeded, server_time}` 进行签名。
- **客户端 Fail-Closed 强制校验**：
  - 客户端收到 sync 响应时，若 `signature` 为空或验签失败（如中间人劫持/伪服务器篡改数据），**强制直接丢弃**响应，不采纳任何云端状态，确保攻击者无法通过伪造服务器清零用量。

### 14.2 部署顺序铁律与密钥配对清单 (Critical Deployment Sequence)
- **发布顺序铁律**：**先配服务端 Secret 并部署 Worker → 再发布新版客户端**。
  - 原因：客户端已实施 Fail-Closed 验签。若先发客户端但服务端未配置 `ED25519_PRIVATE_KEY`，服务端下发的空签名会导致客户端全部拒签，在线免费用户回退为本地离线模式。
- **Secret 注入命令 (SSOT)**：
  - **测试环境**（对应 `env_defaults_dev.go` 中测试公钥 `ce07f02c21cb898bf9d84c9af843dc23e830937f939d8b0a042df7210f74fe58`）：
    ```bash
    cd cloudflare/eqt-drm-api
    echo -n "<test_ed25519_private_key_hex_seed>" | npx wrangler secret put ED25519_PRIVATE_KEY --env test
    ```
  - **生产环境**（对应 `env_defaults.go` 中生产公钥 `08443678fe8bd16e3bc306db8a08b6ea1dcf3e8edeb413f655e106374bed43ac`）：
    ```bash
    cd cloudflare/eqt-drm-api
    echo -n "<prod_ed25519_private_key_hex_seed>" | npx wrangler secret put ED25519_PRIVATE_KEY
    ```
- **密钥格式注意**：`ED25519_PRIVATE_KEY` 必须为 **32-byte seed 的 64 位十六进制字符串**，严禁误填 Base64 编码或带 PEM 标头的格式。

---

## 15. 0 元订单 / 100% 优惠券退款防呆与屏蔽规范 (Zero-Payment Refund Shielding)

- **第一性原理与 Paddle 限制**：
  - Paddle Billing 的 `/adjustments` 退款接口只接受实付捕获金额 > 0 的交易。对于实付 `$0.00` 的订单（如 100% 优惠券、内测 0 元订单），调用 Paddle 退款接口会返回 `adjustment_transaction_without_captured_payment` 错误。
- **端到端屏蔽方案**：
  - **数据层**：`licenses` 表维护 `paid_amount REAL DEFAULT NULL`。Paddle Webhook 在初始发放、续费及升级时持久化实付总金额（`totals.grand_total ?? totals.total`）。
  - **规则层 (`isLicenseRefundable`)**：若 `paid_amount !== null && Number(paid_amount) <= 0`，判定 `refundable: false`。
  - **Portal 页面前端**：许可证列表仅在 `lic.status === 'active' && lic.refundable === true` 时渲染「申请退款」按钮；0 元订单完全隐藏退款入口。
  - **API 服务端前置拦截**：`POST /api/v1/user/refund` 接口前置检查 `isLicenseRefundable` 及 Paddle 交易详情中的总金额，对 $0 订单直接返回 400 与友好提示 `REFUND_NOT_ALLOWED_ZERO_AMOUNT`，严禁向 Paddle 发起无效调整，避免产生无意义的系统异常日志与 Telegram 告警。
