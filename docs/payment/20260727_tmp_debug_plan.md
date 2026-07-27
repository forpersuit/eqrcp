# 20260727_tmp 调试进度计划 (Paddle 国际化、邮件模块抽离与订阅测试)

## 一、 需求背景与目标

为提升用户购买体验、保证国际化多语言一致性，并强化 DRM 云端代码的可维护性与高覆盖率自动化测试，制定本调试推进计划：

1. **Paddle 响应消息分类与 7 语国际化**：
   - 厘清面向买家/前端 UI 的消息（如 `/api/v1/paddle/license-query` 等）与底层后台 Logs / Webhook ACK 的边界。
   - 对面向用户的响应消息实现全量 7 语 (`zh`, `en`, `ja`, `ko`, `es`, `de`, `fr`) 国际化转换。

2. **PRO 月续费与 PLUS 年续费自动化测试套件**：
   - 编写自动化测试脚本 `tests/verify-subscription-renewals.js`，覆盖 PRO 月付（30天延展）与 PLUS 年付（365天延展）的首次发码与周期自动续费。

3. **透传买家支付界面语种与邮件适配**：
   - 前端发起 Paddle Checkout 时在 `custom_data` 中透传页面当前语种 `lang`。
   - 后端 Webhook 履约时提取 `custom_data.lang`，精准发送对应语种的购买/续费通知邮件。

4. **邮件模块独立化抽离与统一 SSOT 管理**：
   - 彻底抽离 `paddle.ts` / `drm.ts` / `portal.ts` 中内联的硬编码邮件 HTML。
   - 在 `src/services/mail-templates.ts` 中统一呈现 7 语模板（包含发码通知、续费成功通知、退款/吊销警告、验证码等）。

---

## 二、 推进阶段与任务分解

### Phase 1: 邮件模块抽离与 7 语国际化统一 (Single Source of Truth)
- [ ] 在 `cloudflare/eqt-drm-api/src/services/mail-templates.ts` 创建统一邮件模板服务。
- [ ] 抽离首次购买成功邮件 (`renderPurchaseEmail(lang, licenseCode, tier, expiresAt, maxDevices)`)，支持 7 语。
- [ ] 抽离续费成功邮件 (`renderRenewalEmail(lang, licenseCode, tier, newExpiresAt)`)，支持 7 语。
- [ ] 规范已有退款吊销、设备绑定与验证码邮件。

### Phase 2: Paddle 响应消息拆分与用户端国际化
- [ ] 审查 `src/routes/paddle.ts` 所有的 Response 文本。
- [ ] 将面向买家 / 前端轮询（如 `/license-query`）的用户可见消息接入 `getApiTranslation(key, reqLang)`。
- [ ] 保持内部 / 开发者 ACK Webhook JSON（如 `Webhook event acknowledged`）为确定性英文 log。

### Phase 3: 买家支付界面语种透传 (`custom_data.lang`)
- [ ] 前端 `cloudflare/eqt-website/pricing.html` / `js/checkout-verify.js` 在 `Paddle.Checkout.open` 时传入 `custom_data: { lang: currentLang }`。
- [ ] 后端 `paddle.ts` 从 `data.custom_data.lang` 或 `data.passthrough` 中提取语种标头。

### Phase 4: PRO 月续费与 PLUS 年续费测试套件
- [ ] 扩展 `cloudflare/eqt-drm-api/tests/verify-subscription-renewals.js`。
- [ ] 测试用例 A: PLUS 年付订阅（首次发码 -> 续费扩展 365 天 -> 保持相同激活码）。
- [ ] 测试用例 B: PRO 月付订阅（首次发码 -> 续费扩展 30 天 -> 保持相同激活码）。
- [ ] 运行 TypeScript 类型检查与单元测试验证。

### Phase 5: 部署上线与生产环境回测
- [ ] 执行 `npx tsc --noEmit` 保证 TypeScript 0 error。
- [ ] 部署 Worker 至 Cloudflare (`wrangler deploy`)。
- [ ] 部署 官网 Pages 至 Cloudflare Pages (`wrangler pages deploy`)。
- [ ] 提交代码并推送至 GitHub `prov1` 分支。
