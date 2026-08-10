# EQT 上线前检查清单

> 分析日期：2026-08-07（审查更新：2026-08-07）
> 范围：全栈（Cloudflare Workers + 网站 + 桌面端 + 支付 + 运营）
> 前提：P2 #15 滥用检测自动化已完成，两份报告（infrastructure-observability / device-registration-server-side）所有实施项已交付

---

## 一、架构全景

```
用户
 ├─ www.eqt.net.im (Cloudflare Pages)
 │   ├─ 首页 / 定价 / Portal / 法律页面
 │   └─ Paddle.js Checkout → Paddle.com (支付)
 │
 ├─ lic.eqt.net.im (Cloudflare Workers + D1)
 │   ├─ DRM API (activate/verify/register)
 │   ├─ Paddle Webhook (许可证铸造/续期/退款)
 │   ├─ 滥用检测 (异步)
 │   └─ 崩溃上报端点
 │
 ├─ feedback.eqt.net.im (Cloudflare Workers + D1 + R2)
 │   └─ 用户反馈/建议收集 → Telegram 通知
 │
 └─ 桌面端 (eqt-desktop.exe)
     ├─ 启动时 register/verify
     ├─ 崩溃时写入 crash.dump
     └─ 自动更新 → download.eqt.net.im/update-metadata.json
```

---

## 二、阻塞项（不上线必须解决）

### 2.1 Paddle 支付打通

**现状**：定价页已集成 Paddle.js SDK，邮箱验证 → Paddle Checkout 流程完整，但：

| 组件 | 状态 | 位置 |
|---|---|---|
| Paddle 商户账号注册 | ❌ 未完成 | https://vendors.paddle.com |
| 商品创建（Lifetime / Yearly） | ❌ 未完成 | Paddle Dashboard → Catalog → Products |
| 价格 ID 配置 | ❌ 占位符 | `cloudflare/eqt-website/pricing.html:805-806` |
| Webhook Secret 设置 | ❌ 未配置 | `wrangler secret put PADDLE_WEBHOOK_SECRET` |
| Webhook 端点验证 | ❌ 未测试 | `POST /api/v1/paddle/webhook`（`routes/paddle.ts`） |
| 沙箱环境端到端测试 | ❌ 未执行 | Paddle Sandbox → 购买 → webhook → 许可证铸造 → 激活 |
| Webhook 幂等性 | ✅ 已实现 | `routes/paddle.ts` 通过 `paddle_transaction_id` 去重，重复投递返回已有 license_code |

**操作步骤**：

```bash
# 1. Paddle Dashboard 创建商品，获取价格 ID
# 2. 更新 pricing.html 中的价格 ID
# 3. 配置 Paddle webhook URL → https://lic.eqt.net.im/api/v1/paddle/webhook
# 4. 设置 webhook secret
wrangler secret put PADDLE_WEBHOOK_SECRET
# 5. 设置 Paddle 环境（沙箱/生产）
#    pricing.html:812 的 PADDLE_ENV 变量
# 6. 端到端测试：沙箱购买 → 检查 D1 licenses 表 → 激活
```

**涉及文件**：
- `cloudflare/eqt-drm-api/src/routes/paddle.ts` — webhook 处理（铸造/续期/退款/升级）
- `cloudflare/eqt-website/pricing.html` — 价格 ID + Paddle.Initialize
- `cloudflare/eqt-website/js/checkout-verify.js` — 邮箱验证 → Paddle.Checkout.open

---

### 2.1a CORS 跨域配置验证

**现状**：`checkout-verify.js` 从 `www.eqt.net.im` 向 `lic.eqt.net.im` 发起 POST 请求（`/api/v1/checkout/send-code`、`/api/v1/checkout/verify-code`），属于跨域请求。

**实现**：`auth.ts` 中 `getCorsHeaders()` 已配置动态 CORS，允许 `eqt.net.im` 域名来源。OPTIONS 预检请求在 `index.ts` 入口处统一处理。

**验证结果（2026-08-07）**：✅ 通过
```bash
# OPTIONS 预检返回正确的 CORS 头
curl -X OPTIONS -H "Origin: https://www.eqt.net.im" \
  -H "Access-Control-Request-Method: POST" \
  https://lic.eqt.net.im/api/v1/checkout/send-code -v 2>&1 | grep -i "access-control"
# → access-control-allow-origin: *
# → access-control-allow-headers: Content-Type, Authorization, Cf-Access-Jwt-Assertion
# → access-control-allow-methods: GET, POST, DELETE, OPTIONS

# 实际 POST 请求也正常工作
curl -X POST -H "Origin: https://www.eqt.net.im" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","lang":"en"}' \
  https://lic.eqt.net.im/api/v1/checkout/send-code
# → {"success":true,"message":"Verification code sent to your email"}
```

