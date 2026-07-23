# IMPORTANT — Paddle API Key 与错误审计落库

> DRM 全量 Secret/vars 与其它 key 生成方式：[IMPORTANT_drm-secrets.md](./IMPORTANT_drm-secrets.md)。

---

## 1. `PADDLE_API_KEY` 在哪生成？

1. 登录 [Paddle](https://vendors.paddle.com/)（Sandbox 与 Live **各有独立**后台）  
2. **Developer tools** → **Authentication**（或 **API keys**）  
3. 创建 **Server-side API key**（Bearer token，形如 `pdl_...` / 沙箱常以 `pdl_sdbx_` 开头）  
4. 写入 Worker **Secret**（**不要**提交 git / 勿写进 `[vars]`）：

```bash
cd cloudflare/eqt-drm-api
npx wrangler secret put PADDLE_API_KEY
# 粘贴 key 后回车；secret 一般即时生效，改 toml vars 才必须 deploy
npx wrangler secret list   # 确认名称存在（看不到值）
```

**不要**与 **Webhook 签名密钥**（`PADDLE_WEBHOOK_SECRET` / Notification secret，形如 `pdl_ntfset_...`）混淆：

| 变量 | 落点 | 来源 | 用途 |
| :--- | :--- | :--- | :--- |
| `PADDLE_WEBHOOK_SECRET` | **Secret** | Developer tools → Notifications → endpoint **Secret key** | 校验 `Paddle-Signature`，**支付履约主路径** |
| `PADDLE_API_KEY` | **Secret** | Authentication → **API key** | 主动调 Paddle REST |

---

## 2. `PADDLE_API_KEY` 在本项目里干什么？

| 场景 | 是否依赖 API Key | 说明 |
| :--- | :---: | :--- |
| Webhook 验签 + 写 license | **否** | 只需 `PADDLE_WEBHOOK_SECRET` |
| Webhook 载荷缺邮箱时补拉 customer | **是** | `GET /customers/{id}` |
| 用户 Portal 自助退款 | **是** | `GET /transactions/...` + `POST /adjustments` |
| Admin 健康深探针 | **可选** | `GET /event-types`；失败 mode=`webhook_ok_api_key_invalid` 仍 **ok=true**（Webhook 在） |

**结论**：只做「Paddle 推 Webhook → 发码」可暂不配 API Key；要做 **Portal 退款** 或稳定补邮箱，必须配 **与 Webhook 同一环境（live/sandbox）** 的有效 key。

---

## 3. 错误审计：Paddle 何时写入 `system_error_logs`？

统一经 `logSystemError` → D1 → Admin「错误审计中心」/ Health `recent_events`（PADDLE_*）。

| category | level | 触发条件 |
| :--- | :--- | :--- |
| `PADDLE_WEBHOOK` | CRITICAL | 未配置 `PADDLE_WEBHOOK_SECRET` |
| `PADDLE_WEBHOOK` | WARN | 签名校验失败 |
| `PADDLE_WEBHOOK` | ERROR | Body 非 JSON；履约处理抛错（DB 等） |
| `PADDLE_API_ERROR` | WARN | Webhook 内拉 customer 失败 / 非 2xx |
| `PADDLE_API_ERROR` | ERROR | Portal 退款调 Paddle API 失败 |

**不会**写入：健康探针 API 403（仅返回 mode，避免探针刷爆审计表）。  
**成功履约**默认不落错误表（见债 D7：成功时间线后置）。

---

## 4. 探针 `webhook_ok_api_key_invalid`

含义：Webhook secret 已配；`PADDLE_API_KEY` 存在但 REST 返回 401/403。  
处理：换有效 key，或 `wrangler secret delete PADDLE_API_KEY`（仅 Webhook 模式）。

---

关联：[IMPORTANT_admin-config.md](./IMPORTANT_admin-config.md) · [api-contract.md](./api-contract.md)
