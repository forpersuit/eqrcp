# 订阅续费/退款严格流程与测试验证方案

> **用途**：定义 EQT 订阅制（年付/买断）在 DRM 后端与 Paddle 支付平台对接中的**全生命周期流程**（首购、自动续费、取消订阅、冷静期退款、黑名单门禁）及**两阶段测试验收方案**。  
> **核心原则**：
> 1. **一订阅一激活码 (Single Code Per Subscription)**：年付订阅自动续费不生成新激活码，自动延长现存码过期时间（`expires_at += 365天`）。
> 2. **状态 Webhook/API 驱动**：客户端激活状态、有效期限完全由后端 D1 `licenses` 表与 Paddle 状态保持实时同步。
> 3. **极简自助**：Portal 提供一键取消续费与冷静期退款，取消续费即刻停续止权益，退款严格执行 365 天内 ≥3 次已激活退款黑名单拦截。

---

## 1. 订阅与授权全生命周期流程

```text
                  ┌──────────────────────────────────────────┐
                  │   买家在 Paddle 购买 EQT Plus (年付)      │
                  └────────────────────┬─────────────────────┘
                                       │ Webhook: transaction.completed
                                       ▼
                  ┌──────────────────────────────────────────┐
                  │ 生成激活码 (source='purchase', active)     │
                  │ paddle_subscription_id = sub_xxx         │
                  │ paddle_transaction_id  = txn_111         │
                  │ expires_at = 当前 + 365天                 │
                  └────────────────────┬─────────────────────┘
                                       │
     ┌─────────────────────────────────┼─────────────────────────────────┐
     │ 场景 A: 订阅续费                │ 场景 B: 关闭自动续费            │ 场景 C: 冷静期退款
     ▼                                 ▼                                 ▼
┌───────────────────────────┐     ┌───────────────────────────┐     ┌───────────────────────────┐
│ Paddle 到期自动扣款        │     │ 用户在 Portal 关自动续费  │     │ 用户在 Portal 点击“退款”   │
│ 触发 transaction.completed│     │ 或在 Paddle 控制台关续费  │     │ 或在 Paddle 控制台退款     │
└────────────┬──────────────┘     └────────────┬──────────────┘     └────────────┬──────────────┘
             │                                 │                                 │
             │ 按 sub_xxx 找到原激活码         │ 调 Paddle cancel (next_period)  │ 调 Paddle adjustment API
             │                                 │ 设置 auto_renew = 0             │ 或收到 transaction.refunded
             ▼                                 ▼                                 ▼
┌───────────────────────────┐     ┌───────────────────────────┐     ┌───────────────────────────┐
│ 激活码保持不变 (代码不变)   │     │ 授权保持生效 (status active)│     │ 状态重置:                  │
│ expires_at += 365 天      │     │ auto_renew = 0            │     │ status = 'revoked'        │
│ paddle_transaction_id=222 │     │ 本期继续享用至到期日      │     │ revoke_reason='refund'    │
│ 发送【续费成功】邮件       │     │ 下个周期停止自动扣费      │     │ 评估是否触发 ≥3 次黑名单  │
└───────────────────────────┘     └───────────────────────────┘     └───────────────────────────┘
```

### 1.1 首购发码 (First Fulfillment)
* **Webhook 事件**：`transaction.completed`
* **处理逻辑**：
  1. 校验 Paddle 签名与交易中包含的 EQT Price ID（`PRICE_YEARLY_ID` / `PRICE_LIFETIME_ID`）。
  2. 生成格式如 `EQT-PLUS-YYYYMMDD-XXXXXX-YYYY` 的唯一激活码。
  3. 写入 D1 `licenses` 表：`source='purchase'`, `status='active'`, `paddle_subscription_id=sub_xxx`, `paddle_transaction_id=txn_xxx`。
  4. 发送付费激活码邮件给买家。

### 1.2 年付自动续费 (Subscription Renewal)
* **Webhook 事件**：`transaction.completed`（附带 `subscription_id`）
* **处理逻辑**：
  1. 依据 `subscription_id` 检索 `licenses` 表中的已有激活码。
  2. **激活码保持不变**：`new_expires_at = MAX(当前时间, 原 expires_at) + 365 天`。
  3. **更新记录**：`status = 'active'`, `paddle_transaction_id = 最新扣费单号`（覆盖为当前周期单号，以便当前周期发生退款时准确定位），清除 `revoked_at` 与 `revoke_reason`。
  4. 发送【年付订阅续费成功·激活码不变】邮件通知。
  5. 客户端连网对账（`POST /api/v1/drm/verify`）时自动获得延伸有效期的解密证书。

### 1.3 取消订阅 (Cancel Subscription)
* **触发方式**：Portal 调 `POST /api/v1/user/cancel-subscription` 或用户在 Paddle 控制台取消。
* **Webhook/API 动作**：调用 Paddle API `POST /subscriptions/{id}/cancel`，同时接收 `subscription.canceled` / `subscription.updated`。
* **处理逻辑**：
  1. 更新激活码 `status = 'revoked'`, `revoke_reason = 'subscription'`。
  2. 发送订阅取消提醒邮件。
  3. 不退还已扣钱款，停止下个计费周期扣款，即刻终止当前权益。

### 1.4 冷静期退款与滥用防护 (Refund & Anti-Abuse)
* **触发方式**：Portal 调 `POST /api/v1/user/refund` 或管理员在 Paddle 控制台发起退款。
* **Webhook/API 动作**：调用 Paddle Adjustments API 创建 `refund`，同时接收 `transaction.refunded` 或 `adjustment.created` / `updated`。
* **处理逻辑**：
  1. 更新激活码 `status = 'revoked'`, `revoke_reason = 'refund'`（拒付为 `'chargeback'`）。
  2. **已激活退款黑名单门禁**：若该激活码已被设备激活使用，且该买家在滚动 365 天内退款/拒付累计 **≥ 3 次**，自动将买家邮箱及哈希加入黑名单门禁，拦截后续购买与激活。

