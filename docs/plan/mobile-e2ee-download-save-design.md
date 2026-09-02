# EQT 移动端 E2EE 下载：保存触发与内存受控实现方案

> 本文整合了「开发排查意见」、「审查复核（R1-R5）」以及基于第一性原理与 Web 运行机制的深度分析，形成最终指导落地的完整架构与实现规范。
>
> **第二轮补充审查决议（R6-R13）已并入**：基准提交 `4ccc9195`（2026-09-02）。第二轮审查以「实测代码现状 + Web 平台机制第一性原理」双基线复核，重点补足 Secure Context 前提、share 回退时序、停止路径孤儿、双阈值关系等正文缺口；决议对照与现状复核勘误见 §四 末。
>
> **第三轮细化审查决议（R14-R16）已并入**：基准提交 `20fb37e2`（2026-09-02）。聚焦 PendingFileDescriptor 契约收尾（失败回态/交付后回收/边界一致性）、含 IDB 文件的交付前置校验、局域网 HTTP 提示文案修订；决议对照见 §四 末。

---

## 一、概述与核心目标

E2EE 网页下载在浏览器端完成“拉取 4MB 分块 → Web Worker (XChaCha20-Poly1305, libsodium `crypto_aead_xchacha20poly1305_ietf_*`) 逐块解密 → 存储/重组明文”后，移动端（尤其是 iOS Safari 与部分 Android 浏览器）**无法可靠唤起系统保存/下载管理器**：进度走到 100%，文件却拿不到，用户只能无奈重新下载。

**目标与设计原则**（按优先级）：

1. **手势通路保底（主方案，首要落地）**：移动端建立“解密完成 → 用户亲手点击一键保存/分享”的**可靠手势通路**。首选 `navigator.share` 直达系统 Files/分享面板，但 **Web Share API 仅 Secure Context（https/localhost）可用**，http 部署下 `navigator.share` 为 `undefined` 且无法被 polyfill——故按钮 handler 内须**同步预判分流**：满足安全上下文且 `canShare({files})` 才走 share；否则本次直接同步 `a.download`。share 流程内失败**不二次改道**（见 R6/R10，避免手势耗尽后回退 click 被同样拦截）；
2. **大文件内存受控**：依托既有 IndexedDB 逐块落盘机制，将明文组装（`assembleBlob`/`File`）**延迟至用户点击保存时**，解密完成时（100%）不提前占用整文件内存；
3. **多文件场景第一性原理合流**：
   - **小文件集合（总大小 ≤ 150MB 且无大文件）**：支持【📥 全部保存到手机】（一次性将 `File[]` 传给 `navigator.share`：iOS 分享面板对多文件集可靠批量存入“文件”；Android 无等价“批量下载”系统目标，第三方 App 对多 `File` 数组接受度不一，按钮语义为“分享到所选应用”，列表另设逐条【📥 保存】兜底，见 R11）；
   - **大文件/超限集合**：严格遵循 Web 平台“单次手势仅允许单次 share 弹窗”的物理限制，禁止不可行的循环自动 share，转为引导用户在文件列表中【单独保存】各条目；
4. **桌面端零回退**：桌面 UA 保持现状自动 `a.click()` 触发原生下载管理器，无缝兼顾体验；
5. **存储与 URL 资源全闭环**：基于会话/时间戳的 IndexedDB 垃圾回收（解决移动端后台被杀导致 `pagehide` 丢失的孤儿碎片问题），以及 `objectURL` 单例精准释放；
6. **超大文件（GB 级）ServiceWorker 流式代理**：列为远期研究，明确平台限制（iOS 无法交付流式下载）后不做本轮主路径。

---

## 二、第一性原理剖析：为什么自动保存不可靠

### 1. E2EE 链路本质：“先解密重组，后交付系统”

| 模式 | 传输物 | 下载接管时机 | 终端结果 |
| :--- | :--- | :--- | :--- |
| **明文模式** | 服务端明文文件流 | 浏览器原生下载管理器在发起时直连 | 点击瞬间即进入系统下载管道 |
| **E2EE 模式** | 4MB XChaCha20-Poly1305 密文（密钥在 URL `#` 哈希，不过网） | 浏览器必须在内存/本地先拉取→逐块解密→重组明文 | 系统无法直接消费密文流 |

因此 E2EE 的真实运行管线恒为：`fetch chunk → decrypt → 内存/IndexedDB 缓冲 → assembleBlob/File → 触发保存`。这是端到端加密架构的下限，不可绕过（`download.tmpl.html`：`Pipeline.downloadFile` → `assembleBlob` → 保存）。

### 2. 用户手势过期拦截（Loss of User Activation）

