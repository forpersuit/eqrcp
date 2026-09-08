# Share 模式进度条失效缺陷分析、高效修复方案与全传输模式 (Receive/Chat) 状态机制审计

> 状态：📝 审计归档（Open / Review）
> 审计日期：2026-09-08
> 涉及模块：`pkg/server/server.go`、`pkg/server/chat.go`、`pkg/pages/download.tmpl.html`、`pkg/pages/upload.tmpl.html`、`desktop/gui/frontend/src/main.js`
> 对应版本：v1.36.64

---

## 一、 Share 模式进度条失效缺陷分析

### 1. 现象复现
在 Share（发送/分享）模式下，无论是多文件分享还是目录分享：
- **移动端/浏览器端 H5**：点击“下载全部”打包 ZIP 时，顶部的总体传输进度条以及下载项进度始终停留在 `0%`（或 0 字节），直到全部字节流下载完毕瞬间跳到 100% 或直接结束；
- **桌面 GUI 端**：活跃设备列表中的该客户端进度条同样冻结在 `0%`，传输速度和已传输字节数均无法实时反映真实的物理网络吞吐。

### 2. 根因深度溯源（为何以前正常，现在不正常？）

#### (1) 引入变更与历史动机
该问题是在 **2026-09-04** 的提交 **`b05e2ac5`**（*Add 7-day log retention and fix Safari download progress reporting*）中被引入的。

**当时的修复动机**：
- 在更早的版本中，服务端将 ZIP 打包数据流写入客户端时，每写入一个数据块（chunk），会遍历当前所有单文件索引并将写入量累加到每个文件的 `progress[idx]` 中；
- 导致了一个严重的副作用（**假完成**）：若分享内容包含一个 10KB 的小文件和一个 500MB 的大文件，ZIP 刚传输了 100KB，小文件对应的字节统计就已提前达标，前端或服务端判定该子项“已完成”，导致 UI 进度条乱跳或提前触发 100% 假完成；
- 为解决小文件被 ZIP 流污染的问题，开发者试图将 **“整包 ZIP 下载”** 与 **“逐项单文件下载”** 在服务端做严格的数据通道隔离。

#### (2) 致命暗礁：苛刻判定与页面初始化的冲突
在 [`pkg/server/server.go:2087`](file:///home/yelon/develop/me/eqrcp/pkg/server/server.go#L2087) 的 `getClientDownloadedAndTotal` 函数中，引入了如下守卫逻辑：

```go
// server.go:2087 (commit b05e2ac5 引入)
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
8. 函数最终返回已下载字节 `clientDone = 0`，**两端进度条被彻底死锁在 0%**。

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

#### 缺陷 (1)：普通 Multipart 上传流式进度“黑洞”（0% 瞬间跳 100%）
- **代码位置**：[`pkg/server/server.go:3376-3450`](file:///home/yelon/develop/me/eqrcp/pkg/server/server.go#L3376-L3450)
- **缺陷表现**：
  在 `part.Read(buf)` 读写上传文件的数据流循环中，虽然累加了局部变量 `currentFileWritten += int64(n)`，**但循环内部完全没有调用 `updateClientStatus` 或更新全局 `status.BytesDone`**！
- **后果**：
  当用户通过非 Tus 通道（如脚本 curl、禁用 JS 的浏览器或特定设备）上传一个 2GB 的大文件时，整个上传过程中服务端和 GUI 的进度条始终保持在 `0%`（或停留在上一个文件的状态），直到整个文件读完、`out.Close()` 之后，才在行 3422 处瞬间写死 `cs.BytesDone = cs.BytesTotal, cs.Percent = 100`。完全丢失了传输过程中的进度反馈。

#### 缺陷 (2)：多文件普通上传的进度篡改与状态覆盖
- **代码位置**：[`pkg/server/server.go:3422-3423`](file:///home/yelon/develop/me/eqrcp/pkg/server/server.go#L3422-L3423)
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
  在批量上传场景下，前端 Tus 客户端是串行依次发起单个文件的上传。如果前端上传前调用的 `?init=true` 请求因移动端弱网抖动失败或晚于第 1 个文件到达，`cs.Files` 在第 1 个文件上传时只有当前单项（`len(cs.Files) == 1`）。
- **后果**：
  第 1 个文件一传完，`len(cs.SavedFiles) == len(cs.Files) == 1` 判定直接满足！服务端误以为所有文件已全部传输完成，将客户端置为 `completed`。若用户未开启 `KeepAlive`（单次传输模式）或启用了 `autoStop`，**服务端会直接触发 15 秒倒计时并杀死进程，导致排队中的后续文件上传直接被强行掐断**！

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
   - 立即移除 `getClientDownloadedAndTotal` 中脆弱的 `len(progress) == 1` 判定；
   - 引入显式的客户端传输模式标记，或以 `progress[-1] > 0` 且处于 ZIP 请求上下文为准，彻底打通 ZIP 模式下的进度实时管道。
2. **Receive 模式修复优先级：P1（高）**
   - 修复普通 Multipart 上传循环中的流式进度上报，避免“0% 瞬间跳 100%”；
   - 增强 Tus 批量上传完成判据：严禁仅依据单项完成即触发 `autoStop`，必须校验全局预声明的文件总量或等待前端明确的 `done=true` 信号。
3. **Chat 模式优化优先级：P2（中）**
   - 修复降级限速模式下的 HTTP Range 协议支持，包装 `ThrottledReadSeeker` 以支持断点续传；
   - 将 Chat 附件的大文件上传进度与状态通过 `ChatStatusSnapshot` 扩展映射到桌面 GUI，消除桌面端在大文件传输时的“静默感”。
