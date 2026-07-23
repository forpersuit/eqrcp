# EQT 用户 Portal 修复进度

> 以**代码与契约事实**为准更新。功能说明见 [overview.md](./overview.md)，契约见 [api-contract.md](./api-contract.md)。

最后更新：2026-07-24（阶段 4 完成；Chrome 9222 Portal 验收通过）

---

## 阶段勾选

### 阶段 0 — 文档落地

- [x] 创建 `docs/portal/` 目录
- [x] `README.md` 索引
- [x] `overview.md` 功能与效果总览
- [x] `api-contract.md` API 契约
- [x] 本 `progress.md` 修复清单

### 阶段 1 — P0 正确性 / 安全

| # | 项 | 状态 | 说明 |
| :---: | :--- | :---: | :--- |
| P0-1 | `unbind-device` 所有权校验 | [x] | `licenseOwnedByEmail`；403 `not_license_owner` |
| P0-2 | Portal `auth/send-code` 60s 限流 | [x] | 429 `rate_limited` i18n |
| P0-3 | schema：`verification_codes.created_at` | [x] | 限流依赖 |
| P0-4 | E2E fixture 带 `buyer_email(_hash)` | [x] | `e2e@eqt.im` |
| P0-5 | E2E：跨用户 unbind 拒绝 | [x] | Step 9 |
| P0-6 | E2E：发码 429 限流 | [x] | Step 10 |

### 阶段 2 — P1 完备性

| # | 项 | 状态 | 说明 |
| :---: | :--- | :---: | :--- |
| P1-1 | refund 错误/成功 i18n | [x] | |
| P1-2 | unbind 校验 activation 存在 | [x] | |
| P1-3 | `POST /auth/logout` + 前端调用 | [x] | |
| P1-4 | unbind modal max 用 API 值 | [x] | |
| P1-5 | refund body 传 `lang` | [x] | |
| P1-6 | 日期 locale 映射 7 语 | [x] | |

### 阶段 3 — 验证与交付（v1.16.1）

| # | 项 | 状态 | 说明 |
| :---: | :--- | :---: | :--- |
| V1–V6 | 版本 / 部署 / e2e / push / pages | [x] | 见历史验证记录 |

### 阶段 4 — 剩余债清扫（v1.16.2）

| # | 项 | 状态 | 说明 |
| :---: | :--- | :---: | :--- |
| P4-1 | Portal/Checkout 验证码存储隔离 | [x] | `portal:{email}` / `checkout:{email}` |
| P4-2 | OTP verify 失败限流 | [x] | D1 键 `fail:{purpose}:{ip}:{email}`，15min/8 次 → 429 |
| P4-3 | unbind 要求 license `active` | [x] | 403 `license_not_active` |
| P4-4 | Portal 退款成功后发吊销邮件 | [x] | `REFUND_REVOKE_EMAIL_I18N` 异步 |
| P4-5 | 前端退款单飞锁 | [x] | `refundInFlight` + 按钮 disable |
| P4-6 | E2E：隔离 / 非 active unbind / verify 429 | [x] | Step 11–13 |
| P4-7 | 契约与 overview 同步 | [x] | |
| P4-8 | 版本 `v1.16.2` + 部署 + e2e + push | [x] | Worker `bef03b91-...` |

#### 阶段 4 仍不做（产品/架构后置）

| 项 | 原因 |
| :--- | :--- |
| 订阅 cancel UI | 产品未要求 |
| 持久化 `refunded` 状态 | 统一 `revoked` |
| Portal Chrome UX E2E | 以 API E2E 为准 |
| 改邮箱 / 重发 license / 发票 | 产品边界外 |
| SMTP 默认密码 fallback 移除 | 运维密钥债 |
| Session 改 HttpOnly Cookie | 跨域架构成本 |

---

## 验证记录

### 阶段 1–3（v1.16.1）

| 时间 | 结果 |
| :--- | :--- |
| 2026-07-24 | Step 0–11 通过；push `ae892a4` / `f505690` |

### 阶段 4（v1.16.2）

| 时间 | 命令 / 动作 | 结果 |
| :--- | :--- | :--- |
| 2026-07-24 | `wrangler deploy` | Version `bef03b91-9ec3-4e45-a1b9-d3cf5bb859f3` |
| 2026-07-24 | `npm run test:e2e` | **全部通过 Step 0–14** |
| 2026-07-24 | Pages deploy | 推进中/完成见 commit |
| 2026-07-24 | git push | 见 commit |
| 2026-07-24 | Chrome 9222 Portal 冒烟 | 登录页 / 中文 / 未购买 toast / `?email=` 预填 / 结构 Modal — 全绿；截图 `docs/portal/chrome-portal-*.png` |

### E2E 关键摘要（阶段 4 新增）

| Step | 断言 |
| :---: | :--- |
| 11 | portal/checkout 双键并存；portal verify 不删 checkout 码 |
| 12 | revoked license unbind → 403「不可用」 |
| 13 | 8 次错误 verify → 429「15 分钟」 |
| 14 | logout → licenses 401 |
