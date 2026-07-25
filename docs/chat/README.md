# EQT Chat 模式文档目录

本目录集中管理 **Chat / Chat V2** 的设计、进度、用量与交互文档。  
整理基准日期：**2026-07-25**（代码版本约 **v1.16.16**）。

---

## 当前事实（第一性原理）

| 项 | 现状 |
| :--- | :--- |
| 权威路径 | **`/chat-v2/{token}`**（Svelte UI + WebSocket 控制面 + HTTP 附件数据面） |
| Legacy | **`/chat/*` → 301 `/chat-v2/*`**；`pages/chat.tmpl.html` 不在主路径 |
| 默认开关 | `EnableChatV2` / `enableChatV2` **默认 true**；GUI 设置仍可关 |
| 包位置 | `pkg/chat/v2/`（session / transport / transfer / bandwidth / http / web） |
| 挂载点 | `pkg/server/chat.go` 注册 `/chat-v2/` |
| Free 额度 | remote peer 在线才计时；超额仅附件 100KB/s + ≤2MB；文本不限 |

```text
Host (eqt chat / desktop GUI)
  └─ /chat-v2/{token}  ← 权威
       ├─ WS  /ws      控制面（文本、presence、transfer 事件）
       └─ HTTP         上传 / 下载 / info / qr
Legacy /chat/*  ──301──►  /chat-v2/*
```

---

## 文档状态图例

| 标记 | 含义 |
| :--- | :--- |
| ✅ 现行 | 与当前产品/代码对齐，改行为时优先更新 |
| 📘 设计参考 | 架构/DoD 仍有效；文中「尚未 cutover」类表述需结合现状补丁 |
| ⚠️ 部分过时 | 结论部分可用，路径/阶段描述需对照代码 |
| 🗄️ 归档 | 仅历史；不指导实现 |

---

## 1. 现行文档（优先阅读）

| 文档 | 状态 | 说明 |
| :--- | :---: | :--- |
| [free-tier-usage-analysis.md](./free-tier-usage-analysis.md) | ✅ | Free 5 分钟额度根因、remote 计时、附件降级、Legacy 退役顺序 |
| [ux-interaction-analysis.md](./ux-interaction-analysis.md) | ✅ | V2 交互缺点分析（H/M/L）与代码锚点 |
| [ux-fix-progress.md](./ux-fix-progress.md) | ✅ | 交互修复勾选；H1–H5/M* 与 M3/M7 产品决策 |

### Free Tier 摘要

| 项 | 规则 |
| :--- | :--- |
| 计时 | 仅 `peer != "desktop"` 的 remote 在线时累加；Host-only 不计 |
| 配额 | 每日 300 秒满速 |
| 超额 | 附件 100KB/s、单文件 ≤2MB；文本照常；系统气泡提示一次 |
| 不做 | 随机丢消息、对 WebSocket 全局限速 |
| UI | 桌面标题栏额度胶囊；数据来自 `/info` 的 `usedSeconds` |

### 交互修复摘要（分析时点 2026-07-24，实现至 v1.16.5）

| 严重度 | 状态 |
| :--- | :--- |
| 高 H1–H5 | 已修（通知进消息流、文件内联操作、后台不断连、Enter 发送、kick 仅 host） |
| 中 M1/M2/M4/M5/M6/M8 | 已修 |
| 中 M3 / M7 | **明确不做**（旁路上传占位；手机额度 pill） |
| 低 L1–L7 | 未开工 |

---

## 2. 工程与架构

| 文档 | 状态 | 说明 |
| :--- | :---: | :--- |
| [v2-engineering-plan.md](./v2-engineering-plan.md) | 📘 | V2 目标架构、分阶段 DoD、chrome-test 场景、不变量 |
| [v2-progress.md](./v2-progress.md) | ⚠️ | **2026-07-07 快照**；文首有现状补丁，勿直接当完成度 |
| [file-transfer.md](./file-transfer.md) | ⚠️ | 四象限传输隐患/优化对照；锚点混有 legacy SSE 路径 |

---

## 3. 历史 / 归档

| 文档 | 状态 | 说明 |
| :--- | :---: | :--- |
| [mode-development-legacy.md](./mode-development-legacy.md) | ⚠️→🗄️ | 第一代 Chat（SSE + agent 集成）开发过程；WebSocket「未来项」已过时 |
| [archive/](./archive/) | 🗄️ | Legacy 气泡 CSS/JS 分析与风险表 |

归档清单见 [archive/README.md](./archive/README.md)。

---

## 4. 仓库内交叉引用（非本目录）

| 文档 | 说明 |
| :--- | :--- |
| [`docs/payment/tier-design.md`](../payment/tier-design.md) | Free/Plus/Pro 与 Chat 体验降级产品设计 |
| [`docs/payment/license-tier-analysis.md`](../payment/license-tier-analysis.md) | 各模式付费/免费限制（含 Chat 行） |
| [`pkg/chat/v2/README.md`](../../pkg/chat/v2/README.md) | 包内边界说明（部分「skeleton」措辞可能滞后于实现） |

---

## 5. 本轮整理动作（2026-07-25）

从 `docs/` 根目录迁入并标注时效：

| 原路径 | 新路径 | 判定 |
| :--- | :--- | :--- |
| `docs/chat-v2-engineering-plan.md` | `v2-engineering-plan.md` | 设计仍有效 + 文首现状补丁 |
| `docs/chat-v2-progress.md` | `v2-progress.md` | 进度快照过时 + 文首补丁表 |
| `docs/chat-mode-development.md` | `mode-development-legacy.md` | Legacy SSE 历史 |
| `docs/chat_mode_file_trans.md` | `file-transfer.md` | 策略可参考，路径过时 |
| `docs/chat-bubble-analysis.md` | `archive/bubble-analysis-legacy.md` | 归档 |
| `docs/chat-bubble-impact.md` | `archive/bubble-impact-legacy.md` | 归档 |

**未迁入**（仅弱相关或跨主题）：

- `docs/product-roadmap.md` — 含 Chat 商业化条目，但全文是产品路线图  
- `docs/resumable-transfer.md` / `resumable-e2ee-design.md` — 通用传输，非 Chat 专属  
- `docs/desktop-integration-plan.md` — 桌面总集成，Chat 仅为其中一章  

**已知断链（整理前已存在）**：`docs/index.md` 曾引用不存在的 `chat-reconnection-testing.md`，已改为指向本目录。

---

## 6. 修订记录

| 日期 | 说明 |
| :--- | :--- |
| 2026-07-23 | 建立 `docs/chat/`，落入 Free Tier 用量分析 |
| 2026-07-23 | 同步修订方案并落地（remote 计时、附件降级、去 30%） |
| 2026-07-23 | 标题栏 free 倒计时胶囊 + GUI 改读后端 usedSeconds |
| 2026-07-24 | 落入交互缺点分析与修复进度；阶段 1 + P1 |
| 2026-07-25 | **集中整理**：根目录 chat 文档迁入；过时/归档标注；重建本索引 |
