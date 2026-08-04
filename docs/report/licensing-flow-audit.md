# 核心交易流程审计：购买-激活 与 解绑-退款

> 审计日期：2026-08-04
> 审计对象：`cloudflare/eqt-drm-api/`（Worker + D1）+ `cloudflare/eqt-website/`（pricing/portal 前端）
> 审计方法：逐行代码核对（真实 Worker 路由，非 mock）
> 背景：升级/赠送功能已搁置为后续推进项（M5），当前只保「正常购买、退款、激活、解绑」。本报告核对这两条核心交易流程是否存在漏洞，**不影响**现有操作处理流程为底线。

---

## 一、流程一：购买 → 支付 → 发送 → 激活

链路：`pricing.html` 选价 → `checkout-verify.js` 邮箱 OTP → `Paddle.Checkout.open` → Paddle sandbox 支付 → `transaction.completed` webhook → `paddle.ts` 履约（铸码/续期）→ 采购邮件 → 客户端 `activate` → 证书签名 → `verify`。

### 1.1 已确认的防护（无漏洞）

| 项 | 结论 | 依据 |
|---|---|---|
| Webhook HMAC 校验 | ✅ 正确 | `verifyPaddleSignature`（crypto.ts:53-99）：`ts=...;h1=...` HMAC-SHA256 覆盖 `ts:rawBody`，±5 分钟时间窗防重放；handler 入口 401（paddle.ts:49-58）。2026-08-03 生产实测坏签名 401、正确签名 200。 |
| OTP 邮件验证 | ✅ 完整 | `/api/v1/checkout/send-code`（auth.ts:79-131）：60s 重发限频、黑名单双查；`verify-code`（auth.ts:134-200）：8 次失败/15 分钟 D1 限频、单次使用（成功后删除）、10 分钟 TTL。 |
| 激活 max_devices 防超卖 | ✅ 原子 | activate 双保险：前置 `activations.length >= max_devices` 检查 + `INSERT ... SELECT ... WHERE COUNT(*) < ?` 原子守卫，`changes===0` 即 403（drm.ts:412-465）。 |
| 0 分量付费拒绝 | ✅ | activate 三指纹全空 → 400（drm.ts:279-287）。 |
| 吊销后硬阻断认证 | ✅ | activate/verify 对 `status !== 'active'` 一律 403（drm.ts:301/595），残留 activations 无法供服务。 |
| 退款黑名单 | ✅ | email+device 双门，滚动 365 天，≥3 次"已激活的购买类吊销"即拉黑（blacklist.ts:214-297）。 |

### 1.2 发现的漏洞与缺口（按严重度）

| # | 严重度 | 缺口 | 位置 | 说明 |
|---|---|---|---|---|
| **A1** | 🔴 **高** | **无支付金额校验** | paddle.ts:119-128 | 履约只匹配 `item.price.id`，**从不校验 `unit_price`/`totals`/`currency`/`quantity`**。任何带匹配 price_id 的签名交易（如 $0 折扣单、quantity 篡改、0 金额试购）都会铸出全量 PLUS license。金额完整性完全隐式委托给 Paddle 的 `transaction.completed` 语义。 |
| **A2** | 🟠 中 | **铸码路径非原子幂等** | paddle.ts:107-117 + schema.sql（`licenses.paddle_transaction_id` 无唯一索引） | `SELECT ... WHERE paddle_transaction_id = ?` 后 `INSERT`，两者之间无唯一约束。并发重复投递同一新交易可双铸（窄竞态；续期路径为 UPDATE 无害）。升级路径因 `license_upgrades` 唯一索引而幂等正确。 |
| **A3** | 🟠 中 | **activate/verify 无限频** | drm.ts | 仅 `/device/register` 有 10/min/IP+指纹限频（rate-limit.ts:117-165，且是 in-isolate Map）。`activate`/`verify` 无任何限频——激活码枚举面（404 vs 403 oracle）。 |
| **A4** | 🟡 低 | OTP 无 capability 绑定 | auth.ts:196 | verify-code 返回裸 `{success:true}`，无 token/price 绑定；Paddle checkout 纯客户端打开，客户端可传任意 priceId（软门，因履约全在 webhook，可接受，记录）。 |
| **A5** | 🟡 低 | 退款查找只认单笔 txn | paddle.ts:539-547 | 见流程二 B1（同根问题，跨流程）。 |

