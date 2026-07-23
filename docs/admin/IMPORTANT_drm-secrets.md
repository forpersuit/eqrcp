# IMPORTANT — `eqt-drm-api` 环境变量与 Secret 清单

> **SSOT**：Worker 项目 `cloudflare/eqt-drm-api` 生产要配什么、放 **Secret** 还是 **`[vars]`**、值从哪生成。  
> **禁止**把真实口令 / API Key / 私钥提交进 git。

关联：[IMPORTANT_admin-config.md](./IMPORTANT_admin-config.md) · [IMPORTANT_r2-distribution.md](./IMPORTANT_r2-distribution.md) · [IMPORTANT_paddle-api-and-errors.md](./IMPORTANT_paddle-api-and-errors.md) · [ops-guide.md](./ops-guide.md)

---

## 0. 先分清：Secret vs `[vars]` vs 绑定

| 落点 | 谁可见 | 适合放什么 |
| :--- | :--- | :--- |
| **`wrangler secret put`**（Dashboard → Workers → Settings → Variables → Secrets） | 仅运行时；`wrangler.toml` / git **看不到值** | 口令、私钥、API Key、Webhook secret |
| **`wrangler.toml` `[vars]`** 或 Dashboard **Plaintext vars** | 进 git / 明文可见 | **非敏感**公开配置（域名基址、端口、repo 名） |
| **`[[d1_databases]]` 等 binding** | 账号内资源 ID | D1 / 将来 R2 bucket 绑定 |

**规则**：  
- **能公开写进浏览器地址栏的** → 用 vars，**不必** secret。  
- **泄露会导致越权、盗刷、伪造证书** → 必须 secret。

### 常用命令（在 `cloudflare/eqt-drm-api`）

```bash
cd cloudflare/eqt-drm-api

# 列出已配置的 Secret 名称（不含值）
npx wrangler secret list

# 写入 / 覆盖 Secret（交互粘贴，或管道 echo -n）
npx wrangler secret put NAME
echo -n 'value' | npx wrangler secret put NAME

# 删除 Secret
npx wrangler secret delete NAME

# 部署后 vars + secrets 才完整生效
npx wrangler deploy
```

> `secret put` 写入后一般**立即可用**于已部署 Worker；改 `[vars]` 需 **`wrangler deploy`**。  
> 本地：`wrangler dev --var "KEY:value"` 或 `.dev.vars`（勿提交）。

---

## 1. `R2_PUBLIC_URL` 为什么**不必** secret？

**它是公网 CDN 基址**，例如 `https://download.eqt.net.im`。  
用户下载链接本来就会暴露这个域名；没有「保密」价值。

| 误区 | 正解 |
| :--- | :--- |
| 「所有 env 都该 secret put」 | 只有**敏感**才用 Secret |
| 用 `secret put R2_PUBLIC_URL` | **可以**，但多余；Dashboard 里还难改 |
| 推荐做法 | 写在 **`[vars]`** 或 Dashboard **Plaintext** |

```toml
# wrangler.toml（推荐）
[vars]
R2_PUBLIC_URL = "https://download.eqt.net.im"
```

```bash
# 或一次性（非 git 场景也可用，仍不强制 secret）
npx wrangler deploy --var R2_PUBLIC_URL:https://download.eqt.net.im
```

路径约定、zip/exe 见 [IMPORTANT_r2-distribution.md](./IMPORTANT_r2-distribution.md)。  
未配置时：健康 `r2_configured=false`；公开下载 / update-check **503**（不回落 GitHub）。

---

## 2. 全量配置表（按是否必须 Secret）

### 2.1 必须用 **Secret**（生产）

