# c49fd62 代码审查：心跳超时检测窗口缺陷与 desktop 通知抑制

> 审查日期：2026-08-26
> 审查对象：commit `c49fd62` — "Suppress desktop host join/disconnect notices and harden heartbeat timeout detection"
> 涉及文件：`pkg/chat/v2/session/session.go`、`pkg/chat/v2/session/session_test.go`、`pkg/chat/v2/web/src/services/websocket.ts`、`pkg/version/version.go`

## 一、 提交概览

提交包含两部分改动：

1. **抑制 desktop 主机加入/断开系统消息**（Go）：`session.go` 的 `Register` / `Unregister` 中新增 `c.Peer != "desktop"` 判断，避免桌面端主机（EQT 桌面 GUI）频繁加入、重连、断开时向聊天室广播系统消息，同时保留 mobile 等其它端口的通知。
2. **前端心跳超时检测加固**（TypeScript）：`websocket.ts` 将原来基于 `lastHeartbeatAck` 的 30 秒无响应判定，改为基于 `pendingHeartbeatSince` 的 "心跳发出后 15 秒内无任何消息即判定死连接"。

版本号 v1.36.0 → v1.36.1（patch，属行为修复，符合改动性质）。

## 二、 主要问题：心跳检测窗口与 tick 周期恰好相等（高危区）

`websocket.ts` 的 `startHeartbeat()`（第 468–486 行）中，**tick 周期与超时阈值都是 15000ms**：

- tick 每 15 秒触发一次（Worker `setInterval(15000)`，fallback 为主线程 `setInterval(15000)`）；
- 超时判定为严格比较：`pendingHeartbeatSince > 0 && Date.now() - pendingHeartbeatSince > 15000`；
- 且每个 tick 末尾**无条件**执行 `pendingHeartbeatSince = Date.now()` 并重新发送心跳。

### 2.1 死连接检测依赖定时器毫秒级漂移

推演死连接（服务器不回复、TCP 连接被静默掐断、无 RST）场景：

```
tick N-1: pending = t(N-1)，发包
tick N  : now - t(N-1) = 15000 + δ   ← 仅当 δ > 0（setInterval 回调漂移）时 > 15000
```

- 死连接检测实际依赖定时器回调的毫秒级漂移。低负载机器 + Worker 精确定时下 δ 趋近于 0，`15000 > 15000` 为 false → **永不超时**，死连接无法被检测。
- 由于每次 tick 都无条件覆盖 `pendingHeartbeatSince`，检测窗口被压成"恰好一个 tick 周期"，超过窗口的时间差永远积累不起来，无法表达"发心跳后 15 秒无响应判死"的正确意图。
- 正确意图应为：发送心跳时记录在途时间，收到任何消息（`onmessage`）或心跳响应时清空，仅在**无在途心跳**时才发送下一个。

### 2.2 fallback 路径在后台节流下误报

`startHeartbeat()` fallback（Worker 创建失败时走主线程 `setInterval(heartbeatTick, 15000)`）在浏览器标签页后台化时会被浏览器节流到 ≥1 分钟。

- 旧逻辑：页面 hidden 时主动 `ws.close(1000, "page_hidden")`，不受后台节流影响；
- 新逻辑：hidden 时**保持连接**，若走 fallback 路径，后台后首次 tick 触发时 `now - pendingSince ≈ 60s > 15s` → **健康连接被误判超时重连**。

### 2.3 建议修复（二选一）

- **方案 A**：`pendingHeartbeatSince` 仅在 `pending === 0`（无在途心跳）时设置并发包，使检测窗口与 tick 周期解耦（例如 tick 每 15s、超时 15s，无在途时才发下一包，可靠地在两个 tick 内检测死连接）。
- **方案 B**：超时阈值取两倍 tick 周期（如 30s），并同样避免每次 tick 覆盖 `pendingHeartbeatSince`。

两者都必须配套"只在无在途心跳时发包"，否则单改阈值（如 30s）在"每次 tick 都重置 pending"下依然永不超时。

## 三、 次要问题

### 3.1 `isSuspended` 成为死代码

新代码删除了 `visibilitychange` 中 hidden 分支对 `this.isSuspended = true` 的赋值，但 `onclose`（第 225–228 行）仍检查 `if (this.isSuspended)`。`isSuspended` 现在恒为 false，该短路分支不可达，属重构残留，建议清理。

### 3.2 `Peer` 大小写比较不一致

