# 激活码赠送功能（License Gifting）—— 需求与实施计划

> 状态：**已搁置，转为后续推进项**（2026-08-04 用户决定：当前不推进升级与赠送，两者均为锦上添花；本文档保留为后续实施依据，决策点 D1–D6 待后续确认后再进入实现）
> 关联里程碑：**M5**（与桌面 GUI「购买授权套餐」导航、pricing/PRO 清理、结账邮箱验证国际化、支付成功页国际化等 UI/i18n 项同批，见文末 §8）
> 编写日期：2026-08-04

---

## 1. 需求（用户原话整理）

1. 激活码支持**赠送**；赠送后，该激活码**不再属于原邮箱**账户。
2. 交互流程：
   - 在 portal 授权码卡片区域（自动续费所在行的同侧按钮组）增加 **「赠送」按钮**；
   - 点击 → 弹出**确认提示**；
   - 确认后 → 弹出**目标邮箱输入框，需重复输入 2 次**，第二次校验与第一次输入一致；
   - 点击确认后 → 该激活码从原邮箱账户**移出、转至目标邮箱**。
3. 查看方式：
   - 用户通过**登录 portal** 查看自己的激活码；
   - 或通过**邮箱**查看激活码——邮件中给出**使用和管理的描述内容**。
4. **注意国际化**：全部新增 UI 文案 + 邮件模板。
5. 升级流程：**暂时搁置**（保持已测通状态，本需求不扩展它，见 §8）。
6. 测试：赠送目标邮箱使用 `.env` 中的**另一个测试邮箱**（`TEST_MAIL_RECEIVER_1`）。

---

## 2. 背景与现状核对（代码事实，2026-08-04 复核）

### 2.1 归属模型（`licenses` 表）
- `buyer_email` / `buyer_email_hash` 是 portal 归属判定的唯一信号；`buyer_email_hash` 有索引但**无 UNIQUE 约束**，`license_code` 为 PK（schema.sql:6-22）。
- 归属判定 `licenseOwnedByEmail(license, email, emailHash)`（`src/utils/crypto.ts:23-32`）：命中 `buyer_email_hash === sha256Hex(session.email)` **或** 大小写不敏感的 `buyer_email === email`；两者皆空（Admin 专用码）则 fail-closed。
- portal 授权码列表 `/api/v1/user/licenses`（`src/routes/portal.ts:204-285`）筛选条件：`WHERE buyer_email = ? OR buyer_email_hash = ?`。
- **结论**：赠送 = 更新 `buyer_email` + `buyer_email_hash` 为目标邮箱。原主列表立即不再显示（归属判定失败），目标邮箱登录后自动出现。**无需改列表查询逻辑**。

### 2.2 会话/OTP（portal 登录）
- `/api/v1/user/send-code`（portal.ts:78-153）：**要求该邮箱在 licenses 表有购买历史**（`COUNT(*) ... WHERE buyer_email = ? OR buyer_email_hash = ?`），否则 404 `no_purchase_history`；写 `auth_codes`，60s 限频。
- `/api/v1/user/verify-code`（portal.ts:157-201）：校验后签发 `crypto.randomUUID()` token 存 `user_sessions`，24h 有效。
- 受保护路由统一校验 `Authorization: Bearer <token>` → `SELECT * FROM user_sessions WHERE session_token = ?` → 过期检查（portal.ts:208-226 等 8 处同款）。
- **推论**：赠送完成后，目标邮箱才能通过 send-code 登录（购买历史判定随 `buyer_email` 转移而满足）——这正好符合「赠送后目标可见」。

### 2.3 邮件
- 采购成功邮件 `PURCHASE_EMAIL_I18N`（`src/i18n.ts:554-646`，7 语言全），body 形如 `(planName, code, expiresStr) => HTML 表格`，含 Tier / License Code / Expires / Max Devices / 使用方式；经 `getPurchaseEmailTemplate(lang)` 获取，`sendDRMEmail` + `renderEmailWrapper` 发送（paddle.ts:480-487）。
- `RENEWAL_EMAIL_I18N` 仅 en/zh（其余回落 en）；`DEVICE_NOTIFICATION_I18N`（7 语言）、`AUTH_CODE_EMAIL_I18N`/`CHECKOUT_EMAIL_I18N`（7 语言）、`REVOKE_EMAIL_BY_REASON`（按 reason，仅 zh/en）。
- **结论**：赠送邮件应新做一个 `GIFT_EMAIL_I18N`（7 语言全），结构对齐 `PURCHASE_EMAIL_I18N`（含使用与管理说明），同时给原主发一封转移确认邮件。