现代移动浏览器对保存/下载/分享动作实施严格的安全限制（Transient User Activation）：
- 只有在“用户直接点击（用户手势活跃期内）”才能合法调起 `navigator.share` 或触发下载行为；
- 现状触发点 `a.click()`（`download.tmpl.html`:1208）位于 **异步解密完成的回调深处**，距最初点击已有数秒至数分钟——手势早已经失效，移动浏览器将其视作未授权的网页自动脚本弹窗下载。

**平台实际行为矩阵**：

| 平台 | 无手势 `<a download>` blob 的实际行为 | `navigator.share({ files })` 表现 |
| :--- | :--- | :--- |
| **桌面 Chrome / Edge / Firefox** | 允许，直接进入系统下载管理器（现状可靠） | 部分支持，但桌面首选直接下载 |
| **Android Chrome** | 多数直接后台下载（状态栏有提示），但大 Blob 易触发内存告警 | 调起系统分享面板（可分享到文件管理器、微信、云盘等） |
| **iOS Safari** | `<a download>` 语义弱化甚至失效，常尝试在标签页内打开或直接静默丢弃 | 最佳通路：调起系统分享面板，直接提供【存储到“文件”】选项 |

### 3. Web Share API 的手势单发铁律（Single-Activation Constraint）

Web 规范明确规定：`navigator.share()` 必须在一个活跃的 User Gesture 周期内被调用。
- 当第一个 `await navigator.share({ files: [f1] })` 执行并等待用户在系统面板操作完毕 resolve 后，**当前的用户手势活跃期已彻底消耗完毕**；
- 此时若在 JS 循环中继续执行第二个 `await navigator.share({ files: [f2] })`，浏览器将直接抛出 `NotAllowedError` 并拦截；
- 同理，短时间内连续调用多个 `a.click()` 也会被移动浏览器视为多窗口/多文件恶意弹窗而直接静默阻断。

**结论**：多文件无法通过代码内部循环“自动逐个弹窗 share”，多文件必须要么**一次性批量 share `File[]`**，要么**由用户在 UI 上点击各条目的【单独保存】按钮逐个触发**。

### 4. 移动端进程生命周期与 IndexedDB 碎片遗留

- **`pagehide` 的局限**：在 iOS Safari 和 Android Chrome 中，用户完成保存后直接锁屏、切后台或切换 App，系统常常直接挂起并回收（SIGKILL）页面进程，**根本不会触发 `pagehide` 或 `beforeunload`**；
- 若仅依赖 `pagehide` 清理 IndexedDB 分块，将导致未清理的 chunk 永久驻留用户手机存储，造成磁盘碎片泄漏；
- 必须引入**基于时间戳/会话 ID 的主动清扫（Prune）机制**。

### 5. 现状 UI 缺口

完成态文案目前仅有 `success_tips_all`：“传输已成功完成，您可以关闭此页面了”（`download.tmpl.html`:848），**缺乏任何保存动作的 UI 触点**。一旦自动 `a.click()` 失败，用户处于信息盲区且无法挽救。

---

## 三、方案合成与架构设计

### 整体架构流程

```mermaid
graph TD
    A[解密完成 100%] --> B{UA 分流判定}
    B -->|桌面 UA| C[自动 a.click 直接系统下载<br/>保持现状体验]
    B -->|移动 UA| D[切换至 decrypted-pending-save 态<br/>显式展示 📥 保存到手机 按钮]
    
    D --> E[用户点击保存 = 获得全新有效手势<br/>isSaving 锁定防抖]
    E --> F{多文件判定}
    
    F -->|单文件 或 总量≤150MB| G[延迟组装 Blob → File 对象<br/>释放中间 TypedArray 内存]
    F -->|多文件总量>150MB 或 含大文件| H[提示使用列表单独保存<br/>在各自独立手势下逐个保存]
    
    G --> I{Secure Context<br/>且 canShare({files})?}
    I -->|是| J[调用 navigator.share Files<br/>同一手势内一次调用]
    I -->|否| K[同步 a.click 直下载<br/>维护单例 activeSavedBlobUrl]
    
    J --> L{结果分类处理}
    L -->|Resolve 成功| M[提示已存入系统<br/>异步清理对应 IndexedDB]
    L -->|AbortError 用户取消| N[静默忽略, 保持页面就绪, 不自动改道]
    L -->|其他 Error| S[提示保存失败<br/>保持按钮可重试]
    
    K --> O[触发 a.click 保存]
    
    M --> P[释放 isSaving 锁, 恢复按钮可用]
    N --> P
    O --> P
    S --> P
```

### 核心机制详解

