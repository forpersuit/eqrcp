# Chat 模式 Free Tier 用量特点：分析与修复方案

> **日期**：2026-07-23  
> **状态**：已按修订方案实现（v1.14.50，含标题栏倒计时胶囊）  
> **范围**：Free tier 下 Chat 模式每日 5 分钟额度、超额附件体验降级（限速 / 文件大小）

---

## 1. 问题现象（修复前）

Free tier 下 Chat 模式的「用量特点」看起来没有生效：

- 聊天可以长时间满速使用，未见 5 分钟额度耗尽后的体验降级。
- 附件未见超额后的 **2MB** 硬限制与 **100 KB/s** 限速。
- 桌面 GUI 顶部可能仍有倒计时文案，但与后端真实能力边界脱节。

---

## 2. 产品设计（应然 · 修订后）

权威设计见：

- [`docs/payment/tier-design.md`](../payment/tier-design.md)
- [`docs/payment/license-tier-analysis.md`](../payment/license-tier-analysis.md)

| 阶段 | Free Chat 行为 |
| :--- | :--- |
| 每日前 **5 分钟（300 秒）** | 满速 Chat 体验（文本 + 附件） |
| 超额后 | **不硬掐断会话**，进入**附件数据面**体验降级 |
| 超额限速 | 附件传输约 **100 KB/s**（仅 Transfer/HTTP 数据面） |
| 超额附件 | 单文件最大 **2 MB** |
| 文本消息 | **不丢弃、不随机失败、不强制冷却** |
| 系统提示 | 超额瞬间推送**一条**系统气泡（应用内，非 alert） |
| WebSocket | 心跳 / 控制 / 文本 **永不限速** |

**产品决策（2026-07-23）**：

1. **移除约 30% 随机消息失败**——鸡贼、不可预期、易被当成 Bug，且在 WS 下可能触发重连风暴。  
2. **降级只保留「传输速率 + 文件大小」**——诚实、可解释，痛点打在生产力传文件上。  
3. **目标 V2 only**：Legacy Chat 路径后续有序退役；当前修复以 V2 为权威路径。  
4. **计时条件**：仅当存在 **remote peer（`peer != "desktop"`）** 时累加；**仅 Host 本地连接不计时**。

后端权威计时：`ChatLimiter.UsedSeconds`（落盘 `chat_usage.json`）。

设计原则：**体验降级代替硬性锁死与整蛊**，让用户可继续闲聊，真要当生产力传大文件再痛。

---

## 3. 根因（第一性原理）

> **产品迁到 Chat V2 后，用量计时仍盯着 legacy `chatSession.clients`，而真实连接登记在 V2 session 里，导致 `UsedSeconds` 几乎永远为 0；下游所有「超额后降级」都以它为门槛，因此一起空转。**

### 3.1 计时依赖 legacy 客户端表（已修复）

旧逻辑 2 秒 ticker 仅当 **legacy** `chatSession.clients` 非空时累加。  
V2 客户端经 WebSocket 注册到 `pkg/chat/v2/session.Session.clients`，**不会**写入 legacy map。

### 3.2 Host 也会占一条 V2 连接

桌面 Chat URL 带 `peer=desktop&hostToken=...`，Host 自身 `connect()` 后 `ClientsCount() > 0`。  
若仅用 `ClientsCount() > 0`，**点开桌面 Chat 页就会开始扣 5 分钟**——错误。

### 3.3 因果链（修复前）

```
Chat 启动
  → 挂载 /chat-v2 Handler + V2 Session Manager
  → Host 本地 WS 连上（peer=desktop）
  → 手机扫码 → V2 remote clients++
  → legacy clients 仍为空
  → ticker 从不 IncrementUsage
  → UsedSeconds 保持 0
  → 附件「未受限」路径恒真
  → Free 用户长期接近满速、无 2MB 硬限
```

Share / Receive 限额不依赖 Chat 在线秒数，可正常；**唯独 Chat 时间额度链路曾断**。

---

## 4. 实现现状（修复后）

### 4.1 计时

| 项 | 实现 |
| :--- | :--- |
| 触发条件 | `chatV2Handler.HasRemoteClient()` → 存在任一 `peer != "desktop"` |
| 累加 | 每 2s `IncrementUsage(2)` |
| Host-only | **不扣时** |
| Remote 在线 | **扣时**（不要求 Host 同时在线，避免 Host 重连抖动被钻空） |
| Remote 全离 | **暂停扣时**（不按日清零，日切由 usage Date 处理） |
| 超额提示 | 首次进入降级时 `BroadcastSystemMessage` 一条系统气泡 |

### 4.2 附件数据面降级

| 能力点 | 行为 | 挂载点 |
| :--- | :--- | :--- |
| 下载 | `RegisterJob(id, unrestricted)`；超额 `PolicyFreeDegraded` = 100KB/s | `pkg/chat/v2/http/files.go` |
| 上传 | 超额 2MB 拒绝 + 上传流 throttle | `attachments.go` |
| 本地登记 | 超额 2MB 拒绝 | `handleLocalAttachmentRegister` |
| WS / 文本 / 心跳 | **不限速、不丢消息** | — |

### 4.3 带宽策略

```text
PolicyPaid           → 100 MB/s   （付费 或 Free 配额内）
PolicyFreeDegraded   → 100 KB/s   （Free 超额附件）
```

- 超额 job **禁用 probing**，避免 min-capacity 地板把 100KB/s 抬回 2MB/s。  
- Scheduler **只服务附件 Transfer**，不包裹 WebSocket。

### 4.4 辅助 API

```go
// pkg/server/chat_limiter.go
const FreeChatDailySeconds = 300
const FreeChatMaxAttachmentBytes = 2 << 20
const FreeChatDegradedBytesPerSec = 100 * 1024

func FreeChatDegraded() bool
func FreeChatAttachmentUnrestricted() bool
```

