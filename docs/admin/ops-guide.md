# EQT 管理后台生产运维与灾备手册 (Ops Guide)

> 本文档面向 EQT 运维团队，指导 Cloudflare Pages / Worker 部署、`ADMIN_SECRET` 密钥轮换与应急通道操作。  
> **配置参数全集**见 [IMPORTANT_admin-config.md](./IMPORTANT_admin-config.md)；**日常发布习惯**见 [IMPORTANT_admin-release.md](./IMPORTANT_admin-release.md)。

---

## 1. 部署与上线指南

### 1.1 后端 Worker (`eqt-drm-api`) 部署
1. 切换至 Worker 目录：
   ```bash
   cd cloudflare/eqt-drm-api
   ```
2. 运行静态类型校验与全量 E2E 契约测试：
   ```bash
   npx tsc --noEmit
   npm run test:admin
   ```
3. 部署发布至 Cloudflare Worker 生产环境：
   ```bash
   CLOUDFLARE_API_TOKEN="" npx wrangler deploy
   ```

### 1.2 前端 Pages (`eqt-admin`) 部署与域名绑定
1. 切换至前端目录：
   ```bash
   cd cloudflare/eqt-admin
   ```
2. 确认本地生产构建无误：
   ```bash
   npm run build
   ```
   *(构建产物 `dist/` 已自动注入 `public/_headers` 与 `public/robots.txt` 防搜索引擎索引文件)*
3. 部署发布至 Cloudflare Pages：
   ```bash
   CLOUDFLARE_API_TOKEN="" npx wrangler pages deploy dist --project-name eqt-admin
   ```
4. 环境变量与域名设置：
   - 在 Cloudflare Pages Dashboard 控制台设置 `VITE_API_BASE=https://lic.eqt.net.im`
   - 绑定自定义二级域名：`admin.eqt.net.im`

---

## 2. 管理员 Secret 密钥轮换规程 (Secret Rotation)

为保证生产环境系统安全，建议定期轮换 `ADMIN_SECRET` 秘钥：

### 2.1 生产密钥轮换命令
在终端执行非交互管道写入（无泄漏风险）：
```bash
echo -n "YOUR_NEW_SECURE_ADMIN_SECRET" | CLOUDFLARE_API_TOKEN="" npx wrangler secret put ADMIN_SECRET --name eqt-drm-api
```

### 2.2 轮换后现象与处理
- 旧密钥失效后，前端发起的后续管理请求将收到 HTTP `401 Unauthorized` 响应。
- 运维人员只需在 `admin.eqt.net.im` 重新输入新 Secret 登录即可。

---

## 3. 灾备应急控制通道 (Disaster Recovery & D1 Emergency Access)

当 Worker API 或前端页面发生不可抗力故障时，可通过 Wrangler D1 CLI 或 Cloudflare Console 应急通道执行管理动作：

### 3.1 紧急手动吊销授权 (Emergency Revoke)
```bash
CLOUDFLARE_API_TOKEN="" npx wrangler d1 execute eqt-drm-db --remote --command="UPDATE licenses SET status = 'revoked' WHERE license_code = 'EQT-PLUS-20260723-XXXXX'"
```

### 3.2 紧急手动解绑设备 (Emergency Unbind)
查阅目标设备 `activation_id`：
```bash
CLOUDFLARE_API_TOKEN="" npx wrangler d1 execute eqt-drm-db --remote --command="SELECT id, license_code, device_id, activated_at FROM activations WHERE license_code = 'EQT-PLUS-20260723-XXXXX'"
```
按 `activation_id` 执行紧急删除解绑：
```bash
CLOUDFLARE_API_TOKEN="" npx wrangler d1 execute eqt-drm-db --remote --command="DELETE FROM activations WHERE id = 123 AND license_code = 'EQT-PLUS-20260723-XXXXX'"
```

### 3.3 紧急日志排查 (Emergency Error Log Query)
拉取最近 20 条 CRITICAL/ERROR 日志：
```bash
CLOUDFLARE_API_TOKEN="" npx wrangler d1 execute eqt-drm-db --remote --command="SELECT level, category, error_message, created_at FROM system_error_logs ORDER BY id DESC LIMIT 20"
```

---

## 4. 防搜索引擎索引保障说明

1. **`_headers` 配置**：所有部署产物自带响应头：
   ```http
   X-Robots-Tag: noindex, nofollow, noarchive
   X-Frame-Options: DENY
   X-Content-Type-Options: nosniff
   ```
2. **`robots.txt` 配置**：全局拦截所有搜索引擎爬虫：
   ```txt
   User-agent: *
   Disallow: /
   ```