#### 1. 平台分流与 UI 状态机
- **桌面端**：解密完成后直接触发现有自动 `a.click()`，UI 显示“已开始下载”，零回退。
- **移动端**：解密达到 100% 后**不自动调用 `a.click()`**，页面进入 `decrypted-pending-save` 状态：
  - 进度条置为 100%（绿色完成态）；
  - 顶部/操作区展示大号高亮主按钮【📥 保存到手机】（多文件时为【📥 全部保存到手机】）；
  - 提示文案更新：“已在本机解密完成，请点击下方按钮保存到系统”；
  - **局域网 HTTP 模式动态提示（R6，文案经 R16 修订）**：若检测到 `!window.isSecureContext` 且为 iOS 设备，在按钮下方附带辅助提示：“（提示：当前为局域网 HTTP 访问，iOS 下无法分享到“文件”；请改用 https 地址打开本页，或换用桌面端下载）”。原草案“长按预览保存”表述易误导——blob 资源在 iOS Safari 长按通常无“保存到文件”菜单（仅图片类可存图），已删除。

#### 2. 解密与交付解耦（R7）：Pending 数据结构与组装延迟
- **职责拆分**：将现状 `downloadFile`（解密+组装+下载合一）拆解为两阶段：
  1. **后台解密阶段（Pipeline 负责）**：网络拉取与 Worker 解密，完成后向会话注册 `PendingFileDescriptor`，**不组装 Blob，不触发保存，不清理存储**；
  2. **手势交付阶段（UI Controller 负责）**：用户点击保存按钮，在活跃用户手势上下文中消费 pending 记录，执行组装并调起保存。
- **待交付元数据契约（PendingFileDescriptor）**：
  ```javascript
  // 会话级待交付表: sessionPendingFiles = new Map<string, PendingFileDescriptor>()
  {
      fileId: 'f-0',
      fileName: 'document.pdf',
      fileSize: 1048576,
      mimeType: 'application/pdf',
      totalChunks: 1,
      storeType: 'memory' | 'idb', // <256MB 为 memory, ≥256MB 为 idb(与 LARGE_FILE_THRESHOLD 的 `>=` 判定一致)
      chunks: [Uint8Array],        // 仅 storeType === 'memory' 时有效
      status: 'pending_save'       // 'pending_save' | 'delivering' | 'delivered'
  }
  ```
- **storeType 单一真源（R15）**：`storeType` 必须在解密启动时由同一判定函数（封装现状 `totalBytes >= LARGE_FILE_THRESHOLD && window.indexedDB` 语义，`download.tmpl.html`:1130）求值一次并写入 descriptor；交付侧**不得按 size 自行重算**（无 IndexedDB 环境下大文件实际落内存，重算会错判）。
- **注册时机（R16）**：`PendingFileDescriptor` 仅在单文件**全部 chunk 完整落位**后一次性注册进 `sessionPendingFiles`；解密中途（停止/失败）不注册半成品——交付永不组装不完整文件（半截残留由 R8 停止清理负责）。
- **状态转移与失败回态（R15）**：`pending_save` → 用户点击交付 `delivering` → 成功 `delivered`；**失败（含 AbortError 与致命异常）一律回退 `pending_save`**，保留 `chunks`/IndexedDB 数据供再次点击重试。
- **交付后收尾（R15）**：置 `delivered` 后统一 `finalizeDescriptor`：`storeType === 'idb'` 调 `clearFile(fileId, totalChunks)`；`storeType === 'memory'` 置 `descriptor.chunks = null` 释放引用；记录自 `sessionPendingFiles` 移除或标记可回收（配合 §三.6 清理）。
- **GC 保护**：在点击手势中完成 `assembleBlob` 后，立即将 `descriptor.chunks` 设为 `null`，确保内存中仅保留最终传递给系统的单一 `File` 实例。

> **阈值与时机边界诚实声明（R9）**：本方案两套数值正交——现状 IndexedDB 流式阈值 `LARGE_FILE_THRESHOLD = 256MB`（`download.tmpl.html`:1049）；150MB 是**新增的 share 聚合预算**，非 IDB 阈值。未达 256MB 的文件解密期整驻内存数组（150~256MB 之间单文件仍可能吃紧），达阈值才逐块落 IDB。
> 且**延迟组装只能把峰值推迟到点击手势内，并不能消除**：现状 `assembleBlob`（`download.tmpl.html`:1004-1014）在用户点击时仍需一次性从 IDB 读出全部 chunk 构成 Blob，峰值内存≈文件大小，可能造成 GC 长停顿或被系统杀。因此对已入 IDB 的大文件（≥256MB）移动端应在 UI 如实标注“建议桌面端保存”，点击时组装建议分帧/分批进行；真正的峰值消除路径仍是 ServiceWorker 流式（远期，见风险矩阵）。

