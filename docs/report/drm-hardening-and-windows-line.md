# DRM 加固与 Windows 行为安全防线推进方案（评审修订版）

> 状态：已评审（2026-08-24 第二轮），结论 = 三方案均**暂不实施**（维持现状 / 否决 / 暂缓）
> 初版日期：2026-08-24；修订日期：2026-08-24
> 范围：对初版三方案的评审结论与最终决策，保留技术分析存档，供未来触发条件成立时复用
> 前置文档：`docs/report/device-registration-server-side.md`、`docs/report/licensing-flow-audit.md`
> 背景：2026-08-24 已移除开机自启动、硬件指纹改 WMI COM 直调（commit 3911810）；本文件为后续三点优化建议的评审结论

---

## 决策摘要

| # | 方案 | 结论 |
|---|---|---|
| 一 | 免费配额"服务端确认已注册才授予"（移除硬编码默认 key） | **维持现状，不实施**。在线 SSOT 已实现；局域网直连下离线突破无实际成本。仅在云中继上线时按 §1.4 启用 |
| 二 | WMI 失效注册表兜底 + 指纹豁免 | **否决**（宁放弃，不搞乱）。3-of-2 现实已稳定，MachineGuid 兜底引入双重漂移成本 |
| 三 | Autostart 合规回归路径 | **暂缓/不做**。主动触发型工具自启收益小、WebView2 常驻成本大；最合理架构需先拆分 headless agent，性价比低 |

---

## 一、免费配额"服务端确认已注册 device_id 才授予"

### 1.1 现状事实（初版核对，保持有效）

| 环节 | 位置 | 现状 |
|---|---|---|
| 配额判定 | `pkg/server/chat_limiter.go:39-42` `FreeChatDegraded`、`:653` | 本地 `UsedSeconds >= FreeChatDailySeconds`(300s)，**执行点在客户端本地** |
| 本地文件完整性 | `chat_limiter.go:404-415` `loadUsageLocked` | `MAC` = HMAC-SHA256(`machineKey`)，`machineKey = GetDeviceStableID()` |
| 设备身份 | `hardware.go:314-382` | 已注册 → 服务端 `device_id`（`device_id.dat`）；未注册 → `""` |
| 服务端权威同步 | `chat_limiter.go:567-636` `SyncUsageToServer` → `/api/v1/device/sync-usage` | 已注册设备在线以服务端为准（Ed25519、fail-closed、取 max） |
| 服务端注册强制 | `drm.ts:1002-1012` | sync-usage 已要求 `device_id` 存在于 `device_registry`，否则 404 |
| 传输路径 | `cmd/desktop.go` `desktop share` → `sendCmdFunc`；server 本机 HTTP + 局域网 QR | **局域网直连**，`drm-api` 服务器只做许可/配额记账，不中继文件 |

### 1.2 关键认知修正（第二轮）

- **纯本地机制防不住本机权限攻击者**：ephemeral key 即便存 `usage_key.dat`(0600)，管理员可读 key → 仍能手写 MAC。初版称"封死"是**过度承诺**；实际能力仅是**抬高作弊成本**。
- ephemeral key 真实防的是两件事：① 外部批量伪造（默认 key 是编译进二进制的公开常量，可离线生成任意机器合法文件再分发，无需目标机权限）；② 普通用户手改 json / 回拨时钟。
- **离线突破免费配额的实际损失 ≈ 局域网流量，服务器成本趋近于零**——因为文件不经服务器中继。

### 1.3 结论：维持现状，不实施

"在线 SSOT（已实现）+ 离线宽容 + 局域网直连"是合理的产品现状。免费配额本意为限"每日活跃"（防滥用），不产生真实成本。**不做任何代码改动。**

### 1.4 未来触发条件（存档，成立时启用）

仅当出现以下任一时才回到初版 L1/L2 设计（文档保持存档）：

- 引入**云中继/云分享**（文件路径经服务器），配额突破变为真实带宽成本；
- 或免费配额改为**服务端强限制**（如服务端判定超额后完全禁止，而非本地取 max）。

届时启用路径（存于初版 §1.3）：
1. L1 移除硬编码默认 key：未注册设备改持久化随机 ephemeral key（`usage_key.dat`）；删除 `chat_limiter.go:413` 恒冗余分支；`:410` 改一次性迁移后关闭兼容窗口。
2. L2 未注册在线 fail-closed：`SyncUsageToServer` 对 404 置 `registrationPending`，在线且未注册 → 配额受限；离线沿用本地配额宽限。

