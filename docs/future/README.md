# EQT 未来功能规划与架构设计 (Future Architecture & Designs)

本目录归档 EQT 演进规划中的未来功能评审与架构设计提案。

---

## 📑 设计提案索引

1. **[Receive 模式连续传输与 Chat 批量打包透明化清单设计规范 (2026-09-09)](20260909-receive-continue-and-chat-zip-manifest-design.md)**
   - Receive 模式移动端“继续传输”追加批次模型与 Session/Batch 双层解耦
   - `--auto-stop` 优雅倒计时等待窗口与活动续命协同机制
   - 移动端会话历史记账模型 (Session History) 与按设备分目录落盘
   - Chat 模式动态流式虚拟索引 `-1` 打包清单追溯 (ZIP Manifest Pipeline)
   - 避免 alert 弹窗：聊天流内嵌折叠式结构化包含关系卡片与一键定位原消息

2. **[桌面系统级深度集成与人机交互设计规范 (2026-09-09)](20260909-desktop-system-integration-and-interaction-design.md)**
   - 托盘图标 4 状态机与动态扇形进度环 (GDI+ / NSStatusItem)
   - 托盘快捷二维码悬浮面板 (Quick QR HUD Popover)：自适应毛玻璃材质、网卡与模式极速热切换
   - 全域拖拽传输 (Drag-and-Drop UX)：托盘图标悬浮靶场与窗口高斯模糊 Dropzone 动效
   - 跨平台系统右键集成：Windows 10/11 一级菜单 (Sparse Package / IExplorerCommand)、macOS Finder 快速操作、Linux FreeDesktop
   - 本地 IPC 管道通信与单实例守护调度 (Named Pipe / Unix Domain Socket)
   - 全局快捷键支持与窗口“冷热分离”毫秒级呈现机制 (`Alt+Shift+S/R/C/Q`)

3. **[传输状态投影架构设计 (2026-09-08)](20260908-transfer-status-projection-architecture.md)**
   - 10 把互斥锁与 6 套记账模型的历史包袱诊断
   - CQRS 读写分离与只读投影模式 (Projection Pattern)
   - 多端观测聚合统一与高并发热路径零额外锁开销

4. **[Chat 会话历史归档与持久化架构设计 (2026-09-06)](20260906-chat-session-history-and-persistence-design.md)**
   - 现有“按需流式管道 (Rendezvous)”零临时文件落盘机制与生命周期分析
   - 本地轻量化结构化存储设计（SQLite / JSONL）与已存/未存附件状态映射
   - 隐私安全与自动老化保留策略（留存周期控制、一键清空）
   - 免费版（基础文本留存）vs Plus/Pro（全文检索、无限制归档、结构化导出）商业化分级

5. **[零配置端到端加密 (E2EE) 架构设计与 Wi-Fi 嗅探防御规范 (2026-09-01)](20260901-e2ee-end-to-end-encryption-architecture.md)**
   - 局域网 Wi-Fi 嗅探与抓包拦截风险第一性原理剖析
   - 破局传统自签 TLS 红色告警：URL Fragment (`#k=`) 零知识密钥协商机制
   - 浏览器原生 WebCrypto API (`AES-256-GCM`) 硬件级加密与 4MB 分块流式加密规范
   - 免费版 vs Plus/Pro 付费版商业化分级（一键零配置 E2EE 杀手级溢价功能）

6. **[Receive 模式移动端设备重命名与按设备自动分目录归档设计 (2026-08-31)](20260831-receive-device-rename-and-sync-design.md)**
   - 移动端 Web 上传页设备名称自定义编辑与 `localStorage` 本地记忆
   - 服务端接收自动清洗 (Sanitization) 与防路径穿越 (Path Traversal)
   - 免费版（强制前缀 `eqt_receive_<DeviceName>`）vs 付费版（纯净命名与高级宏模板 `{device}/{date}/`）商业化分级
   - 桌面端 GUI 偏好设置面板扩展与多端同步机制

7. **[下载遥测（Download Telemetry）设计评审与落地方向 (2026-08-30)](20260830)**
   - 客户端 Beacon 埋点与 Cloudflare 边缘地理信息解析
   - 防抖 SQL 与 Admin 地球热力大图数据流

8. **[历史演进规划 (2026-08-19 ~ 2026-08-29)](20260829)**
   - 桌面端与核心协议演进记录
