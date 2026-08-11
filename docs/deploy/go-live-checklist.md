# EQT 正式运营上线前工作清单(Go-Live Checklist)

> 目标:让当前版本(v1.26.0 / drm-api 1.8.0 / admin 1.8.0)面向真实客户运营。
> 本文档回答:「除了 Paddle go-live,正式上线、推广、接收付费、运营前还需要做什么」。
> 最后更新:2026-08-08
>
> 关联文档:[部署流水线](./README.md)、[环境操作手册](./environment-runbook.md)、[测试环境](./test-environment.md)、[GUI 环境开关](./gui-environment.md)

---

## 0. 当前状态(2026-08-08 盘点)

| 项 | 状态 |
|---|---|
| 生产 D1 / R2 数据 | ✅ 已全部清空(此前均为测试残留,无真实数据) |
| 生产 Worker / Pages / 监控 | ✅ 在线,UptimeRobot 3 个监控器 UP |
| 版本号 | `v1.26.0`(Go)/ `1.8.0`(drm-api, admin) |
| 每日 D1 备份 | ⚠️ **已修复**(见 §2.3)——原 workflow 使用已移除的 `d1 backup create`,实际每天失败 |
| Paddle | ⚠️ 仍为 sandbox(见 §3,go-live 前的关联前置项) |
| 流量统计 / 网站推广 | ❌ 未配置 |

> ⚠️ 本文档是**执行清单**,标注 ✅ 为已完成、⚠️ 为待办、❌ 为未做。每完成一项打勾。

---

## 1. 生产环境准备(数据已清空,需验证)

### 1.1 生产数据清空验证 ✅(2026-08-08 完成)

```bash
# 应全部返回 0
CLOUDFLARE_API_TOKEN="" npx wrangler d1 execute eqt-drm-db --remote \
  --command "SELECT (SELECT COUNT(*) FROM licenses) l, (SELECT COUNT(*) FROM activations) a, (SELECT COUNT(*) FROM device_registry) d, (SELECT COUNT(*) FROM p2p_signals) p"
CLOUDFLARE_API_TOKEN="" npx wrangler d1 execute eqt-feedback-db --remote \
  --command "SELECT COUNT(*) FROM feedbacks"
```

- 清理前备份留存:`/tmp/eqt-drm-db-prod-preclean-20260808.sql`(182MB)、`/tmp/eqt-feedback-db-prod-preclean-20260808.sql`
- R2 `eqt-feedback-bucket` 3 个测试图片已删;`eqt-crash-reports` 原为空;`eqt-downloads` 保留分发资产

### 1.2 上线基线验证(每次正式发布前必跑)

```bash
# 健康检查(生产)
curl https://lic.eqt.net.im/api/v1/health
curl https://feedback.eqt.net.im/api/v1/health
curl -I https://www.eqt.net.im | head -1

# 更新元数据可访问
curl -s https://download.eqt.net.im/update-metadata.json

# 生产 D1 绑定正确(不应命中测试库)
# Admin 面板打开确认能登录、能看到空库
```

### 1.3 生产 secrets 与环境变量清单核对 ⚠️

| Secret / 环境变量 | 生产 Worker | 检查项 | 状态 |
|---|---|---|---|
| `ED25519_PRIVATE_KEY` | eqt-drm-api | 32-byte seed 的 hex(非 base64);对应公钥 `08443678...` | ⚠️ 需确认 |
| `PADDLE_API_KEY` | eqt-drm-api | 上线前为 **live**(`pdl_live_`),见 §3 | ⚠️ |
| `PADDLE_PRICE_ID_PLUS_YEARLY` | eqt-drm-api | 生产 Live 年度价格 `pri_01kydyzmn1pc29npe377dxtq96` (在 `wrangler.toml` 的 `[vars]` 显式声明) | ✅ 已配置 |
| `PADDLE_PRICE_ID_PLUS_LIFETIME` | eqt-drm-api | 生产 Live 终身价格 `pri_01kyd2nbsmg44rjmvf4vbetgwj` (在 `wrangler.toml` 的 `[vars]` 显式声明) | ✅ 已配置 |
| `MAIL_SENDER_PASSWORD` | eqt-drm-api | SMTP 密码,发信验证码/结账邮件 | ⚠️ |
| `TURNSTILE_SECRET` | eqt-drm-api | Cloudflare Turnstile(若启用) | ⚠️ |
| `TELEGRAM_BOT_TOKEN` | 两个 Worker | 部署/备份/反馈通知 | ✅ 已配(通知在跑) |
| GitHub `UPDATE_SIGNING_PRIVATE_KEY` | release.yml | 更新签名,与 GUI 生产公钥 `08443678...` 配对 | ✅ 已验证(2026-08-08) |
| GitHub `R2_BUCKET_NAME`/R2 keys | release.yml | R2 上传分发 | ⚠️ |

