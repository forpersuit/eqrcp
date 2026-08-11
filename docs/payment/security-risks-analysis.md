# EQT 网页购买流程漏洞与风险分析 (Payment & Purchase Flow Risk Analysis)

> **文档版本**: v1.0.0  
> **更新时间**: 2026-07-21  
> **适用范围**: EQT 官网 (`pricing.html`)、收银台交互组件 (`checkout-verify.js`)、Cloudflare Worker DRM API (`index.ts`) 及 Paddle Billing 集成。

---

## 1. 概述 (Overview)

为了保障买家付款后能准确收到授权码，并防止恶意用户通过接口篡改、邮箱欺诈或重放攻击侵犯服务利益，EQT 设计了基于**结账前邮箱强验证 (Pre-Checkout Email Verification)** 及 **Paddle 官方收银台预填锁定** 的购买机制。

本文针对完整购买流程中的潜在漏洞、攻击面及对应防御方案进行全面系统化梳理。

---

## 2. 漏洞与风险分析 (Vulnerabilities & Risk Analysis)

### 2.1 【已修复】收银台邮箱二次篡改漏洞 (Checkout Email Tampering)

- **风险描述**：
  在原前端唤起 Paddle 收银台的实现中，虽然买家在 Modal 弹窗中完成了 6 位 OTP 验证码校验并获得了 `verifiedEmail`，但调用 `Paddle.Checkout.open({ customer: { email } })` 时未显式限制 `allowLogout` 参数（Paddle v2 默认 `allowLogout: true`）。
  攻击者可以在弹出的 Paddle 支付界面中点击“Change/更改邮箱”，将扣款与授权接收邮箱更改为任意未验证的邮箱（如 `attacker@example.com`）。

- **潜在危害**：
  1. 绕过邮箱所有权验证，借用他人验证码或凭据进行下单。
  2. 导致付款邮箱与系统记录/授权码发送邮箱不一致，引发用户无法收到激活码纠纷及退款防范漏洞。

- **防御方案**：
  在 `checkout-verify.js` 调用 `Paddle.Checkout.open` 时显式指定 `settings: { allowLogout: false }`：
  ```javascript
  Paddle.Checkout.open({
      items: [{ priceId: this.pendingPriceId, quantity: 1 }],
      customer: { email: this.verifiedEmail },
      customData: { buyer_email: this.verifiedEmail },
      settings: {
          allowLogout: false // 锁定收银台邮箱，隐藏/禁用更改邮箱操作
      }
  });
  ```

---

### 2.2 控制台直接唤起收银台绕过前端验证 (Client-side Direct Invocation)

- **风险描述**：
  由于 Paddle.js SDK 运行在买家浏览器前端，恶意用户可以直接通过浏览器开发者工具控制台执行 `Paddle.Checkout.open({ items: [...] })` 绕过 `checkout-verify.js` 的 6 位验证码 Modal 浮层。

- **影响与评估**：
  - **资金安全（无资损）**：商品的价格与账单由 Paddle 服务端配置决定，攻击者无法篡改价格或实现免费支付。
  - **业务可用性**：攻击者若填入错乱/无效邮箱，在支付成功后由于邮件无法投递，买家将无法通过邮箱收取授权码（但仍可通过网页浮层即时查验弹窗获取授权码）。
  - **防御建议**：在后端 Webhook 履约逻辑中，结合 `custom_data.buyer_email` 校验，并在将来版本可演进为基于 Backend 生成的加密 Checkout Session Token。

---

### 2.3 Webhook 签名伪造与重放攻击 (Webhook Fraud & Replay Attacks)

- **风险描述**：
  攻击者伪造 Paddle 支付成功回调请求（如 `transaction.completed`），尝试欺骗 EQT 后端 API 免费获取授权码。

- **防御方案**：
  在 Cloudflare Worker (`eqt-drm-api/src/index.ts`) 中实施了严格的第一性原理防护：
  1. **HMAC-SHA256 签名校验**：强校验请求头 `Paddle-Signature`，确保包体未被篡改。
  2. **时间戳防重放**：限制请求时间戳误差在 5 分钟以内。
  3. **D1 数据库幂等去重**：使用 `paddle_transaction_id` 进行数据库唯一定位，若该交易已被处理过，直接返回已生成的授权码，拒绝二次发货。

---

### 2.4 验证码接口爆破与 SMTP 资源滥用 (OTP Brute Force & Rate Limit)

- **风险描述**：
  恶意刷子频繁调用 `/api/v1/checkout/send-code` 接口消耗 SMTP 发信额度，或对 6 位数字验证码进行自动化暴力破解。

- **防御方案**：
  1. **前端冷却锁**：发送验证码后开启 60 秒倒计时冷却，按钮处于禁用状态。
  2. **后端时效与频率控制**：验证码 TTL 设为 10 分钟，同一邮箱短时间内重复请求受限制。
  3. **错误提示模糊化**：前端不透露过多内部错误堆栈，防止攻击者探测系统状态。

---

## 3. 安全架构汇总对比 (Security Matrix)

| 攻击面 / 风险点 | 防御机制 | 实施位置 | 当前状态 |
| :--- | :--- | :--- | :--- |
| 收银台邮箱篡改 | `settings: { allowLogout: false }` 锁定 | 前端 `checkout-verify.js` | **已修复** |
| 伪造支付回调 | `Paddle-Signature` HMAC-SHA256 验签 | 后端 `index.ts` | **已实施** |
| Webhook 重发/重复发货 | `paddle_transaction_id` 幂等性校验 | 后端 D1 数据库 | **已实施** |
| 买家邮箱未提取发信失败 | 多级降级提取 + Customer API 兜底拉取 | 后端 `index.ts` | **已实施** |
| 验证码爆破 | 60s 冷却限制 + OTP 10min 过期 | 前/后端 | **已实施** |

---

## 4. 相关文档索引

- [购买流程与 E2E 验证规范](purchase-flow.md)
- [Paddle 支付配置与上线指引](paddle-payment.md)
- [授权架构与密钥加密说明](licensing-architecture.md)
