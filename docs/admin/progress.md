# EQT 管理后台进度跟踪

> 以**代码与契约事实**为准更新。行动顺序见 [action-plan.md](./action-plan.md)。

最后更新：2026-07-23（契约对齐与测试深化修复轮完成：Health 字段对齐、E2E 深化、Chrome 9222 冒烟）

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

- [x] 前端 `npm run build` Svelte 5 构建通过
- [x] 新增 admin 契约自动化测试脚本 (`cloudflare/eqt-drm-api/tests/e2e-admin-test.js`)
- [x] 验证记录写入本节（无 secret）
- [x] E2E 深度：真实 activation 插入后按 `activation_id` 解绑并断言设备数变化
- [x] E2E 深度：health `config` 字段集合与契约一致
- [x] E2E 深度：error-logs level/category/q 过滤语义
- [x] 前端自动化 / Chrome 主路径冒烟（登录后四 Tab + 快捷入口）

### 阶段 3 — 产品补强

- [x] 错误日志服务端过滤/分页 (`level`/`category`/`q`/`offset`/`limit`)
- [x] generate 绑 email / 可选 SMTP 自动发信
- [x] Overview KPI 深化（`active_licenses`, `today_activations`, `errors_24h`）
- [x] admin 操作审计表 + `GET /api/v1/admin/audit-logs`（**API 已有，前端审计页未做**）
- [x] D1 B-Tree 索引优化
- [ ] Health **真探针**（SMTP TLS 握手等）——当前仅为 env 配置布尔，勿再标为已完成
- [ ] 前端操作审计只读页（消费 `GET /admin/audit-logs`）
- [x] Overview 快捷入口可跳转对应 Tab
- [ ] Webhook 最近记录时间线
- [ ] 反馈中心对接 `eqt-feedback-api`

### 阶段 4 — 部署上线与运维防线

- [x] Cloudflare Pages 构建准备（`npm run build` + `_headers` / `robots.txt`）
- [x] 生产 `VITE_API_BASE` 默认 `https://lic.eqt.net.im`
- [x] 防搜索引擎索引
- [x] 生产运维与灾备手册 (`docs/admin/ops-guide.md`)
- [ ] 生产 Pages 实际部署与 `admin.eqt.net.im` 可达性实测（验证记录）

---

## 2026-07-23 审查结论与修复清单（本轮）

> 对照 `docs/admin/*` 与代码事实的审查：P0 主链路后端可用，但 progress 对「完成度」偏乐观；测试偏烟测。

### 综合成熟度（审查时点）

| 维度 | 评分 | 说明 |
| :--- | :---: | :--- |
| 后端 P0 主链路 | ~90% | 鉴权/发码/检索/吊销/解绑/日志 API 可用 |
| 前端主路径 | ~75% | Licenses/ErrorAudit 好；Health 字段错位 |
| E2E 测试深度 | ~45% | `test:admin` 可绿，断言偏浅 |
| 文档 SSOT | 滞后 | `api-contract` / `gap-analysis` / action-plan 状态行未跟代码 |

### P0 — 正确性（本轮必须完成）

| # | 项 | 状态 | 说明 |
| :---: | :--- | :---: | :--- |
| F1 | Health 前后端字段对齐 | [x] | BE 同时返回 `paddle_configured`/`r2_configured` 与别名 |
| F2 | `types.ts` / SystemHealth 与 BE 一致 | [x] | 完整 config/metrics；文案标明非真探针 |
| F3 | E2E：插入 activation → 按 `activation_id` 解绑 | [x] | local D1 insert + 断言设备消失 |
| F4 | E2E：health config key 集合断言 | [x] | 必填键缺失则 fail |
| F5 | 更新本 progress + 契约片段 | [x] | api-contract health/error-logs/generate 已同步 |

### P1 — 完备性（本轮尽量完成）

| # | 项 | 状态 | 说明 |
| :---: | :--- | :---: | :--- |
| F6 | E2E：error-logs 过滤语义 | [x] | 插入 CRITICAL/WARN 后断言过滤 |
| F7 | Overview 快捷入口真正切 Tab | [x] | `onNavigate` 回调 |
| F8 | 同步 `api-contract.md` health/error-logs/generate 已实现字段 | [x] | 含 audit-logs 小节 |
| F9 | `npm run check` / svelte-check 可用 | [x] | 补 `svelte.config.js` |
| F10 | Chrome 9222 本地 Admin 主路径冒烟 | [x] | 四 Tab + 快捷入口 + Paddle 徽章就绪 |

