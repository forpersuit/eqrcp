# 提交审查：聊天附件气泡保留策略与 Worker 类型门禁三层接线

> **审查日期**：2026-09-11
> **文档位置**：`docs/bugs/2026-09-11-review-attachment-policy-and-typecheck-gates.md`
> **审查范围**：`b22cd102`（Worker typecheck 三层接线）、`1930ad84`（下载取消与气泡保留解耦）、`518163f2`（版本号同步）
> **审查方法**：不采信提交信息，全部结论以**可证伪实验 + 源码事实**锚定（Rule 9/12）

---

## 一、结论摘要

| 提交 | 结论 | 依据 |
|---|---|---|
| `b22cd102` 类型门禁三层接线 | ✅ **真实生效，验证通过** | 注入 TS 错误实测 `pretest` 钩子拦截（`TS2322`，exit 2） |
| `1930ad84` 下载取消解耦 | ✅ **修复语义正确**（消除了将"接收方本地取消下载"误判为"发送方撤回"的真实缺陷） | `MessageList.svelte:1115` 渲染分支事实 |
| `518163f2` 版本同步 | ⚠️ **补偿性提交**，暴露出前序提交的版本偏斜 | 见 §四 |

**新发现 5 项**（L1 中危 / L2 低危 / L3 低危 / L4 提示 / L5 提示），**无阻断性缺陷**，不推翻既有放行结论。

---

## 二、`b22cd102` 复核：类型门禁是否真的生效（重点）

提交声称实现"本地 pre-commit + 单套件 pretest + 远端 CI"三层门禁闭环。**唯独门禁类声明必须实测其触发**（否则等同 `package.json` 里的装饰性脚本），故逐层验证：

### 1. 单套件 `pretest` 钩子 —— ✅ 实测触发

`cloudflare/eqt-drm-api/package.json` 新增：

```json
"pretest:cert:offline": "npm run typecheck",
"pretest:acme:offline": "npm run typecheck",
```

**可证伪实验**：向 `src/routes/cert.ts` 尾部注入 `const __typecheck_probe: number = "str";`，执行 `npm run test:cert:offline`：

```text
> eqt-drm-api@1.11.0 pretest:cert:offline
> npm run typecheck
> tsc --noEmit
src/routes/cert.ts(983,7): error TS2322: Type 'string' is not assignable to type 'number'.
exit=2
```

即：**类型检查先于 esbuild/用例执行**，符合 npm 生命周期语义，声明属实。（实验后已还原，`git diff --stat` 为空。）

### 2. 本地 pre-commit —— ✅ 接线成立

- `.git/hooks/pre-commit` 无条件调用 `scripts/deploy-windows-results.sh`（无参数 → `run_checks=1`）；
- 该脚本 `:137-138` 在 `run_checks` 分支内新增 `(cd "$root_dir/cloudflare/eqt-drm-api" && npm run typecheck)`；
- 脚本 `set -euo pipefail`，`tsc` 非零退出将中止提交。

**注意（既有约束，非本次引入）**：该分支**要求 `cloudflare/eqt-drm-api/node_modules` 已安装**，否则 `tsc: not found` 同样以非零退出阻断提交。此与脚本中既有的 `desktop/gui/frontend`、`pkg/chat/v2/web` 两个 `npm run build` 步骤前提一致，不构成新的问题类别，但会使**未执行过 `npm ci` 的纯 Go 贡献者首次提交被拦**——建议在脚本内对缺失 `node_modules` 给出明确提示而非裸报错。

### 3. 远端 CI —— ✅ 早已成立

`.github/workflows/ci.yml:142` 的 `drm-api-test` 作业执行 `npm run test:ci`，其链首即 `typecheck`（该作业早于本次提交存在）。

**判定**：三层门禁**均真实触发**，`b22cd102` 属**已验证闭环**，非文档自述。

---

## 三、`1930ad84` 审查：气泡保留解耦