**涉及文件**：
- `cloudflare/eqt-drm-api/src/utils/auth.ts` — `getCorsHeaders()` 函数
- `cloudflare/eqt-drm-api/src/index.ts` — OPTIONS 预检处理

---

### 2.2 SMTP 发信密钥

**现状**：`wrangler.toml` 已配置邮件服务器地址和发件人，密码必须通过 `wrangler secret` 注入。

**验证结果（2026-08-07）**：✅ `MAIL_SENDER_PASSWORD` 已配置为 wrangler secret
```bash
npx wrangler secret list | grep MAIL_SENDER_PASSWORD
# → MAIL_SENDER_PASSWORD (secret_text) ✅
```

**依赖方**：

| 功能 | 端点 | 无密钥后果 |
|---|---|---|
| 购买前邮箱验证码 | `POST /api/v1/checkout/send-code` | 用户无法完成购买 |
| Portal 无密码登录验证码 | `POST /api/v1/portal/send-code` | 用户无法登录 Portal |
| 激活成功通知 | `sendDRMEmail()` | 用户收不到激活确认 |
| 管理员告警邮件 | `logSystemError` → CRITICAL | 收不到邮件告警（Telegram 仍可用） |

**操作步骤**：

```bash
wrangler secret put MAIL_SENDER_PASSWORD
# 验证：向测试邮箱发一封验证码，确认收到
```

---

### 2.4 DRM API Telegram 告警密钥

**现状**：`TELEGRAM_BOT_TOKEN` 仅在 `eqt-feedback-api` 配置为 wrangler secret，但 `eqt-drm-api` 的 `error-logger.ts` 也引用它（CRITICAL 级别错误 → Telegram 告警，包括滥用检测触发）。当前 drm-api 的 CRITICAL 告警**静默失败**——不会发送 Telegram 消息。

**验证结果（2026-08-07 复查）**：
```bash
# feedback-api: ✅ TELEGRAM_BOT_TOKEN 已配置
# drm-api: ✅ 已修复
# - TELEGRAM_CHAT_ID 已加入 wrangler.toml [vars]（commit 46255ce，部署生效）
# - TELEGRAM_BOT_TOKEN 已由运维手动 wrangler secret put 到 eqt-drm-api（用户确认 2026-08-07）
# drm-api CRITICAL 告警不再静默失败
```

**现状**：客户端检查 `https://lic.eqt.net.im/update-metadata.json` 获取更新信息（Worker `github.ts` 代理 GitHub Releases API，正常返回 JSON）。

**download 域名隔离（2026-08-07 实施完成）**：`download.eqt.net.im` 已从 Pages 项目 `eqt` 移除，改由 **R2 桶 `eqt-downloads` 的 custom domain 直接接管**。各域名职责完全隔离：
- `download.eqt.net.im` → 只服务 `/downloads/{version}/{file}` 与 `/downloads/latest/{file}`（R2 直出），其余任意路径返回 404（R2 默认页，不含网站内容）
- `www.eqt.net.im` → 网站（不变）
- `lic.eqt.net.im` → Worker（DRM API + `update-metadata.json`）

**实施细节**：
- 创建 R2 桶 `eqt-downloads`，挂 custom domain `download.eqt.net.im`（DNS CNAME → `public.r2.dev`）
- 从 Pages 项目 `eqt` 的 custom domains 移除 `download.eqt.net.im`（保留 `www.eqt.net.im`）
- 删除 `wrangler.toml` 中 drm-api 的 `download.eqt.net.im` 路由，避免域名归属冲突导致后续 deploy 失败
- 网站 `cloudflare/eqt-website/index.html` 的 `fetchLatestVersion()` 改为从 `lic.eqt.net.im/update-metadata.json` 拉取（下载 URL 仍指向 download 域名）
- v1.12.0 构建产物（exe + sig + metadata）已上传到桶的 `downloads/v1.12.0/` 与 `downloads/latest/`
- `release.yml` 不再把产物复制进 `cloudflare/eqt-website/downloads/`（www 保持纯产品页），产物只进 GitHub Release + R2；`_headers` 中失效的 `/update-metadata.json`、`/downloads/*` 规则已删除

**验证结果（2026-08-07）**：
```bash
# 下载直出（R2）
curl -sI https://download.eqt.net.im/downloads/latest/eqt-desktop-windows-amd64.exe
# → 200, content-type: application/octet-stream, 18381824B

# 隔离（非下载路径一律 404，非网站 HTML）
curl -s -o /dev/null -w "%{http_code}" https://download.eqt.net.im/
# → 404

# 元数据仍正常
curl -s https://lic.eqt.net.im/update-metadata.json | jq '.version'
# → "v1.12.0"（GitHub 最新 release）
```