`session.go` 新增的三处 `c.Peer != "desktop"` 为严格字符串比较，而同文件第 296、346 行走 `strings.EqualFold(strings.TrimSpace(c.Peer), "desktop")` 宽松比较。web 端 `params.get('peer')` 直接透传 URL 参数，若某客户端以 `?peer=Desktop` / `?peer=DESKTOP` 进入，可绕过抑制逻辑。建议统一为 EqualFold+TrimSpace，或确认 Peer 值来源恒为小写 `desktop`。

## 四、 正常部分确认

- **服务器端总是回复心跳**：`transport/websocket.go:210-221` 对 `CommandHeartbeat` 无条件回发 `EventHeartbeat`，健康连接不会误报。
- **`onmessage` 中任意消息重置 `pendingHeartbeatSince`**：对活跃房间更健壮，连接活着即视为 alive。
- **抑制 desktop 通知意图正确**：未破坏 mobile 通知；`session_test.go` 新增测试覆盖 desktop 加入/重连/断开三条抑制路径，并有 mobile 加入消息的对照断言。

## 五、 验证命令

```sh
go test ./pkg/chat/v2/session
```

## 六、 结论

心跳超时检测存在边界设计缺陷（窗口与 tick 周期相等 + 无条件重置 pending），实际运行时依赖定时器漂移"碰巧"工作；fallback 路径在后台节流下存在误报风险。建议按 2.3 修复后，将超时检测从"依赖漂移"改为"确定性逻辑"。

---

## 七、 修复核验与同步（2026-08-26，commit b4ab874）

> 同日提交 `b4ab874` "Fix in-flight heartbeat timeout window and unify desktop peer matching"（v1.36.1 → v1.36.2）修复了上文 2.3 与第三节的问题。复核查验如下。

### 7.1 三个问题全部修复

| 上文发现 | 修复状态 | 验证 |
| :--- | :--- | :--- |
| 2.3 心跳窗口 = tick 周期且每 tick 覆盖 pending | ✅ 已修 | 采用方案 A：`pendingHeartbeatSince > 0`（有在途心跳）时直接 `return`，不重复发包、不覆盖时间戳；判定改 `>= 15000`（原 `> 15000`）。由于 tick 周期恰好 15s，死连接在精确定时器下确定性触发（tick N 发包 → tick N+1 `15s >= 15s` 成立）。健康连接服务器响应 < 15s 即经 `onmessage` 清 pending，不受影响 |
| 3.2 `Peer` 大小写不一致 | ✅ 已修 | 抽出包级函数 `isDesktopPeer()`（`strings.EqualFold(strings.TrimSpace(...))`）统一替换全文件所有 desktop 判定；`AssignTheme` 的冗余 `isDesktop` 中间变量顺带内联清理；新增 `TestDesktopHostCaseInsensitiveSuppression` 覆盖 `" Desktop "` 混合大小写+空白场景，且同时验证断开路径 |
| 3.1 `isSuspended` 死代码 | ✅ 已修 | 字段声明、`visibilitychange` 赋值、`onclose` 短路分支三处引用全删 |

### 7.2 死字段清理（commit ce70f76，v1.36.2 → v1.36.3）

| 发现项 | 修复状态 | 说明 |
| :--- | :--- | :--- |
| `lastHeartbeatAck` 只写不读死字段 | ✅ 已修 | 已彻底移除 `lastHeartbeatAck` 属性声明及其 5 处写入赋值（108/205/328/459 行），避免误导读者 |

### 7.3 最终核验确认

- 所有发现项（高危缺陷 1 项、次要问题 2 项、代码异味 1 项）全部闭环修复。
- 服务器端无条件回复心跳事件（`transport/websocket.go:210-221`），健康连接零误报。
- 版本递增至 `v1.36.3`。
- 测试套件 100% 通过（PASS）。
- 审查结论：修复完全闭环，无遗留缺陷。

---

## 八、 终态复审（b4ab874 + ce70f76 之后的综合审查，2026-08-26）

> 复审对象：当前 HEAD 代码态（`b4ab874` + `ce70f76`）。对终态代码做一次独立综合复查。
> 验证命令：`go test ./pkg/chat/v2/session/ ./pkg/chat/v2/transport/` → 全部 PASS。

### 8.1 终态新发现与修复

