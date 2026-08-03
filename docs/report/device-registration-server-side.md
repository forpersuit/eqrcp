# 设备注册与设备码服务端化分析报告

> 状态：分析报告（未实施）
> 日期：2026-08-02
> 范围：设备码生成机制、启动注册/在线状态、Admin 地球大屏付费/免费双色、防修改与防破解、落地兼容点

---

## 1. 结论摘要

- 当前设备码（device_id）是**本地确定性计算**产物，熵低、可离线复现、客户端自报，**不适合作为安全边界**，仅适合做展示标识。
- 建议改为**服务端权威登记**：device_id 由服务端派发**纯随机 ≥16 hex**，仅作展示标识与聚合键，不承载安全语义。授权职责拆分：**指纹（运行时身份）+ max_devices（运行时名额）** 是运行时要件；**邮箱（购买者身份/退款/黑名单）与 device_id（展示/聚合）是账户层与展示层因子，不参与运行时 verify**。
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

> 注意：该碰撞风险在旧方案（本地计算 12hex）下成立。新方案下 device_id 改由服务端派发**纯随机 ≥16 hex**（64 bit 空间，生日界约 43 亿），且授权职责拆分后 device_id 本身不承载授权判定（运行时判定 = 指纹 + max_devices，见 3.6.1），碰撞被**结构性消除**（见 §4.1）。

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

#### 3.6.1 授权职责拆分（代替单凭据对抗思路）

把"设备码"当作唯一防线，会逼出各种对抗设计（防克隆、防碰撞、防篡改）。但授权本就有多个独立因子，应各司其职、互不重叠。注意：**运行时（activate/verify/register）真正参与授权判定的只有指纹 + max_devices**；邮箱与 device_id 是账户层/展示层因子，不参与运行时校验：

| 因子 | 层级 | 谁生成 | 管什么 |
|---|---|---|---|
| **指纹（uuid/cpu/disk）** | 运行时身份 | 客户端采集哈希 | 判定"是不是同一台设备"；激活/对账/黑名单的唯一运行时身份键 |
| **max_devices** | 运行时名额 | 激活码自带 | 授权上限；克隆合并免疫机制，见下 |
| **邮箱** | 账户层 | 购买/激活时绑定 | 购买者身份；退款/黑名单/unbind 配额/Portal 归属。**不参与运行时 verify** |
| **device_id** | 展示层 | 服务端纯随机 ≥16hex | 设备展示标识、大屏聚合键；**不承载授权判定** |

**复制的虚拟机（克隆机）无需专门对抗（精确边界）**：

- 不改指纹的纯克隆：克隆机与母机指纹完全一致 → 匹配判为同一台 → 共享同一 device_id → **只占一个授权名额**；
- 但"克隆机**不可能**多占名额"**不成立**——克隆机只要改一个指纹分量（如伪造磁盘序列号）就变成"新设备"再占名额。因此防克隆本身无增量收益（指纹伪造在纯软件下本来就无解，见 5.6），**结论是不做专门防克隆，但论据是"指纹伪造无解、防克隆无增量收益"，不是"做不到"**；
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
2. **身份查找靠指纹，不信任 body 里的 device_id**（服务端以库为准）：粗筛（对本次非空分量做 `uuid_hash=? OR cpu_hash=? OR disk_hash=?` 等值查询，走各自索引）→ 精筛（候选行中"本次与库中都非空"的分量须**全部相等**，任一不等即剔除=换机）→ 命中则**复用原 device_id**，更新 `last_seen_at` + `last_ip/经纬度`（**显式刷新，不能沿用 activate 仅新激活写库的时机**，见 4.4 前提）；
3. 未命中 → 服务端生成**纯随机 device_id（≥16 hex，用 randomUUID，不掺指纹派生）**，写入设备注册表；
4. 返回 `{ device_id, tier: "free"|"paid" }`。

> **边界说明（仅软件启动时请求一次）**：
> 现阶段不追踪不同传输/聊天模式，也不在切换模式时发送状态。仅在**应用打开/启动时**尝试发起一次注册/刷新请求；无网或请求失败时静默丢弃（Fail-open），绝不上报 alert 弹窗或阻断用户任何正常使用。

> **指纹匹配规则（共享分量一致即同一台）**：能比的分量都比了，全相等就是同一台；缺失项不参与比较，既不判等也不判不等。
>
> ```
> 匹配(本次上报, 库中记录):
>   · 双方都有的分量全部相等 → 命中，复用 device_id
>   · 任一非空分量不等       → 不同设备 → 新建身份
>   · 上报全空               → 付费: 拒绝并提示权限问题；免费: 匿名跳过不建档
> ```
>
> **硬件变更处理**：若用户主动更换了 CPU 或系统盘导致共有分量不相等，系统将其判定为新硬件。用户在许可证 Self-service Portal 网页或 Admin 后台执行“解绑原设备并重新激活”即可顺利恢复使用。
>
> 分量齐全度只决定身份强度，不改变判定方向——缺分量不会帮你冒充别人的机器（冒充需要共享一个相等的值）。"3 选 2"是旧表述，已废弃：它错误地暗示必须凑满 2 个分量才能匹配，实际只需"双方都有的分量全部相等"。
>
> 三处（离线 `VerifyFingerprint`、云端 `matchFingerprint`、registry 匹配）必须共用同一条规则，避免"在线判这台、离线判另一台"的分裂。

