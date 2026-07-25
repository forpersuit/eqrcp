# IMPORTANT — 产品正式发布清单（Product Launch Checklist）

> **用途**：正式上线前的「配置收口 + 口径确认 + 验收」清单。  
> **原则**：功能主链路已齐；发布前优先安全/环境/对客口径，体验债不挡发布则进下一版。  
> **状态**：2026-07-25 同步 — **R3 / R5 已收口**；补 **SMTP/Webhook 是什么**、**Portal 订阅 cancel / 发票推进路径**。

关联：

| 文档 | 角色 |
| :--- | :--- |
| [admin/IMPORTANT_admin-release.md](./admin/IMPORTANT_admin-release.md) | Admin 改代码后的双部署 DoD |
| [admin/IMPORTANT_admin-debt.md](./admin/IMPORTANT_admin-debt.md) | Admin 技术债详情 |
| [admin/IMPORTANT_drm-secrets.md](./admin/IMPORTANT_drm-secrets.md) | Worker Secret / vars 全表 |
| [admin/cloudflare-access-setup.md](./admin/cloudflare-access-setup.md) | Admin Access JWT |
| [feedback-design.md](./feedback-design.md) | GUI 反馈架构（独立于 DRM） |
| [portal/progress.md](./portal/progress.md) | Portal 完成度 |
| [payment/license-source-and-refund-policy.md](./payment/license-source-and-refund-policy.md) | 授权 source / 退款 / 黑名单政策 |
| [payment/paddle-payment.md](./payment/paddle-payment.md) | Paddle 环境 |

---

## 0. 总判断

| 结论 | 说明 |
| :--- | :--- |
| **可以按正式发布推进** | Portal / Admin / 支付 DRM / 桌面传输 / Chat 主场景已构成可用产品 |
| **发布前要做的** | ① 上线配置与安全收口 ② 对客口径与验收 ③ 体验债排入下一版 |
| **不是再堆大功能** | 多媒体预览、移动端打开目录、反馈邮件通道增强等不阻塞「能买、能激活、能传文件、能自助、能运维」 |

---

## 1. 功能面完成度（对照发布）

| 面 | 状态 | 发布意见 | 排查状态 |
| :--- | :---: | :--- | :---: |
| 官网 / 定价 / 条款 / 退款政策 | 有页 + 政策已对齐代码 | 文案终审 | [x] R5 已核对 |
| 购买 → 发码邮件 → 激活 | 主链路已通 | 生产 Paddle 真单验收 | [ ] |
| Portal（登录 / 设备 / 退款） | 阶段 4 完成 | 生产关测试邮件拐弯 | [ ] |
| Admin（Access / 审计 / 发码 / 黑名单） | 可日常运维 | Access 再登一次 | [ ] |
| 桌面传输 + 自动更新 | 主产品 | R2 + 签名验收 | [ ] |
| Chat | 可用；气泡已回长按/滑动菜单 | 多媒体 / 路径 → 下版 | [ ] |
| DRM 黑名单 / source / 退款门禁 | 已落地 | 与条款一致即可 | [x] R5 |
| GUI 反馈 | Worker + D1/R2/TG 已通 | **邮件通道与 Admin 列表 → 下一版** | 计划见 §4 |

---

## 2. 发布前必须确定 / 处理（阻塞或高风险）

> 勾选 = 已确认或已修复。未勾选 = 仍待排查。

| # | 事项 | 为何必须 | 建议动作 | 状态 |
| :---: | :--- | :--- | :--- | :---: |
| R1 | **关掉生产 `TEST_MAIL_RECEIVER`** | 曾配置 `TEST_MAIL_RECEIVER=tmp@…`，OTP/邮件可能被拐到测试箱 | 生产 **删除该 var**；确认 OTP 进买家邮箱。**2026-07-25**：已从 `wrangler.toml` 移除；若 Dashboard 仍残留 Plaintext var 请手删 | [~] 仓库侧已去；Dashboard 再确认 |
| R2 | **Paddle 生产 vs Sandbox** | 曾用 sandbox 退款链路；API key 探针可出现 `webhook_ok_api_key_invalid` | 确认 **live 商品 / Webhook / API key**；Portal 退款依赖 `PADDLE_API_KEY` 时必须有效 | [ ] |
| R3 | **密钥明文（债 D9）** | SMTP / Webhook / TG token 曾在 git 与 toml 明文 | 迁 `wrangler secret`；**轮换**已暴露口令 | **[x] 2026-07-25** 见 §2.2 |
| R4 | **R2 更新与安装包** | 客户端更新依赖 R2，无则 503 | 验收：官网下载、桌面检查更新、安装签名均走生产 CDN | [ ] |
| R5 | **条款 / 定价页与代码一致** | 黑名单 ≥3 / 365 天、退款门禁、source 已写代码 | 扫 `terms` / `refund` / `pricing` 文案 | **[x] 2026-07-25** 见 §2.3 |
| R6 | **Admin Access 名单** | Admin API 仅 JWT；默认允许 `admin@eqt.net.im` | 确认生产 Access 应用、AUD、登出 team domain（`persuit.cloudflareaccess.com`） | [ ] |
| R7 | **一次端到端验收（真人）** | 文档多、环境多，易漏配置 | 见 §5 验收脚本 | [ ] |