| 名称 | 必填 | 作用 | 如何找到 / 生成 |
| :--- | :---: | :--- | :--- |
| **`ADMIN_SECRET`** | **Admin 是** | `X-Admin-Secret` 鉴权；未配则 `/api/v1/admin/*` → 503 | **自建**：足够长的随机串，如 `openssl rand -base64 32`。仅运维知道；浏览器登录时手输同一值 |
| **`ED25519_PRIVATE_KEY`** | **DRM 激活是** | 签发客户端 license 证书；无则 `/activate` 失败 | **自建一次、永久保管**：64 字符 hex（32 字节 raw seed）。见下方 §3.1。公钥需与客户端校验逻辑一致 |
| **`PADDLE_API_KEY`** | 建议 | Portal 退款；Webhook 缺邮箱时拉 customer；健康深探针 | Paddle → **Developer tools → Authentication → API keys** → 创建 **server-side** key（`pdl_...` / 沙箱 `pdl_sdbx_...`）。Live/Sandbox **各一套**，勿混用 |
| **`PADDLE_WEBHOOK_SECRET`** | **支付履约是** | 校验 `Paddle-Signature` | Paddle → **Developer tools → Notifications** → 选 endpoint（URL 指向 `https://lic.eqt.net.im/api/v1/paddle/webhook`）→ **Secret key**（常 `pdl_ntfset_...`） |
| **`MAIL_SENDER_PASSWORD`** | 发信是 | SMTP AUTH | 你的 SMTP 服务商面板（邮箱密码或应用专用密码） |
| **`GITHUB_TOKEN`** | 可选 | 拉 GitHub release **元数据**（提高 rate limit） | GitHub → Settings → Developer settings → **Personal access tokens** → classic/fine-grained，`public_repo` 或 repo 只读即可。**不是**用户下载源 |

写入示例：

```bash
echo -n 'YOUR_ADMIN_SECRET' | npx wrangler secret put ADMIN_SECRET
echo -n '64hex...' | npx wrangler secret put ED25519_PRIVATE_KEY
echo -n 'pdl_...' | npx wrangler secret put PADDLE_API_KEY
echo -n 'pdl_ntfset_...' | npx wrangler secret put PADDLE_WEBHOOK_SECRET
echo -n 'smtp-password' | npx wrangler secret put MAIL_SENDER_PASSWORD
# 可选
echo -n 'ghp_...' | npx wrangler secret put GITHUB_TOKEN
```

### 2.2 应用 **`[vars]` / Plaintext**（非敏感）

| 名称 | 必填 | 作用 | 如何确定取值 |
| :--- | :---: | :--- | :--- |
| **`R2_PUBLIC_URL`** | **生产下载/更新是** | 安装包公网基址（无尾斜杠） | 你绑定的下载域，如 `https://download.eqt.net.im`；对象在 R2 上路径见 R2 文档 |
| **`MAIL_SENDER`** | 发信是 | SMTP From | 已开通 SMTP 的发件邮箱，如 `noreply@eqt.net.im` |
| **`MAIL_SEND_SERVER`** | 发信是 | SMTP 主机 | 服务商文档，如 `smtpserver.example.com` |
| **`MAIL_SEND_SAFE_PORT`** | 建议 | 默认 `465` | 服务商要求的 TLS 端口 |
| **`GITHUB_REPO`** | 可选 | 默认 `forpersuit/eqrcp` | `owner/repo` 字符串，仅用于读 release 列表 |
| **`TEST_MAIL_RECEIVER`** | 仅测试 | 验证码改寄测试箱 | 开发用；**生产勿依赖** |

### 2.3 绑定（非 env）

| 名称 | 必填 | 配置处 | 如何得到 |
| :--- | :---: | :--- | :--- |
| **`DB`** → D1 `eqt-drm-db` | **是** | `wrangler.toml` `[[d1_databases]]` | `npx wrangler d1 create eqt-drm-db` → 把 `database_id` 写入 toml；`schema.sql` 初始化 |

### 2.4 不在 Worker secret、但相关

| 名称 | 落点 | 说明 |
| :--- | :--- | :--- |
| **`VITE_API_BASE`** | **eqt-admin** Pages 构建 env / 本地 `.env` | 生产 `https://lic.eqt.net.im`（公开，**不是** secret） |
| 运维登录口令 | 浏览器 `sessionStorage` | 与 `ADMIN_SECRET` 相同；**不要**写进 Pages env |

---

## 3. 各 Key 详细：生成 / 在后台哪里点

### 3.1 `ED25519_PRIVATE_KEY`（自建）

代码期望：**64 字符十六进制** = 32 字节 raw private seed。

```bash
# 生成（只做一次；把 hex 存密码管理器 + secret put）
openssl rand -hex 32
echo -n '<输出的64hex>' | npx wrangler secret put ED25519_PRIVATE_KEY
```

轮换私钥会使**旧证书校验策略**受影响（客户端公钥/算法需与签发端一致）。未轮换需求时不要重生成。

### 3.2 `ADMIN_SECRET`（自建）

```bash
openssl rand -base64 32
echo -n '<输出>' | npx wrangler secret put ADMIN_SECRET
```

Admin SPA 登录框输入**完全相同**字符串。轮换后旧会话 401，重新登录即可（见 ops-guide）。

