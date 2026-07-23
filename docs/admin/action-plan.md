# EQT 管理后台 — 分阶段行动计划

> 目标：在低运维成本下，用 `cloudflare/eqt-admin` 替代 D1 Console / wrangler 手改，完成审计、发码、吊销、解绑与健康观察。  
> 原则：**契约先于 UI，P0 可用性先于锦上添花；每阶段有明确验收，通过后再进下一阶段。**

关联文档：[gap-analysis.md](./gap-analysis.md) · [api-contract.md](./api-contract.md) · [progress.md](./progress.md)

---

## 阶段总览

| 阶段 | 名称 | 性质 | 产出 | 依赖 |
| :---: | :--- | :--- | :--- | :--- |
| **0** | 对齐与预备 | 文档 / 契约 / 工程可读性 | 本目录文档、schema 对齐、README/env | 无 |
| **1** | P0 契约修复 | 后端为主 + 前端字段对齐 | 授权列表/解绑可用、CORS/鉴权安全 | 阶段 0 |
| **2** | 端到端验收 | 本地联调 + 最小测试 | 四页主路径可走通 | 阶段 1 |
| **3** | 产品补强 | 按优先级增量 | 发信/分页/真探针/审计日志等 | 阶段 2 |
| **4** | 部署上线 | Pages + 域名 + 运维 | `admin.eqt.net.im` 可访问 | 阶段 2 最低，建议 3 部分完成 |

**当前所处位置：阶段 0（本提交完成后勾选）。下一动作：阶段 1。**

---

## 阶段 0 — 对齐与预备（本阶段）

### 目标

让团队对「真实 schema、目标 API、当前缺口、下一步顺序」有同一真相源，避免按错误字段继续堆 UI。

### 任务清单

| # | 任务 | 完成标准 |
| :---: | :--- | :--- |
| 0.1 | 文档目录 `docs/admin/` 结构化 | 有 README、action-plan、gap-analysis、api-contract、progress |
| 0.2 | 设计总纲与工程路径一致 | `admin-dashboard-design.md` 指向 `cloudflare/eqt-admin`、真实 Vite 版本、契约链接 |
| 0.3 | API 契约对齐 D1 真实列 | 设备用 `activation_id` / 指纹哈希列；`licenses` 无 `id` 排序 |
| 0.4 | `schema.sql` 纳入 `system_error_logs` | 与 runtime `ensureAuditLogTable` 一致 |
| 0.5 | 前端工程可读性 | `eqt-admin/README.md`、`.env.example` |
| 0.6 | 清理非正式文档 | 删除 `docs/admin/1` 聊天 dump |

### 明确不做（本阶段）

- 不改业务逻辑大重写  
- 不部署 Pages  
- 不接反馈中心  
- 不做真实 SMTP TLS 探针实现  

### 验收

- [x] 上述文档与预备文件落库  
- [x] progress 反映「路由已写、契约未对齐」的真实状态  

---

## 阶段 1 — P0 契约修复（下一阶段，严格顺序）

> **未完成阶段 1 前，不要继续堆新 UI 功能。**

### 1A — 后端（`eqt-drm-api`）

按下列顺序改，改完一条验收一条：

| 顺序 | 项 | 动作 | 验收 |
| :---: | :--- | :--- | :--- |
| 1 | 鉴权 fail-closed | `ADMIN_SECRET` 未配置时 admin 一律 401/503 | 未设 secret 时任意请求被拒 |
| 2 | CORS | `Access-Control-Allow-Methods` 含 `DELETE`（或清空改为 `POST`） | 浏览器可清空日志 |
| 3 | `GET /admin/licenses` | `ORDER BY created_at DESC`；activations 查真实列 | 无 SQL 错；返回 `id,uuid_hash,...` |
| 4 | `POST /admin/unbind` | 按 `activation_id` 解绑（可选清空全量）；对齐 user 侧写 `unbind_records` 策略在契约中定稿 | 解绑后 devices 减少 |
| 5 | `POST /admin/revoke` | 校验 license 存在；返回明确结果 | 不存在 → 404 |
| 6 | schema.sql | 已在 0 阶段补表；确认 remote 与本地一致 | D1 console / migrate 说明写入 progress |

实现细节以 [api-contract.md](./api-contract.md) 为准，**禁止**再使用 `device_fingerprint` / `device_name` / `licenses.id`。

### 1B — 前端（`eqt-admin`）

