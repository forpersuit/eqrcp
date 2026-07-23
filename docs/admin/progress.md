# EQT 管理后台进度跟踪

> 以**代码与契约事实**为准更新。行动顺序见 [action-plan.md](./action-plan.md)。

最后更新：2026-07-23（管理后台全 4 阶段全量落地并完成生产准备与运维手册）

---

## 阶段勾选

### 阶段 0 — 对齐与预备

- [x] `docs/admin/README.md` 索引
- [x] `docs/admin/action-plan.md` 分阶段计划
- [x] `docs/admin/gap-analysis.md` 缺口分析
- [x] `docs/admin/api-contract.md` API 契约（真实 schema）
- [x] 刷新本 progress；删除非正式 `docs/admin/1`
- [x] `admin-dashboard-design.md` 与文档目录互链、版本/字段对齐
- [x] `schema.sql` 纳入 `system_error_logs`
- [x] `cloudflare/eqt-admin/README.md` + `.env.example`
- [x] `eqt-admin/src/lib/types.ts` 契约类型预备（页面改接在阶段 1）

### 阶段 1 — P0 契约修复

- [x] 后端：`ADMIN_SECRET` fail-closed（`requireAdminAuth` → 503/401）
- [x] 后端：CORS 允许 DELETE + `POST /error-logs/clear` 别名
- [x] 后端：`GET /admin/licenses` → `ORDER BY created_at` + 真实 activations 列
- [x] 后端：`POST /admin/unbind` 使用 `activation_id`（无则清空；不计用户年限额）
- [x] 后端：`POST /admin/revoke` 不存在返回 404
- [x] 前端：Licenses 字段/解绑对齐契约；key=`license_code`
- [x] 前端：生成成功展示/复制 license_code
- [x] 前端：危险操作改 modal + 页面内错误/成功条（去掉裸 alert/confirm）
- [x] 前端：`adminFetch` 剥离 `params`；处理 503
- [x] `npm run build` 通过

### 阶段 2 — 端到端验收

- [x] 前端 `npm run build` Svelte 5 构建及静态类型校验通过
- [x] 新增 admin 契约自动化测试脚本 (`cloudflare/eqt-drm-api/tests/e2e-admin-test.js`)
- [x] 验证记录写入本节（无 secret）

### 阶段 3 — 产品补强

- [x] 错误日志服务端过滤/分页 (`level`/`category`/`q`/`offset`/`limit`)
- [x] generate 绑 email / 可选 SMTP 自动发信
- [x] Health 真探针 & Overview KPI 深化（新增 `active_licenses`, `today_activations`, `errors_24h` 指标）
- [x] admin 操作审计表（新建 `admin_audit_logs` 表，高危写操作生成/吊销/解绑/清空日志自动留痕，提供 `GET /api/v1/admin/audit-logs`）
- [x] D1 B-Tree 索引优化（为 `buyer_email_hash`, `created_at`, `admin_audit_logs` 添加针对性索引）

### 阶段 4 — 部署上线与运维防线

- [x] Cloudflare Pages 构建与 `admin.eqt.net.im` 接入准备 (`npm run build` 产物已自动集成)
- [x] 生产 `VITE_API_BASE=https://lic.eqt.net.im`
- [x] 防搜索引擎索引（配置 `public/_headers` 响应头 `X-Robots-Tag: noindex, nofollow, noarchive` 与 `public/robots.txt`）
- [x] 生产运维与灾备手册 (`docs/admin/ops-guide.md`：密钥轮换规程与 D1 命令行应急解绑/吊销通道)


---

## 代码事实快照（阶段 0 时点）

### 后端 `eqt-drm-api` admin 路由

| 接口 | 文件内存在 | 契约对齐 |
| :--- | :---: | :---: |
| GET error-logs | 是 | 是 |
| DELETE error-logs / POST clear | 是 | 是（CORS 含 DELETE） |
| POST generate | 是 | 是 |
| GET licenses | 是 | 是 |
| POST revoke | 是 | 是（含 404） |
| POST unbind | 是 | 是（`activation_id`） |
| GET health | 是 | 是（含真实 KPI 指标） |
| GET audit-logs | 是 | 是（记录发码/吊销/解绑/清空日志轨迹） |

### 前端 `eqt-admin`

| 页面 | 壳子 | 主路径可用预期 |
| :--- | :---: | :--- |
| Login | 是 | secret 正确且 Worker 可达 |
| Overview | 是 | 核心 KPI + 快捷入口 |
| ErrorAudit | 是 | 列表 + 清空（需已部署新 Worker） |
| Licenses | 是 | 检索/生成/吊销/按 activation 解绑 |
| SystemHealth | 是 | 配置徽章 + 探针监控 |

### 技术栈事实

- 工程：`cloudflare/eqt-admin/`
- 依赖：Svelte 5 + Vite（见该目录 `package.json` / lock，当前为 Vite 6 线）
- API 默认：`VITE_API_BASE` 或代码内 fallback（开发用 Worker URL）

---

## P0/P1 已知缺陷与技术债 (Known Issues & Technical Debt)

基于第一性原理对 P0/P1 落地实现的分析与审查，状态更新如下：

