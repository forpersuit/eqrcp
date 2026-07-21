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
2. **算法生成激活码**：生成格式为 `EQT-PLUS-YYYYMMDD-RANDOM-CHECK` 的序列号，其中 `CHECK` 位采用 Tier-Date-Random 拼接后的 MD5 前 4 位大写散列，与本地 Go 校验脚本完全对齐。
3. **入库 D1**：将生成的激活码、邮箱的 SHA-256 哈希值、买断/年付的天数及交易 ID 绑定写入 D1。同时前端 `pricing.html` 的暗色毛玻璃 Modal 经过每秒 1 次的轮询（`/api/v1/paddle/license-query`）成功捕获该激活码，并呈现在页面正中供用户一键复制。

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
为了防止恶意买家利用 14 天冷静期进行“购买 ➔ 激活 ➔ 退款 ➔ 再购买 ➔ 再退款”的循环白嫖，云端内置了自动化黑名单拦截模块：
1. **触发规则**：当任一**买家邮箱哈希**（`buyer_email_hash`）或**客户端设备物理指纹**（主板 UUID、CPU 序列号、系统盘序列号经 3选2 加权比对）在 D1 历史中累计匹配的**已退款/已吊销（`revoked`）许可证次数 $\ge 2$ 次**时，该邮箱/设备指纹将被云端永久列入风控黑名单。
2. **拦截关卡**：
   * **激活阶段（`/api/v1/activate`）**：当用户尝试在该设备上激活新的激活码时，Worker 会提前检测黑名单并立刻拦截，拒绝注册新绑定，返回 `403 Forbidden` 并吐出：
     `{"error":"This device is blacklisted due to multiple refund/revocation activities."}` 或
     `{"error":"This email address is blacklisted due to multiple refund/revocation activities."}`。
   * **对账阶段（`/api/v1/verify`）**：即使该设备使用某种手段绕过了激活，在每次离线对账时同样会做实时校验强行拦截阻断，确保证书无法被离线签名，降级为免费版。
3. **技术特性**：黑名单逻辑采用云端 D1 历史数据动态关联查询与内存判定，遵循与客户端完全一致的加权硬件指纹比对算法与空值防呆机制，**零数据库迁移负担**，微秒级高效闭环。

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
