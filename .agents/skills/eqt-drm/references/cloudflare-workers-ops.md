# Cloudflare Workers & D1 运维避坑与容灾告警参考手册

本参考文档收录 Cloudflare D1/Worker 环境变量干扰、交互式 Secret 注入、测试环境 workers.dev 路由继承大坑、D1 瞬态超时指数退避重试以及资金流 Telegram Fail-Loud 告警防线。

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

