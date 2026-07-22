# Chat 模式 Free Tier 用量特点：分析与修复方案

> **日期**：2026-07-23  
> **状态**：已分析，待修复  
> **范围**：Free tier 下 Chat 模式每日 5 分钟额度、超额体验降级（限速 / 附件上限 / 消息失败率）

---

## 1. 问题现象

Free tier 下 Chat 模式的「用量特点」看起来没有生效：

- 聊天可以长时间满速使用，未见 5 分钟额度耗尽后的体验降级。
- 附件未见超额后的 **2MB** 硬限制与 **100 KB/s** 限速。
- 消息发送未见约 **30%** 随机失败。
- 桌面 GUI 顶部可能仍有倒计时文案，但与后端真实能力边界脱节。

---

## 2. 产品设计（应然）

权威设计见：

- [`docs/payment/tier-design.md`](../payment/tier-design.md)
- [`docs/payment/license-tier-analysis.md`](../payment/license-tier-analysis.md)

| 阶段 | Free Chat 行为 |
| :--- | :--- |
| 每日前 **5 分钟（300 秒）** | 满速 Chat 体验 |
| 超额后 | **不硬掐断会话**，进入体验降级 |
| 超额限速 | 传输约 **100 KB/s** |
| 超额附件 | 单文件最大 **2 MB** |
| 超额消息 | 约 **30%** 发送失败率 |

后端权威计时应为 `ChatLimiter.UsedSeconds`（落盘 `chat_usage.json`）。

设计原则：**体验降级代替硬性锁死**，让用户可继续使用，但在生产力场景下自愿付费。

---

## 3. 根因（第一性原理）

> **产品迁到 Chat V2 后，用量计时仍盯着 legacy `chatSession.clients`，而真实连接登记在 V2 session 里，导致 `UsedSeconds` 几乎永远为 0；下游所有「超额后降级」都以它为门槛，因此一起空转。**

### 3.1 计时依赖 legacy 客户端表

`pkg/server/chat.go` 启动 2 秒 ticker，仅当 **legacy** `chatSession.clients` 非空时累加：

```go
// 伪代码摘要
for range ticker.C {
    clientCount := len(session.clients) // legacy chatSession
    if clientCount > 0 {
        limiterInstance.IncrementUsage(2)
    }
}
```

### 3.2 实际流量全部走 Chat V2

- CLI / Desktop 默认 `EnableChatV2 = true`
- `ChatJoinURL()` 将 `/chat/` 替换为 `/chat-v2/`
- legacy `/chat/*` 对 V2 做 **301 永久重定向**

V2 客户端经 WebSocket 注册到：

- `pkg/chat/v2/session.Session.clients`

**不会**写入：

- `pkg/server.chatSession.clients`

### 3.3 因果链

```
Chat 启动
  → 挂载 /chat-v2 Handler + V2 Session Manager
  → 用户连上 → V2 clients++
  → legacy clients 仍为空
  → ticker 从不 IncrementUsage
  → UsedSeconds 保持 0
  → IsPaidOrUnrestricted 恒为 true / 降级条件恒为假
  → Free 用户长期接近满速、无消息失败、无 2MB 硬限
```

对比：Share / Receive 的「每日 5 次 + 超额 5 文件 / 50MB」走另一套计数与入口拦截，**不依赖**上述 Chat 在线秒数链路，因此可正常；**唯独 Chat 时间额度链路断了**。

---

## 4. 实现现状对照

### 4.1 后端门槛条件

超额判断普遍写作：

```go
!usage.IsPaid && usage.UsedSeconds >= 300
```

Chat V2 带宽钩子：

```go
// pkg/server/chat.go → chatv2http.Config
IsPaidOrUnrestricted: func() bool {
    usage := limiterInstance.GetStatus()
    return usage.IsPaid || usage.UsedSeconds < 300
},
```

当 `UsedSeconds` 恒为 0 时：

| 机制 | 预期 | 实际 |
| :--- | :--- | :--- |
| 每日 5 分钟额度耗尽 | `UsedSeconds ≥ 300` 后降级 | **永不触发** |
| V2 `IsPaidOrUnrestricted` | 超额后按 Free 策略 | **恒 true** → 按「未受限」路径 |
| Legacy 100KB/s + 2MB + 30% 失败 | 超额后生效 | 路由已迁 V2，**基本成死代码** |
| V2 `send_text` | 应有消息降级 | **无** free 检查 |
| V2 上传 | 应有 2MB 限制 | **无** 超额 2MB 校验 |
| V2 下载/stream 带宽 | 超额 100KB/s | 见下节策略漂移 |

### 4.2 V2 带宽策略与设计文档不一致