#### 3. Web Share API 深度集成与多文件处理策略
- **MIME 类型映射**：通过文件名后缀推导标准 MIME（如 `.jpg` → `image/jpeg`, `.pdf` → `application/pdf`, `.zip` → `application/zip`），未匹配时回退 `application/octet-stream`，提升 `navigator.canShare` 成功率。
- **多文件分流规则**：
  - **规则 A（小集合批量 Share）**：若 `files.length > 1` 且 `Σ(file_size) <= 150MB` 且均未启用 IndexedDB，一次性生成 `File[]` 数组传递给 `navigator.share({ files })`。iOS Safari 原生分享面板支持将整个多文件集一次性存入指定文件夹；Android 无等价“批量下载”目标，多 `File` 数组的接受度依目标 App 而异，按钮语义定位为“分享到所选应用”，并保底列表逐条【📥 保存】（R11）。
  - **规则 B（大集合/大文件降级）**：若总大小 > 150MB 或包含 IndexedDB 大文件，主按钮提示“文件集较大，建议在下方逐个保存”，同时在文件列表各行展示【📥 保存】按钮。
- **单文件条目独立保存**：文件列表中的各条目拥有独立的【📥 保存】按钮，用户点击单项时直接针对该文件执行“延迟组装 → 单文件 Share / Download”。

#### 4. 预判分流（Pre-check Branching）与异常分类处理（R6 / R10）
- **同步预判分流（严禁异步失败改道）**：
  ```javascript
  function canUseWebShare(fileList) {
      if (!window.isSecureContext) return false;
      if (!navigator.share || !navigator.canShare) return false;
      try {
          return navigator.canShare({ files: fileList });
      } catch (e) {
          return false;
      }
  }
  ```
- **交付前置校验（R14，组装之前执行）**：组装成本决定通路——目标集合（单文件或批量）若含任一 `storeType === 'idb'`（≥256MB，点击时须从 IndexedDB 整读，峰值≈文件大小且耗时可能超出 Transient Activation 存活窗），则该集合**整体不进 share**，也**不期望移动端 `a.download` 成功**（否则落入“点击→组装超窗→NotAllowedError→重试”循环）；UI 须在点击**前**即对此类文件展示“文件较大，建议桌面端保存”（R9 的交付侧落地）。全部 `storeType === 'memory'` 的小集合才正常走下述预判分流。
- **分支执行流**：
  1. **Web Share 分支**（`canUseWebShare` 成立）：在当前手势内直接调用 `await navigator.share({ files })`；
     - `AbortError`（用户点击取消/关闭分享面板）：属于正常交互，**静默忽略**，释放 `isSaving` 状态锁，保持页面与按钮就绪，**绝不报错也绝不自动切道**；
     - 其他致命异常：提示“保存失败，请点击重试”，保持按钮可再次点击；
  2. **同步 a.download 分支**（非安全上下文或 `canShare` 不满足）：在当前有效手势内**直接同步**生成 Object URL 并调用 `a.click()`（维护 `activeSavedBlobUrl` 单例）。

#### 5. `activeSavedBlobUrl` 生命周期精准闭环
- `navigator.share` 直接传递 `File` 内存对象，**不产生任何 Object URL**；
- 仅当预判分流走 `a.download` 分支时才调用 `URL.createObjectURL(file)`；
- 维护全局单例 `activeSavedBlobUrl`：在生成新的下载 URL、会话重置或页面卸载时显式调用 `URL.revokeObjectURL`，替代脆弱的 10 秒固定定时器，作为多按钮/重复保存场景的 URL 生命周期互斥保护（**归因澄清（R13）**：revoke 时机并非移动端保存失败的根因——已开始的下载不再依赖 URL；移动端失败根因是 iOS 对 `<a download>` 语义不支持）。

#### 6. IndexedDB 全生命周期与过期清扫机制（Session Pruning）
- **数据结构**：在 IndexedDB `chunks` 记录中附带 `createdAt`（时间戳）与 `sessionId`，且 **`putChunk` 写入时即落两个字段**，以便按会话归属区分活跃与孤儿（现状记录仅 `{id, fileId, chunkIndex, data}`，无时间/会话维度，`download.tmpl.html`:997）；
- **主动清扫（Session Prune）**：
  - 在页面加载 `startE2EEDownload` 启动前，自动扫描并清理所有创建时间超过 24 小时或属于已结束会话的历史残留 chunk；
