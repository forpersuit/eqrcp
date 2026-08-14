# EQT Admin 架构与代码审查及全面整改报告 (2026-08-14)

## 一、总体判断与整改闭环总览

| 维度 | 审查现状与整改措施 | 最终状态 |
| :--- | :--- | :--- |
| **分层结构** | `lib/`（api/auth/env/i18n/types/audit）、`pages/`、`components/`（Modal/Pagination/Banner）清晰分层 | ✅ 保持且组件化增强 |
| **生产鉴权** | Cloudflare Access JWT 同源反代，去除硬编码团队域名，测试上游增加 JWT 校验门槛 | ✅ 已修复收敛 |
| **安全基线** | `_headers` 有 noindex/X-Frame-Options: DENY/nosniff，反代强制限定仅代理管理端白名单路径 | ✅ 已加固 |
| **类型安全** | 消除假联合类型（`'A' \| string`），`adminFetch` 默认泛型修正为 `unknown` 强制调用方收窄 | ✅ 已全面严格化 |
| **反代健壮性** | 反代增加 502/503 结构化 JSON 返回，前端 `adminFetch` 防御性 JSON 解析杜绝崩溃 | ✅ 已修复健壮化 |
| **弹窗交互** | Blacklist 原生 `confirm()` 迁移为内建模态确认框，全站彻底杜绝 alert/confirm | ✅ 已完全合规 |
| **架构一致性** | 精简 i18n 空字典骨架，提供完整 `en.ts` 与 `zh.ts` 翻译，修复回退逻辑 | ✅ 已重构落地 |
| **自动化测试** | 引入 `vitest` 并为 `i18n` 翻译插值与 `audit` 审计日志解析等纯函数建立 100% 单测覆盖 | ✅ 10/10 测试通过 |
| **组件化重构** | 抽离复用 `Modal.svelte`（支持 ESC 键关闭与焦点无障碍）、`Pagination.svelte`、`Banner.svelte` | ✅ 消除跨页面重复样板 |
| **契约与文档** | 同步 `api-contract.md`、`README.md` 与代码实现，彻底消除 SSOT 漂移与死配置 | ✅ 已全面对齐 |

---

## 二、硬性违规处置（与 Need to Obey 规则冲突）

### 🔴 1. 原生 confirm() 弹窗仍在用（已修复）

- **位置**：`src/pages/Blacklist.svelte`
- **处理结果**：
  1. `Blacklist.svelte` 引入 `unbanTarget` 响应式状态与 `executeUnban` 异步流程，替换 `window.confirm()`。
  2. 使用共享组件 `<Modal>` 承载高危解封确认，全站统一为 in-app 模态与横幅通知。
  3. 同步纠正 `docs/admin/gap-analysis.md` 中的状态声明。

---

## 三、中高危：类型安全与健壮性

### 🟠 2. 假类型安全：'A' | 'B' | string 联合类型（已修复）

- **位置**：`src/lib/types.ts`
- **处理结果**：
  1. 定义严格的 `BlacklistKind`、`LicenseSource`、`RevokeReason`、`AdminAuditAction`、`AdminAuditTargetType` 联合类型。
  2. 移除所有宽泛的 `| string` 退化类型，使 TypeScript 编译器具备完整的类型收窄与重构保护能力。

---

### 🟠 3. 同源反代函数健壮性不足 & 前端 JSON 解析兜底（已修复）

- **位置**：`functions/api/[[path]].ts` 与 `src/lib/api.ts`
- **处理结果**：
  1. `functions/api/[[path]].ts` 增加全量 `try/catch`，上游不可达时返回结构化 JSON 502（`UPSTREAM_PROXY_ERROR`）。
  2. `src/lib/api.ts` 的 `adminFetch` 增加网络错误捕获与 `response.json().catch(() => null)` 防御性解析，彻底解决 HTML 500 引发的二次语法报错崩溃。

---

### 🟠 4. X-EQT-Environment 测试环境上游收敛与路径规范化（已修复）

- **位置**：`functions/api/[[path]].ts`
- **处理结果**：
  1. **测试路由鉴权门槛**：在生产域名（如 `admin.eqt.net.im`）下，仅当请求包含有效的 Cloudflare Access JWT 凭证时才允许路由至测试上游，未鉴权请求尝试切换测试环境直接拦截返回 401（`UNAUTHORIZED_ENVIRONMENT_SWITCH`），消除公网随意探测测试环境的攻击面。
  2. **API 范围白名单**：强制反代路径必须以 `v1/admin` 或 `v1/health` 开头，禁止代理其他非管理端 API。
  3. **路径清洗**：过滤 `.` 与 `..` 片段，规范化拼接路径。

---

### 🟠 5. adminFetch 泛型收窄为 unknown（已修复）

