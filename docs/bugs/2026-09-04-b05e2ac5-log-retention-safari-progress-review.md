# b05e2ac5 代码审查：7 天日志留存 + iPhone Safari 假完成/进度闪退修复

> 状态：🔄 待跟进（Open）—— 审查完成，1 项中危 + 3 项低危/流程建议待后续适配闭环
>
> 审查日期：2026-09-04
> 审查对象：commit `b05e2ac5` — "Add 7-day log retention and fix Safari download progress reporting"
> 涉及文件：`desktop/gui/file_logger.go`(+`file_logger_test.go`)、`pkg/server/server.go`、`pkg/server/progress_test.go`、`pkg/pages/download.tmpl.html`、`desktop/gui/frontend/src/main.js`、`desktop/gui/agent.go`、`cmd/desktop_agent.go`、`desktop/gui/wails.json`、`pkg/version/version.go`、`.agents/skills/eqt-ux/SKILL.md`
> 版本：v1.36.36 → v1.36.37（新增留存治理属功能，升版合规）
> 排查背景：(1) file_logger 历史日志/崩溃转储无时间维度过期清理，长期占用磁盘；(2) iPhone Safari 传输刚开始进度条即 100%（假完成）与连接交替阶段进度闪退。

## 一、 提交概览

1. **日志 7 天留存与自清理**（`file_logger.go`）：新增 `defaultLogRetentionDays = 7`、`cleanupCheckInterval = 12h` 与 `cleanupOldLogs(logDir, days)`。触发点三处：`NewFileLogger` 启动时（69）、`SetLogDir` 变更日志目录时（113）、workerLoop 后台每 12 小时（279-283）。清理对象：轮转历史 `desktop.log.N`、其它 `*.log`（不含活跃 `desktop.log`）、`crash_*.dump`；活跃 `desktop.log` 仅在闲置超期（mtime 早于 cutoff）时 `os.Truncate` 归零而非删除。
2. **前端"假完成"红线修复**（`download.tmpl.html`）：彻底删除 `xhr.onerror` / 非 200 / `isWakeup` 分支中的 `showCompletedUI()` 调用——网络瞬断或唤醒期错误只允许提示重连等待文案（`waiting_status`），不再直接判定完成；完成仅由 200 `state==='completed'` 或 `bytesDone>=bytesTotal>0` 触发。唤醒监听（`visibilitychange`/`pageshow`/`focus`）改为 250ms 防抖 `wakeupTimer` 归一单次轮询。另引入 `lastKnownPercent`/`lastKnownBytesDone` 单调记忆，防止服务端瞬时低值把进度条拉回。
3. **ZIP 打包下载子项完结隔离**（`server.go`）：新增 zip 守卫——`isClientFinished`/`getClientDownloadedItems` 在 `expectedBytes[-1]>0` 且存在 `progress[-1]` 时，仅以 `progress[-1] >= expectedBytes[-1]` 为唯一完结/子项判定；前端 `downloadedItems.length>=totalCount` 完成门额外加 `isActuallyDone`（字节达标）二次校验。配套：下载页渲染时对 `clientID` 增加 `resetClientDownloadedBytes(clientID, -1)`。
4. **断点等待态进度记忆**（`statusHandler`）：`waiting` 且未完成分支不再把 `BytesDone/Percent` 抹零，改携带 `cState.BytesDone/Percent/Message`，消除 Safari Range 探测→等待交替期的进度闪退。
5. **捆绑改动（与主题无关）**：`main.js` `startChat` 启动聊天前若存在 share/receive 活跃任务先 `StopCurrent()`、新增 `chatStarting` 状态与 `applyStatusData` 对旧 chat 的保持；`desktop/gui/agent.go:546-551` 与 `cmd/desktop_agent.go:508-513` 在 `pushTask`/`handleTasks` 的 chat 分支对 `busy` 先 `replaceActiveLocked("stopped")`。

## 二、 逐项根因核验

### (A) 日志留存 —— 治理结构合理，覆盖面声明有一处不实（见复核项 2）

启动/换目录/12h 三触发点齐备；活跃文件用 truncate 而非 remove，避免删掉持句柄正在写的文件；清理按 mtime cutoff 判定、逐项容错。写侧使用 `O_APPEND`（52/103/205/303），即使活跃 `desktop.log` 被闲置截断，后续写入总是追加到当前 EOF，不会产生稀疏空洞。**唯一隐患是"崩溃转储"子句与实际产物不匹配**（详见复核项 2）。

