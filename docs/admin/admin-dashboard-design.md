# EQT 管理员后台管理系统与错误审计中心设计文档

## 1. 核心架构与设计原则

为了在保障极低运维成本的前提下提供高效、安全的授权管控与实时运维审计能力，EQT 管理员后台系统遵循以下第一性原理：

1. **绝对遮蔽与技术错误零暴露 (Zero Error Exposure)**  
   * 面向**普通用户**的接口绝对剥离 `D1_ERROR`、表名、堆栈等底层细节。  
   * 普通用户仅见多语言安全业务提示。  
   * **管理端**可展示完整技术日志（与用户侧相反）。

2. **D1 实时日志审计**  
   * 代码异常、SMTP / Paddle 等失败静默写入 D1 `system_error_logs`，供管理台消费。

3. **技术栈与生态复用**  
   * 前端：`cloudflare/eqt-admin/`（**Svelte 5 + Vite + TypeScript**，以该目录 `package.json` 为准）。  
   * 样式：**Vanilla CSS + Design Tokens（CSS 变量）**。  
   * 后端：复用 `cloudflare/eqt-drm-api` + D1。  
   * 托管目标：Cloudflare Pages（`admin.eqt.net.im`）。

业务背景与用户自助门户见 [`docs/payment/`](../payment/README.md)。  
**配置 / 发布 / 技术债（必读）**：[IMPORTANT_admin-config.md](./IMPORTANT_admin-config.md) · [IMPORTANT_admin-release.md](./IMPORTANT_admin-release.md) · [IMPORTANT_admin-debt.md](./IMPORTANT_admin-debt.md)。  
**API 契约**：[api-contract.md](./api-contract.md)。**进度**：[progress.md](./progress.md)。
---

## 2. 技术选型与架构规范

| 层级 | 选用技术 / 规范 | 说明 |
| :--- | :--- | :--- |
| 前端框架 | Svelte 5 + Vite + TypeScript | 与 Chat v2 同类；Runes 适合中后台状态 |
| CSS | Vanilla CSS + Design Tokens | 无 Tailwind 构建依赖 |
| 工程目录 | `cloudflare/eqt-admin/` | 与 `eqt-website`、`eqt-drm-api` 同级 |
| 文档 | `docs/admin/` | 计划、缺口、契约、进度 |
| 鉴权 | `X-Admin-Secret` + `sessionStorage` | 标签关闭即清；401 回登录 |
| 设备主键 | `activations.id`（`activation_id`） | 与用户 `/user/unbind-device` 对齐；**无** `device_fingerprint` 列 |

---

## 3. D1 表（管理相关）

完整 SSOT：`cloudflare/eqt-drm-api/schema.sql`。

### 3.1 `system_error_logs`

```sql
CREATE TABLE IF NOT EXISTS system_error_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL DEFAULT 'ERROR',
    category TEXT NOT NULL,
    error_message TEXT NOT NULL,
    context_json TEXT,
    created_at TEXT NOT NULL
);
```

### 3.2 授权与设备（摘要）

* `licenses`：主键 `license_code`（**无**数字 id）；含 tier/status/设备上限/到期/邮箱哈希/Paddle 字段。  
* `activations`：`id, license_code, uuid_hash, cpu_hash, disk_hash, device_id, activated_at`。  
* `unbind_records`：用户侧年解绑限额；Admin 解绑策略见 api-contract。

---

## 4. 四大业务模块

### 4.1 错误审计中心

* 倒序列表、`CRITICAL` 高亮、展开 `context_json`  
* 分类/关键词过滤（可先客户端，后服务端）  
* 清空历史日志（需 CORS 支持 DELETE 或 clear 别名）

### 4.2 授权码与订单管控

* 按 email / `license_code` / Paddle `transaction_id` 检索  
* 手动生成（展示并复制码；后续可补发邮件）  
* 吊销 → `status=revoked`  
* 按 `activation_id` 解绑或清空该码全部设备

### 4.3 发信与系统健康

* **已落地**：配置就绪徽章 + D1 KPI + SMTP TLS/AUTH 真探针 + Paddle/D1 探针 + `recent_events`（失败类时间线代理）  
* **后置**：Webhook 成功履约完整流水（见 IMPORTANT_admin-debt）

### 4.4 概览与反馈

* **已落地**：KPI（含 active/today/24h errors）+ 可点击快捷入口（含操作审计）  
* **后置**：反馈中心对接 `eqt-feedback-api`
---

## 5. 后端 Admin 路由

所有请求 Header：`X-Admin-Secret`。未授权 **401**。`ADMIN_SECRET` 未配置时 admin **不得放行**（阶段 1）。

| 动作 | 方法 & 路径 | 说明 |
| :--- | :--- | :--- |
| 日志查询 | `GET /api/v1/admin/error-logs` | 拉取审计日志 |
| 日志清理 | `DELETE /api/v1/admin/error-logs` | 清空（CORS 需含 DELETE） |
| 授权生成 | `POST /api/v1/admin/generate` | 别名 `/generate-license` |
| 授权检索 | `GET /api/v1/admin/licenses` | `created_at` 排序 + 真实 activations |
| 授权吊销 | `POST /api/v1/admin/revoke` | 别名 `/revoke-license` |
| 设备解绑 | `POST /api/v1/admin/unbind` | body：`license_code` + 可选 `activation_id` |
| 健康诊断 | `GET /api/v1/admin/health` | metrics + config + probes + recent_events |
| 操作审计 | `GET /api/v1/admin/audit-logs` | 高危写操作轨迹 |

**字段级请求/响应 JSON** 见 [api-contract.md](./api-contract.md)。  
**发布与配置** 见 IMPORTANT_admin-* 。
---

## 6. 与 Portal / 应急运维

| 方式 | 何时用 |
| :--- | :--- |
| 用户 Portal | 用户自助查码、解绑、退款 |
| Admin SPA | 日常运维目标态 |
| D1 Console / wrangler | Admin 未就绪或紧急手改（见 payment/paddle-payment.md §4） |
