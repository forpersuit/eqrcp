# EQT Admin 架构与代码审查报告 (2026-08-14)

## 一、总体判断

| 维度 | 现状与评价 | 处置状态 |
| :--- | :--- | :--- |
| **分层结构** | ✅ 好：`lib/`（api/auth/env/i18n/types）、`pages/`、`components/` 组件化清晰 | 保持 |
| **生产鉴权** | ✅ 好：Cloudflare Access JWT 同源反代，比单 secret 强 | 保持 |
| **安全基线** | ✅ 好：`_headers` 有 noindex/X-Frame-Options: DENY/nosniff，robots.txt Disallow | 保持 |
| **类型安全** | ✅ 严格化：消除假联合类型（`'A' \| string`），`adminFetch` 默认泛型修正为 `unknown` 强制调用方收窄 | **✅ 已修复** |
| **反代健壮性** | ✅ 健壮化：反代增加 502/503 结构化 JSON 返回，前端 `adminFetch` 防御性 JSON 解析 | **✅ 已修复** |
| **环境路由与收敛** | ✅ 收敛门槛：生产域名切换至测试沙箱强制校验 Access JWT 凭证，限制仅代理管理端路径 | **✅ 已修复** |
| **弹窗交互** | ✅ 规范化：Blacklist 原生 `confirm()` 已迁移为内建模态确认框，杜绝 alert/confirm 违规 | **✅ 已修复** |
| **测试覆盖** | ❌ 零测试文件（纯函数未单测覆盖） | 待处理 (P2) |
| **架构一致性** | ⚠️ i18n 存在空字典架子、文档与实现存在 SSOT 漂移 | 待处理 (P1/P2) |

---

## 二、硬性违规（与 Need to Obey 规则冲突）

### 🔴 1. 原生 confirm() 弹窗仍在用（且被债文档误标为"已修"）

