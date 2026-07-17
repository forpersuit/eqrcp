# EQT 授权双重过期与轻量化授权管理设计方案 (Dual-Expiration & Lightweight License Management)

本文档阐述了 EQT 授权系统中关于“双重有效期”（兑换码截止兑换日 vs 兑换后授权使用时长）的设计实现，以及在无重型用户账户系统下如何解决用户授权丢失与退款销毁的技术优化路线。

---

## 1. 授权双重过期方案设计 (Dual-Expiration Scheme)

为了支持“生成一个兑换码，要求在指定截止日期前兑换，且兑换激活后用户能够获得固定时长（如 1 个月）的授权”这一消费模式，系统需要区分两个不同的时间轴：

1. **最晚兑换期限 (Redeem Expiration - `expires_at`)**：绝对时间戳。超过此日期，此激活码彻底失效，不可再在任何新设备上兑换激活。
2. **授权使用时长 (Activation Duration - `duration_days`)**：相对天数/月数。用户成功激活那一刻起算，离线数字证书（`.lic`）在本地的最大有效天数。

### 1.1 数据库结构升级 (D1 Schema Alteration)
我们在原有的 `licenses` 表中额外引入 `duration_days` 字段：

```sql
-- D1 数据库结构迁移脚本
ALTER TABLE licenses ADD COLUMN duration_days INTEGER DEFAULT NULL;
```

* `expires_at`: 仅存储绝对截止兑换时间（如 `2027-06-25T12:00:00Z`）。
* `duration_days`: 存储兑换激活后可使用天数（如 `30` 代表 1 个月，`365` 代表 1 年，`NULL` / `-1` 代表永久 LIFETIME 授权）。

### 1.2 激活兑换接口动态时效计算 (`src/index.ts` 升级逻辑)
当客户端发起激活请求时，Cloudflare Worker 按如下“第一性原理”重新校验并动态计算证书到期时间：

1. **兑换期限强校验**：
   ```typescript
   if (license.expires_at && license.expires_at !== "LIFETIME") {
     const redeemDeadline = new Date(license.expires_at);
     if (redeemDeadline.getTime() < Date.now()) {
       return new Response(JSON.stringify({ error: "Redeem code has expired and can no longer be activated." }), {
         status: 403,
         headers: { ...corsHeaders, "Content-Type": "application/json" }
       });
     }
   }
   ```
2. **动态到期时间计算**：
   如果该激活码关联了 `duration_days`：
   * **公式**：`finalExpiresAt = Date.now() + (duration_days * 86400 * 1000)`
   * **逻辑**：将该动态生成的绝对时间点写入 Ed25519 签名有效载荷中，颁发给客户端。客户端本地的验签流程与防系统时钟篡改保护将直接继承并执行此时间限制。
   * **旧版回退**：若 `duration_days` 为空，则回退为原有设计（直接继承 `expires_at` 绝对时间点作为最终过期时间，或直接设为 `LIFETIME`）。

---

## 2. 无重型账户系统下的轻量化授权管理优化 (Lightweight Management)

对于消费类软件，长远来看用户需要能自助查询自己的授权、在更换设备或旧设备损坏时手动“解绑”老设备。然而，设计一套包含密码、邮箱验证、个人面板的传统账户系统过重，且破坏了 EQT 极简、免注册的用户体验。

我们提出以下**无感且安全的轻量化管理方案**：

### 2.1 基于“购买邮箱 + 临时魔链 (Magic Link)”的半自助服务
在用户购买激活码（无论是通过发卡网还是 Stripe）时，购买记录关联用户的“购买邮箱 (Buyer Email)”：

1. **数据库关联**：在 `licenses` 表中保存 `buyer_email` 字段。
2. **设备自助解绑流程**：
   * 用户在官网帮助中心（`/support`）输入购买时填写的邮箱，点击“获取授权管理链接”。
   * Cloudflare Worker 在后台生成一个有效期 15 分钟的临时 Token 链接（Magic Link）发送到用户邮箱：`https://www.eqt.net.im/manage?token=MAGIC_TOKEN_HEX`。
   * 用户点击邮箱里的链接，无需注册密码直接以管理员身份进入临时控制台。
   * 在控制台中，用户可以：
     * 查阅该邮箱购买过的所有激活码；
     * 查看各个激活码目前绑定了哪些设备（展现设备操作系统与激活时间）；
     * **自助解绑 (Deactivate)**：对于已经损坏或废弃的老设备，用户点击“解绑”，系统清除 D1 数据库中对应的 `activations` 设备指纹记录，释放 `max_devices` 绑定额度，使用户可在新电脑上重新激活。

### 2.2 基于 Webhook 的自动退款销毁机制
为防范恶意购买后退款继续薅羊毛的行为，可通过第三方支付接口与 Worker 对接实现闭环管理：

* **自动化吊销**：当 Stripe / Gumroad 触发 `refund` 退款事件时，其 Webhook 会向 Worker 发起推送。
* Worker 解析参数，一键更改激活码状态：
  ```sql
  UPDATE licenses SET status = 'revoked' WHERE license_code = ?;
  ```
* 吊销后，由于设备端在每次启动或隔日轮询 `/status` 时都会校验证书有效性，Worker 在判定为 `revoked` 时会阻断验证，促使本地 `.lic` 彻底作废。
