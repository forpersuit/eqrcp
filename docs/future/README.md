# EQT 未来功能规划与架构设计 (Future Architecture & Designs)

本目录归档 EQT 演进规划中的未来功能评审与架构设计提案。

---

## 📑 设计提案索引

0. **[E2EE 工程落地与进度监控看板 (2026-08-31)](20260901-e2ee-implementation-progress.md)**
   - E2EE 特性开发实施主控看板：Phase 1~5 任务清单、验收标准与提交时间线

1. **[零配置端到端加密 (E2EE) 架构设计与 Wi-Fi 嗅探防御规范 (2026-09-01)](20260901-e2ee-end-to-end-encryption-architecture.md)**
   - 局域网 Wi-Fi 嗅探与抓包拦截风险第一性原理剖析
   - Secure Context 陷阱分析：`crypto.subtle` 在局域网 HTTP 不可用，前端改用 libsodium WASM 引擎
   - DRM 信任锚密钥分发：联网时密钥与加密引擎经 HTTPS 下发（二维码 `#sid=` 会话引用），不可联网自动降级明文
   - 4MB 分块 XChaCha20-Poly1305 流式加解密（Share / Receive / Chat 三模式统一协议）
   - 免费版 vs Plus/Pro 付费版商业化分级（`enableE2EE` Settings 配置开关，杀手级溢价功能）

2. **[Receive 模式移动端设备重命名与按设备自动分目录归档设计 (2026-08-31)](20260831-receive-device-rename-and-sync-design.md)**
   - 移动端 Web 上传页设备名称自定义编辑与 `localStorage` 本地记忆
   - 服务端接收自动清洗 (Sanitization) 与防路径穿越 (Path Traversal)
   - 免费版（强制前缀 `eqt_receive_<DeviceName>`）vs 付费版（纯净命名与高级宏模板 `{device}/{date}/`）商业化分级
   - 桌面端 GUI 偏好设置面板扩展与多端同步机制

2. **[下载遥测（Download Telemetry）设计评审与落地方向 (2026-08-30)](20260830)**
   - 客户端 Beacon 埋点与 Cloudflare 边缘地理信息解析
   - 防抖 SQL 与 Admin 地球热力大图数据流

3. **[历史演进规划 (2026-08-19 ~ 2026-08-29)](20260829)**
   - 桌面端与核心协议演进记录
