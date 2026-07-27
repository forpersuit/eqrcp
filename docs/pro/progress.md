# EQT Pro v1 (公网 P2P 通道) 开发进度与里程碑

本文档跟踪 **EQT Pro v1 公网 P2P 传输功能** 的分阶段开发进度、里程碑与验证清单。

---

## 1. 总体进度概览 (Status Overview)

- **当前阶段**：`阶段一：架构设计与信令 Worker 搭建` 🚀
- **目标交付版本**：`v1.15.0`
- **核心原则**：不引入物理 VPS 服务器，基于 Cloudflare Serverless + 免费公共 STUN 实现纯 P2P 传输。

---

## 2. 细分里程碑与任务拆解 (Milestones & Checklist)

### 📌 Milestone 1: Cloudflare Worker 信令服务 (`cloudflare/eqt-p2p-signal`)
- [x] **架构设计与 API 契约定义**
  - 完成 [architecture-and-design.md](file:///home/yelon/develop/me/eqrcp/docs/pro/architecture-and-design.md) 中 4 个信令接口定义。
- [x] **Worker 项目创建与 Wrangler 配置**
  - 创建 `cloudflare/eqt-p2p-signal` 目录与 `wrangler.toml` 配置文件。
  - 绑定现有的 Cloudflare D1 数据库 (`eqt-drm-db`) 以共享授权校验状态。
- [x] **Pro 订阅鉴权模块实现**
  - 实现基于 `X-License-Code` + `X-Device-ID` 的 D1 数据库校验，阻断非 Pro 用户发起信令。
- [x] **房间与信令内存中转箱 (Mailbox)**
  - 实现短生命周期（600s）SDP / ICE Candidate 信令推拉与自动清理机制。
- [x] **自动化 E2E 契约测试套件**
  - 编写 `tests/e2e-signal-test.js`，运行 `npm run test:signal` 验证信令握手全流程并 100% 通过。

---

### 📌 Milestone 2: Go 客户端 WebRTC P2P 引擎开发 (`pkg/server/p2p`)
- [ ] **引入 pion/webrtc 依赖与包结构定义**
  - 新增 `pkg/server/p2p` 目录，封装 PeerConnection 状态机。
- [ ] **客户端信令客户端 (`p2p/signaling.go`)**
  - 实现向 `signal.eqt.net.im` 发起 Room 创建、推拉 Offer/Answer 的 HTTP/WebSocket 通信逻辑。
- [ ] **STUN 地址收集与 ICE 打洞**
  - 配置 `stun:stun.cloudflare.com:3478` 与 `stun:stun.l.google.com:19302`。
- [ ] **DataChannel 与既有 HTTP/WS 服务桥接**
  - 将通过 WebRTC DataChannel 接收到的数据流桥接导入既有的 `server` 传输处理逻辑中。

---

### 📌 Milestone 3: 前端/桌面端 UI 交互与体验降级适配
- [ ] **公网模式切换与二维码生成**
  - 在客户端 UI（Share / Receive / Chat）中支持手动或自动切换“局域网模式”与“Pro 公网 P2P 模式”。
  - 生成格式为 `https://eqt.net.im/p/#<room_id>` 的公网直连扫码链接。
- [ ] **打洞状态实时指示与 15s 超时降级**
  - 在传输状态面板中提供“正在进行公网 P2P 打洞…”实时指示。
  - 超时 15 秒打洞失败时，优雅弹出降级系统消息，提示切换网络或使用热点。
- [ ] **Svelte 连接可视化监控面板 (`ConnectionDashboard.svelte`)**
  - 采用 Svelte 框架实现轻量化的连接监控面板，嵌入 Wails / Web 端及 Admin 后台。
  - 实时采集 `RTCPeerConnection.getStats()` 指标（速率、RTT 延迟、Candidate 类型、丢包率与 DTLS 加密算法）。
  - 支持展开连接详情 Modal 与打洞失败日志故障一键诊断。
- [ ] **防阻塞与弹窗消除**
  - 遵循 `AGENTS.md` 规范，杜绝使用原生 `alert()`，所有异常统一追加至应用内消息通知管道。

---

### 📌 Milestone 4: 全流程联调与自动化测试验证
- [ ] **单元测试与集成测试覆盖**
  - `go test ./pkg/server/p2p/...` 100% 通过。
- [ ] **Chrome DevTools E2E 仿真测试**
  - 按照 `.agents/skills/eqt-ux/SKILL.md` 规范，使用 Chrome DevTools 仿真模拟公网跨网段扫码传输与断网降级流程。
- [ ] **版本号发布与构建脚本更新**
  - 升级 `pkg/version/version.go` 至 `v1.15.0`。
  - 运行 `scripts/git-push-smart.sh` 完成提交落盘。

---

## 3. 验收标准与 Definition of Done (DoD)

1. **零物理服务器部署**：全过程无需为云端配置物理 Linux VPS，100% 部署于 Cloudflare Worker 与全球 CDN 上。
2. **测试全覆盖**：信令 Worker E2E 测试及 Go 单元测试 100% 通过，无 skipped 测试。
3. **零退化原则 (Zero Regression)**：现有的免费版与 Plus 版局域网传输功能不受任何影响。
4. ** Git 树干净提交**：全部新功能提交，并使用 `scripts/git-push-smart.sh` 推送到 GitHub 远程仓库。
