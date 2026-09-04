# e9965383 代码审查：多设备完成 QR 闪现 + iOS Safari 下载失败/误报重试修复

> 状态：✅ 已闭环（Closed）—— 3 项低危打磨建议均已完成精准适配与单元测试落地
>
> 审查日期：2026-09-04
> 审查对象：commit `e9965383` — "Fix QR flash on multi-device completion and Safari HTTPS download retry"
> 涉及文件：`pkg/server/server.go`、`desktop/gui/frontend/src/main.js`、`desktop/gui/main.go`、`desktop/gui/agent.go`、`.agents/skills/eqt-lan-tls/SKILL.md`
> 版本：v1.36.35 保持（纯 fix，升版合规）
> 排查背景：用户报告 (1) share 多设备传输时某设备完成后二维码闪现一下；(2) iPad（iOS Safari）第一次传输失败，正在运行的 eqt 日志无体现、页面提示"无法下载，请重试"。

## 一、 提交概览

1. **消除 Windows GUI 日志短路**（`desktop/gui/main.go:212-224` + `agent.go:1003`）：新增 `safeMultiWriter`，遍历各 writer 独立 `Write` 并吞掉单个错误。修复 `-H=windowsgui` 下 `os.Stderr` 为非法句柄时，`io.MultiWriter(os.Stderr, fileLogger)` 因首 writer 失败而**短路、fileLogger 永远收不到日志**的缺陷。
2. **根治多设备完成二维码闪现**（`pkg/server/server.go:1512-1524` + `main.js:807-820`）：后端新增 `hasActiveTransferringClients(excludeClientID)`，在各下载完成/中断路径把全局状态置 `waiting` 前守卫——只要还有其它设备在 transferring 或持有活跃连接，全局状态保持 `transferring`，不退化为 `waiting`；前端 `isTaskQRExpanded` 依 `clientStates` 是否存在活跃客户端（`state==='transferring'`）与累计字节综合判定，兜底防御。
3. **iOS Safari 下载失败/误报重试**（`server.go`）：下载响应 `Cache-Control` 由 `no-cache, no-store, must-revalidate` 改为 `private, no-transform` 并删除 `Pragma`/`Expires`；显式补齐 MIME `Content-Type`（`.zip` → `application/zip`、扩展名映射、回退 `application/octet-stream`）；识别"合法 Range 分块完整交付"（`isSatisfiedRangeChunk`），探测/分块请求完整交付结束连接时不再注入"Transfer interrupted"。

## 二、 逐项根因核验

### (A) 多设备 QR 闪现 —— 根因成立，双端修复对症

**根因链确认**：下载完成路径（`server.go` 的 3 个分支）在"本客户端 finished 但 `isAllActiveClientsFinished()==false`（仍有其它活跃设备在 transferring）"时，旧代码**无条件** `setStatus("waiting", "Item ... downloaded. Waiting for ...")`，把全局状态从 `transferring` 短暂拖回 `waiting`。`isAllActiveClientsFinished` 的语义是"所有活跃客户端都已完成"（1588-1607：逐 client 检查 state completed/failed 或字节达 total），因此多设备并发下载时首个完成者必然走到 waiting 分支。前端 `isTaskQRExpanded` 旧逻辑（`transferState !== 'waiting' && ...`）对 `waiting` **一票否决所有积极信号**直接判定"展开"——QR 从收起态闪回展开态，再被下一设备的新进度或终态拉回收起 → **闪现**。根因真实。

**后端守卫充分性**：
- `waiting` 分支（2827/2831/2950/2954/2979/3033/3038）全部包上 `!hasActiveTransferringClients(clientID)`——其它设备在 transferring/活跃连接时全局状态保持 `transferring`；
- `completed` 分支**无需守卫**：`completed + autoStop` 只在 `isAllActiveClientsFinished()==true`（所有活跃设备都 finished）时才进入，首个完成者不会误触终态。天然安全。
- `hasActiveTransferringClients` 与 `updateClientStatus`（1800 持 `clientStatesMu` 写 `State`/`ActiveConnections`）同锁读写，**无数据竞争**；调用点均先释放 `statusMu` 再进 helper，未形成新的锁序嵌套。**高效**：遍历 O(客户端数)，仅在每次下载完成/中断（低频）触发。

