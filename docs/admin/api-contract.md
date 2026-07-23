# EQT Admin API 契约

> **SSOT**：实现与前端必须以本文为准。  
> Base URL：生产 `https://lic.eqt.net.im`；开发可用 Worker URL，由前端 `VITE_API_BASE` 指定。  
> 鉴权：所有 `/api/v1/admin/*` 必须带 Header  
> `X-Admin-Secret: <ADMIN_SECRET>`  
> **禁止**依赖 query `?secret=`（实现中若仍兼容，契约视为 deprecated）。

相关表结构见 `cloudflare/eqt-drm-api/schema.sql`。

---

## 0. 通用约定

### 0.1 鉴权

| 条件 | 响应 |
| :--- | :--- |
| `ADMIN_SECRET` 环境变量未配置 | **401** 或 **503**（阶段 1 起 fail-closed，推荐 503 + 明确 error） |
| Header 缺失或与 secret 不一致 | **401** `{ "error": "Unauthorized" }` |
| 通过 | 进入业务逻辑 |

### 0.2 响应形状

- 成功：HTTP 2xx，JSON 含业务字段；推荐带 `"success": true`。  
- 失败：HTTP 4xx/5xx，JSON 至少 `{ "error": string }`。  
- Admin 接口**可以**返回技术细节（与面向用户的 Zero Error Exposure 相反）。

### 0.3 CORS（浏览器管理台）

| Header | 要求 |
| :--- | :--- |
| `Access-Control-Allow-Origin` | 至少覆盖 admin 源；现状 `*` 可暂用 |
| `Access-Control-Allow-Headers` | 含 `Content-Type`, `X-Admin-Secret` |
| `Access-Control-Allow-Methods` | 至少 `GET, POST, DELETE, OPTIONS` |

---

## 1. 数据模型（管理端可见字段）

### 1.1 `licenses`（表内真实列）

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `license_code` | string | **主键** |
| `tier` | string | `PLUS` \| `PRO` |
| `status` | string | `active` \| `suspended` \| `revoked` |
| `max_devices` | number | 设备上限 |
| `expires_at` | string \| null | ISO 或 `LIFETIME` |
| `duration_days` | number \| null | 可选 |
| `buyer_email_hash` | string \| null | sha256(email.lower) |
| `buyer_email` | string \| null | 若库中有明文则返回 |
| `paddle_transaction_id` | string \| null | |
| `paddle_subscription_id` | string \| null | |
| `created_at` | string | ISO |

**注意：无稳定数字 `id` 字段。** 前端列表 key 使用 `license_code`。

### 1.2 `activations`（表内真实列）

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | number | **激活记录主键**；解绑使用此字段 |
| `license_code` | string | |
| `uuid_hash` | string \| null | |
| `cpu_hash` | string \| null | |
| `disk_hash` | string \| null | |
| `device_id` | string \| null | 客户端展示用设备 ID（若有） |
| `activated_at` | string | ISO |

**禁止**虚构：`device_fingerprint`、`device_name`。

管理端展示建议：

- 主标题：`device_id` 或 `Activation #id`  
- 副文：哈希前 8 位摘要（uuid/cpu/disk）

### 1.3 `system_error_logs`

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | number | |
| `level` | string | `ERROR` \| `WARN` \| `CRITICAL` |
| `category` | string | `SERVER_EXCEPTION` / `PADDLE_WEBHOOK` / `PADDLE_API_ERROR` / `SMTP_EMAIL_FAIL` 等 |
| `error_message` | string | |
| `context_json` | string \| null | JSON 文本 |
| `created_at` | string | ISO |

---

## 2. 接口明细

### 2.1 拉取错误日志

```
GET /api/v1/admin/error-logs?limit=50&offset=0&level=&category=&q=
```

| Query | 默认 | 说明 |
| :--- | :--- | :--- |
| `limit` | 50 | 最大 200 |
| `offset` | 0 | 分页偏移 |
| `level` | （空/ALL） | `ERROR` \| `WARN` \| `CRITICAL`；`ALL` 或空=不过滤 |
| `category` | （空/ALL） | 精确匹配；`ALL` 或空=不过滤 |
| `q` / `query` | （空） | 匹配 `error_message` / `context_json` LIKE |

**成功 200：**