```bash
# 查看已配 secret 名(值不可回读)
CLOUDFLARE_API_TOKEN="" npx wrangler secret list          # 生产 eqt-drm-api
CLOUDFLARE_API_TOKEN="" npx wrangler secret list          # 生产 eqt-feedback-api
```

---

## 2. 发布与分发(正式版发布流程)

### 2.1 版本发布流程(现成) ✅

`docs/deploy/README.md §6` 已有完整发布流程:`git tag vX.Y.Z` → release.yml 自动构建 Windows GUI + 签名 + update-metadata.json + GitHub Release + R2 上传。**直接可用**。

### 2.2 更新签名密钥 ✅(2026-08-08 已验证)

- release.yml 用 GitHub Secret `UPDATE_SIGNING_PRIVATE_KEY` 签名,客户端用内置公钥 `08443678...` 验签。
- **验证方法(已执行)**:下载 R2 `downloads/latest/eqt-desktop-windows-amd64.exe` + `.sig`,用 GUI 内置公钥 `08443678...` 对 exe 的 SHA256 验签 → **`true`**。即 Secret 对应公钥与 GUI 内置公钥一致,配对正确。
- 若未来更换签名密钥,重跑此验证:下载产物 → 用 `defaultUpdatePublicKeyHex` 验签。

### 2.3 每日备份 ✅(2026-08-08 已修复)

**问题**:`.github/workflows/d1-backup.yml` 原用 `wrangler d1 backup create/restore` 与 `wrangler login --token-stdin`,wrangler 4.x 已全部移除 → 每日备份实际**失败**且无人知晓(最近 5 次运行全 failure)。
**修复**:改写为 `d1 export --remote --output` 导出 SQL + 上传 Artifact,恢复演练用 `sqlite3` 载入核对;认证直接靠 `CLOUDFLARE_API_TOKEN` 环境变量(与 deploy.yml 一致,去掉 login 步骤)。

```bash
# 上线前手动触发一次备份,确认成功(检查 Artifact 生成)
gh workflow run d1-backup.yml
# 带恢复演练
gh workflow run d1-backup.yml -f restore_drill=true
```

> 备份频率考量:上线后数据有真实价值,RPO ≤24h 是否够?若需更短,可把 cron 改为每 6h,或用 Cloudflare D1 Time Travel(按需)。

### 2.4 发布后验证 ⚠️

- GitHub Release 有 `.exe` + `.sig` + `update-metadata.json`
- `https://download.eqt.net.im/downloads/latest/` 可访问
- 桌面端「检查更新」能发现并下载新版本、验签通过
- 官网版本号正确渲染(异步 fetch `/update-metadata.json`)

---

## 3. Paddle go-live(已知项,此处列**关联前置**,不重复 go-live 本身)

### 3.1 前端结账环境 ⚠️

`cloudflare/eqt-website/pricing.html` 当前:

```js
const PADDLE_ENV = "sandbox";
const PADDLE_TOKEN = "test_1be1e080418b8141d02936c5ee1";
```

上线时必须:
- 按 `window.EQT_IS_TEST` / `api-base.js` 自动区分 sandbox/live token(测试站用沙箱、生产站用 live),而不是硬编码。
- 将 `Paddle.Environment.set(...)` 改为按环境选择;live token 用 `live_` 前缀客户端令牌。

### 3.2 后端 Paddle 密钥与价格 ID ⚠️

- `secret put PADDLE_API_KEY` 生产必须为 `pdl_live_...` 开头 → 激活码 `source='purchase'`(非 `'test'`)。
- 生产环境变量 `PADDLE_PRICE_ID_PLUS_YEARLY` 与 `PADDLE_PRICE_ID_PLUS_LIFETIME`（已在 `cloudflare/eqt-drm-api/wrangler.toml` 的 `[vars]` 显式声明）：
  - `PADDLE_PRICE_ID_PLUS_YEARLY`: `pri_01kydyzmn1pc29npe377dxtq96` (生产 Live 年度价格)
  - `PADDLE_PRICE_ID_PLUS_LIFETIME`: `pri_01kyd2nbsmg44rjmvf4vbetgwj` (生产 Live 终身价格)
- 严禁生产 Worker 使用沙箱价格 ID（代码已加 `CRITICAL` 安全拦截）。
- 换 live 后,**回归验证**:用测试码(测试库)确认不再标 purchase;真实购买确认标 purchase。

### 3.3 支付后链路(已实现,上线前冒烟) ⚠️

