# Chat 模式用户交互修复进度

> **以代码事实为准更新**。问题定义与证据见 [ux-interaction-analysis.md](./ux-interaction-analysis.md)。  
> 最后更新：2026-07-24（阶段 1 P0 + M1 已落地，v1.16.4）

---

## 当前状态

| 维度 | 状态 |
| :--- | :--- |
| 分析文档 | 完成 |
| 修复实施 | **阶段 1 完成**；M1 完成；阶段 2 其余 pending |
| 建议首批 | ~~P0：H1 → H2 → H3~~ **已完成** |

**综合成熟度（交互可用性）**

| 维度 | 审查时点 | **本轮后** | 目标 |
| :--- | :---: | :---: | :---: |
| 错误/状态可见性 | ~20% | **~90%** | ~95% |
| 文件主路径 discoverability | ~30% | **~85%** | ~90% |
| 连接生命周期 | ~50% | **~85%** | ~90% |
| 权限与额度沟通 | ~55% | **~80%** | ~90% |
| 发送与附件次级路径 | ~60% | **~75%** | ~90% |

---

## 阶段勾选

### 阶段 0 — 文档与基线

- [x] 交互缺点分析落入 `docs/chat/ux-interaction-analysis.md`
- [x] 本修复进度文档 `docs/chat/ux-fix-progress.md`
- [x] `docs/chat/README.md` 索引更新
- [ ] 可选：与 `docs/chat-v2-progress.md` 交叉引用一轮

---

### 阶段 1 — P0 反馈与主路径（高优先级）

| ID | 项 | 状态 | 主要改动点 |
| :--- | :--- | :---: | :--- |
| H1 | 挂载应用内系统通知（`systemMessages` → 消息列表系统气泡） | [x] | `chatStore.addSystemMessage` + `systemNotice.ts` |
| H2 | 文件气泡内联主操作：下载 / 进度 / 取消 | [x] | `MessageList.svelte` + `app.css` |
| H3 | 切后台勿无条件掐断 WS（保留连接；可见时再补连） | [x] | `websocket.ts` visibility 策略 |
| H4 | 桌面 Enter 发送、Shift+Enter 换行 | [x] | `MessageComposer.svelte` |
| H5 | Kick 仅 host；前端隐藏非 host 踢人入口 | [x] | `transport/websocket.go`、`App.svelte` |

**阶段 1 退出标准**

- [x] 上传失败 / WS 错误 / 命令失败在主界面可见（系统气泡；Chrome 可见 replaced/额度等 notice）
- [x] 新用户无需长按即可发现并完成下载（内联 Download/Cancel/Retry）
- [x] 手机切后台再回前台：不主动 close WS；可见后可继续发消息
- [x] 桌面键盘 Enter 可发送文本
- [x] 非 host 无法踢人；host 可踢 remote（Go 测试 + 前端隐藏 kick）
- [x] `go test ./pkg/chat/v2/...` 通过；`pkg/chat/v2/web` 构建通过

---

### 阶段 2 — P1 连接、传输与额度（中优先级）

| ID | 项 | 状态 | 主要改动点 |
| :--- | :--- | :---: | :--- |
| M1 | 重连用尽后：断线 banner + 一键重连 | [x] | `reconnectExhausted` store、`App.svelte` banner、`resumeConnection` |
| M2 | 多标签互顶：首次/文案更清晰（可选：peer 区分） | [ ] | `websocket.ts`、i18n |
| M3 | 上传中对接收方显示占位（「对方正在发送…」） | [ ] | 服务端可见性 / 前端过滤与气泡 |
| M4 | 浏览器下载终态与 transfer 事件对齐（失败可标） | [ ] | `MessageList` / download 路径 |
| M5 | 修复「重新发送文件」：真实 upload 或禁用假路径 | [ ] | `App.svelte` `handleResendFile` |
| M6 | 多文件串行上传队列 | [ ] | `MessageComposer` / sendFile 调度 |
| M7 | 手机显示额度 pill 或降级态；文档与实现一致 | [ ] | `App.svelte`、`docs/chat/*` |
| M8 | 选文件前置校验 2MB/额度 + 本地化系统气泡 | [ ] | 前端预检 + `attachments` 错误映射 |

**阶段 2 退出标准**