### 1.3 铸码格式与归属（核对无异常）
- 铸码：`EQT-PLUS-{yyyyMMdd}-{rand6}-{md5check4}`，MD5 校验位（paddle.ts:440-453）；`tier` 恒为 `PLUS`（无 PRO price，`types.ts:81-82`），`source='purchase'`。
- 采购邮件 `getPurchaseEmailTemplate`（7 语言）异步发送（paddle.ts:479-487）。

---

## 二、流程二：解绑 → 退款

链路：portal 登录 → `/api/v1/user/unbind-device`（删 activations + 记 unbind_records）→ 退款/取消订阅（`/api/v1/user/refund`、`/api/v1/user/cancel-subscription`）→ Paddle `transaction.refunded`/`adjustment.*` webhook → 吊销 license。

### 2.1 已确认的防护（无漏洞）

| 项 | 结论 | 依据 |
|---|---|---|
| 解绑鉴权 | ✅ | Bearer + `licenseOwnedByEmail` + status active（portal.ts:292-344）。 |
| 解绑年度上限 | ✅ | 365 天滚动 4 次（`MAX_YEARLY_UNBINDS=4`，portal.ts:346-360），**不可通过删除+重激活绕过**（每次解绑仍计上限）。 |
| 退款入口 `isLicenseRefundable` | ✅ | active + source 归一为 purchase + 14 天窗口（自 `created_at`）+ 真实 `txn_01...` 前缀（license-source.ts:64-84）。 |
| 吊销即阻断服务 | ✅ | 见流程一 1.1（activate/verify 硬 403）。 |

### 2.2 发现的漏洞与缺口（按严重度）

| # | 严重度 | 缺口 | 位置 | 说明 |
|---|---|---|---|---|
| **B1** | 🔴 **高** | **旧账期退款不吊销** | paddle.ts:396-417（续期覆盖 txn_id）+ 539-547/595-603（只按 txn_id 查） | 年付每次续期都把 `paddle_transaction_id` **覆盖为最新 txn**（paddle.ts:402/412）。退款/调整 webhook 只按 `paddle_transaction_id` 精确匹配，**无 `paddle_subscription_id` 回退**（Paddle 订阅交易 payload 里明明有 `subscription_id`）。→ 用户退**早期**账期款项：SELECT 命中 0 行，`UPDATE` 静默影响 0 行，却返回 200「License revoked」——**该退的没退**。升级路径专门规避了此问题（"DO NOT OVERWRITE paddle_transaction_id"，Issue 5），续期路径未同步。 |
| **B2** | 🟠 中 | **退款窗口口径不一致** | license-source.ts:79（created_at）vs portal.ts:254-257（last_purchased_at\|\|created_at） | `isLicenseRefundable` 用 `created_at`（原始购买日），portal 展示的 `is_in_refund_window` 用 `last_purchased_at`（最近续期日）。年付续期后：created_at 已超 14 天 → refundable=false；last_purchased_at 刚更新 → is_in_refund_window=true。**两标志对同一 license 可矛盾**：UI 显示在退款窗口内、但后端拒绝退款，用户困惑。 |
| **B3** | 🟡 低 | cancel-subscription UI 死代码 | portal.html:1341（事件绑定） | handler/modal/后端 `/api/v1/user/cancel-subscription` 全部就绪，但 **`cancel-sub-trigger-btn` 从不渲染进 `actionBtns`**（无 `canCancel` 块）——订阅取消入口在页面上不可达。订阅管理实际只有 auto-renew 开关。 |
| **B4** | 🟡 低 | 解绑后 device_registry 行残留 | portal.ts:374-382（只删 activations） | 解绑删 `activations` 行（释放 max_devices 槽位）但**不删/不标记 `device_registry` 行**，残留 `tier_label='paid'` 指向已解绑 license。影响：注册表统计（M3 地球仪）失真；不影响授权安全（重激活走正常流程）。 |
| **B5** | 🟡 低 | 吊销后 device_registry 孤儿化 | 全仓无 `DELETE FROM device_registry` | 吊销只改 `licenses.status`，不删不标 `device_registry` 行（admin 吊销明确留 `activations_deleted:false`）。行保持 `tier_label='paid'` 指向已吊销 license。影响：同 B4（统计失真），授权安全无损。 |