### 2.4 国际化结构
- API 文案：`API_I18N`（`src/i18n.ts:2-436`），**每个 key 7 语言**（zh/en/ja/ko/es/de/fr）；`getApiTranslation(key, lang)` 回落 `norm → zh → en → key`。新 key = 补全 7 语言后调用。
- 站点/portal 文案：**独立内联对象** `translations`（`cloudflare/eqt-website/portal.html:233` 起，7 语言），查询 `translations[state.lang] || translations.en`。新 UI 文案需在 portal.html 内补全 7 语言。
- **结论**：新增文案要同时改 `src/i18n.ts`（API/邮件）与 `portal.html`（前端）。

### 2.5 解绑/设备管理
- `/api/v1/user/unbind-device`（portal.ts:288-406）：Bearer + `licenseOwnedByEmail` + status active + 365 天 4 次解绑上限（`MAX_YEARLY_UNBINDS`）+ 删 `activations` + 记 `unbind_records` + 发安全通知邮件。
- **结论**：新主登录后即可用既有解绑能力管理设备，无需新增设备 API。

### 2.6 portal.html 授权码卡片（赠送按钮落点）
- `renderLicenses()`（portal.html:1080-1355）；动作按钮数组 `actionBtns`（1188-1249）；自动续费开关（1213-1230）；按钮渲染在卡片底部行（1291-1293）；事件绑定在 1299-1354；既有弹窗：refund(~170)、cancel-sub(~185)、unbind(~195)。
- **结论**：新「赠送」按钮加在 `actionBtns` 自动续费块旁；新增 `.gift-trigger-btn` 事件 + 新弹窗 + 7 语言 key。

### 2.7 路由
- 新端点加在 `handlePortalRoutes`（portal.ts），沿用 `if (url.pathname === "/api/v1/user/..." && method === "POST")` 早返回块模式。

### 2.8 现网状态
- **无任何 gift/transfer 端点/按钮/处理**（全仓 grep `gift|赠送|gifting|license_transfer` 仅命中"活动赠送=promo 来源"退款文案）。§8 中「升级」按钮（`canUpgrade`，portal.html:1193）已存在于卡片。

---

## 3. 设计决策（需用户确认，标 ⚠️ 的为重点）

| 编号 | 决策点 | 选项 | 建议（v1） |
|---|---|---|---|
| **D1** ⚠️ | **有 auto-renew 订阅的码可否赠送**（Paddle 账单留在原邮箱，新主无账单关系） | A. 禁止赠送（需先关自动续费，license 保持 active 至到期）；B. 允许，portal 归属转移、账单仍归原主 | **A**：最简单、避免"谁在付款"混淆。前端用 `canToggleAutoRenew` 的等价条件隐藏/禁用赠送 |
| **D2** ⚠️ | **赠送后已绑定设备处置** | A. 保留 activations，新主自行解绑；B. 赠送即全部解绑（干净移交，旧设备立即失效） | **A**（默认）：低侵入；但**提示新主**「你收到后建议在 portal 解绑不需要的设备」。若产品更看重"彻底断干净"，选 B（实现也简单，赠实时 DELETE activations） |
| D3 | 赠送给与当前主相同邮箱？ | 拒绝（提示） | **拒绝**，返回明确错误 |
| D4 | 新主能否再次赠送？ | 可（无限链式）/不可（仅一次） | **可**（每任主都是 buyer_email 持有者），但审计链记录每一跳 |
| D5 | 赠送门槛 | active 才能赠；revoked/suspended/过期不可赠 | **status === 'active' 且 expires_at 未过期**才可赠 |
| D6 | 退款/chargeback 与赠送的关系 | 原主退款 → license 被吊销（退款 webhook 按 `paddle_transaction_id` 吊销，**与当前 owner 无关**） | **维持现状**：退款即吊销，且吊销邮件发到当前 `buyer_email`（= 新主），语义正确。在赠送确认弹窗中注明「赠送不可撤销，且退款会吊销授权」 |

> 其余既定约束（不需确认）：目标邮箱需合法格式；赠送需原主登录态；每次赠送写审计记录；按 session/邮箱做限频（防滥用）。

---

## 4. 方案设计

### 4.1 数据层
- 新增表 `gift_records`（schema.sql + `ensureGiftRecordsTable`，幂等）：
  ```sql
  CREATE TABLE IF NOT EXISTS gift_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_code TEXT NOT NULL,
      from_email TEXT NOT NULL,
      to_email TEXT NOT NULL,
      created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_gift_license ON gift_records(license_code);
  ```

