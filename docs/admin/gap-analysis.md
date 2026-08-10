# EQT 管理后台 — 缺口分析（历史快照）

> **状态：HISTORICAL / 已过时作为「现状」**  
> 基准时间：2026-07-23 阶段 0（Admin 架子有、契约未对齐时）  
> **当前真相源**：  
> - 进度与已关闭项 → [progress.md](./progress.md)  
> - 剩余债 → [IMPORTANT_admin-debt.md](./IMPORTANT_admin-debt.md)  
> - 配置 / 发布 → [IMPORTANT_admin-config.md](./IMPORTANT_admin-config.md) · [IMPORTANT_admin-release.md](./IMPORTANT_admin-release.md)  
> - API → [api-contract.md](./api-contract.md)

本文保留作 **「当初差什么」** 的对照，**不要按本文字段名或「未实现」列表改代码**。

---

## 1. 定位对照（仍成立）

| 维度 | 用户 Portal | 管理 Admin |
| :--- | :--- | :--- |
| 路径 | `cloudflare/eqt-website/portal.html` | `cloudflare/eqt-admin/` |
| 身份 | 购买邮箱 + 验证码会话 | `ADMIN_SECRET` / `X-Admin-Secret` |
| 能力 | 自己的授权、解绑、退款 | 全库检索、发码、吊销、审计、健康 |
| 受众 | 终端用户 | 运维 |

---

## 2. 阶段 0 时的成熟度（历史）

| 维度 | 当时评分 | 2026-07-23 修复后（约） |
| :--- | :---: | :---: |
| 设计总纲 | 80% | 85% |
| 后端路由存在性 | 60% | ~95% |
| 前端壳子 | 70% | ~90% |
| 端到端可用 | ~20% | ~90%（含生产实测） |
| 文档真实度 | 已在阶段 0 修正 | IMPORTANT_* + progress 为准；本文归档 |

---

## 3. 当时后端缺口 → 处置

| 问题（阶段 0） | 处置（现状） |
| :--- | :--- |
| `ORDER BY id` / 虚构 device 字段 | 已修：`created_at` + `activation_id` |
| 鉴权 fail-open | 已修：fail-closed 503/401 |
| CORS 无 DELETE | 已修 |
| 无 error-logs 过滤 | 已修 |
| 无 audit 表 | 已修 + UI |
| health 仅布尔 | 已修：`probes` 真探针 |
| 无限流 | 已修：进程内 429；边缘 WAF 仍可选 |

---

## 4. 当时前端缺口 → 处置

| 问题 | 处置 |
| :--- | :--- |
| 字段模型错误 | 已对齐契约 |
| alert/confirm | 已 modal + banner |
| 无操作审计页 | OpsAudit |
| Overview 无跳转 | onNavigate |
| 无 Pages / 防索引 | 已部署 + `_headers` |

---

## 5. 仍开放（勿在本文扩写细节）

见 **[IMPORTANT_admin-debt.md](./IMPORTANT_admin-debt.md)**（反馈中心、多管理员、边缘限流、`reqLang` 业务异常、toml 明文 secret 等）。

---

## 6. 历史小结（原文精神）

**架子与路由大体在，主链路曾因 schema 错位不可信；阶段 0 对齐真相源后已完成 P0–P2 与生产验证。**  
本文停止增量维护。