### (B) 根因 1（唤醒/网络错误直接触发假 100%）—— 成立，修复对症且彻底

旧代码三处（`onreadystatechange` 非 200 分支 `downloadTriggered && (isWakeup || consecutiveErrors>=2)`、`onerror` 同款、`consecutiveErrors>=5`）都会 `showCompletedUI()`。Safari 点下载唤起原生确认弹窗 → 页面失焦 → 用户点"下载"恢复焦点触发 `focus` 唤醒 → `isWakeup=true` → 恰逢 Safari 初始化大文件下载网络流、并发 `/status` XHR 返回 status 0/挂起 → 命中即拉满 100% 并杀轮询。修复把错误路径的完成调用全部移除，完成唯一可信来源收敛为服务端 200 `completed`/字节达标；防抖 250ms 让唤醒期仅发起单次平滑轮询。正确。

### (C) 根因 2（ZIP 流字节污染子项、子项提前"完成"）—— 根因成立，主路径修复有效，但守卫判据存在键存在性误判（见复核项 1）

污染源确认：ZIP 下载 `onWrite`（server.go:2795-2799）把每个写块同时累加到 `-1` 与**所有**子项 `progress[idx]`；ZIP 请求还把所有子项 `expectedBytes[idx]` 置为整个 zip 大小（2778-2783）。小文件几十 KB 在数十 MB zip 只传 1% 时就"超出自身大小"，旧逻辑 `downloadedItems.length>=totalCount` 即触发前端完成 → 假 100%。修复后：后端 zip 守卫只在 `progress[-1]` 达 zip 总量时才算客户端完成/返回子项清单；前端完成门再叠 `isActuallyDone` 字节校验。对"纯 download-all(zip) 主路径"有效。`TestZipDownloadProgressAndFinishedIntegrity` 验证了 500/2048 未完成、满量才返回 2 项，判据本身正确。

### (D) 根因 3（waiting 态抹零致进度闪退）—— 根因成立，修复正确

旧 `statusHandler` 在客户端 `waiting` 且未完成时无条件 `BytesDone=0/Percent=0/"Waiting for transfer to start."`；Safari Range 探测（bytes=0-1）结束服务端进入 waiting 后，探测已写入的少量字节被抹零，界面进度在"连接交替阶段闪退"。修复后携带 `cState.BytesDone/Percent/Message`（server.go:2159-2169），真正空闲的 waiting（无任何进度）仍自然为 0，不引入假进度。正确。前端 `lastKnownPercent` 单调上限进一步防抖。

### (E) 捆绑 chat 切换改动 —— 功能行为变更未在 commit 主题中声明（见复核项 4）

## 三、 复核发现

### 1.【中】ZIP 完结守卫以"`progress[-1]` 键存在 + 全局 `expectedBytes[-1]>0`"为触发条件，会把非 ZIP 下载客户端的完结判定永久卡死

**缺陷机制**：`resetClientDownloadedBytes`（server.go:1903-1913）**置键为 0 而非删除键**；下载页渲染（2572）对每个访客客户端**无条件**创建 `progress[clientID][-1]=0`。而 `expectedBytes[-1]` 是**全局 map、跨请求/跨客户端存活**：一旦本 Server 会话内任何一次 ZIP（download-all）请求发生过（2778-2779 赋值后永不清除），`zipTotal>0` 即永久成立。于是：

- `isClientFinished`（1944-1956）：凡客户端 map 含 `-1` 键（值 0 或历史 partial）且 `zipTotal>0` → 直接返回 `0>=zipTotal` = false，**不再落到逐项判定**；
- `getClientDownloadedItems`（1999-2018）：同因恒返回 nil；
- `getClientDownloadedAndTotal`（2071-2085）：同因恒返回 `(progress[-1], zipTotal)` —— `-1` 键值为 0/旧 partial 时，即使该客户端此刻正在**按单个文件下载**，H5 拿到的 `bytesDone` 恒为 0/旧值、进度条冻结。

