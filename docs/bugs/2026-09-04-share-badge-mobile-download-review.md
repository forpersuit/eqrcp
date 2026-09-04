# 762c188b 代码审查：share 摘要徽章与移动端息屏恢复 / Edge 落盘修复

> 状态：🔄 待跟进（Open）—— 本次审查已完成，3 项建议（1 中 2 低）待后续修复闭环
>
> 审查日期：2026-09-04
> 审查对象：commit `762c188b` — "feat(share): show file count and total size badge in share stage and fix mobile download wake-up"
> 涉及文件：`pkg/pages/download.tmpl.html`、`pkg/server/util.go`、`pkg/server/util_test.go`、`pkg/server/server.go`、`desktop/gui/frontend/src/main.js`、`desktop/gui/frontend/src/i18n.js`、`desktop/gui/app.go`、`desktop/gui/app_test.go`、`desktop/gui/telemetry_e2e_test.go`
> 版本：v1.36.34 → v1.36.35（feat，升版合规）
> 审查背景：HEAD 上另含两个中间提交 `04ec12c5`（锁序收敛：hoist statusMu 读、统一 statusMu→clientStatesMu→clientMutex）与 `4b4dda42`（EnableTLS 默认开），后者不在本轮范围；前者经 `-race` 全绿实证闭环。

## 一、 提交概览

提交针对三项诉求：

1. **移动端息屏恢复**（`pkg/pages/download.tmpl.html`）：息屏/后台期间浏览器挂起定时器与在途请求，导致数据传完但接收页进度停在息屏前状态 → 新增 `visibilitychange` / `pageshow` / `focus` 唤醒监听，恢复可见时强制 `pollStatus(true)`；`showCompletedUI` 补全字节（total/total）与完成态文案；服务端 autoStop 关闭后 `/status` 连不上时由轮询失败收敛到完成 UI。
2. **Edge 移动浏览器下载落盘**（`pkg/pages/download.tmpl.html` + `pkg/server/util.go` + `server.go`）：隐藏 `<iframe>` 承载下载后 3s 销毁会在宿主 frame 销毁时向网络栈发 Abort、掐断落盘 → 改为顶级 `<a download>` 模拟点击；`Content-Disposition` 的 `filename*=` 由 `url.PathEscape` 改为严格 RFC 5987 编码（attr-char 白名单逐字节 `%XX`），`filename=` 回退值改由 `sanitizeASCIIFilename` 纯 ASCII 化，并补 `X-Content-Type-Options: nosniff`。
3. **share 徽章**（`desktop/gui/frontend/src/main.js` + `i18n.js`）：renderShare 在"开始分享"旁展示文件总数与总大小徽章；`GetFileInfos` 后端经 `GUIFileInfo.SizeBytes`（app.go）下发目录递归求和；6 语种新增 `share_total_summary` / `share_total_count_only`。

## 二、 逐项根因核验（复核结论）

### (A) 息屏进度不走完 —— 根因判断成立，修复对症

移动浏览器（尤其 iOS Safari / Android 冻结策略）在息屏/后台会挂起 `setInterval`，且在途 `/status` XHR 被冻结后回调不再触发。原代码 `isRequestInProgress` 门闩会因此在冻结请求上永远为真，后续轮询全部短路 —— 这正是"数据传完、界面停在息屏前"的直接机制。新代码三重解除：

- 唤醒监听（`visibilitychange` visible + `pageshow` + `focus`）时立即 `pollStatus(true)`，**旁路 `isRequestInProgress` 门闩**，是解开死锁的关键；
- `showCompletedUI` 将字节显示置为 `total / total`、状态文案置为完成（不只拉满进度条而残留旧值）；
- 对服务端已 autoStop 关闭、`/status` 不可达的收尾，以错误收敛到完成 UI。

合理且对症，未破坏正常轮询路径。

### (B) Edge 移动下载不落盘 —— 根因判断成立，是针对性的正确修复

- 隐藏 `<iframe>` + 3s `removeChild` 在 Chromium/Edge mobile 会 abort 下载（SKILL §12 已记录），改顶级 `<a download>` 点击后由 OS 下载管理器接管，正确。
- `url.PathEscape` 不是 RFC 6266/5987 允许的编码（会残留未转义字符），严苛解析器（Edge mobile）可丢弃响应或损坏文件名；`rfc5987PercentEncode` 逐字节白名单编码、`filename=` 纯 ASCII 回退 + nosniff 均是正确补强。
- `util_test` 新增 `TestContentDispositionNonASCII`（`测试 报告.zip`）精确锁定该行为。

### (C) share 徽章 —— 数据链路齐备，实现符合工程规范

- `renderShare` 对 `state.sharePaths` 纯读局部求和（Σ `sizeBytes`），**不违反"render 不改 state"**；
- 后端 `GUIFileInfo.SizeBytes` 存在、目录经 `WalkDir` 递归求和，主拖入/选取路径（`addSharePaths` → `GetFileInfos`）真实可显示；
- `t(key, params)` 的 `{count}` / `{size}` 插值受支持（i18n.js:3031），6 语种齐全；
- feat → v1.36.35 在 `version.go` / `wails.json` / 两处测试断言三处一致，升版合规。

