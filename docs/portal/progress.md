# EQT 用户 Portal 修复进度

> 以**代码与契约事实**为准更新。功能说明见 [overview.md](./overview.md)，契约见 [api-contract.md](./api-contract.md)。

最后更新：2026-07-24

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
| P0-1 | `unbind-device` 所有权校验 | [x] | `licenseOwnedByEmail`（hash 或 buyer_email）；403 `not_license_owner` |
| P0-2 | Portal `auth/send-code` 60s 限流 | [x] | 对齐 checkout；429 `rate_limited` i18n |
| P0-3 | schema：`verification_codes.created_at` | [x] | SSOT + runtime `ensureVerificationCodesCreatedAt`（生产列已存在） |
| P0-4 | E2E fixture 带 `buyer_email(_hash)` | [x] | `e2e@eqt.im` + SHA-256 |
| P0-5 | E2E：跨用户 unbind 拒绝 | [x] | Step 9 → 403「无权」 |
| P0-6 | E2E：发码 429 限流 | [x] | Step 10 注入近时 `created_at` |

### 阶段 2 — P1 完备性

| # | 项 | 状态 | 说明 |
| :---: | :--- | :---: | :--- |
| P1-1 | refund 错误/成功 i18n | [x] | `API_I18N` keys + `extractRequestLang` |
| P1-2 | unbind 校验 activation 存在 | [x] | 404 `activation_not_found` |
| P1-3 | `POST /auth/logout` + 前端调用 | [x] | 服务端删 session；前端 best-effort |
| P1-4 | unbind modal 的 max 用 API 值 | [x] | `data-max-unbinds` |
| P1-5 | refund body 传 `lang` | [x] | `state.lang` |
| P1-6 | 日期 locale 映射 7 语 | [x] | zh/en/ja/ko/es/de/fr |

### 阶段 3 — 验证与交付

| # | 项 | 状态 | 说明 |
| :---: | :--- | :---: | :--- |
| V1 | 小版本号 +1 | [x] | `v1.16.0` → `v1.16.1` |
| V2 | Worker 部署 | [x] | `wrangler deploy` Version `d8b94e67-8805-4724-93c2-91d987afd405` |
| V3 | `npm run test:e2e` 通过 | [x] | 含 Step 9–11 Portal 新断言 |
| V4 | 更新本 progress 验证记录 | [x] | 见下表 |
| V5 | git commit + push | [ ] | 智能推送脚本 |
| V6 | Pages 部署 portal.html | [ ] | `wrangler pages deploy` |

---

## 本轮不做（明确后置）

| 项 | 原因 |
| :--- | :--- |
| 订阅 cancel UI | 产品未要求；仅展示 subscription id |
| 验证码暴力次数上限（IP） | 可后置；先做发码 60s |
| 区分 `refunded` vs `revoked` 持久化状态 | 客户端/verify 统一认 `revoked`；UI 用 `status_revoked` |
| Portal 专用 Chrome UX E2E | 本轮以 API E2E 为准 |

---

## 验证记录

| 时间 | 命令 / 动作 | 结果 |
| :--- | :--- | :--- |
| 2026-07-24 | `CLOUDFLARE_API_TOKEN="" npx wrangler deploy`（eqt-drm-api） | 成功；Version `d8b94e67-...` |
| 2026-07-24 | `npm run test:e2e`（`lic.eqt.net.im`） | **全部通过**（Step 0–11）：激活/对账/超限/解绑/年限额 i18n/未购买拒发码/跨用户 403/发码 429/logout 401 |
| 2026-07-24 | D1 `ALTER verification_codes ADD created_at` | 列已存在（duplicate column，可忽略） |

### E2E 关键结果摘要

| Step | 断言 |
| :---: | :--- |
| 5 | 本人 unbind → 200，`remaining_unbinds: 3` |
| 9 | 他人 license unbind → 403「无权」 |
| 10 | 近时 `created_at` 后 send-code → 429「60 秒」 |
| 11 | logout 后 `GET /user/licenses` → 401 |

备注：Teardown 中删除已 logout 的 session 可能因 D1 鉴权瞬时失败而 partial failure，不影响测试结论（session 已在 Step 11 删除）。