分级策略：

- **Free 用户**：不强制。启动时有网 → 匿名注册（不绑定授权码）；无网 → 跳过，不阻断任何功能，本地可显示"未注册"。
- **付费用户**：兑换激活码时走 `/api/v1/activate`，端点**内联完成"注册/复用 device_id → 写 activations → 签发 `.lic` 下发"三步，一次请求原子做完**（付费无需先调 `register`，见附录 C-2），客户端持久化。
- 启动时的静默对账沿用现有 `ForceOnlineLicenseSync()`（仅付费）；**注意其 `force=true` 完全绕过节流，即启动路径每次注册不节流**，12 小时节流只作用于后台 sync（`license.go:352-359`）。

#### 4.1.1 启动时请求序列（现状与目标，合一方案，用户已确认）

**现状**（Go 侧 `PrecomputeDeviceFingerprints`，hardware.go:201-269）：

- 付费用户（本地有 .lic）：离线 `VerifyLocalLicense()`（无 HTTP）→ 有网则 `ForceOnlineLicenseSync()` → **仅 1 个 HTTP 请求 `POST /api/v1/verify`**（license.go:362），体为 `{license_code, uuid_hash, cpu_hash, disk_hash}`；无网则 7 天租约内离线可用。更新检查由 GUI 定时器触发、不属启动路径。**无其他启动请求**。
- 免费用户：启动时**零请求**（无 .lic、无 verify）。

**目标（合一）**：启动路径每用户每启动**至多 1 个 license 请求**。

| 用户 | 启动请求 | 作用 |
|---|---|---|
| 付费 | `POST /api/v1/verify`（唯一） | 授权对账 + 续租约 + **顺带活跃登记**（服务端同步刷新 `device_registry.last_seen_at/last_ip/GeoIP`，5 分钟写防抖）+ **回写权威 device_id** |
| 免费 | `POST /api/v1/device/register`（唯一） | 匿名设备登记 + 下发 device_id + 活跃上报；失败静默（fail-open） |

