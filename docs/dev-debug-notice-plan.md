# Chat 界面系统消息与 Dev 调试模式开关方案

## 一、 问题背景与第一性原理设计

在 GUI 端发送文件或拖拽上传时，技术事件与调试记录（如 `[App] 收到 selected-files 文件消息...`、`[App] 开始注册附件...`）混入用户聊天框，会严重影响界面质感与用户体验。

按照 **第一性原理（First Principle）**：
> **“调试的就是调试的，常规信息就是常规信息。”**  
> 调试信息与用户通知的分类，应当在信息产生点（Call Site）由开发者通过显式 API （Explicit Typing / Explicit Method Dispatch）确定，而不是在事后依靠魔改正则或字符串黑名单进行隐式猜测。

### 分派架构对比：

| API 方法 | 语义与意图 | 结构标记 | UI 显示策略 (默认) | 日志记录策略 |
| :--- | :--- | :--- | :--- | :--- |
| **`chatActions.addDebugNotice(msg)`** | 显式标记为**内部技术调试/过程日志** | `isDebug = true` | **隐藏**（只在 Dev 调试模式开启时渲染为气泡） | **100% 全量输出**（发送至 `logToGui` 及后台系统日志） |
| **`chatActions.addSystemMessage(msg)`** | 显式标记为**面向用户的常规系统通知** | `isDebug = false` | **正常显示**（渲染为用户可读的系统卡片） | **100% 全量输出** |

---

## 二、 简捷判定机制与零黑名单

在 `systemNotice.ts` 中彻底移除了依靠正则/词库字符串探查的脆弱黑名单，判定逻辑简化为纯粹的结构化布尔逻辑：

```ts
export function shouldSurfaceNotice(isDebug: boolean, isDevDebug: boolean): boolean {
  return !isDebug || isDevDebug;
}
```

### 运行机制：
1. **常规通知 (`isDebug = false`)**：`!isDebug` 为 `true`，必定显示到 UI 界面。
2. **调试通知 (`isDebug = true`)**：是否显示完全取决于 `isDevDebug`（即 `devDebugMode` 开关状态）。
3. **日志通道**：无论 `isDebug` 与 `devDebugMode` 为何值，`systemMessages` 列表与桌面 `logToGui` 始终 100% 全量无损接收。

---

## 三、 状态切换与控制途径

- **本地持久化**：存储于 `localStorage.getItem('chat_dev_debug') === 'true'`。
- **URL 快捷激活**：支持带参数 `?debug=1` 或 `?dev=1` 初始化开启。
- **动态控制 API**：提供 `chatActions.setDevDebugMode(enabled: boolean)`，并挂载 `window.__setChatDevDebug(enabled)` 供 DevTools / GUI 随时一键切换。