### P2 — 后置（不阻断本轮）

| # | 项 | 状态 |
| :---: | :--- | :---: |
| F11 | 操作审计只读 UI | [ ] |
| F12 | SMTP/Paddle 真探针 | [ ] |
| F13 | Admin 路由 Rate Limiting | [ ] |
| F14 | 生产 `admin.eqt.net.im` 实测 | [ ] |
| F15 | 拒绝 `?secret=` / OPTIONS DELETE / 503 无 secret 专项断言 | [ ] |

---

## 代码事实快照

### 后端 `eqt-drm-api` admin 路由

| 接口 | 文件内存在 | 契约对齐 |
| :--- | :---: | :--- |
| GET error-logs | 是 | 是（含过滤分页） |
| DELETE error-logs / POST clear | 是 | 是（CORS 含 DELETE） |
| POST generate | 是 | 是（含 buyer_email / send_email） |
| GET licenses | 是 | 是（created_at + batch activations） |
| POST revoke | 是 | 是（含 404） |
| POST unbind | 是 | 是（`activation_id`） |
| GET health | 是 | 字段对齐（含 paddle/r2 布尔） |
| GET audit-logs | 是 | API 有；前端无页 |

### 前端 `eqt-admin`

| 页面 | 壳子 | 主路径可用预期 |
| :--- | :---: | :--- |
| Login | 是 | secret 正确且 Worker 可达 |
| Overview | 是 | KPI + 快捷入口可跳转 |
| ErrorAudit | 是 | 列表过滤分页 + 清空 |
| Licenses | 是 | 检索/生成/吊销/按 activation 解绑 |
| SystemHealth | 是 | 配置徽章对齐（env 布尔，非真探针） |
| AuditLogs | 否 | 仅 types 预留 |

### 技术栈事实

- 工程：`cloudflare/eqt-admin/`
- 依赖：Svelte 5 + Vite 6 + TypeScript
- API 默认：`VITE_API_BASE` 或 `https://lic.eqt.net.im`

---

## P0/P1 已知缺陷与技术债 (Known Issues & Technical Debt)

### 1. 架构与性能层
- [x] **N+1 SQL**：licenses 列表 batch `IN (...)` activations
- [x] **索引**：`idx_licenses_email_hash`, `idx_licenses_created`, `idx_admin_audit_logs_created`

### 2. 安全性与防护层
- [ ] **Rate Limiting**：`/api/v1/admin/*` 错 Key 防爆破
- [x] **废弃 `?secret=`**：仅 Header `X-Admin-Secret`
- [x] **CORS 域名收缩**：`getCorsHeaders` 动态匹配

### 3. 业务一致性与审计
- **解绑与离线 7 天租约**：Admin 删 D1 activation 后，客户端最长约 7 天仍可凭本地签名运行，直到 `/verify` 403
- [x] **Admin 操作审计 API**：`admin_audit_logs` + GET
- [ ] **Admin 操作审计 UI**

### 4. 前端 UX / 契约
- [x] Svelte 5 a11y：`npm run build` 0 Warning（历史）
- [x] Health 字段错位（F1/F2 已修）
- [x] Overview 死链快捷入口（F7 已修）

---

## 验证记录

（禁止写入 secret。）

| 日期 | 环境 | 做了什么 | 结果 |
| :--- | :--- | :--- | :--- |
| 2026-07-23 | local/dev | `npm run build` (eqt-admin) | 通过 |
| 2026-07-23 | local/dev | `npm run test:admin`（9 步烟测） | 通过（深度不足，见修复清单） |
| 2026-07-23 | local/dev | 审查实现 vs docs/admin | 记录 P0/P1 修复清单；启动修复轮 |
| 2026-07-23 | local/dev | 修复 Health 字段对齐 + Overview 跳转 + E2E 深化 | `npm run test:admin` 10 步全过；`npm run build` 通过 |
| 2026-07-23 | local/dev | Chrome 9222 冒烟：`127.0.0.1:3001` + 本地 Worker `:8787` | 登录壳→四 Tab→快捷入口；Health 显示 Paddle CONFIGURED；截图 `docs/admin/chrome-smoke-health.png` |

---

## 契约变更日志

| 日期 | 摘要 |
| :--- | :--- |
| 2026-07-23 | 初版 api-contract：冻结 activation_id、created_at 排序 |
| 2026-07-23 | 阶段 1–4 主链路落地记录 |
| 2026-07-23 | 审查+修复：Health FE/BE 字段对齐、E2E 深化（activation unbind/filter）、契约文档同步、Chrome 冒烟 |