- **位置**：`src/pages/Blacklist.svelte:86`
- **原问题**：
  ```ts
  if (!confirm(`确认解除封禁 #${id}？`)) return;
  ```
  直接违反项目硬性规则："avoid alert-style prompts (such as browser-level alert dialogs) … always use in-app notifications"。
  此外 `docs/admin/gap-analysis.md:57` 曾将该项误标为"已修"，造成文档与代码不一致。
- **✅ 修复方案与状态（已完成）**：
  1. `Blacklist.svelte` 引入 `unbanTarget` 响应式状态与 `executeUnban` 方法。
  2. 新增与 `Licenses`/`ErrorAudit` 风格一致的 `modal-overlay` + `modal-confirm` 内建模态确认框。
  3. 同步纠正 `docs/admin/gap-analysis.md:57` 中的状态声明，确保全站杜绝原生浏览器弹窗。

---

## 三、中高危：类型安全与健壮性

### 🟠 2. 假类型安全：'A' | 'B' | string 联合类型

- **位置**：`src/lib/types.ts`
- **原问题**：
  ```ts
  kind: 'email' | 'device' | string;      // TS 中等价于 string
  tier: LicenseTier | string;             // TS 中等价于 string
  action: 'GENERATE' | 'REVOKE' | ... | string;  // TS 中等价于 string
  ```
  字面量并上 `string` 会将 TS 类型收窄能力归零，破坏编译器拼写检查与字段重构保护。
- **✅ 修复方案与状态（已完成）**：
  1. 定义严格的 `BlacklistKind`、`LicenseSource`、`RevokeReason`、`AdminAuditAction`、`AdminAuditTargetType` 联合类型。
  2. 移除所有接口中的 `| string` 宽泛退化，并在 `HealthRecentEvent` 和 `GenerateLicenseResponse` 等类型中全面应用严格类型。
  3. `svelte-check` 0 错误 0 警告通过。

---

### 🟠 3. 同源反代函数健壮性不足 & 前端 JSON 解析兜底

- **位置**：`functions/api/[[path]].ts` 与 `src/lib/api.ts`
- **原问题**：
  - `functions/api/[[path]].ts` 的 `await fetch(target, init)` 无 `try/catch`。上游网络中断或超时时，Pages Function 直接抛未捕获异常返回 Cloudflare HTML 500。
  - 前端 `src/lib/api.ts` 的 `response.json()` 无兜底，收到 HTML 响应时抛出 `SyntaxError`，导致前端崩溃或提示信息混乱。
- **✅ 修复方案与状态（已完成）**：
  1. `functions/api/[[path]].ts` 增加全量 `try/catch`，上游异常时返回标准 JSON 结构化 502 错误（`UPSTREAM_PROXY_ERROR`）及友好提示。
  2. `src/lib/api.ts` 的 `adminFetch` 增加网络连接异常捕获、`502/503` 友好映射，以及 `response.json().catch(() => null)` 防御性解析，彻底杜绝 HTML 500 引发的二次崩溃。

---

### 🟠 4. X-EQT-Environment 测试环境上游收敛与路径规范化

- **位置**：`functions/api/[[path]].ts`
- **原问题**：
  - 测试上游 `lic-test.eqt.net.im` 可被公网客户端仅凭 `X-EQT-Environment: test` 请求头打入，缺乏前置鉴权门槛；
  - 路径拼接未规范化，存在打到非预期端点的可能。
- **✅ 修复方案与状态（已完成）**：
  1. **测试路由鉴权门槛**：在生产域名（如 `admin.eqt.net.im`）下，仅当请求包含有效的 Cloudflare Access JWT 凭证时才允许路由至测试上游，未鉴权请求尝试切换测试环境直接拦截返回 401（本地与 preview 环境不受限）。
  2. **API 范围收敛**：强制反代路径必须匹配管理端白名单（`/v1/admin/*` 与 `/v1/health`），禁止代理其他非管理端 API。
  3. **路径清洗**：过滤 `.` 与 `..` 片段，规范化拼接路径。

---

### 🟠 5. adminFetch 泛型收窄为 unknown

- **位置**：`src/lib/api.ts:22`
- **原问题**：`adminFetch<T = any>` 默认使用 `any`，导致未指定类型的调用点自动丢失 TypeScript 静态校验。
- **✅ 修复方案与状态（已完成）**：
  - 将签名更新为 `export async function adminFetch<T = unknown>(endpoint: string, options: ApiOptions = {}): Promise<T>`。
  - 强制要求调用方显式指定返回类型（如 `adminFetch<AdminHealthResponse>`）或在消费时进行类型收窄，彻底消除隐式 `any` 风险。

---

## 四、中危：架构与一致性（待排期）

### 🟡 6. i18n 是半成品 + 死代码

- **现状**：`i18n.ts` 声明了 7 种语言但 6 种是空字典 `{}`；全站除 `Metrics` 与 `App` 外其余 6 个页面均为硬编码中文；`zh.ts` 中存在大量未消费的键。
- **建议**：明确产品定位——若后台仅用于内部运维，建议精简移除空语言骨架；若需要支持国际化，则将其他页面完整迁移为 `$t()`。

### 🟡 7. 零自动化测试

- **现状**：前端工程未配置单测运行器（如 `vitest`），纯函数（如 `summarizeDetails`、`translate`）无单测保护。
- **建议**：引入 `vitest` 并为纯函数增加针对性单测。

### 🟡 8. 重复样板：模态框/分页/Banner 复制粘贴

- **现状**：`ErrorAudit` / `OpsAudit` / `Licenses` / `Blacklist` 各自存在相似的弹窗、分页器与状态条结构。
- **建议**：抽离通用的 `Modal.svelte`、`Pagination.svelte`、`Banner.svelte` 共享组件。

### 🟡 9. 文档与实现系统性漂移（契约 SSOT 失守）

- **现状**：`api-contract.md` 仍有关于 Secret 鉴权的表述，与纯 Access JWT 实现不完全吻合；`README.md` 中存在重复及过时的环境变量配置。
- **建议**：清理过时鉴权说明与死配置，保持文档与代码完全一致。

---

## 五、低危：小瑕疵（已知项）

| # | 位置 | 现状说明 | 建议处置 |
| :--- | :--- | :--- | :--- |
| 10 | `auth.ts:21` | 团队域名硬编码默认值 `huiai.cloudflareaccess.com` | 建议仅从 `VITE_CF_ACCESS_TEAM_DOMAIN` 读取，缺失时给 null |
| 11 | `Login.svelte:5,27` | `loading` 变量未使用，`queueMicrotask` 初始化 | 简化变量，统一为 `onMount` 规范 |
| 12 | `lib/env.ts:1` | 仅一行 `export * from './env.svelte'` | 消除无意义间接层 |
| 13 | `i18n.ts:42-54` | 空字典 truthy 导致回退逻辑隐晦 | 随 i18n 整改统一重构 |
| 14 | 各 Modal | 依赖 `svelte-ignore` 压制警告，缺少 ESC 快捷关闭 | 登记为运维已知体验项 |
| 15 | `env.svelte.ts:20` | 单例 storage 监听在全局生命周期常驻 | 影响微小，属于可接受设计 |

---

## 六、关于"内联 onclick"的一点澄清

Svelte 5 模板中的 `onclick={handler}` 在编译期会被转换为标准的 `addEventListener` 声明式绑定，并非在 HTML 字符串中拼接全局内联事件代码。因此组件中的 `onclick` 语法符合工程规范，无需重构成复杂的手动 `use:action`。

---

## 七、修复进度与后续优先级

1. **已完成（第 1–5 项）**：
   - [x] **P0**：`Blacklist.svelte` 移除 `confirm()`，改用内建模态确认框；修正 `gap-analysis.md`。
   - [x] **P1**：Pages Function 反代加 `try/catch` 结构化 502/503；`api.ts` 增强网络错误与 JSON 兜底。
   - [x] **P1**：`functions/api/[[path]].ts` 增加 Access JWT 鉴权门槛收敛测试上游，限制仅代理管理端白名单路径。
   - [x] **P2**：`types.ts` 修复宽泛联合类型；`api.ts` 将 `adminFetch` 默认泛型调整为 `unknown`。
2. **待进行（后续轮次）**：
   - [ ] **P1**：统一 i18n 策略（决定精简或全面落地）。
   - [ ] **P2**：引入 `vitest` 为核心纯函数补齐单测。
   - [ ] **P2**：同步 `api-contract.md`、`README.md` 与 `auth.ts`（消除 SSOT 漂移）。
   - [ ] **P3**：抽离共享 `Modal` / `Pagination` / `Banner` 组件。