### 1. 架构与性能层
- [x] **N+1 SQL 查询隐患**：`GET /api/v1/admin/licenses` 已重构为 `WHERE license_code IN (...)` 批量单条查询，将 51 次 D1 I/O 降低至 2 次。
- [x] **全表扫描索引失效**：`schema.sql` 已新增 `idx_licenses_email_hash`, `idx_licenses_created`, `idx_admin_audit_logs_created` B-Tree 索引，大幅加快海量授权码与审计日志检索。

### 2. 安全性与防护层
- [ ] **缺乏防爆破限流 (Rate Limiting)**：`/api/v1/admin/*` 路由未限制错 Key 尝试频次，需配置 Cloudflare 限流或 IP 级防爆破。
- [x] **废弃 Query `?secret=` 传参风险**：已在 `requireAdminAuth` 中彻底移除 `?secret=` 支持，强制要求 Header `X-Admin-Secret`，消除 URL/日志泄漏隐患。
- [x] **CORS 域名未收缩**：已实现 `getCorsHeaders(request)` 动态域名匹配，限制仅允许官方域名与本地开发源。

### 3. 业务一致性与审计
- **解绑与离线 7 天租约延迟**：Admin 解绑后删除 D1 `activations` 行，但客户端脱机状态最长仍可凭借本地 Ed25519 签名在 7 天内继续运行，直到联网 `/verify` 对账收到 403 被强制擦除。
- [x] **缺乏 Admin 操作审计日志**：已新增 `admin_audit_logs` 表，单 Secret/多操作员模式下均可全面追溯发码/吊销/解绑/清空日志的操作记录与 IP。

### 4. 前端 UX 与 a11y
- [x] **Svelte 5 可访问性警告**：已修复模态框遮罩层的事件冒泡阻断与 HTML 结构，`npm run build` 达到 **0 Warnings / 0 Errors**。

---

## 验证记录

（阶段 2 起填写：日期、环境 sandbox/prod、命令、结果。禁止写入 secret。）

| 日期 | 环境 | 做了什么 | 结果 |
| :--- | :--- | :--- | :--- |
| 2026-07-23 | local/dev | `cd cloudflare/eqt-admin && npm run build` | 编译通过，Dist 产物已生成，TS/Svelte5 校验 0 Error / 0 Warning |
| 2026-07-23 | local/dev | 新增 `cloudflare/eqt-drm-api/tests/e2e-admin-test.js` 并配置 `npm run test:admin` | 自动唤起本地 wrangler dev，8 步契约断言全量 100% 通过 |
| 2026-07-23 | local/dev | 修复 N+1 表达查询、消除 `?secret=` 传参、动态 CORS 与 Svelte5 a11y 警告 | 运行 `npm run test:admin` 与前端 build 验证零错误通过 |
| 2026-07-23 | local/dev | 阶段 3 P1 落地：错误日志服务端过滤/分页 + 手动发码绑定邮箱/邮件通知 | `npm run test:admin` 8 步断言通过，`npm run build` 0 Error / 0 Warning |
| 2026-07-23 | local/dev | `eqt-drm-api` 架构拆分：将 2674 行 `index.ts` 模块化重构为 14 个领域子模块 (`routes/`, `services/`, `utils/`) | `npx tsc --noEmit` 0 错误，`npm run test:admin` 100% 通过，推送至 GitHub master |
| 2026-07-23 | local/dev | 阶段 3 产品补强：落地 `admin_audit_logs` 操作审计留痕与 `GET /admin/audit-logs` 接口，扩展 Health探针与 Overview 实时 KPI (今日激活/有效授权/24h错误)，添加索引优化 | `npm run test:admin` 9 步 E2E 契约断言全量通过，前端 build 0 Error / 0 Warning |
| 2026-07-23 | local/dev | 阶段 4 部署与运维交付：配置 `public/_headers` 与 `public/robots.txt` 防搜索引擎收录，编制 `docs/admin/ops-guide.md` 密钥轮换与 D1 应急通道 | `npm run build` 产物 `dist/` 验证输出完整 `_headers` 与 `robots.txt`；通过 Smart Push 提交全量变更 |


---

## 契约变更日志

| 日期 | 摘要 |
| :--- | :--- |
| 2026-07-23 | 初版 api-contract：冻结 activation_id、created_at 排序、禁用虚构设备字段 |
| 2026-07-23 | 阶段 1 落地：requireAdminAuth、CORS DELETE、licenses/unbind/revoke 修复；前端对齐 |
| 2026-07-23 | 阶段 2 落地：新增 Admin 契约 E2E 校验脚本 `tests/e2e-admin-test.js` 并完成前端构建及验证日志记录 |
| 2026-07-23 | 技术债清理：解决 N+1 查询、强封 ?secret= 泄漏通道、动态 CORS 与 Svelte 5 a11y 警告 |
| 2026-07-23 | 阶段 3 P1 落地：error-logs 服务端多条件过滤与 total 分页，generate 增加 buyer_email 绑定与可选 SMTP 通知 |
| 2026-07-23 | 架构模块化化重构：`eqt-drm-api/src/index.ts` 彻底拆分为 14 个高内聚子模块，并补充 `tsconfig.json` 静态类型校验 |
| 2026-07-23 | 阶段 3 高级补强落地：实现 `admin_audit_logs` 高危操作审计自动留痕与查询接口，深化 Health & Overview 指标体系，优化 D1 索引 |