### 2.1 产品口径（发布前拍板，写进 FAQ 即可，不必改代码）

| 决策 | 说明 | 状态 |
| :--- | :--- | :---: |
| 解绑后最长约 **7 天**离线仍可用 | 设计如此；对客写清「急停需吊销 + 联网校验」 | [ ] |
| 未激活退款 **不计**黑名单；≥3 次已激活滥用才封 | 已实现；条款已有则只核对 | [x] R5 |
| 移动浏览器下载 **看不到**本机路径 | 平台沙箱限制；**不要**承诺「打开目录」 | [ ] |
| Admin 无 `ADMIN_SECRET` | 仅 Cloudflare Access JWT（`Cf-Access-Jwt-Assertion`） | [ ] |
| 用户反馈 **独立于 DRM** | 走 `feedback.eqt.net.im`，不写 license D1 | [x] 设计定稿 |

### 2.2 R3 收口记录（2026-07-25）

| 动作 | 结果 |
| :--- | :--- |
| `eqt-drm-api` 从 `wrangler.toml` 删除 `MAIL_SENDER_PASSWORD`、`PADDLE_WEBHOOK_SECRET`、`TEST_MAIL_RECEIVER` | 已部署 |
| `wrangler secret put MAIL_SENDER_PASSWORD` / `PADDLE_WEBHOOK_SECRET` | 生产 Secret 列表可见 |
| `eqt-feedback-api` 删除 toml 中 `TELEGRAM_BOT_TOKEN` | 已部署 + `secret put` |
| 非敏感 SMTP 主机 / From / 端口 | 仍为 `[vars]`（符合 secrets 文档） |
| **SMTP 口令** | 用户已更新 `MAIL_SENDER_PASSWORD` secret | 已处理 |
| **Webhook secret** | 见 §2.2.1：通常**不必**为「迁 secret」再换 | 可选 |

### 2.2.1 「SMTP 密码 / Webhook 密码」分别是什么？要不要换？

二者**不是**同一种东西，也**不是** Cloudflare 账号密码。

| 名称（环境变量） | 是什么 | 谁发的 / 哪里拿 | 干什么用 |
| :--- | :--- | :--- | :--- |
| **`MAIL_SENDER_PASSWORD`** | **邮箱 SMTP 登录口令** | 邮件服务商（`noreply@eqt.net.im`） | Worker 发 OTP / 激活码 / 吊销信 |
| **`PADDLE_WEBHOOK_SECRET`** | **Paddle Webhook 签名密钥**（不是登录密码） | Paddle → Notifications → destination → **Secret key**（`pdl_ntfset_…`） | 校验 `Paddle-Signature` |
| **`PADDLE_API_KEY`** | Paddle **服务端 API Key** | Authentication → API keys | Portal 退款 / **取消订阅** 等主动 API |

**关于「Webhook 最初是不是 secret put？为什么要换？」**

- 正常做法本来就是 **`wrangler secret put PADDLE_WEBHOOK_SECRET`**，不必定期轮换。  
- 2026-07-21 有一次为修绑定，把**同一 secret 明文写进了** `wrangler.toml` 并进 git（commit `8229ce1`）。  
- 2026-07-25 已从 toml **删掉明文**并重新以 Secret 绑定。  
- **若该值从未出现在公开 fork/泄露渠道，可以不换**；只有担心 git 历史被外人看到时，才在 Paddle 后台 Rotate 再 `secret put`。  
- **SMTP** 同理：你已更新 `MAIL_SENDER_PASSWORD` 即可；与 Webhook 无关。

