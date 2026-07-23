# EQT 管理员后台管理系统与错误审计中心设计文档 (Admin Dashboard Architecture & Error Audit Design)

## 1. 核心架构与设计原则

为了在保障极低运维成本的前提下提供高效、安全的授权管控与实时运维审计能力，EQT 管理员后台系统遵循以下第一性原理：

1. **绝对遮蔽与技术错误零暴露 (Zero Error Exposure)**：
   * 所有前端/客户端交互接口面向普通用户时，绝对剥离 `D1_ERROR`、`SQLITE_...`、数据库表名、代码变量、网络栈异常等任何底层技术细节。
   * 普通用户仅能看到经过多语言过滤的安全业务提示（例如：《验证码已失效，请重新发送》）。
2. **D1 实时日志审计 (Audit Log DB System)**：
   * 具体的代码报错、数据库约束冲突、SMTP 握手失败及 Paddle 履约异常等，全量静默持久化至 Cloudflare D1 的 `system_error_logs` 审计表中。
3. **技术栈与生态复用**：
   * 前端构建路径位于 `cloudflare/eqt-admin/`，使用 **Svelte 5 + Vite + TypeScript** 框架构建，与 EQT Web/Chat v2 组件化交互规范保持 100% 一致。
   * 样式技术选型采用 **Vanilla CSS + Modern Design Tokens (CSS 变量)**，保持与全站 UI 设计系统完全一致，零额外 CSS 依赖与编译开销。
   * 后端无缝复用 Cloudflare Workers (`eqt-drm-api`) 与 Cloudflare D1 存储，零额外服务器开销。部署托管于 Cloudflare Pages (`admin.eqt.net.im`)。

---

## 2. 技术选型与架构规范 (Tech Stack & Architecture)

| 层级 | 选用技术 / 规范 | 选型依据与原理 |
| :--- | :--- | :--- |
| **前端框架** | **Svelte 5 + Vite 8 + TypeScript** | 与 `pkg/chat/v2/web` 技术栈完全一致；Svelte 5 Runes (`$state`, `$derived`) 极佳的响应式表达力，轻量高效，适合中后台表格、模态框与状态管理。 |
| **CSS 样式选型** | **Vanilla CSS + Design Tokens (CSS 变量)** | 沿用项目标准的现代暗黑/浅色 Theme 变量系统，原生 CSS Scoped 隔离，打包无臃肿依赖，兼具高性能与设计精美度。 |
| **工程目录** | `cloudflare/eqt-admin/` | 与 `cloudflare/eqt-website`、`cloudflare/eqt-drm-api` 保持同级目录规范。 |
| **文档与进度** | `docs/admin/` | 详细实现规划、进度跟踪及运维指南存放在 `docs/admin/` 目录。 |
| **鉴权与 Session** | `X-Admin-Secret` + `sessionStorage` | 秘钥保存在浏览器 `sessionStorage`（标签页关闭即清空），所有 API 请求自动注入 `X-Admin-Secret` 头部；鉴权失败统一 401 重定向至 Login 页。 |

---

## 3. D1 数据库表结构设计 (`system_error_logs`)

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

## 4. Svelte 后台前端管理界面四大模块

管理员后台 SPA 主要包含四大核心板块：

### 4.1 错误审计中心 (Error Audit Center)
- **实时日志看板**：倒序分页列出 D1 `system_error_logs` 最新错误日志，高亮标出 `CRITICAL` 告警。
- **一键 JSON 堆栈展开**：点击日志行可展开查看具体的上下文信息（如 `context_json` 及完整错误堆栈）。
- **分类过滤与搜索**：支持按 `Category`（发信失败、D1 约束、Paddle 签名失败等）和关键词搜索。
- **日志清理**：支持管理员一键归档或清空指定范围的历史日志。

### 4.2 授权码与订单管控 (License & Order Management)
- **全库授权检索**：按 Email Hash、`license_code` 或 Paddle `transaction_id` 快速检索全量授权。
- **手动生成/补发**：管理员可在界面上一键为客户生成 `PLUS` 永久/年付授权码并自动/手动发信。
- **授权吊销 (Revoke)**：修改状态为 `revoked`，客户端下次 `/verify` 将收回授权并擦除本地 `.lic` 凭证。
- **设备指纹解绑**：查阅该授权绑定的设备列表，支持一键清空指纹或解绑特定设备。

### 4.3 发信引擎与系统健康 (System Health & Probes)
- **SMTP 健康检测**：测试与 `MAIL_SEND_SERVER` 的 465 端口 TLS 握手与发信探针状态。
- **Paddle 履约监控**：实时展示最新 Webhook 接收与回调对账记录，支持异常 Webhook 状态诊断。

### 4.4 反馈中心与系统概览 (Feedback & Overview)
- **全局 KPI 指标**：总授权数、今日激活数、近 24 小时错误统计及发信成功率。
- **用户反馈集成**：集成查看来自 `eqt-feedback-api` 的用户意见与 Telegram 消息列表。

---

## 5. 后端 API 路由安全与对齐规范

管理员 API 位于 `eqt-drm-api` 服务中，受 `ADMIN_SECRET` 严格安全隔离。所有路由统一采用 `/api/v1/admin/*`：

| 动作 | 方法 & 路径 | 说明 |
| :--- | :--- | :--- |
| **日志查询** | `GET /api/v1/admin/error-logs` | 分页拉取 `system_error_logs` 日志记录 |
| **日志清理** | `DELETE /api/v1/admin/error-logs` | 清空或删除历史审计日志 |
| **授权生成** | `POST /api/v1/admin/generate` | 管理员生成授权码（兼容 `/generate-license` 别名） |
| **授权检索** | `GET /api/v1/admin/licenses` | 按 email/code/transaction_id 查询全库授权 |
| **授权吊销** | `POST /api/v1/admin/revoke` | 吊销指定授权码（兼容 `/revoke-license` 别名） |
| **设备解绑** | `POST /api/v1/admin/unbind` | 管理员解绑指定授权下的设备指纹 |
| **健康诊断** | `GET /api/v1/admin/health` | 触发 SMTP 连通性测试及系统服务诊断 |

所有请求必须包含 Header `X-Admin-Secret: <ADMIN_SECRET>`。非管理员请求统一响应 `401 Unauthorized`。
