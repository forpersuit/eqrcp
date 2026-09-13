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