完整表见 [admin/IMPORTANT_drm-secrets.md](./admin/IMPORTANT_drm-secrets.md)。

### 2.3 R5 收口记录（2026-07-25）

| 表面 | 规则 | 核对 |
| :--- | :--- | :---: |
| 代码 | 滚动 365 天，**≥3** 次「已激活」purchase 退款/拒付 → 邮箱/设备门禁；未激活退款不计 | 政策文档 + DRM |
| `terms.html` | three or more / actually activated / 365 days | 一致 |
| `refund.html`（中英 i18n） | 3 次及以上 / 已激活 / 365 天 | 一致 |
| `pricing.html` `checkout_policy_notice` i18n | 中英均为 3 次 | 一致 |
| `pricing.html` **HTML 默认兜底文案** | 曾误写 **2** → 已改为 **3** | **已修** |
| Pricing 结账链到 Terms + Refund | 有 | 一致 |

---

## 3. 有时间再做（不阻塞上线）

| 项 | 说明 | 状态 |
| :--- | :--- | :---: |
| 修 `reqLang is not defined`（Admin 债 D1） | 脏错误日志，不挡用户主路径 | [ ] |
| CF 边缘限流（Admin / OTP） | 加固，非功能缺口 | [ ] |
| 健康页 Paddle key 探针「干净」 | Webhook 正常即可先上 | [ ] |
| Chat：单击气泡下载、详情 sheet | 体验增强；菜单已可用 | [ ] |
| 清空历史测试 license / 错误日志 | 运维卫生 | [ ] |
| **SMTP / Webhook 口令轮换**（R3 后续） | 历史曾明文；改服务商密码 + `secret put` | [ ] |

详见 [admin/IMPORTANT_admin-debt.md](./admin/IMPORTANT_admin-debt.md)。

---

## 4. 明确下一版（不影响「特别使用」）

| 模块 | 下一版内容 | 优先级建议 |
| :--- | :--- | :---: |
| **Chat** | 多媒体预览；移动端下载路径 / 打开目录（需 App 壳）；气泡细节 polish；单击下载 + 详情 sheet | 体验 |
| **Portal** | **订阅 cancel UI**；**发票入口**；改邮箱 / 重发 license；HttpOnly session | 见 §4.2 |
| **Admin** | 自动黑名单可视化；多管理员；Webhook 成功时间线；**反馈中心只读对接**（读 feedback D1，非 DRM） | 运维 |
| **GUI 反馈（独立服务）** | 见 §4.1 — **优先打通邮件通知** | P0 |
| **支付 / 增长** | 更细 CRM、批量运营、营销码运营台 | 后置 |
| **工程** | Admin SPA Playwright；更多 CI E2E | 后置 |

这些都不挡住：「能买、能激活、能传文件、能自助解绑/退款、能运维」。

### 4.1 下一版 · GUI 反馈通道（设计定稿）

> 全文细节：[feedback-design.md](./feedback-design.md) §6。  
> **与 DRM 无关**：不写 `eqt-drm-db`，不走激活/发码路径。

| 阶段 | 内容 | 优先级 |
| :--- | :--- | :---: |
| **F0** | `eqt-feedback-api` 提交成功后 **发邮件**到 `support@eqt.net.im`；From 优先 `sendfeedback@eqt.net.im`（SMTP 若仅允许 `noreply@` 则 From=`noreply@`，Subject 固定 `[EQT Feedback]`）；用户 contact → `Reply-To`；截图用 R2 链接附件说明 | **下一版 P0** |
| **F1** | GUI fallback 文案/mailto 统一 `support@eqt.net.im`（去掉个人 outlook） | **[x] 2026-07-25** 已改 GUI；邮件自动发送仍属 F0 |
| **F2** | Admin「反馈中心」只读列表（Access JWT 调 feedback API 或同源代理） | P1 |
| **F3** | 可选保留 Telegram 为辅通道；状态标签/已读 | P2 |

**身份约定（拍板）**：

```text
From:    sendfeedback@eqt.net.im   （系统身份；禁止伪造用户邮箱作 From）
To:      support@eqt.net.im
Reply-To: 用户填写的 contact（若有）
Body:    category / version / os / message / imageUrl
```

**为何不是「先只发邮件、砍 Worker」**：现网 GUI 已走 `POST https://feedback.eqt.net.im/goal`（WebP 压缩 + Go 桥 + D1/R2）。邮件是 **通知通道**，不是替换入库；Admin 日后列表仍依赖 D1。

