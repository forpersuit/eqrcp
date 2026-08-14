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
| **全站 i18n 落地** | 全站 8 个页面与公共组件全面接线 `$t()`，中英文双语字典完整，侧边栏支持语言切换与本地持久化 | ✅ 真实全面接线 |
| **组件化重构** | 抽离复用 `Modal.svelte`（支持真实焦点陷阱、自动对焦、关闭恢复焦点与 ESC 监听）、`Pagination.svelte`（带 loading 防抖守卫与完整条目区间）、`Banner.svelte`，覆盖全部业务页面（包括 `Licenses.svelte`） | ✅ 全页面统一迁移 |
| **自动化测试** | 引入 `vitest` 为 `i18n` 翻译插值/真实回退 与 `audit` 审计日志解析等纯函数建立 100% 单测覆盖 | ✅ 10/10 测试通过 |
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

## 四、架构、测试与一致性全面整改

### 🟡 6. i18n 全站接线与中英文双语完整落地（已修复）

- **位置**：`src/lib/i18n.ts`、`src/lib/locales/zh.ts`、`src/lib/locales/en.ts` 以及全站所有业务页面与组件
- **处理结果**：
  1. **全站真接线**：全面替换 `Licenses`、`ErrorAudit`、`SystemHealth`、`OpsAudit`、`Blacklist`、`Overview`、`Login`、`Metrics`、`App`、`Pagination` 等页面的硬编码字符串与动态运行中文提示（包括 promo 校验、IP 未记录、邮件发送状态、Access 说明与故障排查等）为 `$t()`。
  2. **中英双语字典补齐**：`en.ts` 与 `zh.ts` 完整覆盖所有业务字段、弹窗标题、表格列头、操作按钮与状态提示。
  3. **语言切换与持久化**：侧边栏增加「中文 / EN」切换按钮，并在 `localStorage` 中自动持久化。
  4. **双层回退机制**：目标语言缺失时自动降级到中文，全缺失时返回 key 自身。

---

### 🟡 7. 引入 Vitest 自动化单元测试并修复回退测试（已修复）

- **位置**：`package.json`、`src/lib/i18n.test.ts`、`src/lib/audit.test.ts`
- **处理结果**：
  1. 在 `devDependencies` 中配置 `vitest` 并增加 `npm test` 脚本。
  2. 为 `i18n.ts` 编写 5 组针对性单测，包括多语言翻译、参数模板插值（`{page}`, `{maxPage}`）、真实缺失 key 触发的 `zh` 降级回退机制，以及不存在 key 的原始路径兜底。
  3. 提取 `src/lib/audit.ts` 纯函数模块，为审计详情解析（`parseDetails`）与各类动作摘要（`summarizeDetails`）编写 5 组单测。
  4. 运行 `npm test`，全部 10 项测试 100% 通过。

---

### 🟡 8. 抽离共享 UI 组件并在全页面应用（已修复）

- **位置**：`src/components/Modal.svelte`、`src/components/Pagination.svelte`、`src/components/Banner.svelte` 以及所有引用页面
- **处理结果**：
  1. **`Modal.svelte`（完整焦点管理）**：
     - 内置真正的**焦点陷阱 (Focus Trap)**：打开时使用 `requestAnimationFrame` 自动聚焦第一个可聚焦元素，并拦截 `Tab` / `Shift+Tab` 循环锁定在模态框内部。
     - **焦点恢复**：关闭时自动将焦点归还给触发元素（`previouslyFocused.focus()`）。
     - 支持 `Escape` 快捷键全局监听关闭与 ARIA 无障碍属性。
  2. **`Pagination.svelte`（防竞态与区间展示）**：
     - 增加 `loading` 防抖守卫：`disabled={page <= 1 || loading}` / `disabled={page >= maxPage || loading}`，防止加载中重复点击引发竞态。
     - 完整区间信息：显示当前分页条目区间 `(第 {start} - {end} 条，共 {total} 条)`。
     - 完整接入 `$t()` 本地化。
  3. **`Banner.svelte`**：统一 success / error / info 各状态提示条。
  4. **全页面迁移**：包括体量最大的 `Licenses.svelte`（生成授权码、吊销确认、设备解绑 3 个模态框及状态栏）在内的全部页面已 100% 迁移至共享组件，`svelte-check` 0 错误 0 警告。

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
| 14 | 各 Modal | 统一迁移至 `Modal.svelte`，内置焦点陷阱、焦点归还、全局 `Escape` 监听与标准 `role="dialog"` 属性 | ✅ 已修复 |

---

## 六、整改后验证记录

1. **单元测试 (Unit Tests)**：
   ```bash
   npm test (vitest) -> 2 test files, 10 tests passed (100%)
   ```
2. **TypeScript & Svelte 严格诊断**：
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