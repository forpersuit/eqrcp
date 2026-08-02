# 设备注册与设备码服务端化分析报告

> 状态：分析报告（未实施）
> 日期：2026-08-02
> 范围：设备码生成机制、启动注册/在线状态、Admin 地球大屏付费/免费双色、防修改与防破解、落地兼容点

---

## 1. 结论摘要

- 当前设备码（device_id）是**本地确定性计算**产物，熵低、可离线复现、客户端自报，**不适合作为安全边界**，仅适合做展示标识。
- 建议改为**服务端权威登记**：device_id 由服务端派发**纯随机 ≥16 hex**，仅作展示标识与聚合键，不承载安全语义。授权安全由**三因子**承担：**device_id（展示）+ 邮箱（购买者身份）+ max_devices（授权名额）**。
- **复制的虚拟机无需对抗**：克隆机共享指纹 → 共享 device_id → 只占一个授权名额，被 `max_devices` 天然免疫；多 IP/异常频率检测从"必需品"降级为**可选运营告警**。
- 付费兑换时云端签发/下发 device_id；免费用户不强制，能联网则匿名注册；启动时注册设备并登记 IP 与活跃状态。
- Admin 已有 globe.gl 大屏，当前只聚合付费激活、按数量配色；需扩展为"区间活跃设备"口径并按付费/免费双色展示。
- 防修改：靠 Ed25519 签名（device_id 纳入签名载荷）+ 服务端以库为准；防伪造（改二进制/伪造指纹）：纯软件 DRM 无法根治，只能通过异常检测、黑名单、限流、证书固定等低成本手段抬高成本。

---

## 2. 现状梳理

### 2.1 设备码本地生成机制

`pkg/server/hardware.go:317 GetDeviceStableID()`：

1. 采集主板 UUID / CPU 序列号 / 系统盘 Serial，经 `hashValue()` 做 SHA256（`hardware.go:35-44`，返回完整 64 位 hex）得到 `uuid_hash/cpu_hash/disk_hash`；
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

> 注意：该碰撞风险在旧方案（本地计算 12hex）下成立。新方案下 device_id 改由服务端派发**纯随机 ≥16 hex**（64 bit 空间，生日界约 43 亿），且授权安全由三因子（device_id + 邮箱 + max_devices）共同承担，device_id 本身不再承载授权判定，碰撞被**结构性消除**（见 §4.1）。

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

**当前本地计算方式不安全**（低熵、可复现、自报无校验），不能作为设备注册、防共享、黑名单的安全基础。服务端权威化的**实质收益**是：更长 ID（消除碰撞/枚举）、防本地篡改 device_id（签名绑定）、以及可用的"设备在用"统计口径；它**不改变授权判定的安全上限**——服务端按指纹哈希（uuid/cpu/disk 3 选 2）匹配激活记录，伪造指纹照样能注册到新 ID。指纹可伪造是纯软件 DRM 的固有边界（见 5.6），服务端化是成本抬升，不是质变。

#### 3.6.1 三因子授权模型（代替单凭据对抗思路）

把"设备码"当作唯一防线，会逼出各种对抗设计（防克隆、防碰撞、防篡改）。但授权本就有三个独立因子，应各司其职、互不重叠：

| 因子 | 谁生成 | 管什么 | 为什么够用 |
|---|---|---|---|
| **device_id** | 服务端纯随机 ≥16hex | 设备展示标识、大屏聚合键 | 64bit 随机空间，碰撞概率可忽略；**不承载授权判定** |
| **邮箱** | 购买/激活时绑定 | 购买者身份 | 语义锁定"人"，切断换购/转移 |
| **max_devices** | 激活码自带名额 | 授权上限 | **克隆免疫机制**，见下 |

**复制的虚拟机（克隆机）无需对抗**：

