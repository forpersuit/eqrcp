# Admin 管理后台、审计留痕与 SPA 架构规范

本参考文档收录 Admin 管理后台操作审计留痕、全球活跃设备 Live 视界、Cloudflare Access SPA 同源反代避坑以及 Dev 模式设备白名单管理规范。

---

## 13. Dev 模式服务端动态鉴权与开发/测试设备管理 (Dev Mode & Device Allowlist)

### 13.1 彻底移除客户端本地硬编码 (Anti-Reverse Engineering)
- **历史问题**：旧版本客户端硬编码判定 `dev == "liyuelong"` 字符串，极易被逆向分析人员通过 `strings` 或 IDA 静态扫描检出。
- **动态授权架构**：彻底拔除本地硬编码，将 Dev 模式权限改为由服务端（DRM API）统一根据权威 Device ID 进行动态鉴权。
- **两重白名单保障**：
  1. **D1 数据库管理**：`sandbox_beta_testers` 表（已增加 `is_dev INTEGER NOT NULL DEFAULT 0` 字段）。
  2. **环境变量静态兜底**：Worker 环境变量 `DEV_DEVICE_IDS`（逗号分隔的 32 位 hex Device ID）。

### 13.2 DRM 接口动态下发与客户端激活
- 服务端在 `/api/v1/device/register`（免费设备注册）、`/api/v1/verify`（在线对账）、`/api/v1/activate`（激活）及 `/api/v1/dev/check-device` 端点中，自动比对 Device ID 并下发 `is_dev: boolean` 字段。
- 客户端在启动匿名注册与在线对账成功后，接收 `is_dev` 并动态调用 `SetServerDevAuthorized(is_dev)`，即时解锁 GUI 前端开发者选项与调试功能。

### 13.3 Admin 控制台独立管理页面
- Admin 后台左侧新增独立的 **🛠️ 开发与测试设备** (`devDevices`) 导航栏，不再混入「授权码管理」页面。
- 提供全套 REST 管理接口：
  - `GET /api/v1/admin/dev-devices`：获取开发与测试设备列表。
  - `POST /api/v1/admin/dev-devices`：录入新设备（支持输入 Device ID、绑定邮箱、备注说明与 Dev 授权开关）。
  - `POST /api/v1/admin/dev-devices/:id/toggle-dev`：一键无缝切换 Dev 模式授权状态。
  - `DELETE /api/v1/admin/dev-devices/:id`：从白名单中删除设备记录。
- **全环境通用**：生产环境 (`production`) 与测试沙箱 (`test`) 均具备完整的开发/测试设备管理能力，数据物理隔离。

---

## 14. LAN-TLS 多 CA 断路器态势感知与运维解封 (Multi-CA Telemetry & Break-Glass Ops)

### 14.1 D1 遥测自愈与防呆查询
- **端点契约**：`GET /api/v1/admin/tls/circuit-status`（由 Cloudflare Access 保护，同源 Pages Functions 代理或沙箱直连）。
- **表结构自愈保障**：由于新测试沙箱库在初始阶段可能尚未触发 ACME 置备或令牌桶流控，遥测查询前必须调用 `ensureCertProvisionsTable`、`ensureAuditLogTable`、`ensureTokenBucketsTable` 与 `ensureCircuitBreakersTable`。
- **防御性查询隔离**：各区块（令牌桶状态、24h 签发指标、CA 归属分布、错误审计统计）查询必须在独立的异常保护块中执行，在表空或偶发只读异常时降级回退至默认零状态，严禁抛出裸 500 异常阻断整体大盘加载。

### 14.2 双 CA 指示灯、独立侧边栏与态势大盘
- **独立导航与异常红点 (Sidebar Tab & Alert Dot)**：左侧边栏提供独立的 **「🔒 LAN-TLS CA 态势」** 导航项（Tab: `'tls'`，承载全屏大盘与 Break-Glass 运维控制）；当任何 CA 断路器熔断跳闸（`OPEN`）时，导航项右侧即时亮起带呼吸动效的红色告警圆点（`.dot-error`），半开试探时显示黄点（`.dot-warn`），全局心跳轮询确保管理员在任意页面均能第一时间获悉异常。
- **系统概览精炼卡片联动 (Overview Summary Card)**：`Overview.svelte` 核心指标网格中集成「🔒 LAN-TLS CA 态势」快捷卡片，展示当前主力 GTS 状态与 24h 签发数；发生熔断时卡片自动呈现红色告警边框与「熔断」文案，点击可直接平滑跳转至独立大盘。
- **双断路器态势监控**：专属控制台 `TLSCircuitCard.svelte` 统一呈现 GTS CA（主力）与 Let's Encrypt（灾备）的双断路器状态灯（🟢 CLOSED / 🟡 HALF_OPEN / 🔴 OPEN）、连续成功/失败计数及退避冷却时间。
- **平滑令牌桶水位**：呈现 `cert_provision:acme_smoothing` 当前瞬时 Token 存量（`0~5.0`）、最大容量与填充速率（`10/min`）。
- **精准归因跳闸分析**：区分 `ca_rate_limited (429)`、`ca_5xx_error (5xx)`、`other_cert_errors`、`rate_limit_hits` 与 `failover_events`（灾备故障转移），杜绝告警误判。

### 14.3 安全可逆破窗解封 (Break-Glass)
- **解封模态框**：提供 `TLSResetModal.svelte`，支持对主力 GTS CA 断路器重置复位、特定节点限流解锁与特定 IP 限流重置。
- **强审计留痕**：后端统一通过 `logAdminAudit(env, request, 'RESET_CIRCUIT_BREAKER', ...)` 完整记录操作人、目标 CA、操作前状态快照，实现全生命周期操作可追溯。