```go
// pkg/chat/v2/session
func (s *Session) HasRemoteClient() bool
func (m *Manager) HasRemoteClient() bool
```

### 4.5 明确不做

| 项 | 原因 |
| :--- | :--- |
| 30% 随机消息失败 | 不优雅、像故障、伤 WS 状态机 |
| 发送频率冷却（MVP） | 非必须；文本保持可用 |
| 裸 `ClientsCount() > 0` | 会把 Host 本地连接算进额度 |
| 对整条 WS 连接全局限速 | 心跳超时断连 |

### 4.6 Legacy

- 当前生产默认 V2；legacy 附件降级常量已与修订对齐，并**移除** 30% 文本失败。  
- **目标**：E2E 稳定后强制 `EnableChatV2`、隐藏设置开关、删除 legacy handlers（见 §7）。  
- **不**在 V2 未验证前无序物理删除双栈入口。

### 4.7 关键文件

| 职责 | 路径 |
| :--- | :--- |
| 用量常量 / FreeChatDegraded | `pkg/server/chat_limiter.go` |
| ticker + 系统提示 | `pkg/server/chat.go` |
| V2 Handler 在线/广播 | `pkg/chat/v2/http/routes.go` |
| 附件上下载限速/限大小 | `pkg/chat/v2/http/files.go`, `attachments.go` |
| 带宽策略 | `pkg/chat/v2/bandwidth/policy.go`, `scheduler.go` |
| Remote 判定 | `pkg/chat/v2/session/session.go`, `manager.go` |

---

## 5. 修复方案（实施记录）

### 5.1 P0 已完成：remote peer 计时

- `HasRemoteClient()` 忽略 `peer=desktop`  
- ticker 改挂 `s.chatV2Handler.HasRemoteClient()`  
- 超额首次系统气泡  

### 5.2 P0 已完成：附件降级接到 V2 数据面

- 2MB 上限：upload init / upload / local register  
- 100KB/s：download `RegisterJob` + upload `throttledUploadReader`  
- 文本路径无失败注入  

### 5.3 P1 已完成：策略语义

- `IsPaidOrUnrestricted` / `FreeChatAttachmentUnrestricted` = 付费 **或** 配额内  
- `PolicyFreeDegraded` 硬顶 100KB/s；超额 job 不 probing  

### 5.4 P1 已完成：倒计时 UI + GUI SSOT

- **展示位置**：Chat V2 标题栏右侧、设备列表按钮左侧 `.quota-pill`（**仅桌面 / 非 mobile layout**；桌面 embedded iframe 显示）。
- **不显示**：Chat 模式 Start 开始页；移动端浏览器标题栏（`isMobileLayout` + CSS）。
- **数据**：`GET /chat-v2/{token}/info` 返回 `usedSeconds` / `remainingSeconds` / `freeDegraded`；前端 2s 轮询。
- **付费**：隐藏倒计时胶囊；非嵌入页可显示套餐徽章。
- **降级态**：胶囊文案「已降级」+ 灰色；≤60s 琥珀色脉冲。
- **点击**：打开 license 面板（今日额度说明 + 非嵌入时可链到 pricing）。
- **GUI 外壳**：去掉 localStorage 双轨计时；Start 页不展示额度文案。

### 5.5 P2 待续：Legacy 有序退役

```text
L1  V2 计时 + 附件降级 + 系统提示（本次）
L2  设置 UI 隐藏/删除 enableChatV2；代码强制 true
L3  删除 legacy /chat handlers
L4  文档与测试只保留 V2
```

---

## 6. 测试与验收

### 6.1 自动化

| 用例 | 位置 |
| :--- | :--- |
| Free 配额到达 → FreeChatDegraded | `pkg/server/chat_limiter_test.go` |
| Host-only 非 remote / phone 为 remote | `pkg/chat/v2/session/session_test.go` |
| 超额 job 硬顶 100KB/s、无 probing | `pkg/chat/v2/bandwidth/scheduler_test.go` |

### 6.2 手动验收

1. Free 账号仅开桌面 Chat：`usedSeconds` **不涨**。  
2. 手机扫码连入：开始上涨；手机全离：暂停。  
3. Dev 设 `UsedSeconds >= 300`：系统提示；附件 ≤2MB 可传但慢；>2MB 拒绝；文本正常。  
4. WS 心跳/消息不因限速断连。  

---

## 7. 风险与不变量

1. Share / Receive 限额逻辑独立，不得被本改动破坏。  
2. 已付费路径零退化。  
3. 会话中途超额 **不** `signalStop` 掐断——仅附件降级。  
4. 离线 Free 仍按现有安全语义视作额度耗尽。  
5. `EQT_TESTING` / mock 保持 CI 可用。  
6. **Rule 13**：Legacy 删除须在 V2 E2E 通过后按 L2→L3 执行。  

---

## 8. 结论

| 项目 | 说明 |
| :--- | :--- |
| 问题本质 | Chat V2 迁移后「在线客户端 → 秒数累加 → 降级策略」中间断环 |
| 计时修订 | **remote peer 在线才扣时**，Host-only 不扣 |
| 降级修订 | **仅附件 100KB/s + 2MB + 系统提示**；无 30% 文本失败 |
| 通道隔离 | 限速严格限附件数据面，WS 控制面永不限速 |
| Legacy | 目标删除；顺序验证后再砍 |

---

## 9. 修订记录

| 日期 | 说明 |
| :--- | :--- |
| 2026-07-23 | 初稿：现象、根因、对照表、分阶段修复 |
| 2026-07-23 | 修订：remote 计时；移除 30%；仅附件降级；WS 隔离；V2-only 退役顺序；实现 v1.14.49 |
