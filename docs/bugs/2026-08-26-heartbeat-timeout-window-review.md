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

### 7.2 新发现（minor）：`lastHeartbeatAck` 成为只写不读的死字段

`websocket.ts` 中 `private lastHeartbeatAck` 现有 5 处赋值（第 20 行声明 + 108/205/328/459 行 `= Date.now()`），**零读取**。旧逻辑由它驱动 30 秒超时窗口；b4ab874 改由 `pendingHeartbeatSince` 驱动后，该字段已无作用，与已清理的 `isSuspended` 同属旧逻辑残留。不影响功能，但建议删除，避免误导读者以为超时检测仍由它驱动。

### 7.3 复核确认

- 服务器端仍无条件回复心跳事件（`transport/websocket.go:210-221`），健康连接不会误报。
- 版本 v1.36.2 为行为修复，patch 合理。
- 审查结论：修复方向正确、无新增功能缺陷，仅剩 7.2 一处死字段待清理。
