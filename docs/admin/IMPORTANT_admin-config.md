# IMPORTANT — Admin 运行所需配置参数

> **必读**：`eqt-admin`（前端）与 `eqt-drm-api`（后端 Admin API）要正常跑通，依赖下列环境与绑定。  
> 与用户 Portal 无关。禁止把真实 secret 提交进 git。

关联：[IMPORTANT_admin-release.md](./IMPORTANT_admin-release.md) · [ops-guide.md](./ops-guide.md) · [api-contract.md](./api-contract.md)

---

## 1. 最小可运行（Admin 主链路）

下列为 **登录 + 四主 Tab + 发码/吊销/解绑/日志** 的最低集合。

| 层级 | 名称 | 放哪里 | 必填 | 作用 |
| :--- | :--- | :--- | :---: | :--- |
| Worker 绑定 | `DB` (D1 `eqt-drm-db`) | `wrangler.toml` `[[d1_databases]]` | **是** | licenses / activations / logs / audit |
| Worker Secret | `ADMIN_SECRET` | `wrangler secret put ADMIN_SECRET` | **是** | Admin 鉴权；**未配置则全部 `/api/v1/admin/*` → 503** |
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
| `PADDLE_API_KEY` | 可选 | 健康页对 Paddle API 深探针 | 无 key 时 mode=`webhook_secret_present`；key 无效 403 时 mode=`webhook_ok_api_key_invalid`（Webhook 仍算 ok） |
| `R2_PUBLIC_URL` | 可选 | 更新包 CDN；健康徽章 | `r2_configured=false` |
| `GITHUB_TOKEN` / `GITHUB_REPO` | 可选 | 下载/更新元数据 | 非 Admin 主路径 |

发码勾选「发邮件」时依赖 SMTP 四元组；`send_email:false` 仅写库不发信。

---

## 3. 域名与 CORS

| 项 | 要求 |
| :--- | :--- |
| Admin 前端 | 生产 `https://admin.eqt.net.im`（Pages 项目 `eqt-admin`） |
| DRM API | 生产 `https://lic.eqt.net.im`（Worker `eqt-drm-api`） |
| CORS | Worker `getCorsHeaders`：Origin 含 `eqt.net.im` / `pages.dev` / `localhost` / `127.0.0.1` 时回显该 Origin；Methods 含 **DELETE** |
| 前端请求 | 仅 Header `X-Admin-Secret`；**禁止**依赖 `?secret=` |

---

## 4. 参数落位对照（避免放错）

| 参数 | Worker Secret | wrangler `[vars]` | Pages 构建 env | 浏览器 sessionStorage |
| :--- | :---: | :---: | :---: | :---: |
| `ADMIN_SECRET` | ✅ 推荐唯一落点 | ❌ 勿提交明文 | — | 登录后缓存副本 |
| `ED25519_PRIVATE_KEY` | ✅ | ❌ | — | — |
| SMTP / Paddle webhook | 敏感项用 Secret 更安全 | 现状可能在 vars（宜迁 Secret） | — | — |
| `VITE_API_BASE` | — | — | ✅ 构建期写入 bundle | — |
| 运维口令（与 ADMIN_SECRET 相同） | — | — | ❌ 不要写进前端 env 发布 | ✅ 登录输入 |

**注意**：`VITE_*` 在 `npm run build` 时打进静态 JS，只能放 **公开 API 基址**，绝不能放 `ADMIN_SECRET`。

---

## 5. 自检清单（配置是否够）

1. `curl -sI https://admin.eqt.net.im/` → 200  
2. `curl -s https://lic.eqt.net.im/api/v1/admin/health` → **401**（无 secret 被拒，说明路由存活）  
3. 带正确 `X-Admin-Secret` 的 health → 200，且 `config.admin_secret_configured=true`，`probes.db.ok=true`  
4. SPA 登录成功 → Overview KPI 有数；发码能返回 `license_code`  
5. 健康页 SMTP 探针：env 齐全时应对 **通过**（非仅 CONFIGURED）

更细的密钥轮换与 D1 应急见 [ops-guide.md](./ops-guide.md)。