### 3.3 Paddle：`PADDLE_API_KEY` 与 `PADDLE_WEBHOOK_SECRET`

| 变量 | 后台路径 | 形态提示 |
| :--- | :--- | :--- |
| `PADDLE_API_KEY` | [vendors.paddle.com](https://vendors.paddle.com/) → **Developer tools** → **Authentication** → **API keys** → Create | `pdl_...`；sandbox 常 `pdl_sdbx_...` |
| `PADDLE_WEBHOOK_SECRET` | **Developer tools** → **Notifications** → 你的 destination → **Secret key** | 常 `pdl_ntfset_...`；endpoint URL = `https://lic.eqt.net.im/api/v1/paddle/webhook` |

Webhook 与 API Key **必须同一环境**（都 Live 或都 Sandbox）。  
细节与错误审计 category：[IMPORTANT_paddle-api-and-errors.md](./IMPORTANT_paddle-api-and-errors.md)。

### 3.4 SMTP 四元组

| 变量 | 来源 |
| :--- | :--- |
| `MAIL_SENDER` | 发件地址 |
| `MAIL_SENDER_PASSWORD` | **Secret**：SMTP 密码 / App Password |
| `MAIL_SEND_SERVER` | SMTP 主机名 |
| `MAIL_SEND_SAFE_PORT` | 通常 `465`（隐式 TLS） |

Admin 健康页 SMTP 探针会 AUTH 后 QUIT（不发真实业务信）。

### 3.5 `GITHUB_TOKEN` / `GITHUB_REPO`（可选）

- **REPO**：默认 `forpersuit/eqrcp`，可用 vars 覆盖。  
- **TOKEN**：GitHub PAT，只为读 `releases/latest` 元数据，**用户下载不走 GitHub**。

### 3.6 `R2_PUBLIC_URL`（vars）

- 取值：与 R2 自定义域或公开 bucket 网关一致，**https、无尾斜杠**。  
- 对象：`{R2_PUBLIC_URL}/downloads/{version}/{filename}`。  
- **不是** R2 API 密钥；R2 上传用 Wrangler/`rclone`/Dashboard，与本 env 无关。

---

## 4. 生产最小集合（检查表）

按产品能力勾选：

| 能力 | 至少需要 |
| :--- | :--- |
| Admin 登录/发码/吊销 | `DB` + `ADMIN_SECRET` |
| 客户端激活证书 | + `ED25519_PRIVATE_KEY` |
| 发邮件 / 健康 SMTP 绿 | + SMTP 四元组（密码用 Secret） |
| Paddle 自动履约 | + `PADDLE_WEBHOOK_SECRET` |
| Portal 退款 / 补邮箱 / 探针 api_reachable | + `PADDLE_API_KEY` |
| 安装包下载与自动更新 URL | + `R2_PUBLIC_URL`（**vars**） |
| 稳定读 release 元数据 | 可选 `GITHUB_TOKEN` |

**已配置 `PADDLE_API_KEY`（secret put）后**：健康探针应变为 `api_reachable`（200）或继续 `webhook_ok_api_key_invalid`（key 与环境不匹配时）。  
**还缺的常见项**：`R2_PUBLIC_URL` 进 **vars**、`PADDLE_WEBHOOK_SECRET` / SMTP 密码迁出 toml 明文（见债 D9）。

---

## 5. 与当前仓库 `wrangler.toml` 的关系

- 绑定 `DB`、`routes`（`lic.eqt.net.im` / `download.eqt.net.im`）在 toml。  
- **历史**：部分 SMTP / `PADDLE_WEBHOOK_SECRET` 曾写在 `[vars]` 明文 → **应迁 Secret 并轮换**（[IMPORTANT_admin-debt.md](./IMPORTANT_admin-debt.md) D9）。  
- **`R2_PUBLIC_URL` 推荐加进 `[vars]`**，不要为了「统一」硬塞进 Secret。  
- 真实值只以 Cloudflare 控制台 / `wrangler secret list` 为准，**不以 git 为准**。

---

## 6. 配置后自检

```bash
# Secret 名是否存在
npx wrangler secret list

# 健康（需 ADMIN_SECRET）
curl -sS -H "X-Admin-Secret: $ADMIN_SECRET" https://lic.eqt.net.im/api/v1/admin/health | jq '.config, .probes'
# 期望：r2_configured / paddle_configured / smtp_configured / ed25519 / admin_secret 与 probes 符合你的目标
```
