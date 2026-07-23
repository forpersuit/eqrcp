# EQT 管理后台 — 缺口分析（Gap Analysis）

> 基准时间：2026-07-23  
> 对照源：`docs/admin-dashboard-design.md`、真实代码 `cloudflare/eqt-admin`、`cloudflare/eqt-drm-api`、`schema.sql`

本文描述**现状与目标的差**，不代替行动顺序（见 [action-plan.md](./action-plan.md)）。

---

## 1. 定位对照

| 维度 | 用户 Portal（已实现） | 管理 Admin（建设中） |
| :--- | :--- | :--- |
| 路径 | `cloudflare/eqt-website/portal.html` | `cloudflare/eqt-admin/` |
| 身份 | 购买邮箱 + 验证码会话 | `ADMIN_SECRET` / `X-Admin-Secret` |
| 能力 | 自己的授权、解绑、退款 | 全库检索、发码、吊销、审计、健康 |
| 受众 | 终端用户 | 运维 |

---

## 2. 总体成熟度（粗评）

| 维度 | 评分 | 说明 |
| :--- | :---: | :--- |
| 设计总纲 | 80% | 模块与原则清楚；细节契约原在外部 |
| 后端路由存在性 | 60% | 7 个 admin 路由已写；字段/CORS/鉴权有硬伤 |
| 前端壳子 | 70% | 登录 + 四 Tab 页面已有 |
| 端到端可用 | ~20% | schema 错位导致授权主链路不可靠 |
| 文档/进度真实度 | 已在阶段 0 修正 | 此前 progress 全标「推进中」已过时 |

---

## 3. 后端缺口

### 3.1 已存在的路由

| 方法 | 路径 | 代码状态 | 契约/实现问题 |
| :--- | :--- | :---: | :--- |
| GET | `/api/v1/admin/error-logs` | 有 | 仅 limit；无服务端过滤 |
| DELETE | `/api/v1/admin/error-logs` | 有 | CORS 未允许 DELETE |
| POST | `/api/v1/admin/generate` (+ alias) | 有 | 不绑 email、不发信 |
| GET | `/api/v1/admin/licenses` | 有 | **`ORDER BY id`**；activations 列名错误 |
| POST | `/api/v1/admin/revoke` (+ alias) | 有 | 不校验是否存在 |
| POST | `/api/v1/admin/unbind` | 有 | 使用不存在的 `device_fingerprint` |
| GET | `/api/v1/admin/health` | 有 | 仅 env 布尔，非真探针 |

### 3.2 与真实 D1 schema 的冲突（P0）

**`activations` 真实列**（`schema.sql` / activate 路径）：

```
id, license_code, uuid_hash, cpu_hash, disk_hash, device_id, activated_at
```

**错误实现使用了**：`device_fingerprint`、`device_name`（表中不存在）。

**`licenses` 主键**为 `license_code`，**无 auto-increment `id`**。  
Admin 列表使用 `ORDER BY id DESC` 会失败或行为未定义。

**用户侧正确解绑模型**：`activation_id`（`/api/v1/user/unbind-device`）。Admin 应对齐。

### 3.3 安全与 CORS

| 问题 | 风险 |
| :--- | :--- |
| `if (env.ADMIN_SECRET && secret !== ...)` | secret 未配置时 admin 全开 |
| `Allow-Methods: GET, POST, OPTIONS` | 浏览器 DELETE 预检失败 |
| `Allow-Origin: *` | 可接受（依赖 secret）；上线仍建议限制来源（可选） |
| Query `?secret=` | 易进日志；契约规定仅 Header |

### 3.4 其它

- `system_error_logs` 原仅 runtime 创建；阶段 0 起应写入 `schema.sql`  
- 业务路径是否全量 `logSystemError` 待阶段 3 扫  
- 无 admin 自动化测试  
- 无操作审计表（谁吊销了什么）

---

## 4. 前端缺口（`eqt-admin`）

| 模块 | 已有 | 缺口 |
| :--- | :--- | :--- |
| Login | Secret 探活 | 成功后整页 reload；失败体验可再收紧 |
| ErrorAudit | 列表/客户端过滤/详情/清空 | 依赖 DELETE+CORS；`alert`/`confirm` |
| Licenses | 搜索/生成/吊销/解绑 UI | 字段模型错误；生成后不展示码 |
| SystemHealth | 配置就绪徽章 | 无真探针、无 Webhook 时间线 |
| Overview | 3 KPI | 无跳转；无深化指标；无反馈 |
| 工程 | 可 build | 阶段 0 补 README / env；缺 Pages 配置 |

技术栈事实：`package.json` 为 **Svelte 5 + Vite 6**（以 lock 为准；设计文案勿写死未使用的 Vite 8）。

---

## 5. 文档层（阶段 0 前）

| 问题 | 处理 |
| :--- | :--- |
| progress 与代码脱节 | 重写为真实状态 |
| `docs/admin/1` 聊天 dump | 删除，内容收敛到本文与 action-plan |
| 无 JSON 契约 | 新增 api-contract.md |
| 路径仍出现 apps/admin-dashboard | 冻结为 `cloudflare/eqt-admin` |

---

## 6. 部署层

| 项 | 状态 |
| :--- | :--- |
| Cloudflare Pages | 未配置（阶段 4） |
| `admin.eqt.net.im` | 设计目标，未验证 |
| 生产 `VITE_API_BASE` | 代码默认 workers.dev；需环境覆盖 |
| 防索引 headers | 未做 |

---

## 7. 与 payment 文档的关系

- 业务语义（吊销 → 客户端 verify 403 → 擦 `.lic`）以 `docs/payment/drm-flow.md` 为准。  
- D1 Console / wrangler 手改（`paddle-payment.md` §4）在 Admin 可用前仍是**应急通道**，不是目标态。  
- 用户自助解绑限额逻辑在阶段 3 决定 Admin 是否复用 `unbind_records`。

---

## 8. 小结

**架子与路由大体在，主链路因 schema 错位不可信；文档曾落后于代码。**  
阶段 0 对齐真相源；阶段 1 只修 P0 契约与安全，再谈增强与上线。
