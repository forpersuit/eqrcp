# 附件传输、流式进度与气泡生命周期规约 (Attachment Transfer & Bubble UX Guidelines)

## 目录 (Table of Contents)
- [1. 气泡强驻留性与接收端下载状态解耦](#1-气泡强驻留性与接收端下载状态解耦)
- [2. 无蒙版纯净文件卡片与行内进度展示](#2-无蒙版纯净文件卡片与行内进度展示)
- [3. 移动端原生文件选择器与 Label 绑定防呆](#3-移动端原生文件选择器与-label-绑定防呆)
- [4. 流式批量下载与纯图标状态徽标](#4-流式批量下载与纯图标状态徽标)
- [5. 移动端 WebSocket 生命周期与后台轻量保活](#5-移动端-websocket-生命周期与后台轻量保活)
- [6. 底层流式分块与进度监听](#6-底层流式分块与进度监听)
- [7. 移动端息屏唤醒状态同步与防假完成红线](#7-移动端息屏唤醒状态同步与防假完成红线)
- [8. 系统代理屏蔽与局域网直连准则](#8-系统代理屏蔽与局域网直连准则)

---

## 1. 气泡强驻留性与接收端下载状态解耦

- **规格来源**: `pkg/chat/v2/web/src/components/MessageList.svelte` 与 `src/App.svelte`
- **第一性原理 (Bubble Retention Guarantee)**:
  - 聊天流中，一旦文件/图片由发送方成功投递，气泡及其核心实体信息（文件名、大小、缩略图、菜单）**具有强驻留性**。
  - **唯一合法移除/变更气泡内容的前置条件**:
    1. 发送方主动撤回消息（`recall_message` / `msg.recalled`）；
    2. 发送方自身在上传尚未完成时取消了上传（`ulTx.state === 'cancelled' && msg.uploading`）；
    3. 用户在本地手动执行了气泡删除。
- **接收端下载状态 (`dlTx`) 解耦**:
  - 接收方点击下载附件后，无论发生何种本地端行为（关闭保存对话框、取消下载、网络超时、批量保存文件夹取消），**均仅属于该客户端单向的本地任务状态变化**。
  - **红线规则**: 严禁将接收方的取消下载（`dlTx.state === 'cancelled'`）误判为“文件取消发送”（`isCancelledFile`），严禁自动抹除、替换或隐藏收到的文件卡片。
  - **正确行为**: 下载取消或失败时，气泡卡片 100% 完整保留，副标题仅作状态标注（如 `· 已取消`、`· 传输失败 ⚠️`）；右键/长按菜单中随时保留重新下载入口。

---

## 2. 无蒙版纯净文件卡片与行内进度展示

- **规格来源**: `pkg/chat/v2/web/src/components/MessageList.svelte`
- **彻底移除遮罩与旋转 Spinner**:
  - 严禁在文件/图片卡片上层覆盖半透明或模糊蒙版（如 `.upload-mask`）及全屏旋转加载圈。文件类型图标与文件名在上传/下载全生命周期中必须 100% 清晰可见。
- **行内极简副标题收敛 (Inline Subtitle Feedback)**:
  - 在卡片副标题区域（`.file-subtitle`）收敛所有阶段状态与进度。百分比自身已表达“传输中”，无需重复添加“上传中/下载中”等冗余文字：
    - **发送方上传**: `大小 · xx%`（落盘校验中保持 `· 99%`），完成后切换为 `大小 · 已分享`；
    - **接收方下载**: 初始时仅显示纯净大小（如 `27 Bytes`），杜绝提前虚假标记；下载中显示 `大小 · xx%`，完成后切换为 `大小 · 已下载`；
    - **异常与取消**: 分别显示 `· 传输失败 ⚠️`（红色下划线悬停显示错误详情）或 `· 已取消`。
- **接收端状态解耦**: 服务端 `msg.Downloaded` 语义表示服务端附件缓存已就绪，接收端展示必须且仅能由本地真实的 `dlTx` 任务或内嵌环境落盘路径驱动。

---

## 3. 移动端原生文件选择器与 Label 绑定防呆

- **规格来源**: `pkg/chat/v2/web/src/components/Composer.svelte`
- **杜绝 `display: none` 隐藏文件输入框**: iOS Safari 针对文件输入框实施严格渲染树保护，任何 `display: none` 的文件输入框被通过 JS `.click()` 调用时会被静默拦截拒绝弹窗。必须使用屏幕外微尺寸透明隐藏（`position: absolute; width: 0.1px; height: 0.1px; opacity: 0; overflow: hidden; z-index: -1; pointer-events: none;`）。
- **原生 `<label for="...">` 绑定**: 移动端与 Web 端为 `<label>` 显式绑定 `for="chat-file-input"`。在非嵌入式环境下，点击事件严禁调用 `e.preventDefault()` 或手动 `fileInput.click()`，交由浏览器内核原生处理手势激活（User Activation），防止 WebKit 拦截对话框。
- **图标子节点穿透**: 确保 `<label>` 内的 `<svg>` 与图标节点带有 `pointer-events: none`，防止触控点落在子节点导致事件捕获异常。
- **嵌入式环境条件代理**: 仅在 Wails 嵌入宿主（`isEmbedded`）下移除 `for` 属性并在点击时调用 `e.preventDefault()`，代理发送 `select-files` 调起宿主原生对话框。

---

## 4. 流式批量下载与纯图标状态徽标

- **规格来源**: `pkg/chat/v2/web/src/App.svelte` 与 `pkg/chat/v2/http/routes.go`
- **直达系统下载与免冗余模态**:
  - 移动端多选后点击底栏“批量下载”，系统顶部弹出 Toast 提示打包信息，由单个 `<a download>` 调起系统原生下载管理器，不弹出应用内模态遮罩（彻底杜绝触摸穿透造成的误取消）。
  - 严禁在 `<a>.click()` 后重复调用 `window.location.href = zipURL`，杜绝多重导航导致浏览器网络栈自相 Abort。
- **语义化命名与 RFC 5987 响应头**:
  - 批量包命名反映包含关系：单文件为 `<name>.zip`，多文件为 `<首文件名>_等N个文件.zip`；
  - 服务端严格返回标准标头：`Content-Disposition: attachment; filename="<ascii>"; filename*=UTF-8''<percent-encoded>`，确保移动端浏览器系统下载弹窗中文不乱码。
- **结构化卡片与纯图标状态徽标**:
  - 系统消息中通过 `.system-batch-card` 完整渲染压缩包名称、总大小、文件总数与嵌入式文件清单；
  - 卡片右上角徽标采用纯图标（打包中：呼吸圆点；已完成：绿色勾选；已取消：中性灰叉；失败：浅红感叹号），严禁在卡片外部或聊天流尾部重复追加冗余的二次文本通知。

---

## 5. 移动端 WebSocket 生命周期与后台休眠/唤醒机制

- **规格来源**: `pkg/chat/v2/web/src/services/websocket.ts` 与 `src/services/visibilityPolicy.ts`
- **选文件保护与真息屏优雅休眠 (File Picking Lock & Graceful Sleep)**:
  - **选文件保护锁**: 移动端调起系统文件管理器、相册选择器时，页面会触发 `visibilityState === 'hidden'`。点击附件按钮即标记 `isFilePicking = true`（附带 60s 超时防呆），此状态下绝不断开 WebSocket。
  - **3 秒息屏延时休眠 (Grace Period)**: 非选文件状态下切换后台或真锁屏，启动 3 秒延时定时器。若 3 秒后仍处于 `hidden`，主动发起 `ws.close(1000, "page_hidden")` 优雅挂断并转入休眠态（`isSuspended = true`），避免移动端系统冻结网络导致半开僵尸连接（Zombie Connection）与长达数分钟的掉线脱节。
  - **后台挂起重连保护**: 处于后台隐藏且非选文件时，若连接中断，暂停触发递增重试，避免在用户口袋中无谓耗尽 10 次重连计数。
- **亮屏瞬间第 0ms 无缝唤醒**:
  - 用户唤醒屏幕或返回前台（`visible` / `focus`）时，清除延时定时器与选文件锁，重置重连计数；
  - 若处于休眠或已断开态，立即触发 `this.connect()` 重新拉取差量数据；若仍处于 `OPEN` 态，发送 `hb-probe` 心跳探针秒级校验对端存活。

---

## 6. 底层流式分块与进度监听

- **规格来源**: `pkg/server/server.go` 与 `pkg/server/transfer_progress.go`
- **规避 `io.ReaderFrom` 阻塞陷阱**:
  - 在封装的 `progressResponseWriter` 中，切忌将 `ReadFrom(r)` 直接委托给底层驱动，否则 Go 标准库会一次性阻塞读取整段文件直至 EOF，导致中间进度监听完全失活。
  - 必须采用定长分块（如 256KB）循环读取并通过 `w.Write()` 递增推送，确保每写入一个 chunk 立即触发进度监听，实时更新瞬时速率与已完成字节。
- **GUI 初始传输状态平滑展示**:
  - 渲染设备传输列表时，只要设备处于 `transferring` 且 `bytesTotal > 0`，立即渲染 0% 起步的平滑进度条，严禁加入 `bytesDone > 0` 的严苛前置条件，杜绝初始虚线跳变。

---

## 7. 移动端息屏唤醒状态同步与防假完成红线

- **规格来源**: `pkg/pages/assets/download.js` 与 `pkg/chat/v2/web/src/services/resumeConnection.ts`
- **唤醒第 0ms 主动同步**: 页面注册 `visibilitychange`、`pageshow` 与 `focus` 事件；在 `visible` 唤醒的第 0ms 主动触发一次状态同步，更新已完成字节数与完成态文本。
- **防假完成红线 (False-Completion Defense)**:
  - iOS Safari 弹起系统下载确认弹窗时网页失焦，网络栈开启大文件流时对并发状态查询可能返回 `status: 0`。
  - **红线规则**: 严禁在 `xhr.onerror`、连续网络错误或唤醒异常分支中调用 `showCompletedUI()`！网络错误只能提示重连等待（`waiting`），唯有服务端确凿返回 `state === 'completed'` 或 `bytesDone >= bytesTotal > 0` 时方可判定完成。
- **多文件 ZIP 与单项下载独立判定**:
  - 批量 ZIP 下载与单文件下载双通道隔离，ZIP 写入流严禁污染单项进度，单项判定支持物理文件尺寸 `os.Stat` 兜底，杜绝混用死锁。

---

## 8. 系统代理屏蔽与局域网直连准则

- **规格来源**: `desktop/gui/frontend/src/components/settings.js` 与 `pkg/server/server.go`
- **默认开启屏蔽系统代理 (`blockProxy: true`)**:
  - 局域网传输场景下，必须避免外部代理软件（如 Clash、全局代理）拦截私有 IP 与 `*.lan.eqt.im` / `*.direct.eqt.net.im` 局域网请求而引发 502 或超时。
  - 开启时，WebView2 注入 `--no-proxy-server`，Go 运行时清空代理环境变量；
  - 允许在高级设置中切换关闭：关闭后 WebView2 注入 `--proxy-bypass-list` 排除局域网 IP 段，公网流量（DRM、更新）可走代理，局域网流量强制免代理直连。