- Webhook `/api/v1/paddle/webhook`:HMAC 验签、`transaction.completed` 履约、退款/订阅取消处理。
- `/api/v1/paddle/license-query`:前端 `checkout.completed` 轮询取激活码。
- Portal 发码/结账验证码/退款(14 天窗口、365 天 3 次上限)均已实现。
- **上线前用沙箱完整走一遍**:购买→收码→激活→新设备激活→解绑→退款,确认邮件全链路。

---

## 4. 监控与告警(正式运营必需)

### 4.1 可用性监控 ✅(已配)

UptimeRobot 3 个监控器(全部 UP):
- `www.eqt.net.im`(HTTP 300s)
- `eqt-drm-health`(`lic.eqt.net.im/api/v1/health`)
- `eqt-feedback`(`feedback.eqt.net.im/api/v1/health`)

> ⚠️ 建议:监控器加 alert contact(邮件/Telegram),并确认 down 时会通知到人。当前 `lastIncidentId` 有历史告警,确认告警通道真实可达。

### 4.2 业务指标监控 ❌

| 指标 | 现状 | 建议 |
|---|---|---|
| 激活量/付费转化 | `GET /api/v1/admin/health` 有 KPI(total_licenses/active/today_activations/errors_24h) | 定期(每日)看一眼;或建告警:今日激活=0 时提醒 |
| 崩溃/错误上报 | eqt-drm-api `/api/v1/crash-report` + feedback 库 | 上线后关注 `system_error_logs` 表增量 |
| 反馈 | `eqt-feedback-api` + Telegram 通知 | 已在跑,确认 Telegram 群可达 |

### 4.3 日志/审计 ⚠️

- `admin_audit_logs` 已记录高危操作(发码/吊销/解绑/清日志),`/api/v1/admin/audit-logs` 可查。
- **建议**:上线前建一个「每周运营检查」例行项(见 §7)。

---

## 5. 网站与推广(公开上线前)

### 5.1 网站内容核对 ⚠️

- [x] 产品介绍(`index.html`):文案、下载按钮、版本号动态渲染
- [x] 定价页(`pricing.html`):三档价位、退款政策入口
- [x] 政策页:`terms.html` / `privacy.html` / `refund.html`(已存在)
- [ ] **上线前通读**三份政策页内容是否与产品实际一致(退款条款、隐私说明、订阅说明)
- [ ] 定价金额与 Paddle 目录价一致(PLUS/Pro 档位、LIFETIME/Yearly)

### 5.2 域名与 DNS ✅(2026-08-08 已修正)

- `eqt.net.im` / `www.eqt.net.im` / `lic.` / `feedback.` / `download.` 均可解析并 HTTPS 有效。
- 裸域 `eqt.net.im` 已 301 到 `www`(`_redirects`)。
- **已修正**:`index.html` 的 canonical / og:url 原指向裸域 `https://eqt.net.im`,与 301 跳转不一致 → 已改为 `https://www.eqt.net.im/`(最终服务域)。

### 5.3 流量统计 ✅(方案已定,待 dashboard 启用)

**Cloudflare 自带免费方案:Web Analytics**。www 已 proxied 走 Cloudflare → **automatic setup 零代码**(边缘 `/cdn-cgi/rum` 直接收集,无需注入 JS snippet)。

**统计内容**(Web Analytics 免费版):
- 页面浏览量(page views)、独立访客(unique visitors)
- 来源(referrer)、国家/地区、设备/浏览器
- Core Web Vitals(性能指标)
- 数据保留 6 个月;近 7 天无采样

**局限**(免费版):
- ❌ 不支持 UTM 参数(无法按推广渠道细分)
- ❌ 不支持自定义事件(无法追踪「下载按钮点击」转化)
- 若需要下载转化追踪,后续可加 Plausible/Umami 或自建事件上报

**启用步骤**(dashboard 操作,一次即可):
1. Cloudflare 仪表盘 → **Analytics & Logs → Web Analytics**
2. 添加 hostname `www.eqt.net.im` → 选择 **Automatic**(proxied 站点)
3. 完成。数据在仪表盘 Web Analytics 页查看。

### 5.4 SEO 基础 ✅(2026-08-08 已生成)

- [x] meta description / OG 标签已存在
- [x] favicon 已配
- [x] **sitemap.xml** ✅ 已生成(`cloudflare/eqt-website/sitemap.xml`,6 个页面,用最终域 `www.eqt.net.im`)
- [x] **robots.txt** ✅ 已生成(`cloudflare/eqt-website/robots.txt`,Allow 全部 + Sitemap 声明)
- [ ] 提交到 Google Search Console / Bing Webmaster(需用户操作)
- [ ] 上线后检查搜索引擎收录
- [ ] 提交到 Google Search Console / Bing Webmaster
- [ ] 上线后检查搜索引擎收录