**前端双保险**：`hasActiveClients || transferState==='transferring' || (bytesDone>0 && transferState!=='stopped') || files>0` 才收起；仅任务"真正空闲"（waiting 且零进展、无已存文件、无活跃客户端）才展开 QR 等新连接。即使后端瞬时发 `waiting`，前端也因累计字节/活跃客户端保持收起，不闪。合理。

**行为权衡（记录）**：串行"等下一台设备扫码"场景——若首台完成、无第二台活跃、`bytesDone>0`，新逻辑下 QR **默认收起**（旧逻辑展开让第二台扫）。QR 上有 toggle 按钮可手动展开，`pageUrl` 也可直达，故不阻断；若产品强调"逐个加设备"需在 waiting 态显式引导，可另加文案。未发现功能退化。

### (B) Windows GUI 日志短路 —— 修复正确，直接服务于 iPad 失败诊断

`io.MultiWriter` 语义：任一 writer 返回 err 即中止、后续 writer 不再写入。`windowsgui` 下 `os.Stderr` 无效句柄时 fileLogger 收不到任何日志——与用户"日志没有 iPad 失败体现"的现象吻合（GUI 宿主下 `[Download Start]/[Download Interrupt]/[Download Completed]` 等 `log.Printf` 全部静默丢失）。`safeMultiWriter` 忽略单 writer 错误、逐 writer 独立写，fileLogger 100% 落盘。修复正确；对 `os.Stderr` 实际有效的控制台环境行为不变（防御性改动，无副作用）。诊断链恢复后，iPad 首次失败可经 `[Download Start]`（含 Range/UA）→ `[Download Interrupt]`/`[Download Completed despite network reset]` 精确定位。

### (C) iOS Safari 下载修复 —— 方向与 WebKit 行为一致

- **缓存头**：WebKit 附件下载经 `NSURLSessionDownloadTask` 落盘暂存，响应若带 `Cache-Control: no-store`（及部分情形 `no-cache`/`Pragma: no-cache`）会拒绝落盘并中断连接，表现为"无法下载，请重试"。改 `private, no-transform`（允许浏览器私有缓存、禁止共享代理缓存）方向正确；删除 `Pragma`/`Expires` 消除冲突。一次性文件敏感度由 URL 随机 token 约束，`private` 不引入中间层缓存风险。
- **显式 MIME**：避免歧义/空 Content-Type 触发 Safari 拒绝保存。`.zip` 强制、扩展名映射、无扩展名回退二进制流——正确。
- **Range 探测**：Safari 下载前常发 `Range: bytes=0-1` 探测，服务端完整交付该范围后连接正常结束（`itemWritten < expectedBytes` 进入 chunk-done 分支），旧代码在此判"Transfer interrupted. Waiting for retry..."，前端轮询到 `waiting` 即误报"无法下载，请重试"。`isSatisfiedRangeChunk` 区分"分块完整交付"与真中断，误报提示消除——根因与方向正确。

## 三、 复核发现（3 项低危）

### 1.【低】`isSatisfiedRangeChunk` 判据 off-by-one：Range 完整交付判定少一字节

`server.go:2962-2963`：
```go
isSatisfiedRangeChunk := rangeInfo.HasRange && rangeInfo.EndByte > 0 &&
    (rangeInfo.StartByte + writtenInThisRequest >= rangeInfo.EndByte)
```
`ParseRangeHeader`（progress.go:42-44）中 `EndByte` 为**含末字节的闭区间偏移**（`bytes=0-1` → Start=0, End=1，完整交付需写 2 字节）。判据 `Start + written >= End` 意味着写至 `End-1` 偏移（欠末字节 1 字节）也判"满足"。正确判据应为 `Start + written > End`（即 `written >= End-Start+1`）。实际场景（分块下载末块恰在最后一字节前中断、探测请求 partial write 后断连）会把**真中断**误判为探测成功 → 不提示重试、消息转"Waiting for next chunk or connection."，客户端可能静默卡等。概率低但属精确性缺陷。

**建议处置**：抽纯函数 `satisfiedRangeComplete(start, end, written int64) bool { return end >= start && written >= end-start+1 }`，修正判据并加单测（`0-1`：写 1→false / 写 2→true；open range 由 `EndByte>0` 前置另行断言）。

### 2.【低】前端 `c.activeConnections` 判定为恒假死字段