### 4.2 下一版 · Portal「订阅 Cancel UI」与「发票」如何推进

> 现状：Portal 阶段 4 **已具备**登录 / 列表 / 解绑 / 自助退款；`paddle_subscription_id` 已展示；**Webhook 已处理** `subscription.canceled` / past_due / paused → 吊销。  
> **缺口只在用户侧「主动操作入口」与「账单凭证入口」**，不在 DRM 吊销模型本身。

#### A. 订阅 Cancel UI（年付订阅用户）

| 项 | 说明 |
| :--- | :--- |
| **适用对象** | 仅 `paddle_subscription_id` 非空 **且** 当前仍为年付订阅权益的 license（终身买断 **无** 订阅可取消） |
| **产品语义** | **取消续费 / 结束订阅 ≠ 退款**。Cancel 后：当前周期是否立刻吊销，以 Paddle 配置与 webhook 为准（现网 webhook 在 canceled/past_due/paused 时 **会 revoke**——实现前须产品确认：是「到期后失效」还是「立即失效」） |
| **与退款关系** | 14 天冷静期要退钱 → 走已有 **Refund**；仅不想下一年扣款 → 走 **Cancel**。UI 文案必须拆开 |

**推荐推进步骤（由浅到深）**：

| 步 | 做法 | 工作量 | 依赖 |
| :---: | :--- | :---: | :--- |
| **C0** | 深链 Paddle 客户门户 | 可选；已被 C1 覆盖主路径 |
| **C1** | **自建 Cancel** → `POST /api/v1/user/cancel-subscription` → Paddle `effective_from: immediately` + **立刻本地 revoke** | **[x] 2026-07-25** |
| **C2** | UI：二次确认 Modal（明确非退款 / 立刻失效）+ 刷新列表 | **[x] 2026-07-25**（`portal.html`） |
| **C3** | E2E：sandbox 年付 cancel | 可选后续 |

**产品拍板**：取消后 **立刻 revoke**（与 webhook `subscription.canceled` 一致；API 路径不等待 webhook）。

#### B. 发票（Invoice）

| 项 | 说明 |
| :--- | :--- |
| **事实** | EQT 是 **Paddle MoR**；发票/税务单据的权威方是 **Paddle**，不是 EQT 自开发票 PDF |
| **终身单** | 按 **transaction** 有收据/发票；Portal 已有 `paddle_transaction_id` |
| **年付** | 每期续费各有 transaction；订阅维度可在 Paddle 账单历史查看 |

**推荐推进步骤**：

| 步 | 做法 | 工作量 | 依赖 |
| :---: | :--- | :---: | :--- |
| **I0** | Portal 文案 + 链接：**「发票与收据由 Paddle 提供」** → 链到 Paddle 客户账单页 / 官方说明；客服邮箱 `support@eqt.net.im` 协助 | **极小** | 无代码 API |
| **I1** | 卡片展示 `paddle_transaction_id`（已有）旁加「在 Paddle 查看订单」深链（若 API/portal 支持按 txn 打开） | 小 | Paddle Customer Portal 配置 |
| **I2** | 可选：服务端用 `PADDLE_API_KEY` 拉 `GET /transactions/{id}` 或 invoices 相关端点，返回 **Paddle 托管的 PDF/页面 URL** 给前端新开标签（**不**自己生成 PDF） | 中 | API 权限 + live key |
| **I3** | 自建 PDF 发票 | **不做**（与 MoR 职责冲突、税务合规成本高） | — |

**建议默认路径**：**I0 + I1 即可满足发布后对客**；I2 仅当用户强烈要求「一键打开 PDF」再做。

#### C. 排期建议（相对发布）

| 时机 | 做啥 |
| :--- | :--- |
| **发布前** | **不必**做 Cancel UI / 发票 API；条款已写支持邮箱 + Paddle；年付用户可暂时：Paddle 邮件里的管理链接 / 联系 support |
| **发布后第一迭代** | I0 文案 + C0 深链（半天级） |
| **有年付投诉量后再** | C1/C2 内嵌取消；I2 交易发票 URL |

#### D. 与现有代码锚点

| 能力 | 现状 |
| :--- | :--- |
| 展示 `paddle_subscription_id` | `portal.html` 卡片已渲染 |
| 订阅取消 → 吊销 | `paddle.ts` webhook `subscription.canceled` / updated |
| 退款 | `portal.ts` `POST .../refund` + adjustments |
| 发票 API | **无** |
| Cancel API | **无**（仅 webhook 被动） |