- **位置**：`src/lib/api.ts:22`
- **处理结果**：
  - 更新签名：`export async function adminFetch<T = unknown>(endpoint: string, options: ApiOptions = {}): Promise<T>`。
  - 强制要求调用方显式指定返回类型或在消费时进行类型收窄，杜绝隐式 `any`。

---

## 四、中危：架构、测试与一致性全面整改

### 🟡 6. i18n 规范化与真实英文字典落地（已修复）

- **位置**：`src/lib/i18n.ts`、`src/lib/locales/zh.ts`、`src/lib/locales/en.ts`
- **处理结果**：
  1. 移除空字典架子（`ja/ko/es/de/fr`），遵循 Rule 2 Simplicity First，仅保留当前维护的 `zh` 与 `en`。
  2. 新增真实的 `en.ts` 翻译字典，补全导航、概览、授权、黑名单、健康度与业务指标各模块英文对照。
  3. 重构 `translate` 函数，实现严密、清晰的双层回退逻辑（目标语言字典 → 中文主字典 → 原始键名）。

---

### 🟡 7. 引入 Vitest 自动化单元测试（已修复）

- **位置**：`package.json`、`src/lib/i18n.test.ts`、`src/lib/audit.test.ts`
- **处理结果**：
  1. 在 `devDependencies` 中配置 `vitest` 并增加 `npm test` 脚本。
  2. 为 `i18n.ts` 的翻译查找、插值替换及降级回退编写 5 组针对性单测。
  3. 提取 `src/lib/audit.ts` 纯函数模块，为审计详情解析（`parseDetails`）与各类动作摘要（`summarizeDetails`）编写 5 组单测。
  4. 运行 `npm test`，全部 10 项测试 100% 通过。

---

### 🟡 8. 抽离共享 UI 组件（已修复）

- **位置**：`src/components/Modal.svelte`、`src/components/Pagination.svelte`、`src/components/Banner.svelte`
- **处理结果**：
  1. **`Modal.svelte`**：统一弹窗遮罩与卡片，支持 `Escape` 快捷键关闭与 ARIA 无障碍属性，支持 Svelte 5 snippets。
  2. **`Pagination.svelte`**：统一分页控制条、页码计算与边界防呆。
  3. **`Banner.svelte`**：统一 success / error / info 各状态提示条，替代分散在各页面的重复 HTML 与 CSS。
  4. 在 `ErrorAudit`、`OpsAudit`、`Blacklist` 等页面全面应用共享组件，并清理了所有未使用的冗余 CSS 规则，`svelte-check` 0 警告 0 错误。

---

### 🟡 9. 文档与实现系统性漂移纠正（已修复）

- **位置**：`cloudflare/eqt-admin/README.md`、`docs/admin/api-contract.md`
- **处理结果**：
  1. `api-contract.md`：更新 §0 鉴权表与顶层说明，明确生产环境首选 Cloudflare Access JWT 同源反代鉴权，开发/脚本维护 `X-Admin-Secret`，保持与前端现状一致。
  2. `cloudflare/eqt-admin/README.md`：清理重复的环境变量声明（`VITE_CF_ACCESS_TEAM_DOMAIN`），移除已废弃的 `VITE_ADMIN_AUTH_MODE=access` 与 `sessionStorage` secret 描述。

---

## 五、低危瑕疵处置

| # | 位置 | 处置措施 | 状态 |
| :--- | :--- | :--- | :--- |
| 10 | `auth.ts:21` | 移除硬编码魔法域名 `huiai.cloudflareaccess.com`，仅读取 `VITE_CF_ACCESS_TEAM_DOMAIN`，未配置时安全返回 `null` | ✅ 已修复 |
| 11 | `Login.svelte` | 移除未使用的 `loading` 变量，将初始化副作用由 `queueMicrotask` 统一为规范的 `onMount` | ✅ 已修复 |
| 12 | `lib/env.ts` | 移除仅有一行转发的冗余中间层文件，各组件直接引用 `env.svelte` | ✅ 已清理 |
| 13 | `i18n.ts` | 重写字典判定与回退链路，消除 truthy 空对象引发的隐晦逻辑 | ✅ 已修复 |
| 14 | 各 Modal | 统一迁移至 `Modal.svelte`，内置全局 `Escape` 键盘监听与标准 `role="dialog"` 属性 | ✅ 已修复 |

---

## 六、整改后验证记录

1. **单元测试 (Unit Tests)**：
   ```bash
   npm test (vitest) -> 2 test files, 10 tests passed (100%)
   ```
2. **TypeScript & Svelte 诊断**：
   ```bash
   npm run check (svelte-check) -> 0 errors, 0 warnings
   ```
3. **生产构建 (Production Build)**：
   ```bash
   npm run build (vite build) -> 141 modules transformed, dist/ built successfully
   ```
4. **Go 后端全量测试**：
   ```bash
   go test ./... -> 100% passed
   ```