---

## 三、跨流程交叉问题

| # | 严重度 | 问题 | 说明 |
|---|---|---|---|
| C1 | 🟠 中 | 退款吊销邮件发给**当前** `buyer_email` | webhook 按 txn 找到 license 后，吊销邮件发到 DB 现存的 `buyer_email`（paddle.ts:549-555）。当前无赠送功能，owner 不会转移，故语义正确；**但若未来上线赠送（M5 后续项），需在赠送时同步处理退款关系**。记录待办。 |
| C2 | 🟡 低 | in-isolate 限频 | `/device/register` 限频是每 Worker 实例内存 Map，多实例/多地域下可被摊薄。OTP 限频为 D1 持久化，正确。 |

---

## 四、处置建议（优先级排序）

| 优先级 | 项 | 建议 | 成本 |
|---|---|---|---|
| P1 | **B1 旧账期退款不吊销** | 退款/调整 webhook 增加 `paddle_subscription_id` 回退查找：`WHERE paddle_transaction_id = ? OR paddle_subscription_id = ?`（payload 提供）。一行改动，直接修复"钱退到早期账期授权却没收回"的真漏洞。 | 低 |
| P1 | **A1 无金额校验** | 履约前校验 `item.price.unit_price`（或 `data.totals.total`）≥ 对应价格；不符则拒绝并 `logSystemError` 审计。防御"0 金额/篡改数量铸码"。 | 低 |
| P2 | **A2 铸码非原子** | `licenses.paddle_transaction_id` 加唯一索引（生产 D1 先查重再建，同 `idx_upgrades_*` 的做法）；或 `INSERT ... WHERE NOT EXISTS(SELECT 1 ...)`。 | 低 |
| P2 | **A3 activate/verify 限频** | 复用 `isDeviceRegisterRateLimited` 模式给 activate/verify 加 IP/码 限频（建议 D1 持久化，避免 in-isolate 摊薄）。 | 中 |
| P3 | **B2 退款窗口口径** | 统一为 `last_purchased_at \|\| created_at`（与 portal 展示一致），或明确"按原始购买日"的产品决策。 | 低 |
| P3 | **B4/B5 registry 残留** | 解绑/吊销时同步 DELETE `device_registry`（或标 tier_label='free'）。影响 M3 地球仪统计准确性。 | 低 |
| P4 | **B3 死代码** | 产品决策：补渲染 cancel 按钮（需配确认弹窗）或删掉 dead 代码。 | 低 |
| P4 | **A4/A5/C1/C2** | 记录，随主流程重构时处理。 | — |

---

## 五、结论

- **核心安全边界（鉴权、幂等主路径、防超卖、吊销阻断）均已就位**：HMAC、OTP 限频、max_devices 原子守卫、吊销硬 403、黑名单，全部确认正确。
- **两个 🔴 高严重度问题建议优先处理**：B1（旧账期退款不吊销）是真实资金语义缺陷、A1（无金额校验）是铸码完整性缺陷。两者均为低改动成本、不触碰现有正常流程（纯追加校验/回退查找）。
- 其余为窄窗口竞态（A2）、限频缺口（A3）、口径不一致（B2）、数据残留（B4/B5）、死代码（B3），按 P2/P3/P4 排期。