**触发场景（多文件 share）**：设备 A 点过"下载全部"（zip，哪怕中途中断）或刷新过下载页使其 `-1` 键=0，随后（自己或同会话内其它设备产生过 zip 后）改为按行点**单个文件**下载——该客户端的完成判定从此永远 false、进度冻结、`downloadedItems` 恒空，只有再走一次完整 zip 或重开会话才解除。与本次修复欲解决的"进度异常"同域，属新引入的回归面。

**建议处置**（三选一，最小改动优先）：
1. `resetClientDownloadedBytes(clientID, -1)` 从页面渲染路径移除（zip 请求开始处本就会 `setClientDownloadedBytes(-1, StartByte)` 初始化，页面渲染无需预置 0）；
2. 非 ZIP（`?item=`）下载请求开始时对该客户端 `delete(progress[-1])`（同时避免 `expectedBytes[-1]` 全局残值参与逐项判定——逐项分支应改用 `os.Stat` 实文件尺寸兜底而非全局 zipTotal）；
3. 更彻底：per-client 传输模式显式化（如 `ClientTransferStateInfo` 增加非序列化 `Mode` 字段），守卫仅在 mode=zip 时生效。

并为 `TestZipDownloadProgressAndFinishedIntegrity` 补"先 zip（partial）→ 再 item 全量 → 期望 finished=true / items 满"的时序用例。

### 2.【低】`crash_*.dump` 清理子句与真实崩溃转储产物不匹配（死代码/死文案）

`cleanupOldLogs`（file_logger.go:497-499）只认 `crash_` 前缀 + `.dump` 后缀。但仓库唯一崩溃转储写入点是 `desktop/crash/reporter.go:54-55` —— 固定文件名 **`crash.dump`**，目录为 `config.DefaultConfigDir()`；而日志目录默认是 `os.UserCacheDir()/eqt`（或用户 LogDir），两者默认**不同目录**。因此：

- 名称不匹配：`crash.dump`（无下划线）永远不命中 `crash_*.dump`；
- 即便改名命中，也在日志目录之外，`cleanupOldLogs` 根本遍历不到。

即"崩溃转储（crash_*.dump）7 天过期清理"实际对任何真实文件都不生效。`file_logger_test.go` 的 `TestFileLogger_RetentionCleanup` 仅验证了该（不存在的）命名模式本身，未触及真实产物。由于 `crash.dump` 单文件覆写、不无限增长，危害有限，但 commit 描述、SKILL §13 措辞与代码三者对真实覆盖面的声明不实。

**建议处置**：若确要清理崩溃转储，把清理目标改为真实文件 `crash.dump`（含目录对齐或显式清理 `config.DefaultConfigDir()`），并注意"未上报/未忽略的 crash.dump 是用户可提交的诊断"，删除策略需权衡（或仅当 `Uploaded||Dismissed` 才清）；若无意覆盖，则删除该子句并修正描述。

### 3.【低】410 完成口径收严后存在两个退化窗口：二次查看页误报"停止" + 低频永久空轮询

新 410 分支（download.tmpl.html:1193-1206）要求 `lastKnownPercent>=99 || bytesDone>=bytesTotal` 才 `showCompletedUI()`，否则仅把状态文案置 `failed_status`：

- **已完成分享的旁路查看页/息屏错过窗口**：服务端完成后有 `defaultStatusGracePeriod=15s`（server.go:45）的 200 completed 窗口；若某页面在整段窗口内未轮询（息屏/后台，唤醒后服务端已 autoStop），唤醒首轮即 410，本地 `lastKnownPercent` 远低于 99 → 显示"Transfer stopped."而非完成态。762c188b 曾专门让此类"服务端已停"场景收敛到完成 UI，本提交等价地收回了该保障。
- **410 else 分支不停止轮询、不展示重试按钮**：`showCompletedUI()` 才会 `clearInterval`；410 else 只写文案，轮询对已停服的服务器继续每秒重试、页面永远停在"Transfer stopped."且 actionBtnRow 隐藏（该行仅在 200 分支/完成态切换可见），用户只能整页刷新。对旁观了分享完成但自己未下载的第二个页面尤为明显（旧代码此场景显示完成对勾）。

