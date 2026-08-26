# ecbb497 代码审查：接收额度提示 5 秒倒计时自动关闭与 i18n 切换滞后修复

> 审查日期：2026-08-26
> 审查对象：commit `ecbb497` — "Add 5s countdown dismiss to receive quota tip and fix i18n lag"
> 涉及文件：`pkg/pages/upload.tmpl.html`、`pkg/version/version.go`、`.agents/skills/eqt-ux/SKILL.md`
> 版本：v1.36.9 → v1.36.10

## 一、提交概览

改动集中在前端模板 `pkg/pages/upload.tmpl.html`：

1. **接收额度提示 5 秒倒计时自动关闭**：新增 `.quota-tip-wrapper` / `.quota-tip-pill` / `.quota-tip-close` 胶囊样式与 `quota-tip-wrapper` DOM；`updateLimitUI` 在「全体功能额度内（remaining≥1）」时注入倒计时 pill（带 SVG stroke-dash 圆形进度 + 5→0 数字 + `×` 关闭按钮），5 秒后自动 dismiss（300ms 淡出 + `display:none`），且超限红卡（exceeded）出现时不被误隐藏。
2. **修复 i18n 切换滞后**：`applyLanguage()` 新增对 `updateLimitUI(usedTransfers)` 与 `renderFiles()` 的调用，语言切换后配额 badge / banner / 倒计时 pill / 文件列表即刻按新语言重绘（此前文案停留旧语言）。

版本 bump v1.36.9 → v1.36.10（单文件模板行为修改，小版本+1 与仓库约定一致）。

## 二、核心逻辑逐一确认（全部正确）

### 2.1 倒计时状态机（行 1795–1809）

- `startQuotaTipCountdown()` 幂等：先 `clearInterval` 旧 timer、重置 `quotaTipCountdown = 5`；每秒 `-1`，到 0 触发 `dismissQuotaTip`。
- `updateLimitUI` 只在 `!quotaTipTimer` 时才 `startQuotaTipCountdown`（行 1949–1951），因此语言切换 / 输入变化 / 状态轮询等多次调用不会重置或叠加动画。

### 2.2 dismiss 防呆（行 1822–1842）

- dismissed 后置 `quotaTipDismissed = true` + 清 timer；`setTimeout` 300ms 淡出后 `innerHTML = ''`。
- 关键保护：淡出回调内再校验 `!bannerEl.querySelector('.quota-banner-card.exceeded')` —— 若淡出期间状态切到超限红卡，不隐藏，红卡保留。✓

### 2.3 exceeded 与 tip 互斥（行 1884–1954）

- 超限组合（both / files / size）→ 红卡直接 `display:block` 覆盖 tip；`isLimitActive`（次数已耗尽且当前文件不超标）→ 空 banner 不打扰；`quotaTipDismissed` → 保持隐藏；否则 → 显示 pill。
- **语言切换后状态不漂移**：dismissed → 行 1916 保持隐藏；isLimitActive → 行 1911 保持隐藏；额度内 → `tipWrapper` 存在则就地更新 `textContent`（行 1921–1927，倒计时动画不中断），不存在则重建。✓

### 2.4 i18n 滞后修复正确

- `applyLanguage`（行 899–904）重绘 quota banner + 文件列表：badge 与 tip 文案经 `t()` 取当前语言；`renderFiles()` 重建文件列表（读 `accumulatedFiles` 全局数组，**不重置数据**；`isUploading` 时早退不打断上传）。
- `updateLimitUI` 内 `oldTransfers !== usedTransfers` 才二次 `renderFiles`（行 1853），applyLanguage 传入同值跳过，无重复渲染。✓
- `renderFiles` 不反向调用 `updateLimitUI`，无渲染循环。✓

### 2.5 事件绑定合规

- `×` 按钮用 `addEventListener('click', dismissQuotaTip)` 注册（非内联 onclick，符合 CLAUDE.md 规范）；每次注入均为全新按钮节点，重建不会叠加旧监听。✓

## 三、发现项（均为低优先，无功能缺陷）

| 编号 | 发现 | 严重度 | 说明 |
| :--- | :--- | :--- | :--- |
| A | **首次注入瞬时 NaN**：`quotaTipCountdown` 的 `var` 声明在行 1791，而首次 `applyLanguage()` 在行 1788 先执行——首次走到注入分支时 `quotaTipCountdown` 仍为 `undefined`（var 提升），innerHTML 中 `stroke-dashoffset = 53.4*(1-undefined/5) = NaN`、`#quota-tip-num` 文本为 `undefined`。依赖紧随的 `startQuotaTipCountdown()`（行 1949，同一同步调用栈内）立即重置为 5 并 `renderQuotaTipCountdown()` 改写为 `"0"`/`"5"`——分析器在同步块结束后才 paint，**无可见影响** | 低（代码异味） | 建议注入字符串直接用 `0`/`5` 字面量，或注入前先 `quotaTipCountdown = 5;`，消除「注入非法态再同步修复」的脆弱依赖；若未来将初始化改为异步，将暴露 NaN |
| B | **`span > div` 非合规嵌套**：`.quota-tip-pill` 为 `<span>`，内嵌块级 `<div class="countdown-circle-container">`（inline style `display:flex`）。浏览器实测容错保留（见第四节），运行时无 bug；但违反 HTML content model，W3C validator 报 non-conforming，合规/无障碍扫描会告警 | 低（合规） | 建议内层 div 改 `<span style="display:inline-flex; …">`（span 内全为 phrasing content），或外层 pill 改 `<div>` |
| C | **关闭按钮 `title="Dismiss"` 硬编码英文**，语言切换不跟随 | 低（i18n 缺口） | 建议走 data-i18n 或 applyLanguage 中同步设置 |

