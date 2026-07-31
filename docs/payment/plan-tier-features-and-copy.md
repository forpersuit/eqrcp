# EQT 套餐版本功能说明与 Free 额度离线代码分析

> **编写日期**：2026-07-31  
> **文档路径**：`docs/payment/plan-tier-features-and-copy.md`  
> **文档用途**：对 About / Plan (Pricing) 面板文案的梳理归纳，以及 Free 体验额度在纯局域网无外网环境下的底层代码逻辑解答。

---

## 1. 核心代码逻辑解答：纯局域网（无外网）环境下的 Free 体验额度

### ❓ 问题：Free 的全功能体验按设计要求联网，如果处于纯局域网无外网环境，现有代码逻辑是否支持全功能体验额度？

### 💡 结论：**不支持（代码逻辑会自动将其判定为额度耗尽，直接进入超额降级状态）**。

### 🔍 代码实证与底层机制分析

核心逻辑位于 [`pkg/server/chat_limiter.go`](file:///home/yelon/develop/me/eqrcp/pkg/server/chat_limiter.go#L255-L306) 中的 `loadUsageLocked()` 方法：

```go
// pkg/server/chat_limiter.go
netTime, isOnline := getNetworkTimeOrStartFetch()
today := netTime.Format("2006-01-02")

// 若用户未付费 (!usage.IsPaid) 且处于离线无外网环境 (!isOnline)
if !usage.IsPaid && !isOnline && os.Getenv("EQT_TESTING") != "true" {
    usage.UsedSeconds = 600         // 600 秒 >= 300 秒，Chat 模式直接判定为超额
    usage.UsedTransfers = 5         // 5 次 >= 5 次，Share 模式直接判定为超额
    usage.UsedReceiveTransfers = 5  // 5 次 >= 5 次，Receive 模式直接判定为超额
}
```

#### 底层原因：
1. **防止系统时钟回拨/篡改**：Free 用户的“每日 5 分钟”和“每日 5 次”额度基于真实公网日期（通过 HEAD 请求 Cloudflare/Baidu 提取 `Date` 响应头）。
2. **脱机保护策略**：若用户处于纯局域网无外网环境，`getNetworkTimeOrStartFetch()` 返回 `isOnline = false`。Go 后端无法校验系统时间是否被篡改，因此安全防御策略会**强制将 Free 用户的已用秒数和传输次数拉满**（UsedSeconds=600, Transfers=5），从而直接触发降级限制。
3. **Plus 用户对比**：Plus 付费用户在通过本地 `.lic` 密钥校验后 `usage.IsPaid = true`，该判断直接跳过，因此 **Plus 用户可以在纯局域网脱机无外网环境下 100% 正常无限制使用**。

---

## 2. 套餐版本文案优化规划

依据产品设计原意：
- **移除内容**：`本地密码学独立验签` 和 `授权保障与服务` 从 Plus 展示列表中移除（这是 Plus 的底层基础安全/服务支持，不需要列为特有的功能卖点）。
- **Free 视角**：展示产品的**基础功能与基本体验**，并明确其额度限制。
- **Plus 视角**：展示**对 Free 版限制的完全解除情况**。

---

### 📋 最新拟定文案对照表 (等待用户查看修改)

#### 1. Free 体验版 (`Free Tier`)
> **定位**：基础功能体验版，满足临时应急与基础传输需求。

| 类别 | 描述文案 | 代码/功能对应关系 |
| :--- | :--- | :--- |
| **基础传输** | 局域网文件传输，无需插线，扫码即传 (有限设备数) | 扫码即连、免安装 App；限制单次/并发连接设备数 |
| **基础功能** | 支持拖拽发送、历史保存、文件夹选择 | 桌面 GUI 原生功能全体验（拖拽文件/文件夹，本地历史 Log） |
| **Chat 额度** | Chat 模式限制：每日免费 5 分钟满速体验 | 耗尽后聊天不停断，附件降级为 100 KB/s 及单文件 2MB |
| **传输额度** | Share / Receive 模式限制：每日免费各 5 次 | 耗尽后限制并发设备数及传输文件大小 |

---

#### 2. Plus / Plus U 进阶版 (`Recommended Upgrade`)
> **定位**：解除 Free 版的基础限制，面向高频与多设备生产力用户。

| 类别 | 描述文案 | 解除 Free 版限制的对应说明 |
| :--- | :--- | :--- |
| **连接解封** | 无设备数限制 (多设备高并发同时传输) | 解除 Free 版的单会话/并发连接设备数量限制 |
| **Chat 解封** | 无限量 Chat 时间 (绝不限额，附件无大小及速率限制) | 解除每日 5 分钟上限，解锁 10–100MB/s+ 局域网物理满速 |
| **传输解封** | Share / Receive 无限次 & 无限大文件传输 | 解除每日 5 次限制、单文件及批量传输大小限制 |

---

#### 3. Diamond / Pro 钻石版 (`Cloud WAN Upgrade`)
> **定位**：跨局域网/公网穿透及团队高级协作。

| 类别 | 描述文案 | 对应说明 |
| :--- | :--- | :--- |
| **局域网权益** | 包含 Plus 的全部本地局域网无限制权益 | 基础局域网全解封 |
| **公网穿透** | 跨公网远程传输与信令穿透 | 突破局域网/Wi-Fi 限制，支持远程 P2P 互传 |
| **云端服务** | 云端设备安全同步与团队授权管理 | 云端同步与多主板授权池 |

---

## 3. 修改影响范围一览（若后续确认修改代码）

确认后需同步更新的文件：
1. **多语言字典**：`desktop/gui/frontend/src/i18n.js`（替换 `plan_feature_*` 相关的词条定义）
2. **Plan 比对面板**：`desktop/gui/frontend/src/main.js`（`renderPlanComparisonPanel()` 逻辑）