**建议处置**：410 else 分支停掉 interval、复用 `actionBtnRow` 显示"重试/刷新"；或服务端在 grace 窗口内对已完成的 client 持续返回 200 `completed`，前端将"410 + 曾见过该客户端完成"作为完成兜底。

### 4.【低/流程】chat 切换改动与主题无关且行为变更未在 commit 声明

`main.js`（startChat 前置 `StopCurrent()` + `chatStarting` 保持）+ 双 agent（GUI `agent.go` 与 cmd `desktop_agent.go` 同步）的"启动 chat 即替换/停止正在进行的 share/receive 任务"是独立产品行为变更，与"日志留存 + Safari 进度"主题无关，且 commit 标题/说明均未提及。正确性抽查未见死锁（`replaceActiveLocked("stopped")` 仅在持 `agent.mu` 的锁内置状态并 `go stop()`，不嵌套自锁；前端先 `StopCurrent` 再由 agent 侧兜底），但"share 进行中点 chat 会把当前传输替换为 stopped 并丢弃队列上下文"是否为目标语义需产品确认。

**建议处置**：拆分为独立 commit 并单独评审；如属有意行为，请在产品层面对齐 receive/chat 并发模型与任务记录归档语义（replaceActiveLocked 不 finalize、不写入 history）。

## 四、 正常部分确认

- **根因 1 修复彻底**：错误/唤醒路径不再触碰完成逻辑，完成唯一入口为服务端确凿 200 完成或字节达标；防抖 250ms 合理（Safari 唤醒事件在系统弹窗交替时高频连发）。
- **根因 2 主路径正确**："纯 download-all(zip)" 与"全新单客户端逐项下载（其 `-1` 键不存在、`expectedBytes[-1]=0`）"两条主路径行为正常；`markItemDownloaded` 全局记账不受守卫影响。
- **根因 3 修复正确**：waiting 态携带真实进度、空闲态仍 0，无假进度注入；配合前端 `lastKnownPercent` 单调上限，Range 握手→正式下载交替不再闪退。
- **留存治理工程面**：三触发点齐备；活跃文件只截断不删除、写侧 `O_APPEND` 无稀疏空洞风险；`desktop.log` 特判防止误删正在写的活跃文件；清理在 worker/启动路径同步执行、单次 `ReadDir` 遍历 + 容错，开销可忽略。
- **版本**：`version.go` + `wails.json` 同步 v1.36.37；新增留存治理属功能，升版合规（`app_test.go`/`telemetry_e2e_test.go` 内 `v1.36.35` 为夹具数据，非版本断言，GUI 全量通过佐证）。
- **测试**：`TestZipDownloadProgressAndFinishedIntegrity`、`TestFileLogger_RetentionCleanup` 判据正确；`TestSatisfiedRangeComplete`/`TestHasActiveTransferringClients`/`TestDownloadResponseHeaders`（此前轮次）未回归。
- **SKILL §13** 记录的红线与代码一致（仅 crash 覆盖声明见复核项 2）。

## 五、 验证命令

```sh
go test ./pkg/server/ -count=1 -run 'TestZipDownloadProgressAndFinishedIntegrity' -v   # PASS
go test ./pkg/server/... -count=1                                                      # ok (10.988s)
cd desktop/gui && go test . -count=1 -run 'TestFileLogger_RetentionCleanup' -v         # PASS
cd desktop/gui && go test ./... -count=1                                               # ok (2.024s)
```

## 六、 结论

三项 Safari/留存根因判断全部成立、修复方向正确：错误路径触发假 100% 的红线已彻底拔除；ZIP 子项污染在前端+后端双层门闸下主路径不再误报；waiting 态进度记忆与 250ms 唤醒防抖消除交替期闪退；日志留存三触发点与 O_APPEND 写模型无工程隐患。版本与测试合规、无 `-race` 新风险面。

但本轮有 1 项**中危**需优先收敛：ZIP 守卫以"`-1` 键存在性 + 全局 `expectedBytes[-1]` 残值"判定"客户端正在 zip"，而页面渲染会无条件制造 `-1` 键、zip 总量跨客户端永久存活，导致混用"下载全部+单文件"的多文件分享客户端完结判定卡死、进度冻结（复核项 1）。另有 3 项低危/流程建议（crash 清理死模式、410 收严的双退化窗口、chat 改动捆绑）随一次小 fix 提交收敛为宜。