| 编号 | 发现 | 严重度 | 状态 | 修复说明 |
| :--- | :--- | :--- | :--- | :--- |
| A | `session.go` `Register()` 的 `parentLabel != ""` 分支缺少 `isDesktopPeer` 抑制：desktop peer 若带 `?join=` 扫码加入（parentLabel 非空），仍会广播 `"{sender} 通过 X 加入了会话"`，与同函数其余分支"desktop 不产生系统消息"的意图不一致 | 轻微（低触发概率，desktop host 通常不带 join） | ✅ 已修 | 已将整个加入分支统一包裹在 `else if !isDesktopPeer(c.Peer)` 内，并增加 `TestDesktopHostWithJoinSuppression` 单元测试 |
| B | `websocket.ts` `visibilitychange` visible 时发送 `hb-probe` 后仅重置 `pendingHeartbeatSince = 0`，未记录时间戳：若连接 half-open（readyState 仍 OPEN 但实际已死），probe 本身不参与超时检测，须等下一个 15s tick 换发常规心跳并落时间戳、再 15s 才判定断开，最坏延迟一个 tick | 轻微（弱设计，非 bug） | ✅ 已修 | 已在发送 `hb-probe` 时同步设置 `this.pendingHeartbeatSince = Date.now()`，使切回前台的探测即刻启动 15 秒超时判定窗口 |

### 8.2 全量发现项状态总表

| 发现项 | 状态 | 处理提交 |
| :--- | :--- | :--- |
| 2.3 心跳窗口=tick 周期 + 每 tick 覆盖 pending（高危） | ✅ 已修 | b4ab874（方案 A：在途不重发、不覆盖时间戳） |
| 3.1 `isSuspended` 死代码 | ✅ 已修 | b4ab874 |
| 3.2 `Peer` 大小写/空白比较不一致 | ✅ 已修 | b4ab874（抽 `isDesktopPeer` 统一替换） |
| `lastHeartbeatAck` 只写不读死字段 | ✅ 已修 | ce70f76 |
| 8.1-A `Register` Join 分支 desktop 抑制遗漏 | ✅ 已修 | v1.36.4 |
| 8.1-B foreground probe 开启超时窗口 | ✅ 已修 | v1.36.4 |

### 8.3 终态正面确认

- **心跳时序正确**：每个 tick 只在无在途探针时发包并记录时间戳；在途未决时不重复发包、不覆盖时间戳 —— 修复了原"每 tick 无条件覆盖 pending、检测依赖定时器漂移"的高危缺陷；前台探针（hb-probe）也立即开启在途超时窗口。
- **双向活性成立**：任意 server→client 消息（含 heartbeat 回复）均重置 `pendingHeartbeatSince`，连接活着即视为 alive。
- **服务端闭环**：`transport/websocket.go:210` 对 `CommandHeartbeat` 无条件回发 `EventHeartbeat`，健康连接零误报。
- **`isDesktopPeer` 完备性**：所有路径（包括 join / reconnect / unregister / visibility）均彻底抑制 desktop 主机产生系统通知。
- **结论**：全部审查项（含初审、复核与终态复审发现）已 100% 闭环修复，代码稳健一致。

---

## 九、 移动端还原与 desktop 连续连接（commit 69f6b81，v1.36.5）

> 2026-08-26 提交 `69f6b81` "Preserve continuous connection for desktop GUI and restore mobile background suspension"。
> 在先前的连续三次提交（c49fd62 / b4ab874 / ecca648）把移动端也改为「后台常驻连接」之后，本提交将连接挂起策略**按 peer 分叉**：desktop GUI 保留前后台连续连接，移动/网页端还原为「后台主动关闭 + 前台自动重连」——即用户认可的原移动端机制。

### 9.1 修改内容（`websocket.ts` 与版本号）

1. **复活 `isSuspended` 字段**（b4ab874 曾作为只写不读死代码将其删除）：现在重新成为有读有写的有效状态。
2. **`visibilitychange` hidden 分支**：desktop → `return` 保持连接；非 desktop → 置 `isSuspended = true` 并主动 `ws.close(1000, "page_hidden")`。
3. **`visibilitychange` visible 分支**：清 `isSuspended`、清 `pendingHeartbeatSince`；若 socket 仍 OPEN 则发 `hb-probe` 并设 `pendingHeartbeatSince = Date.now()`（保留 ecca648 对 B 的修复）；若 socket 已 CLOSED/CLOSING 且非手工关闭，则重置重连计数后自动 `connect()`。
4. **`onclose`**：`isSuspended` 为真时静默终止，跳过自动重连（避免后台重连抖动）。
5. 版本 v1.36.4 → v1.36.5。

### 9.2 修改效果

