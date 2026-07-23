# EQT 管理后台 (eqt-admin) 开发进度与实现文档

## 1. 项目概览与选型决策 (Project Overview & Tech Stack)

EQT 管理后台控制台 (`cloudflare/eqt-admin/`) 是面向运维与管理人员的可视化控制台，托管于 Cloudflare Pages (`admin.eqt.net.im`)。

### 核心技术选型 (Tech Stack Choices)

- **前端框架 (Framework)**: `Svelte 5` + `Vite 8` + `TypeScript`
  - **选型依据**: 与项目已有 `pkg/chat/v2/web` 技术栈 100% 保持一致，无需额外引入框架学习成本；Svelte 5 Runes (`$state`, `$derived`) 拥有极佳的响应式表达力与极小的打包体积。
- **CSS 样式选型 (CSS Architecture)**: **Vanilla CSS + Modern Design Tokens (CSS 变量)**
  - **选型依据**: 采用标准的 CSS Custom Properties 构建全局主题变量（主色、暗黑/浅色模式、卡片背景、毛玻璃效果、边框及圆角）；样式通过 Svelte 局部 Scoped 机制隔离，无 Tailwind/CSS-in-JS 编译依赖与打包体积负担，渲染性能与响应速度最优。
- **后端服务 (Backend Service)**: `cloudflare/eqt-drm-api` (Cloudflare Worker + D1 Database)
  - **选型依据**: 复用现有的 DRM Worker 与 D1 数据库，所有接口通过 `/api/v1/admin/*` 收拢并校验 `X-Admin-Secret` 头部。
- **凭证与会话 (Auth & Session)**: `sessionStorage` 暂存 `ADMIN_SECRET`，标签页关闭即销毁，防范凭证泄漏；全局 API Fetch Client 自动注入 `X-Admin-Secret` 并处理 401 拦截。

---

## 2. API 接口对接与实现计划 Matrix

| 模块 | API 路径 | HTTP 方法 | 后端状态 (`eqt-drm-api`) | 前端状态 (`eqt-admin`) | 说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **鉴权** | `/api/v1/admin/error-logs` | GET | ✅ 已实现 | ⏳ 推进中 | 尝试拉取 1 条日志作为 Secret 校验 |
| **错误审计** | `/api/v1/admin/error-logs` | GET | ✅ 已实现 | ⏳ 推进中 | 支持分页、`level` 筛选、堆栈 JSON 查看 |
| **日志清理** | `/api/v1/admin/error-logs` | DELETE | ⏳ 待补齐 | ⏳ 推进中 | 清空或按条件清理历史日志 |
| **授权生成** | `/api/v1/admin/generate` | POST | ✅ 已实现 | ⏳ 推进中 | 手动发码（兼容 `/generate-license` 别名） |
| **授权检索** | `/api/v1/admin/licenses` | GET | ⏳ 待补齐 | ⏳ 推进中 | 按 email/code/transaction_id 搜索全库授权 |
| **授权吊销** | `/api/v1/admin/revoke` | POST | ⏳ 待补齐 | ⏳ 推进中 | 吊销授权码（Status → `revoked`） |
| **设备解绑** | `/api/v1/admin/unbind` | POST | ⏳ 待补齐 | ⏳ 推进中 | 清除指纹释放 `max_devices` |
| **系统健康** | `/api/v1/admin/health` | GET | ⏳ 待补齐 | ⏳ 推进中 | SMTP 握手探针与 Webhook 履约诊断 |

---

## 3. 任务拆分与推进 Checkpoint (Tasks & Milestones)

- [x] **Milestone 1: 技术选型与文档同步**
  - [x] 完成 `docs/admin-dashboard-design.md` 设计规范同步与对齐。
  - [x] 确定 Svelte 5 + Vanilla CSS Variables 技术栈。
  - [x] 创建 `docs/admin/progress.md` 进度文档。

- [ ] **Milestone 2: 后端 API 补齐与单元测试 (`cloudflare/eqt-drm-api`)**
  - [ ] 在 `index.ts` 中补齐 `GET /api/v1/admin/licenses` 全库检索。
  - [ ] 补齐 `POST /api/v1/admin/revoke` 授权吊销逻辑。
  - [ ] 补齐 `POST /api/v1/admin/unbind` 管理员设备解绑接口。
  - [ ] 补齐 `DELETE /api/v1/admin/error-logs` 日志清理接口。
  - [ ] 补齐 `GET /api/v1/admin/health` 系统健康探针接口。
  - [ ] 运行 `cd cloudflare/eqt-drm-api && npm test` 验证后端逻辑。

- [ ] **Milestone 3: 前端工程初始化与通用能力 (`cloudflare/eqt-admin/`)**
  - [ ] 初始化 Svelte 5 + Vite 8 + TypeScript 工程结构。
  - [ ] 搭建 CSS Design Tokens 全局样式库 (`app.css`)。
  - [ ] 编写带 `X-Admin-Secret` 注入与 401 拦截的 `AdminApiClient` (`src/lib/api.ts`)。
  - [ ] 编写登录鉴权门组件 (`Login.svelte`) 与 sessionStorage 控制逻辑。

- [ ] **Milestone 4: 四大业务模块 UI 实现**
  - [ ] **错误审计中心 (`ErrorAudit.svelte`)**: 分页卡片列表、CRITICAL 高亮、JSON 堆栈模态框展开、条件筛选。
  - [ ] **授权与订单管控 (`Licenses.svelte`)**: 搜索框、授权表格/卡片、手动生成授权对话框 (`GenerateModal.svelte`)、吊销与解绑确认框。
  - [ ] **发信与系统健康 (`SystemHealth.svelte`)**: SMTP 状态看板、测试连通性按钮、Paddle Webhook 接收日志。
  - [ ] **概览与反馈面板 (`Overview.svelte`)**: 顶栏 KPI 统计卡片与反馈列表预留。

- [ ] **Milestone 5: 构建部署与 E2E 验证**
  - [ ] 前端打包测试 `npm run build`。
  - [ ] 使用 `chrome-devtools-mcp` 或端到端模拟测试各模态框与面板渲染。

---

## 4. Definition of Done (完成标准)

1. `cloudflare/eqt-drm-api` 具备完整的 `/api/v1/admin/*` 管理类 API，测试用例 100% 通过。
2. `cloudflare/eqt-admin/` 零 Build 错误、样式端庄且完全匹配现代暗黑/高精细度 UI 规范。
3. `git` 工作区干净，提交规范，并通过智能 Git 推送工具同步至远程仓库。
