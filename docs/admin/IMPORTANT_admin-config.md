# IMPORTANT — Admin 运行所需配置参数

> **必读**：`eqt-admin`（前端）与 `eqt-drm-api`（后端 Admin API）要正常跑通，依赖下列环境与绑定。  
> 与用户 Portal 无关。禁止把真实 secret 提交进 git。

**DRM 全量 Secret / vars 清单与「如何生成 key」** → [IMPORTANT_drm-secrets.md](./IMPORTANT_drm-secrets.md)（**优先读**）。

关联：[IMPORTANT_admin-release.md](./IMPORTANT_admin-release.md) · [ops-guide.md](./ops-guide.md) · [api-contract.md](./api-contract.md)

---

## 1. 最小可运行（Admin 主链路）

下列为 **登录 + 四主 Tab + 发码/吊销/解绑/日志** 的最低集合。

| 层级 | 名称 | 放哪里 | 必填 | 作用 |
| :--- | :--- | :--- | :---: | :--- |
| Worker 绑定 | `DB` (D1 `eqt-drm-db`) | `wrangler.toml` `[[d1_databases]]` | **是** | licenses / activations / logs / audit |
| Worker Secret | `ADMIN_SECRET` | `wrangler secret put ADMIN_SECRET` | 本地/过渡 **是**；生产可关 | Secret 路径；Access 生产可 `CF_ACCESS_REQUIRE_JWT=true` 禁用 |
| Worker | `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` | secret 或 vars | 生产 **推荐** | Cloudflare Access JWT 校验；见 [cloudflare-access-setup.md](./cloudflare-access-setup.md) |
| Worker | `CF_ACCESS_ALLOWED_EMAILS` | vars | 建议 | 默认 `admin@eqt.net.im` |
| Worker | `CF_ACCESS_REQUIRE_JWT` | vars | 生产锁死时 **true** | 禁用 `X-Admin-Secret` |
| Worker Secret | `ED25519_PRIVATE_KEY` | `wrangler secret put` | 建议是* | 客户端激活签证书；Admin 列表/发码不依赖，但健康页与整体 DRM 需要 |
| 前端构建 | `VITE_API_BASE` | Pages 构建环境 / 本地 `.env` | **是** | API 根 URL，**无尾斜杠**；生产必须 `https://lic.eqt.net.im` |
| 浏览器运行时 | 运维输入的 Secret | 仅 `sessionStorage`（键 `eqt_admin_secret`） | **是** | 与 Worker `ADMIN_SECRET` 一致；关闭标签即清 |

\* 无 Ed25519 时：Admin SPA 仍可登录与管授权；客户端 `/activate` 会失败。健康页会显示 Ed25519 未配置。

### 本地最小示例

**后端**（`cloudflare/eqt-drm-api`）：

```bash
npx wrangler d1 execute eqt-drm-db --local --file=./schema.sql
npx wrangler dev --local --port 8787 --var "ADMIN_SECRET:your-dev-secret"
# 生产用 secret put，勿长期把 secret 写进 wrangler.toml [vars]
```

**前端**（`cloudflare/eqt-admin`）：

```bash
# .env.local 或 .env（勿提交真实 secret）
VITE_API_BASE=http://127.0.0.1:8787
# 可选：本地脚本/自测用，浏览器仍以登录框输入为准
# ADMIN_SECRET=your-dev-secret

npm run dev   # 默认 :3001
```

浏览器打开管理台 → 输入与 Worker 相同的 `ADMIN_SECRET`。

---

## 2. 健康探针与发信（建议生产齐全）

| 名称 | 必填 | 作用 | 缺省表现 |
| :--- | :---: | :--- | :--- |
| `MAIL_SENDER` | 发信/SMTP 探针 | 发件人 | `smtp_configured=false`；探针 `skipped` |
| `MAIL_SENDER_PASSWORD` | 同上 | SMTP 密码 | 同上 |
| `MAIL_SEND_SERVER` | 同上 | SMTP 主机 | 同上 |
| `MAIL_SEND_SAFE_PORT` | 建议 | 默认 465 | 缺则探针/发信用 465 |
| `PADDLE_WEBHOOK_SECRET` | 支付履约 | Webhook 验签 | `paddle_configured=false`；探针 skipped/失败 |
| `PADDLE_API_KEY` | 建议（Portal 退款/补邮箱） | REST API；健康深探针 | 生成与用途见 [IMPORTANT_paddle-api-and-errors.md](./IMPORTANT_paddle-api-and-errors.md)；无效 403 → mode=`webhook_ok_api_key_invalid`（Webhook 仍 ok） |
| `R2_PUBLIC_URL` | **生产下载/更新必填** | 安装包 CDN 基址 | **用 `[vars]`，非 secret**（公开 URL）。未配：`r2_configured=false`；下载/update **503**。见 [IMPORTANT_r2-distribution.md](./IMPORTANT_r2-distribution.md) |
| `GITHUB_TOKEN` / `GITHUB_REPO` | 可选 | **仅**拉 release **元数据**（版本/changelog/资产名列表） | TOKEN 用 secret；REPO 用 vars。用户下载不指向 GitHub |

