# EQT Chat 模式文档目录

本目录集中整理 Chat（含 Chat V2）相关的设计分析、用量限制与工程修复说明。  
历史/跨主题文档仍可能位于 `docs/` 根目录（见文末交叉引用）。

---

## 文档列表

1. **[Free Tier 用量特点：分析与修复方案](free-tier-usage-analysis.md)**  
   - Free 每日 5 分钟额度为何在 Chat V2 下未生效  
   - `UsedSeconds` 计时断点、legacy 降级死代码、GUI 双轨计时  
   - 分阶段修复方案（P0/P1/P2）、验收标准与风险不变量  

---

## 交叉引用（仓库内其它位置）

| 文档 | 说明 |
| :--- | :--- |
| [`docs/payment/tier-design.md`](../payment/tier-design.md) | Free/Plus/Pro 商业套餐与 Chat 体验降级产品设计 |
| [`docs/payment/license-tier-analysis.md`](../payment/license-tier-analysis.md) | 各模式付费/免费限制对照（含 Chat 行） |
| [`docs/chat-v2-engineering-plan.md`](../chat-v2-engineering-plan.md) | Chat V2 工程规划 |
| [`docs/chat-v2-progress.md`](../chat-v2-progress.md) | Chat V2 进度 |
| [`docs/chat-mode-development.md`](../chat-mode-development.md) | Chat 模式开发说明 |
| [`docs/chat_mode_file_trans.md`](../chat_mode_file_trans.md) | Chat 文件传输 |
| [`docs/chat-bubble-analysis.md`](../chat-bubble-analysis.md) | 聊天气泡分析 |
| [`docs/chat-bubble-impact.md`](../chat-bubble-impact.md) | 气泡改动影响面 |

---

## 修订记录

| 日期 | 说明 |
| :--- | :--- |
| 2026-07-23 | 建立 `docs/chat/`，落入 Free Tier 用量分析与修复方案 |
