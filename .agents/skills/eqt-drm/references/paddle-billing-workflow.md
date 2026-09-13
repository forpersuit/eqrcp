# Paddle 支付履约、订阅续期与 0 元防呆机制参考规范

本参考文档收录 Paddle Webhook HMAC 验签、自动续费开关与 scheduled_change 双向同步、年付转终身待生效升级、0 元订单退款防呆以及兑换码生成管理工具的完整实现。

---

## 4. 兑换码生成与管理工具 (License Code Generation)

使用 [generate-license.sh](file:///home/yelon/develop/me/eqrcp/scripts/generate-license.sh) 自动化脚本快速生成兑换码，并自动屏蔽 `CLOUDFLARE_API_TOKEN` 环境变量干扰安全写入 Cloudflare D1：

```sh
# 生成默认 PLUS 永久授权码并写入云端 D1
./scripts/generate-license.sh

# 生成 PRO 级别、限制绑定 1 台设备的临时兑换码并写入本地 D1 测试
./scripts/generate-license.sh -t PRO -m 1 -e "2027-06-25T12:00:00Z" --local
```

生成格式为 `EQT-TIER-YYYYMMDD-RANDOM-CHECK`（`CHECK` 为前 3 项拼接后取 SHA-256 前 4 位大写字符校验）。

- **设备解绑闭环**：支持 `/api/v1/device/unbind` (POST) 端点，客户端重置激活时携带硬件指纹自动静默释放服务端 activations 席位并回退 device_registry 状态。
- **固化有效期计算**：带 `duration_days` 的激活码（如 promo / admin 活动码）在首次激活时基于 `activated_at` 固化到期时间，后续 verify 在线对账严格继承该固化值，杜绝动态滚动续期。

---


---

## 5. Paddle 支付履约 Webhook、订阅续期与年付→终身待生效升级

在 Cloudflare Workers (`eqt-drm-api`) 和 D1 数据库中实现专有通道：
- **D1 字段与扩展表**：`paddle_transaction_id`（交易 ID）、`paddle_subscription_id`（订阅 ID）以及 `license_upgrades` 表（记录年付转终身的待生效升级，包含字段 `user_email`, `target_license_code`, `lifetime_txn_id`, `purchased_at`, `effective_at`, `status`）。
- **年付→终身待生效升级 (§6.7 架构)**：
  1. **全额买断与状态隔离**：用户在年付订阅期间全额购买终身升级，不会立即覆盖现有年付到期日，终身权益在当前年付到期时刻（`effective_at` 快照）生效；
  2. **14 天退款窗口期阻断**：新购 14 天退款窗口期内的年付码不可直接升级，引导用户先退款再直接购买终身版；
  3. **防双重扣款 (Auto-renew OFF)**：建立待生效升级时，服务端自动取消该激活码在 Paddle 侧下一个账期的自动续费 (`auto_renew = 0`)；
  4. **惰性生效 (Lazy Flip)**：客户端在 `verify` / `activate` 时触发 `checkAndApplyPendingUpgrade`，当 `now >= effective_at` 时翻转 `expires_at = 'LIFETIME'` 且更新 `license_upgrades.status = 'applied'`，无须 cron 任务；
  5. **退款撤回**：若待生效期间终身升级交易被退款，`license_upgrades.status` 改为 `'cancelled'`，目标年付激活码保持原年付期效与功能。
- **路由设计**：
  1. `/api/v1/paddle/webhook` (POST)：接收 `Paddle-Signature` 利用 HMAC-SHA256 验签。履约 `transaction.completed` 时判断 Lifetime/Yearly 或 `target_license_code` 升级参数。捕获 `transaction.refunded` 或 `subscription.canceled` 时更新状态：
     - **取消订阅语义区分**：`data.effective_from === 'immediately'` 时立即吊销授权并同步将 `device_registry` 降级为 `free`；`next_billing_period`（或默认停续）仅置 `auto_renew = 0` 并保留本期权益至 `expires_at`。
  2. **自动续费开关必须双向同步 Paddle scheduled_change**（2026-08-23 线上复现的 bug 教训）：
     - **关闭**（`auto_renew=0`）：调 Paddle `POST /subscriptions/{id}/cancel`（`effective_from: next_billing_period`，保留本期权益）后，再本地 D1 `auto_renew=0`。
     - **重新开启**（`auto_renew=1`）：**必须同时**调 Paddle `PATCH /subscriptions/{id}` 传 `{"scheduled_change": null}` 移除已排定的周期末取消，再本地 `auto_renew=1`。只改 D1 会导致 UI 显示「自动续费：开启」但 Paddle 周期末仍取消订阅，续费永远不会发生。
     - **恢复已排定取消的官方 API**：`PATCH /subscriptions/{subscription_id}` body `{"scheduled_change": null}`（与 cancel/pause 的 POST 不同，移除类变更用 PATCH）。
     - **回归测试入口**：`npm run test:portal:toggle:offline`（esbuild bundle portal.ts + `node:sqlite`，stub `global.fetch` 断言 OFF→POST cancel、ON→PATCH `scheduled_change:null`、非 purchase 403 且不调 Paddle）。
  2. `/api/v1/paddle/license-query` (GET)：接收 `transaction_id`，供前端支付完成（`checkout.completed`）时轮询弹出新授权码。
  3. `/api/v1/verify` (POST)：客户端对账时透传 `device_id`，与云端硬件漂移容忍机制（`device_id` 匹配 + 至少 1 项非空指纹匹配）闭环对接。

---


---

## 15. 0 元订单 / 100% 优惠券退款防呆与屏蔽规范 (Zero-Payment Refund Shielding)

- **第一性原理与 Paddle 限制**：
  - Paddle Billing 的 `/adjustments` 退款接口只接受实付捕获金额 > 0 的交易。对于实付 `$0.00` 的订单（如 100% 优惠券、内测 0 元订单），调用 Paddle 退款接口会返回 `adjustment_transaction_without_captured_payment` 错误。
- **端到端屏蔽方案**：
  - **数据层**：`licenses` 表维护 `paid_amount REAL DEFAULT NULL`。Paddle Webhook 在初始发放、续费及升级时从 `data.details?.totals`（兼容 `data.totals`）持久化实付总金额（`totals.grand_total ?? totals.total`）。
  - **规则层 (`isLicenseRefundable`)**：若 `paid_amount !== null && Number(paid_amount) <= 0`，判定 `refundable: false`。
  - **Webhook 履约校验 (A1 Gate)**：`validatePaidAmount` 通过 `data.details?.totals` 严格校验实付金额。非法的 0 元订单（`grand_total <= 0` 且无有效单价）将在 Webhook 阶段直接拒绝发码并返回 400 `AMOUNT_VALIDATION_FAILED`，防止恶意构造 0 元交易刷取授权。
  - **Portal 页面前端**：许可证列表仅在 `lic.status === 'active' && lic.refundable === true` 时渲染「申请退款」按钮；0 元订单完全隐藏退款入口。
  - **API 服务端前置拦截**：`POST /api/v1/user/refund` 接口前置检查 `isLicenseRefundable` 及 Paddle 交易详情中的总金额，对 $0 订单直接返回 400 与友好提示 `REFUND_NOT_ALLOWED_ZERO_AMOUNT`，严禁向 Paddle 发起无效调整，避免产生无意义的系统异常日志与 Telegram 告警。
  - **存量过渡与按需自愈 (Lazy Cache & Self-Healing)**：历史存量订单在修复前 `paid_amount` 为 `NULL`，前端列表暂保留退款入口；当用户发起退款请求时，服务端通过实时查询 Paddle API 校验 `grand_total`，若判定为 0 元则即时更新写入 `paid_amount = 0` 缓存并拦截（400），实现存量数据的按需自愈。

---