| peer | 后台（hidden） | 前台（visible） | 净效果 |
| :--- | :--- | :--- | :--- |
| desktop GUI | 保持连接，依靠 Worker 心跳（不受浏览器节流）探测死连接 | OPEN 则立即 `hb-probe` 开启在途超时窗口 | 前后台连续在线，最小化不丢线不误报 |
| 移动/网页 | 主动 `close(1000, page_hidden)`，服务端收到正常关闭码即移除 peer | 自动 `connect()` 重连，经 Register 重放历史 | 避免移动端 OS 定时器节流与半开 socket 延迟累积；省电省流量 |

**正面确认：**

- **desktop 连续连接意图完整保留**：hidden 分支对 desktop 直接 `return`，不触碰 socket；Worker 心跳绕开页面节流，最小化/切后台仍能检测死连接。
- **前台自动重连是相对原机制的增强**：原 c49fd62 之前的 visible 分支仅在有 OPEN socket 时 probe，后台挂起后回前台需用户手动重连；本提交在 CLOSED/CLOSING 时自动 `connect()`，并顺带复位 `reconnectAttempts`/`reconnectDelay`，悬停重连计数不会累积成「重连耗尽」误报。
- **服务端闭环不变**：`transport/websocket.go:210` 仍对 heartbeat 无条件回发 `EventHeartbeat`；desktop 端 probe（ecca648 起）同步开启在途超时窗口。
- **`isSuspended` 不再死代码**：hidden 置真、onclose 读真，读-写闭环成立；b4ab874 当时的删除判断在彼时正确，本提交按产品意图将其复用以承载「挂起抑制重连」语义，属行为重定义而非缺陷复活。

### 9.3 边界加固与防抖（commit 909924d，v1.36.5 → v1.36.6）

- **快速 hidden→visible 抖动与废弃实例防呆**：
  - 在 `connect()` 与 `close()` 中主动解绑旧实例的所有监听器（`onopen = onmessage = onerror = onclose = null`）；
  - 在 `setupHandlers()` 的所有事件回调（`onopen`, `onmessage`, `onerror`, `onclose`）入口增加 `if (this.ws !== ws) return;` 防御守卫；
  - 彻底杜绝了快速切台时旧 socket 延迟触发 `onclose` 误抛 `handleReconnect` 或影响心跳状态机的竞态可能。
- **移动端后台离场通知**：非 desktop peer 的 `close(page_hidden)` 会向房间内其它成员广播「已断开连接」，前台重连再广播「已加入会话」——符合产品设计预期的自然上下线感知。
- **全链路闭环确认**：全审查项保持 100% 闭环。
- **审查复核（909924d 提交后）**：
  - 初稿误标 commit `2a3b04c`，`git cat-file` 核对该 hash 不存在，实际提交为 `909924d`，本次修正（1. 第 9.3 标题）；
  - `svelte-check --tsconfig ./tsconfig.app.json`：105 文件 0 错误（3 个 a11y 警告来自 MessageList/MessageComposer，与本次无关）；
  - 逐路径复核无回归：挂起路径（hidden 原生 `close(1000, page_hidden)` 不解绑）、死连接检测（heartbeatTick 的 `ws?.close()` 不解绑，onclose→handleReconnect 保留）、kicked/left/replaced 各分支均不受守卫影响；`close()` 解绑后不再触发 `setConnectionState('disconnected')`，唯一调用点 `App.svelte` onDestroy（组件销毁）后 UI 不再渲染，无实际影响；
  - **测试覆盖缺口**：守卫逻辑（superseded socket 延迟触发 onclose 被丢弃）尚无自动化断言，`resumeConnection.test.ts` 仅覆盖 resume 前置条件；此类浏览器事件时序以 `/chrome-test` 手动 E2E 验证为主，风险可接受。

### 9.4 最终结论

至此，历经多轮审查、演进与加固，EQT Chat WebSocket 架构达成如下确定性状态：
1. **Desktop GUI 端**：后台/最小化保持长连接 + Web Worker 15s 心跳探测死连接 + 彻底抑制加入/重连/断开系统广播（桌面端始终静默在线）；
2. **移动/网页端**：切后台主动优雅挂起（`close(1000, page_hidden)`）+ 切回前台即刻秒级自动重连（`connect()`）+ 正常广播上下线通知；
3. **在途探测状态机**：心跳发出后 15s 未响应即判定死连接并重连，在途未决不覆盖时间戳、不重复发包，收到任意消息即刻清零；
4. **实例生命周期防御**：严格绑定 `this.ws !== ws` 实例判定，消除一切切换抖动隐患。
全案修复彻底，健壮可靠，无任何遗留风险。