- **即时清理**：单文件保存成功确认后（`finalizeDescriptor` 统一收尾，见 §三.2），调用 `EqtChunkStorage.clearFile(fileId, totalChunks)` 并更新 pending 状态为 `delivered`；
- **停止/失败即时清理（R8）**：执行停止（`executeStopSharing`）、`Pipeline.abort` 或下载失败中断时，对**已写入**的分块立即尽力 `clearFile(fileId)`；现状 abort 只中止网络与 worker（`download.tmpl.html`:1216-1222、1690-1710），不清理已落盘 chunk，中断/停止同样是孤儿主源，不能只依赖 24h prune 兜底；
- **卸载辅助与豁免（R12）**：在 `visibilitychange`（`state === 'hidden'`）时触发尽力而为的轻量清理——但该清理**必须豁免当前 pending（已解密未交付）的活跃 fileId**，仅清“非本会话 / 已超保留期 / 已确认交付”的记录；否则用户点保存、切后台选系统目录的瞬间，未交付数据会被误删。

#### 7. 事件冒泡隔离与工程规范
- 文件列表条目行本身绑定有点击查看/下载逻辑，行内【📥 保存】按钮必须在 click handler 内执行 `e.stopPropagation()`，防止重复冒泡；
- 遵循前端工程规范：本条范围为本方案**新增**代码——严禁新增 HTML 内联 `onclick`，新增按钮事件统一在 JS Controller 中使用 `addEventListener` 注册（存量内联触发逻辑保持不动，范围界定见 R13）。

---

## 四、审查复核决议与技术对照（Review Resolution Matrix）

| 审查意见项 | 核心关切与技术风险 | 最终技术决议与落地方案 |
| :--- | :--- | :--- |
| **R1: 多文件与内存冲突** | 多个大文件批量 share 会导致全量驻留内存引发 OOM | 设定 150MB 与非 IndexedDB 门槛：小集合批量 `File[]` Share；大集合引导单文件列表逐项保存。 |
| **R2: ObjectURL 分支错位** | Share 传 File 无需 URL，避免多文件误建 URL | 明确 `navigator.share` 走纯内存 `File`；`activeSavedBlobUrl` 单例仅服务于 `a.download` 回退。 |
| **R3: `pagehide` 清理不可靠** | 移动端切后台被杀不触发 pagehide 导致磁盘碎片 | 引入基于时间戳的 Session Prune（启动前自动清理 >24h 孤儿 chunk）+ 保存后即时清理。 |
| **R4: Share 语义与防抖锁** | Share resolve 不代表落盘，防抖锁卡死 | `isSaving` 状态锁在 Promise `settle`（无论成功、失败或取消）后立即释放；`AbortError` 静默吞吐。 |
| **R5: 事件隔离与规范** | 列表行内按钮冒泡与内联 onclick 规范冲突 | 行内按钮使用 `e.stopPropagation()` 隔离；全面采用标准 `addEventListener` 声明式绑定。 |

### 第二轮补充审查决议（R6-R13）

> 第二轮审查以「实测代码现状 + Web 平台机制第一性原理」双基线复核（基准提交 `4ccc9195`）。凡决议在正文已吸收的，标注“已落实 §X”；凡需编码期细化的，标注“编码期”。