**仍需完成（分发就绪）**：

| 事项 | 说明 |
|---|---|
| 创建 GitHub Release `v1.24.0` | 当前代码版本（`pkg/version/version.go:12`），需 tag + release + 上传构建产物 |
| 构建产物 + Ed25519 签名 | `scripts/generate-update-sig` 生成 `.sig` 文件；`release.yml` 会自动上传 R2 |
| 触发 release 后上传 R2 | `release.yml` 会写 `downloads/v1.24.0/` 与 `downloads/latest/`（也可手动 `wrangler r2 object put`） |
| Ed25519 私钥安全保存 | `scripts/generate-update-sig/main.go` 中 `testPrivateKeySeedHex` 仅用于测试，生产用 `UPDATE_SIGNING_PRIVATE_KEY` 环境变量 |

---

## 三、高优先级（上线前最好就绪）

### 3.1 Admin 面板访问控制

**现状**：`wrangler.toml` 配置了 `CF_ACCESS_ALLOWED_EMAILS = "admin@eqt.net.im"`，但 Cloudflare Access 策略需要手动在仪表盘配置。

**验证**：
- 访问 `https://lic.eqt.net.im/api/v1/admin/health` 是否返回数据
- 访问 `https://lic.eqt.net.im/api/v1/admin/metrics` 是否受 Access 保护
- admin@eqt.net.im 是否能正常通过 Access 登录

### 3.2 Portal 自服务门户

**现状**：`www.eqt.net.im/portal.html` 已实现，支持邮箱验证码登录、查看许可证、解绑设备、管理订阅。

**验证清单**：
- [ ] 输入邮箱 → 发送验证码 → 收到邮件
- [ ] 输入验证码 → 登录成功 → 看到许可证列表
- [ ] 解绑设备 → 确认解绑成功
- [ ] 切换自动续费开关
- [ ] 查看续费/升级入口
- [ ] 多语言切换正常

### 3.3 下载入口与安装说明

**现状**：客户从哪里下载桌面端？`www.eqt.net.im` 首页是否有下载按钮和安装说明？

**需要确认**：
- 首页是否有显眼的下载入口（CTA 按钮）
- 下载链接指向哪里（GitHub Releases？R2 直链？）
- 是否有 Windows 安装说明（exe 直接运行？需要管理员权限？）
- 是否有首次使用引导（激活码输入、传输功能说明）

### 3.4 定价页价格 ID 确认

**现状**：`pricing.html:805-806` 当前为占位值：

```javascript
const PRICE_LIFETIME_ID = "pri_01kxymyma34hgmndccwswheta3"; // 需替换
const PRICE_YEARLY_ID = "pri_01kxymxqngex49tg65wb0701pc";   // 需替换
```

Paddle 商品创建后，替换为真实 ID。

### 3.5 多语言 Portal 翻译补齐

**现状**：`entitlement_term`（订阅期限标签）在 `portal.html` 中已覆盖全部 7 种语言（en/zh/ja/ko/es/de/fr），无需补充。建议上线前通读各语言翻译确认语义准确。

**涉及文件**：`cloudflare/eqt-website/portal.html` 中的 i18n 字典。

---

## 四、辅助项（上线后可补）

### 4.1 已就绪（无需额外操作）

| 事项 | 状态 | 说明 |
|---|---|---|
| 崩溃上报 | ✅ 已实现 | 桌面端崩溃 → D1 + R2 双存储，下次启动弹窗询问上传 |
| UptimeRobot 监控 | ✅ 已配置 | 3 个监控器（drm-health/feedback/website），邮件告警 |
| D1 自动备份 | ✅ 已配置 | GitHub Actions cron 每日备份，失败 Telegram 通知 |
| 滥用检测 | ✅ 已实现 | 激活后异步检测 3 条规则，自动封禁 + 告警 |
| 健康检查端点 | ✅ 已实现 | `GET /api/v1/health` 返回 D1/R2 深度检测 |
| 请求级 trace_id | ✅ 已实现 | 每个响应含 `X-Trace-Id`，D1 可查 |
| 部署流水线 | ✅ 已配置 | GitHub Actions CI → 手动审批 → 部署 Workers + Pages |
| Webhook 幂等性 | ✅ 已实现 | `paddle_transaction_id` 去重，重复投递安全 |
| 验证码发送限流 | ✅ 已实现 | 60 秒冷却期 + D1 持久化计数器，多 isloate 安全 |

### 4.2 建议上线后补