| 顺序 | 项 | 动作 | 验收 |
| :---: | :--- | :--- | :--- |
| 1 | 类型与契约 | `src/lib/types.ts` 对齐 api-contract | 无虚构字段 |
| 2 | Licenses 页 | key=`license_code`；设备列表展示哈希摘要 + `device_id`；解绑传 `activation_id` | 列表与解绑可用 |
| 3 | 危险操作 | 去掉裸 `alert`/`confirm`（管理端可用已有 modal + 页面内错误条） | 符合项目通知习惯 |
| 4 | API base | 文档化 `VITE_API_BASE`；默认注释生产 `https://lic.eqt.net.im` | README 可跟做 |

### 阶段 1 总验收

- 使用真实 `ADMIN_SECRET` 登录  
- Overview / Health 能拉到 metrics  
- ErrorAudit 能列表 + 清空  
- Licenses 能搜索（空 q 最近 N 条）、生成、吊销、按设备解绑  

---

## 阶段 2 — 端到端验收

| # | 任务 | 完成标准 |
| :---: | :--- | :--- |
| 2.1 | 本地 `npm run dev` + 指向 sandbox/prod Worker | 四 Tab 主路径无控制台未处理异常 |
| 2.2 | 后端最小测试或脚本 | 覆盖 licenses 检索、unbind、revoke、error-logs DELETE |
| 2.3 | 记录实测账号与注意点 | 写入 progress「验证记录」小节（不含 secret） |

---

## 阶段 3 — 产品补强（按优先级，可拆 PR）

| 优先级 | 项 | 说明 |
| :---: | :--- | :--- |
| P1 | 错误日志服务端过滤 + 分页 | `level`/`category`/`q`/`cursor` |
| P1 | 生成后展示/复制 license_code；可选绑 email | 生成响应前端必须展示 |
| P2 | generate 后 SMTP 发信 | 依赖邮箱与发信模板 |
| P2 | Health 真探针 | SMTP 握手结果 vs 仅 `configured` 布尔 |
| P2 | Webhook 最近记录 | 需先定是否落 D1 表或读外部 |
| P3 | Overview KPI 深化 | 今日激活、24h 错误 |
| P3 | 反馈中心 | 对接 `eqt-feedback-api` |
| P3 | admin 操作审计表 | 谁在何时吊销/解绑 |

每项单独 PR，改完勾 progress，**不捆绑大爆炸。**

---

## 阶段 4 — 部署

| # | 任务 | 完成标准 |
| :---: | :--- | :--- |
| 4.1 | Cloudflare Pages 项目绑定 `eqt-admin` 构建 | `npm run build` 产物可部署 |
| 4.2 | 自定义域 `admin.eqt.net.im` | HTTPS 可用；搜索引擎不索引（headers/robots） |
| 4.3 | 生产 `VITE_API_BASE=https://lic.eqt.net.im` | 跨域 CORS 已覆盖 |
| 4.4 | 运维手册一小节 | secret 轮换、应急仍可用 D1 Console |

---

## 决策冻结（阶段 0 起生效）

下列事项在实现阶段 1 时**不得再争论路径命名**，以契约为准：

| 主题 | 决定 |
| :--- | :--- |
| 工程路径 | `cloudflare/eqt-admin/`（不是 `apps/admin-dashboard`） |
| 发码路径 | `POST /api/v1/admin/generate`（兼容 `/generate-license`） |
| 吊销路径 | `POST /api/v1/admin/revoke`（兼容 `/revoke-license`） |
| 设备解绑主键 | **`activation_id`**（与 `/user/unbind-device` 一致） |
| 授权排序 | `created_at DESC`（不用 `licenses.id`） |
| 鉴权 | Header `X-Admin-Secret`；secret 存 `sessionStorage` |
| 清空日志 | 优先修 CORS 支持 `DELETE`；若环境限制可并行提供 `POST .../error-logs/clear` |
| 前端栈 | Svelte 5 + 当前 lock 的 Vite 主版本 + TS + Vanilla CSS tokens |

未决、留到阶段 3 再定：

- Admin 解绑是否计入用户年解绑限额（`unbind_records`）  
- 是否引入多管理员身份与操作审计  
- Health 是否调用外部 Paddle API 拉通知  

---

## 工作流约定

1. 开工前打开 `progress.md`，只推进当前阶段未勾项。  
2. 改 API 必须先改 `api-contract.md`，再改 Worker，再改前端。  
3. 每阶段结束：更新 progress → 测试命令写入 → 提交推送。  
4. 发现与契约冲突：停手，更新 gap-analysis，不要 silent average。