| 审查意见项 | 核心关切与技术风险 | 最终技术决议与落地方案 |
| :--- | :--- | :--- |
| **R6: Secure Context 前提缺口** | Web Share Level 2 仅 Secure Context（https/localhost）可用；真实接收场景常见 http，而 `download.tmpl.html` 无任何 `isSecureContext`/protocol 探测。http+iOS 下 `navigator.share` 为 `undefined`，主通路缺失，恰逢 iOS 是 `<a download>` 最不可靠平台，方案将空转 | 按钮最前置加 `isSecureContext && navigator.canShare` 探测：不满足则本次直走 `a.download`，并出明确提示文案（引导使用 https 地址或桌面端，避免“点了没反应”）；`https` 记为该方案在移动端生效的**部署前提**（已落实 §一.1）；Phase 4 真机清单补 iOS http/https 双变体，http+iOS 的“无法保存”记录为预期平台限制 |
| **R7: 逐文件即点 → pending 聚合的架构迁移** | 现状 `startE2EEDownload`（:1301-1318）串行 `await downloadFile`，`downloadFile`（:1125-1214）每文件解完即 assemble→`a.click`（:1208）→clearFile；方案要求移动端解完不交付、等用户手势 → “解密+交付”单职责须拆两步，且多文件需跨 fileId 聚合 pending 数据（正文原未给状态结构） | `downloadFile` 拆为 `decryptToStorage`（返回就绪描述 `{fileId, fileName, mime, size, storeType: memory/idb, totalChunks}`，**不交付**）与 `deliver(file)`（点击手势内组装并交付）；新增 pending 会话记录表，逐文件维护就绪态；多文件进度条语义改为“解密聚合进度”（编码期细化） |
| **R8: 停止/失败路径孤儿未闭合** | `executeStopSharing`（:1690-1710）与 `abort`（:1216-1222）只中止网络与 worker，不清理已落盘 chunk；失败中断同源。且现状模板**无任何 pagehide/visibilitychange/unload 监听**——R3 前文“仅依赖 pagehide”与现状不符（实为零清理），孤儿风险更高；新会话新 file_id 会累积孤儿 | 事实更正：现状为“零生命周期清理”而非“仅有 pagehide”；方案补 stop/abort/失败路径对已写入分块即时 `clearFile(fileId, totalChunks)`；24h Session Prune 仅作兜底（已落实 §三.6） |
| **R9: 双阈值正交与“延迟组装不消峰”** | 现状 `LARGE_FILE_THRESHOLD = 256MB`（:1049）才入 IndexedDB；方案 150MB 为 share 聚合预算，两者关系未明；`assembleBlob`（:1004-1014）点击时仍一次性整读出全部 chunk，峰值≈文件大小，延迟只推迟不消除；原风险矩阵“延迟组装避免 OOM”属过度承诺；≥256MB 单文件在移动端的交付通路由何接管未答 | ①IDB 阈值沿用 256MB 不动，150MB 仅作 share 聚合内存预算，单文件 share 不受其限；未入 IDB 的文件（≤256MB）解密期整驻内存，需如实提示；②正文与风险矩阵统一标注“延迟组装仅推迟峰值，不消除”，点击时组装建议分批/分帧进行；③≥256MB 已入 IDB 的单文件在移动端 UI 明确标注“建议桌面端保存”，或设移动端单文件交付上限（已落实 §三.2、§五） |
| **R10: Web Share 单发与回退时序缺陷** | 原 Mermaid “share Error → 回退 a.download”在平台机制上不可行：`await navigator.share()` 一经执行即耗尽当次 User Activation；随后抛 NotAllowed/TypeError 时再 `a.click()` 已失活，被移动浏览器按自动脚本同样拦截 → 回退二次失败，且“取消后又弹下载”语义错乱 | 交付分流改为“进入前同步预判，失败不切道”：按钮 handler 内先判 `isSecureContext && canShare({files})`，不满足则本次直接同步 `a.download`；share 流程只处理 AbortError（用户取消→回 pending，不自动改道），其他错误按失败反馈并保持可重试（已落实 §三.4，Mermaid 已改） |
| **R11: Android 批量 share 落点不对称** | 原目标 3/规则 A 写“iOS/Android 系统批量存入”过度对称：Android 无等价“批量下载”系统目标，第三方 App 对多 `File[]` 数组接受度不一，部分一次仅收一个 | 批量 share 的可靠主承诺限定 iOS 分享面板；Android 端按钮语义定位为“分享到所选应用”，并以列表逐条【📥 保存】兜底（已落实 §一.3、§三.3）；Phase 4 Android 真机项记录“分享多文件至下载管理器/文件 App”的实际目标行为 |
| **R12: visibilitychange 清理与 pending 竞态** | 原 §三.6 “hidden 时轻量清理”若误伤 pending（已解密未交付）数据，用户点保存→切后台进系统选目录的瞬间未交付数据会被删 | 清理判据加三重豁免：仅清「非本 sessionId」或「超保留期」或「已确认交付」的记录；活跃 pending fileId 在任何 hidden 触发下都不得删除；`putChunk` 写入即带 `sessionId`/`createdAt` 以便会话归属判定（已落实 §三.6） |
| **R13: revoke 归因修正与 addEventListener 范围收窄** | ①原风险行“10s revoke 过早致保存中断”系错误归因：已开始的下载不再依赖 URL，移动端失败根因是 iOS 不支持 `<a download>`，单例管理是整洁而非可靠性解药；②R5 “全面 addEventListener”与现状模板存量内联 `onclick`（:421/423/425 等）冲突，全量重构违背最小改动并放大回归面 | ①风险矩阵与 §三.5 归因修正：`activeSavedBlobUrl` 单例定位为“多按钮/重复保存的 URL 生命周期保护”，不再声称解决移动端下载失败（已落实 §五）；②R5 范围收窄为本方案**新增**按钮一律 `addEventListener`；存量内联 `onclick`（`triggerDownload` 系）保持不动，列入后续低风险清理项 |