发码勾选「发邮件」时依赖 SMTP 四元组；`send_email:false` 仅写库不发信。  
生成路径与 Secret 清单：[IMPORTANT_drm-secrets.md](./IMPORTANT_drm-secrets.md)。

---

## 3. 域名与 CORS

| 项 | 要求 |
| :--- | :--- |
| Admin 前端 | 生产 `https://admin.eqt.net.im`（Pages 项目 `eqt-admin`）+ **Cloudflare Access** |
| DRM API | 生产 `https://lic.eqt.net.im`（Worker `eqt-drm-api`） |
| 同源反代 | Pages `functions/api/[[path]].ts`：`admin.../api/*` → `lic.../api/*` 并转发 Access JWT |
| CORS | Worker `getCorsHeaders`：Origin 含 `eqt.net.im` / `pages.dev` / `localhost` / `127.0.0.1` 时回显该 Origin；Methods 含 **DELETE** |
| 前端请求 | Access 模式：同源 `/api` + JWT；Secret 模式：`X-Admin-Secret`；**禁止** `?secret=` |

---

## 4. 参数落位对照（避免放错）

| 参数 | Worker Secret | wrangler `[vars]` | Pages 构建 env | 浏览器 sessionStorage |
| :--- | :---: | :---: | :---: | :---: |
| `ADMIN_SECRET` | ✅ 唯一推荐 | ❌ 勿提交明文 | — | 登录后缓存副本 |
| `ED25519_PRIVATE_KEY` | ✅ | ❌ | — | — |
| `PADDLE_API_KEY` / `PADDLE_WEBHOOK_SECRET` | ✅ | ❌ 勿长期明文 | — | — |
| `MAIL_SENDER_PASSWORD` | ✅ | ❌ | — | — |
| `MAIL_SENDER` / `MAIL_SEND_SERVER` / port | 可选 | ✅ 可明文 | — | — |
| **`R2_PUBLIC_URL`** | ❌ **不必** | ✅ **推荐** | — | — |
| `GITHUB_TOKEN` | ✅ 可选 | ❌ | — | — |
| `GITHUB_REPO` | — | ✅ 可选 | — | — |
| `VITE_API_BASE` | — | — | ✅ 构建期；生产 Access 模式**留空**（同源 `/api`） | — |
| `VITE_ADMIN_AUTH_MODE` | — | — | ✅ `access` / `secret` | — |
| `VITE_CF_ACCESS_TEAM_DOMAIN` | — | — | ✅ Access 登出用 | — |
| 运维口令（与 ADMIN_SECRET 相同） | — | — | ❌ 不要写进前端 env 发布 | ✅ 仅 secret 模式 |

**注意**：`VITE_*` 在 `npm run build` 时打进静态 JS，只能放 **公开配置**，绝不能放 `ADMIN_SECRET`。Access 配置见 [cloudflare-access-setup.md](./cloudflare-access-setup.md)。

---

## 5. 自检清单（配置是否够）

1. `curl -sI https://admin.eqt.net.im/` → 200  
2. `curl -s https://lic.eqt.net.im/api/v1/admin/health` → **401**（无 secret 被拒，说明路由存活）  
3. 带正确 `X-Admin-Secret` 的 health → 200，且 `config.admin_secret_configured=true`，`probes.db.ok=true`  
4. SPA 登录成功 → Overview KPI 有数；发码能返回 `license_code`  
5. 健康页 SMTP 探针：env 齐全时应对 **通过**（非仅 CONFIGURED）

更细的密钥轮换与 D1 应急见 [ops-guide.md](./ops-guide.md)。