- 克隆机与母机指纹完全一致 → 匹配判为同一台 → 共享同一 device_id → **只占一个授权名额**；
- 想让克隆机多占名额？做不到——指纹相同必被合并；
- 因此克隆不产生任何额外授权收益，**被 `max_devices` 天然免疫**，防克隆的边际收益趋近于零，无需专门设计。
- 反直觉点：**不要给克隆机加"区分随机盐"让每台克隆拿到不同 ID**——那会把 5 台克隆变成 5 台看似合法的独立设备，唯一可用的"一个身份多 IP"行为信号就消失了。合并 + 行为检测（可选告警）才是既诚实又能出信号的组合。

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

1. **IP 必须取自 Cloudflare 请求头（CF-Connecting-IP）**，禁止信任 body 传入的 IP；
2. 按指纹匹配已有设备记录 → 命中则**复用原 device_id**，更新 `last_seen_at/last_ip/经纬度`（**显式刷新，不能沿用 activate 仅新激活写库的时机**，见 4.4 前提）；
3. 未命中 → 服务端生成**纯随机 device_id（≥16 hex，用 randomUUID，不掺指纹派生）**，写入设备注册表；
4. 返回 `{ device_id, tier: "free"|"paid" }`。

> **指纹匹配规则（共享分量一致即同一台）**：能比的分量都比了，全相等就是同一台；缺失项不参与比较，既不判等也不判不等。
>
> ```
> 匹配(本次上报, 库中记录):
>   · 双方都有的分量全部相等 → 命中，复用 device_id
>   · 任一非空分量不等       → 不同设备 → 新建身份
>   · 上报全空               → 付费: 拒绝并提示权限问题；免费: 匿名跳过不建档
> ```
>
> 分量齐全度只决定身份强度，不改变判定方向——缺分量不会帮你冒充别人的机器（冒充需要共享一个相等的值）。"3 选 2"是旧表述，已废弃：它错误地暗示必须凑满 2 个分量才能匹配，实际只需"双方都有的分量全部相等"。
>
> 三处（离线 `VerifyFingerprint`、云端 `matchFingerprint`、registry 匹配）必须共用同一条规则，避免"在线判这台、离线判另一台"的分裂。

分级策略：

- **Free 用户**：不强制。启动时有网 → 匿名注册（不绑定授权码）；无网 → 跳过，不阻断任何功能，本地可显示"未注册"。
- **付费用户**：兑换激活码时走 `/api/v1/activate`，云端强制注册/复用 device_id，写入 `activations`，把 device_id 放入签名载荷后签发 `.lic` 下发，客户端持久化。
- 启动时的静默对账沿用现有 `ForceOnlineLicenseSync()`；**注意其 `force=true` 完全绕过节流，即启动路径每次注册不节流**，12 小时节流只作用于后台 sync（`license.go:352-359`）。注册动作可并入其中，避免新增请求次数。

### 4.2 数据模型变更

新增表 `device_registry`（**免费与付费统一入口**，按 `tier_label` 区分，不做分表）：

