# EQT 套餐版本功能说明与离线规则权威指南

> **编写日期**：2026-07-31  
> **文档路径**：`docs/payment/plan-tier-features-and-copy.md`  
> **文档用途**：关于 About / Plan 面板展示文案、Free / Plus 体验与脱机限制规则的权威定义。

---

## 一、 底层代码规则实证说明 (代码级真相)

### 1. Free 版纯局域网（无外网）离线限制规则
* **代码逻辑**：[`pkg/server/chat_limiter.go`](file:///home/yelon/develop/me/eqrcp/pkg/server/chat_limiter.go#L255-L306) 中 `loadUsageLocked()`：
  ```go
  netTime, isOnline := getNetworkTimeOrStartFetch()
  if !usage.IsPaid && !isOnline && os.Getenv("EQT_TESTING") != "true" {
      usage.UsedSeconds = 600         // 判定 Chat 额度耗尽
      usage.UsedTransfers = 5         // 判定 Share 额度耗尽
      usage.UsedReceiveTransfers = 5  // 判定 Receive 额度耗尽
  }
  ```
* **结论**：**Free 版不支持脱机无网全功能体验**。出于防止系统时钟篡改的防护机制，Free 用户若处于无外网纯局域网环境，代码会自动将其视作额度耗尽，直接进入降级限制模式。

---

### 2. Plus 版最长 7 天脱机离线规则
* **代码逻辑**：[`pkg/server/license.go`](file:///home/yelon/develop/me/eqrcp/pkg/server/license.go#L187-L191)：
  ```go
  // 7-Day Sync Lease Check
  if time.Now().After(lastSync.Add(7 * 24 * time.Hour)) {
      // Lease expired
      SetPaidStatus(false, "", "", "")
      return false
  }
  ```
* **结论**：** Plus 授权在实际代码中硬性限制最大 7 天（168 小时）脱机离线使用**。
  - **离线机制**：Plus 用户上一次联网成功后，可连续**无网离线使用最长 7 天**；
  - **过期表现**：若连续不联网超过 7 天，授权租约（Lease）到期，系统将暂时**退回到 Free 模式**；
  - **恢复机制**：只要重新连接一次网络，系统自动完成同步校准（`ForceOnlineLicenseSync`），**立刻恢复 Plus 权益与全部无限制功能**。

---

### 3. Pro 版本处理
* **结论**：因公网 P2P 及信令穿透功能尚未完全测通，**前端面板与文档中完全移除 Pro 相关展示**，当前仅保留 Free 与 Plus / Plus U 两个套餐。

---

## 二、 最新套餐展示文案规划 (等待用户查看修改)

### 📋 套餐对比与注意事项文案列表

#### 1. Free 体验版 (`Free Tier`)
> **定位**：基础功能体验版，满足临时应急与基础传输需求。

##### ✨ 核心功能
* **局域网文件传输，无需插线，扫码即传 (有限设备数)**
  *(跨设备扫码即连，免安装手机 App；限制单次/并发连接设备数)*
* **支持拖拽发送、历史保存、文件夹选择**
  *(桌面 GUI 原生功能全体验：文件/文件夹拖拽投送、本地传输历史日志留存)*

##### ⚠️ 体验限制
* **Chat 模式限制**：每日免费 5 分钟满速体验 *(超额后聊天不停断，附件降级为 100 KB/s 限速及 2MB 大小限制)*
* **Share / Receive 模式限制**：每日免费各 5 次传输 *(超额后限制并发设备数与传输文件大小)*

---

#### 2. Plus / Plus U 进阶版 (`Recommended Upgrade`)
> **定位**：解除 Free 版的基础限制，面向高频与多设备生产力用户。

##### ✨ 权益与解封说明
* **无设备数限制** *(支持多台手机/电脑高并发同时扫码连入与传输)*
* **无限量 Chat 时间** *(绝不限额，解锁局域网物理满速 10–100 MB/s+，附件无大小及速率限制)*
* **无限次 Share / Receive** *(无每日次数限制、无单文件及批量文件大小限制)*
* **支持最长 7 天连续离线脱机使用** *(连续无网最长可正常使用 7 天；超过 7 天暂退回 Free 模式，重新联网后立刻自动恢复)*

---

### 📌 套餐重要注意事项 (位于套餐面板底部)

> **注意事项与说明：**
> 1. **Free 版联网说明**：Free 版的每日全功能体验额度（每日 5 分钟 Chat 满速 + 每日 5 次 Share/Receive 传输）依赖网络同步校准系统时间。**若电脑处于无外网的纯局域网离线环境，系统将直接进入 Free 降级限制模式**。
> 2. **Plus 版离线校验说明**：Plus 版支持连续**最长 7 天（168 小时）的脱机离线使用**。若设备连续超过 7 天未连接外网，授权租约到期后将暂退回 Free 模式；**只需重新连接一次网络，系统即可自动恢复 Plus 全部功能**。
> 3. **Pro/公网功能说明**：当前版本专注于极速局域网传输，公网穿透功能暂未开启。

---

## 三、 代码更新计划（确认后同步更新）

1. **`desktop/gui/frontend/src/i18n.js`**：
   - 替换 `plan_feature_*` 词条；
   - 增加脱机 7 天与离线注意事项词条；
   - 物理移除 `plan_feature_pro` 等相关文案。
2. **`desktop/gui/frontend/src/main.js`**：
   - 更新 `renderPlanComparisonPanel()` 卡片渲染；
   - 底部追加格式化的【注意事项】提示框；
   - 完全移除 Pro 卡片显示。
