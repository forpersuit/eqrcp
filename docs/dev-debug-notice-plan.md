# Chat 界面系统消息与 Dev 调试模式（用户语义优先）

> **状态**：✅ 已按用户语义重做（v1.16.20，2026-07-25）  
> **第一性原理**：进聊天气泡的文字必须是普通用户能懂的「发生了什么 / 可以怎么做」；实现细节（注册、WebSocket、心跳、Server Error code）**不是**用户消息。

---

## 一、为什么「附件注册失败」不对

| 文案 | 用户听懂了吗？ | 判定 |
| :--- | :---: | :--- |
| `附件注册失败: …` / `Attachment registration failed` | 否（「注册」是实现词） | **调试信息**，不该默认进气泡 |
| `无法分享「报告.pdf」，请重试。` | 是 | **用户消息** |
| `[App] 开始注册附件: C:\…` | 否 | 调试 |
| `WebSocket closed: …. Reconnecting…` | 否 | 调试；用户侧应是「连接已断开，正在重新连接…」 |

上一轮仅去掉 `[App]` 前缀仍把「注册失败」当用户消息 —— **前缀过滤不够**，必须按**语义**分流。

---

## 二、分流规则

```text
addSystemMessage(msg)  → 用户气泡（默认显示）  文案必须口语化
addDebugNotice(msg)    → 仅诊断：systemMessages + logToGui；Dev 开时才进气泡
```

| 类型 | API | 示例 |
| :--- | :--- | :--- |
| 用户结果 | `addSystemMessage` | 无法分享/发送「名」；下载失败请重试；被踢；重连耗尽；连接断开正在重连 |
| 过程/协议 | `addDebugNotice` | `[App]…`、local register 成功/开始、WS established/error/parse、Heartbeat、Server Error 原文 |

**兜底**：`shouldSurfaceSystemNotice` / `isDevDebugNotice` 仍会把「附件注册 / WebSocket / Server Error…」当调试，防止漏网。

### Dev 开关（不变）

- 默认关  
- `?debug=1` / `?dev=1`、`localStorage.chat_dev_debug`、`window.__setChatDevDebug(true)`

---

## 三、代码落点

| 文件 | 职责 |
| :--- | :--- |
| `systemNotice.ts` | `isDevDebugNotice` / `shouldSurfaceSystemNotice` / `displayFileName` |
| `chatStore.ts` | `addSystemMessage` / `addDebugNotice` / `devDebugMode` |
| `App.svelte` | 本地分享失败 → 用户文案；过程 → debug |
| `websocket.ts` | 协议错误 → debug；断线/超时 → 口语化用户文案 |

---

## 四、对「刚才 chat 调整」的复盘

| 调整 | 对不对 | 修正 |
| :--- | :---: | :--- |
| 隐藏 `[App]` 过程日志 | 对方向 | 保留；并改为显式 `addDebugNotice` |
| Dev 开关 | 对 | 保留 |
| 把注册失败改成无 `[App]` 仍显示「附件注册失败」 | **错** | 改为「无法分享「文件名」，请重试」+ 细节进 debug |
| 连接/WS 工程句直接进气泡 | **错** | 用户句 + debug 原文 |

**验收**：默认聊天流里不应出现「注册 / WebSocket / Heartbeat / Server Error / [App]」；失败应是「无法分享/发送/下载 + 文件名 + 请重试」类句子。
