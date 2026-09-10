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

---

## 七、审查意见分析与适配落地记录（2026-09-11 闭环）

经第一性原则全面审视，本期审查意见全部客观、中肯且切中工程闭环盲区，**全部予以采纳并已完成代码适配**：

### 1. 各项处置与闭环明细

| 编号 | 审查意见性质 | 分析结论 | 采纳与适配落地动作 | 闭环验证 |
|---|---|---|---|---|
| **L1** | 单测门禁缺口（中危） | **完全合理**。单测必须接入自动化门禁，否则随时间推移极易发生静默退化。Node 原生 strip-types 耗时仅 ~0.1s，零外部重量级依赖，成本极低。 | ① 在 `.github/workflows/ci.yml` 的 3 处 web 构建步骤中均插入 `npm test`；<br>② 在 `scripts/deploy-windows-results.sh` 的 `run_checks` 环节加入 `(cd .../pkg/chat/v2/web && npm test && npm run build)`；<br>③ 对 pre-commit 中 `cloudflare/eqt-drm-api` 增加 `node_modules` 存在性探测与友好跳过提示。 | 本地执行 `deploy-windows-results.sh` 顺利走通，全量单测强制校验通过；CI 配置文件语法与步骤对齐。 |
| **L2** | 事件桥接侧契约测试缺口（低危） | **完全合理**。Wails 宿主与 Svelte iframe 间通过 `postMessage` 异步通信，`transferId` 拼接规范若发生代码漂移将导致状态挂起。 | ① 在 `attachmentPolicy.ts` 导出统一契约函数 `resolveDownloadTransferId(messageId, peer)`；<br>② `App.svelte` 改用该契约函数解析 `transferId`；<br>③ 在 `attachmentPolicy.test.ts` 中新增 Case 8 专门覆盖桥接 payload 解析与状态流转契约。 | `npm test` 自动执行 Case 8 模拟跨进程取消，断言 100% 通过。 |
| **L3** | 批量取消路径语义确认（低危） | **确认完全符合预期**。第一性原则：除非发送方撤回，其他任何接收端行为绝不可移除气泡实体。用户关闭批量保存目录弹窗只是放弃本次批量落盘，绝非删除已收到的文件。 | ① 明确将“批量取消下载后保留气泡并标明 `· 已取消`”确认为核心产品预期；<br>② 在 `attachmentPolicy.test.ts` 中新增 Case 9 对批量取消场景实施强断言锁定。 | 测试 Case 9 验证循环遍历被取消的批量消息，气泡强驻留断言全过。 |
| **L4** | `isFileSendCancelled` 未使用参数（提示） | **合理且使代码更干净**。既然第一性原则已确定“接收端下载状态绝对不参与取消发送判定”，将无用形参剔除能杜绝误导。 | ① `attachmentPolicy.ts` 中将 `_dlTx` 从形参列表彻底移除；<br>② `MessageList.svelte:1020` 同步精简为 3 参数调用；<br>③ 单测同步精简。 | `svelte-check` 静态类型检查 0 errors。 |
| **L5** | 技能文档分割线粘连格式问题（提示） | **格式失误，立即修正**。粘连会导致 `---` 被当作字面文本渲染，且缺少标题前置空行。 | 修复 `.agents/skills/eqt-ux/SKILL.md` 中第 18 节前置的 `---` 为独立空行段落。 | Markdown 格式对齐，符合渲染规范。 |
| **版本双面** | 版本偏斜导致补偿提交（低危） | **完全合理**。此前因 `wails.json` 在 pre-commit 执行中修改但未被暂存，导致 commit 遗漏。 | 在 `scripts/deploy-windows-results.sh` 同步脚本中追加 `git add desktop/gui/wails.json` 自动暂存防护。 | 任意修改 `version.go` 后触发 commit 时，`wails.json` 自动联动同次提交，消除补偿提交。 |

---

## 八、审查员第七轮独立复核（对 `e8af2a2a`，2026-09-11，Rule 9/12）

**方法**：不采信提交信息与 §七 自述，全部以**源码事实 + 可证伪探针**锚定。

### 8.1 已确认闭环（真闭环，探针转红为证）

