# Share 模式进度条失效缺陷分析、高效修复方案与全传输模式 (Receive/Chat) 状态机制审计

> 状态：📝 审计归档（Open / Review）
> 审计日期：2026-09-08
> 审查修正：2026-09-08（归因勘误 + 结论精确化，见文内 ⚠️ 标注）
> 涉及模块：`pkg/server/server.go`、`pkg/server/chat.go`、`pkg/pages/download.tmpl.html`、`pkg/pages/upload.tmpl.html`、`desktop/gui/frontend/src/main.js`
> 对应版本：v1.36.64

---

## 一、 Share 模式进度条失效缺陷分析

### 1. 现象复现
在 Share（发送/分享）模式下，无论是多文件分享还是目录分享：
- **移动端/浏览器端 H5**：点击“下载全部”打包 ZIP 时，顶部的总体传输进度条以及下载项进度始终停留在 `0%`（或 0 字节），直到全部字节流下载完毕瞬间跳到 100% 或直接结束；
- **桌面 GUI 端**：活跃设备列表中的该客户端进度条同样冻结在 `0%`，传输速度和已传输字节数均无法实时反映真实的物理网络吞吐。

### 2. 根因深度溯源（为何以前正常，现在不正常？）

#### (1) 引入变更与历史动机（含 commit 归因勘误）
> **勘误（2026-09-08 审查）**：经 `git log -L 2087:...` 与 `git show` 溯源，`len(progress) == 1` 判定**并非** b05e2ac5 引入，而是当天下半场的 **`fddf19c4`**（*Isolate dual-channel zip download progress, fix log dump retention, and resolve 410 polling*, 09-04 21:07）引入的。两个 commit 同一天、相隔约 2.5 小时，此前的归因把它误记到了 b05e2ac5 名下。修复时**不应尝试回滚任何 commit**，只需改动判定逻辑本身。

- **b05e2ac5**（09-04 18:40，*Add 7-day log retention and fix Safari download progress reporting*）的真实改动：
  - 给 `hasZip` ZIP 分支补充 `&& zipProgress > 0` 守卫（`isClientFinished` / `getClientDownloadedItems`）；
  - 页面渲染时新增 `resetClientDownloadedBytes(clientID, -1)` 预置 ZIP 键。
  - 它**没有**引入 `len(progress) == 1`。

  **当时的修复动机**：
  - 在更早的版本中，服务端将 ZIP 打包数据流写入客户端时，每写入一个数据块（chunk），会遍历当前所有单文件索引并将写入量累加到每个文件的 `progress[idx]` 中；
  - 导致了一个严重的副作用（**假完成**）：若分享内容包含一个 10KB 的小文件和一个 500MB 的大文件，ZIP 刚传输了 100KB，小文件对应的字节统计就已提前达标，前端或服务端判定该子项“已完成”，导致 UI 进度条乱跳或提前触发 100% 假完成；
  - 为解决小文件被 ZIP 流污染的问题，开发者试图将 **“整包 ZIP 下载”** 与 **“逐项单文件下载”** 在服务端做严格的数据通道隔离。

- **fddf19c4**（09-04 21:07）才是死锁的**直接引入点**：它把 `getClientDownloadedAndTotal` 里的”进行中 ZIP 进度“分支从 `hasZip` 改造成 `hasZip && len(progress) == 1 && zipTotal > 0`，同时把完成判定分支收紧为 `zipProgress >= zipTotal && zipProgress > 0`。

