# Portal API 契约

> Base（生产）：`https://lic.eqt.net.im`  
> 本地 dev：`http://localhost:8787`（`portal.html` 按 hostname 自动切换）  
> 鉴权：`Authorization: Bearer <session_token>`（user 路由）

最后更新：2026-07-24

---

## Auth

### `POST /api/v1/auth/send-code`

登录发码（**要求购买记录**）。

**Body**

```json
{ "email": "buyer@example.com", "lang": "zh" }
```

**逻辑**

1. `email` trim + lower  
2. `SHA-256(email)` 与 `licenses.buyer_email_hash` / `buyer_email` 查购买记录  
3. 无记录 → **400** `no_purchase_history`（i18n）  
4. 60s 内重复发码 → **429** `rate_limited`（i18n）  
5. 6 位码，**5 分钟**有效；写 `verification_codes`（含 `created_at`）  
6. SMTP 发 `AUTH_CODE_EMAIL_I18N`  

**200**

```json
{ "success": true, "message": "...", "code": "123456" }
```

`code` 仅在配置了 `TEST_MAIL_RECEIVER` 时返回（调试）。

---

### `POST /api/v1/auth/verify-code`

**Body**

```json
{ "email": "buyer@example.com", "code": "123456" }
```

**200**

```json
{
  "success": true,
  "session_token": "<32 hex chars>",
  "email": "buyer@example.com"
}
```

Session **24h**，表 `user_sessions`。

---

### `POST /api/v1/auth/logout`

作废当前会话。

**Headers**：`Authorization: Bearer <token>`（可选；无 token 也返回成功，幂等）

**200**

```json
{ "success": true }
```

删除 `user_sessions` 对应行。

---

## User（Portal）

### `GET /api/v1/user/licenses`

**200**

```json
{
  "success": true,
  "email": "buyer@example.com",
  "licenses": [
    {
      "license_code": "EQT-PLUS-...",
      "tier": "PLUS",
      "status": "active",
      "max_devices": 2,
      "created_at": "...",
      "paddle_transaction_id": "...",
      "paddle_subscription_id": null,
      "activations": [ { "id": 1, "uuid_hash": "...", "activated_at": "...", "device_id": "..." } ],
      "used_unbinds": 0,
      "remaining_unbinds": 4,
      "max_yearly_unbinds": 4
    }
  ]
}
```

按 `buyer_email_hash = SHA256(session.email)` 过滤。  
解绑配额：过去 365 天 `unbind_records` 计数，`MAX_YEARLY_UNBINDS = 4`。

---

### `POST /api/v1/user/unbind-device`

**Body**

```json
{
  "license_code": "EQT-PLUS-...",
  "activation_id": 12,
  "lang": "zh"
}
```

**校验顺序**

1. Session 有效  
2. 参数齐全  
3. License 存在  
4. **Ownership**：`buyer_email_hash == SHA256(session.email)` **或** `buyer_email == session.email`；否则 **403** `not_license_owner`  
5. 年解绑配额未满；否则 **403** `unbind_limit_reached`  
6. Activation 存在且属于该 license；否则 **404** `activation_not_found`  

**副作用**：`DELETE activations`；`INSERT unbind_records`；异步解绑邮件。

**200**

```json
{
  "success": true,
  "message": "...",
  "remaining_unbinds": 3
}
```

---

### `POST /api/v1/user/refund`

**Body**

```json
{ "license_code": "EQT-PLUS-...", "lang": "zh" }
```

**校验**

1. Session + ownership（同 unbind）  
2. `status !== 'revoked'`  
3. 存在 `paddle_transaction_id`  
4. 配置了 `PADDLE_API_KEY`  

**副作用**

1. Paddle `GET /transactions/{id}` → `POST /adjustments` full refund，`reason: requested_by_customer`  
2. 本地 `UPDATE licenses SET status = 'revoked'`  
3. Paddle 失败写 `system_error_logs`（`portal_refund`），**不**吊销本地  

**200**

```json
{
  "success": true,
  "message": "...",
  "adjustment": { }
}
```

---

## 状态字段约定

| D1 `licenses.status` | UI 文案 key | 含义 |
| :--- | :--- | :--- |
| `active` | `status_active` | 有效 |
| `revoked` | `status_revoked` | 已吊销（含自助退款、Webhook 退款、Admin 吊销） |
| `suspended` | （原样展示） | 保留 |

不单独持久化 `refunded`；避免客户端与 verify 路径分叉。

---

## 错误码速查

| HTTP | 典型 error key / 文案 | 场景 |
| :---: | :--- | :--- |
| 400 | `no_purchase_history` | 未购买邮箱发登录码 |
| 400 | invalid/expired code | 验证码错误或过期 |
| 401 | `unauthorized` / `session_expired` | 无/无效 Bearer |
| 403 | `not_license_owner` | 解绑/退款非本人 license |
| 403 | `unbind_limit_reached` | 年解绑 4 次用尽 |
| 404 | `license_not_found` / `activation_not_found` | 资源不存在 |
| 429 | `rate_limited` | 发码 60s 冷却 |
| 500 | Paddle / SMTP 失败 | 外部依赖 |

---

## 相关对比

| 流程 | 路径 | 购买校验 | 码有效期 | 限流 |
| :--- | :--- | :---: | :---: | :---: |
| Portal 登录 | `/auth/send-code` | 是 | 5 min | 60s |
| Checkout 结账 | `/checkout/send-code` | 否 | 10 min | 60s |
