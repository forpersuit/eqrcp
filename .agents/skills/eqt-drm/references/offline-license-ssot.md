# 离线数字证书单一可信源 (SSOT) 与设备指纹防伪技术手册

本参考文档收录 EQT 客户端设备指纹加权模型、离线 `.lic` 证书双重 Ed25519 验签、7 天离线租约、时钟防篡改及免费用量对账的全量实现细节。

---

## 1. 客户端设备指纹比对规范 (Client Hardware Fingerprint)

- **第一性原理防线**：在进行 **3选2 加权设备指纹校验**（主板 UUID、CPU 序列号、系统盘物理 SerialNumber）时，必须注意空值的校验回避：
  - 若运行权限原因导致某项硬件特征提取返回空字符串 `""`，此字段**绝对不能**在比对时判定为“相等”，必须直接跳过。
  - 只有两边非空且完全相等时，匹配项才能计入。
  - 至少有 2 项有效的非空指纹相匹配，才允许判定设备合法。
  - **客户端激活前置守卫**：在向服务端发送激活请求前，客户端必须先校验当前提取到的非空硬件指纹数量。若有效指纹项 < 2，直接返回友好错误拦截请求，防止向服务端占用了席位但本地无法通过 `VerifyFingerprint` 落盘。
  - **服务端权威设备 ID 空值规范**：`GetAuthorityDeviceID()` 在未分配时必须返回 `""`（空字符串），严禁返回 `"未注册"` 等中文字面量作为设备标识符污染服务端数据。