---

## 二、WMI 失效注册表兜底 + 指纹豁免

### 2.1 否决理由

- **3-of-2 现实已稳定**：CPU `ProcessorId` 在真实 Windows 上本就经常为空（commit 验收日志实测 `Retrieve CPU Serial finished in ... (empty: true)`），正常机器 3-of-2 现实多为 **2-of-2（board+disk）**，已稳定工作。
- **MachineGuid 兜底引入双重漂移**：重装系统漂移 + WMI 恢复后漂移，两次都可能触发付费证书**重新激活**，产生真实支持成本。
- **豁免规则放宽安全面**：即便设计上限制"字段非空却失配仍严格"，仍新增一条安全分支，需额外测试与维护，违反 Simplicity First。
- **目标机器占比极低**：WMI 整体失效（board 也拿不到）仅出现在精简/PE 系统，付费用户中占比更低，损失可忽略。

### 2.2 最终决策：否决，维持现状

WMI 失效 → 付费激活/校验不可用 → **引导用户修复系统（启用 winmgmt）或联系支持**。不做注册表兜底、不做豁免、不新增日志来源标记。付费激活链路保持单一指纹来源（WMI COM），语义简单可预期。

### 2.3 存档的替代（不推荐，仅记录）

若未来出现"合法付费用户因环境无法激活"的批量投诉，替代方案是**客服侧手动授权**（黑名单白名单 / 一次性激活码），而非在运行时放宽指纹规则。运行时指纹匹配保持严格。

---

## 三、Autostart 合规回归路径

### 3.1 必要性评估：不建议做

- EQT 是**主动触发型**工具（右键/打开应用才用），自启收益 = 减少"想用时没开"的摩擦，收益很小。
- 当前 agent **内嵌在 GUI**（`desktop/gui/agent.go` `desktopAgent`），自启若起 GUI = **WebView2 常驻**（约 100–200MB 内存），为"偶尔用"的工具付常驻成本不划算。
- `desktop share` 是独立进程直接跑 server，**不提交给 agent**——自启一个"转发器"没有意义，必须起真正承载 agent 的进程。

### 3.2 未来最合理架构（存档）

若产品层面确认"开机静默可用"是强需求，架构上唯一合理形态是 **headless agent 常驻 + GUI 按需连接**：

```
用户开机
 └─ Run 键 / Startup .lnk → eqt-agent.exe  (windowsgui 子系统瘦二进制，
       无 UI、无 WebView2，仅 net/http + 任务执行，静默常驻监听 48176)
用户想用 GUI
 └─ 双击 eqt-desktop.exe (完整 GUI) → 连接已有 agent（或自起）
```

分两段实施：
- **A 段**：将 `desktop/gui/agent.go` 的 `desktopAgent` 逻辑抽为独立 headless 入口，编译为 `-H=windowsgui` 瘦二进制（0 黑框、0 脚本包装层）。
- **B 段**：自启机制二选一，均无 PowerShell/VBScript 包装：
  - 首选：NSIS 安装期向用户 Startup 文件夹放 `.lnk`（`CreateShortCut`，无需管理员），卸载删除；
  - 备选：`HKCU\...\Run` 直写 `"<eqt-agent.exe>"` 全路径。

### 3.3 决策：暂缓/不做

自启收益小、拆分 agent 工程成本大、WebView2 常驻不划算。**不做**。本方案仅归档，作为未来打包里程碑（release C1）或产品强需求出现时的设计依据。

---

## 四、决策结论表

| 项 | 结论 | 动作 | 触发条件 |
|---|---|---|---|
| 免费配额服务端权威化 | 维持现状 | 无代码改动 | 云中继/云分享上线（§1.4） |
| WMI 兜底 + 豁免 | 否决 | 无代码改动 | 批量合法付费用户无法激活（§2.3，走客服授权） |
| Autostart | 暂缓/不做 | 无代码改动 | 产品强需求 + release C1 打包里程碑（§3.2） |

## 五、验证与回归

本轮无代码改动，无需构建/测试。若未来任一条触发条件成立，回到对应存档节并执行初版实施清单，按仓库流程跑 `go test ./pkg/server/ ./cmd/` 与 pre-commit Windows 验收。