```json
{
  "success": true,
  "logs": [
    {
      "id": 1,
      "level": "CRITICAL",
      "category": "SERVER_EXCEPTION",
      "error_message": "...",
      "context_json": "{\"url\":\"...\"}",
      "created_at": "2026-07-23T00:00:00.000Z"
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

---

### 2.2 清空错误日志

```
DELETE /api/v1/admin/error-logs
```

**成功 200：**

```json
{
  "success": true,
  "message": "System error logs cleared successfully"
}
```

阶段 1 必须保证 CORS 允许 DELETE。可选并行别名（非必须）：

```
POST /api/v1/admin/error-logs/clear
```

---

### 2.3 手动生成授权

```
POST /api/v1/admin/generate
POST /api/v1/admin/generate-license   // 别名
Content-Type: application/json
```

**Body：**

```json
{
  "tier": "PLUS",
  "max_devices": 2,
  "expires_in_days": null,
  "duration_days": null
}
```

| 字段 | 必填 | 说明 |
| :--- | :---: | :--- |
| `tier` | 是 | `PLUS` 或 `PRO` |
| `max_devices` | 否 | 默认 2 |
| `expires_in_days` | 否 | 有则算 `expires_at`；否则 `LIFETIME` |
| `duration_days` | 否 | 写入列；可与 expires 并存 |
| `buyer_email` | 否 | 绑定明文邮箱并写 `buyer_email_hash` |
| `send_email` | 否 | `true` 且已绑 email 时异步 SMTP 发信 |

**成功 200：**

```json
{
  "success": true,
  "license_code": "EQT-PLUS-20260723-AABBCCDDEEFF",
  "tier": "PLUS",
  "max_devices": 2,
  "expires_at": "LIFETIME",
  "duration_days": null,
  "buyer_email": "a@b.com",
  "email_sent": false,
  "status": "active"
}
```

前端**必须**展示并支持复制 `license_code`。

---

### 2.4 检索授权列表

```
GET /api/v1/admin/licenses?q=&limit=50&offset=0
```

| Query | 说明 |
| :--- | :--- |
| `q` / `query` | 可选。匹配 `license_code` LIKE、`buyer_email` LIKE、`paddle_transaction_id` LIKE；若含 `@` 则额外按 `sha256(lower(email))` 等值匹配 `buyer_email_hash` |
| `limit` | 默认 50 |
| `offset` | 默认 0 |

**排序（契约强制）**：`ORDER BY created_at DESC`（禁止 `ORDER BY id`）。

**成功 200：**

```json
{
  "success": true,
  "licenses": [
    {
      "license_code": "EQT-PLUS-...",
      "tier": "PLUS",
      "status": "active",
      "max_devices": 2,
      "expires_at": "LIFETIME",
      "duration_days": null,
      "buyer_email": "a@b.com",
      "buyer_email_hash": "...",
      "paddle_transaction_id": "txn_...",
      "paddle_subscription_id": null,
      "created_at": "2026-07-01T00:00:00.000Z",
      "active_devices_count": 1,
      "activations": [
        {
          "id": 42,
          "license_code": "EQT-PLUS-...",
          "uuid_hash": "...",
          "cpu_hash": "...",
          "disk_hash": "...",
          "device_id": "optional-display-id",
          "activated_at": "2026-07-02T00:00:00.000Z"
        }
      ]
    }
  ]
}
```

`active_devices_count` 为计算字段 = `activations.length`。

---

### 2.5 吊销授权

```
POST /api/v1/admin/revoke
POST /api/v1/admin/revoke-license
Content-Type: application/json
```

**Body：**

```json
{ "license_code": "EQT-PLUS-..." }
```

| 情况 | 响应 |
| :--- | :--- |
| 缺少 code | 400 |
| 不存在 | **404**（阶段 1 起强制） |
| 成功 | 200，status 置 `revoked` |

```json
{
  "success": true,
  "message": "License EQT-PLUS-... revoked successfully",
  "license_code": "EQT-PLUS-...",
  "status": "revoked"
}
```

业务效果：客户端下次 `/api/v1/verify` 应 403 并擦本地证书（见 payment/drm-flow）。

---

### 2.6 解绑设备

```
POST /api/v1/admin/unbind
Content-Type: application/json
```

**Body（契约目标，阶段 1 落地）：**

```json
{
  "license_code": "EQT-PLUS-...",
  "activation_id": 42
}
```

| 字段 | 说明 |
| :--- | :--- |
| `license_code` | 必填 |
| `activation_id` | 可选；**有则只删该行**；**无则清空该 license 下全部 activations** |

**成功 200：**

```json
{
  "success": true,
  "message": "Devices for license EQT-PLUS-... unbound successfully",
  "license_code": "EQT-PLUS-...",
  "unbound_activation_id": 42
}
```

`unbound_activation_id` 在清空全部时可省略或为 null。

**与用户侧差异（待阶段 3 决策，阶段 1 默认）：**

| 项 | 用户 `/user/unbind-device` | Admin `/admin/unbind`（阶段 1 默认） |
| :--- | :--- | :--- |
| 限额 | 写入 `unbind_records`，年限额 | **不计入**用户年限额（运维特权） |
| 邮件通知 | 可发安全通知 | 默认不发 |

若产品后来要求 Admin 也计入限额，改契约后再改实现。

**废弃（错误实现，阶段 1 删除）：**

```json
{ "device_fingerprint": "..." }
```

---

### 2.7 系统健康

```
GET /api/v1/admin/health
```

```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2026-07-23T00:00:00.000Z",
  "metrics": {
    "total_licenses": 10,
    "active_licenses": 8,
    "today_activations": 2,
    "total_error_logs": 3,
    "errors_24h": 1
  },
  "config": {
    "db_status": "ok",
    "db_connected": true,
    "smtp_configured": true,
    "paddle_configured": true,
    "paddle_webhook_configured": true,
    "r2_configured": false,
    "ed25519_key_configured": true,
    "admin_secret_configured": true
  },
  "probes": {
    "smtp": { "ok": true, "latency_ms": 180, "error": null, "skipped": false },
    "paddle": { "ok": true, "latency_ms": 1, "error": null, "mode": "webhook_secret_present" },
    "db": { "ok": true, "latency_ms": 2, "error": null, "mode": "select_1" }
  },
  "recent_events": [
    {
      "id": 12,
      "level": "WARN",
      "category": "SMTP_EMAIL_FAIL",
      "error_message": "...",
      "created_at": "2026-07-23T00:00:00.000Z"
    }
  ]
}
```

**必填 config 键**：`db_status`, `smtp_configured`, `paddle_configured`, `r2_configured`。  
**必填 probes 键**：`smtp`, `paddle`, `db`（各含 `ok` / `latency_ms` / `error`）。  

| 探针 | 行为 |
| :--- | :--- |
| `smtp` | TLS 连接 + EHLO + AUTH LOGIN + QUIT（不发信）；超时约 4s；env 不全则 `skipped: true` |
| `paddle` | 有 webhook secret 即配置级 ok；若有 `PADDLE_API_KEY` 则 GET Paddle API。mode 示例：`webhook_secret_present` / `api_reachable` / `webhook_ok_api_key_invalid`（key 403 但仍算 ok） |
| `db` | `SELECT 1` |

`recent_events`：`system_error_logs` 中 PADDLE_* / SMTP_* 最近 15 条（故障时间线代理，非完整 Webhook 成功履约流水）。

**Paddle 写库约定**（`logSystemError`，见 [IMPORTANT_paddle-api-and-errors.md](./IMPORTANT_paddle-api-and-errors.md)）：

| category | 典型触发 |
| :--- | :--- |
| `PADDLE_WEBHOOK` | 缺 secret / 签名失败 / JSON 非法 / 履约处理异常 |
| `PADDLE_API_ERROR` | Webhook 补邮箱 API 失败；Portal 退款 API 失败 |

健康探针调 Paddle API 的 401/403 **不写**错误审计（仅 probes.mode）。

### 2.8 操作审计日志

```
GET /api/v1/admin/audit-logs?limit=50&offset=0&action=&q=
```

高危写操作（GENERATE / REVOKE / UNBIND / CLEAR_LOGS）自动写入 `admin_audit_logs`。  
成功 200：`{ success, logs[], total, limit, offset }`。  
管理台前端 Tab「操作审计轨迹」只读消费本接口。

**`details_json` 约定（按 action）** — 便于取证；历史旧行可能字段较少。

| action | target_type | target_id | details_json 要点 |
| :--- | :--- | :--- | :--- |
| `GENERATE` | `LICENSE` | license_code | `license_code`, `tier`, `max_devices`, `expires_at`, `duration_days`, `expires_in_days`, `buyer_email`, `send_email_requested`, `email_sent`, `status`, `source=admin_manual` |
| `REVOKE` | `LICENSE` | license_code | `previous_status`, `new_status=revoked`, `tier`, `max_devices`, `expires_at`, `buyer_email`, `paddle_*`, `active_devices_count`, `activations_snapshot[]`（解绑前指纹快照）, `activations_deleted=false` |
| `UNBIND` | `ACTIVATION` 或 `LICENSE` | activation_id 或 license_code | `mode=single\|clear_all`, `license_code`, `activation_id`, `unbound_count`, `activation_ids[]`, `device_snapshot` / `devices_snapshot[]`（含 device_id 与各 hash、activated_at）, **`counts_toward_user_quota=false`** |
| `CLEAR_LOGS` | `SYSTEM` | null | `cleared_error_log_count`, note（只清 `system_error_logs`，保留操作审计） |

Admin 解绑 **不写** `unbind_records`，故不占用用户 365 天 4 次配额。

### 0.4 鉴权失败限流

同一客户端 IP（`cf-connecting-ip` 或 `X-Forwarded-For`）在约 5 分钟窗口内，**携带了错误的** `X-Admin-Secret` ≥ 10 次 → **429**  
`{ "error": "...", "code": "ADMIN_AUTH_RATE_LIMITED" }`，`Retry-After: 300`。  
缺 Header 的 401 **不计次**（避免登录探活误伤）。成功鉴权后清除该 IP 计数。此为 Worker 进程内限流，非全局 Cloudflare 边缘规则。

---

## 3. 前端 `adminFetch` 约定

- Base：`import.meta.env.VITE_API_BASE`  
- 自动附加 `X-Admin-Secret`  
- 401 → 清 sessionStorage 并回登录  
- 非 2xx 或 `data.error` → throw Error(message)

---

## 4. 版本与变更规则

1. 破坏性字段变更必须先改本文，再改 Worker，再改 `eqt-admin`。  
2. 别名路径可长期保留，主文档只宣传短路径。  
3. 每次契约变更在 [progress.md](./progress.md) 记一行日期与摘要。
