# EQT Customer Portal — 功能与效果总览

> 代码事实 SSOT：`cloudflare/eqt-website/portal.html`、`eqt-drm-api/src/routes/{auth,portal}.ts`  
> 契约：[`api-contract.md`](./api-contract.md) · 进度：[`progress.md`](./progress.md)

最后更新：2026-07-24

---

## 1. 产品定位与用户旅程

### 定位

**已购用户的自助 License 管理门户**。不负责下单（`pricing` + `/checkout/*`）、不负责运维发码（Admin）、不负责客户端激活（`POST /api/v1/activate`）。

### 典型旅程

```
官网首页 / 桌面端 About「管理授权」
        │
        ▼
  portal.html（?email= 可预填）
        │
        ▼
  输入购买邮箱 → POST /api/v1/auth/send-code
  （无购买记录则拒绝，不发码）
        │
        ▼
  邮件 6 位码 → POST /api/v1/auth/verify-code → session_token（24h）
        │
        ▼
  Dashboard：GET /api/v1/user/licenses
  ├── 查看授权码 / tier / 状态 / 交易号
  ├── 复制授权码
  ├── 查看绑定设备 + Unbind（年 4 次滚动限额）
  └── Request Refund → Paddle adjustment + 本地吊销
```

### 入口

| 入口 | 行为 |
| :--- | :--- |
| 官网导航 | `portal.html` |
| 桌面 About | `BrowserOpenURL('https://www.eqt.net.im/portal.html?email=...')` |
| 激活安全邮件 | 引导用户前往 Portal 解绑异常设备 |

---

## 2. UI 结构与视觉

单页、暗色 glass 主题（主色 `#39e5b6`，背景 `#080e0c`），Outfit + Material Symbols + Tailwind CDN。

| 区域 | DOM / 说明 |
| :--- | :--- |
| Header | Logo → `/`；7 语种下拉；返回主页 |
| Login 卡 | `#login-section`：邮箱、验证码、发码、登录 |
| Dashboard | `#dashboard-section`：账号、登出、许可证列表 |
| Toast | `#toast-container` 右上角，非 `alert` |
| 退款 Modal | `#confirm-modal` 红色确认 |
| 解绑 Modal | `#unbind-modal` 设备 Key、配额徽章、政策说明 |

前端状态：`lang / email / token / licenses / refundPendingCode / unbindPendingData / timer`。  
会话持久化：`localStorage` 的 `eqt_portal_token`、`eqt_portal_email`。

---

## 3. 用户可见功能

| 功能 | 行为 |
| :--- | :--- |
| 多语言 | en/zh/ja/ko/es/de/fr；与官网 `eqt_lang` / cookie `eqt-lang` 共享 |
| 发验证码 | 60s 冷却（前后端）；成功 toast；测试环境可回显 `code` |
| 登录 | 存 token，切 Dashboard，`loadLicenses` |
| 会话恢复 | 启动时有 token+email 直进 Dashboard |
| URL 预填 | `?email=`；与已存会话邮箱冲突则清会话 |
| 查授权 | 列表含 activations + 解绑配额 |
| 复制码 | clipboard + 短暂 done 图标 |
| 解绑 | 确认 Modal → `POST /user/unbind-device` → 刷新列表 |
| 退款 | 确认 Modal → `POST /user/refund` → 刷新列表 |
| 登出 | 清本地 + 可选服务端作废 session |

**未做**：改邮箱、取消订阅 UI、发票下载、设备昵称、分页搜索。

---

## 4. 解绑策略（产品规则）

1. **立刻释放** 1 个设备激活名额  
2. **恢复**：目标机打开 EQT，重新输入 license 码  
3. **配额**：任意连续 **365 天**最多 **4 次**（`MAX_YEARLY_UNBINDS`）；满 365 天后该次扣减自动恢复  
4. Admin 解绑**不计入**用户年 4 次配额  

---

## 5. 副作用矩阵

| 动作 | DB | 外部 | 邮件 | 客户端影响 |
| :--- | :--- | :--- | :--- | :--- |
| send-code | 写 `verification_codes` | SMTP | 登录验证码（5min） | 无 |
| verify-code | 删码；写 `user_sessions` | 无 | 无 | 无 |
| licenses | 只读 | 无 | 无 | 无 |
| unbind | 删 activation；写 `unbind_records` | 无 | 解绑通知（异步） | 下次 verify 失绑定 → 降级/需重激活 |
| refund | `status=revoked` | Paddle Adjustment 全额退 | **Portal 直发** 7 语吊销邮件 + Webhook 侧可能再发 | 对账后付费失效 |
| logout | 删 `user_sessions`（若调用 logout API） | 无 | 无 | 仅浏览器 |

---

## 6. 与产品其它部分关系

```
pricing/checkout ──Paddle──► webhook 写 licenses
                                │
portal 邮箱登录 ──────────────► 查 / 解绑 / 退款
                                │
Desktop About 管理授权 ──► portal?email=...
Desktop DRM activate/verify ◄── activations / status
Admin ─────────────────────► 同库运维
```

- 状态 SSOT：客户端以云端 `/verify` 与本地 `.lic` 对账；Portal 解绑/退款后需联网才能降级。  
- 退款后 D1 状态统一为 **`revoked`**（不单独写 `refunded`）；UI 展示 `status_revoked`。

---

## 7. i18n

| 层 | 机制 |
| :--- | :--- |
| 前端 | `portal.html` 内嵌 `translations`；`data-i18n` / placeholder |
| 后端 API | `API_I18N` + `getApiTranslation` |
| 邮件 | `AUTH_CODE_EMAIL_I18N`、`DEVICE_NOTIFICATION_I18N` 等 |

语言探测：`localStorage` → cookie → `navigator.language` → `en`。

---

## 8. 安全原则（修复目标）

1. **Ownership**：所有改写类 user API 必须校验 session 邮箱对该 license 的所有权（`buyer_email_hash` 或 `buyer_email`）。  
2. **发码限流**：portal send-code 与 checkout 对齐 60s 冷却。  
3. **校验限流**：portal/checkout verify-code 15 分钟 8 次失败 → 429。  
4. **验证码隔离**：`portal:{email}` 与 `checkout:{email}` 分键存储，互不覆盖。  
5. **购买门槛**：未购买邮箱不得发登录码。  
6. **Fail closed**：无归属信息的 license 不允许 Portal 用户侧解绑/退款（走 Admin）；解绑仅 `status=active`。