- **测试覆盖**：确保针对 Windows 和 Linux 的测试覆盖，并运行 [license_test.go](file:///home/yelon/develop/me/eqrcp/pkg/server/license_test.go) 中的加权模型边界案例。

---


---

## 2. 离线 `.lic` 数字证书单一可信源 (SSOT) 与时钟防篡改

- **单一可信源 (SSOT) 与测试/生产证书物理隔离**：
  - `license.lic` 数字证书缓存为全局授权、对账及防时钟回拨的**唯一可信源 (SSOT)**。
  - **环境命名空间隔离 (Namespace Isolation)**：生产构建默认读写 `license.lic`；测试构建（`//go:build eqtdev`）读写 `license-test.lic`。双环境存储物理解耦，彻底避免测试构建覆盖或抹除用户的正式生产证书。
  - **安装包分发环境物理隔离 (Distribution Package Segregation)**：
    - **测试环境 (`test.eqt.net.im` / `eqt-test.pages.dev`)**：必须且仅下载测试版二进制压缩包（`https://download.eqt.net.im/downloads/test/EQT-test-windows-amd64.zip`），内置测试专用公钥与测试 Worker 端点。
    - **生产环境 (`www.eqt.net.im`)**：必须且仅分发经过正式签名的正式生产版客户端（`https://download.eqt.net.im/downloads/latest/EQT-latest-windows-amd64.zip` 或对应版本路径），严禁在生产页面与分发渠道出现任何测试版 exe、测试链接或测试标识。
- **Ed25519 签名与双重密码学保护**：
  - **主证书签名 (`Signature`)**：签名载荷必须与 Workers 生成时严格对称（`license_code|tier|uuid_hash|cpu_hash|disk_hash|expires_at|max_devices`）。
  - **对账确认签名 (`VerifySignature`)**：云端通过 `/api/v1/verify` 接口使用私钥签发带有服务器最新时间的对账载荷（`OK|license_code|uuid_hash|cpu_hash|disk_hash|last_online_sync_time`）。
  - **抗手动修改机制**：为防止用户本地用文本编辑器手动修改 `.lic` 里的对账时间 `LastOnlineSyncTime`，客户端每次校验必须使用内置公钥校验 `VerifySignature` 对应的载荷合法性。任何非云端私钥签发的修改均会在微秒级被识破并降级。
- **网络故障与授权状态严格正交划分 (Network vs Auth Orthogonality)**：
  - **断网/抖动/5xx 走离线租约**：网络超时、连接被拒、DNS 失败或服务端 502/503/504 属于网络不可达，**严禁**触发 `ResetLicense()` 抹盘，必须无条件保留本地证书并进入离线 7 天租约验证；
  - **明确 403/404 确凿失效才抹盘**：只有连网成功且云端明确返回 HTTP 403（明确被退款/吊销/黑名单）或 HTTP 404（激活码已被删除/设备已解绑）时，才判定授权失效并调用 `ResetLicense()` 擦除证书。
  - **签名合法性单一关卡守卫 (Centralized Valid Signature Guard in `doOnlineLicenseSync`)**：在 `doOnlineLicenseSync` 核心入口前置校验 `VerifyLicenseSignature(cert)`，若签名不合法直接返回哨兵错误 `ErrInvalidLicenseSignature`。所有调用方（启动对账、GUI `RefreshLicenseStatus`、Dev `DevForceOnlineLicenseSync` 及后台定时器）全量收敛保护，**严禁**带着未经当前环境公钥验签通过的外来/损坏证书向云端发起携带激活码的 `/api/v1/verify` 强对账（彻底杜绝云端 404 误删本地文件）。调用方捕获 `ErrInvalidLicenseSignature` 后统一分流至 `RegisterDeviceOnline()` 匿名设备登记，依托 3 选 2 硬件指纹让当前环境服务端反查自愈。
  - **服务端反查自愈严格执行「3 选 2 匹配」**：云端 `findBestActiveLicenseForDevice` 在按 `device_id` 检索候选记录时，必须对硬件指纹强制调用 `matchFingerprint` 校验（非空匹配数 $\ge 2$），杜绝克隆 `device_id` 越权。若遇低特征设备（仅 1 项有效指纹）或早于指纹列采集的旧绑定，自动自愈失败（fail-closed 到 free）属于预期安全收敛，由用户输入购买邮件中的激活码重绑或人工客服兜底。
- **静默对账与 7 天租约宽限**：
  - 应用拉起时（通过 `hardware.go` 后台线程）先做 `VerifyLocalLicense()`，若本地存在合规 `.lic`，**强制**执行一次 `ForceOnlineLicenseSync()`（忽略 12 小时节流）。在线状态是吊销/Portal 解绑的权威来源（SSOT）；仅当网络失败时才回退到离线 7 天租约。
  - 后续后台静默对账仍走 `StartOnlineLicenseSync()` / `doOnlineLicenseSync(false)`，保留 12 小时最低间隔，避免频繁网络交互。
  - About 面板标题旁「刷新」按钮调用 `RefreshLicenseStatus()`：优先在线强制对账，失败再 `VerifyLocalLicense()` 离线校验。Dev「在线对账」同样走 `ForceOnlineLicenseSync()`。
  - 对账网络超时失败不影响使用。客户端支持 7 天内静默免网脱机运行：`time.Now() - LastOnlineSyncTime <= 7 * 24 * time.Hour`。若超时则自动强行降级。
  - 对账返回 403/404（授权被吊销或设备解绑）则立即执行 `ResetLicense()` 擦除证书并降级为 Unpaid 免费版。
  - `VerifyLocalLicense()` 任意失败路径（含无 `.lic` 文件）必须 `SetPaidStatus(false)`，防止内存付费态与磁盘不一致。
  - **启动生命周期与 LicenseReady 标志**：
    - 后端启动时提供 `IsLicenseReady()` / `SetLicenseReady(bool)`，初始为 `false`；当指纹预计算与本地证书校验完成时置为 `true` 并推送状态事件。
    - 前端顶栏 Tier Badge 必须在 `status.licenseReady === true` 时才渲染（未就绪时不显示任何 Badge，杜绝启动时从虚假 FREE 跳变到 PLUS/PRO 的视觉闪烁）。
    - `syncLicenseFromStatus()` 必须在 `status.licenseReady === true` 且 `!status.isPaid` 时才清空本地缓存，避免启动未就绪时误删 localStorage。
  - 前端 `localStorage` 仅缓存 UI 元数据（如 redeemedAt 展示），**禁止**在启动时用 localStorage 向 Go 端 `SetPaidStatus(true)` 抢权。
- **极简单向时钟防回拨与网络时间防篡改**：
  - 证书内元数据字段 `LastSeenLocalTime` 记录最后一次运行时间。每次成功校验后（若距离上次写入超过 1 分钟，以减少磁盘 IO），客户端自动更新并原子性落盘。
  - 本地校验时，若判定当前系统时间倒流（`time.Now() < LastSeenLocalTime - 10 minutes`），立刻判定为篡改并调用 `SetClockTampered(true)` 降级并永久锁死高级付费功能。`SetPaidDetails` 在 `paid=false` 时严禁重置 `ClockTampered` 状态，仅在合法有效付费激活时才允许解除。
  - **联网配额与防篡改对齐**：未激活免费版用户在脱机断网状态下只提供基础 Free 传输功能（不授予每日 10 分钟高级限额全功能）；在线状态下系统自动通过 `getNetworkTimeOrStartFetch()` 获取准确网络时间 Date 标头。若检测到本地系统时间与网络时间偏差超过 10 分钟，自动判定为 `ClockTampered` 并锁死。
  - **解绑设备同步降级**：所有端（Portal、设备自主解绑、Admin 管理后台）在解绑设备时，必须在单次原子事务（`DB.batch`）中同步将 `device_registry` 对应设备降级为 `free` 并清除 `license_code` / `email`。
  - **废弃暗记清理**：保持 `.lic` 作为离线授权唯一可信源 (SSOT)，不再引入额外的私有暗记文件。
- **测试兼容模式**：单元测试或 mock 状态下（`os.Getenv("EQT_TESTING") == "true"`），若本地无 `.lic`，自动降级到传统模式支持模拟付费判定，在测试环境中自动豁免 7 天租约及防时钟回拨强制检查，以免破坏 CI。
- **Share/Receive 模式防规避与防呆拦截机制**：
  - **无物理时限中断**：为保障用户体验连贯性，在 10 分钟（600秒）限额内，若某次传输任务启动时 `usedSeconds < 600`，本次传输允许无限制传输完毕，不得强行调用 `signalStop()` 在中途物理切断。
  - **下一次任务额度拦截**：下一次新任务启动时，若 `usedSeconds >= 600` 且未付费：
    - **桌面端 Share 启动拦截**：`Share()` API 启动时，递归检查待分享文件总路径。若文件个数超过 5 个或单个文件大于 50MB，直接返回 error 阻断服务启动。
    - **移动端上传拦截**：在 POST `/receive/...` 请求入口处锁死 `quotaExceededAtStart`。若其为 `true`：在 Multipart 循环中，若已写入文件达到 5 个时拒绝后续接收并报错 403 阻断；在 Chunk 级文件写入 IO 循环中，若单个文件写入累计超过 50MB（52,428,800 字节），强行关闭文件、报错 413 退出并触发 `signalStop()`。

---


---

## 14. 免费用户每日用量云端权威对账与 Ed25519 签名安全规范 (Free Daily Usage Authoritative Sync)

### 14.1 防篡改体系与 Fail-Closed 验签
- **两层防御模型**：
  1. **本地层 (HMAC-SHA256)**：`chat_usage.json` 落盘带硬件密钥派生的 HMAC 签名，任何文本编辑器修改立即触发 `ClockTampered=true` 并锁死为超限状态（600s/5次）。
  2. **云端层 (SSOT + Ed25519 签名)**：客户端通过 `POST /api/v1/device/sync-usage` 上报增量，D1 `free_daily_usage` 表原子累加。服务端使用 `ED25519_PRIVATE_KEY` 对 `{device_id, usage_date, used_seconds, used_transfers, quota_exceeded, server_time}` 进行签名。
- **客户端 Fail-Closed 强制校验**：
  - 客户端收到 sync 响应时，若 `signature` 为空或验签失败（如中间人劫持/伪服务器篡改数据），**强制直接丢弃**响应，不采纳任何云端状态，确保攻击者无法通过伪造服务器清零用量。

### 14.2 部署顺序铁律与密钥配对清单 (Critical Deployment Sequence)
- **发布顺序铁律**：**先配服务端 Secret 并部署 Worker → 再发布新版客户端**。
  - 原因：客户端已实施 Fail-Closed 验签。若先发客户端但服务端未配置 `ED25519_PRIVATE_KEY`，服务端下发的空签名会导致客户端全部拒签，在线免费用户回退为本地离线模式。
- **Secret 注入命令 (SSOT)**：
  - **测试环境**（对应 `env_defaults_dev.go` 中测试公钥 `ce07f02c21cb898bf9d84c9af843dc23e830937f939d8b0a042df7210f74fe58`）：
    ```bash
    cd cloudflare/eqt-drm-api
    echo -n "<test_ed25519_private_key_hex_seed>" | npx wrangler secret put ED25519_PRIVATE_KEY --env test
    ```
  - **生产环境**（对应 `env_defaults.go` 中生产公钥 `08443678fe8bd16e3bc306db8a08b6ea1dcf3e8edeb413f655e106374bed43ac`）：
    ```bash
    cd cloudflare/eqt-drm-api
    echo -n "<prod_ed25519_private_key_hex_seed>" | npx wrangler secret put ED25519_PRIVATE_KEY
    ```
- **密钥格式注意**：`ED25519_PRIVATE_KEY` 必须为 **32-byte seed 的 64 位十六进制字符串**，严禁误填 Base64 编码或带 PEM 标头的格式。

---

