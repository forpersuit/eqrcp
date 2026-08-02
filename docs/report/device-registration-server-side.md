# 设备注册与设备码服务端化分析报告

> 状态：分析报告（未实施）
> 日期：2026-08-02
> 范围：设备码生成机制、启动注册/在线状态、Admin 地球大屏付费/免费双色、防修改与防破解、落地兼容点

---

## 1. 结论摘要

- 当前设备码（device_id）是**本地确定性计算**产物，熵低、可离线复现、客户端自报，**不适合作为安全边界**，仅适合做展示标识。
- 建议改为**服务端权威登记**：付费兑换时云端计算/签发并下发；免费用户不强制，能联网则匿名注册；启动时注册设备并登记 IP。
- Admin 已有 globe.gl 大屏，当前只聚合付费激活、按数量配色；需扩展为"在用设备"口径并按付费/免费双色展示。
- 防修改：靠 Ed25519 签名（device_id 纳入签名载荷）+ 服务端以库为准；防伪造（改二进制/伪造指纹）：纯软件 DRM 无法根治，只能通过多 IP/异常频率检测、黑名单、限流、证书固定等低成本手段抬高成本。

---

## 2. 现状梳理

### 2.1 设备码本地生成机制

`pkg/server/hardware.go:317 GetDeviceStableID()`：

1. 采集主板 UUID / CPU 序列号 / 系统盘 Serial，经 `hashValue()` 做 SHA256（`hardware.go:49`）得到 `uuid_hash/cpu_hash/disk_hash`；
2. 取三个哈希中的**非空值**，排序后以 `|` 拼接；
3. 对拼接串再做 SHA256，取前 12 个 hex 字符作为 device_id。

特性：

- 确定性：同一台机器重装系统/应用不变，换硬件或权限不足导致指纹缺失时变化或为空；
- 算法与输入全部在客户端，无任何服务端秘密成分。

### 2.2 激活 / 对账流程

- 激活：`pkg/server/license.go:236 ActivateLicenseOnline` → POST `/api/v1/activate`，携带 `uuid_hash/cpu_hash/disk_hash/device_id`（device_id 为本地自报值）。
- 云端：`cloudflare/eqt-drm-api/src/routes/drm.ts:154` 直接信任 body 中的 `device_id` 写入 `activations.device_id`，仅用于同码去重/防叠码匹配，**不校验其与指纹的对应关系**。
- `.lic` 证书：`pkg/server/license.go:28 LicenseCertificate` 存储指纹哈希与 Ed25519 签名；签名载荷为 `license_code|tier|uuid_hash|cpu_hash|disk_hash|expires_at|max_devices`，**不含 device_id**。
- 对账：`/api/v1/verify` 客户端携带指纹，服务端按指纹匹配激活记录，并签发带服务端时间的对账签名。

### 2.3 Admin 大屏现状

- 前端 `cloudflare/eqt-admin/src/components/LicenseGlobeCard.svelte` 已用 globe.gl 渲染地球；
- 数据源 `GET /api/v1/admin/activation-locations`（`routes/admin.ts:276`）：只聚合 `activations`（付费激活）按国家/城市分组，柱子颜色按设备数量分档，**无免费设备、无"在用"口径、无付费/免费双色**。
- `activations` 表已登记 `client_ip/ip_country/city/region/latitude/longitude/user_agent`，但**没有 last_seen_at / last_ip**，无法判定"当前在用"。

---

## 3. 当前设备码计算安全性分析

算法可形式化为：

```text
device_id = SHA256( sort(non_empty{uuid_hash, cpu_hash, disk_hash}).join("|") )[:12]
```

### 3.1 熵不足，存在碰撞风险

12 个 hex 字符只有 **48 bit 空间**。生日攻击下约 2^24（约 1677 万）个 ID 就有 50% 碰撞概率。当前设备量远低于该阈值，但 device_id 一旦被用于黑名单、授权绑定等长期凭据，空间过小且算法公开，攻击者可以离线枚举、撞库。

### 3.2 算法与输入完全公开，可离线复现

- 输入（`uuid_hash/cpu_hash/disk_hash`）来自普通权限可执行的命令（PowerShell CIM/wmic、`/sys/class/dmi` 等），任何用户在自己机器上都能读取；
- 计算函数在客户端二进制内，可反编译复现。
- 因此 device_id 是"公开函数对公开输入的确定性输出"，**不存在只有服务端知道的秘密成分**。攻击者可以：离线验证某组指纹得到的目标 ID、反向构造指纹集、或直接 patch 客户端改返回值。

### 3.3 客户端自报，服务端无权威登记

云端 `drm.ts` 原样信任 body 中的 `device_id` 入库。克隆/伪造成本为零（改 JSON 或 patch 二进制），服务端无法验证 device_id 与指纹是否真实对应。

### 3.4 确定性标识的隐私问题

同一设备跨网络、跨时间固定不变，配合 IP 登记可长期关联用户活动轨迹，属于隐私合规风险点。

### 3.5 运营问题：本地保留算法导致无法统一演进