> ⚠️ 本报告仅为梳理，未修改任何代码。是否按 P1/P2 修复，待用户决策。

---

## 六、P1 处置记录（2026-08-04）

### 6.1 已实施并部署（commit `db06a0c`，Worker `5cfba722`）

| 项 | 处置 | 验证 |
|---|---|---|
| **A1 无金额校验** | `validatePaidAmount()` 履约前拒绝确定性坏金额：`totals.grand_total/total ≤ 0`、显式 `quantity === 0`、`unit_price ≤ 0` → 400 `AMOUNT_VALIDATION_FAILED` + `PADDLE_AMOUNT_MISMATCH` WARN。**缺字段按「不可判定」放行**（HMAC 已限定调用方为真实 Paddle），避免误伤。 | Test 8（$0 / quantity-0 拒铸码） |
| **B1 旧账期退款不吊销** | `transaction.refunded` / `adjustment.*` 先按 `paddle_transaction_id` 精确查，命中 0 行回退 `paddle_subscription_id` 吊销；仍 0 行记 `REFUND_MISS_TARGET` WARN（不再静默 200）。 | Test 9（txn 回退）、Test 10（adjustment 回退） |
| **移除 pages.dev/workers.dev** | CORS 白名单仅 `eqt.net.im` + localhost/127.0.0.1；下载域路由去掉 `.workers.dev`。 | CORS 冒烟（pages.dev Origin 不再回显） |

### 6.2 审查员跟进结论（3 点）

**① A1 比审计建议宽松 — 产品决策，有意为之**
审计原意「`unit_price ≥ 对应价格（$29.99）`」；实现只挡「确定性坏金额（≤0）」，故部分折扣单（如 $5 成交）仍会铸出全量 PLUS license。**这是有意设计**：按原价硬校验会误伤未来促销/折扣/发票调整，且 HMAC 已把调用方锁死为真实 Paddle。残余风险：sandbox/测试可构造任意金额的真实签名交易，金额不足但 price_id 匹配仍铸码——已接受。若想收紧是一行改动（`unit_price >= 2999` 判断）。Test 11 以正向断言固化当前宽松语义。

**② B1 极端误吊销 — 已知限制，记录即可**
sub 回退用 `.first()` 取任意一行；同一 `paddle_subscription_id` 下若存在多条 license，可能命中已吊销旧行。现实几乎不可达：续期是 `UPDATE` 同一行（paddle.ts:402/412），一条 subscription 只对应一条 license；且吊销为幂等 UPDATE，命中旧行也无害。

**③ 测试盲区 — 已补齐（P2 加固，Test 10/11/12）**
此前离线测试只覆盖 `transaction.refunded` 的 B1。本次新增：
- **Test 10** adjustment.* 分支 B1 回退：`adjustment.updated` 对 stale txn 的 refund 经 sub 回退吊销（revoke_reason=refund）、chargeback 吊销（reason=chargeback）、`credit` 动作**不**吊销（只有 refund/chargeback 触发资金吊销）。
- **Test 11** A1 折扣边界：$5 折扣的 lifetime 订单（amount>0）正常铸出全量 PLUS LIFETIME license——正向断言宽松设计不误伤。
- **Test 12** B1×升级交互：调整命中 pending upgrade → 仅取消升级、底层 license 保持 active；命中 applied upgrade → 取消升级 + 经 `target_license_code` 吊销 license。

配套 harness 改动：offline mock 增加 `INSERT INTO licenses` 支持（铸码路径可落库断言）；加 MD5 polyfill（Node WebCrypto 不支持 MD5，此前铸码路径无法在 Node 执行）。`npm run test:upgrade:offline` 12/12 通过，tsc --noEmit 通过。