契约增量将来写入 [portal/api-contract.md](./portal/api-contract.md)；进度勾选写入 [portal/progress.md](./portal/progress.md)。

---

## 5. 发布冻结验收（建议半天内完成）

### 5.1 配置（必做）

- [~] 去掉生产 `TEST_MAIL_RECEIVER`（toml 已去；Dashboard 确认）
- [ ] 确认 live Paddle（价格 ID、Webhook、API key）
- [x] 敏感项进 secret（SMTP 密码 + Webhook + TG token）；**建议再轮换口令**
- [ ] Access 仅运维邮箱；Admin 无 Secret 登录

### 5.2 真人闭环（各 1 次）

| # | 路径 | 期望 | 状态 |
| :---: | :--- | :--- | :---: |
| A | 真实邮箱 OTP + 客户端激活 | 码可用、设备绑定成功 | [ ] |
| B | 桌面收发文件 + 检查更新 | 传输完成；更新走 R2 | [ ] |
| C | Portal 解绑（可选：沙箱/小额退款） | 设备数变化；退款则 license revoked | [ ] |
| D | Admin 查 license + 黑名单读写 | Access 登录；列表/封禁/解封 | [ ] |
| E | Chat 手机扫码传文件 | 气泡无底栏按钮；长按/滑动出菜单 | [ ] |

### 5.3 文档（建议）

- [ ] 本清单 R1–R7 全部勾选（R3/R5 已 x）
- [ ] 对客 FAQ：退款、黑名单、解绑离线窗口、移动下载路径
- [ ] 回滚：Worker / Pages 上一版本 ID 记在验证记录

---

## 6. 关键域名与工程落点（速查）

| 面 | 线上 | 工程 |
| :--- | :--- | :--- |
| 官网 / Portal | `https://www.eqt.net.im` | `cloudflare/eqt-website/` |
| DRM API | `https://lic.eqt.net.im` | `cloudflare/eqt-drm-api/` |
| Admin | `https://admin.eqt.net.im` | `cloudflare/eqt-admin/` |
| 反馈 API | `https://feedback.eqt.net.im` | `cloudflare/eqt-feedback-api/`（**非 DRM**） |
| 下载 CDN | `https://download.eqt.net.im` | R2 + Worker 路由 |
| 桌面 | 安装包 / Wails GUI | `desktop/gui/`、`scripts/build-artifacts.sh` |
| Chat v2 | 随服务端 / 嵌入页 | `pkg/chat/v2/` |

部署命令习惯见 [admin/IMPORTANT_admin-release.md](./admin/IMPORTANT_admin-release.md) 与 [admin/ops-guide.md](./ops-guide.md)。

---

## 7. 验证记录（排查时追加）

| 日期 | 操作人 | 项（R# / A–E） | 结果 | 备注 |
| :--- | :--- | :--- | :--- | :--- |
| 2026-07-25 | — | 清单落盘 | 文档创建 | 待人工排查 R1–R7 |
| 2026-07-25 | agent | **R3** | 通过 | toml迁 secret；drm + feedback 已 deploy |
| 2026-07-25 | agent | **R5** | 通过 | pricing 兜底 2→3；terms/refund/pricing i18n 与 ≥3/365 一致 |
| 2026-07-25 | agent | 反馈计划 | 文档 | §4.1 + feedback-design §6；F0 邮件通道下一版 |
| 2026-07-25 | agent | 同步清单 | 文档 | §2.2.1 SMTP/Webhook 释义；§4.2 Cancel/发票推进 |
| 2026-07-25 | agent | Cancel C1/C2 | 通过 | `cancel-subscription` 立刻 revoke；Portal UI；Worker `f934e80d…`；Pages 已发 |
| 2026-07-25 | agent | 年付续费同码 | 通过 | `transaction.completed` 按 `subscription_id` 延长 expires_at，不新发码 |
| | | | | |

---

## 8. 一句话

**功能上已够正式发布；发布前要「定配置 + 定口径 + 跑通真人闭环」，而不是再开大功能。**  
R3/R5 已收口；仍优先确认 `TEST_MAIL_RECEIVER` 残留、Paddle live 与真人闭环。  
订阅 Cancel / 发票以 **Paddle 深链（C0/I0）** 为第一刀，不挡发布；反馈邮件 F0 与内嵌 Cancel（C1）进下一版。