### 4.2 后端端点 `POST /api/v1/user/gift-license`
位置：`handlePortalRoutes`（portal.ts），`if (url.pathname === "/api/v1/user/gift-license" && method === "POST")`。

流程（对齐既有 `upgrade-checkout`/`unbind-device` 模式）：
1. 解析 `body = { license_code, target_email }`；`reqLang = extractRequestLang(request, body)`。
2. Bearer 校验 + `user_sessions` 校验（portal.ts:208-226 同款）。
3. `target_email` trim + toLowerCase；格式校验（含 `@`、非空、无空格）；**拒绝 `target_email === session.email`**（D3）。
4. 加载 license → 404 若无；`licenseOwnedByEmail(license, session.email, sha256Hex(session.email))` → 403 若非主。
5. 业务门槛：`status === 'active'` 且未过期（D5）；若 `paddle_subscription_id && auto_renew !== 0` → 400 提示先关自动续费（D1-A）。
6. **原子更新**（防 TOCTOU）：
   ```sql
   UPDATE licenses SET buyer_email = ?, buyer_email_hash = ?
   WHERE license_code = ? AND (buyer_email = ? OR buyer_email_hash = ?)
   ```
   bind(targetEmail, sha256Hex(targetEmail), license_code, session.email, sha256Hex(session.email))；检查 `meta.changes === 0` → 归属已被并发改走，返回 409。
7. 写 `gift_records`（from=session.email, to=target_email）。
8. 限频：按 session.email 每日赠送次数上限（如 10），用 D1 计数或复用 OTP fail-key 模式。
9. 邮件（异步 `ctx.waitUntil(sendDRMEmail(...))`）：
   - **给新主** `GIFT_EMAIL_I18N`（含 license_code、tier、expiry、使用方式、管理说明——登录 portal 用本邮箱）；
   - **给原主** `GIFT_CONFIRM_EMAIL_I18N`（告知已转出，注意赠送不可撤销、退款会吊销）。
10. 返回 `{ success: true, license_code, message }`。

### 4.3 前端（portal.html）
1. `actionBtns` 增加「赠送」按钮（自动续费块旁，portal.html:1213 附近）：
   - 显示条件：`lic.status === 'active' && !isLifetime && !(auto-renew active)`（D1-A 时）；
   - 图标 material-symbols `card_giftcard`。
2. 新弹窗（modal 区，~line 170/185/195 旁）：
   - **第一步**：确认提示（"赠送后该激活码将不属于你，且不可撤销"）；
   - **第二步**：目标邮箱输入 ×2，实时校验两框一致 + 邮箱格式；不一致时禁用确认按钮并提示；
   - 确认 → `fetch('/api/v1/user/gift-license', ...)` → 成功刷新 `loadLicenses()`。
3. 事件绑定 `.gift-trigger-btn`（portal.html:1299-1354 区）。
4. `translations`（portal.html:233）补 7 语言 key：`gift_btn / gift_confirm_title / gift_confirm_desc / gift_email_label / gift_email_repeat_label / gift_email_mismatch / gift_email_invalid / gift_success / gift_error_*`。

### 4.4 i18n 清单（§6 汇总）
- `src/i18n.ts` `API_I18N` 新 key（7 语言）：`gift_not_owner / gift_invalid_email / gift_self_transfer / gift_license_not_active / gift_auto_renew_blocked / gift_target_same / gift_rate_limited / gift_success`。
- `src/i18n.ts` 新 `GIFT_EMAIL_I18N` + `GIFT_CONFIRM_EMAIL_I18N`（7 语言）。
- `portal.html` `translations` 新 key（7 语言）。

### 4.5 审计与防滥用
- `gift_records` 全量记录（原主 → 新主 → 时间），支持退款/客诉回溯。
- 每日每邮箱赠送上限（v1 定 10，可调），超限 429。
- 复用 `logSystemError` 记录异常（如并发改归属）。

---

## 5. 实施步骤（顺序）

1. **DB**：schema.sql 加 `gift_records` 表 + 索引；新增 `ensureGiftRecordsTable(env)`（对齐 `ensureLicenseUpgradesTable`，auth.ts）。
2. **后端**：`POST /api/v1/user/gift-license`（portal.ts），含 §4.2 全部门槛 + 原子更新 + 审计 + 限频。
3. **邮件**：`GIFT_EMAIL_I18N` / `GIFT_CONFIRM_EMAIL_I18N`（i18n.ts，7 语言）。
4. **API i18n**：`API_I18N` 新 key（7 语言）。
5. **前端**：portal.html 赠送按钮 + 两段弹窗（确认 → 邮箱×2 校验）+ 事件 + `translations` 7 语言。
6. **测试**（§6）：离线 handler 测试 + 生产 E2E（`TEST_MAIL_RECEIVER_1` 为目标邮箱）。
7. **部署 + 回归**：wrangler deploy；跑既有 §6.7 离线/生产 E2E 确认升级流程未回归。
8. 每个完成的子步按仓库规范 commit + push。