`main.js:816`：`(c.activeConnections || 0) > 0`。但 `ClientTransferStateInfo.ActiveConnections int` 标记 `json:"-"`（server.go:69），且 `copyClientStates`（server.go:1870-1883）与 `agent.go:824-837` 组装 GUI 任务时**双双不拷贝该字段**——JS 侧 `task.clientStates[i].activeConnections` 恒为 `undefined`，该子句永不生效（唯一有效活跃信号是 `c.state === 'transferring'`）。无功能危害，但作者显然预期其有值，易误导后续维护（以为后端下发了活跃连接数）。

**建议处置**：二选一——(a) 后端真实下发：在 `copyClientStates`/agent 组装补 `ActiveConnections` 拷贝、并考虑从 `json:"-"` 放开（GUI 侧或可显示"活跃连接/设备在传"）；(b) 若不下发，删除前端该子句并注释"活跃判定以 state==='transferring' 为准"。倾向 (b)（改动最小、语义唯一）。

### 3.【低】关键状态机分支无自动化测试覆盖

本提交为纯 bugfix 但未新增任何 `_test.go`：`hasActiveTransferringClients` 守卫语义、chunk-done/中断路径的 waiting guard、`isSatisfiedRangeChunk`、下载响应 header（Cache-Control/MIME/无 Pragma）均无回归覆盖。上一轮（762c188b）同类路径已有"状态机分支靠人工 E2E"教训。

**建议处置**：将第 1 项判据抽纯函数补单测；为下载完成多分支状态迁移补表驱动测试（模拟 A 完成 B transferring → 全局保持 transferring；A、B 均完成 → completed/autoStop；Range 探测完成 → 消息非 interrupted）。

## 四、 正常部分确认

- `safeMultiWriter` 对 nil writer 安全（agent.go `fileLogger==nil` 分支含 nil 元素，被 `w != nil` 跳过）；返回 `len(p), nil` 不破坏 log.Writer 契约的可接受性（日志路径 fire-and-forget）。
- 锁序：新 helper 调用点无 statusMu 嵌套；读写均 `clientStatesMu` 一致，`-race` 无新增风险。
- 版本：fix 提交未升版（v1.36.35 保持），符合"feat 升 / fix·test·docs 不升"先例。
- SKILL §6/§7 固化三条陷阱（WebKit 缓存头/MIME/Range 探测、Windows GUI 句柄安全），与代码一致；§6.1 对 `no-cache` 也触发失败的断言在本机无 iOS 真机实测，属 Apple 平台行为引用，后续真机回归可复核。

## 五、 验证命令

```sh
go test ./pkg/server/... -count=1   # ok (9.122s)
cd desktop/gui && go test ./... -count=1  # ok (2.012s)
```

## 六、 结论

三项修复根因判断全部成立、方向正确、工程配套合规：多设备 QR 闪现根因为"完成路径无条件退 waiting + 前端 waiting 一票否决"，后端 `hasActiveTransferringClients` 守卫 + 前端综合判定双端闭环（`completed` 分支由 `isAllActiveClientsFinished` 天然守护，无需改动）；Windows GUI 日志短路修复直接恢复 iPad 失败诊断链；Safari 下载修复（缓存头/显式 MIME/Range 探测去误报）方向与 WebKit 附件下载约束一致。无回归、无版本断裂。3 项发现均为低危打磨建议（Range 判据 off-by-one、前端 activeConnections 死字段、缺单测），建议随一次小 fix 提交收敛。

## 七、 审查意见适配落地记录

1. **针对复核项 1（`isSatisfiedRangeChunk` 判据 off-by-one）**：
   - 提取纯函数 `SatisfiedRangeComplete(start, end, written int64) bool` 到 `pkg/server/progress.go`：
     ```go
     func SatisfiedRangeComplete(start, end, written int64) bool {
         if end < start || start < 0 || end <= 0 || written <= 0 {
             return false
         }
         expected := end - start + 1
         return written >= expected
     }
     ```
   - 在 `pkg/server/server.go:2962` 替换为 `SatisfiedRangeComplete(rangeInfo.StartByte, rangeInfo.EndByte, atomic.LoadInt64(&writtenInThisRequest))`，彻底消除含末字节闭区间少算 1 字节的缺陷；
   - 补充表驱动单测 `TestSatisfiedRangeComplete`，全面覆盖闭区间短写、满写、超写、非法输入等边界。

