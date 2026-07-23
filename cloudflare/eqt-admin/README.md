# EQT Admin (`cloudflare/eqt-admin`)

运维管理台：错误审计、授权/订单管控、系统健康概览。  
设计与分阶段计划见仓库 [`docs/admin/`](../../docs/admin/README.md)。

## 技术栈

- Svelte 5 + Vite + TypeScript  
- Vanilla CSS Design Tokens（`src/app.css`）  
- 后端：`eqt-drm-api` 的 `/api/v1/admin/*`（Header `X-Admin-Secret`）

## 本地开发

```sh
cd cloudflare/eqt-admin
cp .env.example .env.local   # 按需修改 VITE_API_BASE
npm install
npm run dev                  # 默认 http://localhost:3001
```

浏览器打开后输入 Cloudflare Worker 上配置的 `ADMIN_SECRET`。

### 环境变量

| 变量 | 说明 |
| :--- | :--- |
| `VITE_API_BASE` | DRM API 根，无尾斜杠。生产示例：`https://lic.eqt.net.im`。未设置时见 `src/lib/api.ts` fallback。 |

**不要**把真实 secret 写入仓库或 `.env` 提交内容；secret 仅存浏览器 `sessionStorage`。

## 脚本

| 命令 | 作用 |
| :--- | :--- |
| `npm run dev` | 开发服务器 |
| `npm run build` | 产出 `dist/` |
| `npm run preview` | 预览构建结果 |
| `npm run check` | `svelte-check` |

## 当前阶段说明

以 `docs/admin/progress.md` 为准。阶段 0 仅完成文档与契约对齐；**授权页设备解绑等需阶段 1 后端契约修复后才可靠**。请勿在契约未对齐前扩展新功能。

## 目录

```
src/
  App.svelte           # 鉴权门 + 侧栏四模块
  lib/api.ts           # adminFetch + X-Admin-Secret
  lib/auth.ts          # sessionStorage secret
  pages/               # Login / Overview / ErrorAudit / Licenses / SystemHealth
  app.css              # tokens + 通用组件类
```