**现状复核勘误（代码基线 `4ccc9195` 核对，正文已订正）**：
- 端到端加解密算法实测为 **XChaCha20-Poly1305**（libsodium `crypto_aead_xchacha20poly1305_ietf_*`），非 ChaCha20-Poly1305，概述与对比表已订正；
- `LARGE_FILE_THRESHOLD = 256MB`（`download.tmpl.html`:1049）；`success_tips_all` 中文文案定义于多语言字典 `:508`（页面显示使用处 `:848`），原文档把 `:848` 记为文案行略偏，语义一致；
- 现状无任何 unload/pagehide/visibilitychange 生命周期监听，亦无移动 UA 分流变量（仅 `isIOS` 于 `:1133` 用于 ≥1GB 内存提示）——Phase 1/2 的“生命周期接入与 UA 判定”均为净新增逻辑。

### 第三轮细化审查决议（R14-R16）

> 第三轮审查基准提交 `20fb37e2`（2026-09-02）。对象为该提交新增的 `PendingFileDescriptor` 契约与预判分流伪代码，围绕「契约可落地性」与「交付时序平台机制」复核。正文已吸收。

| 审查意见项 | 核心关切与技术风险 | 最终技术决议与落地方案 |
| :--- | :--- | :--- |
| **R14: 含 IDB 大文件的交付前置校验** | `canUseWebShare` 与分支执行流隐含“先组装出 `File[]` 再 share”；对 `storeType === 'idb'`（≥256MB）文件，点击时组装 = 从 IndexedDB 整读，峰值≈文件大小且耗时可能超出 Transient Activation 存活窗，share/`a.click` 会被 `NotAllowedError` 拦截，落入“点击→组装→超窗→失败→重试”循环；桌面无激活窗约束，移动端不可靠（承接 R9） | 交付校验提前到**组装之前**：目标集合含任一 idb 文件即**整体不进 share**，移动端亦不期望 `a.download` 成功；UI 在点击前即对 idb 文件展示“文件较大，建议桌面端保存”；仅全部 memory 的小集合走预判分流（已落实 §三.4） |
| **R15: 契约状态机收尾与边界一致性** | descriptor `status` 缺失败回态与 delivered 后的记录/内存回收；memory 型无 IDB 可清，`chunks` 何时置 `null`、记录何时移除未写；注释“≤256MB 为 memory、>256MB 为 idb”与现状 `useIndexedDB = totalBytes >= LARGE_FILE_THRESHOLD && window.indexedDB`（:1130）边界不一致（恰好 256MB 分叉、且忽略无 IndexedDB 环境）；storeType 判定若由交付侧按 size 重算会与下载侧分叉 | 注释订正为“<256MB 为 memory、≥256MB 为 idb”；storeType 由解密启动时的单一判定函数求值写入 descriptor，交付侧不重算；补状态转移：失败（含 AbortError 与致命异常）一律回退 `pending_save` 保留数据；置 `delivered` 后统一 `finalizeDescriptor` 收尾（idb→`clearFile`，memory→`chunks=null`，记录移除/可回收）（已落实 §三.2） |
| **R16: 局域网 HTTP 提示文案与注册时机** | §三.1 草案提示“可点击单项或长按预览保存”给用户错误预期：blob 资源在 iOS Safari 长按通常无“保存到文件”菜单（仅图片类可存图）；若 descriptor 在解密中途注册会暴露半成品，交付可能拿到不完整文件 | ①HTTP 提示改为引导“改用 https 地址打开 / 换桌面端下载”，删除长按表述（已落实 §三.1）；②descriptor 仅在单文件全部 chunk 完整落位后一次性注册，解密中不暴露半成品（已落实 §三.2） |

---

## 五、风险矩阵与防御策略

| 风险场景 | 根因 | 防御措施 |
| :--- | :--- | :--- |
| **移动端大文件 OOM 崩溃** | 100% 时过早组装整个大 Blob | 延迟组装至用户点击时；IndexedDB 保持分块存储直到交付；组装后立即解引用分块数组。**注意：延迟仅推迟峰值不消除**——对 ≥256MB 已入 IDB 的文件，UI 标注“建议桌面端保存”或设移动端单文件交付上限（R9）。 |
| **多文件批量保存内存暴涨** | 多个文件同时放入 `files` 数组 | 严格执行 150MB 阈值判定，超限时降级为列表单文件保存。 |
| **用户在系统分享面板取消被误报错误** | `navigator.share` 抛出 `AbortError` | 捕获并识别 `err.name === 'AbortError'`，静默恢复按钮状态，不显示错误。 |
| **手势过期导致二次 share 失败** | Web Share API 单手势单次调用约束 | 不使用循环 await share；大文件多文件集通过单文件按钮由用户每次点击触发。 |
| **多按钮/重复保存的 ObjectURL 生命周期竞态** | 多轮保存各自 `createObjectURL`，无序释放造成 URL 泄漏或过早失效 | 废弃 10s 固定定时器，由 `activeSavedBlobUrl` 单例追踪并在下次保存或页面卸载时释放。**归因修正（R13）**：ObjectURL revoke 时机调整属工程整洁与互斥保护，并非移动端“保存失败”根因——已开始的下载不再依赖 URL，移动端失败根因是 iOS 对 `<a download>` 语义不支持。 |
| **手机后台杀进程导致磁盘占用残留** | `pagehide` 在切后台被杀时不触发 | 启动前执行 `EqtChunkStorage.pruneExpired()` 自动清理历史孤儿 chunk。 |
| **列表行点击与保存按钮冲突** | DOM 事件冒泡触发整行下载 | 按钮 handler 显式调用 `e.stopPropagation()`。 |
| **桌面端与明文下载体验回归** | 代码侵入非 E2EE 逻辑 | UA 精准分流：桌面端保持自动 `a.click()`，明文下载完全走既有流。 |