---

## 2. Dev 模式 / 兑换发码 API 与测试路由

在开发测试环境（Dev Mode）中，系统提供以下兑换与测试接口：

1. **管理员生成/兑换码 API**：
   * `POST /api/v1/admin/generate-license`（支持生成 `source='promo'` 兑换码、`source='admin'` 客服码或 `source='test'` 测试码）。
2. **QA 造码脚本**：
   * `node tests/mint-qa-licenses.js`（本地快速向 D1 写入各类 source 类型的测试激活码）。
3. **Local Path 本地 Mock 测试分支**：
   * 凡 `source='test'` 或 `paddle_subscription_id` / `paddle_transaction_id` 为合成测试 ID（如 `sub_test_...` 或 `txn_01...`）的激活码，Portal 侧的 `/user/refund` 与 `/user/cancel-subscription` **会自动切入本地 Mock 模拟路径**，不向 Paddle 真实 API 发起 HTTP 请求，直接完成本地 D1 状态重置与邮件模拟发信。

---

## 3. 测试方案设计 (Test Strategy Plan)

测试分为两个阶段进行：

### 阶段一：Dev 本地 Mock 冒烟自动化测试
无需连接真实 Paddle 网络，利用测试专用 API 与合成测试单验证状态机完整性。

* **验证点 1：本地源校验与退款门禁**
  * 执行 `node tests/verify-license-source.js`
  * 确认 `source='test'` 的激活码可以通过 `/user/refund` 进行本地退款，退款后 `status='revoked'`, `revoke_reason='test'`。
  * 确认 `source='admin'` / `promo` 的激活码无法在 Portal 侧发起退款（拒绝并提示非付费订单）。
* **验证点 2：取消订阅 Mock 通道**
  * 在 `verify-license-source.js` 中给测试码绑定 `paddle_subscription_id='sub_test_cancel_e2e'`；
  * 调用 `/api/v1/user/licenses` 检查 `cancellable === true`；
  * 调用 `/api/v1/user/cancel-subscription`，确认返回 `200 OK` (`local_only: true`)，且激活码状态置为 `revoked`，`revoke_reason='subscription'`。
* **验证点 3：闭环防刷黑名单测试**
  * 执行 `node tests/closed-loop-simulation.js`；
  * 连续模拟 3 次激活后退款，确认第 3 次触发黑名单机制，拦截后续激活。

### 阶段二：Paddle Sandbox 环境集成测试
使用 Paddle Sandbox 环境（`PADDLE_API_KEY=pdl_sdbx_...`）与测试信用卡进行全流程闭环验收。

* **步骤 1：首购与激活**
  1. 官网点击年付购买，输入 Sandbox 测试邮箱 `tester-sandbox@eqt.net.im`；
  2. 使用测试卡 `4242 4242 4242 4242` 完成支付；
  3. 检查 Webhook `transaction.completed` 收到并成功写入 D1 `licenses`（保存 `paddle_subscription_id`）；
  4. 启动 EQT 客户端，输入激活码完成设备激活。
* **步骤 2：Paddle Sandbox 手动触发续费 (Bill Now)**
  1. 登录 Paddle Sandbox Dashboard (`https://sandbox-vendors.paddle.com`) -> **Subscriptions**；
  2. 找到对应的订阅，点击 **Actions -> Bill Now**；
  3. 观察 Worker Webhook 接收日志：
     * **验证结果**：未生成新激活码；原激活码 `expires_at` 增加 365 天；`status` 为 `active`；买家收到【续费成功】邮件。
* **步骤 3：Portal 触发取消订阅**
  1. 打开 Portal 页面（`www.eqt.net.im/portal.html`）登录 `tester-sandbox@eqt.net.im`；
  2. 在年付卡片上点击“取消订阅”并二次确认；
  3. 验证返回成功，Paddle Sandbox 后台该订阅状态更新为 `Canceled`，D1 中激活码状态更新为 `revoked`（`revoke_reason='subscription'`）。
* **步骤 4：Portal 触发退款与黑名单**
  1. 使用 Sandbox 购买新订单并激活；
  2. 在 Portal 点击“申请退款”；
  3. 验证 Paddle Sandbox 生成 Refund Adjustment，D1 中激活码变为 `revoked`（`revoke_reason='refund'`）；
  4. 重复测试验证 3 次已激活退款自动触发黑名单隔离。

---

## 4. 测试验证执行记录

| 日期 | 测试阶段 / 脚本 | 验证项 | 结果 | 备注 |
| :--- | :--- | :--- | :---: | :--- |
| 2026-07-25 | Go 单元测试 | `go test ./...` | **PASS** | 100% 通过（Go 后端全模块测试） |
| 2026-07-25 | `tests/verify-license-source.js` | 本地 Mock 来源门禁与 cancel-subscription | **PASS** | 冒烟测试全部通过，cancellable / revoke_reason='subscription' 验证正常 |
| 2026-07-25 | `tests/verify-yearly-renewal.js` | 年付到期自动续费 (不换码/展期365天/单号更新) | **PASS** | 自动续费验证全部通过，激活码代码保持一致，Expires 精确增加 365 天 |
| 2026-07-25 | `tests/closed-loop-simulation.js` | 闭环模拟：激活/退款门禁/黑名单≥3 | **PASS** | 验证通过 |