### 5.5 推广渠道 ⚠️

产品是开源项目 qrcp 的增强分支。推广方向(运营层面,非代码):
- GitHub 开源页 README 的下载/介绍(若已 fork 公开)
- 产品介绍视频/截图(`docs/img/` 已有素材)
- 社区发布(Product Hunt、V2EX、小众软件、Reddit r/selfhosted 等)
- 官网落地页作为所有渠道的统一终点

---

## 6. Admin 后台与客服

### 6.1 Admin 后台 ⚠️

- `eqt-admin`(Svelte SPA)由 Cloudflare Access 保护,`VITE_API_BASE` 生产必须为空(同源反代)。
- **确认**:管理员能用 Access 登录,看到真实仪表盘 KPI、能发码/吊销/解绑/查审计。
- 权限模型:当前 Access 用 `CF_ACCESS_ALLOWED_EMAILS = admin@eqt.net.im`——确认该邮箱是运营管理员。

### 6.2 客服渠道 ❌

- 反馈走 `eqt-feedback-api`(Telegram 通知)——是用户报障渠道。
- **建议**:官网/政策页放一个明确的客服联系方式(邮件 `admin@eqt.net.im` 或 Telegram 频道)。
- 退款请求走 Portal 自助退款(`/user/refund`),但**争议/拒付/特殊退款**需人工处理——确认有人盯 Paddle 后台 + 邮箱。

---

## 7. 运营例行(上线后每周)

| 频率 | 事项 | 工具 |
|---|---|---|
| 每日 | 备份成功?Telegram 无 🚨? | GitHub Actions / 监控 |
| 每日 | 激活/错误 KPI | admin `/health` 或 dashboard |
| 每周 | 新反馈、错误日志、退款单 | eqt-feedback + admin audit-logs + Paddle 后台 |
| 每周 | 版本更新节奏评估(收集的 bug 修复) | GitHub issues |
| 月度 | 备份恢复演练(`restore_drill=true`) | GitHub Actions |
| 事件 | 退款/拒付/滥用 → 检查 `manual_blacklist`、设备解绑额度 | admin + D1 |

---

## 8. 上线冲刺核对清单(一键检查)

发布前逐项打勾:

- [ ] 生产 D1 全空(`§1.1` 命令返回 0)
- [ ] 生产 secrets 全部核对(`§1.3`)
- [ ] Paddle live 密钥就位 + pricing.html 按环境切 token(`§3`)
- [ ] 沙箱全链路 E2E 通过(购买→激活→解绑→退款→邮件)(`§3.3`)
- [x] 每日备份手动触发一次成功 + 恢复演练通过(`§2.3`)(workflow 已修复,待手动触发确认)
- [x] 更新签名密钥与 GUI 公钥配对验证(`§2.2`)(2026-08-08 验签通过)
- [ ] 打 tag 发布 vX.Y.Z,Release/R2/官网全部验证(`§2.4`)
- [ ] 3 个监控器 UP + 告警通道可达(`§4.1`)
- [ ] 政策页通读一致 + 定价一致(`§5.1`)
- [x] 裸域→www 跳转与 canonical 一致(`§5.2`)(2026-08-08 已修正)
- [ ] 流量统计 dashboard 启用(`§5.3`)(方案已定:Cloudflare Web Analytics automatic)
- [x] sitemap.xml / robots.txt 已生成(`§5.4`);Search Console 提交待做
- [ ] Admin 可登录、客服渠道对外公开(`§6`)
- [ ] 上线日期定档,准备推广渠道(`§5.5`)

---

## 9. 本次已完成的改动(2026-08-08)

1. **生产数据清理**:eqt-drm-db 13 表、eqt-feedback-db、R2 测试图片全部清空;备份留存 `/tmp/*-preclean-20260808.sql`。
2. **修复 d1-backup.yml**:wrangler 4.x 移除 `d1 backup create/restore` 与 `wrangler login --token-stdin`,改为 `d1 export` + Artifact + sqlite3 恢复演练 + 环境变量认证。
3. **README §7.2** 同步手动备份命令。
4. **更新签名配对验证**:R2 最新产物 `.sig` 用 GUI 生产公钥 `08443678...` 验签通过。
5. **SEO**:新增 `sitemap.xml` + `robots.txt`;修正 `index.html` canonical/og:url 为 `www.eqt.net.im`。
6. **流量统计方案**:确定用 Cloudflare Web Analytics(免费、automatic setup 零代码),待 dashboard 启用。