另：语言切换与 `updateDraftState`（行 1100）/ 粘贴校验（行 1362）/ 状态轮询（行 2019）都会触发 `updateLimitUI` → tip 文案同值就地重写，开销可忽略，无实际问题，不需要修复。

## 四、浏览器实测（HTML fragment 解析）

在 Chrome（chrome-devtools-mcp）空白容器注入与生产完全一致的 innerHTML 字符串：

```
wrapperChildren: ["SPAN.quota-tip-pill"]   ← div 未把 span 挤出，仍是 span 的直接子节点
pillChildCount : 3                          ← countdown-circle / text / close 均在 span 内
```

结论：发现项 B 无实盘影响。所有主流浏览器遵循同一 HTML5 片段解析规范，行为一致，不会出现胶囊样式丢失。

## 五、验证命令

```sh
go build ./...               # Go 侧模板/代码无编译回归
go test ./pkg/chat/v2/...    # 后端思路不受本前端模板改动影响
```

（前端模板无自动化单元测试；`.agents/skills/eqt-ux/SKILL.md` 已在提交中同步新增 quota tip 的 E2E 检查指引，提交经 `/chrome-test` 模拟验证。）

## 六、结论

本次提交功能正确：倒计时自动关闭、exceeded 防呆、i18n 切换重绘三处逻辑经逐行推演与浏览器实测均符合预期，**无功能性缺陷**。三项低优先建议（A 瞬时 NaN 注入 / B span>div 合规 / C title 硬编码）不影响运行，可择机在后续模板改动中顺手修正，无需回退或立即热修。

---

## 七、修复核验与闭环（2026-08-26，commit 5da651c）

> 同日提交 `5da651c` "Fix quota tip DOM nesting, i18n title, and init var ordering"（版本保持 v1.36.10，未递增）针对上文第三节的 A/B/C 三项发现逐一修复。复核查验如下。

### 7.1 三项发现全部闭环

| 上轮发现 | 修复状态 | 核验 |
| :--- | :--- | :--- |
| A. 首次注入瞬时 NaN（`quotaTipCountdown` 声明晚于首次 `applyLanguage()`） | ✅ 已修 | 将 `restoreDraft(); applyLanguage(); resizeTextArea();` 整体下移至 `var quotaTipCountdown = 5` 赋值与 `function updateLimitUI` 声明之后（当前行 1847–1849，`rg` 实测）；首次 `applyLanguage()` 执行时 `quotaTipCountdown` 已是 5，注入的 `stroke-dashoffset` 直接为 `0`、`#quota-tip-num` 为 `5`。浏览器实测 `strokeDashoffset="0"`、`numText="5"`，无 NaN。**且 `restoreDraft → applyLanguage` 相对顺序保持不变**（先恢复草稿、应用再 `renderFiles`，避免恢复内容漏渲染），无回归 |
| B. `span > div` 非合规嵌套 | ✅ 已修 | 外层 `.quota-tip-pill` 由 `<span>` 改 `<div>`，内层 `.countdown-circle-container` 由 `<div style="display:flex">` 改 `<span style="display:inline-flex">`。浏览器实测最终 DOM 为 `DIV.quota-tip-pill > [SPAN.countdown-circle-container, SPAN#quota-tip-text, BUTTON#quota-tip-close]`，全为合法 flow/phrasing 结构，validator 不再报 non-conforming；CSS 按类匹配，胶囊样式不受标签类型影响 |
| C. 关闭按钮 `title="Dismiss"` 硬编码英文 | ✅ 已修 | 新增 `btn_dismiss` 键并补齐 zh/en/ja/ko/es/de/fr 共 7 语言（`rg -c` 实测 7/7，与 `btn_retry` 语言集一致）；注入时 `title`/`aria-label` 均写入 `dismissText`，就地更新分支同步 `setAttribute`；`t('btn_dismiss') || 'Dismiss'` 兜底防空。浏览器实测 `closeTitle="关闭"`、`closeAria="关闭"` |

### 7.2 新审查观察（信息项，无需修改）

- **版本号未递增**：`5da651c` 保持 v1.36.10。属 UI 结构/文案行为修复，patch 递增在项目惯例中为可选，无强制。
- **`dismissText` 属性注入无转义**：`title`/`aria-label` 直接拼接 `dismissText`。内容来源为受控 i18n 字典固定字面量（七语言值均无双引号/尖括号），无注入路径；若未来引入用户自定义文案则需补 HTML 转义，当前无需。
- **init 依赖成立**：`accumulatedFiles`(996)/`selectedFileContainer`(1002)/`errorBox`(1004)/`submitButton`(998)/`isUploading`(1053) 等 top-level 变量均先行初始化于 1847 的初始调用，`restoreDraft`/`saveDraft`/`resizeTextArea`/`updateLimitUI`/`renderFiles` 均为函数声明（提升），时序无缺口。

### 7.3 终态确认

- 上轮全部发现项（A/B/C）100% 闭环，修复未引入回归：init 顺序依赖、`restoreDraft → applyLanguage` 相对顺序、CSS 类选择器均核验无损。
- 浏览器实测（chrome-devtools-mcp）最终 DOM 结构合法、初始状态无 NaN、i18n 生效。
- 审查结论：修复完全闭环，无遗留缺陷。