| 来源 | Free 超额策略 |
| :--- | :--- |
| 产品设计 | **100 KB/s** |
| `pkg/chat/v2/bandwidth/policy.go` `PolicyFree` | 固定 **2 MB/s** |
| `PolicyPaid` | **100 MB/s** |

且 `RegisterJob(jobID, isPaid)` 中的 `isPaid` 来自 `IsPaidOrUnrestricted()`，在 `UsedSeconds < 300` 时为 true——即 **Free 配额内按 Paid 带宽分配**。在计时失效时，Free 用户会长期走接近 Paid 的路径。

### 4.3 Legacy 降级（仅旧 HTTP 路径）

`pkg/server/chat.go` 中仍残留（当前生产路径几乎不可达）：

- 消息 POST：`UsedSeconds >= 300` 时约 30% 返回 500
- 附件上传：超额后 body 限速 100KB/s + 单文件 >2MB → 413
- 附件下载：超额后 `ThrottledReader` 100KB/s

### 4.4 桌面 GUI：双轨计时，仅展示不执法

`desktop/gui/frontend/src/main.js`：

- 常量：`chatDailyFreeMs = 5 * 60 * 1000`
- 存储：`localStorage` key `eqt.chat.dailyFreeUsage`
- 用途：顶部 pill / 文案倒计时

问题：

1. **与后端 `UsedSeconds` 不同步**（Dev `DevSetUsedSeconds` 不改 localStorage）。
2. `exhausted` 被计算但 **从未使用**——开始 Chat 按钮不会因用尽而禁用。
3. `startChat()` **无额度前置校验**，用尽后仍可开会话。
4. 纯 UI 时钟，**约束不了** 浏览器 / 手机端 Chat 真实能力。

### 4.5 关键文件索引

| 职责 | 路径 |
| :--- | :--- |
| 用量累加 / 状态 | `pkg/server/chat_limiter.go` |
| Chat 启动、V2 挂载、legacy ticker | `pkg/server/chat.go` |
| V2 路由 / info / 下载 | `pkg/chat/v2/http/routes.go`, `files.go` |
| V2 带宽策略 | `pkg/chat/v2/bandwidth/policy.go`, `scheduler.go` |
| V2 在线客户端 | `pkg/chat/v2/session/session.go` |
| V2 发消息 | `pkg/chat/v2/transport/websocket.go` (`send_text`) |
| GUI 倒计时 | `desktop/gui/frontend/src/main.js` |
| 产品设计 | `docs/payment/tier-design.md` |

---

## 5. 修复方案

按侵入性由小到大。目标：**计时正确 → 降级接到 V2 数据面 → UI 与后端单一可信源**。

### 5.1 P0：计时源改挂 V2 session（必须）

**问题**：ticker 读错客户端集合。

**方案**：

1. 在 `chatv2http.Handler` 暴露在线人数查询（例如 `ClientsCount()` 汇总，或「任意 session 有人在线」）。
2. `pkg/server/chat.go` 的 ticker 改为依据 **V2 在线人数** 调用 `IncrementUsage(2)`。
3. 会话结束 / terminal 时停止累加（保持现有 `session.isTerminal()` 守卫）。
4. 可选：有人在线时才累加（避免桌面空开会话空转扣时）；需与产品确认是否「仅对端加入后计时」——**当前 legacy 语义即「有 client 才计」**，应保持一致。

**成功标准**：

- Free 用户建立 V2 连接后，约 2s 粒度 `UsedSeconds` 递增。
- 无人连接时不递增。
- 到 300 秒后 `limitReached == true`。

### 5.2 P0：降级真正接到 V2 数据面（必须）

在 `UsedSeconds >= 300 && !IsPaid` 时：

| 能力点 | 行为 | 建议挂载点 |
| :--- | :--- | :--- |
| 消息 | ~30% 发送失败（可配置），错误可被客户端当系统提示 | `websocket` `CommandSendText` 或 `Session.SendText` 前 |
| 上传 | 单文件 >2MB → 413 / 明确错误文案 | `handleUpload*` / attachments |
| 下载 / stream | 约 100 KB/s 限速 | `handleDownload` + bandwidth `RegisterJob` 策略 |

**注意**：不要只依赖当前 `PolicyFree = 2MB/s` 冒充「超额降级」——与设计 **100 KB/s** 不符。

建议新增明确策略，例如：

```text
PolicyPaid          → 100 MB/s
PolicyFreeQuota     → 满速或接近满速（配额内）
PolicyFreeDegraded  → 100 KB/s（超额）
```

### 5.3 P1：拆清 `IsPaidOrUnrestricted` 语义

当前把「已付费」与「未超额」绑在同一 bool，导致：

- Free 配额内按 Paid 带宽跑；
- 后续策略扩展困难。