只要旧客户端还在本地计算，服务端就无法统一改算法、加盐、换格式——改了就会与所有存量客户端失配。

### 3.6 结论

**当前本地计算方式不安全**，不能作为设备注册、防共享、黑名单的安全基础；必须服务端权威化：客户端只上报指纹哈希，device_id 由服务端生成/登记/签发。

---

## 4. 目标方案设计

### 4.1 启动注册（能联网就注册，不联网不强求）

新增端点 `POST /api/v1/device/register`，请求体：

```json
{
  "uuid_hash": "...",
  "cpu_hash": "...",
  "disk_hash": "...",
  "app_version": "x.y.z",
  "lang": "zh"
}
```

服务端逻辑：

1. **IP 必须取自 Cloudflare 请求头（CF-Connecting-IP），禁止信任 body 传入的 IP**；
2. 按指纹 3 选 2 非空匹配已有设备记录 → 命中则**复用原 device_id**，更新 `last_seen_at/last_ip/经纬度`；
3. 未命中 → 服务端生成新 device_id（建议 ≥16 hex，含随机成分，例如 `randomUUID` 或"随机 + 指纹派生"混合），写入设备注册表；
4. 返回 `{ device_id, tier: "free"|"paid" }`。

分级策略：

- **Free 用户**：不强制。启动时有网 → 匿名注册（不绑定授权码）；无网 → 跳过，不阻断任何功能，本地可显示"未注册"。
- **付费用户**：兑换激活码时走 `/api/v1/activate`，云端强制注册/复用 device_id，写入 `activations`，把 device_id 放入签名载荷后签发 `.lic` 下发，客户端持久化。
- 启动时的静默对账沿用现有 `ForceOnlineLicenseSync()`（拉起强制、之后 12 小时节流），注册动作可并入其中，避免新增请求次数。

### 4.2 数据模型变更

新增表 `device_registry`（免费与付费设备统一入口）：

```sql
CREATE TABLE IF NOT EXISTS device_registry (
  device_id     TEXT PRIMARY KEY,
  uuid_hash     TEXT,
  cpu_hash      TEXT,
  disk_hash     TEXT,
  tier_label    TEXT NOT NULL DEFAULT 'free',      -- free | paid
  license_code  TEXT,                               -- 付费时关联
  registered_at TEXT NOT NULL,
  last_seen_at  TEXT,
  last_ip       TEXT,
  ip_country    TEXT,
  city          TEXT,
  region        TEXT,
  latitude      REAL,
  longitude     REAL,
  app_version   TEXT
);
```

`activations` 增加 `last_seen_at`、`last_ip` 列（幂等 ALTER，沿用 `ensureActivationNetworkColumns` 模式）。

### 4.3 "在用"判定口径

- 实时（在线）：`last_seen_at` 距今 ≤ N 分钟（建议 10 分钟，随启动注册/对账刷新）；
- 活跃（在用）：≤ 24h；
- 累计：全部记录。
- 大屏默认展示"活跃/在线"口径，并提供切换。

### 4.4 Admin 地球大屏改造

新端点 `GET /api/v1/admin/devices/live`（Admin 鉴权），返回每台设备的：

```json
{
  "device_id": "...",
  "tier_label": "paid" | "free",
  "country": "CN",
  "city": "Shanghai",
  "latitude": 31.23,
  "longitude": 121.47,
  "last_seen_at": "..."
}
```

前端 `LicenseGlobeCard.svelte` 扩展：

- 付费设备：金色/绿色系（如 `#f5b301` / `#22c55e`）；
- 免费设备：灰色/蓝色系（如 `#64748b` / `#38bdf8`）；
- 柱子高度按该点"在用"设备数，环/光晕表示在线。
- 悬浮提示展示付费/免费数量拆分。

现有 `/admin/activation-locations` 保留（授权分布口径），新端点承载"在用"口径。

---

## 5. 防修改与防破解

### 5.1 用户到底能不能改？分层回答

| 攻击方式 | 能否成功 | 防线 |
| --- | --- | --- |
| 文本编辑器改 `.lic` 的 tier/期限/device_id | 不能 | Ed25519 签名（公钥内置），改任一字段验签失败 → 降级 Unpaid |
| 改本地持久化的 device_id | 无意义 | 服务端以库为准，verify 返回权威值并签回 |
| 拷贝他人已激活 `.lic` 到本机 | 不能 | 证书内嵌原机指纹，本地 `VerifyFingerprint` + 云端 `matchFingerprint` 3 选 2 双重校验 |
| 改二进制/伪造上报指纹 | 能（软件级无解） | 只能抬高成本：多 IP/异常频率检测、黑名单、限流、代码加固 |

### 5.2 核心防线：device_id 进入签名载荷

- 证书签名载荷改为：`license_code|tier|uuid_hash|cpu_hash|disk_hash|device_id|expires_at|max_devices`；
- 对账签名载荷同步追加 device_id；
- 效果：本地篡改 device_id（或证书任何字段）在验签瞬间暴露。