```sql
CREATE TABLE IF NOT EXISTS device_registry (
  device_id     TEXT PRIMARY KEY,
  uuid_hash     TEXT,
  cpu_hash      TEXT,
  disk_hash     TEXT,
  tier_label    TEXT NOT NULL DEFAULT 'free',      -- free | paid
  license_code  TEXT,                               -- 付费时关联
  email         TEXT,                               -- 激活时绑定，购买者身份因子
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

> 说明：早先考虑过"免费/付费分表"，已否决。统一表 + `tier_label` 过滤即可避免免费流量污染授权口径（聚合查询按 tier 过滤），分表反而让"同一台设备先免费后付费"的升级路径（需更新 device_id 关联）变得复杂。
>
> device_id 仅是主键标签，不承载授权判定；同一指纹集合并为一行（克隆机共享一行）。

`activations` 增加 `last_seen_at`、`last_ip` 列（幂等 ALTER，沿用 `ensureActivationNetworkColumns` / `ensureDeviceIdColumn` 模式，见 `cloudflare/eqt-drm-api/src/utils/auth.ts:29-57`）。

### 4.3 "在用"判定口径

**统一按设备维度（device_id）计活跃，不区分"人"**——本产品是设备授权制，活跃口径 = 设备活跃，非用户活跃（同一台设备可能多人共用，语义即"这台设备还活着"）。

- **活跃（默认口径）**：`last_seen_at` 距今 ≤ **1 小时**；
- 可切换区间：最近 1h / 12h / 24h / 7d；
- 累计：全部记录。

大屏默认展示"最近 1 小时活跃"口径，提供区间切换与抛物线（arcs）显示开关。

> qrcp 是启动即用、用完即走的 CLI 工具，不是常驻进程，`last_seen_at` 实际等于"最后一次启动/对账时间"，不存在"在线心跳"。故不设"在线（≤10 分钟）"口径，最短区间即为 1h。

### 4.4 Admin 地球大屏改造

新端点 `GET /api/v1/admin/devices/live?window=1h|12h|24h|7d&arcs=1`（Admin 鉴权），返回区间内每台活跃设备的：

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
- 柱子高度按该点"区间内活跃"设备数，环/光晕表示最近 1h 内活跃；
- 悬浮提示展示付费/免费数量拆分；
- **抛物线（arcs）显示可开关**（沿用现有 `cross_region_arcs` 的弧线渲染）。

现有 `/admin/activation-locations` 保留（授权分布口径），新端点承载"区间活跃"口径。

#### 经纬度来源（重要前提）

城市/地区/经纬度只可能来自 **Cloudflare Workers 内置 `request.cf` 的 geolocation**（`drm.ts:10-46 activationClientMeta()` 读取 `cf.city/cf.latitude/cf.longitude/cf.regionCode`，并回退同名 `CF-*` 请求头），**没有外部 GeoIP 服务兜底**。落地时注意三个现状：

1. `request.cf` 的 city/lat/lng 属 Workers 运行时提供但**文档未承诺一定非空**；代理/VPN/数据中心出口会得到 `XX`/`T1`（代码已排除），此时该行地理数据为空。
2. 只有**新激活**才写这些列（`drm.ts:290`），已激活设备的重复激活不刷新网络元数据——**register 端点必须显式刷新 `last_seen_at/last_ip/lat/lng`，不能沿用 activate 的写库时机**。
3. 前端 `LicenseGlobeCard.svelte:99-106 getCoordForItem()` 对经纬度为空的点回退到 `COUNTRY_COORDS` 国家中心点表（无表项再兜底中国中心）——大屏不会白屏，但大量点位只是**国别级近似**。若要求城市级精度，需另接 GeoIP 服务（成本项，本期不做）。

---

## 5. 防修改与防破解

### 5.1 用户到底能不能改？分层回答

| 攻击方式 | 能否成功 | 防线 |
| --- | --- | --- |
| 文本编辑器改 `.lic` 的 tier/期限/device_id | 不能 | Ed25519 签名（公钥内置），改任一字段验签失败 → 降级 Unpaid |
| 改本地持久化的 device_id | 无意义 | 服务端以库为准，verify 返回权威值并签回 |
| 拷贝他人已激活 `.lic` 到本机 | 不能 | 证书内嵌原机指纹，本地 `VerifyFingerprint` + 云端 `matchFingerprint` 双重校验（共享分量一致规则，见 4.1） |
| 改二进制/伪造上报指纹 | 能（软件级无解） | 只能抬高成本：异常检测（可选告警，见 5.4）、黑名单、限流、代码加固 |

### 5.2 核心防线：device_id 进入签名载荷

- 证书签名载荷改为：`license_code|tier|uuid_hash|cpu_hash|disk_hash|device_id|expires_at|max_devices`；
- 对账签名载荷同步追加 device_id；
- 效果：本地篡改 device_id（或证书任何字段）在验签瞬间暴露。

### 5.3 服务端权威化

- 所有后续请求中，客户端声称的 device_id 不作为授权依据；服务端按指纹命中登记/激活记录，以库中 device_id 为准；
- verify 响应中把权威 device_id 签回客户端，自动纠正本地被改的值。

### 5.4 异常检测降级为可选运营告警（克隆已免疫）

> 定位修正：在 §3.6.1 三因子模型下，克隆机被 `max_devices` 天然免疫，不产生额外授权收益。**多 IP/频率检测不再是防克隆的必需品**，降级为可选运营告警，价值在于发现共号/异地使用等滥用信号，不承诺阻断。

1. **多 IP 检测**：同一 device_id 在滑动 24h 内出现 ≥3 个不同 IP 或 ≥2 个国家 → 标记 `SUSPECT` 并写审计日志（`admin_audit_logs`，action=`DEVICE_SUSPECT`）；
2. **频率检测**：同一 device_id 注册/激活/对账频率超过阈值（如 1 小时内 > 10 次，或 1 分钟内 > 3 次）→ 临时限流（429）；
3. **二次确认转黑名单**：可疑标记叠加（多 IP + 高频）或管理员确认后，写入现有 `manual_blacklist`（`kind='device'`，已有 admin 管理界面可直接复用）；
4. 黑名单命中在 `register/activate/verify` 三处统一拦截。

### 5.5 其他低成本方案清单

- 服务端生成更长 ID（≥16 hex）消除碰撞；
- HTTPS + 证书固定，防中间人替换/重放响应；
- `register/activate` 按"IP+指纹组合"限频，防批量注册；
- 同 device_id 高频并发 verify（共享嫌疑）计数告警；
- 免费匿名注册与付费激活共库，**按 `tier_label` 过滤口径**（不做分表，见 4.2 说明）；
- 0 分量（权限不足）付费拒绝 + 显式报障，防止合法用户因权限不足反复丢失授权名额（见 4.1 匹配规则）；
- 二进制加壳/签名校验/反调试作为成本项（不承诺绝对安全）；
- 隐私合规：IP/经纬度登记纳入隐私说明，提供遥测开关。

### 5.6 诚实边界声明

只要计算和校验发生在用户可控设备上、且无硬件信任根（TPM/安全芯片远程证明），**纯软件 DRM 无法阻止伪造指纹**。服务端化能防"修改"，能把"伪造"从零成本变成需要改二进制+规避审计的高成本，但做不到绝对。这属于行业公认边界，不建议投入超出收益的对抗成本。

> 克隆机在此边界内属于**无害面**：克隆机指纹与母机一致，被授权名额合并免疫（见 3.6.1），不产生额外授权收益，故无需在纯软件边界内为其额外投入对抗成本。

---

## 6. 落地兼容点

### 6.1 签名载荷变更 → 新旧证书兼容

- 方案 A：客户端双版本验签（旧 7 字段载荷、新 8 字段载荷并存，过渡一个版本）；
- 方案 B：服务端对存量已激活设备在首次 `register/verify` 时强制重签新格式证书。
- 建议 A+B 组合：A 保证老证书不失效，B 让存量设备尽快收敛到新格式。

### 6.2 存量激活记录回填 device_id

> 现状：`activations` 全部为开发期测试数据，**无真实存量用户**（已确认可清库重来）。

- 开发期策略：直接清空 `activations`（与 `device_registry`），上线即从新体系开始，无需回填迁移。
- 若未来有真实存量：首次注册时按共享分量一致规则匹配（见 4.1），用服务端新值回填；过渡期旧 device_id 保留为别名用于黑名单/审计检索。
- 受影响点：`findPeerActiveLicensesOnDevice`（`drm.ts:75-80`）按 `device_id` 字符串相等做跨码叠码检测，是回填/换 ID 逻辑的最直接受影响者，改动时一并验证。

### 6.3 移除本地计算逻辑的影响面

- 代码：移除/废弃 `GetDeviceStableID()` 计算路径（用户明确认为本地保留不安全）；
- 展示：GUI About（`desktop/gui/agent.go:97`、`frontend/src/main.js:2564`）与 `done.tmpl.html:426` 改为读取 `.lic` 中服务端下发的 device_id，未注册显示"未注册"；
- 测试：`EQT_TESTING` 兼容走的是**测试替身变量路径**（`testBoardUUID/testCPUSerial/testDiskSerial` + `GetDeviceFingerprintHashes()`，`hardware.go:273-310`），不是环境变量分支；`GetDeviceStableID()` 移除后该替身路径同步调整；
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
| M1 | D1 新增 `device_registry` 表（含 `email` 列）+ `register` 端点 + 客户端启动注册（免费匿名、付费复用，绑定邮箱）；共享分量匹配规则 + 0 分量付费拒绝；遥测开关与隐私说明就绪；开发期清库重置 `activations` |
| M2 | device_id 纳入证书/对账签名载荷 + 客户端双版本验签 + 存量强制重签（**联动 paddle.ts 铸造/吊销/续费路径**） |
| M3 | `last_seen_at/last_ip` 列 + `/admin/devices/live`（区间参数）+ 大屏付费/免费双色与活跃口径 + 抛物线开关 |
| M4 | **可选**运营告警（同 ID 多国家）+ 频率限流 + 证书固定；**不**做自动黑名单，异常检测不作为授权阻断（克隆已免疫，见 3.6.1/5.4） |

---

## 8. 总结

当前本地设备码计算不安全（低熵、可复现、自报无校验）。改为服务端计算/签发后，以**三因子授权模型**收敛（device_id 展示 + 邮箱绑定 + max_devices 名额）：免费用户不强制、联网即匿名注册；付费兑换时云端下发并签名绑定；启动注册登记 IP 与活跃状态。**复制的虚拟机被授权名额天然免疫，无需对抗**（见 3.6.1）；异常检测降级为可选运营告警。大屏以付费/免费双色展示区间活跃设备（默认最近 1h）。防修改依赖签名与服务端权威化，防伪造依靠限流、黑名单等低成本手段抬高成本，并明确纯软件 DRM 的边界。

---

## 附：代码核对与审阅意见（2026-08-02）

> 本节是对上文的逐条代码实证核对（Go 侧 + Cloudflare 侧），以及针对审阅反馈的决策记录。**结论：报告事实基础扎实（20 条 claims 中 17 条 CONFIRMED），核心方向正确；已按审阅意见修正正文，并在此留档。**

### A. 事实核对结果

| # | 报告引用 | 实证结果 |
|---|---|---|
| 1 | `GetDeviceStableID()` hardware.go:317，SHA256→12hex | ✅ `hardware.go:314-369`；`hashValue()` 实际在 `hardware.go:35-44`（已修正） |
| 2 | `ActivateLicenseOnline` license.go:236 POST /activate | ✅ `license.go:235-260`；body 含 `device_id`=本地自报值（license.go:252） |
| 3 | `LicenseCertificate` 签名载荷 7 字段不含 device_id | ✅ `license.go:56-81`，Ed25519 |
| 4 | `ForceOnlineLicenseSync` 启动强制+12h 节流 | ✅ `license.go:333-359`；**注意 `force=true` 完全绕过节流**，启动路径每次注册不节流 |
| 5 | `sanitizeDeviceID` server.go:1688（传输会话） | ✅ `server.go:1688-1706`，与 DRM 设备码无关 |
| 6 | device_id 展示点 agent.go:97 / main.js:2564 / done.tmpl:426 | ✅ agent.go:97；`desktop/gui/frontend/src/main.js:2564`（顶层无 `frontend/`，已修正）；done.tmpl.html:426 展示的是传输 clientID 尾号 |
| 7 | `VerifyFingerprint` + 云端 `matchFingerprint` 3 选 2 | ✅ Go 侧 `license.go:113`；TS 侧 `cloudflare/eqt-drm-api/src/utils/blacklist.ts:6` |
| 8 | `EQT_TESTING` 兼容路径 | ⚠️ 是测试替身变量路径（hardware.go:273-310），非 env 分支（已修正） |
| 9 | `/api/v1/verify` 服务端签发对账签名 | ✅ `drm.ts:397-517`，`OK\|code\|三指纹\|currentTime` Ed25519 |
| 10 | `/api/v1/device/register` 不存在（需新增） | ✅ 全仓库零命中 |
| 11 | 云端信任 body device_id 入库 | ✅ `drm.ts:300-316` 直接 `device_id \|\| ""`，仅字符串相等 |
| 12 | `/admin/activation-locations` 只聚合付费 | ✅ `admin.ts:276-293`；颜色分档在前端 `LicenseGlobeCard.svelte:193` |
| 13 | activations 无 `last_seen_at/last_ip` | ✅ `schema.sql:23-39`，全库 grep 零命中 |
| 14 | `ensureActivationNetworkColumns` 幂等 ALTER | ✅ `auth.ts:40-57`（另有 `ensureDeviceIdColumn` 等同类模式） |
| 15 | `manual_blacklist`(`kind='device'`)/`admin_audit_logs` | ✅ `schema.sql:97-114` / `84-94` |
| 16 | 经纬度来源 | ⚠️ 仅 Cloudflare `request.cf` geolocation（`drm.ts:10-46`），无外部 GeoIP 兜底；前端 `getCoordForItem()` 空经纬度回退国家中心点（见 4.4 前提） |
| 17 | Paddle 集成 | ❌ **报告原本完全没提**——存在完整 `routes/paddle.ts` webhook，是付费激活码的唯一自动化来源（见 C-2） |

### B. 审阅决策记录（用户已确认）

1. **经纬度来源**：以 Cloudflare 边缘 `request.cf` geolocation 为准（可回退 `CF-*` 请求头），不引入外部 GeoIP 服务；已写入 4.4 前提。
2. **大屏语义**：以 device_id 计**设备活跃**（非用户活跃），产品语义即"这台设备还活着"；已写入 4.3。
3. **表结构**：统一表 + `tier_label` 过滤，否决分表；已写入 4.2。
4. **安全预期**：下调——服务端化是成本抬升不是质变，指纹伪造由异常检测兜底；已改写 3.6。
5. **活跃口径**：默认最近 1h，可切换 1h/12h/24h/7d，抛物线可开关；已写入 4.3/4.4。
6. **M2 存量数据**：当前 activations 均为测试数据，可清库重来，回填章节弱化为开发期清库；已改写 6.2。
7. **克隆免疫 + 三因子模型**：复制的虚拟机被授权名额天然免疫（共享指纹 → 共享 device_id → 只占一个名额），无需专门对抗；授权安全收敛为 device_id + 邮箱 + max_devices 三因子；指纹匹配改为"共享分量一致"规则（废弃"3 选 2"表述）；多 IP/异常检测降级为可选运营告警；已写入 3.6.1/4.1/5.4。

### C. 遗留风险（不属于上述决策，需在实施时再评估）

- **C-1 免费侧口径失真**：免费注册无成本、无授权码绑定，伪造者可无限注册污染免费计数；有遥测开关则免费侧数据质量进一步下降。免费侧定位为"抽样展示"，免费设备注册需配合限频。
- **C-2 Paddle 衔接**：`device_id` 进签名载荷的改动落在 `drm.ts` activate/verify，与 `paddle.ts` 铸造流程强耦合；webhook 铸造的激活码在首次 activate 前没有指纹，6.2 需保证 register 先于 activate 或原子合并。
- **C-3 多 IP 告警误伤**：移动办公/VPN 用户会被"同 ID 多 IP"标记；因克隆已免疫、检测降级为可选告警（见 5.4），仅作运营参考，不做自动黑名单。
- **C-4 隐私合规**：IP/经纬度登记需纳入隐私说明，遥测开关（见 5.5）应作为 M1 就绪项而非后续项。