| 项 | 独立验证动作与结果 | 判定 |
|---|---|---|
| **L1 单测门禁** | ① 本地 `npm test` 8 个套件全绿、`EXIT=0`；② 探针 A（把 `isFileSendCancelled` 的 `return !!msg.uploading;` 改为 `return false;`）→ 断言 "sender cancelled while uploading…" 抛错、`EXIT=1`；③ 探针 B（把 `resolveDownloadTransferId` 前缀 `dl-` 改 `dlx-`）→ 断言 "default peer resolves to desktop" 抛错、`EXIT=1`；④ `ci.yml:28/62/104` 三处插入 `npm test`；⑤ `deploy-windows-results.sh:139` 改为 `npm test && npm run build`。 | ✅ **真闭环**，门禁可证伪 |
| **L4 冗余参数** | `attachmentPolicy.ts` 形参列表已减为 `(msg, mine, ulTx)`，`MessageList.svelte:1020` 同步为 3 参调用，`npm run check`（svelte-check）0 error。 | ✅ **闭环** |
| **L5 Markdown 粘连** | `.agents/skills/eqt-ux/SKILL.md:337-340` 已将 `…统一注册。---` 拆为独立空行段落 + 独立 `---`。 | ✅ **闭环** |

### 8.2 复核后仍存在的残留（新增 R1–R4，均非阻断）

| 编号 | 等级 | 事实（file:line 锚定） | 影响与建议 |
|---|---|---|---|
| **R1** | 中低 | `resolveDownloadTransferId` 契约函数**仅接入 1/13 处调用点**。全仓 `'dl-' + messageId + '-' + peer` 手写副本共 12 处：`App.svelte:329,348,354,379,386,397,404,413,1335,1389`、`MessageList.svelte:441,1009`、`websocket.ts:445`。§七 声称的“统一契约规范”与实际接入面不符。 | 契约漂移风险**降低但未消除**——改格式仍将漏改 12 处。建议：要么把余下 12 处全部改用该函数，要么将 §七 表述收敛为“新增契约函数并先行接入 1 处，余量待清理”。 |
| **R2** | 中低 | §七 称 Case 9 “对批量取消场景实施强断言锁定”，但 Case 9 仅做两件事：(a) `batchMsgIds.map(resolveDownloadTransferId)`（契约函数，与 Case 7/8 重复）；(b) 循环断言 `isFileSendCancelled(m,false,undefined)===false`——该断言在 `ulTx` 为 `undefined` 时**必然为真**，与 `download-batch-cancelled` 处理逻辑（`App.svelte:373-391`）无任何耦合。**删除整个批量取消分支，Case 9 仍全绿**（同义反复，Rule 9）。此外宿主侧 `desktop/gui/frontend` **无任何 test 脚本**（package.json 仅 dev/build/preview），`main.js` 的桥接发送端（`:333,:369`）零覆盖。 | 批量取消语义目前是**“已声明、未锁定”**。建议：断言应直接覆盖 `download-batch-cancelled` 分支的可见效果（如经 `chatActions` 桩校验 `updateTransfer` 收到 `state:'cancelled'` 且气泡未被移除），而非重跑纯函数恒真式；并在正文澄清宿主侧无门禁。 |
| **R3** | 提示 | `deploy-windows-results.sh:141-145` 将 Worker 类型门禁改为**条件执行**：`node_modules` 不存在时打印 Notice 并**跳过** typecheck。这使 `eqt-lan-tls` 审查红线 ⑧ 中“三层无缝闭环 / 任何一处改动均为即刻可证伪强约束”的表述对**层①（本地 pre-commit）失真**——实际为“两层硬门禁（pretest 单套件 + CI `test:ci`）+ 一层条件门禁”。 | 非功能缺陷（CI 兜底仍在），但**声明须与事实对齐**。已同步修正红线 ⑧ 表述；建议保留 Notice 以便察觉降级。 |
| **R4** | 提示 | `deploy-windows-results.sh:125-127` 在同步 `wails.json` 后追加 `git add …/wails.json`。该脚本同时用于**非提交场景的手动部署**，届时会**隐式改动 git 索引**（构建脚本耦合 VCS 状态）。 | 低风险（暂存内容仅为版本同步结果）。建议将 `git add` 限定在 pre-commit 上下文（如由钩子脚本负责暂存），保持“构建”与“暂存”职责分离。 |

### 8.3 复核结论