| 事项 | 优先级 | 说明 |
|---|---|---|
| SEO / 搜索引擎收录 | P3 | meta description、OG tags、sitemap.xml |
| 使用条款/隐私政策法务审核 | P2 | 已有英文版，建议找律师审阅 |
| 谷歌 Analytics / 自托管统计 | P3 | 了解流量来源和用户行为 |
| 用户使用文档 / FAQ | P2 | 帮助用户理解产品功能、激活流程、传输用法 |
| 社交媒体账号 / 品牌建设 | P3 | Twitter/X、GitHub 项目页 |

---

## 五、上线前操作步骤（按顺序）

```
Step 1 ── Paddle 商户注册 + 商品创建
  ├─ 注册 Paddle Vendors 账号
  ├─ 创建 Lifetime 和 Yearly 商品
  ├─ 记录价格 ID
  ├─ 获取 PADDLE_API_KEY（用于 webhook 中通过 Paddle API 查询客户邮箱）
  └─ 配置 Webhook URL

Step 2 ── 密钥配置
  ├─ wrangler secret put PADDLE_WEBHOOK_SECRET（✅ 已配置）
  ├─ wrangler secret put MAIL_SENDER_PASSWORD（✅ 已配置）
  ├─ wrangler secret put PADDLE_API_KEY（✅ 已配置）
  ├─ wrangler.toml 加 TELEGRAM_CHAT_ID var（✅ 已配置，commit 46255ce）
  └─ wrangler secret put TELEGRAM_BOT_TOKEN（✅ 已配置：feedback-api + drm-api）

Step 3 ── 更新定价页
  ├─ pricing.html 替换价格 ID
  └─ 确认 PADDLE_ENV 从 sandbox 切为 production

Step 4 ── 更新分发就绪
  ├─ 桌面端 update URL 已改为 lic.eqt.net.im/update-metadata.json（✅ 完成）
  ├─ download.eqt.net.im 已隔离：R2 桶 eqt-downloads 接管，只服务 /downloads/（✅ 完成）
  ├─ 网站 metadata 拉取已改 lic.eqt.net.im（✅ 完成，已部署）
  ├─ 构建当前版本 Windows 二进制 + 生成 Ed25519 签名（❌ 待 v1.24.0 release）
  ├─ 上传到 R2 桶 downloads/v1.24.0/ + downloads/latest/（v1.12.0 已就位）
  └─ 创建/更新 update-metadata.json（v1.12.0 已就位）

Step 5 ── 端到端验证
  ├─ 沙箱购买 → 许可证铸造 → 激活 → 验证
  ├─ Portal 登录 → 查看许可证 → 解绑设备
  ├─ 桌面端下载 → 安装 → 激活 → 传输
  └─ 崩溃上报 → 检查 D1 + R2

Step 6 ── 上线
  ├─ DNS 确认（lic / www / feedback / download）
  │   for domain in lic.eqt.net.im www.eqt.net.im feedback.eqt.net.im download.eqt.net.im; do
  │     echo "=== $domain ==="
  │     dig +short $domain
  │   done
  │   所有域名应解析到 Cloudflare 边缘 IP（104.x.x.x 或 172.x.x.x）
  ├─ CORS 预检验证
  │   curl -X OPTIONS -H "Origin: https://www.eqt.net.im" \
  │     https://lic.eqt.net.im/api/v1/checkout/send-code -v 2>&1 | grep -i access-control
  ├─ UptimeRobot 监控确认
  └─ 部署生产环境
```

---

## 六、文档变更记录

| 日期 | 变更内容 | 变更人 |
|---|---|---|
| 2026-08-07 | 初始版本：上线前检查清单 | 分析报告 |
| 2026-08-07 | 审查更新：CORS 验证、URL 不匹配修复、SMTP/Paddle 密钥确认、TELEGRAM_BOT_TOKEN 缺失发现 | 审查员 + 开发实施 |
| 2026-08-07 | 审查修复：修正 Portal i18n 声明、补充 CORS 验证、标注 update URL 不匹配、补充 DNS 验证命令、补充 webhook 幂等性和验证码限流确认 | 审查修复 |
| 2026-08-07 | download 域名隔离实施：download.eqt.net.im 从 Pages 移到 R2 桶 eqt-downloads（只服务 /downloads/），网站 metadata 改拉 lic，drm-api 移除 download 路由；确认 drm-api Telegram 密钥就位 | 开发实施 |
| 2026-08-07 | 强化隔离：release.yml 不再把产物复制进 website 静态目录（www 纯产品页），metadata 直接生成到 out/；删除 _headers 中失效的 /update-metadata.json、/downloads/* 规则 | 开发实施 |
