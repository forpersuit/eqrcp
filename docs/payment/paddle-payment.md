# EQT Paddle 支付履约与授权撤销（Refund/Revoke）维护文档 (Paddle Payment & DRM Lifecycle Guide)

本文档归纳了 EQT 系统中对接 **Paddle Billing (v2)** 的支付流程、订单自动履约机制、退款与订阅取消的自动授权吊销（Revoke）逻辑，以及如何利用 Cloudflare 可视化后台开展日常运维和测试验证。

---

## 1. 计费方案与价格定义 (Pricing & Catalog Definitions)

在 Paddle Sandbox (沙箱) 与 Production (生产环境) 中，EQT 配置了以下两档主要的付费产品套餐，其对应的客户端配置与价格 ID 关系如下：

| 产品版本 | 标价 | 周期 | Paddle Price ID (Sandbox) | 对应 License 规格 |
| :--- | :--- | :--- | :--- | :--- |
| **终身 Plus 版 (Lifetime)** | `$29.99` | 一次性买断 | `pri_01kxymyma34hgmndccwswheta3` | 级别为 `PLUS`，永不过期 (`LIFETIME`) |
| **年付 Plus 版 (Yearly)** | `$11.99` | 按年续费 | `pri_01kxymxqngex49tg65wb0701pc` | 级别为 `PLUS`，有效期 `365` 天 |

