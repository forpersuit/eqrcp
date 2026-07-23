# EQT 管理后台文档目录 (`docs/admin`)

运维管理后台：**`cloudflare/eqt-admin`**（SPA）+ **`eqt-drm-api`** 的 `/api/v1/admin/*`。

与用户 Portal（`eqt-website/portal.html`）**完全分离**：Portal = 购买邮箱用户；Admin = 持有 `ADMIN_SECRET` 的运维。用户 Portal 文档：[`docs/portal/`](../portal/README.md)。

**主线状态（2026-07-23）**：Admin **v1 可日常使用**（登录、KPI、错误审计、操作审计、发码/吊销/解绑、真探针健康、生产 `admin.eqt.net.im`）。后置项见 [IMPORTANT_admin-debt.md](./IMPORTANT_admin-debt.md)。

---

## 阅读顺序（新人 / 运维）

| 顺序 | 文档 | 说明 |
| :---: | :--- | :--- |
| 1 | **[IMPORTANT_admin-config.md](./IMPORTANT_admin-config.md)** | **必读**：运行要配哪些参数 |
| 2 | **[IMPORTANT_admin-release.md](./IMPORTANT_admin-release.md)** | **必读**：如何改代码、测、双部署 |
| 3 | **[IMPORTANT_admin-debt.md](./IMPORTANT_admin-debt.md)** | 已知债与解法优先级 |
| — | **[IMPORTANT_drm-secrets.md](./IMPORTANT_drm-secrets.md)** | **DRM 全量 Secret/vars**、key 从哪生成、R2 为何不是 secret |
| — | **[IMPORTANT_r2-distribution.md](./IMPORTANT_r2-distribution.md)** | R2 下载、禁止 GitHub 作源、zip/签名 |
| — | **[IMPORTANT_paddle-api-and-errors.md](./IMPORTANT_paddle-api-and-errors.md)** | API Key 生成/用途、Paddle 错误审计 |
| 4 | [api-contract.md](./api-contract.md) | API 字段 SSOT（改接口先改它） |
| 5 | [ops-guide.md](./ops-guide.md) | 密钥轮换、D1 应急 SQL |
| 6 | [progress.md](./progress.md) | 进度勾选与验证记录 |
| 7 | [admin-dashboard-design.md](./admin-dashboard-design.md) | 产品原则与模块设计 |
| 8 | [action-plan.md](./action-plan.md) | 历史分阶段计划（已大体完成） |
| 9 | [gap-analysis.md](./gap-analysis.md) | **历史快照**（阶段 0 缺口，非现状） |

支付/DRM 业务背景：[`docs/payment/`](../payment/README.md)。

---

## 文档角色（整理后）

### A. IMPORTANT（优先维护）

| 文档 | 用途 |
| :--- | :--- |
| [IMPORTANT_admin-config.md](./IMPORTANT_admin-config.md) | 配置参数、最小可运行、自检 |
| [IMPORTANT_admin-release.md](./IMPORTANT_admin-release.md) | 发布流水线、冒烟、DoD、禁止事项 |
| [IMPORTANT_admin-debt.md](./IMPORTANT_admin-debt.md) | 技术债与解决路径 |
| [IMPORTANT_drm-secrets.md](./IMPORTANT_drm-secrets.md) | eqt-drm-api Secret vs vars 全表 + 生成说明 |
| [IMPORTANT_r2-distribution.md](./IMPORTANT_r2-distribution.md) | R2 安装包分发、zip vs exe、无 GitHub 下载 |
| [IMPORTANT_paddle-api-and-errors.md](./IMPORTANT_paddle-api-and-errors.md) | Paddle API Key 与错误审计 category |

### B. 运行时 SSOT

| 文档 | 用途 |
| :--- | :--- |
| [api-contract.md](./api-contract.md) | 请求/响应契约 |
| [ops-guide.md](./ops-guide.md) | 生产运维与灾备 |
| `cloudflare/eqt-drm-api/schema.sql` | D1 表结构 |

### C. 进度与设计

| 文档 | 用途 |
| :--- | :--- |
| [progress.md](./progress.md) | 阶段勾选、验证记录、契约变更日志 |
| [admin-dashboard-design.md](./admin-dashboard-design.md) | 架构原则与模块 |
| [action-plan.md](./action-plan.md) | 分阶段计划（归档意味增强，状态见文首） |

### D. 历史 / 勿当现状

| 文档 | 说明 |
| :--- | :--- |
| [gap-analysis.md](./gap-analysis.md) | 2026-07-23 阶段 0 缺口快照；**实现后已过时**，仅供对照「修了什么」 |

截图（`chrome-*.png`）为验证附件，非规范文档。

---

## 工程落点

| 路径 | 角色 |
| :--- | :--- |
| `cloudflare/eqt-admin/` | Svelte 5 管理台 → `admin.eqt.net.im` |
| `cloudflare/eqt-drm-api/` | Worker + D1；全部 admin 路由 |
| `cloudflare/eqt-drm-api/schema.sql` | 表结构 SSOT |
| `cloudflare/eqt-drm-api/tests/e2e-admin-test.js` | Admin 契约 E2E（`npm run test:admin`） |

---

## 原则

1. **契约先于实现**：改 API 先改 `api-contract.md`。  
2. **配置与密钥不进前端 bundle**：仅 `VITE_API_BASE` 可公开。  
3. **git push ≠ 上线**：Worker + Pages 均需 deploy（见 IMPORTANT_admin-release）。  
4. **过时文档明确标注**：现状以 IMPORTANT_* + progress + api-contract 为准。  