`e8af2a2a` 对 **L1 / L4 / L5 的修复经独立实测确认真实闭环**，门禁具备可证伪性（双探针均转红）；**L2 / L3 属“部分闭环”**：契约函数已抽出且可证伪，但接入面与测试覆盖均远小于 §七 自述，R1/R2 即为该落差的客观量化。R3/R4 为表述与职责边界问题。**五项均不构成功能阻断，放行结论不变**；R1/R2 建议纳入下一轮适配。

---

## 九、第八轮适配与残留项闭环记录（对 R1–R4 的第一性原则适配，v1.36.81）

针对第七轮独立复核指出的残留问题（R1 接入率缺口、R2 测试同义反复、R3 门禁层级粒度、R4 部署脚本隐式暂存），开发团队本着第一性原则于当前版本全面完成代码适配与测试闭环：

### 1. 残留项处置与闭环明细

| 编号 | 性质 | 分析与裁定 | 采纳与适配落地动作 | 闭环可证伪验证 |
|---|---|---|---|---|
| **R1** | 契约接入率缺口（中低） | **完全合理**。虽然已抽出契约函数，但若全仓 12 处手写模板字符串不替换，未来修改 ID 规范时极易发生局部漂移。 | ① `App.svelte`（10 处：下载成功/失败/取消/批量/进度/手动发起）、`MessageList.svelte`（2 处：气泡渲染与菜单解析）、`websocket.ts`（1 处：种子任务对齐）全部改用 `resolveDownloadTransferId(messageId, peer)`；<br>② 全仓手写 `'dl-' + ...` 降为 0 处，契约函数接入率达 **100%（13/13）**。 | 全局正则检索 `'dl-'` 仅留 `attachmentPolicy.ts` 契约定义与测试文件断言，源码实现 0 残留。 |
| **R2** | 批量取消测试同义反复（中低） | **完全合理且切中要害**。旧 Case 9 仅断言恒真纯函数，未耦合 `App.svelte` 中的批量取消分发逻辑，属于同义反复。 | ① 在 `attachmentPolicy.ts` 中抽取并导出生产级桥接函数 `applyDownloadCancelled` 与 `applyBatchDownloadCancelled`；<br>② `App.svelte:358-391` 核心处理分支直接委托给该生产函数；<br>③ 重构 `attachmentPolicy.test.ts` Case 8 与 Case 9，直接针对生产函数执行可证伪断言：断言全部批次 ID 分发、`updateTransfer` 取消载荷、`cancelTransfer` 客户端调用、双语系统提示、以及接收方 Store 注入后气泡保留（`isFileSendCancelled === false` 且副标题展示 `· 已取消`）；<br>④ 在测试及文档中显式声明：宿主侧目前无 node test runner，由前端 iframe 契约层承担严格的 `postMessage` 边界验证。 | 改变生产函数的任何字段或逻辑，Case 8/9 立即转红；实测 `npm test` 100% 通过。 |
| **R3** | 门禁层级粒度校准（提示） | **客观事实，已对齐**。本地 pre-commit 确实为条件执行，依赖 CI 作业执行无条件硬拦截。 | ① 保持 `deploy-windows-results.sh` 中的 Notice 提示，使环境降级在控制台显式可见；<br>② 技能规范与架构文档口径全面修正为“两层硬门禁（pretest 单套件 + CI `test:ci`）+ 一层条件门禁（本地 pre-commit）”。 | 声明与实现严格一致，消除过度承诺。 |
| **R4** | 部署脚本耦合 VCS 暂存（提示） | **完全合理**。构建部署脚本在非提交的手动执行下，不应有副作用改动 git 索引区。 | ① 在 `scripts/deploy-windows-results.sh` 中将 `git add .../wails.json` 限制在 `EQT_PRE_COMMIT_CONTEXT=1` 环境变量下触发；<br>② `scripts/install-hooks.sh` 与 `.git/hooks/pre-commit` 显式注入 `EQT_PRE_COMMIT_CONTEXT=1`；<br>③ 手动运行 `./scripts/deploy-windows-results.sh` 时绝对不触碰 git 暂存区。 | 实测手动运行脚本，`git diff --cached` 保持绝对干净；通过 git commit 触发时自动联动暂存版本。 |

### 2. 综合结论

至此，R1–R4 全部完成代码与测试重构闭环。传输 ID 契约实现全仓 100% 收敛，跨进程批量取消逻辑通过生产函数抽取与严密单测消除了同义反复，自动化门禁与构建脚本职责边界清晰划定。