- [x] 断网/重连耗尽后用户可一键恢复（`reconnectExhausted` banner + `resumeConnection`）
- [ ] 对方上传大文件时本端有占位，不出现长时间「空白像丢消息」
- [ ] 重发文件能再次传成功，或菜单不再提供假「重发」
- [ ] 多选大文件不因并行把移动端打挂（串行可验证）
- [ ] 免费超额/2MB 拒绝有中文应用内提示；手机可见额度或降级态

---

### 阶段 3 — P2 打磨（低优先级）

| ID | 项 | 状态 |
| :--- | :--- | :---: |
| L1 | 浏览器页拖放有效或明确禁用提示 | [ ] |
| L2 | image 类型预览（可选 video/audio 后续） | [ ] |
| L3 | 设备详情并发数用真实数据 | [ ] |
| L4 | 输入框右键：系统菜单优先或 Clipboard 失败回退 | [ ] |
| L5 | 踢/退出恢复路径缩短或「撤销踢人」窗口期 | [ ] |
| L6 | 连接中/已断开更明显状态条 | [ ] |
| L7 | 历史「加载更早消息」显式按钮 | [ ] |

---

## 本轮实现摘要（2026-07-24）

### 代码

| 区域 | 变更 |
| :--- | :--- |
| `pkg/chat/v2/web/src/state/systemNotice.ts` | H1 纯函数：哪些 notice 进消息流 |
| `pkg/chat/v2/web/src/state/chatStore.ts` | `addSystemMessage` 写流；`reconnectExhausted` |
| `pkg/chat/v2/web/src/services/websocket.ts` | H3 后台不断连；M1 重连耗尽；resume 清状态 |
| `pkg/chat/v2/web/src/components/MessageComposer.svelte` | H4 Enter 发送 |
| `pkg/chat/v2/web/src/components/MessageList.svelte` | H2 内联下载/取消/重试 |
| `pkg/chat/v2/web/src/App.svelte` | H5 host-only kick UI；M1 banner |
| `pkg/chat/v2/transport/websocket.go` | H5 后端 only `peer==desktop` 可 kick |
| `pkg/version/version.go` | `v1.16.3` → `v1.16.4` |

### 测试

| 命令 | 结果 |
| :--- | :--- |
| `go test ./pkg/chat/v2/...` | 通过（含 `TestWebSocketKickOnlyHostAllowed`） |
| `node --experimental-strip-types src/state/systemNotice.test.ts` 等 | 通过 |
| `npm run build`（`pkg/chat/v2/web`） | 通过 |
| Chrome 9222 三设备仿真（token 房间） | 通过：文本互通、H3 不主动 close、H5 非 host 无踢、H1 系统气泡/替换 banner、H2 CSS 内联样式 |

---

## 建议实施顺序（下一批）

1. **M5** 假重发文件  
2. **M3** 上传中接收方占位  
3. **M8** 2MB/额度前置中文提示  
4. **M6** 多文件串行  
5. **M7** 手机额度 pill  

---

## 验证清单（每项合并前）

- [x] 改动范围仅触及目标 ID，无无关重构  
- [x] 通知一律应用内（系统气泡 / toast），禁止 `alert`  
- [x] 多语言：新增 `reconnectExhaustedHint` 走 i18n  
- [x] `go test ./pkg/chat/v2/...`  
- [x] 前端 `pkg/chat/v2/web` 构建通过  
- [x] Chrome 9222 Chat v2 三设备冒烟  
- [x] 本文件勾选 + 修订记录更新  

---

## 已完成记录

| 日期 | ID | 摘要 | 验证 | 提交/版本 |
| :--- | :--- | :--- | :--- | :--- |
| 2026-07-24 | — | 分析与进度文档建立 | 文档审阅 | `3c9af0c` |
| 2026-07-24 | H1–H5, M1 | 系统通知进消息流；文件内联操作；后台不断 WS；Enter 发送；host-only kick；重连耗尽 banner | `go test ./pkg/chat/v2/...`；node 契约测试；web build；Chrome 9222 E2E | v1.16.4 |

---

## 修订记录

| 日期 | 说明 |
| :--- | :--- |
| 2026-07-24 | 首版：按 H/M/L 建立阶段勾选与退出标准；修复尚未开工 |
| 2026-07-24 | 阶段 1 + M1 落地并完成单测/构建/Chrome 9222 仿真 |
