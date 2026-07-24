# Cloudflare Access 保护 EQT Admin（推荐方案）

> **目标**：`admin.eqt.net.im` 仅 `admin@eqt.net.im` 可进；Admin API 校验 Access JWT，生产可关闭长期 `ADMIN_SECRET`。  
> **关联代码**：Worker `requireAdminAuth` + `cf-access-jwt.ts`；Pages `functions/api/[[path]].ts` 同源反代。

---

## 架构

```text
运维浏览器
    │ 1) Cloudflare Access 登录（邮箱 OTP / PIN）
    ▼
https://admin.eqt.net.im          ← Zero Trust Application
    │ SPA + 同源 fetch /api/v1/admin/*
    ▼
Pages Function  functions/api/[[path]].ts
    │ 转发 Cf-Access-Jwt-Assertion
    ▼
https://lic.eqt.net.im/api/v1/admin/*
    │ Worker 校验 JWT（iss/aud/exp/email allowlist）
    ▼
D1 / 发码 / 吊销 …
```

**为何需要同源反代**：Access JWT 默认挂在 `admin.eqt.net.im`，不会自动带到 `lic.eqt.net.im`。反代把 JWT 原样转给 Worker。

---

## P0 — Zero Trust 控制台配置（约 15 分钟）

1. 登录 [Cloudflare Zero Trust](https://one.dash.cloudflare.com/)  
2. **Access → Applications → Add an application → Self-hosted**  
3. 填写：  
   - **Application name**: `EQT Admin`  
   - **Session Duration**: 建议 24h  
   - **Application domain**: `admin.eqt.net.im`（路径 `/`）  
4. **Policy**：  
   - Action: **Allow**  
   - Include: **Emails** → `admin@eqt.net.im`  
   - （可选）再加备份邮箱  
5. **Identity providers**：启用 **One-time PIN**（邮件验证码）即可  
6. 保存后打开 Application → **Overview / Settings**，复制：  
   - **Application Audience (AUD)** → 写入 Worker `CF_ACCESS_AUD`  
   - Team domain 形如 `xxxx.cloudflareaccess.com` → `CF_ACCESS_TEAM_DOMAIN`

### 验证 P0

浏览器无痕窗口打开 `https://admin.eqt.net.im`：

- 应跳转 Cloudflare Access 登录  
- 非 allowlist 邮箱无法进入  
- 通过后才看到 Admin SPA  

此时若 Worker **尚未**配 JWT，仍可用页面内 Secret 登录（过渡期）。

---

## P1 — Worker 环境变量

在 `eqt-drm-api`：

```bash
cd cloudflare/eqt-drm-api

# 必填（启用 Access JWT 路径）
echo -n "yourteam.cloudflareaccess.com" | CLOUDFLARE_API_TOKEN="" npx wrangler secret put CF_ACCESS_TEAM_DOMAIN
# 或 vars（非高敏）：也可放 wrangler.toml [vars]

echo -n "<AUD-from-dashboard>" | CLOUDFLARE_API_TOKEN="" npx wrangler secret put CF_ACCESS_AUD

# 可选：默认已是 admin@eqt.net.im
# CF_ACCESS_ALLOWED_EMAILS=admin@eqt.net.im

# 过渡期：仍允许 X-Admin-Secret（默认 true）
# CF_ACCESS_ALLOW_SECRET=true

# 生产锁死：只认 JWT，拒绝 Secret
# CF_ACCESS_REQUIRE_JWT=true
```

建议 **先** 配齐 `TEAM_DOMAIN` + `AUD` 并验证 JWT 登录成功，**再** 设 `CF_ACCESS_REQUIRE_JWT=true`。

`ADMIN_SECRET` 可保留作 break-glass（仅 `REQUIRE_JWT` 未开时有效），或轮换后仅本地 `wrangler dev` 使用。

---

## P1 — Admin 前端 / Pages

| 环境 | `VITE_API_BASE` | `VITE_ADMIN_AUTH_MODE` | `VITE_CF_ACCESS_TEAM_DOMAIN` |
| :--- | :--- | :--- | :--- |
| 本地 | `http://127.0.0.1:8787` | `secret`（默认） | — |
| 生产 Pages | **留空**（同源 `/api`） | `access` 或依赖 hostname 自动 | `yourteam.cloudflareaccess.com`（登出用） |

部署：

```bash
cd cloudflare/eqt-admin
# 生产构建示例
VITE_ADMIN_AUTH_MODE=access \
VITE_API_BASE= \
VITE_CF_ACCESS_TEAM_DOMAIN=yourteam.cloudflareaccess.com \
npm run build

CLOUDFLARE_API_TOKEN="" npx wrangler pages deploy dist --project-name eqt-admin
```

确保 **Functions** 随 Pages 部署（仓库内 `functions/api/[[path]].ts`）。

可选 Pages 环境变量：`DRM_API_UPSTREAM=https://lic.eqt.net.im`。

---

## 鉴权优先级（Worker）

1. 若配置了 Access：`Cf-Access-Jwt-Assertion` 验签成功且 email 在 allowlist → **通过**  
2. 否则若允许 Secret：`X-Admin-Secret` 匹配 → **通过**（限流）  
3. `CF_ACCESS_REQUIRE_JWT=true` → 仅 1  

---

## 验收清单

| # | 步骤 | 期望 |
| :---: | :--- | :--- |
| 1 | 未登录访问 admin | Access 登录页 |
| 2 | 非 allowlist 邮箱 | 拒绝 |
| 3 | allowlist 登录后点「继续进入」 | 进入控制台，无需 Secret |
| 4 | 直接 `curl lic.../admin/health` 无 JWT/Secret | 401 |
| 5 | 本地 `VITE_ADMIN_AUTH_MODE=secret` + Secret | 仍可用 |
| 6 | 生产开启 `CF_ACCESS_REQUIRE_JWT` | Secret 登录失败 |

---

## 回滚

1. 删/关 Zero Trust Application  
2. Worker 去掉 `CF_ACCESS_*` 或 `REQUIRE_JWT`  
3. Admin 构建改回 `VITE_API_BASE=https://lic.eqt.net.im` + secret 模式  

---

## 安全备注

- Access **管理员账号**（Cloudflare 登录）本身必须 2FA。  
- 生产建议最终 `CF_ACCESS_REQUIRE_JWT=true` 并轮换旧 `ADMIN_SECRET`。  
- 不要把 AUD/Team 当唯一机密；真正边界是 **JWT 签名 + allowlist**。  