---

## 6. 测试计划

### 6.1 离线（真实 handler + mock D1，沿用 verify-pending-lifetime-upgrade-offline.js 的编译模式）
- 归属校验：非 owner 会话 → 403。
- 门槛：revoked/过期 → 拒绝；auto-renew 激活 → 400（D1-A）。
- 自我赠送 → 拒绝（D3）；非法邮箱 → 拒绝。
- 正常赠送：buyer_email/buyer_email_hash 更新为 target；`gift_records` 落 1 行；原主列表不再含该码。
- 原子更新：并发改归属后 `meta.changes === 0` → 409。
- 限频：超限 → 429。
- 邮件：GIFT_EMAIL 发给 target、GIFT_CONFIRM 发给原主（mock SMTP 拦截断言）。

### 6.2 生产 E2E（用 `TEST_MAIL_RECEIVER` → `TEST_MAIL_RECEIVER_1`）
1. 直接 D1 铸造一张 active 年付码，`buyer_email = TEST_MAIL_RECEIVER`（created_at 置于 14 天前，避免退款窗口干扰）。
2. 以 `TEST_MAIL_RECEIVER` 登录 portal（send-code → verify-code，测试环境 OTP 回显），拿 session token。
3. `GET /api/v1/user/licenses` → 该码可见。
4. `POST /api/v1/user/gift-license { license_code, target_email: TEST_MAIL_RECEIVER_1 }` → 200。
5. 再次 `GET /api/v1/user/licenses`（原主）→ 该码**消失**。
6. 以 `TEST_MAIL_RECEIVER_1` 走 send-code（此时购买历史判定已满足）→ verify-code → `GET /api/v1/user/licenses` → 该码**出现**。
7. 校验 `gift_records` 落行；校验 GIFT 邮件送达（目标邮箱收件箱）。
8. 边界：吊销/过期码赠送被拒；自我赠送被拒；auto-renew 激活码赠送被拒（若 D1-A）。
9. 清理：删除测试码 + gift_records。

### 6.3 回归
- 跑 `npm run test:upgrade:offline`（§6.7 7 项）与 `npm run test:upgrade:e2e`（生产），确认升级流程保持可测通。

---

## 7. 升级流程搁置说明（"暂时先不管，但要测通"）

- **搁置内容**：portal 升级按钮的下一步、立即生效/待生效升级分支的继续演进、桌面「购买授权套餐」按钮（见 M5 #1）。**均不做新的开发**。
- **保持测通**：§6.7 已实现+已部署（Worker `23bbe7fb`），离线 7 项测试 + 生产 E2E（唯一索引、惰性翻转）+ 回归套件保持绿。
- **⚠️ 未闭环遗留（升级相关，回归时需补查）**：2026-08-03 用户在生产完成一次真实 sandbox 终身升级支付，但生产 `license_upgrades` **未产生 pending 行**、`system_error_logs` 也无新条目。可能原因：webhook 延迟 / 目标码处于 14 天退款窗口被 400 拦截 / 支付未真正完成。回归升级流程时，应重新做一次真实支付闭环观察，或直接以 `.env` 的 `PADDLE_WEBHOOK_SECRET` 签名构造 webhook 验证 `pending` 创建。
- **升级按钮意义存疑**：portal 卡片已有 `canUpgrade` 判定（active && 非 lifetime && 无 pending_upgrade）与 `upgrade-trigger-btn`；「是否保留该按钮」留待 M5 评审，本需求不决策。

---

## 8. 关联的 M5 任务清单（本次不做，仅登记）

| # | 内容 |
|---|---|
| M5-1 | 桌面 GUI「套餐/授权-钻石-Plus-购买授权套餐」按钮点击应进入 pricing 页 |
| M5-2 | pricing 页 + 网站主页仍含 PRO 相关内容，需移除 |
| M5-3 | 购买套餐邮箱验证弹窗的 send code 按钮及点击响应信息未国际化 |
| M5-4 | Paddle 支付成功页未国际化（"License key details sent to" 等提示，需排查其余未国际化部分） |
| M5-5 | 结账前邮箱验证与 portal 邮箱验证是否共用；结账前 send code 点一次无反应，体验不如 portal |

---
*（本文档为规划稿；决策点 D1–D6 确认后转为实现，按 §5 步骤推进。）*
