# 桌面端 GUI 交互、DOM Diff 与独立组件规约 (Desktop GUI & Interaction Guidelines)

## 目录 (Table of Contents)
- [1. 状态与 DOM 分离及 morphdom 增量 Diff](#1-状态与-dom-分离及-morphdom-增量-diff)
- [2. 骨架与数值分离就地更新](#2-骨架与数值分离就地更新)
- [3. 活动输入焦点保护与防点击吞包机制](#3-活动输入焦点保护与防点击吞包机制)
- [4. 桌面端应用内日志查看与诊断弹窗](#4-桌面端应用内日志查看与诊断弹窗)
- [5. Chat 活跃传输状态托盘组件](#5-chat-活跃传输状态托盘组件)
- [6. 推广海报卡与 100% 离线二维码生成](#6-推广海报卡与-100-离线二维码生成)
- [7. 离线状态 UI 门控策略](#7-离线状态-ui-门控策略)
- [8. 具名导入静态审计防线](#8-具名导入静态审计防线)

---

## 1. 状态与 DOM 分离及 morphdom 增量 Diff

- **规格来源**: `desktop/gui/frontend/src/main.js`
- **核心原则**:
  - 将易变状态（更新检测阶段、下载进度、警告文案、临时输入）存放在全局 `state` 中，而非依赖 DOM 结构。
  - 构造面板时动态读取全局 `state`；控件绑定 `input`/`change` 实时同步 DOM 最新值回内存（`syncSettingsFromDOM()`）。
- **DOM Diff 增量补丁**:
  - 使用零依赖 DOM Diff 库 `morphdom` 替代全量 `innerHTML` 覆写，杜绝 DOM 闪烁（如 Tooltip 闪烁、二维码重载）和输入框失焦。
  - 重写 `addEventListener` 拦截包装器：对同一类型绑定相同语义的回调函数（比较 `listener.toString()`）时，先移除旧回调，确保元素只挂载单实例监听器并安全捕获最新状态闭包。
- **局部 vs 全量渲染**:
  - `openPanel()`/`closePanel()` 仅通过 `syncPanelSurface()` 就地 patch `.overlay` 面板，不重绘外层顶栏。
  - 通过顶层事件委托（如顶栏 `...` 菜单）打开面板时，须在委托处理器内显式调用 `render()` 全量重绘，保证依赖 `state` 的外层菜单角标平滑同步。

---

## 2. 骨架与数值分离就地更新

- **规格来源**: `desktop/gui/frontend/src/main.js`
- **骨架重构**: 仅在设备连接状态变化（`clientID` 增减）或文件条目数等结构化元数据改变时，执行一次性 `innerHTML` 骨架重写。
- **就地更新 (In-place Patching)**: 结构未变时，通过预埋唯一标识（如 `clientID`）的 HTML `id`，使用 `document.getElementById` 定位节点，更新 `textContent` 或 `style.cssText`。高频或局部状态变更优先就地更新，避免滚动条归零（`scrollTop` 弹跳）。

---

## 3. 活动输入焦点保护与防点击吞包机制

- **规格来源**: `desktop/gui/frontend/src/main.js`
- **活动输入保护**: 收到后台心跳同步或状态推送时，若 `shouldProtectActiveInput()` 判定当前 `document.activeElement` 为编辑中的输入框/文本域，必须挂起全屏重绘，保护输入焦点与光标。
- **防点击吞包 (Click Swallowing Defense)**:
  - 浏览器原生触发顺序：`mousedown`（命中按钮子节点）-> 输入框 `blur` -> `mouseup` -> `click`。
  - **红线规则**: 严禁在输入框的 `blur`/`input` 中无差别全量重写按钮的 `innerHTML`。这会导致 `mousedown` 命中的子节点在 `blur` 时被销毁，浏览器无法判定同一节点闭合而直接丢弃 `click` 事件。
  - **实践**: 状态更新时优先修改 `textContent`、`disabled` 或 `classList`，保持按钮内层 DOM 树稳定；并为输入框提供 `keydown` (Enter) 快捷触发。

---

## 4. 桌面端应用内日志查看与诊断弹窗

- **规格来源**: `desktop/gui/frontend/src/components/log_viewer.js`
- **独立组件化**: 日志查看器业务逻辑剥离至独立模块，严禁向 `main.js` 堆砌状态与模板。渲染函数仅做 `Data -> HTML` 单向映射。
- **搜索焦点保护**: 全量重绘时，必须在 `morphdom` 的 `onBeforeElUpdated` 中对 `#log-viewer-search` 进行聚焦保护与内容同步。
- **轻量反馈与零 alert**: 导出和复制反馈统一使用应用内浮窗（`showToast`），严禁调用浏览器阻塞式 `alert()`。优先使用 `navigator.clipboard.writeText`，异常时降级至隐藏 `textarea` 复制并给出 Toast。
- **终端智能吸附 (Smart Stick-to-Bottom)**: 刷新日志时，若用户当前处于底部附近（距底 ≤40px）或首次打开，执行自动滚底；若用户正在向上翻阅历史排查日志，严格保持阅读位置，杜绝自动轮询强行打断排查。

---

## 5. Chat 活跃传输状态托盘组件

- **规格来源**: `desktop/gui/frontend/src/components/chat_tray.js` 与 `pkg/server/chat_status.go`
- **消除静默黑盒**: 移动端通过分块上传大附件时，服务端在更新消息进度时通过 150ms 节流触发 `notifyChatStatusHook`，在只读快照中注入 `ChatActiveTransfer[]` 切片。
- **独立任务托盘**:
  - 渲染逻辑封装于独立模块 `chat_tray.js`；
  - 采用独立任务列表展示所有在传附件（文件名、上传者、大小、百分比、平滑进度条），彻底避免单行副标题在多任务并发时的相互覆盖；
  - 活跃任务为 0 时返回空字符串并平滑隐藏，不侵占主消息区空间。

---

## 6. 推广海报卡与 100% 离线二维码生成

- **规格来源**: `desktop/gui/frontend/src/components/share.js`
- **box-sizing 约束**: `.share-poster-card` 必须显式声明 `box-sizing: border-box`，防止 `min-height: 340px` 叠加上下 padding 撑大至 412px 造成底部异常空旷。
- **垂直居中**: 二维码、间距与 Logo 在卡内使用 `justify-content: center` 垂直居中。
- **100% 离线二维码生成**:
  - 优先调用 Wails 原生绑定 Go 端 `GenerateQRCodePNG(content, size)`，直接返回 Base64 Data URL，断网机房环境下毫秒级本地合成，零依赖外部网络。
  - **占位图 Base64 化**: 占位二维码必须采用 `data:image/svg+xml;base64,...` 编码，严禁在 HTML `src` 中内联含双引号的 UTF-8 SVG，杜绝属性截断造成散落 DOM 损坏关闭按钮命中区域。
  - **失败降级**: 图片经 `loadImageElement(src)` 加载，失败返回 `null` 避免 `ctx.drawImage` 抛出 `InvalidStateError`。

---

## 7. 离线状态 UI 门控策略

- **规格来源**: `desktop/gui/frontend/src/main.js` 与 `pkg/chat/v2/web/src/App.svelte`
- **统一联网状态判定**: 使用 `navigator.onLine`，断网时隐藏免费配额倒计时与消耗胶囊。
- **主 GUI (Wails)**: 离线时隐藏兑换按钮、刷新授权、购买/管理入口等需公网 API 的控件；保留套餐对比等静态内容。
- **Chat v2 (Svelte)**: 离线时额度倒计时隐藏，标题栏直接展示当前生效的套餐等级（`FREE` / `PLUS` / `PRO`），点击可查看该套餐在 Chat 模式下的具体权益，避免用户误判。

---

## 8. 具名导入静态审计防线

- **规格来源**: `scripts/audit-frontend-imports.mjs`
- **静态审计机制**: ESLint `no-undef` 无法检测具名导入指向目标模块不存在导出符号（`import { missing } from './target.js'`）。
- **构建链路接线**: `audit-frontend-imports.mjs` 挂载在部署脚本与提交检查主链上，静态扫描全部前端源码的 import 与 export 符号集合，彻底阻断未导出符号逃逸至生产发布包。
