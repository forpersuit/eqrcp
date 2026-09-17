# 移动端视口布局与软键盘交互规约 (Mobile Layout & Virtual Keyboard Guidelines)

## 目录 (Table of Contents)
- [1. 顶层画布物理锁定与滚动阻断](#1-顶层画布物理锁定与滚动阻断)
- [2. 基于第一性原理的局部滚动动态检测](#2-基于第一性原理的局部滚动动态检测)
- [3. 软键盘遮挡几何度量与日志探针](#3-软键盘遮挡几何度量与日志探针)
- [4. 纯三段式 Flex 列式布局与历史消息弹性收缩](#4-纯三段式-flex-列式布局与历史消息弹性收缩)
- [5. 软键盘展开卡片整体悬浮与呼吸边距](#5-软键盘展开卡片整体悬浮与呼吸边距)
- [6. 移动端连续输入与发送防失焦](#6-移动端连续输入与发送防失焦)
- [7. 移动端窄屏顶栏操作折叠与横向纯图标菜单](#7-移动端窄屏顶栏操作折叠与横向纯图标菜单)
- [8. 触控高亮消除与精确触控边界约束](#8-触控高亮消除与精确触控边界约束)
- [9. 输入焦点、输入区域与键盘的排他性对应](#9-输入焦点输入区域与键盘的排他性对应)

---

## 1. 顶层画布物理锁定与滚动阻断

- **规格来源**: `pkg/chat/v2/web/src/app.css` 与 `pkg/chat/v2/web/src/App.svelte`
- **规则**: 在移动端媒体查询（`@media (max-width: 820px)`）下，`html, body, #app` 必须声明：
  ```css
  html, body, #app {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      overscroll-behavior: none;
  }
  ```
- **合理性**: 剥夺外层画布滚动作案空间。
- **容器定位与位移物理对冲**:
  - `.chat-viewport` 声明：
    ```css
    .chat-viewport {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: var(--chat-viewport-height, 100%);
        transform: translateY(var(--chat-viewport-offset, 0px));
        will-change: transform;
    }
    ```
  - **WebKit 平移补偿机制**: iOS Safari 软键盘弹出时会将整个 Layout Viewport 向上平移 `visualViewport.offsetTop` 个像素，导致顶栏被推出物理屏幕。通过监听 `visualViewport` 的 `resize` 与 `scroll` 事件，动态将 `--chat-viewport-offset` 设为 `${vv.offsetTop}px`，通过合成层向下的位移实时抵消系统平移，将顶栏牢牢固定在物理屏幕顶部。
  - **严禁强行 `window.scrollTo(0, 0)`**: 键盘平移走的是独立的系统平移轴而非文档滚动轴，动画期调用 `scrollTo` 会与 WebKit 原生平移动画激烈打架并产生下沉弹回抖动。全权交由 `visualViewport.offsetTop` 单向驱动对冲。

---

## 2. 基于第一性原理的局部滚动动态检测

- **规格来源**: `pkg/chat/v2/web/src/App.svelte:1122-1155`
- **机制**: 移动端非内嵌环境（`isMobileLayout && !isEmbedded`）下，挂载全局 `touchmove` 监听。拦截非滚动区域的事件冒泡，杜绝 Safari 触发顶层橡皮筋弹跳。
- **双重放行保障**:
  1. **静态选择器白名单**: 覆盖核心组件与已知浮层：
     `.message-list-container, .messages, .more-menu-panel, .device-panel, .lang-panel, .license-panel, .modal, .modal-body, .session-backdrop, .bubble-context-menu, .image-preview, .preview-overlay, .media-viewer, .scrollable, [data-scrollable], textarea, input`
  2. **动态滚动检测 (`isScrollableElement`)**: 向上递归遍历祖先节点（终止于 `.chat-viewport` / `#app`）。若任意祖先元素的计算样式 `overflowY` 为 `'auto'` 或 `'scroll'` 且存在物理滚动溢出（`scrollHeight > clientHeight`），判定为合法局部滚动，直接放行 `touchmove`。
- **效果**: 既彻底阻断外层画布的晃动，又使未来新增的多行长弹窗、全屏图片预览等能够自适应正常顺畅滑动。

---

## 3. 软键盘遮挡几何度量与日志探针

- **规格来源**: `pkg/chat/v2/web/src/components/ViewportDebugOverlay.svelte` 与 `pkg/chat/v2/web/src/App.svelte:1020-1065`
- **几何判定绝对标准**:
  - 软键盘上沿：$Y_{\text{keyboard}} = \text{visualViewport.height} + \text{visualViewport.offsetTop}$
  - 输入框底沿：$Y_{\text{composer}} = \text{composerEl.getBoundingClientRect().bottom}$
  - 重叠量判定：$\text{overlap} = Y_{\text{composer}} - Y_{\text{keyboard}}$
    - $\text{overlap} \le 1\text{px}$：判定为 `OK (gap: -overlap px)`，绿色高亮，输入框完全悬浮在键盘上方；
    - $\text{overlap} > 1\text{px}$：判定为 `BLOCKED (-overlap px)`，红色告警，输入框被键盘物理遮挡。
- **环境门控与日志吞吐控制**:
  - 探针日志 `[VIEWPORT-PROBE]` 严格受桌面端设置项 `Enable Viewport Debug Box`（`viewportDebugEnabled` 为 true）门控。在生产/默认环境下直接退出，产生 0 CPU 运算与 0 网络吞吐。
  - 在调试模式下：
    - `focusin`（0ms / 100ms / 300ms / 500ms）与 `focusout`（0ms / 200ms）保持精确时序采样上报；
    - 键盘 300ms 升降动画期间逐帧高频触发的 `vv-sync` 采用 120ms 防抖收敛，仅在定格稳定态输出一条日志，避免日志风暴。

---

## 4. 纯三段式 Flex 列式布局与历史消息弹性收缩

- **规格来源**: `pkg/chat/v2/web/src/app.css:1880-1930`
- **三段式结构约束**:
  - 容器层 `<main>` 与 `.chat-shell`：`display: flex; flex-direction: column; flex: 1 1 0%; height: 100%; max-height: 100%; min-height: 0; overflow: hidden;`
  - 顶栏 `.chat-head`：`flex: 0 0 auto; flex-shrink: 0; position: sticky; top: 0; z-index: 2;`（固定不移位）
  - 输入栏 `.composer`：`flex: 0 0 auto; flex-shrink: 0; margin-top: auto;`（紧贴视口底边，随视口压缩整体抬升）
  - 消息列表 `.message-list-container`：`display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; max-height: 100%; overflow: hidden;`；内部 `.messages`：`flex: 1 1 0%; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;`
- **弹性收缩效果**: 键盘弹出压缩视口高度时，缩减全部由消息列表区域自适应吸收；较早的历史消息向上平滑移动藏入顶栏下方，既保全顶栏品牌状态，又使输入区域随底边完美贴合悬浮。
- **零延迟响应**: 移动端下 `.chat-viewport` 必须声明 `transition: none !important;`，严禁 CSS 过渡动画与原生 60/120fps 硬件键盘升降发生滞后拉扯。

---

## 5. 软键盘展开卡片整体悬浮与呼吸边距

- **规格来源**: `pkg/chat/v2/web/src/app.css:1872-1877`
- **严禁截断卡片边框**: 聊天界面是实体卡片容器（`.chat-shell`），键盘弹出时严禁通过 `border-bottom: none` 或去除底部圆角粗暴抹平底边，避免纵向边框突兀截断。
- **悬浮与呼吸边距**: 视口被软键盘压缩时，整个 `.chat-shell` 作为封闭实体悬浮于键盘上方，完整保留 4 边 1px 细边框与 14px 全圆角；外层容器维持安全边距（`main { padding-bottom: 8px !important; }`），内部输入区收缩为紧凑内边距（`padding-bottom: 8px !important;`）；键盘收起时恢复安全边距 `max(11px, env(safe-area-inset-bottom))`。

---

## 6. 移动端连续输入与发送防失焦

- **规格来源**: `pkg/chat/v2/web/src/components/MessageComposer.svelte`
- **发送防失焦时序控制**:
  - 移动端 Safari 触摸序列中，`blur` 发生在 `pointerdown` / `mousedown` 阶段早于 `click`。如果仅在 `click` 时处理，输入框早已失焦、键盘已启动收回动画。
  - **规范**: 发送按钮必须监听 `on:pointerdown`，并在事件中执行 `e.preventDefault()` 阻止默认焦点转移，同时配合防重复锁直接触发发送逻辑。
  - **连续打字体验**: 发送成功清空输入后，在下一帧显式通过 `requestAnimationFrame(() => textareaEl?.focus())` 锁紧焦点，保持软键盘常驻展开，支持连续敲击打字发送。
  - **严禁主动强制 blur**: 严禁在发送处理中主动调用 `textareaEl.blur()`。用户如需收起键盘，可轻触消息背景或点击面板空白区域自然失焦。

---

## 7. 移动端窄屏顶栏操作折叠与横向纯图标菜单

- **规格来源**: `pkg/chat/v2/web/src/app.css:1788-1805` 与 `pkg/chat/v2/web/src/App.svelte`
- **顶栏按钮收敛**: 移动端视口（`<= 820px`）下，顶部右侧仅保留「在线设备数胶囊」（`device-pill`）与「更多选项按钮」（`...`），其余操作（二维码、多语言切换、退出）收进下拉面板（`.more-menu-panel`）。
- **纯图标横向浮动胶囊**: 更多选项下拉面板采用横向布局（`.more-menu-list { flex-direction: row; gap: 6px; }`），各选项以 32px 统一尺寸的方形纯图标陈列，去除非必要文字标签，保留 `title` 与 `aria-label`。
- **严密视觉对称**: 消息流头像缩放至 `clamp(28px, 8.5vw, 32px)` 时，`.message` 栅格与 `.avatar-stack` 容器同步流体缩放，保证对方消息左边距与己方消息右边距均严格为 12px 绝对对称。

---

## 8. 触控高亮消除与精确触控边界约束

- **规格来源**: `pkg/chat/v2/web/src/app.css`
- **消除默认高亮**: 全局声明 `* { -webkit-tap-highlight-color: transparent; }`，避免点击具有 `cursor: pointer` 或 `<label>` 时产生大面积灰色矩形遮罩假象。
- **1:1 点击区域贴合**: 严禁使用全宽父级 `<label>` 包裹居中小按钮，必须直接将 `<label>` 设为视觉按钮自身（`display: inline-flex`），使交互区域与视觉轮廓精准重合。
- **`:hover` 污染隔离**: 带有位移或背景突变的 `:hover` 样式必须封装在 `@media (hover: hover) and (pointer: fine)` 媒体查询中；触控端仅保留 `:active` 微动反馈，杜绝轻触按钮导致整个外部卡片持久变色上浮。

---

## 9. 输入焦点、输入区域与键盘的排他性对应

- **规格来源**: `pkg/chat/v2/web/src/App.svelte` 与 `pkg/chat/v2/web/src/app.css`
- **核心原则**: 区分「聊天主输入框」（`.composer`）与「面板/模态表单输入框」（如设备面板重命名 `.device-rename-input`、许可证输入框等）：
  - **聊天输入模式 (`isComposerActive`)**: 仅当活跃元素属于 `.composer` 时成立。此时底部聊天输入栏紧贴键盘上方抬升，消息列表自动滚动至底端。
  - **面板/模态输入模式 (`isPanelInputActive`)**: 当焦点在 `.device-panel`、`.license-panel` 或任意弹窗内时，当前交互主体是该浮动面板，与底部的聊天输入框完全无关。
- **表现层隔离规约**:
  - 标记 `html.panel-input-active` 类名，声明 `html.panel-input-active .composer { display: none !important; }`，**彻底移除底部聊天输入栏占位**，严禁将聊天输入栏拉起至键盘上方误导用户。
  - 浮层面板声明 `max-height: calc(var(--chat-viewport-height, 100%) - 60px); overflow-y: auto;`，确保软键盘升起压缩视口时面板自适应保持全可见并在内部局部滚动。
  - 在激活重命名等操作时，主动调用 `input.focus()` 与 `input.scrollIntoView({ block: 'nearest' })`，确保编辑区域与键盘精准对应。

---

## 10. 移动端卡片容器防溢出与底边圆角保护规范

- **规格来源**: `pkg/chat/v2/web/src/app.css:1735-1744, 1897-1907`
- **Flex 容器内百分比高度陷阱 (Flex Item Height Trap)**:
  - 当父容器 `main` 为 `display: flex; flex-direction: column;` 且具有 `padding` 时，其直接子元素（如 `.chat-shell` 卡片）**严禁设置 `height: 100%` 或 `max-height: 100%`**。
  - 在 CSS 盒模型规范中，子元素写 `height: 100%` 会按父容器的整体计算高度（含上下 padding）解析，叠加 `main` 的安全区顶部 padding 后，导致子元素整体向底端偏移并超出父容器 `main`，被 `overflow: hidden` 强制截断，直接导致卡片底边框与两侧圆角丢失（呈现直角切边假象）。
  - **规范**: 统一声明 `flex: 1 1 0%; min-height: 0;` 让 flex 算法自动扣减上下 padding 并精确填充内容区，保障底部边框与左右圆角（`border-radius: 14px`）完整露出。
- **不可见定位表单元素撑大父级防呆**:
  - 用于调起原生文件选择的隐藏 `<input type="file" class="composer-file-input">` 必须显式声明 `top: 0; left: 0;`。
  - 若仅写 `position: absolute; width: 0.1px; height: 0.1px;` 而省略 `top/left`，浏览器会保留其在文档流尾部的静态位置，使其跌出父容器内部 padding，撑大容器 `scrollHeight` 导致出现幽灵滚动区并截断卡片底边。

