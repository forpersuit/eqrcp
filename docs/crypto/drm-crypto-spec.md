# EQT DRM 授权密码学与数字签名规范 (DRM Cryptographic Specification)

> **📘 状态：生产现行密码学规范**
> 
> 本文档定义了 EQT 在付费套餐（Plus/Pro）授权校验、设备绑定防护与离线对账租约中所采用的**密码学算法、签名载荷格式与摘要防伪逻辑**。
>
> 关联文档：业务流程与交互见 [`docs/payment/drm-flow.md`](../payment/drm-flow.md)；密钥部署见 [`docs/admin/IMPORTANT_drm-secrets.md`](../admin/IMPORTANT_drm-secrets.md)。

---

## 一、密码学信任边界与算法选型

EQT 的授权校验设计遵循**离线可验、防破解注册机（Keygen）、公钥可信**的原则：

| 保护目标 | 算法 / 机制 | 说明 |
| :--- | :--- | :--- |
| **证书防伪造与签发** | **Ed25519** 非对称数字签名 | 仅服务端 Worker 保存私钥；客户端内置 32 字节公钥硬编码，离线只读验签 |
| **设备硬件防伪** | **SHA-256** 哈希摘要 + **3选2** 模糊匹配 | 原始设备指纹经清洗后哈希，防明文设备标识泄露并防跨机复制 |
| **在线对账租约** | **Ed25519** 动态时间戳签名 | 服务端颁发带时间戳的短命租约（7天），防长期离线逃逸 |
| **系统时钟防篡改** | 本地 XOR 混淆时间锁 | 校验本地运行时间戳，检测到回拨超过 10 分钟立即判定锁定 |

---

## 二、Ed25519 非对称签名体系

客户端拒绝任何对称密钥或本地明文配置文件标记。所有付费权益必须由合法的 Ed25519 签名证明。

### 2.1 密钥对管理
* **服务端私钥**：存储于 Cloudflare Worker (`eqt-drm-api`) 的 Secret 环境变量 `ED25519_PRIVATE_KEY` 中（64 字节十六进制或 Base64）。
* **客户端公钥**：硬编码在 Go 客户端源码 (`pkg/server/license.go`) 中：
  ```text
  08443678fe8bd16e3bc306db8a08b6ea1dcf3e8edeb413f655e106374bed43ac
  ```

### 2.2 双层签名规范

系统采用**长期证书签名**与**在线对账租约签名**双层保护：

#### 1. 长期证书签名 (Certificate Signature)
覆盖授权身份与基础配额，用于离线校验授权合法性。

* **载荷拼装格式**：
  ```text
  {license_code}|{tier}|{uuid_hash}|{cpu_hash}|{disk_hash}|{expires_at}|{max_devices}
  ```
* **验证字段**：对应 `.lic` 文件中的 `signature` 字段。
* **规则**：若载荷中任何字段（如篡改 `tier` 为 `PRO` 或修改到期时间）被修改，客户端基于公钥验签将立即失败。

#### 2. 在线对账租约签名 (Verify Signature)
覆盖最近一次成功联机对账的时间与授权绑定，防范长期不联网或私自封锁对账域名。

* **载荷拼装格式**：
  ```text
  OK|{license_code}|{uuid_hash}|{cpu_hash}|{disk_hash}|{last_online_sync_time}
  ```
* **验证字段**：对应 `.lic` 文件中的 `verify_signature` 字段。
* **规则**：`last_online_sync_time` 必须为 ISO 8601 UTC 时间。客户端要求该时间戳距当前本地时间不得超过 **7 天**。

---

## 三、加权硬件指纹 SHA-256 摘要算法

为防止授权证书被拷贝至其他机器使用，系统对硬件特征进行哈希摘要并做比对。

### 3.1 原始特征提取与清洗
提取三项核心硬件特征：
1. **主板 UUID** (`uuid`)：Windows 优先 CIM，Linux 优先 DMI UUID。
2. **CPU 序列号** (`cpu`)：处理器固有 ID / Serial。
3. **系统盘物理序列号** (`disk`)：磁盘物理固化序列号。

清洗规则：必须执行**小写化 (Lowercase)** 并**去除全部空白字符 (Trim)**。

### 3.2 SHA-256 摘要与空值防御
* **哈希计算**：对清洗后的原始特征做 `SHA-256` 得到 64 字符十六进制字符串（`uuid_hash`, `cpu_hash`, `disk_hash`）。
* **空值防呆规则**：
  * 若某个特征因为权限不足、虚拟机环境或 OEM 缺失返回空串 `""`、`unknown`、`none` 或通用占位符，其哈希值将被标记为不可用。
  * 强规则：**若比对双方任何一方字段为空，该字段直接判为不匹配**。
  * **3 选 2 校验**：至少要有 **2 项有效的非空指纹匹配**，客户端才认可该设备合法。防范因权限不足导致空字符串相互匹配的权限漏洞。

---

## 四、本地防篡改与时钟回拨检测

1. **时钟防回拨锁 (Clock Tampering)**：
   客户端在本地定期将当前最高已知时间戳经 XOR 掩码写回本地缓存（`last_seen_local_time`）。启动或本地校验时，若 `当前系统时间 < last_seen_local_time - 10分钟`，则触发 `ClockTampered` 标记，锁定付费功能并要求联机恢复。
2. **状态互相约束**：
   本地 `chat_usage.json` 与 `license.lic` 形成联动。若恶意修改 `chat_usage.json` 中的 `IsPaid` 标记，后台校验循环检测到缺失或匹配失败的 `.lic` 后会立即强制重置状态。

---

## 五、历史归纳与交叉索引

| 模块 | 说明 |
| :--- | :--- |
| [`docs/payment/drm-flow.md`](../payment/drm-flow.md) | 在线激活、对账轮询与 GUI 状态切换业务流 |
| [`docs/admin/IMPORTANT_drm-secrets.md`](../admin/IMPORTANT_drm-secrets.md) | Cloudflare Worker DRM Secret 生产环境变量表 |
| [`pkg/server/license.go`](../../pkg/server/license.go) | 客户端 Go 离线验签与硬件指纹校验核心代码 |
