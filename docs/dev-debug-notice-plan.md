# Chat 界面系统消息与 Dev 调试模式开关方案

> **状态**：✅ 已落地（v1.16.19，2026-07-25）  
> 实现：`systemNotice.ts` 过滤 `[App]`；`chatStore.devDebugMode` + `localStorage`/`?debug=1`/`window.__setChatDevDebug`；附件注册失败改为用户可见文案（无 `[App]` 前缀）。

## 一、 问题背景与分类定义

在 GUI 端发送文件或拖拽上传时，Chat 聊天会话界面（UI 消息气泡流）中会频繁插入调试性质的系统通知，如：
- `[App] 收到 selected-files 文件消息: ["xxx"]`
- `[App] 开始注册附件: xxx`
- `[App] 注册成功: xxx`

针对消息类型的定性分析如下：

| 消息类型 | 典型示例 | 消息定位 | UI 显示策略（默认） | 日志记录策略 |
| :--- | :--- | :--- | :--- | :--- |
| **内部调试/事件过程日志** | `[App] 收到 selected-files...`<br>`[App] 开始注册附件...`<br>`[App] 注册成功...` | 前端组件/通信级的技术中间状态，用于开发与排查流程。 | **隐藏**（避免在聊天框形成杂音） | **全量输出**（发送至 `logToGui` 及后台 Log） |
| **面向用户的系统错误/通知** | `WebSocket 连接失败`<br>`下载附件失败: xxx`<br>`您已被强制下线` | 代表业务流程或网络传输的实际状态变化与故障。 | **正常显示**（气泡展示给用户） | **全量输出** |

---

## 二、 Dev 调试模式开关设计

为了兼顾普通用户清爽的聊天体验与开发者全面排查问题的需求，设计动态 **Dev 调试模式开关（Dev Debug Mode Switch）**。

```
                              ┌─── [Dev 模式开启] ───> 聊天流显示所有信息（包括 [App] 调试流水 + 网络错误）
系统消息 (addSystemMessage) ──┤
                              └─── [Dev 模式关闭] ───> 聊天流隐藏 [App] 调试流水，仅显示网络错误等系统通知
                                                       └─>（[App] 调试流水仍 100% 写入 logToGui 底层日志）
```

### 1. 开关状态与控制逻辑
- **Dev 模式开启 (`isDevDebug = true`)**：
  - 所有系统消息（包括 `[App]` 开头的调试事件、连接建立提示、网络错误、上传队列通知等）**全量在 UI 聊天历史中作为消息气泡展示**。
  - 同时全量输出至后台日志。
- **Dev 模式关闭 (`isDevDebug = false`，默认状态)**：
  - **隐藏消息**：`[App]` 开头的中间过程调试信息在 UI 聊天框中隐形。
  - **保留消息**：网络错误、传输中断、下载失败、文件超限等面向用户的系统通知**依然正常在 UI 聊天框展示**。
  - **日志保留**：被隐藏的 `[App]` 调试信息**依然 100% 完整输出到后台日志 (`logToGui`)**。

### 2. 状态切换与持久化
- **本地记忆**：存储于 `localStorage.getItem('chat_dev_debug') === 'true'`。
- **URL 快速激活**：支持带参数 `?debug=1` 或 `?dev=1` 初始化开启。
- **动态控制**：在 `chatStore` 中提供 `chatActions.setDevDebugMode(enabled: boolean)`，暴露 `window.__setChatDevDebug(enabled)` 供 GUI 设置菜单或 DevTools 随时切换。

---

## 三、 技术架构与改动文件规划

1. **`pkg/chat/v2/web/src/state/systemNotice.ts`**
   - 增加 `shouldSurfaceSystemNotice(msg: string, isDevDebug: boolean)` 筛选逻辑。
2. **`pkg/chat/v2/web/src/state/chatStore.ts`**
   - 增加 `devDebugMode` writable store 和 `setDevDebugMode` action。
   - `addSystemMessage` 方法根据当前 `devDebugMode` 决定是否将 `msg` 推送到 `messages` 列表。
3. **`pkg/chat/v2/web/src/state/systemNotice.test.ts`**
   - 补充 Dev 模式开启/关闭状态下系统消息过滤的单元测试用例。