### 5.3 服务端权威化

- 所有后续请求中，客户端声称的 device_id 不作为授权依据；服务端按指纹命中登记/激活记录，以库中 device_id 为准；
- verify 响应中把权威 device_id 签回客户端，自动纠正本地被改的值。

### 5.4 同一 device_id 多 IP / 异常频率检测 + 黑名单（低成本）

1. **多 IP 检测**：同一 device_id 在滑动 24h 内出现 ≥3 个不同 IP 或 ≥2 个国家 → 标记 `SUSPECT` 并写审计日志（`admin_audit_logs`，action=`DEVICE_SUSPECT`）；
2. **频率检测**：同一 device_id 注册/激活/对账频率超过阈值（如 1 小时内 > 10 次，或 1 分钟内 > 3 次）→ 临时限流（429）；
3. **二次确认转黑名单**：可疑标记叠加（多 IP + 高频）或管理员确认后，写入现有 `manual_blacklist`（`kind='device'`，已有 admin 管理界面可直接复用）；
4. 黑名单命中在 `register/activate/verify` 三处统一拦截。

### 5.5 其他低成本方案清单

- 服务端生成更长 ID（≥16 hex）消除碰撞；
- HTTPS + 证书固定，防中间人替换/重放响应；
- `register/activate` 按"IP+指纹组合"限频，防批量注册；
- 同 device_id 高频并发 verify（共享嫌疑）计数告警；
- 免费匿名注册与付费激活分表，避免免费流量污染授权口径；
- 二进制加壳/签名校验/反调试作为成本项（不承诺绝对安全）；
- 隐私合规：IP/经纬度登记纳入隐私说明，提供遥测开关。

### 5.6 诚实边界声明

只要计算和校验发生在用户可控设备上、且无硬件信任根（TPM/安全芯片远程证明），**纯软件 DRM 无法阻止伪造指纹**。服务端化能防"修改"，能把"伪造"从零成本变成需要改二进制+规避审计的高成本，但做不到绝对。这属于行业公认边界，不建议投入超出收益的对抗成本。

---

## 6. 落地兼容点

### 6.1 签名载荷变更 → 新旧证书兼容

- 方案 A：客户端双版本验签（旧 7 字段载荷、新 8 字段载荷并存，过渡一个版本）；
- 方案 B：服务端对存量已激活设备在首次 `register/verify` 时强制重签新格式证书。
- 建议 A+B 组合：A 保证老证书不失效，B 让存量设备尽快收敛到新格式。

### 6.2 存量激活记录回填 device_id

- 存量 `activations.device_id` 为本地旧算法产物，与未来服务端签发值可能不同；
- 首次注册时按指纹 3 选 2 匹配，用服务端新值回填，并在重签证书时以指纹为准绑定新 device_id；
- 过渡期内旧 device_id 可保留为别名用于黑名单/审计检索，避免误判。

### 6.3 移除本地计算逻辑的影响面

- 代码：移除/废弃 `GetDeviceStableID()` 计算路径（用户明确认为本地保留不安全）；
- 展示：GUI About（`desktop/gui/agent.go:97`、`frontend/src/main.js:2564`）与 `done.tmpl.html:426` 改为读取 `.lic` 中服务端下发的 device_id，未注册显示"未注册"；
- 测试：`EQT_TESTING` 兼容路径需同步调整；
- 传输会话用的 clientID（`server.go:1688 sanitizeDeviceID`）与 DRM 设备码是两回事，**不受影响**，无需改动。

### 6.4 Free 注册表与 activations 分离

`device_registry` 管"这台设备是否见过"，`activations` 管"授权码绑了哪几台"，两者通过 `license_code/device_id` 关联，避免免费流量污染授权统计与大屏口径。

### 6.5 其他

- 功能增加 → 小版本号 +1（仓库规则）；
- 需跑 `go test ./...`、`npm run test:e2e`、`npm run test:admin`；
- 新路由在 `docs/test-analysis.md` 或对应契约文档登记。

---

## 7. 建议实施顺序（里程碑）

| 里程碑 | 内容 |
| --- | --- |
| M1 | D1 新增 `device_registry` 表 + `register` 端点 + 客户端启动注册（免费匿名、付费复用）；存量设备指纹回填 |
| M2 | device_id 纳入证书/对账签名载荷 + 客户端双版本验签 + 存量强制重签 |
| M3 | `last_seen_at/last_ip` 列 + `/admin/devices/live` + 大屏付费/免费双色与在线口径 |
| M4 | 多 IP/异常频率检测 + 审计 + 黑名单联动 + 限流 + 证书固定 |

---

## 8. 总结

当前本地设备码计算不安全（低熵、可复现、自报无校验）。改为服务端计算/签发后：免费用户不强制、联网即匿名注册；付费兑换时云端下发并签名绑定；启动注册登记 IP 与在线状态；大屏以付费/免费双色展示在用情况。防修改依赖签名与服务端权威化，防伪造依靠异常检测、黑名单等低成本手段抬高成本，并明确纯软件 DRM 的边界。
