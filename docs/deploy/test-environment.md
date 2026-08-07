# EQT 测试环境(workers.dev)

> 本文档说明 EQT 的测试环境如何搭建、配置与部署。测试环境与生产完全隔离,用于激活码全链路 E2E 验证,用量极小、近零成本。
> 最后更新:2026-08-07
>
> 关联文档:[部署流水线总览](./README.md)、[GUI 环境开关](./gui-environment.md)

---

## 目录

1. [架构概览](#1-架构概览)
2. [资源命名表](#2-资源命名表)
3. [wrangler `[env.test]` 安全要点](#3-wrangler-envtest-安全要点)
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
   生产(现有)                 测试(本文档)
 ┌──────────────────┐     ┌─────────────────────────────┐
 │ lic.eqt.net.im   │     │ eqt-drm-api-test.<sub>.workers.dev │
 │ feedback.eqt     │     │ eqt-feedback-api-test.<sub>.workers.dev │
 │ www.eqt.net.im   │     │ (可选) eqt-test.pages.dev   │
 │ D1/R2 生产资源   │     │ D1/R2 测试资源(-test 后缀)   │
 └──────────────────┘     └─────────────────────────────┘
```

- 测试 Worker 只走 **workers.dev 子域**,不挂任何自定义域名。
- 测试环境**不设审批门禁**(`deploy-test.yml`),定位快速迭代;master 仍走 `deploy.yml` 的生产审批,互不干扰。
- GUI 开发模式对接测试见 [gui-environment.md](./gui-environment.md);网页侧通过 `js/api-base.js` 自动切换(见 §5)。

## 2. 资源命名表

| 设施 | 生产(现状) | 测试(新建) | 用途 |
|---|---|---|---|
| Worker | `eqt-drm-api` (lic.eqt.net.im) | `eqt-drm-api-test` (workers.dev) | 许可/激活/验证 |
| Worker | `eqt-feedback-api` (feedback.eqt.net.im) | `eqt-feedback-api-test` (workers.dev) | 反馈/图片 |
| D1 | `eqt-drm-db` | `eqt-drm-db-test` | 许可/激活/限流 |
| D1 | `eqt-feedback-db` | `eqt-feedback-db-test` | 反馈数据 |
| R2 | `eqt-crash-reports` | `eqt-crash-reports-test` | 崩溃上报 |
| R2 | `eqt-feedback-bucket` | `eqt-feedback-bucket-test` | 反馈图片 |
| R2 | `eqt-downloads` | (可选) `eqt-downloads-test` | 更新包分发 |
| Pages | `eqt` (www) | (可选) `eqt-test` | 测试门户/结账 |

> 可选资源(`eqt-downloads-test`、`eqt-test` Pages、admin 测试环境)测试阶段不需要,需要时再建。admin 面板保持直连生产(`DRM_API_UPSTREAM` 已支持覆盖),由运维自己看,不需要独立测试环境。

## 3. wrangler `[env.test]` 安全要点

wrangler 的 `vars` / `d1_databases` / `r2_buckets` 等 binding 是 **non-inheritable**,`[env.test]` 必须显式重声明;而 **`routes` 是 inheritable**——若不显式清空,测试 Worker 会**继承生产自定义域名路由并抢占生产**。`logpush` 同样 inheritable,但测试账户通常无 Logpush 权限(`code 10023`,部署即报错),必须显式关闭。因此:

```toml
[env.test]
name = "eqt-drm-api-test"
workers_dev = true   # 关键:启用 workers.dev 子域
routes = []          # 关键:显式清空,绝不继承生产路由
logpush = false      # 关键:测试账户无 Logpush 权限(code 10023),必须显式关闭
```

已按此约定写入 `cloudflare/eqt-drm-api/wrangler.toml` 与 `cloudflare/eqt-feedback-api/wrangler.toml` 的 `[env.test]` 块。

> 2026-08-07 已实际部署,子域为 **`leeyelon`**(`eqt-drm-api-test.leeyelon.workers.dev` / `eqt-feedback-api-test.leeyelon.workers.dev`),占位符已全部回填。

## 4. 一次性搭建步骤(P1)

> 前提:本机已 `wrangler login`。以下命令只需执行一次。

### 4.1 启用 workers.dev 子域

账户因生产自定义域名 routes 会把 `workers_dev` 推断为 false,首次 `deploy --env test` 前必须在仪表盘显式启用:

> Cloudflare 控制台 → **Workers & Pages** → **Settings** → **Enable Workers.dev**

### 4.2 创建 D1 数据库

```bash
cd cloudflare/eqt-drm-api
npx wrangler d1 create eqt-drm-db-test        # 记录返回的 database_id
cd ../eqt-feedback-api
npx wrangler d1 create eqt-feedback-db-test   # 记录 database_id
```

### 4.3 创建 R2 桶

```bash
cd ../eqt-drm-api
npx wrangler r2 bucket create eqt-crash-reports-test
cd ../eqt-feedback-api
npx wrangler r2 bucket create eqt-feedback-bucket-test
```

### 4.4 回填占位符

把两个 `wrangler.toml` 的 `database_id` 占位符(`<TEST_DRM_DB_ID>` / `<TEST_FEEDBACK_DB_ID>`)替换为 4.2 记录的 ID。

### 4.5 初始化 schema

```bash
cd ../eqt-drm-api
npx wrangler d1 execute eqt-drm-db-test --remote --file=schema.sql
cd ../eqt-feedback-api
npx wrangler d1 execute eqt-feedback-db-test --remote --file=schema.sql
```

### 4.6 配置 secrets(测试 Worker 独立)

```bash
cd ../eqt-drm-api
echo "<sandbox-paddle-key>" | npx wrangler secret put PADDLE_API_KEY --env test
#   ↑ 必须是 pdl_sdbx_ 开头的沙箱密钥 —— 这是测试环境识别与激活码 test 标记的判据
echo "<mail-password>"      | npx wrangler secret put MAIL_SENDER_PASSWORD --env test
echo "<telegram-token>"     | npx wrangler secret put TELEGRAM_BOT_TOKEN --env test
cd ../eqt-feedback-api
echo "<telegram-token>"     | npx wrangler secret put TELEGRAM_BOT_TOKEN --env test
```

### 4.7 部署前安全验证(--dry-run)

```bash
cd ../eqt-drm-api
npx wrangler deploy --env test --dry-run   # 确认 resolved routes 为空、binding 指向 -test 资源
cd ../eqt-feedback-api
npx wrangler deploy --env test --dry-run
```

### 4.8 首次部署并记录 URL

```bash
cd ../eqt-drm-api && npx wrangler deploy --env test
cd ../eqt-feedback-api && npx wrangler deploy --env test
```

部署输出会打印 workers.dev URL,形如 `eqt-drm-api-test.<subdomain>.workers.dev`。**记下 `<subdomain>`**,用于回填:
- `pkg/server/env_defaults_dev.go` / `desktop/crash/env_defaults_dev.go` 的 `<subdomain>` 占位符
- `cloudflare/eqt-website/js/api-base.js` 的 `TEST_API` 占位符

### 4.9 双健康检查(防抢占生产)

```bash
# 生产必须仍 200(未被测试 Worker 抢占)
curl -sI https://lic.eqt.net.im/api/v1/health | head -1
# 测试返回 healthy
curl -s https://eqt-drm-api-test.<subdomain>.workers.dev/api/v1/health
# → {"status":"healthy","d1":{"connected":true},"r2":{"connected":true}}
curl -s https://eqt-feedback-api-test.<subdomain>.workers.dev/api/v1/health
```

## 5. 测试 API 基地址速查

| 客户端 | 测试基地址 | 切换方式 |
|---|---|---|
| GUI 桌面端 | `https://eqt-drm-api-test.<subdomain>.workers.dev` | `wails dev -tags eqtdev`(见 gui-environment.md) |
| 网页(pricing/portal/index) | 同上 | `js/api-base.js` 自动:`*.eqt-test.pages.dev` 或 `test.eqt.net.im` → 测试,其余 → 生产 |
| admin 面板 | 生产(不变) | `DRM_API_UPSTREAM` 环境变量 |

## 6. 部署方式

- **自动**:push 到 `dev` 分支 → `deploy-test.yml` 自动部署两个测试 Worker(`cancel-in-progress` 保证只留最新)。首次需资源建好(§4)。
- **手动**:GitHub → Actions → **Deploy Test** → **Run workflow**(任意分支)。
- **本地**:`npx wrangler deploy --env test`(需 `CLOUDFLARE_API_TOKEN` 或本机登录)。

## 7. 验证清单

| 检查项 | 命令/URL | 预期结果 |
|---|---|---|
| 生产未被抢占 | `curl -I https://lic.eqt.net.im/api/v1/health` | `200 OK` |
| 测试健康检查 | `curl https://eqt-drm-api-test.<sub>.workers.dev/api/v1/health` | `{"status":"healthy",...}` |
| 激活码 test 标记 | 沙箱购买后查测试 D1 `licenses.source` | `'test'` |
| 测试 GUI 激活 | `wails dev -tags eqtdev` 激活测试码 | 走测试 Worker,激活成功 |
| 网页切换 | 测试站打开 pricing,Network 看请求域名 | 发往测试 Worker |
| dev 分支自动部署 | push dev → Actions Deploy Test | 自动部署 + Telegram 通知 |

## 8. 成本说明

- D1 免费额度 500 万行读/天、10 万行写/天,测试用量(激活码 E2E、反馈)远低于此,**近零成本**。
- R2 免费额度 10 GB 存储 / 100 万次读 / 100 万次写,测试桶几乎不产生成本。
- workers.dev 子域无额外费用。
