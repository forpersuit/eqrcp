# EQT Chat 模式文档目录

本目录集中整理 Chat（含 Chat V2）相关的设计分析、用量限制与工程修复说明。  
历史/跨主题文档仍可能位于 `docs/` 根目录（见文末交叉引用）。

---

## 文档列表

1. **[Free Tier 用量特点：分析与修复方案](free-tier-usage-analysis.md)**  
   - Free 每日 5 分钟额度在 Chat V2 下曾失效的根因（legacy 客户端表 vs V2 session）  
   - **修订决策**：remote peer 才计时；附件 100KB/s + 2MB；**无** 30% 消息失败；WS 控制面不限速  
   - 实现状态（v1.14.49）、验收标准、Legacy 有序退役顺序  

2. **[用户交互缺点分析](ux-interaction-analysis.md)**  
   - Chat V2 相对经典 send/receive 的交互架构  
   - 高/中/低严重度问题（通知槽未挂载、文件菜单不可发现、切后台断 WS、Enter 不发送、踢人权限等）  
   - 代码锚点与建议修复方向  

3. **[用户交互修复进度](ux-fix-progress.md)**  
   - 按 H/M/L 分阶段勾选与退出标准  
   - 建议首批：H1 通知可见 → H2 文件内联操作 → H3 后台不断连  
   - 以代码事实为准更新完成记录  

### 摘要（Free Tier · 修订后）

| 项 | 规则 |
| :--- | :--- |
| 计时 | 仅当存在 `peer != "desktop"` 的外部端在线时累加；Host-only 不计 |
| 配额 | 每日 300 秒满速 |
| 超额 | 附件 100KB/s、单文件 ≤2MB；文本照常；系统气泡提示一次 |
| 不做 | 随机丢消息、对 WebSocket 全局限速 |
| 路径 | 以 Chat V2 为权威；Legacy 验证后删除 |
| UI | Chat 标题栏设备按钮左侧倒计时胶囊；数据来自 `/info` 的 `usedSeconds` |

### 摘要（用户交互 · 分析时点 2026-07-24）

| 严重度 | 核心缺口 |
| :--- | :--- |
| 高 | 系统通知未挂主 UI；文件操作靠长按/右键；切后台主动断 WS；Enter 不发送；任意端可踢人 |
| 中 | 重连耗尽无按钮；上传中对方不可见；假重发文件；并行多传；手机无额度 pill；2MB 无前置提示 |
| 低 | 浏览器拖放无效；无媒体预览；连接态/历史分页弱提示 |

修复跟踪 → [ux-fix-progress.md](./ux-fix-progress.md)

---

## 交叉引用（仓库内其它位置）

| 文档 | 说明 |
| :--- | :--- |
| [`docs/payment/tier-design.md`](../payment/tier-design.md) | Free/Plus/Pro 商业套餐与体验降级产品设计 |
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
| 2026-07-23 | 建立 `docs/chat/`，落入 Free Tier 用量分析 |
| 2026-07-23 | 同步修订方案并落地实现（remote 计时、附件降级、去 30%） |
| 2026-07-23 | 标题栏 free 倒计时胶囊（设备列表左侧）+ GUI 改读后端 usedSeconds |
| 2026-07-24 | 落入 Chat 用户交互缺点分析与修复进度文档 |