### 1. 被修复的真实缺陷（已确认）

旧判定 `MessageList.svelte` 内联表达式：

```js
const isCancelledFile = (file|image) && ((ulTx && ulTx.state==='cancelled') || (dlTx && dlTx.state==='cancelled'))
```

而 `isCancelledFile=true` 会走到 `MessageList.svelte:1115` 分支，**把整个文件气泡替换为** `cancelSendYou / cancelSendOther`（"'XX' 取消了发送"）文本。因此旧逻辑下，**接收方仅仅在本地取消了一次下载（或关闭保存对话框、批量取消）**，界面就会谎报为"发送方撤回了发送"——这是真实且违背直觉的缺陷。本次以 `isFileSendCancelled()` 收敛为**仅上传态取消**才判定，修复方向正确。

改后：`dlTx.state==='cancelled'` 落到 `:1179` 的副标题分支，气泡**完整保留**并显示"· 已取消"。符合 `attachmentPolicy.ts` 声明的保留原则。

### 2. 决策函数逻辑复核

`isFileSendCancelled(msg, mine, ulTx, _dlTx)` 分支：

- `text` 类型 → `false`；`msg.recalled` → `false`（交由 recalled 通道）；
- `ulTx.state==='cancelled'`：发送方 → `!!msg.uploading`；接收方 → `true`；
- 其余（含 `dlTx` 任意状态）→ `false`。

逻辑自洽。测试 `attachmentPolicy.test.ts` 的 7 条断言**对核心变更可证伪**——若回退为旧的"或"语义，case 2/3 立即转红。已实跑：`node --experimental-strip-types src/services/attachmentPolicy.test.ts` → **all assertions passed**（exit 0）。

---

## 四、发现清单

### L1（中危 · 验证缺口）：新增单测未接入任何自动化门禁

`attachmentPolicy.test.ts` 已加入 `pkg/chat/v2/web/package.json` 的 `test` 脚本链，但**没有任何自动化流程执行 `npm test`**：

- `ci.yml` 三处 web 作业（`:25/:28-29`、`:58/:61-62`、`:99/:102-103`）均为 `npm ci && npm run check && npm run build`——**只做类型检查与构建，从不跑单测**；
- `scripts/deploy-windows-results.sh:136`（pre-commit 路径）同样只有 `npm run build`。

**后果**：该文件（连同既有 7 个 web 单测：`visibilityPolicy`、`resumeConnection`、`reconnectSeq`、`uploadPolicy`、`composerKey`、`systemNotice`、`mediaPreview`）**仅在开发者手动执行 `npm test` 时才运行**，自动化回归防护为零。

**性质**：这是**既有缺口**（前 7 个文件本就未被门禁覆盖），本提交新增第 8 个文件，延续并扩大之，**非本提交引入的回归**。

**建议**：在 `ci.yml` 的 web 作业（或 `deploy-windows-results.sh` 对应位置）追加 `npm test`。考虑到 `package.json` 已把 `npm test` 明确列为校验入口，接线成本极低。

### L2（低危 · 覆盖缺口）：行为改动的"事件桥接侧"无测试

本次实际改动含三处，测试仅覆盖其一：

| 文件 | 改动 | 测试覆盖 |
|---|---|---|
| `MessageList.svelte:1020` | 内联表达式 → `isFileSendCancelled()` | ✅ 纯函数被 case 1–7 覆盖 |
| `App.svelte:357-368` | 新增 `download-cancelled` 消息处理 | ❌ 无 |
| `main.js:330-335` | 保存对话框取消时回传 `download-cancelled` | ❌ 无 |

后两处为**跨进程消息桥接**（Wails 宿主 ↔ chat iframe），恰是最易随重构漂移的部分（`transferId` 拼接格式 `'dl-' + messageId + '-' + peer` 与 `client['clientPeer']` 取值需两端严格一致），建议后续以 E2E 或契约测试补足。