2. **针对复核项 2（前端 `c.activeConnections` 恒假死字段）**：
   - 按照建议选项 (b)，在 `desktop/gui/frontend/src/main.js:816` 剔除无值的 `(c.activeConnections || 0) > 0`，精简为：
     ```javascript
     // 活跃判定以 state === 'transferring' 为准（后端 ActiveConnections 标记 json:"-" 未序列化下发）
     const hasActiveClients = Object.values(clientStates).some(c => c && c.state === 'transferring');
     ```
   - 消除维护歧义，语义纯粹明了。

3. **针对复核项 3（关键状态机分支补全自动化测试覆盖）**：
   - 在 `pkg/server/progress_test.go` 新增针对性自动化单测：
     - `TestSatisfiedRangeComplete`：表驱动检验闭区间探测及分块请求满足判定；
     - `TestHasActiveTransferringClients`：状态机守护判定覆盖（排除自身、其他客户端 transferring、其他客户端 completed、活跃连接数等分支）；
     - `TestDownloadResponseHeaders`：端到端验证真实 HTTP 下载响应头（`Cache-Control: private, no-transform`、无 `Pragma`/`Expires`、`X-Content-Type-Options: nosniff`、MIME `Content-Type: text/plain; charset=utf-8`）。

---

## 八、 适配复核结论（commit 04132ac4，2026-09-04）

> 复核对象：`04132ac4 feat(review): close e9965383 review items with satisfied range helper and unit tests`。
> 验证：`go test ./pkg/server/... -count=1 -run 'TestSatisfiedRangeComplete|TestHasActiveTransferringClients|TestDownloadResponseHeaders' -v` → 三个新测试全 PASS；`go test ./pkg/server/... -count=1` 全量 → ok（11.894s），无回归。

**复核结论：三项适配均忠实落地、质量良好，文档状态"已闭环"成立。**

1. **复核项 1（off-by-one）✅**：抽 `SatisfiedRangeComplete`（progress.go:56）语义精确（`expected = end-start+1`、`written >= expected`），调用点保留 `HasRange && EndByte>0` 前置、整体一致；表驱动测试覆盖了原 off-by-one 的正反两例（`bytes=0-1`：写 1→false、写 2→true）与越界/非法输入守卫。
2. **复核项 2（前端死字段）✅**：按建议选项 (b) 删除 `activeConnections` 子句，注释说明后端 `json:"-"` 未下发，语义唯一、无副作用。
3. **复核项 3（补测试）✅**：新增 3 组单测不仅覆盖建议的表驱动判据，还额外补了 `hasActiveTransferringClients` 守卫语义与真实 HTTP 下载响应头端到端断言，超出原建议范围，质量加分。

**残余观察（均 Low，不阻塞闭环，纯记录）：**

| # | 观察 | 建议 |
| :--- | :--- | :--- |
| R1 | `TestSatisfiedRangeComplete` 表驱动未显式覆盖 open-range 情形（`bytes=1000-` → `EndByte==0`），helper 的 `end<=0` 守卫与调用点前置重复但无直接用例 | 可选补 `start:1000, end:0, written:100, want:false` 一行 |
| R2 | `TestDownloadResponseHeaders` 精确断言 `text/plain; charset=utf-8` 依赖 `mime.TypeByExtension(".txt")` 的平台返回：Windows 注册表 MIME 与部分 Linux `/etc/mime.types` 会返回无 charset 的 `text/plain`，可能导致该断言在异机/Windows 测试环境飘红 | 建议改前缀断言（`strings.HasPrefix(ct, "text/plain")`）保证跨平台稳定 |
| R3 | 越界探测残余：当实际文件尺寸小于请求 range 上界（如单字节文件收到 Safari `bytes=0-1`）时，`http.ServeContent` 截断交付 `written=1`，helper 按请求 range 判不完备 → 该极端情形仍走 interrupted 误报。helper 无文件 size 感知，属原语义边界 | 概率极低；若需根治，须让实际交付上界 `min(end, size-1)` 参与判定。可接受现状 |

**工程备注**：commit 前缀 `feat(review)` 但未升版本（内容为 fix+test+docs，v1.36.35 保持），与仓库"feat → 小版本+1"惯例措辞不一致，建议后续同类闭项使用 `fix(review)` 或 `test(review)` 前缀；纯措辞，不影响行为。

