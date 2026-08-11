# EQT 测试环境 (lic-test.eqt.net.im)

> 本文档说明 EQT 的测试环境如何搭建、配置与部署。测试环境使用专门化的测试子域名与生产完全物理隔离，享受 Cloudflare Anycast CDN 稳定加速，彻底避免 workers.dev 的国内网络超时问题。
> 最后更新：2026-08-10
>
> 关联文档：[部署流水线总览](./README.md)、[GUI 环境开关](./gui-environment.md)

---

## 目录

1. [架构概览](#1-架构概览)
2. [资源与专门化域名表](#2-资源与专门化域名表)
3. [wrangler `[env.test]` 路由设计](#3-wrangler-envtest-路由设计)
4. [一次性搭建步骤(P1)](#4-一次性搭建步骤p1)
5. [测试 API 基地址速查](#5-测试-api-基地址速查)
6. [部署方式](#6-部署方式)
7. [验证清单](#7-验证清单)
8. [成本说明](#8-成本说明)

---

## 1. 架构概览

```
                    ┌─────────────────────────────┐
   dev 分支 push     │  GitHub Actions deploy-test │
        │            └──────────────┬──────────────┘
        │                           │ wrangler deploy --env test
        ▼                           ▼
   生产(现有)                 测试(专属域名)
 ┌──────────────────┐     ┌─────────────────────────────┐
 │ lic.eqt.net.im   │     │ lic-test.eqt.net.im         │
 │ feedback.eqt     │     │ feedback-test.eqt.net.im    │
 │ www.eqt.net.im   │     │ test.eqt.net.im / eqt-test  │
 │ D1/R2 生产资源   │     │ D1/R2 测试资源(-test 后缀)   │
 └──────────────────┘     └─────────────────────────────┘
```

- 测试环境绑定**专属测试自定义域名**（`*-test.eqt.net.im`），拥有独立的 DNS 解析与 SSL 证书，享受 Cloudflare CDN 稳定网络直连。
- 测试环境**不设审批门禁**（`deploy-test.yml`），push 到 `dev` 分支自动部署；master 仍走 `deploy.yml` 的生产审批，互不干扰。
- GUI 开发模式对接测试见 [gui-environment.md](./gui-environment.md)；网页侧通过 `js/api-base.js` 自动识别 `test.eqt.net.im` 与 `*.eqt-test.pages.dev` 切换。

---

## 2. 资源与专门化域名表

| 设施 | 生产环境 (Production) | **测试环境 (Test)** | 用途 |
|---|---|---|---|
| DRM Worker | `eqt-drm-api` (`lic.eqt.net.im`) | `eqt-drm-api-test` (**`lic-test.eqt.net.im`**) | 许可/激活/离线验签 |
| Feedback Worker | `eqt-feedback-api` (`feedback.eqt.net.im`) | `eqt-feedback-api-test` (**`feedback-test.eqt.net.im`**) | 用户反馈/崩溃报告/图片 |
| D1 数据库 | `eqt-drm-db` | `eqt-drm-db-test` | 许可/激活/限流 |
| D1 数据库 | `eqt-feedback-db` | `eqt-feedback-db-test` | 反馈数据 |
| R2 存储桶 | `eqt-crash-reports` | `eqt-crash-reports-test` | 崩溃转储 |
| R2 存储桶 | `eqt-feedback-bucket` | `eqt-feedback-bucket-test` | 反馈图片 |
| Pages 网站 | `eqt` (`www.eqt.net.im`) | `eqt-test` (**`test.eqt.net.im`**) | 沙箱购买/生成测试激活码/客户门户 |
| Paddle 年度价格 | `pri_01kydyzmn1pc29npe377dxtq96` (Live) | `pri_01kxymxqngex49tg65wb0701pc` (Sandbox) | 订阅/续费计费标识 |
| Paddle 终身价格 | `pri_01kyd2nbsmg44rjmvf4vbetgwj` (Live) | `pri_01kyhmkv4ppj10r4cdgw3sv48p` (Sandbox) | 终身买断计费标识 |

### 价格环境变量命名标准 (1:1 对称)

全项目统一采用标准价格变量名，且均在 `cloudflare/eqt-drm-api/wrangler.toml` 的 `[vars]` (生产) 与 `[env.test.vars]` (测试) 中显式声明：
- **年度订阅价格 ID**：`PADDLE_PRICE_ID_PLUS_YEARLY`
- **终身买断价格 ID**：`PADDLE_PRICE_ID_PLUS_LIFETIME`

代码内依据 `isPaddleSandbox` 进行安全拦截：生产 Worker（Live 模式）严禁使用 Sandbox 测试价格，防止出现生产用户支付后静默不铸码的高危隐患。

---

## 3. wrangler `[env.test]` 路由设计

测试 Worker 绑定专属测试子域名，既保证了国内直连的稳定速度，又与生产环境实现了严格的物理路由隔离：

```toml
# cloudflare/eqt-drm-api/wrangler.toml
[env.test]
name = "eqt-drm-api-test"
routes = [
  { pattern = "lic-test.eqt.net.im", custom_domain = true }
]
logpush = false      # 关键:测试账户无 Logpush 权限(code 10023),显式关闭
```

```toml
# cloudflare/eqt-feedback-api/wrangler.toml
[env.test]
name = "eqt-feedback-api-test"
routes = [
  { pattern = "feedback-test.eqt.net.im", custom_domain = true }
]
logpush = false
```

---

## 4. 一次性搭建步骤(P1)

> 前提：本机已 `wrangler login` 并且 Cloudflare 托管了 `eqt.net.im` 区域。

### 4.1 创建 D1 数据库

```bash
cd cloudflare/eqt-drm-api
npx wrangler d1 create eqt-drm-db-test        # 记录返回的 database_id
cd ../eqt-feedback-api
npx wrangler d1 create eqt-feedback-db-test   # 记录 database_id
```

### 4.2 创建 R2 桶

```bash
cd ../eqt-drm-api
npx wrangler r2 bucket create eqt-crash-reports-test
cd ../eqt-feedback-api
npx wrangler r2 bucket create eqt-feedback-bucket-test
```

### 4.3 初始化 schema

```bash
cd ../eqt-drm-api
npx wrangler d1 execute eqt-drm-db-test --remote --file=schema.sql
cd ../eqt-feedback-api
npx wrangler d1 execute eqt-feedback-db-test --remote --file=schema.sql
```

### 4.4 配置 secrets(测试 Worker 独立)

```bash
cd ../eqt-drm-api
echo "<sandbox-paddle-key>"    | npx wrangler secret put PADDLE_API_KEY --env test
#   ↑ 必须是 pdl_sdbx_ 开头的沙箱密钥 —— 这是测试环境识别与激活码 test 标记的判据
echo "<sandbox-webhook-secret>" | npx wrangler secret put PADDLE_WEBHOOK_SECRET --env test
#   ↑ Paddle 沙箱后台创建 Webhook 时生成的 pdl_ntfset_... 密钥。若缺失，Webhook 验签会报 500 导致无法铸码！
echo "2cf5baa872e73d6bc25d69be0f9705adc3cffd00ec72ffdafbe494c3c3afa2e5" | npx wrangler secret put ED25519_PRIVATE_KEY --env test
#   ↑ 测试专用密钥对的 32-byte seed(hex)。GUI 内置公钥已随 eqtdev tag 切换为对应公钥 ce07f0...
echo "<mail-password>"         | npx wrangler secret put MAIL_SENDER_PASSWORD --env test
echo "<telegram-token>"        | npx wrangler secret put TELEGRAM_BOT_TOKEN --env test
cd ../eqt-feedback-api
echo "<telegram-token>"        | npx wrangler secret put TELEGRAM_BOT_TOKEN --env test
```

### 4.5 Paddle 沙箱 Webhook 目的地配置

用于在沙箱结账成功后接收 `transaction.completed` 事件并自动铸造测试激活码：

1. 登录 [Paddle Sandbox Dashboard](https://sandbox-vendors.paddle.com/)；
2. 导航至 **Developer tools** ➜ **Notifications (Webhooks)** ➜ 点击 **New destination**；
3. 配置端点参数：
   - **URL**: `https://lic-test.eqt.net.im/api/v1/paddle/webhook`
   - **Description**: `EQT Test DRM Webhook`
   - **Events 勾选**:
     - `transaction.completed`（必选：沙箱支付成功触发测试激活码铸造）
     - `subscription.created`（订阅创建）
     - `subscription.updated`（订阅更新）
     - `subscription.canceled`（订阅取消）
     - `transaction.revoked` / `transaction.refunded`（退款/撤销）
4. 保存后复制生成的 Webhook Secret (`pdl_ntfset_...`)，执行上文命令写入 `PADDLE_WEBHOOK_SECRET`。

### 4.6 部署测试 Workers

```bash
cd ../eqt-drm-api && npx wrangler deploy --env test
cd ../eqt-feedback-api && npx wrangler deploy --env test
```

### 4.7 部署 Pages 测试站 (eqt-test)

> **⚠️ 首次创建 `eqt-test` Pages 项目的关键设置**：
> Cloudflare Pages 新建项目时 production branch 默认是 `main`。非 production branch 的部署只会出现在 `*.branch.pages.dev` 预览 URL（裸域名 `eqt-test.pages.dev` 会返回 404）。
> 若使用 `dev` 分支部署，首次创建项目时需指定 production branch 为 `dev`：
> ```bash
> npx wrangler pages project create eqt-test --production-branch=dev
> ```
> 或在 Cloudflare 控制台：**Workers & Pages** ➜ **eqt-test** ➜ **Settings** ➜ **Builds & deployments** ➜ **Production branch** 设置为 `dev`。

```bash
cd ../eqt-website
npx wrangler pages deploy ./ --project-name=eqt-test --branch=dev
```

---

## 5. 测试 API 基地址速查

| 客户端 | 测试基地址 | 切换方式 |
|---|---|---|
| **GUI 桌面端** | `https://lic-test.eqt.net.im` | `wails dev -tags eqtdev` 或 `go build -tags eqtdev` (见 [gui-environment.md](./gui-environment.md)) |
| **网页(pricing/portal/index)** | `https://test.eqt.net.im` / `https://eqt-test.pages.dev` | `js/api-base.js` 自动识别：访问测试域名自动路由至 `lic-test.eqt.net.im`，其余走生产 |
| **admin 面板** | 生产 (不变) | `DRM_API_UPSTREAM` 环境变量可覆盖 |

---

## 6. 部署方式

- **自动**：push 到 `dev` 分支 ➜ `deploy-test.yml` 自动构建部署两个测试 Worker 与 `eqt-test` Pages 测试站。
- **手动**：GitHub ➜ Actions ➜ **Deploy Test** ➜ **Run workflow**。
- **本地**：
  ```bash
  cd cloudflare/eqt-drm-api && npx wrangler deploy --env test
  cd cloudflare/eqt-feedback-api && npx wrangler deploy --env test
  cd cloudflare/eqt-website && npx wrangler pages deploy ./ --project-name=eqt-test --branch=dev
  ```

---

## 7. 验证清单

| 检查项 | 命令/URL | 预期结果 |
|---|---|---|
| 生产健康检查 | `curl -I https://lic.eqt.net.im/api/v1/health` | `200 OK` |
| 测试 DRM 健康检查 | `curl https://lic-test.eqt.net.im/api/v1/health` | `{"status":"healthy",...}` |
| 测试 Feedback 健康检查 | `curl https://feedback-test.eqt.net.im/api/v1/health` | `{"status":"healthy",...}` |
| 测试激活码激活 | `wails dev -tags eqtdev` 激活测试码 | 秒级直连 `lic-test.eqt.net.im`，激活成功 |
| 网页自适应识别 | 打开 `https://eqt-test.pages.dev/pricing.html` 查看 Network | API 发往 `lic-test.eqt.net.im` |
| dev 分支自动部署 | push dev ➜ Actions Deploy Test | 自动部署 + Telegram 通知 |

---

## 8. 成本说明

- D1 免费额度 500 万行读/天、10 万行写/天，测试用量远低于此，**近零成本**。
- R2 免费额度 10 GB 存储 / 100 万次读 / 100 万次写，测试桶几乎不产生成本。
- Custom Domain 自定义子域名由 Cloudflare 免费提供，无额外费用。
