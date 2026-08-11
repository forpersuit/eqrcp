# EQT Admin (`cloudflare/eqt-admin`)

运维管理台：错误审计、授权/订单管控、系统健康概览。  
设计与分阶段计划见仓库 [`docs/admin/`](../../docs/admin/README.md)。  
**生产鉴权（推荐）**：[Cloudflare Access 配置](../../docs/admin/cloudflare-access-setup.md)。

## 技术栈

- Svelte 5 + Vite + TypeScript  
- Vanilla CSS Design Tokens（`src/app.css`）  
- 后端：`eqt-drm-api` 的 `/api/v1/admin/*`  
- 生产：Cloudflare Access JWT only（同源 `/api` 反代）  
- 功能：错误审计、操作审计、授权管控、**黑名单（邮箱/设备）**、系统健康  

## 本地开发

```sh
cd cloudflare/eqt-admin
cp .env.example .env.local
npm install
npm run dev                  # 默认 http://localhost:3001
```

生产请在 `https://admin.eqt.net.im` 经 Cloudflare Access 登录（无 `ADMIN_SECRET`）。

### 环境变量

| 变量 | 说明 |
| :--- | :--- |
| `VITE_API_BASE` | 生产 Access：**留空**（同源 `/api`）。本地可指向 `http://127.0.0.1:8787`。 |
| `VITE_CF_ACCESS_TEAM_DOMAIN` | Access 登出用 team domain（如 `persuit.cloudflareaccess.com`）。 |
| `VITE_CF_ACCESS_TEAM_DOMAIN` | 如 `xxxx.cloudflareaccess.com`，用于 Access 登出。 |

**不要**把真实 secret 写入仓库；secret 仅 secret 模式下存 `sessionStorage`。

## 生产部署

```sh
VITE_ADMIN_AUTH_MODE=access \
VITE_API_BASE= \
VITE_CF_ACCESS_TEAM_DOMAIN=yourteam.cloudflareaccess.com \
npm run build

CLOUDFLARE_API_TOKEN="" npx wrangler pages deploy dist --project-name eqt-admin
```

需已配置 Zero Trust Application + Worker `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD`。

## 脚本

| 命令 | 作用 |
| :--- | :--- |
| `npm run dev` | 开发服务器 |
| `npm run build` | 产出 `dist/`（Functions 在 `functions/` 随 Pages 部署） |
| `npm run preview` | 预览构建结果 |
| `npm run check` | `svelte-check` |

## 目录

```
functions/api/[[path]].ts  # Access JWT 同源反代 → lic.eqt.net.im
src/
  App.svelte
  lib/api.ts               # adminFetch（secret 或 access）
  lib/auth.ts
  pages/
  app.css
```
