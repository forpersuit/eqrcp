# EQT 管理后台文档目录 (`docs/admin`)

本目录跟踪 **运维管理后台**（`cloudflare/eqt-admin` + `eqt-drm-api` 的 `/api/v1/admin/*`）的设计对齐、缺口、API 契约与分阶段落地计划。

与用户自助门户（`cloudflare/eqt-website/portal.html`）**完全分离**：Portal 面向购买邮箱用户；Admin 面向持有 `ADMIN_SECRET` 的运维人员。

---

## 文档索引

| 文档 | 用途 |
| :--- | :--- |
| [action-plan.md](./action-plan.md) | **分阶段行动计划**（主入口：先做什么、验收标准是什么） |
| [gap-analysis.md](./gap-analysis.md) | 现状 vs 目标缺口（文档 / 后端 / 前端 / 部署） |
| [api-contract.md](./api-contract.md) | Admin API 请求/响应契约（对齐真实 D1 schema） |
| [progress.md](./progress.md) | 进度勾选表（以代码事实为准，随阶段更新） |
| [../admin-dashboard-design.md](../admin-dashboard-design.md) | 产品与架构设计总纲（原则、模块、技术栈） |

支付与授权业务背景见 [`docs/payment/`](../payment/README.md)。

---

## 工程落点

| 路径 | 角色 |
| :--- | :--- |
| `cloudflare/eqt-admin/` | Svelte 5 管理台前端（目标托管 `admin.eqt.net.im`） |
| `cloudflare/eqt-drm-api/` | Worker 后端 + D1；全部 admin 路由挂在此服务 |
| `cloudflare/eqt-drm-api/schema.sql` | D1 表结构 SSOT（含 `system_error_logs`） |

---

## 阅读顺序（新人 / 开工前）

1. `admin-dashboard-design.md` — 知道要做什么  
2. `gap-analysis.md` — 知道差在哪里  
3. `api-contract.md` — 知道字段与接口长什么样  
4. `action-plan.md` — 按阶段推进，不要跳步  
5. `progress.md` — 勾选完成项  

**原则**：慢而有序；先契约与 P0 可用性，再增强功能与部署。