### L3（低危 · 副作用未在提交说明中声明）：批量取消路径的 UI 语义被动改变

`App.svelte` 既有的 `download-batch-cancelled` 处理同样将 `dlTx` 置为 `cancelled`。在**旧**判定下，这会令 `isCancelledFile=true`，气泡被替换为"XX 取消了发送"；在**新**策略下，该类气泡改为**保留**并显示"· 已取消"。

- 该变化与新的保留原则一致，**大概率是期望行为**；
- 但它属于**批量取消流程的可见 UI 变更**，提交信息只提"receiver download cancellation"，未点明批量路径；且 L2 指出该路径无测试。
- **建议**：确认批量取消后"保留气泡+已取消副标题"符合产品预期。

### L4（提示 · 非缺陷）：`isFileSendCancelled` 保留未使用参数 `_dlTx`

函数签名接收 `_dlTx` 但**永不使用**，仅注释说明"绝不可用于取消发送判定"。此系**刻意的防误用护栏**，可理解；但会让静态检查报未使用参数，且易误导读者以为下载状态参与判定。可考虑删除该参数（调用侧同步少传一个实参），防护力已由测试 case 2/3 承担。

### L5（提示 · 文档格式）：`eqt-ux` 技能的水平分割线被并入上一行

`1930ad84` 在 `.agents/skills/eqt-ux/SKILL.md` 新增第 18 节时，将分隔线 `---` 直接**粘连到上一行行尾**，且删去了原有空行：

```text
  - **合规标准**：自包含纯函数转义（……），多语言在 `i18n.js` 中统一注册。---
```

后果：`---` 不再是独立行的水平分割线，而作为字面文本渲染在句末；且 `## 18.` 标题前缺空行。建议还原为独立 `---` 行并补空行（`markdownlint` 的 `MD022`/`MD035` 类规则会报此问题）。

---

## 五、版本一致性核对

| 提交 | `pkg/version/version.go` | `desktop/gui/wails.json` | 一致性 |
|---|---|---|---|
| `b22cd102` | `v1.36.79` | `1.36.79` | ✅ |
| `1930ad84` | `v1.36.80` | `1.36.79`（未同步） | ❌ **偏斜** |
| `518163f2` | `v1.36.80` | `1.36.80` | ✅ |

**终态一致**，但 `1930ad84` 单独抬升了运行时版本面 `version.go` 而遗漏 GUI/安装包元数据面 `wails.json`，靠**下游补偿提交** `518163f2` 才对齐——期间若从该 commit 出包，GUI 显示版本与运行时版本将不符。

- **建议**：将两个版本面纳入同一提交或脚本化同步（`wails.json` 的 `productVersion` 无 `v` 前缀，`version.go` 有，易漏）。
- 另：`pkg/chat/v2/web/package.json`、`desktop/gui/frontend/package.json` 恒为 `0.0.0`（设计上不参与版本管理），无需同步。

---

## 六、处置建议汇总

| 编号 | 级别 | 建议动作 |
|---|---|---|
| L1 | 中危 | CI web 作业 / pre-commit 追加 `npm test`，让 8 个 web 单测真正进入门禁 |
| L2 | 低危 | 为 `download-cancelled` 事件桥接补契约或 E2E 测试 |
| L3 | 低危 | 确认批量取消的"保留气泡+已取消"为期望行为，并在提交说明中显式声明 |
| L4 | 提示 | 视情况移除 `_dlTx` 参数 |
| L5 | 提示 | 修复 `.agents/skills/eqt-ux/SKILL.md` 中与句尾粘连的 `---` 及缺失空行 |
| — | 低危 | 版本号双面（`version.go` / `wails.json`）scripted 同步，避免补偿提交 |

**总体判定**：`1930ad84` 修复真实缺陷且逻辑正确；`b22cd102` 的类型门禁三层接线**经实测确认真实生效**。上述 4 项均为**验证完备性与流程一致性**问题，**不构成功能阻断**，可择机处置。
