# 许可证自助门户、退款与生命周期管理参考规范

本参考文档收录 EQT 用户自助门户 (portal.html)、无密码发信、Adjustments API 退款细节、365 天滚轮解绑额度、来源渠道与环境解耦、沙箱 Beta 白名单及前后端契约规范。

---

## 6. 许可证查询与退款自服务门户 (License Portal & Self-service Refund)

> **文档 SSOT**：[`docs/portal/`](../../docs/portal/README.md)（overview / api-contract / progress）。

在 `cloudflare/eqt-website/portal.html` 及 `eqt-drm-api` 后端提供许可证管理与自助退款自服务门户：
- **无密码登录**：D1 表 `verification_codes`（发信验证码）与 `user_sessions`（24 小时过期 Session Token）。
- **前置发码校验**：Portal 发码 `POST /api/v1/auth/send-code` 校验 `licenses` 表是否有购买记录（无记录拦截并返回 `no_purchase_history`）。Pricing 发码 `POST /api/v1/checkout/send-code` 为购前验证，不校验购买记录。
- **解绑与退款归属权校验**：`POST /user/unbind-device` 与 `POST /user/refund` 必须校验 session 邮箱对该 license 的所有权（`buyer_email_hash` 或 `buyer_email`），失败报 403 `not_license_owner`。
- **Workers 内置 SMTPS 发信**：利用 Workers `connect` API 通过 465 端口（Implicit TLS）直接与外部 SMTP 服务器建立 safe TCP 连接发送握手与邮件包。
- **Paddle Adjustments API 退款细节**：
  - 检测 `PADDLE_API_KEY` 前缀（`pdl_sdbx_`）自动路由至沙箱 `sandbox-api.paddle.com` 或生产 API `api.paddle.com`。
  - 创建退款（`POST /adjustments`）时，`items` 数组的 `item_id`（`txnitm_...` 格式）必须从 `GET /transactions/{id}` 的 `data.details.line_items` 数组里读取。
  - 合成/测试单号（`txn_test_*` 等）走本地吊销路径返回 `refund_test_local_success`；真实单号（`txn_01...`）才调用 Paddle。
- **反滥用规则**：滚动 365 天内已激活过的 purchase 退款/拒付 ≥3 次拦截。未激活退款不计次。
- **激活邮箱传输**：在 D1 的 `licenses` 表中追加 `buyer_email` 并在客户端激活时写入本地 `license.lic`。客户端 Ed25519 离线验签 payload 保持原有 7 字段拼接模式（不包含 `buyer_email`），保证向后兼容。

---


---

## 7. 全生命周期邮件提醒通知设计

- **发信时机**：
  1. **付款成功**：Webhook `transaction.completed` 触发，发送激活码及客户端激活指引。
  2. **新设备激活**：`/api/v1/activate` 确认 `!isAlreadyActivated` 后触发，发送包含脱敏设备指纹的防盗刷提醒。
  3. **退款吊销**：`/api/v1/user/refund` 或 Webhook 退款/注销触发，发送失效警示邮件。
- **Serverless 异步规范**：所有邮件发送均包裹在 Workers `ctx.waitUntil(...)` 中异步执行，不得阻塞 HTTP 主线程。

---


---

## 8. 设备解绑额度与 7 语言邮件国际化

- **365 天滚轮解绑额度 (Rolling Unbind Limit)**：每张授权码过去 365 天内最多允许解绑设备 4 次 (`MAX_YEARLY_UNBINDS = 4`)。解绑记录持久化在 D1 `unbind_records` 表，满 365 天后额度自动恢复。
- **设备恢复机制**：解绑仅释放 1 台设备名额，重新在目标设备上输入授权码激活即可恢复。
- **7 语言邮件国际化**：所有系统邮件（验证码、结账、设备通知）支持 7 种语言 (`zh`, `en`, `ja`, `ko`, `es`, `de`, `fr`)，并自动对齐 Portal 界面语种。

---


---

## 9. 授权来源渠道 (Source) 与运行环境 (Environment) 解耦规范

- **环境与渠道正交分离 (Orthogonal Separation)**：
  - **`source`（来源渠道）**：表达激活码获取的商业途径，取值包括：
    - `purchase`（官网购买）：由 Paddle Webhook 履约创建或包含真实 Paddle 交易号（`txn_01...`，包含 Sandbox 沙箱测试购买与 Live 生产购买）。
    - `admin`（官方生成 / VIP 赠予）：由管理后台手动或客服接口生成。
    - `promo`（活动兑换）：带兑换窗口与天数的限时活动码。
    - `test`（测试夹具）：仅用于自动化测试夹具/合成测试单据（`txn_test_*`、`sub_test_*`）。
  - **`normalizeLicenseSource` 归一化**：服务端与 Portal 遇到 `txn_01...` 格式交易单号时，即使历史数据被写入过 `test`，也自动规整为 `purchase`，保证测试沙箱购买的激活码在用户中心与管理后台均正确显示为购买途径。