## 三、 复核发现（3 项：1 中 + 2 低）

### 1.【中】轮询失败后的"乐观完成"判定过度敏感：真实中断可能被误报为"已完成 ✓100%"

`downloadTriggered` 后任何一次 `/status` 非 200/410（含网络错误）都向完成态收敛：

- 非唤醒轮询 `consecutiveErrors >= 2` 即 `showCompletedUI`，唤醒路径 `isWakeup` **单次失败即触发**；
- 同一网络失败会经 `readystatechange`（readyState 4、status 0 落入 else 分支）+ `onerror` **各计数一次**，实际单次失败即可能达阈值；
- 页面同时存在面向真实中断的 `waiting` + "等待重连/重试"恢复机制（服务端存活时 `/status` 返回 200 state=waiting 可恢复）；但当接收端短暂断网（WiFi 漫游/切换）导致 `/status` 连不上时，1~2 次失败即 `isCompleted=true`、停轮询、隐藏重试按钮并渲染 ✓100% —— 文件实际未落盘，用户只能整页刷新才可能重试；
- 旧实现阈值 5（约 6s），误报窗口小得多。本提交为适配"服务端 autoStop 关闭后 `/status` 连不上即视为传完"的息屏场景，把代价转嫁为真实中断的误报；
- 另：重构后 XHR 未设 `xhr.timeout`，在途请求若既不回调也不报错（TCP 黑洞），`isRequestInProgress` 门闩会让后续可见态轮询持续短路（息屏场景靠唤醒旁路救，可见态场景无救）。

**建议处置**：完成判定前增加二次确认与去抖 —— onerror 与 readystatechange(status 0) 去重计数（每请求仅计一次）；错误收敛前延迟 ~500ms 复测一次仍不可达才完成；阈值回到 ≥3；缓存 `lastKnownBytesDone`，仅当最后已知进度接近 `lastKnownBytesTotal`（或曾见过 410/已完成）才乐观完成，否则优先落到 waiting+重试 UI。另为 XHR 设 `timeout`（如 4s）并对 `ontimeout` 统一走失败计数，杜绝门闩死锁。

### 2.【低】任务恢复混入场景徽章总大小少算

从历史任务恢复到 share 阶段时（main.js:5049-5065）`sharePaths` 条目为纯 string（无 `sizeBytes`）；此后若再经 `addSharePaths` 添加文件，既有 string 条目只转成 `{ path, name, size: '' }` 而不重取大小（5583-5586），新条目才带 `sizeBytes`。结果徽章 `hasAnySize=true` 但 `totalSizeBytes` 只累加新增部分 → **"总计"偏小、文件数仍正确**。

**建议处置**：`addSharePaths` 对缺失 `sizeBytes` 的既有条目统一重查一次 `GetFileInfos` 回填，或任务恢复后先整体归一化一次再进 share 态。

### 3.【低】"共 N 个文件"措辞对目录条目失真

share 阶段允许加入目录（`GetFileInfos` 对目录 `WalkDir` 递归求总大小，app.go:1186-1192），目录作为 1 个条目计入 `sharePaths.length` → 徽章显示"共 1 个文件，总计 X"，与实际分享的"文件数"语义不符。若产品语义是"传输项"，建议文案改"共 N 项/共 N 个项目"（各语种同步）；若确要"文件数"，目录条目应在计数时展开递归计文件。

**建议处置**：视产品语义统一措辞或计数口径。

## 四、 正常部分确认

- **唤醒旁路不破坏正常轮询**：`pollStatus(true)` 仅当 `!isCompleted` 且可见时才触发，正常 1200ms 间隔轮询逻辑不变。
- **`<a download>` 不引入弹窗/多标签**：顶级点击由 OS 下载管理器接管，无可见副作用。
- **RFC 5987 输出正确**：`filename*=UTF-8''%E6%B5%8B%E8%AF%95%20%E6%8A%A5%E5%91%8A.zip`，空格→%20、UTF-8 中文逐字节编码，符合 RFC 6266。
- **无安全回归**：nosniff 为防御性 header；`sanitizeASCIIFilename` 过滤非 ASCII、`filename=` 引号反斜杠转义完备。
- **`04ec12c5` 锁收敛实证闭环**：`-race` 全绿（11.743s）佐证 §telemetry 第十一轮两项锁建议已闭环。

## 五、 验证命令

```sh
cd /home/yelon/develop/me/eqrcp && go test ./pkg/server/... -count=1        # ok (9.264s)
cd /home/yelon/develop/me/eqrcp && go test -race ./pkg/server/... -count=1  # ok (11.743s)
cd desktop/gui && go test ./... -count=1                                    # ok (2.045s)
```

## 六、 结论

762c188b 三项修复的**根因判断全部成立、方向正确、工程配套规范**（唤醒旁路解除轮询门闩死锁、`<a download>` 替代 iframe、严格 RFC 5987 + ASCII 回退 + nosniff 针对 Edge、徽章主路径真实可显示），无版本断裂、无安全回归。本轮 3 项发现均为打磨级（1 中 2 低）：#1（乐观完成误报 + 去重 + timeout）建议优先收敛；#2/#3 视产品语义择期。
