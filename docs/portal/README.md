# EQT 用户 Portal 文档目录 (`docs/portal`)

用户自助授权门户：**`cloudflare/eqt-website/portal.html`** + **`eqt-drm-api`** 的 `/api/v1/auth/*` 与 `/api/v1/user/*`。

与 Admin（`eqt-admin`，持 `ADMIN_SECRET`）**完全分离**：

| | 用户 Portal | 管理 Admin |
| :--- | :--- | :--- |
| 身份 | 购买邮箱 + 邮件验证码会话 | `ADMIN_SECRET` |
| 能力 | 查自己的授权、解绑设备、自助退款 | 全库检索、发码、吊销、审计 |
| 文档 | **本目录** | [`docs/admin/`](../admin/README.md) |

**线上**：页面 `https://www.eqt.net.im/portal.html`，API `https://lic.eqt.net.im`。

支付/DRM 业务背景：[`docs/payment/`](../payment/README.md)。

---

## 阅读顺序

| 顺序 | 文档 | 说明 |
| :---: | :--- | :--- |
| 1 | **[overview.md](./overview.md)** | 产品定位、UI、功能与副作用 |
| 2 | **[api-contract.md](./api-contract.md)** | API 请求/响应契约（改接口先改它） |
| 3 | **[progress.md](./progress.md)** | 修复进度勾选与验证记录 |
| — | `cloudflare/eqt-drm-api/schema.sql` | D1 表结构 SSOT |

---

## 工程落点

| 路径 | 角色 |
| :--- | :--- |
| `cloudflare/eqt-website/portal.html` | 用户自助单页（Tailwind CDN SPA） |
| `cloudflare/eqt-drm-api/src/routes/auth.ts` | 邮箱 OTP 登录 / 登出 |
| `cloudflare/eqt-drm-api/src/routes/portal.ts` | licenses / unbind / refund |
| `cloudflare/eqt-drm-api/src/i18n.ts` | API 与邮件 7 语 i18n |
| `cloudflare/eqt-drm-api/tests/e2e-drm-test.js` | DRM + Portal E2E（`npm run test:e2e`） |
| `desktop/gui/frontend/src/main.js` | About「管理授权」深链 `portal.html?email=` |

---

## 核心能力（一句话）

Portal = **已购用户**的邮箱 OTP 自助台：看授权、解绑设备（365 天滚动 4 次）、Paddle 自助全额退款并即时吊销。