- **两个请求都 fail-open**：网络失败/被限频/黑名单均静默忽略，不弹窗、不阻断使用。黑名单只拦截 activate/verify/register 的**服务端写入**，不阻止本机已签发权益离线使用。
- 免费用户不调 verify（无 license_code）；付费用户不单独调 register（活跃登记已由 verify 顺带完成）。`register` 端点实际主要服务免费用户；付费设备的 registry 行由 `activate` 内联注册建立、之后靠 verify 顺带刷新。
- **请求体/响应契约变化**：
  - verify 请求体不变（license_code + 三指纹）；**邮箱、device_id 不进 verify 请求**——邮箱是账户层因子，device_id 是展示层因子，均不参与运行时判定；
  - verify 响应新增 `device_id`（权威值，客户端持久化到 .lic 覆盖本地被改值）。M2 起 device_id 进 verify 签名载荷；M1 期间先以普通字段返回。**当前 verify 响应还缺三指纹回显（契约漂移，见附录 D-8），M1 一并修正**；
  - register 请求体 `{uuid_hash, cpu_hash, disk_hash, app_version, lang}`，可选带 `license_code`（付费未内联场景识别付费身份并置 `tier_label=paid`）。

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
  last_seen_at  TEXT,                               -- 最近一次应用启动/活跃时间
  last_ip       TEXT,
  ip_country    TEXT,
  city          TEXT,
  region        TEXT,
  latitude      REAL,
  longitude     REAL,
  app_version   TEXT
);
-- 索引：CREATE INDEX idx_registry_live ON device_registry(tier_label, last_seen_at);
-- 索引：uuid_hash / cpu_hash / disk_hash 各自建索引（供粗筛 OR 等值查询）
```

> 说明：早先考虑过"免费/付费分表"，已否决。统一表 + `tier_label` 过滤即可避免免费流量污染授权口径（聚合查询按 tier 过滤），分表反而让"同一台设备先免费后付费"的升级路径（需更新 device_id 关联）变得复杂。
>
> device_id 仅是主键标签，不承载授权判定；同一指纹集合并为一行（克隆机共享一行）。

#### 性能与存储防护策略：

1. **Workers 端 5 分钟写防抖 (Write Debouncing)**：
   应用/CLI 在短时间内可能被频繁多次启动。为防止高频请求引发 SQL `UPDATE` 导致 SQLite/D1 锁锁竞争与资源浪费，Workers 对 `last_seen_at` 列做写防抖：若 `now() - last_seen_at < 5 minutes`，直接返回内存响应，跳过 D1 写事务落盘。
2. **Free 设备数据保留，不设 TTL 清扫**：
   大屏活跃查询是 `last_seen_at >= now - window` 的条件过滤，配合 `idx_registry_live` 索引，死数据不进扫描范围、不影响渲染；宽表一行一设备，行数 = 去重设备数（有界），非事件数。故 Free 死数据**保留沉淀**，不删除——历史活跃可留作长期分析，且**消除"付费设备被 TTL 误删"的风险**。增长由 register 限频（见 5.4）兜底。

#### 4.2.1 数据库架构全景与表功能统计（D1 全量清单）

底层数据模型清晰解耦为**两大核心域**与**中间绑定/风控表**：
1. **【购买与账户域】（账户 & 授权码套件）**：关注“谁买的、买了几个名额、邮箱是什么、退没退款”。
2. **【设备与硬件域】（设备与运行基本信息套件）**：关注“哪台设备在用、硬件指纹是什么、随机设备码 device_id 是什么、什么时候在哪个 IP 启动了”。
3. **【关联与解绑】**：激活时在 `activations` 建立关联；解绑时销毁解绑关系，**购买账户不变，设备本身的信息沉淀也不变**。

Cloudflare D1 数据库当前实际在用的全量 **8 张**数据表清单如下（`device_registry` 为**计划新增**，不在现存 8 张之内；初稿把 `device_registry` 计入"实际在用"且漏列 `system_error_logs`，已修正）：

| 表名 (Table Name) | 数据所属域 | 核心字段与作用描述 |
|---|---|---|
| **`licenses`** | 购买/账户域 | **授权码主表**：存储授权码状态 `status`、购买者邮箱 `buyer_email`、Tier (PLUS/PRO)、绑定名额上限 `max_devices`、Paddle 交易单号等。 |
| **`device_registry`** *(新增)* | 设备/硬件域 | **设备统一注册表**：存储随机派发的 `device_id` (PK)、硬件指纹、`tier_label` (free/paid)、首次注册时间、最近启动时间 `last_seen_at`、边缘 GeoIP 地理位置等。 |
| **`activations`** | 关联/绑定域 | **激活记录表**：记录某张授权码绑定了哪个 `device_id` 及激活时的硬件指纹与网络 IP。 |
| **`unbind_records`** | 审计与解绑控额 | **解绑历史表**：记录设备解绑时间，用于执行“365 天内最多解绑 4 次 (`MAX_YEARLY_UNBINDS = 4`)”的风控规则。 |
| **`manual_blacklist`** | 安全风控域 | **黑名单表**：存储管理员手动封禁或系统自动标记的违规黑名单（支持按 `email` 或 `device_id` 封禁）。 |
| **`verification_codes`** | 门户/发信域 | **验证码表**：存储用户登录自服务门户 (Portal) 或结账前的邮箱验证码，带 60s 发信防刷限频。 |
| **`user_sessions`** | 门户鉴权域 | **登录 Session 表**：存储用户在许可证自服务门户 (Portal) 无密码登录后的 24h Session Token。 |
| **`admin_audit_logs`** | 运维审计域 | **操作审计日志表**：审计留痕管理员高危操作（手动发码 `GENERATE`、吊销 `REVOKE`、解绑 `UNBIND`、清日志 `CLEAR_LOGS`）。 |
| **`system_error_logs`** | 运维审计域 | **系统错误日志表**：记录 Workers 运行错误/告警（level `ERROR`/`WARN`/`CRITICAL`），供排障审计。初稿遗漏，已补。 |

`activations` **不加** `last_seen_at`/`last_ip` 列（初稿提议作废）：活跃是**设备维度**，单源 `device_registry.last_seen_at`；activations 是**授权维度**（同一台设备可因多张授权码存在多行，`last_seen` 写哪行都不对），加活跃列只会双写漂移。activations 的网络列仍由现有幂等 ALTER 管理（`ensureActivationNetworkColumns` / `ensureDeviceIdColumn`，见 `cloudflare/eqt-drm-api/src/utils/auth.ts:29-57`）。

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
2. 只有**新激活**才写这些列（`drm.ts:290`），已激活设备的重复激活不刷新网络元数据——**付费设备由 verify 顺带刷新 `last_seen_at/last_ip/lat/lng`，免费设备由 register 刷新，不能沿用 activate 仅新激活写库的时机**（见 4.1.1）。
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

> 定位修正：在 §3.6.1 授权职责拆分模型下，不改指纹的克隆机被 `max_devices` 天然合并免疫，不产生额外授权收益（克隆 + 伪造指纹则已落入"指纹伪造无解"的边界，见 5.6）。**多 IP/频率检测不再是防克隆的必需品**，降级为可选运营告警，价值在于发现共号/异地使用等滥用信号，不承诺阻断。

1. **多 IP 检测**：同一 device_id 在滑动 24h 内出现 ≥3 个不同 IP 或 ≥2 个国家 → 标记 `SUSPECT` 并写审计日志（`admin_audit_logs`，action=`DEVICE_SUSPECT`）；
2. **频率检测**：同一 device_id 注册/激活/对账频率超过阈值（如 1 小时内 > 10 次，或 1 分钟内 > 3 次）→ 临时限流（429）；
3. **二次确认转黑名单**：可疑标记叠加（多 IP + 高频）或管理员确认后，写入现有 `manual_blacklist`（`kind='device'`，已有 admin 管理界面可直接复用）；
4. 黑名单命中在 `checkout`（邮箱门禁）、`register/activate/verify` 四处统一拦截。实际拦截点现状与精确语义见 5.4.1。

**落地实现（register 路由限频，随 M1 一起做，不拖到 M4）**：

- **计数存储**：Workers 无内置速率限制，计数需放 KV 或 D1——KV 最终一致性足够（限频计数略滞后可接受），D1 高频写有写放大/计费问题，建议 KV；
- **限频 key**：用 `IP + 指纹哈希` 组合（纯 IP 会误伤 NAT/共享出口，纯指纹可被伪造）；
- **副作用安全**：免费注册失败不阻断任何功能（无网也跳过），故对 register 限频是低风险动作；
- **边界**：仅缓解 C-1 免费侧口径失真，不能根治——伪造者可换 IP + 换指纹重刷；免费侧定位仍为"抽样展示"，勿将免费数据质量当安全目标。

#### 5.4.1 黑名单与退款行为（现状确认，2026-08-03）

对 §5.4 与用户关切的事实核对（`blacklist.ts` / `paddle.ts` 实证）：

- **退款不写黑名单**：退款/拒付只把对应 license 行置 `status='revoked'`（`paddle.ts` revokeByTxnSql / revokeBySubSql / portal refund），**不**插入 `manual_blacklist`。退款买家可以再买、再激活。
- **未兑换（未激活）的退款放行**：自动滥用窗口只统计"曾被激活过"的撤销（`wasEverActivated`：act_n>0 或 unbind_n>0，blacklist.ts:93-97）。**从未激活就退款的 license 不计入滥用计数**——用户印象正确。
- **自动滥用窗口**：365 天滚动窗口内，**≥3 次**"purchase 来源 + 曾被激活 + 退款/拒付撤销"（`MAX_YEARLY_ABUSIVE_REFUNDS=3`，types.ts:88）才触发邮箱（Gate A）或设备（Gate B，指纹 3选2）封禁。**不是"1 次退款即封一年"**；触发后 activate/verify/checkout 被拦，窗口随 365 天滚动自然失效。
- **手动黑名单**（admin 写入 `manual_blacklist`，kind=`email`/`device`，active=1）：立即生效 + 无限期（直到 admin 解禁），是唯一"即刻封禁"手段。
- **拦截点**：checkout/send-code（邮箱门禁，portal.ts:95、auth.ts:95/159）、activate（drm.ts:190）、verify（drm.ts:427）；新方案下 register 端点同步拦截。均只拦"服务端写入/换绑"，不拦本机已签发权益的离线使用。
- **黑名单按哪个键**：授权判定与黑名单以**指纹**为准（可靠键），`device_id` 仅作人工检索/辅助——免费 device_id 可伪造、换 ID 即绕过，不作为拦截依据（manual_blacklist 的 kind=device 行可按指纹三列命中，见 blacklist.ts:163-199）。

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

### 5.7 离线风控与 7 天租约防伪造闭环

为确保系统在离线断网、时钟调整与响应伪造攻击下的工业级安全性，对离线校验机制做了以下精确界定：

1. **防回拨容忍度（现状 10 分钟；"30 分钟~1 小时"为提案，非现状）**：
   现状（license.go:203）为 **10 分钟**倒流容忍，超过即 `SetClockTampered(true)` 并发起功能锁定。10 分钟可能因 BIOS 电池衰减、NTP 未同步、跨时区出差误伤合法用户。**提案**：放宽为对 30 分钟~1 小时以内的微小时钟抖动静默容忍，仅当系统时间倒流超过 1 小时才判定 `ClockTampered`。
   ⚠️ **取舍**：放宽容忍会同步削弱"冻结时间"攻击的检测强度（把时间调到昨天、倒流不足 1 小时即不再触发锁定）。若两者都要，实现上应把"容忍窗口"与"单向步进锁"分开：容忍窗口只作用于 NTP 级抖动，冻结检测仍用 `LastSeenLocalTime` 严格单向步进。这是实现时必须明确的取舍，不是免费午餐。
2. **断网环境下的 SSOT 与 Ed25519 不可伪造性**：
   断网无网时，`.lic` 数字证书是本地唯一的可信源 (SSOT)。证书安全性依靠 **Ed25519 非对称数字签名**保障：云端持有私钥签发证书，客户端公钥校验。没有云端私钥，在纯软件环境下任何篡改（如修改 `tier` 或 `expires_at`）均会在公钥验签时数学返回失败，绝对无法伪造。
3. **断网 7 天租约与“冻结时间”对抗机制**：
   为防止攻击者在拔掉网线后通过冻结系统时间来实现脱机无限使用，客户端采用**双重时间锚点**（已加密的权威对账时间 `LastOnlineSyncTime` 与单向递增的本地运行时间 `LastSeenLocalTime = max(LastSeenLocalTime, time.Now())`）：
   - **冻结时间攻击**：若攻击者每次启动都把时间调回同一天，客户端检测到 `time.Now() < LastSeenLocalTime`（时间倒流），触发回拨锁定；
   - **微调时间攻击**：若攻击者为了避开倒流锁而每次启动往后调一小段时间，系统时间很快就会越过 `LastOnlineSyncTime + 7 天`，租约自然过期失效。
4. **全闭环 5 大安全防线总结**：
   - **跨机移植防线**：证书内置指纹 + 本地 `VerifyFingerprint` 二次校验，防止拷贝证书冒用；
   - **时钟回拨防线**：30分~1小时容忍 + 单向落盘步进锁，阻断时间倒流；
   - **响应伪造防线**：服务端私钥对对账签名签回（`VerifySignature`），客户端公钥强校验，防 MITM 伪造 200 OK；
   - **脱机逃逸防线**：收紧 7 天租约窗口，检测到网络启动时强制执行在线对账；
   - **界面抢权防线**：Go 后端校验结果为唯一 SSOT，严格禁止依赖前端 `localStorage` 抢权。

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

### 6.6 订阅续期与手动续期能力

**现状（已实现，非本报告新增）**：续期完全由 Paddle webhook 驱动、按 `subscription_id` 自动扩展，核心原则是**"一订阅一激活码（Single Code Per Subscription）"**（`docs/payment/subscription-renewal-and-refund-workflow.md`）：

- 年付订阅续费：webhook 按 `paddle_subscription_id` 找到唯一 license_code → `expires_at = MAX(now, 原expires) + 365 天`，`paddle_transaction_id` 指向最新期次（paddle.ts:157-212）。**续费不换码**。
- 一个邮箱买多个年付订阅 → 多个 subscription_id → 多个码**各自独立自动续费**，互不干扰。
- 终身版无 `paddle_subscription_id`，`expires_at='LIFETIME'` 永不过期，不参与续费。
- Portal 现无任何续期/加时长动作（只有 send-code / verify-code / licenses / unbind-device / refund / toggle-auto-renew / cancel-subscription / invoice-link，portal.ts 端点清单见附录）。

**需求（用户确认：需要手动续期能力）**——Portal 增加"为指定激活码续期/加时长"：

场景：用户关闭自动续费后想主动续、或持有某码想加时长时，可在 Portal 选择**指定激活码**购买对应 tier 时长，权益**合并到该码**（延续"续费同码"原则，不铸造新码）。

设计要点：

1. **目标码上下文**：Portal 续期入口必须携带 `target_license_code`（用户选择的目标码）+ `user_email`，经 Paddle checkout 的 `passthrough` 字段随支付回调带回，否则 webhook 无法知道该给哪个码续期；
2. **新增 `renewal_requests` 表**（或复用 pending 表）：`user_email, target_license_code, price_id, paddle_transaction_id, status, created_at`，供 webhook 侧将"新支付"绑定到"目标码"；
3. **paddle.ts webhook 分支**：`transaction.completed` 时若 `passthrough` 含 `target_license_code` → **不走铸造**，改为扩展目标码 `expires_at`（沿用现有扩展逻辑）+ 更新 `paddle_transaction_id` + 更新 `renewal_requests.status`；
4. **约束**：仅同 tier 可合并（PLUS 续 PLUS）；目标码必须是 `buyer_email` 归属用户的 active 码（防给他人码续期）；目标码为 `LIFETIME` 时拒绝（终身不可续）；~~已有同 tier 终身权益时对"新购终身"拒绝（现有 `lifetime_already_owned` 政策）~~——**已作废**：业务模型允许一邮箱多码、可重复购买终身（见 D-11/D-13），`lifetime_already_owned` 检查实际作用域与新模型矛盾，处置见 D-13；
5. **与设备注册的关系**：续期只改 `expires_at`，不动 device_id/device_registry，不影响本报告主体；但 **M2 签名载荷改动后，续期后的目标码需在下一次 verify 重新签发**（客户端下次启动 verify 自然拿到新 `expires_at` 的新签名 .lic，无需额外动作）；
6. **不纳入**：多码 entitlement 合并（"多码→单权益"时间轴合并，`docs/payment/license-source-and-refund-policy.md:270` 标为 P2 待办）不在本报告范围，手动续期只做"单码加时长"。

### 6.7 年付 → 终身升级（用户确认，2026-08-03）

**业务模型（已确认）**：一邮箱可持多个激活码（无数量上限）；可续年付、可购新码（年付/终身皆可）；"可重复购买终身"成立（铸造路径不拦，见 D-11）。在该模型下新增"年付→终身升级"：

1. **定价**：**全额支付终身价**（复用 `PRICE_LIFETIME_ID`），不做差价折算、无 prorated——定价最简单，账目清晰。
2. **升级语义（状态隔离）**：不吞剩余年付。目标码**不在退款期** → 年付码继续走完 `expires_at`，终身权益在**该码年付到期后自动生效**；目标码**在退款期** → 不支持升级，只能先退款、再购终身。年付与终身是两笔独立交易，退款各自独立（年付退款退年付、终身退款退终身）。
3. **待生效存储**：新增 `license_upgrades` 表（`user_email, target_license_code, lifetime_txn_id, purchased_at, effective_at, status`）。webhook 带 `targetCode` 的终身交易走"待生效升级"；无 `targetCode` 的终身交易仍是正常铸造（立即终身），两路径天然区分。
4. **惰性生效（不做 cron）**：verify/activate 时判断 `effective_at <= now && expires_at != 'LIFETIME'` → 条件更新 `expires_at='LIFETIME', duration_days=NULL` 后返回 LIFETIME 签名；竞态用 `WHERE expires_at != 'LIFETIME'` 幂等。客户端下次启动自然收敛终身证书，Go 侧无需改动。
5. **生效时间快照**：`effective_at` = 升级时刻年付到期日快照，不随后续续费顺延。
6. **退款期判定**：基于**最近一期交易**的购买时间（勿用 license.created_at，连续续费会误判），窗口天数与 Paddle 产品设置对齐（需配置常量，可能需补交易时间列）。
7. **升级后停 auto-renew（防双重扣款）**：升级完成时取消该码 Paddle 订阅自动续费 + 置 `auto_renew=0`——否则用户付了终身全价还会被扣下一年年付，是本功能最易爆雷点。
8. **终身退款撤回升级**：refund webhook（paddle.ts:376）按 `lifetime_txn_id` 定位待生效记录并取消，年付码保持年付。
9. **Portal 展示**：待生效期间显示"终身权益已购买，将于 YYYY-MM-DD 生效"，避免"付了终身还是年付"的困惑。
10. **`lifetime_already_owned` 处置**：既有两处检查与新模型矛盾（portal 预检过宽、webhook 半吊子），处置见 D-13；铸造路径不查正确保留。

---

## 7. 建议实施顺序（里程碑）

| 里程碑 | 内容 |
| --- | --- |
| M1 | D1 新增 `device_registry` 表（单一 `last_seen_at`，含 `email`/`license_code` 列，无 TTL）+ `register` 端点（粗筛+精筛指纹匹配、IP+指纹组合限频、5 分钟写防抖，见 5.4）+ `activate` 内联注册（并发事务 + 幂等，见 C-2）+ 客户端启动序列改造（付费 verify 顺带活跃登记与 device_id 回写、免费 register，见 4.1.1）+ **verify 响应契约修正（回显三指纹 + 新增 device_id，见附录 D-8）**；0 分量付费拒绝；遥测开关与隐私说明就绪；**开发期清库重置 `activations`/`device_registry`（用户已确认现有数据可弃，见 6.2）** |
| M2 | device_id 纳入证书/对账签名载荷 + 客户端双版本验签 + 存量强制重签（**联动 paddle.ts 铸造/吊销/续费路径**）+ **手动续期能力（Portal 指定码续期，见 6.6）** + **年付→终身升级（全额支付、待生效、退款期隔离，见 6.7）** |
| M3 | `/admin/devices/live`（区间参数）+ 大屏付费/免费双色与活跃口径 + 抛物线开关（活跃数据单源 `device_registry.last_seen_at`，**activations 不加活跃列**） |
| M4 | **可选**运营告警（同 ID 多国家）+ 频率限流 + 证书固定；**不**做自动黑名单，异常检测不作为授权阻断（克隆已免疫，见 3.6.1/5.4） |

---

## 8. 总结

当前本地设备码计算不安全（低熵、可复现、自报无校验）。改为服务端计算/签发后，授权职责拆分为：**指纹（运行时身份）+ max_devices（运行时名额）** 承载判定，**邮箱（账户层）与 device_id（展示层）不参与运行时校验**。免费用户不强制、联网即匿名注册（启动 1 个 register 请求）；付费兑换时云端内联注册并签名绑定；**启动路径每用户每启动至多 1 个 license 请求**——付费为 verify（顺带活跃登记与 device_id 回写）、免费为 register（见 4.1.1）。**复制的虚拟机无需专门对抗**（纯克隆合并占一额；指纹伪造本就无解，防克隆无增量收益，见 3.6.1）；异常检测降级为可选运营告警。大屏以付费/免费双色展示区间活跃设备（默认最近 1h，数据单源 `device_registry`）。防修改依赖签名与服务端权威化，防伪造依靠限流、黑名单等低成本手段抬高成本，并明确纯软件 DRM 的边界。订阅续期现状为"一订阅一码自动续费"，新增 Portal 手动续期能力（见 6.6）；退款不封邮箱、未激活退款放行（见 5.4.1）。

---

## 附：代码核对与审阅意见（2026-08-02）

> 本节是对上文的逐条代码实证核对（Go 侧 + Cloudflare 侧），以及针对审阅反馈的决策记录。**结论：报告事实基础扎实（20 条 claims 中 17 条 CONFIRMED），核心方向正确；已按审阅意见修正正文，并在此留档。** ⚠️ 该评估略有乐观：A 表核对范围未覆盖 schema 全表清单与 §5.7，这两处初稿有事实错误（表清单漏 `system_error_logs`、时钟容忍把提案当现状），已在 2026-08-03 复核中修正，见附录 D。

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
7. **克隆免疫 + 三因子模型**：复制的虚拟机被授权名额天然免疫（共享指纹 → 共享 device_id → 只占一个名额），无需专门对抗；授权安全收敛为 device_id + 邮箱 + max_devices 三因子；指纹匹配改为"共享分量一致"规则（废弃"3 选 2"表述）；多 IP/异常检测降级为可选运营告警；已写入 3.6.1/4.1/5.4。> ⚠️ 2026-08-03 修正："三因子"表述改为"授权职责拆分"（指纹+max_devices 是运行时要件，邮箱/device_id 是账户/展示层因子不参与 verify）；"克隆免疫"边界收窄（纯克隆合并免疫，克隆+伪造指纹仍可多占名额）；见 3.6.1 与附录 D。

### C. 遗留风险（不属于上述决策，需在实施时再评估）

- **C-1 免费侧口径失真**：免费注册无成本、无授权码绑定，伪造者可无限注册污染免费计数；有遥测开关则免费侧数据质量进一步下降。免费侧定位为"抽样展示"，免费设备注册需配合限频（register 路由 IP+指纹组合限频，落地见 5.4；**仅缓解、不能根治**）。
- **C-2 Paddle 衔接**：`device_id` 进签名载荷的改动落在 `drm.ts` activate/verify，与 `paddle.ts` 铸造流程强耦合；webhook 铸造的激活码在首次 activate 前没有指纹。**解法：activate 端点内联注册**（注册/复用 device_id → 写 activations → 签名下发三步原子完成，见 4.1），不依赖"register 先于 activate"的先后约束。两个实现约束：① **并发超卖**——同一激活码被两台设备同时 activate 时，须用 D1 事务或条件更新（`WHERE 已绑数量 < max_devices`）保证不超卖；② **幂等**——客户端重发 activate 须按 `(license_code, 指纹)` 幂等，防重试多扣名额。
- **C-3 多 IP 告警误伤**：移动办公/VPN 用户会被"同 ID 多 IP"标记；因克隆已免疫、检测降级为可选告警（见 5.4），仅作运营参考，不做自动黑名单。
- **C-4 隐私合规**：IP/经纬度登记需纳入隐私说明，遥测开关（见 5.5）应作为 M1 就绪项而非后续项。

---

### D. 复核记录（2026-08-03）

按用户反馈与独立代码核对（Go + Cloudflare 双侧实证），本节修正/补充上文，均为已确认决策或事实：

1. **开发期数据可弃**（用户确认）：`activations` 现有数据可直接清库，无需回填迁移（对应 2.a）。§6.2 维持。
2. **启动请求序列——合一方案**（用户确认）：付费启动 = 1 个 verify（顺带活跃登记 + device_id 回写）；免费启动 = 1 个 register。每用户每启动至多 1 个 license 请求，见 4.1.1。
3. **activations 不加 last_seen_at/last_ip**：活跃单源 `device_registry`（§4.2、M3）。初稿的 activations 加列提议作废。
4. **续期需要手动能力**（用户确认）：Portal 增加"为指定激活码续期/加时长"，见 6.6；现状"一订阅一码自动续费"已闭环、多码 entitlement 合并仍为 P2 待办。
5. **黑名单/退款确认**：退款不封邮箱、未激活退款放行、自动窗口 = 365 天滚动 ≥3 次"曾激活的退款吊销"、手动黑名单立即且无限期，拦截点在 checkout/activate/verify（+新 register），见 5.4.1。
6. **PRO 不考虑**（用户确认）：Paddle 铸造路径硬编码 `tier='PLUS'`（paddle.ts:137），与当前产品线（PLUS Lifetime / PLUS Yearly 均属 PLUS tier，区别在 `expires_at` 与 `paddle_subscription_id`）一致，属**已知限制**；schema 中 `'PLUS' | 'PRO'` 的 PRO 暂不展开。若未来卖 PRO 需新增 PRO 价格 ID + tier 分支。
7. **§5.7 时钟容忍**：现状 10 分钟（license.go:203），"30 分钟~1 小时容忍"是**提案**非现状，已修正（§5.7.1），并记录与"冻结时间"检测强度的取舍。
8. **verify 契约漂移**（现存问题，非本报告引入，M1 一并修）：Go 侧 `doOnlineLicenseSync` 解析响应中的 `uuid_hash/cpu_hash/disk_hash` 并拷入 updatedCert（license.go:422-424），但 drm.ts:505-518 的 verify 响应**不含这三字段**，线上 sync 后 `VerifyLicenseSignature`/`VerifySyncSignature` 验签会失败（服务端用请求里的非空指纹签名）。测试 mock 回显了这些字段所以 Go 测试通过。M1 修正响应契约（回显三指纹 + 新增 `device_id`）。
9. **D1 表清单**：当前 8 张 = licenses / activations / verification_codes / user_sessions / unbind_records / system_error_logs / admin_audit_logs / manual_blacklist；`device_registry` 为计划新增（§4.2.1 已补 system_error_logs、标注 device_registry 新增）。
10. **Paddle 铸造细节**：终身与年付均 `tier='PLUS'`、`max_devices=2`（paddle.ts:137,242）；若已有 license 是 LIFETIME，年付续费时保留 `"LIFETIME"` 不降级（paddle.ts:170-172）。

11. **业务模型确认（2026-08-03）**：一邮箱可持多码、无数量上限；可续年付、可购新码（年付/终身皆可）；**"可重复购买终身"成立** → 铸造路径不查 `lifetime_already_owned` 是**正确**的（此前审阅曾建议铸造路径加检查，撤回）。§6.6 第 4 条"新购终身拒绝"表述已随之修订（删除线作废）。

12. **M2 续期/签名代码审阅留档（2026-08-03，均已修复）**：
    - `drm.ts:648` verify 分支引用未声明 `device_id`（潜在 ReferenceError）→ 改用权威 `regResult.device_id`（§5.3 服务端权威），commit 280bff7；
    - 对账签名（`signature`）补入 device_id（§5.2）→ activate/verify 双侧 + Go `VerifySyncSignature` 双版本（V2 含 device_id、V1 回退），commit 280bff7；
    - Portal 免费直改库端点（`/user/license/renew`）→ 支付驱动 `/user/renew-checkout`（返回 passthrough，走 Paddle），commit 6f02e43；
    - LIFETIME 反向处理（终身被转限时）→ portal/webhook 双向拒绝 + `lifetime_cannot_renew` i18n，commit 6f02e43；
    - 手动续期 `duration_days` 漂移 + LIFETIME 升级未清 `duration_days`（verify 按 `now+duration_days` 覆盖）→ webhook 按 `matchedPriceId` 推导：LIFETIME 价置 `expires_at='LIFETIME'` 且 `duration_days=NULL`，commit 9d556bf/adebe42；
    - webhook 续期 SELECT 漏列 `duration_days`（`targetLic.duration_days` 恒 undefined，YEARLY 续期被静默清空）→ 补列 + `?? null`（**Option 1：保留原 `duration_days`**，与自动续期路径语义一致），commit adebe42。

13. **`lifetime_already_owned` 两处检查作用域不一致（待处置）**：
    - portal `/renew-checkout` 预检（已有同 tier 终身即拦所有 renew-checkout）→ **误拦**"终身+年付双码用户续年付"，且与"可重复买终身"矛盾 → 建议**移除**（或带 `price_id` 收窄，仅对终身价预检）；
    - webhook 只拦"已有终身 + LIFETIME 价升级"→ 想升级直接买新终身码即可绕开（铸造不查）→ 与模型矛盾，建议**移除**（若产品坚持"已持终身不可升级"才保留）；
    - 铸造路径不查 → **正确保留**（D-11）。

14. **年付→终身升级方案（用户确认，见 6.7）**：全额终身价、不吞剩余年付（状态隔离）、退款期内仅"退款+重购"、到期自动生效（惰性翻转、非 cron）、升级后停 auto-renew 防双重扣款、待生效存储 `license_upgrades`、终身退款撤回升级。