#### (2) 致命暗礁：苛刻判定与页面初始化的冲突
在 [`pkg/server/server.go:2087`](file:///home/yelon/develop/me/eqrcp/pkg/server/server.go#L2087) 的 `getClientDownloadedAndTotal` 函数中，引入了如下守卫逻辑：

```go
// server.go:2087 (commit fddf19c4 引入，非 b05e2ac5)
if zipProgress, hasZip := progress[-1]; hasZip && len(progress) == 1 && zipTotal > 0 {
    return zipProgress, zipTotal, true
}
```

* **开发者的理想假设**：
  “如果当前客户端是进行整包 ZIP 下载，那么其在 `progress` map 里面应该**只有** `key = -1` 这一条记录（即 `len(progress) == 1`）”。
* **实际的运行时现实**：
  在 [`pkg/server/server.go:2592`](file:///home/yelon/develop/me/eqrcp/pkg/server/server.go#L2592)，当移动端浏览器首次打开 Share 页面（渲染根页面 `GET /`）时，服务端为了预置列表状态，无条件执行了预埋：
  ```go
  for idx := 0; idx < len(app.body.Paths); idx++ {
      app.resetClientDownloadedBytes(clientID, idx)
  }
  ```
  该操作提前向该客户端的 `progress` map 注入了所有单项的初始键值：`{0: 0, 1: 0, ...}`。

#### (3) 连锁崩溃因果链
1. 移动端打开网页，`progress[clientID]` 被写入 `{0: 0, 1: 0}`，此时 `len(progress) = 2`；
2. 用户点击“下载全部”，请求 ZIP 打包流（`itemIndex = -1`）；
3. 服务端流式写入 ZIP 数据，并将已传输字节忠实地累加到 `progress[clientID][-1]`；
4. 此时 `progress[clientID]` 实际存储为 `{-1: 1548200, 0: 0, 1: 0}`，元素数量 `len(progress) = 3`；
5. 前端与 GUI 轮询 `/status`，进入 `getClientDownloadedAndTotal`，判定条件 `len(progress) == 1` **恒为 false**；
6. 代码直接跳过 ZIP 分支，掉入下方的单文件逐项累加循环；
7. 但由于客户端走的是 ZIP 下载，单文件 `0` 和 `1` 的下载请求从未触发，`progress[0]` 与 `progress[1]` 全是 `0`；
8. 函数最终返回已下载字节 `clientDone = 0`，**进行中的百分比死锁在 0%**。

> **精确化（2026-09-08 审查）**：“死锁”一词需限定为**进行中百分比的显示死锁**，而非“传输永远无法完成”：
> - 被 `len==1` 拦截的仅是用 2087 行的**“进行中 ZIP 进度”分支**；
> - 而**完成判定**分支走的是 `server.go:2079`（`zipProgress >= zipTotal && zipProgress > 0`，**不含 `len==1`**），`isClientFinished`（1954 行）与 `getClientDownloadedItems`（2010 行）也同理不含 `len==1`；
> - 因此实际形态是：**客户端会在物理传输完成后被判定为“完成”，但整个传程中的进度条始终显示 0%，直到最后一瞬间跳满**。“完成但显示 0%”的撕裂才是该 bug 的完整危害。修复时务必让 2079（完成）与 2087（进行中）对“何为 ZIP 模式”使用**同一判据**，否则二者会继续撕裂。

#### (4) 单目录分享的叠加隐患
当用户分享单个文件夹时（`len(Paths) == 1` 且目标是目录），服务端同样走 ZIP 打包传输（`itemIndex = -1`）。若 `app.body.TotalBytes` 未在启动时完成全量递归计算（或为 0），会导致 `zipTotal <= 0`，即便没有 `len(progress) == 1` 限制，也会因总字节数为 0 而无法计算百分比。

---

## 二、 解决方案设计与高效性评估

### 1. 第一性原理与设计准则
- **状态判据必须源于“物理传输动作”，严禁基于“对 Map 大小的巧合猜想”**；
- 页面渲染阶段预置的 `{0..N: 0}` 是静态占位符，不能成为阻断物理传输统计的逻辑绊脚石；
- 统计判定必须保持纳秒级开销，满足微秒级 `/status` 高频轮询（遵循后端开发规范）。

### 2. 解决方案对比与选型

| 方案 | 核心实现 | 优点 | 缺点 | 推荐度 |
| :--- | :--- | :--- | :--- | :--- |
| **方案 A：去除 `len==1`，基于活跃性优先** | 检查 `hasZip && zipProgress > 0 && zipTotal > 0`，只要存在有效的 ZIP 传输即走 ZIP 统计；单文件下载开始时清理或显式区分 | 改动行数极少，立即解除死锁，向下兼容度最高 | 若客户端先下 ZIP 后又下单文件，需注意 `-1` 残留 | ⭐⭐⭐⭐ |
| **方案 B：显式会话下载模式（Active Transfer Mode）** | 在 `ClientTransferStateInfo` 增加内部 `ActiveMode: "zip" \| "item"`。ZIP 请求激活时设为 `"zip"`，单文件请求激活时设为 `"item"` | 语义最清晰，状态流转无歧义，彻底消灭 map 猜想 | 需要在请求入口更新状态字段 | ⭐⭐⭐⭐⭐（最佳实践） |

> **审查补充（2026-09-08）**：
> 1. **修复与回滚无关，只改判定**：不要尝试回滚 b05e2ac5 或 fddf19c4——回滚会失去 ZIP 双通道隔离的有益设计。直接改 `getClientDownloadedAndTotal` 的 2087 分支即可。
> 2. **仅去掉 `len==1` 不够**：方案 A 若客户端“先下单项后下 ZIP”或“ZIP 与单项交替”，`-1` 键与单项键会同时存在，凭 map 内容无法区分当前活跃通道——这正是必须引入显式 mode（方案 B）而非“猜 map 大小”的根本原因。可参考 `getClientDownloadedItems`（`server.go:2010`）已采用的、**只依赖传输动作留下的进度值、不依赖集合基数**的判定思路。
> 3. **完成/进行中分支必须共用同一判据**：修复时要保证 `server.go:2079`（完成判定）与 `server.go:2087`（进行中判定）对“何为 ZIP 模式”使用同一标准，否则会出现“完成态与进度显示撕裂”（见第一节精确化）。

### 3. 高效性与性能评估 (Efficiency)
- **CPU 时间复杂度**：$O(1)$。判定仅涉及哈希表单次寻址或布尔/枚举比对，耗时在 10~30 纳秒级别；
- **内存与 GC 零开销**：不产生任何堆内存分配（0 heap allocs），在多客户端高频轮询 `/status` 时，不会引发额外的 GC 停顿；
- **非阻塞契约**：严格在原有 `clientMutex` 内部完成轻量状态读取，不发起任何磁盘 I/O 或阻塞网络调用，完全符合工程规范。

---

## 三、 横向排查：Receive 模式是否存在类似问题与状态缺陷

### 1. 是否存在 `len(progress) == 1` 同类问题？
**结论**：**不存在完全相同的 Map 长度判据**。
Receive 模式采用了完全独立的架构：
- 现代浏览器走 **Tus 协议分块断点上传**（由 `tusd/v2` 托管）；
- 传统回退通道走 **标准 Multipart 表单上传**（`r.MultipartReader()`）。

### 2. Receive 模式深入审计发现的 4 项传输与状态显示缺陷

#### 缺陷 (1)：普通 Multipart 上传流式进度“黑洞”（回退通道完全不接报）
- **代码位置**：[`pkg/server/server.go:3376-3450`](file:///home/yelon/develop/me/eqrcp/pkg/server/server.go#L3376-L3450)
- **缺陷表现**：
  在 `part.Read(buf)` 读写上传文件的数据流循环中，虽然累加了局部变量 `currentFileWritten += int64(n)`，**但循环内部完全没有调用 `updateClientStatus` 或更新全局 `status.BytesDone`**！
- **后果**：
  当用户通过非 Tus 通道（如脚本 curl、禁用 JS 的浏览器或特定设备）上传大文件时，普通 Multipart 上传全程根本没有接入任何实时进度上报管线；整个上传过程中服务端和 GUI 的进度条始终冻结在 `0%`（或停留在上一个文件的状态），直到文件全部读完写入完成、`out.Close()` 之后，才在行 3457-3458 处瞬间写死 `cs.BytesDone = cs.BytesTotal, cs.Percent = 100`。完全丢失了传输过程中的物理进度反馈。

#### 缺陷 (2)：多文件普通上传的进度篡改与状态覆盖
- **代码位置**：[`pkg/server/server.go:3457-3458`](file:///home/yelon/develop/me/eqrcp/pkg/server/server.go#L3457-L3458)
- **缺陷表现**：
  当用户上传多个文件时，每完成一个单文件的写入，代码执行了：
  ```go
  cs.BytesDone = cs.BytesTotal
  cs.Percent = 100
  ```
- **后果**：
  如果用户同时上传 3 个文件（总共 300MB），第 1 个文件（100MB）刚传完，客户端总进度就被直接置为 `100%`；紧接着第 2 个文件开始传输时，进度在两端发生严重的逻辑震荡与回退。

#### 缺陷 (3)：Tus 批量上传的“假完成（False Completion）”与提前终止服务（高危）
- **代码位置**：[`pkg/server/server.go:643-660`](file:///home/yelon/develop/me/eqrcp/pkg/server/server.go#L643-L660)
- **缺陷表现**：
  在 Tus 的单个文件上传完成回调中：
  ```go
  if len(cs.SavedFiles) == len(cs.Files) || (cs.BytesTotal > 0 && cs.BytesDone >= cs.BytesTotal) {
      cs.State = "completed"
      // ...
      if autoStop || !s.KeepAlive {
          s.setStatus("completed", "Transfer completed.")
          go s.signalStopAfterStatusGrace()
      }
  }
  ```
  在批量上传场景下，前端 Tus 客户端是串行依次发起单个文件的上传，`cs.Files` 通过 Tus `MetaData["clientid"]` + `Upload.ID` 在 `server.go:457-489` 中按需动态 append。
- **后果（边界场景，需前端验证）**：
  - **前置条件**：若前端上传前调用的 `?init=true` 请求因弱网抖动**失败或晚于第 1 个文件到达**，且未预置 `cs.Files` 完整列表，则第 1 个文件上传时 `cs.Files` 只有当前单项（`len(cs.Files) == 1`）；
  - 此时第 1 个文件一传完，`len(cs.SavedFiles) == len(cs.Files) == 1` 判定直接满足，服务端误以为全部完成，将客户端置为 `completed`；若未开启 `KeepAlive` 或启用了 `autoStop`，**会触发倒计时杀死进程，掐断排队中的后续文件上传**；
  - **审查确认（2026-09-08）**：`643` 行的判定逻辑缺陷真实存在且推理自洽，但它是**强断言**——若前端 init 正常先到、`cs.Files` 已含完整列表，则该缺陷不会触发。此项应定性为**“init 迟到/失败或前端不预置 `Files` 时的高危边界”，需前端联调复现确认**，而非无条件必然发生。

#### 缺陷 (4)：`r.ContentLength` 盲信与 Chunked 传输失效
- **代码位置**：[`pkg/server/server.go:3300`](file:///home/yelon/develop/me/eqrcp/pkg/server/server.go#L3300)
- **缺陷表现**：
  普通上传直接使用 `status.BytesTotal = r.ContentLength`。若上传客户端启用了 HTTP/1.1 分块传输编码（Chunked Transfer Encoding）或 HTTP/2，`r.ContentLength` 值为 `-1`，导致总大小直接失真，百分比计算归零。

---

## 四、 横向排查：Chat 模式是否存在类似问题与状态缺陷

### 1. 是否存在 `len(progress) == 1` 同类问题？
**结论**：**不存在类似问题**。
Chat 模式是基于“消息总线 + 独立附件服务”构建的，其状态模型基于 `ChatStatusSnapshot`（核心包含 `MessageCount`、`DeviceCount`、`State`），并未与 Share/Receive 共享全局任务传输进度条管道，因此未受到该 Bug 的直接影响。

### 2. Chat 模式深入审计发现的 4 项传输与状态显示缺陷

#### 缺陷 (1)：桌面 GUI 对大附件传输存在“全局盲区（静默黑盒）”
- **缺陷表现**：
  移动端在 Chat 中通过 Tus 上传几百 MB 的大视频或附件时，Web 界面中虽然能在气泡内看到局部的 Tus 上传百分比，**但在桌面 GUI 主面板上，只有“在线设备数”与“消息总数”的显示，完全没有任何附件上传进度条、传输速率或吞吐提示**；
- **后果**：
  桌面端用户在大文件传输期间没有任何感知，界面长时间静止，极易误以为程序假死或断开。

#### 缺陷 (2)：附件下载完全脱离状态管线与统计
- **代码位置**：[`pkg/server/chat.go:1040-1094`](file:///home/yelon/develop/me/eqrcp/pkg/server/chat.go#L1040-L1094) 的 `handleAttachmentDownload`
- **缺陷表现**：
  在正常（非限速）状态下，Chat 附件下载直接委托给标准库的 `http.ServeFile(w, r, attachment.Path)`。
- **后果**：
  附件下载完全是“旁路行为”：服务端没有记录该客户端正在下载哪个附件、下载进度是多少，GUI 无法看到谁在拉取附件，Web 端也无下载进度通知，完全依赖浏览器自带的原生下载条。

#### 缺陷 (3)：免额超限（降级限速模式）下 HTTP Range 断点续传彻底瘫痪（高危）
- **代码位置**：[`pkg/server/chat.go:1073-1091`](file:///home/yelon/develop/me/eqrcp/pkg/server/chat.go#L1073-L1091)
- **缺陷表现**：
  当免费额度耗尽进入降级模式后，代码执行如下限速逻辑：
  ```go
  if isFreeLimitExceeded {
      // ...
      throttled := &ThrottledReader{r: file, limit: FreeChatDegradedBytesPerSec, active: true}
      w.Header().Set("Content-Length", strconv.FormatInt(attachment.Size, 10))
      _, _ = io.Copy(w, throttled)
      return
  }
  ```
- **致命后果**：
  - **完全忽略了请求的 `Range` Header**！当客户端（尤其是 iOS Safari 或移动端播放器）在限速模式下尝试拖动视频进度条、断点续传、或发送探测请求（`bytes=0-1`）时，服务端根本不予理会，直接无视 Range 头并从第 0 字节开始以 100KB/s 龟速强行推送全量文件！
  - 客户端无法断点续传，一旦移动端息屏中断，重连后必须从 0 字节重新开始下载，弱网体验极其糟糕。

#### 缺陷 (4)：SSE 长连接事件通道的休眠唤醒竞争
- **代码位置**：[`pkg/server/chat.go:1100-1160`](file:///home/yelon/develop/me/eqrcp/pkg/server/chat.go#L1100-L1160)
- **缺陷表现**：
  Chat 的即时事件通知依赖内存通道订阅（`subscribers map[chan struct{}]struct{}`）。当移动端手机息屏或退到后台时，TCP 连接处于挂起或丢包状态，通道触发非阻塞丢弃；手机重新点亮时，前端若未及时对齐最新消息的 `seq` 序号，容易出现消息暂时漏显，直到下一次主动心跳或拉取轮询才补齐。

---

## 五、 治理总结与后续改进建议

1. **Share 模式修复优先级：P0（紧急）**
   - **不要回滚** b05e2ac5 / fddf19c4——回滚会丢失 ZIP 双通道隔离的有益设计；只改判定逻辑本身；
   - 立即移除 `getClientDownloadedAndTotal` 中脆弱的 `len(progress) == 1` 判定（`server.go:2087`）；
   - 推荐采用**显式会话下载模式**（`ActiveMode: "zip" | "item"`）在请求入口标记活跃通道，彻底消灭 map 长度猜想——因为仅去掉 `len==1` 无法区分“先下单项后下 ZIP / ZIP 与单项交替”时 `-1` 键与单项键共存的场景；
   - 务必让完成判定分支（`server.go:2079`）与进行中分支（`server.go:2087`）对“何为 ZIP 模式”共用同一判据，避免“完成态与进度显示撕裂”。
2. **Receive 模式修复优先级：P1（高）**
   - 增强 Tus 批量上传完成判据（防掐断杀进程）：严禁未获完整文件清单或未收到前端明确的 `done=true` 信号即触发 `autoStop`；若触发 init 迟到，其破坏性（P0/P1）高于 UX 表现，需在联调复现中加固；
   - 修复普通 Multipart 上传循环中的流式进度上报，避免“0% 瞬间跳 100%”；
3. **Chat 模式优化优先级：P2（中）**
   - 修复降级限速模式下的 HTTP Range 协议缺陷（高危），包装 `ThrottledReadSeeker` 交由 `http.ServeContent` 恢复标准 206 状态码与断点续传；
   - 将 Chat 附件的大文件上传进度与状态通过 `ChatStatusSnapshot` 扩展映射到桌面 GUI，消除桌面端在大文件传输时的“静默感”。

> **进展（2026-09-08 已全部闭环落地）**：
> 1. **Share 模式**：缺陷已随提交 `43375368`（解进行中 ZIP 死锁，引入 `clientActiveItem` 显式活跃通道）与 `26f2b366`（统一完成判定与活跃通道判据，补齐交替测试）闭环修复。P0 项已达成。
> 2. **Receive 模式**：Tus 假完成安全门禁（引入 `FilesDeclared` 严密门禁，并在 `?done=true` 处规范触发批次完成与 `autoStop`）与 Multipart 回退流式进度上报（读取循环增量累加、节流上报、修复单文件跳 100% 误判）已随提交 `bfda3362` 修复并增加专项回归测试。P1 项已达成。
> 3. **Chat 模式**：
>    - **HTTP Range 缺陷修复**：随提交 `1eba61c6` 闭环修复（封装 `ThrottledReadSeeker` 并接入标准库 `http.ServeContent`，彻底恢复 RFC 7233 / RFC 9110 语义及 206 Partial Content 支持，覆盖 Safari 探测与拖动 Seek 专项回归测试）；
>    - **桌面端任务托盘与在传感知**：随提交 `7f191033` 闭环落地（新建模块化组件 `chat_tray.js`、150ms 节流触发 `notifyChatStatusHook` 消除静默黑盒、桌面端只读微秒级快照、Chrome 9222 E2E 仿真多场景验证、版本号递增至 `v1.36.66`）。P2 项已全部达成。

> **提交审查（2026-09-08，针对 `bfda3362` 的代码复核）**：
> - **门禁收益核实通过**：Tus 常驻路径 `ReceiveTo`（`server.go:646-661`）的门禁使未调 `?init=true` 的客户端在首个文件后进入 `State="waiting"` 而非 `completed`；而 `isAllActiveClientsFinished`（`server.go:1538/1577`）只认 `completed/failed`，故 `waiting` 态**不会触发 `signalStopAfterStatusGrace` 强杀**——洞察 1 的防掐断目标成立。正则前端（`?init=true` → `FilesDeclared=true` → Tus → `?done=true`）全程不触发门禁，行为不变。
> - **一项「通道门禁不对称」备忘（非当前 bug）**：`FilesDeclared` 门禁**只存在于 `ReceiveTo`（Tus 常驻 goroutine 通道）**；而 `New()` 内联 Multipart 段（`server.go:3356-3658`，`srv.mux` 直接到达，测试 `TestReceiveMultipartProgress_MultiFileStreaming` 所走路径）**不含该门禁**，仍无条件 `completed`。当前 Multipart 流量正好走这条无门禁通道，故**不存在"普通 Multipart 被卡 waiting"回归**；但两条通道行为不对称——若未来把 Multipart 迁入 `ReceiveTo` 常驻路径，将突然获得 waiting 语义。鉴于此门禁以 `waiting` 兜底无 init 客户端本身是设计意图（宁停 waiting 不误杀），此备忘仅提示将来统一通道时需同步门禁。
> - **测试质量确认**：`receive_progress_gate_test.go` 覆盖门禁正反例（init 后 2 文件仅完成 1 不误标、全部完成才 completed、无 init 经 `?done=true` 显式完成）与 Multipart 连续进度、单文件跳 100% 修复，断言的是"不误杀、连续上报"的语义而非表面值，符合测试意图校验原则。

> **提交审查（2026-09-08，针对 `1eba61c6` 与 `7f191033` 的代码复核）**：
> - **Range 契约核实通过（`1eba61c6`）**：`ThrottledReadSeeker` 将底层限速与文件 Seek 能力解耦，移交标准库 `http.ServeContent` 后，响应状态码从错误的 `200 OK` 恢复为合规的 `206 Partial Content`，响应头附带 `Content-Range: bytes 0-1/xxxx` 与 `Accept-Ranges: bytes`。Safari 媒体嗅探与断点续传恢复正常，且带宽限速（100KB/s）持续生效。
> - **任务托盘架构与防竞态核实通过（`7f191033`）**：
>   1. **无感与非阻塞**：`updateUploadProgressMessage` / `updateDownloadProgressMessage` 采用 150ms 节流触发 `notifyChatStatusHook`，既保证了传输进度的及时反馈，又避免高频刷新拖慢底层 I/O；`statusSnapshotLocked` 遍历内存只读消息生成 `ActiveTransfers`，微秒级返回；
>   2. **抗并发竞态**：前端组件 `desktop/gui/frontend/src/components/chat_tray.js` 采用多项列表结构（List）而非单行副标题，从根本上消除了多文件并发上传时标题抢占覆盖的竞态；
>   3. **E2E 真实仿真验证**：经 Chrome 9222 实测单文件传输、多文件并发在传、动态完成自动收起及真实 Chat 页面协同，符合前端模块化、无内联事件、无原生弹窗等工程规范。
> - **第二轮深化审查与加固落地（针对三条实质审查意见）**：
>   1. **解耦状态机副作用（意见 1）**：原节流分支调用 `statusSnapshotLocked("active")` 会使进度刷新副作用推进 `session.state="active"` 并自增 `statusSeq`。已重构为纯只读快照函数 `readStatusSnapshotLocked()`（传入空字符串 `""`），彻底杜绝纯进度刷新对会话状态机和序列号的污染；
>   2. **补齐下载方向对称测试（意见 2）**：新增 `TestChatActiveTransfersDownloadLifecycle` 专项单测，覆盖下载开始（`receiving=true`）、流式更新到完成清空（`receiving=false`）的完整生命周期，断言 `receiving=false` 能够立即清空托盘并保持 `statusSeq` 零副作用；
>   3. **锁内 O(N) 遍历演进规划（意见 3）**：当前在 150ms 节流下内存遍历数百条消息耗时约几微秒，但在数千条消息长会话下存在锁持有线性增长的张力。已在 Roadmap 文档 `docs/future/20260908-transfer-status-projection-architecture.md` 中立项，规划为**增量维护哈希表（`activeTransfers map[string]ChatActiveTransfer`）**，在附件收发时 O(1) 维护，彻底与消息总量 N 解耦。

---

## 六、 三模式传输与状态显示方案 · 横向工程实践对标

> 附注：对标基于 HEAD `26f2b366` 的当前实现。目的是评估三套模式各自的「传输协议选型」与「状态显示方案」是否符合工程最佳实践、是否适配各自场景。

### 0. 宏观状态模型：横切问题（结构债）

`Server` 结构体（`pkg/server/server.go:97-145`）是**多锁 + 多状态集**的混合体：

- **锁**：`statusMu` / `downloadedItemsMu` / `downloadedBytesMu` / `clientMutex` / `clientStatesMu` / `expectedBytesMu` / `tusMu` / `clientSpeedTrackersMu` / `clientSubDirsMu` / `lastHookTimeMu`，合计 **10 把互斥锁**；
- **状态集**：`status/transferStatus`（全局单例）、`clientStates`（每设备）、`clientProgress`（每设备每项字节）、`downloadedItems/Bytes`、`tusUploadsDone/Total`、`ChatStatusSnapshot`（经 hook 回调与 chatSession 产出） —— 合计 **6 套并行记账模型**。

**判断**：这不是"符合领域建模的单一真相源"设计，而是**逐需求堆叠生长**的结果。好处是各通道隔离、故障面小；代价是三套状态互相独立，当前暴露的"Share 有进度、Receive 黑洞、Chat 无进度"三级落差**正源于此**。当前优先级（修复 bug、不重构）下可接受，但应在 roadmap 单列"统一状态接口"，**不应继续新增第 7 套模型**。

### 1. Share（下载）—— ✅ 最符合实践，最匹配场景

- **传输协议**：HTTP Range + 并行 chunk + 断点续传（`server.go:2773` 解析 Range；`expectParallelRequests` 于 `server.go:109,743`；`isAlreadyTransferring` 于 `server.go:2778` 保护并发 Range 请求不重置进度）。下载以吞吐为第一诉求、浏览器原生能力强，Range+并行分片**贴合 HTTP 语义、天然断点、支持 Safari Range 探测 `bytes=0-1`** —— 协议选型正确。
- **状态显示**：`clientProgress map[client]map[item]bytes` 按设备/按单项记账 + `clientActiveItem` 活跃通道；经逐步修复后，进行中/完成判定统一以 `isClientZipModeLocked`（`server.go:1945`）为准，O(1) 判定、零分配、`/status` 高频轮询微秒级返回——**完全符合本项目后端规范第 1/2 条**（非阻塞、内存缓存优先）。
- **遗留**：`statusHandler`（`server.go:2182`）采用**客户端轮询 `/status` 而非服务端推送**。对 Share（单设备、低刷新率、LAN 内）轮询足够且更简单，**适配当前场景**，无需强上 SSE/WebSocket；若将来设备数激增再评估。

**结论**：Share 协议与状态显示**双达标，是三模式参考范本**。

### 2. Receive（上传）—— ⚠️ 协议优秀，但面临假完成破坏风险与进度黑洞

- **传输协议**：现代浏览器走 **Tus 分块断点上传**（`server.go:3623` `handleTusUpload`），弱网/回退走 **Multipart**（`server.go:3360`）。Tus 是大文件上传的**正确答案**（断点续传、可恢复、抗弱网抖动），协议层符合最佳实践。
- **两大致命/薄弱短板（含 Severity 重新排序）**：
  1. **Tus 边界假完成与强杀服务（Severity 最高，破坏级风险）**：
     - 代码位置：[`pkg/server/server.go:643`](file:///home/yelon/develop/me/eqrcp/pkg/server/server.go#L643)。
     - **危害性质**：破坏性强杀。在 `autoStop` 且无 KeepAlive 条件下，一旦完成判定被提前满足，服务端将在 15 秒后强行终止进程，正在排队或传输中的后续文件将被物理掐断。
     - **严谨限定（推断 vs 实测边界）**：正如第三节缺陷 (3) 所述，正常流程下 Web 前端会先调用 `?init=true` 预置完整文件列表，此时不会误触发。但**一旦因弱网丢包、init 请求异步迟到、或第三方客户端直接调用 Tus 协议**，`cs.Files` 为空或仅含单项，首个分片即可误判为全部完成。虽然该边界条件尚需前后端联调实测复现确认，但从 **Severity（故障破坏度）** 审视，“文件传输被截断、进程被强杀”的严重性（P0/P1）显著高于“看不到进度”的 UX 缺陷。
  2. **Multipart 回退是“完全不接报”的流式黑洞（UI/UX 级缺陷）**：
     - 代码位置：`server.go:3391-3414` 读取循环只累加局部 `currentFileWritten`，**全程不刷新任何进度字段**，直到 `server.go:3457-3458` 才在写入完成后瞬间写死 `BytesDone=BytesTotal, Percent=100`。大文件传输全程 UI 零反馈——与 Share 逐块记账形成鲜明反差。
     - **两套记账源并存**：Tus 用 `tusUploadsDone/Total`（`server.go:429-451, 576-598`），Multipart 用 `currentFileWritten`+客户端状态覆盖。同一个“接收进度”被拆在两套模型里，`/status` 无法给出统一、连续的百分比。

**判断与优先级**：
- 若按 **Severity（系统性破坏度）**：**Tus 完成门禁加固 (P0/P1) > Multipart 进度黑洞 (P2)**，防范数据被掐断具有第一优先级；
- 若按 **用户日常感知脱节度**：Multipart 进度黑洞最为突兀。
- **治理路线**：安全上优先加固 Tus 完成门禁（严禁未获完整文件清单或未收到明确完成信号即触发 `autoStop`）；体验上在 Multipart 读取循环按块增量上报（复用 `updateClientStatus` 的 `BytesDone`），缝合两处断层。

### 3. Chat（附件）—— 🔸 核心模型匹配，但存在协议级功能缺陷与状态旁路

- **传输协议**：附件上传走 Tus；正常态下载走 `http.ServeFile`（标准库原生自带 Range 支持）。Chat 是"消息实时 + 附件低频偶发"，附件非主路径，Tus 上传 + ServeFile 下载是**合理的轻量选择，不过度设计**。
- **状态显示**：用 `ChatStatusSnapshot`（消息数/设备数/State）而非字节进度——**与 Chat 场景正确匹配**（Chat 的"传输状态"本质是"消息是否送达/设备是否在线"，非文件吞吐）；用摘要而非大进度条，是**恰当的场景化建模**，不应照搬 Share 的进度条。
- **关键问题分析（区分协议缺陷与架构旁路）**：
  1. **协议级功能缺陷（高危破坏，违反 HTTP RFC 语义契约）**：
     - 代码位置：[`pkg/server/chat.go:1073-1091`](file:///home/yelon/develop/me/eqrcp/pkg/server/chat.go#L1073-L1091) 的免额超限限速逻辑。
     - **技术本质**：当客户端携带 `Range: bytes=...` 请求分段时，限速逻辑直接无视 Range 头，使用 `io.Copy(w, throttled)` 强行返回 `200 OK` 并从第 0 字节全量以 100KB/s 龟速推送！这**直接违反 HTTP RFC 7233 / RFC 9110 规范**（应返回 `206 Partial Content` 并提供指定分段数据）。
     - **严重后果**：这**绝非轻微的“代码坏味道”，而是破坏基础功能的协议级缺陷**。iOS Safari、各类移动端视频/音频播放器在加载媒体时均强制依赖 Range 探测（如探查头部 moov box 或拖动时间轴 Seek）。一旦服务端返回 200 而非 206，播放器将直接报错、无法加载或 Seek 失败；弱网中断后断点续传彻底瘫痪，必须从 0 字节重新拉取。
     - **规范修复方向**：不得简单 `io.Copy`，应封装实现带限速的 `io.ReadSeeker`（如 `ThrottledReadSeeker`），交由标准库的 `http.ServeContent` 托管，由标准库完整处理 Range 协商、`206 Partial Content` 状态码和响应头。
  2. **状态旁路（架构味道）**：
     - **附件上传**时桌面 GUI 只见摘要、不见附件进度 → 大文件期间呈“静默黑盒”；
     - **附件下载**（`chat.go:1093` `http.ServeFile`）完全脱离统计管线。

**判断**：核心状态模型（摘要）**适配**当前即时消息场景，但：
- **降级限速无视 Range 属于高危协议级缺陷，必须正确定级并优先消除**（消除与第三节定性落差）；
- 附件字节流脱离统计属于耦合泄漏，若将来大附件增多，应让附件进度**以子资源维度并入 `ChatStatusSnapshot`**（体现"某附件传输中 x% / 速率"），消除 UI 盲区。

### 4. 横向对比总结

| 维度 | Share | Receive | Chat |
| :--- | :--- | :--- | :--- |
| 传输协议选型 | ✅ Range+并行 | ✅ Tus | ✅ Tus/HTTP |
| 状态显示连续性 | ✅ 逐块记账、O(1) | ❌ 回退黑洞、两套源 | 🔸 摘要匹配但附件旁路 |
| 与场景匹配度 | ✅ 高度匹配 | ⚠️ 最不匹配 | 🔸 大体匹配 |
| 最需改进 | 无（已达标） | **Tus 门禁加固 (高危) + 回退进度上报** | **修复 Range 协议缺陷 (高危) + 附件并入快照** |

**一句话结论**：
- **Share 是标杆**，协议与状态双优，证明本项目完全有能力做好方案；
- **Receive 差距不仅在反馈，也在安全门禁**——Tus 协议虽好，但需补齐防强杀门禁以排除排队截断隐患，并将 Multipart 回退接到连续进度上，方可与 Share 看齐；
- **Chat 核心建模是对的**（不该套总进度），但必须**坚决根治降级限速破坏 HTTP Range RFC 规范的协议级功能缺陷**，并将附件字节流逐步从“状态旁路”收编为快照内的一等公民。

**治本建议（Roadmap 级演进路线，附带双重实施约束）**：
三套状态模型各为其政，造就"Share 有进度、Receive 黑洞、Chat 无进度"的三级落差。长远应探索**“底层物理轻量隔离 + 输出层 `ToSnapshot()` 投影模式 (Projection Pattern)”**：
- **架构构想**：底层各通道继续保留简单、低开销的原子变量或轻量互斥锁（如 `clientMutex`），不强推全局大一统粗粒度互斥锁；在面向 API、GUI 或状态轮询输出时，由各模式统一实现 `TransferState` 领域抽象接口并单向投影为标准化快照（包含类型、目标维度、已/总字节、速率、活跃通道），使 10 把锁 / 6 套表的外部观测视图收敛归一。
- **双重实施约束（红线声明）**：
  1. **范围红线**：此模式属于**长期架构演进方向（Roadmap 级），明确超出本次紧急缺陷修复范围**。严禁在当前阶段大动干戈重构状态模型，避免稀释聚焦或引入新的并发死锁风险；
  2. **能力边界**：**投影层解决的是外部读取视图与展现语义的一致性，绝无法凭空变出底层缺失的物理数据**。例如，Multipart 回退若底层 reader 持续不累加不汇报，上层无论如何抽象投影也只能投射出 0。底层数据补齐（如 Reader 逐块上报）始终是不可逾越的前置条件。短期应集中精力按上表优先补齐 Tus 门禁与 Receive 回退进度上报。
