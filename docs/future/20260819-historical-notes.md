1. chat 模式的 GUI 邮件功能异常
2. 移动端复制后, 同步桌面端剪切板
3. 右键模板, 购买成功后的
4. paddle 主题色, 邮件主题色

---
2026-08-19: #4 paddle 主题色已处理 — 账号级 `primary_checkout_color` 配置脚本 `scripts/paddle-set-checkout-theme.sh`（sandbox+live 各一次），文档见 docs/payment/paddle-payment.md §6；邮件主题色仍待办。

---
2026-08-19 补充：live Paddle 审计完成（Dashboard 实查，vendor 383037）。
已验证 ✅：主题色 #39e5b6 已保存；live 商品/价格与 pricing.html 一致；Webhook「eqt live webhook」Active 订阅 5 事件（transaction.completed / subscription.canceled / subscription.updated / adjustment.created / adjustment.updated）；live 客户端 token 一致。
硬阻塞 🚨：① live `default_checkout_url` 为空（收银台打不开）；② live 账号身份验证未完成（onboarding identity_verification / final_review not_started）。
待办 ⏳：③ 提交 `www.eqt.net.im` 域名审核（目前只有 eqt.net.im Pending，subdomain 不自动过审）；④ Worker `PADDLE_API_KEY` 换 live（wrangler secret put）；⑤ 核对 `PADDLE_WEBHOOK_SECRET` 与 live webhook secret 一致；⑥ sandbox 主题色未应用（需 sandbox key 跑脚本）；⑦ 生产 TEST_MAIL_RECEIVER 残留确认。

---
2026-08-20: apex→www 301 重定向已配置并验证 ✅（`https://eqt.net.im/*` → `https://www.eqt.net.im/*`，路径+query 保留）。机制：DNS A(proxied 192.0.2.0) + Zone Redirect Rule（phase `http_request_dynamic_redirect`）。备注：权限加在 .env 里被注释的 `cfut_` token 上（DNS+rules）；激活的 `cfat_` 只管 worker/r2/d1。临时 Worker `eqt-apex-redirect` 已删除。

---
2026-08-20 补充（Paddle 域名 Pending 排查，Dashboard 实查）：
- ✅ 修正：**www 不能单独提交**——Paddle 域名输入框对 `www.eqt.net.im` 报 "Invalid domain name"，页面规则 "Don't include www"。`eqt.net.im` Pending 即覆盖站点（含 www）。此前文档「www 未提交须单独提交」的说法作废。
- 🔍 Pending 根因（两项，均确认属实）：
  ① onboarding「02 Verify your account」**Not started**——Paddle 需完成业务验证才放行真实收款，疑似域名审批的主闸门。需用户个人+公司信息，约 10 分钟。
  ② `eqt.net.im` 此前无任何 Web 记录，审核抓不到内容——已配 301 跳转修复，现可抓取 www 完整站点。
- ✅ 网站侧审核前置全部达标：/ /pricing /terms /privacy /refund 均 200；价格与 live 目录一致；`support@eqt.net.im` 首页可达。
- ⏭ 下一步：用户启动「02 Verify your account」（onboarding/account-setup?step=intro）。

---
2026-08-20 补（Paddle 业务验证提交 + 域名临时批准 + 网站整改）：
- ✅ 用户完成 onboarding Step 1–5（含统一社会信用代码 `91140902MAKHW5D934`，GB 32100-2015 校验通过）；「02 Verify your account」变 **In progress**，域名 `eqt.net.im` 变 **In review**（印证根因＝验证未开始）。
- 📧 Paddle 邮件（docs/payment/20260820_paddle_mail_reply.md）：`eqt.net.im` **provisionally approved**，payout 前需整改 2 项：
  ① 退款政策含限定条件/例外 → 按 Paddle 要求改为**无条件 14 天全额退款**（移除设备/技术条件、不可退款码例外、365 天限制；订阅取消/处理流程保留）。
  ② 条款缺法定公司名 → 新增「Seller & Legal Entity」（`Huiai Technology (Xinzhou) Co., Ltd.`）+「合理使用与反滥用」条款（承接 365 天黑名单披露，Paddle 最低条款要求有 Misuse 条款）。
- 🚀 已改 refund.html / terms.html / pricing.html（各 7 语种 + HTML 基线）并 `npm run deploy`（项目 `eqt`）；线上验证 /refund /terms /pricing 均 200 且新文案生效。
- ⏭ 下一步：Paddle 侧等审核（可能邮件要身份验证）；域名正式 approved 后设 live `default_checkout_url = https://www.eqt.net.im/pricing`。