- **沙箱与生产真实订单 Refund / Cancel 策略（沙箱走沙箱，生产走生产）**：
  - **真实订单全真模拟**：只要交易号/订阅号符合 Paddle 真实格式（`txn_01...` / `sub_01...`），Portal 上的退款 (`/api/v1/user/refund`) 与取消订阅 (`/api/v1/user/cancel-subscription`) **必须打向对应的真实 Paddle API**（沙箱环境使用 `sandbox-api.paddle.com` 创建 Adjustment 或取消订阅，生产环境使用 `api.paddle.com`）。
  - **严禁对沙箱真实订单执行本地假吊销 (No Local Revoke Bypass for Sandbox Txns)**：确保沙箱环境能够 100% 模拟生产全链路，并由 Paddle 沙箱正常触发 `adjustment.updated` / `subscription.canceled` 等 Webhook 事件实现闭环。
  - **合成夹具专用通道**：本地 `local_only` 瞬时吊销通道仅保留给离线自动化单测的合成 ID（`txn_test_*`、`sub_test_*`），与真实业务解耦。
- **Portal 测试环境自适应标识**：
  - 页面通过 `window.EQT_IS_TEST`（`js/api-base.js` 解析）判断测试环境。
  - 当为测试环境时，Header Logo 旁动态渲染高亮 `TEST` 徽章，页面主区域顶部展示测试环境提示横幅，支持 7 种语言实时国际化切换。

### 9.1 沙箱 Beta 测试白名单约束 (Sandbox Beta Tester Whitelist Constraint)

> **文档 SSOT**：[`docs/test/sandbox-beta-license.md`](../../docs/test/sandbox-beta-license.md)。

测试版激活的防外泄机制：白名单实时查询替代静态 `bound_device_id`，约束叠加在 source/environment 之上。
- **触发判定 `needsSandboxConstraint(source, env, url)`**：`source === 'test'`（测试夹具码）**或** `isTestEnvironment(env, url)`（测试 Worker，覆盖 Paddle sandbox 购买码）→ 任一命中即受约束。即测试码在所有环境受约束、所有码在测试环境受约束。
- **白名单表 `sandbox_beta_testers`**：`(device_id, email, notes, status DEFAULT 'active', created_at)`。`email` 唯一索引 + `device_id` 非唯一普通索引（一个 device 可挂多个 email）。支持在更新已有邮箱时自动 UPSERT 更新绑定的 `device_id` 与备注。
- **实时校验 `assertSandboxTesterAllowed`**：`SELECT * FROM sandbox_beta_testers WHERE LOWER(email)=? AND status='active'` → 记录存在且有 `device_id` 且与**服务端权威 `device_id`**（`registerOrRefreshDevice` 返回值，绝不信任客户端自报）一致才放行，否则 403。白名单校验放在 `!isAlreadyActivated` 分支**外层**——删除登记即阻断已激活设备的再激活与 verify，实现「删设备即失效」。
- **统一标准生命周期管理**：测试激活码遵循标准的 `expires_at` / `duration_days` 生命周期，管理后台可按需发放测试时长（默认 30 天），并通过删除白名单或一键吊销实现实时强行收回权限。
- **Admin 发码顺序「先登记后发码」**：`mint-test-license` 必须先行校验 `sandbox_beta_testers` 存在对应 `(device_id, LOWER(email), status='active')` 记录，否则 400。
- **测试入口**：`npm run test:sandbox:offline`（esbuild 三文件 + `node --experimental-sqlite`），测试组覆盖白名单校验、删白名单阻断激活/verify、仅 email 无 device 不可激活、Paddle 测试购买受白名单约束等。
- **写 helper 时的坑**：`corsHeaders`、`net` 是 handler 局部作用域而非模块级——新 helper 若要用 CORS 头或 `activationClientMeta(request)`，须显式作为参数传入并在两处调用点传值。

---


---

## 10. 官网与客户门户前后端契约规范 (Website & Portal Contract Guidelines)

- **结构化错误码解耦 (Structured Error Codes)**：
  - **401 Unauthorized / Session Expired**：后端在用户端与管理端 401 响应中必须附带 `error_code: "UNAUTHORIZED"` 或 `error_code: "SESSION_EXPIRED"`（管理端 Cloudflare Access 鉴权响应附带 `error_code: "ACCESS_JWT_REQUIRED"` / `"ACCESS_JWT_INVALID"`）。前端必须优先依据 `res.status === 401` 或 `data.error_code` 进行会话失效拦截和清理登出，严禁依赖多语言错误文案（如 `includes("Session")`）进行业务分支判定。
  - **429 Rate Limiting**：后端 429 响应统一携带 `error_code: "RATE_LIMITED"` 或 `error_code: "TOO_MANY_ATTEMPTS"`。前端依据状态码或错误码启动冷却倒计时，防止字符串多语言不匹配导致冷却定时器异常复位。
- **XSS 纵深防御 (`escapeHtml`)**：
  - 静态页面中通过模板字符串向 `innerHTML` 插入由后端返回的动态字段（如 `license_code`, `device_id`, `paddle_transaction_id`, `paddle_subscription_id`, `revoke_reason` 等）前，必须经由 `escapeHtml()` 函数进行字符实体转义，防止潜在的 DOM 级 XSS。
- **结账与操作防重入单飞锁 (Single-Flight Mutex)**：
  - 在发起异步结账（如 `verifyAndPay`）、退款、取消订阅等不可逆外部交互时，前端组件必须维护 `isVerifying` 或 `inFlight` 互斥锁，并在入口处主动清除防抖计时器，避免并发双击引发多次结账或重复请求。
- **全站语言偏好存储规范 (SSOT Language Key)**：
  - 全站静态页面统一使用 `eqt-lang` 作为 `localStorage` 与 Cookie 的标准键名，读取时向下兼容历史键名 `eqt_lang` 与 `eqt-page-lang`。

---

