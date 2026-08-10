# IMPORTANT — R2 安装包分发与 Windows 下载形态

> 生产下载**只走 R2 公网 CDN**，不使用 GitHub Releases 作为用户下载源。  
> 配置入口：Worker 环境变量 `R2_PUBLIC_URL`（见 [IMPORTANT_admin-config.md](./IMPORTANT_admin-config.md)）。

---

## 1. 必须配置（用 **vars**，不要 secret）

`R2_PUBLIC_URL` 是**公开下载基址**（用户链接里本来就会出现），**没有保密价值**，**不要**当成 Secret。  
用 `wrangler.toml` `[vars]` 或 Dashboard **Plaintext** 即可（全量 env 分类见 [IMPORTANT_drm-secrets.md](./IMPORTANT_drm-secrets.md)）。

```toml
# cloudflare/eqt-drm-api/wrangler.toml
[vars]
R2_PUBLIC_URL = "https://download.eqt.net.im"   # 无尾斜杠
```

```bash
cd cloudflare/eqt-drm-api
npx wrangler deploy   # 改 vars 后必须 deploy
```

| 项 | 说明 |
| :--- | :--- |
| 值 | 用户浏览器/客户端最终下载的**公网基址**，如 `https://download.eqt.net.im` |
| 对象键约定 | `{R2_PUBLIC_URL}/downloads/{version}/{filename}`，如 `.../downloads/v1.2.3/eqt-desktop-windows-amd64.exe` |
| 未配置时 | 健康页 `r2_configured=false`；`/downloads/*` 与 `/api/v1/update/check` 返回 **503**（**不再回落 GitHub**） |
| 与 R2 API 密钥 | **无关**。本变量不是 Cloudflare R2 Access Key；上传用 wrangler/控制台 |

上传产物到 R2 的对象路径须与上表一致，否则链接 404。

---

## 2. 裸 `.exe` 还是套一层 `.zip`？

### 结论（无微软 Authenticode 证书时）

| 渠道 | 建议形态 | 原因 |
| :--- | :--- | :--- |
| **官网 / 邮件 / 人工下载** | **优先 `.zip`（内含 exe）** | 部分浏览器与企业网关对「直接下 exe」更严；用户习惯「解压再运行」；略减误拦 |
| **客户端自动更新** | **保留可校验的二进制 + `.sig`**（当前设计多为 `.exe` / 压缩包本体 + Ed25519 签名） | 更新器要原子替换与签名校验，不宜只提供「外壳 zip」却不提供可验证载荷 |
| **长期正确解法** | **购买/使用代码签名证书**（EV/OV Authenticode）对 Windows 产物签名 | SmartScreen / 部分杀软的**根因**是**未签名发布者**，不是「有没有 zip」 |

### 第一性原理

1. **SmartScreen / MOTW**  
   从浏览器下载的文件会带「来自互联网」标记。用户运行**未签名** exe 时，常见「Windows 已保护你的电脑」、未知发布者警告。  
2. **套 zip 能缓解什么**  
   - 减少「下载阶段」直接拦截裸 exe 的概率  
   - 不改善：解压后运行仍可能弹 SmartScreen；杀软启发式仍可能删未签名 exe  
3. **套 zip 不能替代**  
   - 微软代码签名  
   - 声誉积累（同一证书长期干净发布）  
4. **因此**  
   - **短期**：官网对外链发布 **zip**；R2 上同时可放 zip（给人）与更新用的带签名载荷（给客户端）  
   - **中期**：上代码签名；签名后再评估是否对官网也提供 signed exe  

### 与当前仓库发布的关系

- GoReleaser Windows 归档本身常为 **zip/tar.gz**（CLI 多二进制）。  
- Wails 桌面产物常见 **裸 `eqt-desktop-*.exe`**。  
- 上传 R2 时建议至少：  
  - `eqt-desktop-windows-amd64.zip`（官网）  
  - 自动更新所需的匹配资产名 + `.sig`（与客户端匹配规则一致，见 `docs/IMPORTANT_auto-update-design.md`）

---

## 3. 运维检查

1. `R2_PUBLIC_URL` 已配置且健康页 `r2_configured=true`  
2. `curl -sI "{R2_PUBLIC_URL}/downloads/{version}/{file}"` → 200（或 302 后 200）  
3. 官网链接**不要**指向 `github.com/.../releases`  
4. 客户端「检查更新」返回的 `download_url` 前缀应为 `R2_PUBLIC_URL`  

---

## 4. 相关代码

| 路径 | 行为 |
| :--- | :--- |
| `cloudflare/eqt-drm-api/src/services/github.ts` | `/downloads/:ver/:file` → 仅 302 到 R2；无 env 则 503 |
| `cloudflare/eqt-drm-api/src/routes/drm.ts` | `/api/v1/update/check` 资产 URL 仅 R2 |
| Admin 健康 | `config.r2_configured` |