---

## 六、分阶段落地实施计划

### Phase 1：完成态 UI 与保存按钮（移动端适配）
- 在 `pkg/pages/download.tmpl.html` 完成态区域新增主操作按钮【📥 保存到手机】（多文件时为【📥 全部保存到手机】）与说明文案，绑定 `data-i18n`；
- 文件列表条目行内新增【📥 保存】按钮（带 `stopPropagation` 隔离）；
- 本方案**新增**的保存按钮统一使用 `addEventListener` 进行声明式绑定（存量内联 `onclick` 触发逻辑保持不动，范围界定见 R13）；
- 移动端与桌面端 UA 判定分流：移动端完成时展示按钮，桌面端保持现状自动触发并隐藏按钮。

### Phase 2：Web Share API 集成、延迟组装与防抖
- `EqtChunkStorage` 改造：
  - 100% 解密完成时不自动调用 `assembleBlob`；
  - 在用户点击事件触发时执行 `assembleBlob` → `new File(...)`；
  - 增加 `pruneExpired(maxAgeMs)` 清扫函数；
- 实现 `saveToDevice(fileIndex?)` 核心控制逻辑：
  - 支持小集合批量 share（≤150MB）与单文件独立 share；
  - 封装 `navigator.canShare` / `navigator.share`，适配 MIME 类型；
  - 静默捕获 `AbortError`；
  - **预判分流直走 `a.download`**（Secure Context + `canShare` 不满足时同步直下，share 流程内不异常改道，见 R10）并管理 `activeSavedBlobUrl` 单例；
  - `isSaving` 状态锁与按钮加载态（“⏳ 正在准备文件...”）。

### Phase 3：多语言（i18n）与清理闭环
- 新增国际化词条（7 种语言）：`btn_save_to_phone`, `btn_save_all_to_phone`, `btn_save_item`, `saving_preparing`, `save_success_tips`, `save_multi_large_tips` 等；
- 在会话启动、显式停止及 `visibilitychange` 时接入存储清理与 URL 释放。

### Phase 4：多维度测试与验证
1. **Chrome DevTools MCP E2E 仿真测试**：
   - 模拟 iOS Safari / Android 移动设备 UA 与视口；
   - 验证 100% 解密后 UI 切换至 `decrypted-pending-save` 态、主按钮与单项按钮正常渲染；
   - 验证点击后预判分流：Secure Context + `canShare` 下走 `share`、否则同步 `a.download`（无 share→download 异常改道），及防抖状态切换；
2. **模板语法与代码质量门禁**：
   - 运行 `TestTemplateJavaScriptSyntax` 与 `go test ./...`，确保无语法与回归错误；
3. **真机兼容性验证清单**：
   - iOS Safari：测试存入“文件”App（Files）、用户取消操作、单文件与多文件小集；
   - **iOS http/https 双变体（R6）**：https 下验证 share 通路；http（局域网 IP）下验证按钮预判降级直走 `a.download`、提示文案出现，“无法保存”记录为预期平台限制而非缺陷；
   - Android Chrome：测试分享至系统/下载管理器、大文件内存占用；**记录多文件批量 share 到下载管理器/文件 App 的实际目标行为（R11）**；
   - **大文件（≥256MB，R9）**：移动端点击保存瞬间的内存峰值与 GC 停顿，UI“建议桌面端”标注是否如期出现；
   - **停止/失败残留（R8）**：下载中途点停止或制造 chunk 失败，验证 IndexedDB 分块被即时清理；
   - **后台切换（R12）**：解密完成未保存时切后台再回，验证 pending 数据未被误清；
   - 桌面浏览器：验证自动下载体验零改动回归。

