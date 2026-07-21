# EQT 管理员后台管理系统与错误审计中心设计文档 (Admin Dashboard Architecture & Error Audit Design)

## 1. 核心架构与设计原则

为了在保障极低运维成本的前提下提供高效、安全的授权管控与实时运维审计能力，EQT 管理员后台系统遵循以下第一性原理：

1. **绝对遮蔽与技术错误零暴露 (Zero Error Exposure)**：
   * 所有前端/客户端交互接口面向普通用户时，绝对剥离 `D1_ERROR`、`SQLITE_...`、数据库表名、代码变量、网络栈异常等任何底层技术细节。
   * 普通用户仅能看到经过多语言过滤的安全业务提示（例如：《验证码已失效，请重新发送》）。
2. **D1 实时日志审计 (Audit Log DB System)**：
   * 具体的代码报错、数据库约束冲突、SMTP 握手失败及 Paddle 履约异常等，全量静默持久化至 Cloudflare D1 的 `system_error_logs` 审计表中。
3. **技术栈与生态复用**：
   * 前端使用 **Svelte** 框架构建，与 EQT GUI/Web 组件化交互规范保持 100% 一致。
   * 后端无缝复用 Cloudflare Workers (`eqt-drm-api`) 与 Cloudflare D1 存储，零额外服务器开销。

---

## 2. D1 数据库表结构设计 (`system_error_logs`)

在 Cloudflare D1 数据库中建立专用的审计日志表：

```sql
CREATE TABLE IF NOT EXISTS system_error_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL DEFAULT 'ERROR',       -- 'ERROR', 'WARN', 'CRITICAL'
    category TEXT NOT NULL,                    -- 'CHECKOUT_SEND_CODE', 'CHECKOUT_VERIFY', 'PADDLE_WEBHOOK', 'SMTP_CONNECT'
    error_message TEXT NOT NULL,               -- 完整底层堆栈及异常排查细节
    context_json TEXT,                         -- 附带请求上下文（如请求 URL、IP、操作 Email 等）
    created_at TEXT NOT NULL                   -- ISO 格式时间戳
);
```

---

## 3. Svelte 后台前端管理界面规划

管理员后台（路径 `apps/admin-dashboard` 或托管在 Cloudflare Pages `admin.eqt.net.im`）主要包含四大核心板块：

### 3.1 错误审计中心 (Error Audit Center)
- **实时日志看板**：以倒序分页列出 D1 中的最新错误日志，高亮标出 `CRITICAL` 告警。
- **一键 JSON 堆栈展开**：点击日志行可展开查看具体的上下文信息（如 `context_json`）。
- **分类过滤与搜索**：支持按 `Category`（发信失败、D1 约束、Paddle 签名失败等）和关键词过滤。
- **日志清理**：支持管理员一键归档或清空历史旧日志。

### 3.2 授权码与订单管控 (License & Order Management)
- **授权检索**：按 Email、`license_code` 或 Paddle `transaction_id` 快速检索。
- **手动生成/补发**：管理员可在界面上一键为客户生成 `PLUS` 永久/年付授权码并手动发信。
- **吊销与重置**：支持手动解绑设备指纹，或执行吊销（Revoke）操作。

### 3.3 发信引擎与 Webhook 监控 (System Health)
- **SMTP 健康检测**：测试与 `MAIL_SEND_SERVER` 的 465 端口 TLS 握手状态。
- **Paddle 履约监控**：实时展示最新 Webhook 接收与回调对账记录。

---

## 4. 后端 API 路由安全设计

管理员 API 位于 `eqt-drm-api` 服务中，受到 `ADMIN_SECRET` 安全隔离：

- `GET /api/v1/admin/error-logs`: 分页拉取 `system_error_logs` 日志记录。
- `POST /api/v1/admin/generate-license`: 管理员生成指定授权码。
- `POST /api/v1/admin/revoke-license`: 管理员吊销指定授权。

所有请求必须带上 `X-Admin-Secret` 头部或有效 Session，非管理员请求统一返回 401 Unauthorized，避免泄露内部接口。
