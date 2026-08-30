# EQT 未来功能规划与架构设计 (Future Architecture & Designs)

本目录归档 EQT 演进规划中的未来功能评审与架构设计提案。

---

## 📑 设计提案索引

1. **[零配置端到端加密 (E2EE) 架构设计与 Wi-Fi 嗅探防御规范 (2026-09-01)](20260901-e2ee-end-to-end-encryption-architecture.md)**
   - 局域网 Wi-Fi 嗅探与抓包拦截风险第一性原理剖析
   - 破局传统自签 TLS 红色告警：URL Fragment (`#k=`) 零知识密钥协商机制
   - 浏览器原生 WebCrypto API (`AES-256-GCM`) 硬件级加密与 4MB 分块流式加密规范
   - 免费版 vs Plus/Pro 付费版商业化分级（一键零配置 E2EE 杀手级溢价功能）

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