建议拆分：

```go
isPaid bool
withinFreeQuota bool // UsedSeconds < 300
// rate policy = f(isPaid, withinFreeQuota)
```

或提供：

```go
func FreeChatDegraded() bool // !paid && usedSeconds >= 300
func BandwidthClass() Paid | FreeFull | FreeDegraded
```

### 5.4 P1：GUI 与后端统一（单一可信源）

1. 展示与拦截以 `GetUsedSeconds()` / agent status 的 `usedSeconds` 为准。
2. 去掉或降级 `localStorage` 双轨（最多作离线展示缓存，启动时以后端为准覆盖）。
3. `exhausted` 真正禁用「开始 Chat」或改为「仍可开聊但提示已降级」（与产品「不硬掐断」一致时，应允许开聊但明确展示降级状态）。
4. Dev `DevSetUsedSeconds` 后应刷新 UI 剩余时间，不再只改后端。

### 5.5 P2：文档与遗留代码清理

1. 更新 `license-tier-analysis.md` 中 Chat 行：实现路径改为 V2。
2. 标明 legacy chat 降级代码为历史路径或删除/加 `// deprecated`。
3. Chat V2 前端（Svelte）若需展示剩余额度，通过 `/info` 或 health 扩展返回 `usedSeconds` / `isPaid` / `degraded`。

---

## 6. 测试与验收

### 6.1 单元 / 集成

| 用例 | 断言 |
| :--- | :--- |
| V2 有客户端注册 | `UsedSeconds` 随时间递增 |
| V2 无客户端 | 不递增 |
| `UsedSeconds` 从 298 → 302 | `FreeChatDegraded() == true` |
| 降级后 send_text 多次 | 失败率落在合理区间（可注入 mock rand） |
| 降级后上传 3MB | 拒绝 |
| 降级后下载 | 吞吐接近 100KB/s（允许测试用更严 mock） |
| 付费用户 | 永不降级 |

### 6.2 手动自证（修复前 / 后）

**修复前可复现**：

1. Free 账号开 Chat，手机扫码连入，聊数分钟。
2. 查看 `chat_usage.json` 的 `usedSeconds` —— 预期几乎不变。
3. Dev 强制 `DevSetUsedSeconds(300+)` 后传大文件 —— 若仍满速、无 2MB 拒、无消息随机失败，可确认 V2 未挂降级。

**修复后验收**：

1. 连接后 `usedSeconds` 稳定上涨。
2. 到 300 后附件 / 消息 / 带宽行为符合设计。
3. GUI 剩余时间与后端一致；刷新 / 重启不丢（或按日重置规则正确）。

---

## 7. 实施顺序建议

```text
Step 1  P0  V2 在线感知 → IncrementUsage 接通
Step 2  P0  V2 send/upload/download 挂接 FreeChatDegraded
Step 3  P1  带宽策略三档 + 拆 IsPaidOrUnrestricted
Step 4  P1  GUI 单一可信源 + exhausted 产品语义落地
Step 5  P2  文档同步 + legacy 死代码处理 + 回归测试合入
```

**最小可交付（MVP）**：Step 1 + Step 2 即可让「用量特点」重新可观测、可感知。  
**商业闭环**：再加 Step 3 + Step 4，与 `tier-design.md` 完全对齐。

---

## 8. 风险与不变量

1. **Share / Receive 限额逻辑不得被本改动破坏**（`UsedTransfers` / `UsedReceiveTransfers` 独立）。
2. **已付费用户路径零退化**（`IsPaid == true` 时不限时、不降级）。
3. **会话中途超额不强制 `signalStop` 掐断**（与 DRM skill 中「无物理时限中断、下次任务再拦」精神一致；Chat 侧为体验降级而非断连）。
4. **离线 Free**：现有逻辑在未在线时会将用量视作耗尽（600s 等）以限制高级体验——改动时保持该安全语义。
5. **测试环境**：`EQT_TESTING` / mock status 行为保持 CI 可用。

---

## 9. 结论

| 项目 | 说明 |
| :--- | :--- |
| 问题本质 | 非「规则写丢」，而是 **Chat V2 迁移后「在线客户端 → 秒数累加 → 降级策略」中间断环** |
| 最关键断点 | ticker 读 `legacy chatSession.clients`，真实连接在 V2 session |
| 次要问题 | GUI localStorage 双轨、V2 未移植 legacy 降级、带宽策略与 100KB/s 设计不一致 |
| 修复优先级 | 先接通计时，再挂 V2 降级，再统一 UI 与策略语义 |

---

## 10. 修订记录

| 日期 | 说明 |
| :--- | :--- |
| 2026-07-23 | 初稿：现象、根因、对照表、分阶段修复与验收标准 |