> [!IMPORTANT]
> 在从 Sandbox 环境迁移到 Production (生产) 环境时，必须在 [pricing.html](file:///home/yelon/develop/me/eqrcp/cloudflare/eqt-website/pricing.html) 最底部的 `initPaddle()` 配置常量中：
> 1. 将 `PADDLE_ENV` 的值从 `"sandbox"` 修改为 `"production"`；
> 2. 将 `PADDLE_TOKEN` 替换为以 `live_` 开头的生产环境客户端 Token；
> 3. 将两个价格 ID 分别替换为 Paddle 线上生产后台所对应的 Live Price IDs。

---

## 2. 核心云端 Webhook 设计 (Cloudflare Worker DRM Backend)

云端计费与对账逻辑全部由 Cloudflare Worker (`eqt-drm-api`) 的 `/api/v1/paddle/webhook` (POST) 路由监听并承载。

### 2.1 数据库结构适配
D1 数据库对 `licenses` 表追加了以下两个字段以建立关系型对账关联：
* `paddle_transaction_id TEXT DEFAULT NULL`: 关联的 Paddle 交易 ID，防止同一交易被二次发码。
* `paddle_subscription_id TEXT DEFAULT NULL`: 关联的 Paddle 订阅 ID，用来应对年付订阅用户的周期性续费及退订状态转移。

### 2.2 自动订单履约 (`transaction.completed`)

当用户在前端收银台支付成功后，Paddle 瞬间向接口推送 `transaction.completed` 事件。Worker 进行以下处理：

1. **查重校验**：以 `transactionId` 在 `licenses` 表中查重，若已存在记录则直接幂等返回已存在的激活码，防止重复写库。  
2. **首购**：生成激活码 `EQT-PLUS-YYYYMMDD-RANDOM-CHECK`，写入 D1（年付绑定 `paddle_subscription_id`，`expires_at = now+365`）。  
3. **年付续费（同一订阅）**：**不轮换激活码**。若 `subscription_id` 已有 license：  
   - 延长 `expires_at`（`max(now, 原到期) + 365 天`）  
   - `status = active`，清空 `revoked_at` / `revoke_reason`（欠费恢复也走此路径）  
   - 将 `paddle_transaction_id` 更新为**本周期**交易（便于本周期退款对账）  
   - 发「续费成功 · 激活码不变」邮件  
4. 前端 `pricing.html` 轮询 `/api/v1/paddle/license-query` 展示首购激活码。

**产品模型（SSOT）**

| 角色 | 谁负责 |
| :--- | :--- |
| 自动扣费 / 账单 | **Paddle**（订阅） |
| 激活码 | **首购生成一次**，续费**不换码** |
| 权益状态 | 写在**同一** license：`status` + `expires_at` + `paddle_subscription_id` |
| 取消 / 欠费 | webhook → 该码 `revoked`（`revoke_reason=subscription`） |

---

## 3. 退款及订阅取消的处理方式 (Refund & Revoke Control)

### 3.1 退款吊销逻辑 (Refund Handling)
退款操作可以由您在 **Paddle Sandbox Dashboard** 的 **Transactions** 列表中找到对应订单，并手动点击 **“Refund”** (退款) 发起。
1. **Webhook 捕获**：Paddle 接收退款请求后，向 Worker 发送类型为 **`transaction.refunded`** 的事件。
2. **吊销 SQL 触发**：Worker 收到后，以交易 ID 在 D1 中检索，直接执行：
   ```sql
   UPDATE licenses SET status = 'revoked' WHERE paddle_transaction_id = ?;
   ```
3. **客户端强制降级**：
   在离线 DRM 体系中，被吊销的激活码在下一次客户端发起默默联网同步 `/api/v1/verify` 对账时，Worker 发现其 `status` 不再是 `'active'`，会立刻以 **`403 Forbidden`** 状态码拒绝激活，并返回：
   ```json
   {"error":"License is suspended or revoked"}
   ```
   客户端在捕获 403 后会强制擦除本地 `license.lic` 数字证书缓存，使产品重新降级为免费受限版，完成**退款吊销闭环**。

### 3.2 订阅取消/逾期处理 (Subscription Cancellations)
如果用户取消订阅（`subscription.canceled`），或者是订阅因扣款失败、逾期等产生状态变更（在 `subscription.updated` 事件中 `status` 变为 `past_due`、`paused` 或 `canceled`），Worker 会自动通过以下 SQL 撤销其对应的授权：
```sql
UPDATE licenses SET status = 'revoked' WHERE paddle_subscription_id = ?;
```

### 3.3 薅羊毛退款黑名单防御拦截 (Abusive Refund Blacklist)
为了防止恶意买家利用 14 天冷静期进行“购买 ➔ 激活 ➔ 退款 ➔ 再购买 ➔ 再退款”的循环白嫖，云端内置了自动化黑名单拦截模块（政策 SSOT：[`license-source-and-refund-policy.md`](./license-source-and-refund-policy.md)；对外披露：Terms + Refund Policy）：
1. **触发规则（滚动 365 天）**：当任一**买家邮箱哈希**（`buyer_email_hash`）或**客户端设备物理指纹**（3 选 2）在过去 **365 天**内，匹配到 **≥ 3 次**（>2）**已激活过**的 purchase 退款/拒付吊销时，拦截结账邮箱与后续激活。活动码/admin/test 吊销、**从未激活即退款** 不计入。
2. **拦截关卡**：
   * **激活阶段（`/api/v1/activate`）**：检测黑名单并 `403`，文案说明 rolling 365-day 限制。
   * **对账阶段（`/api/v1/verify`）**：既有吊销态仍会拒绝，确保本地证书无法续签。
3. **技术特性**：加权指纹空值防呆；与 `licenses.source` / `revoked_at` 字段联动。

---

## 4. 后台查看和管理界面 (D1 Console & Operations)

### 4.1 Cloudflare Dashboard 可视化管理后台 (推荐)
对于非开发人员和日常运维，推荐使用 Cloudflare 提供的**官方 D1 可视化后台管理界面**：
1. 登录您的 **Cloudflare 控制台**。
2. 点击左侧导航栏的 **Workers & Pages > D1**，在数据库列表中选择 **`eqt-drm-db`**。
3. 点击 **Console** 或者是 **Tables** 面板，点击 `licenses` 表。
4. **可视化操作**：您能在这里直接查看、检索、修改每一个授权的 `status` 状态（例如将其从 `active` 人为改成 `revoked` 以强行吊销某用户），或者直接添加、删除行，极大降低了维护门槛。

### 4.2 命令行工具运维 (CLI Maintenance)
您也可以在 `/cloudflare/eqt-drm-api` 路径下直接通过 `npx wrangler` 操作云端 D1 数据库：

* **查询最新三笔生成的激活码列表**：
  ```sh
  CLOUDFLARE_API_TOKEN="" npx wrangler d1 execute eqt-drm-db --remote --command="SELECT license_code, status, buyer_email_hash, paddle_transaction_id FROM licenses ORDER BY created_at DESC LIMIT 3;"
  ```
* **手动修改（撤销）特定交易的激活状态**：
  ```sh
  CLOUDFLARE_API_TOKEN="" npx wrangler d1 execute eqt-drm-db --remote --command="UPDATE licenses SET status = 'revoked' WHERE paddle_transaction_id = '您的交易ID';"
  ```

---

## 5. Webhook 签名避坑要点与诊断测试 (Troubleshooting & Verification)

### 5.1 🚨 Webhook Secret 401 报错陷阱
在 Paddle 控制台创建 Webhook 终点 `https://lic.eqt.net.im/api/v1/paddle/webhook` 时，会产生以下两个极易混淆的参数：
* **`ntfset_01kxyp...`**：这是该 Webhook 的 **Destination ID (目的地ID)**。
* **`pdl_ntfset_01kxyp...`**：这是该目的地的 **Webhook Secret (签名密钥)**，仅在创建时展示一次，或者需要点击 **“Regenerate secret”** 重新生成。

在配置云端 Worker 的 `PADDLE_WEBHOOK_SECRET` 变量时，**必须填写以 `pdl_ntfset_` 开头的真实签名密钥**，绝不能填目的地 ID。如果密钥配置错误，Worker 在验签时会报 `401 Unauthorized` 错误，导致 Webhook 投递日志的状态被标为 `failed`。

### 5.2 诊断脚本工具
为免受网络排队滞后干扰，我们在项目 `scratch/` 目录下部署了两个强大的调试脚本，可以使用您的沙箱 API 凭证强行和 Paddle 进行通信调试：

1. **`check_paddle_webhooks.py` (通知拉取与重放)**：
   * **查询最新通知队列**：直接获取沙箱后台最新的 Webhook 状态与投递历史。
     ```sh
     python3 /home/yelon/.gemini/antigravity-cli/brain/54396198-9bb7-4067-9424-f3d0c93587c8/scratch/check_paddle_webhooks.py
     ```
   * **强行触发通知重放**：如果通知投递状态为 `failed`，传入通知 ID 即可强行唤醒 Paddle 再次投递。
     ```sh
     python3 /home/yelon/.gemini/antigravity-cli/brain/54396198-9bb7-4067-9424-f3d0c93587c8/scratch/check_paddle_webhooks.py ntf_您的通知ID
     ```
2. **`read_mail.py` (邮件拉取)**：
   * 登录您的测试邮箱账户直接收取最近的 Paddle 收据，以确认外部网络对账通知：
     ```sh
     python3 /home/yelon/.gemini/antigravity-cli/brain/54396198-9bb7-4067-9424-f3d0c93587c8/scratch/read_mail.py
     ```

## 6. 结账主题色与默认支付链接 (Checkout Theme & Default Payment Link)

结账界面品牌色是 **账号级配置**（`primary_checkout_color`），不是网站代码改动；Paddle 收银台 overlay 默认套用该颜色，sandbox 与 live 各管各的。

| 环境 | 端点 | 鉴权 |
|---|---|---|
| Sandbox | `PATCH https://sandbox-api.paddle.com/settings/account` | Seller API key（`pdl_test_...`） |
| Live | `PATCH https://api.paddle.com/settings/account` | Seller API key（`pdl_live_...`） |

- **局部更新**：PATCH 只改你传的字段，其余（default_checkout_url / tax mode / saved payment methods）不变；只改主题色只需发 `{"primary_checkout_color":"#39e5b6"}`。
- **默认支付链接是必需项**：不设置时 Checkout 直接打不开，报 "Something went wrong"。沙箱可填任意 URL（含 localhost）；live 需先通过域名审核。
- **执行脚本**：`scripts/paddle-set-checkout-theme.sh`（见脚本头注释）——一键对 sandbox + live 设主题色，可选带默认支付链接。
- **无代码替代**：Paddle Dashboard → Checkout → Checkout settings → Primary brand color，填产品主题色 `#39e5b6`。

---

## 7. 上线流程：网站域名审核 → 默认支付链接 (Website Approval → Default Payment Link)

live 账号的收银台在域名过审前**无法打开**：Paddle 要求**默认支付链接必须落在已审核通过的域名**上，顺序不能颠倒。

1. **提交网站审核**：Paddle Dashboard → Checkout → **Website approval** → Domain approval，提交 `www.eqt.net.im`（checkout 所在域名）。状态 `pending_review` → `approved`（自动化通常几分钟，官方注明 live 可能数天）。
2. **过审前自查**（Paddle 抓站核对，任一不满足会 `action_required` / `rejected`）：
   - 页面公开可达、不需登录；定价可见；存在 Terms / Privacy / Refund policy；条款声明 Paddle 为 Merchant of Record。
   - EQT 官网已全部满足：`www.eqt.net.im` 公开可达；`terms.html` 7 语种含 Paddle MoR 声明（见第 97–98 行）。
3. **过审后设默认支付链接**：live `default_checkout_url = https://www.eqt.net.im/pricing`（须为含 Paddle.js 的页面）。用 `scripts/paddle-set-checkout-theme.sh` 带 `EQT_CHECKOUT_URL` 一次完成；**主题色与域名无关，可提前**只设颜色（不带 `EQT_CHECKOUT_URL`）。
4. **环境切换**：`pricing.html` 经 `window.EQT_IS_TEST`（来自 `js/api-base.js`，按 hostname 判定）自动切生产；`www.eqt.net.im` 下已指向 live token 与 live 价格 ID，**无需改代码**。localhost / test 子域自动落 sandbox。
