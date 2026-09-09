# EQT 局域网 TLS 私钥零泄漏与设备专属 ACME 自动化架构设计方案

> **文档标识**：`docs/mechanism/lan-tls-zero-leak-acme-architecture.md`  
> **状态**：📘 核心安全架构与演进工程蓝图（Architecture Blueprint）  
> **面向对象**：核心开发团队、系统架构师、安全与密码学审计人员  
> **基线分支**：`master`（设计演进预演）  
> **关联技术**：[`pkg/cert`](file:///home/yelon/develop/me/eqrcp/pkg/cert/cert.go), [`cmd/eqt-dns`](file:///home/yelon/develop/me/eqrcp/cmd/eqt-dns/main.go), [`pkg/server/hardware.go`](file:///home/yelon/develop/me/eqrcp/pkg/server/hardware.go), [`.agents/skills/eqt-lan-tls/SKILL.md`](file:///home/yelon/develop/me/eqrcp/.agents/skills/eqt-lan-tls/SKILL.md)  

---

## 一、第一性原理与核心问题定义（First Principles & Problem Statement）

### 1. 为什么“私钥共享与自管理”是不可忽视的安全隐患？

在现代公钥基础设施（WebPKI）中，**“公钥公开、私钥独占”**是非对称加密体系的立身之本。

在 EQT 前期落地的 LAN-TLS 回环方案中（参见 [`docs/plan/lan-tls-loopback-architecture-design.md`](file:///home/yelon/develop/me/eqrcp/docs/plan/lan-tls-loopback-architecture-design.md)），为了解决移动端 iOS Safari 纯 HTTP 传输 2GB+ 大文件必然面临的 1.5GB OOM 闪退，系统引入了权威 DNS 回环映射 + `*.direct.eqt.net.im` 官方通配符证书。

然而，在该方案的过渡期实现中，**通配符证书对应的私钥（`privkey.pem`）由云端统一签发，并分发存放在用户的本地机器缓存中（`~/.config/eqt/certs/`）**。从密码学严密性与工程运维视角审视，这带来了三个本质隐患：

1. **私钥退化为“对称共享秘密”（Shared Secret）**：
   - 当多个用户、多台设备共享同一把 `*.direct.eqt.net.im` 通配符私钥时，任何拥有该私钥的用户（或恶意提取者），在同局域网环境下均具备对其他用户进行**主动中间人攻击（Active MITM）的能力**（通过 ARP/DNS 欺骗拦截流量，利用合法私钥伪装目标服务器，手机 Safari 毫无感知且安全绿锁亮起）；
2. **爆炸半径极大（Blast Radius / 连坐吊销）**：
   - 通配符私钥存在于不可控的客户端终端磁盘上。一旦任一用户的私钥因中木马、逆向提取或误传到公共网络，被公开扫描器捕获后，Let's Encrypt 会立即对该证书执行**全网吊销（CRL / OCSP Revocation）**，导致全球所有正常运行的 EQT 客户端 TLS 瞬间集体失效；
3. **运维割裂与大众化阻碍**：
   - 普通终端用户无法理解也不可能通过执行脚本（如 [`scripts/sync-certs-from-vps.sh`](file:///home/yelon/develop/me/eqrcp/scripts/sync-certs-from-vps.sh)）来手动配置私钥，导致干净环境默认只能降级运行在纯 HTTP 下。

### 2. 为什么淘汰 RFC 9345（Delegated Credentials），坚定选择 Tailscale 路线？

在探索消除“私钥共享”的技术路线时，工业界有两种代表性思路：

```text
[路线选型分水岭]
  ├── 路线 1: RFC 9345 短效委派凭证 (Delegated Credentials)
  │     ├── 致命短板: 移动端 iOS Safari 底层 WebKit 根本不支持 delegated_credentials 扩展！
  │     ├── 协议缺陷: Go 官方标准库 crypto/tls 原生未实现，需魔改 TLS 协议栈；
  │     ├── CA 限制: Let's Encrypt 公共生产环境不开放 delegation_usage X.509 扩展；
  │     └── 结论: 理论先进但在移动端“免装 App 原生浏览器扫码”场景下为死路。
  │
  └── 路线 2: 本地私钥自生成 + 云端代理 ACME 自动化 (Tailscale 工业级路线) ★★★
        ├── 核心特征: 私钥在设备本地安全生成，终身永不出机；
        ├── 兼容性: 100% 采用标准 X.509 证书与标准 TLS 1.2/1.3，所有浏览器原生信任；
        ├── 协议栈: 100% 纯 Go 标准库与 RFC 8555 ACME 规范，静态编译零 CGo 依赖；
        └── 结论: 兼具零私钥扩散、零中间人隐患与全自动无感体验的唯一终极解。
```

### 3. 必须坚守的物理硬性指标
任何架构演进不得违背以下既有第一性原则：
1. **手机端绝对零门槛**：无需安装任何 App，无需手动导入根证书，原生浏览器（iOS Safari、Android Chrome）扫码直连，地址栏必须呈现官方安全绿锁 🔒；
2. **流量物理内网直连**：文件数据 100% 局域网传输，跑满千兆网线/Wi-Fi 6（80MB/s~120MB/s+），严禁将文件数据中继到外网；
3. **大文件零 OOM**：100GB 任意大文件由内核 C++ 硬件解密、原生流式写盘，零前端内存膨胀；
4. **私钥零泄露**：私钥在设备本地生成，云端服务器与其他设备永远无法获取该私钥；
5. **单机单私钥单子域**：每台设备拥有专属子域与独立证书，彻底免疫同网内持有私钥者的主动中间人攻击。

---

## 二、总体架构与核心时序（Architecture & Sequence Flow）

系统整体由四个核心实体构成：
1. **EQT 桌面终端（Device Agent）**：运行在用户本地 PC 上的 Go 服务，负责私钥生成、CSR 发起与本地 HTTPS 托管；
2. **EQT 云端证书代理网关（ACME Proxy Gateway）**：部署在 Cloudflare Worker 或受信任边缘节点，负责设备认证（结合 DRM 硬件指纹）与 Let's Encrypt ACME 事务编排；
3. **自建双机权威 DNS（`cmd/eqt-dns`）**：负责无状态局域网 IP 回环解析，以及精准应答 ACME DNS-01 TXT 记录；
4. **公共 CA（Let's Encrypt）**：负责颁发全球公信的 X.509 证书。

### 1. 网络架构全景图

```text
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│                                     云端权威与代理基础设施                                  │
│                                                                                           │
│   ┌───────────────────────────┐         HTTP API         ┌────────────────────────────┐   │
│   │  EQT ACME 代理网关 (Worker)│ ──────────────────────► │  自建双机权威 DNS (eqt-dns)  │   │
│   │  - 校验设备 DRM 硬件签名   │   (写入 DNS-01 TXT)     │  - ns1 (128.241.227.181)   │   │
│   │  - 代理 RFC 8555 ACME 流程│                          │  - ns2 (103.232.92.220)    │   │
│   └─────────────┬─────────────┘                          └─────────────┬──────────────┘   │
│                 │ (ACME 交互)                                          │ (DNS-01 验证)    │
│                 ▼                                                      ▼                  │
│   ┌───────────────────────────────────────────────────────────────────────────────────┐   │
│   │                        Let's Encrypt 公共 CA (ACME Server)                         │   │
│   └───────────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────▲─────────────────────────────────────────────────┘
                                          │ (HTTPS API 提交 CSR / 下发证书公钥链)
                                          │
┌─────────────────────────────────────────┴─────────────────────────────────────────────────┐
│                                 用户本地 PC (EQT 客户端)                                   │
│                                                                                           │
│   1. [本地独立生钥] crypto/ecdsa 本地生成 ECDSA P-256 专属私钥 (永不出机，存入受限目录)     │
│   2. [组装硬件 CSR] 包含设备专属域名 <node-id>.direct.eqt.net.im 与 Ed25519 硬件指纹签名    │
│   3. [自动静默更新] 后台拉取 fullchain.pem 写入缓存，完成公信证书闭环                       │
│                                                                                           │
│   ┌───────────────────────────────────────────────────────────────────────────────────┐   │
│   │                              局域网内运行 HTTPS 服务                               │   │
│   │   - 绑定物理 IP: 192.168.0.201:port                                               │   │
│   │   - 挂载: 本地专属私钥 + 专属公钥证书链                                            │   │
│   │   - 二维码直出: https://192-168-0-201.<node-id>.direct.eqt.net.im:port/...         │   │
│   └────────────────────────────────────────┬──────────────────────────────────────────┘   │
└────────────────────────────────────────────┼──────────────────────────────────────────────┘
                                             │
                       [局域网千兆物理传输 (TLS 1.3 AES-GCM)]
                                             ▼
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│                                    移动端 (iOS Safari)                                    │
│  - 扫码访问: 原生解析权威 DNS，获取局域网直连 IP                                           │
│  - 证书匹配: *.direct 或专属 <node-id>.direct 原生合法，地址栏呈现官方安全绿锁 🔒          │
│  - 数据写盘: 物理局域网高速传输，内核 C++ 原生流式落地，零 OOM 崩溃                         │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2. 证书生命周期核心交互时序图

```mermaid
sequenceDiagram
    autonumber
    participant Client as 本地 EQT 客户端
    participant Proxy as 云端 ACME Proxy
    participant DNS as 自建双机权威 DNS
    participant LE as Let's Encrypt (CA)

    Note over Client: 1. 首次启动或证书临期 (剩余 < 15 天)
    Client->>Client: crypto/ecdsa 本地生成 P-256 私钥 (永不出机)
    Client->>Client: 生成设备 CSR (CN: <node-id>.direct.eqt.net.im)
    Client->>Proxy: POST /api/cert/provision (CSR + Ed25519 机器授权签名)
    
    Note over Proxy: 2. 验证设备合法性，启动 ACME 流程
    Proxy->>Proxy: 校验 DRM 硬件指纹与签名防刷
    Proxy->>LE: 发起 ACME NewOrder (域名: <node-id>.direct.eqt.net.im)
    LE-->>Proxy: 返回 DNS-01 Challenge Token 与 KeyAuth
    
    Note over Proxy,DNS: 3. 动态写入 DNS 验证记录
    Proxy->>DNS: POST /acme/challenge (设置 _acme-challenge.<node-id>.direct)
    DNS-->>Proxy: 200 OK (双节点毫秒级生效)
    
    Proxy->>LE: 告知准备就绪 (Trigger Challenge)
    LE->>DNS: DNS 查询 TXT _acme-challenge.<node-id>.direct
    DNS-->>LE: 应答权威验证值
    LE-->>Proxy: 校验通过 (Challenge Valid)
    
    Note over Proxy,LE: 4. 提交客户端原装 CSR，签发证书
    Proxy->>LE: 提交 Client 的 CSR (Finalize Order)
    LE-->>Proxy: 签发并下发 fullchain.pem
    
    Note over Proxy,DNS: 5. 清理临时质询
    Proxy->>DNS: DELETE /acme/challenge (清理 TXT 记录)
    
    Proxy-->>Client: 返回 fullchain.pem (仅公钥证书链)
    Client->>Client: 校验公私钥匹配性，原子写入本地受限缓存
    Note over Client: 完成初始化，启动本地 LAN-TLS 安全服务
```

---

## 三、核心技术组件实现规格（Technical Specifications）

### 1. 设备端密钥与 CSR 组装模块（`pkg/cert/provisioner.go`）

#### 1.1 密钥生成规格
- **算法选型**：ECDSA P-256（`elliptic.P256()`）。
  - *第一性原理依据*：相较于古老的 RSA 2048/4096，P-256 私钥尺寸极小（仅 32 字节）、生成速度快上百倍、TLS 握手签名计算极低消耗，且在 iOS Safari、Android Chrome、PC 浏览器上拥有 100% 原生支持。
- **物理隔离原则**：
  - 私钥在本地内存生成后，直接原子落盘至本地受控安全目录，**代码逻辑中绝不存在任何向网络传输私钥字节的通道**。
- **本地存储加固规格**：
  - **Linux / macOS**：
    - 路径：`~/.config/eqt/certs/<node-id>/privkey.pem`
    - 文件权限强制设为 `0600`（仅当前 UID 可读写），目录权限 `0700`；
  - **Windows 宿主**：
    - 路径：`%USERPROFILE%\.config\eqt\certs\<node-id>\privkey.pem`
    - 通过 Windows 原生 API 或 `icacls` 执行 DACL 继承打断（Inheritance: Remove），仅授予当前用户独占访问权限（`%USERNAME%:(R,W)`），杜绝跨用户提权访问；
    - 可选集成 Windows DPAPI（`CryptProtectData`）进行数据静态落盘加密。

#### 1.2 设备专属子域名规范
为实现单机单私钥，设备专属域名采用以下无冲突确定性算法推导：
```go
// NodeDomain = <node-id>.direct.eqt.net.im
// node-id 由硬件不可变特征哈希生成（如 SHA256(UUID + CPUID)[0:12] 的 hex 编码）
nodeID := hardware.GetDeviceNodeID() // 例如 "a1b2c3d4e5f6"
domain := fmt.Sprintf("%s.%s", nodeID, cert.BaseDomain)
```

#### 1.3 CSR（证书签名请求）自签名构造
利用 Go 标准库原生构建，不依赖 OpenSSL 外部二进制：
```go
func GenerateDeviceCSR(priv *ecdsa.PrivateKey, nodeDomain string) ([]byte, error) {
    subj := pkix.Name{
        CommonName:   nodeDomain,
        Organization: []string{"EQT LAN-TLS"},
    }
    template := x509.CertificateRequest{
        Subject:            subj,
        SignatureAlgorithm: x509.ECDSAWithSHA256,
        DNSNames:           []string{nodeDomain, "*." + nodeDomain},
    }
    return x509.CreateCertificateRequest(rand.Reader, &template, priv)
}
```

---

### 2. 局域网回环域名与多 IP 动态映射机制（Multi-IP Loopback）

在用户实际网络环境中，一台电脑可能拥有多个 IP（如物理以太网 `192.168.0.10`、Wi-Fi `192.168.1.50`），且笔记本切换网络时 IP 经常动态改变。

**核心挑战**：IP 变了，难道要重新申请证书吗？  
**解法（第一性原理设计）**：**通配符二级回环（Wildcard Sub-Loopback）**。
- 在申请专属设备证书时，请求的 SAN（Subject Alternative Name）同时包含两项：
  1. 单域名：`<node-id>.direct.eqt.net.im`
  2. 通配子域：`*.<node-id>.direct.eqt.net.im`
- **局域网 IP 回环转换规则升级**：
  当设备当前内网 IP 为 `192.168.1.100` 时，动态生成的访问域名为：
  `192-168-1-100.<node-id>.direct.eqt.net.im`
- **收益**：
  1. 完美命中客户端证书的 `*.<node-id>.direct.eqt.net.im` 保护范围，**浏览器地址栏 100% 绿锁**；
  2. 设备在办公室（`192.168.1.x`）与家庭（`10.0.0.x`）之间随意切换 Wi-Fi，**证书 90 天内完全有效，无需重新申请，零云端交互，纯本地即时生效**！

---

### 3. 双机权威 DNS 算法无状态解析升级（`cmd/eqt-dns`）

在现有 `cmd/eqt-dns` 的基础上，A 记录解析器仅需追加对“带设备子域格式”的无状态 IP 提取：

```go
// 支持解析格式：
// 1. 旧版全局回环: 192-168-1-100.direct.eqt.net.im
// 2. 专属节点回环: 192-168-1-100.<node-id>.direct.eqt.net.im
func ParseLoopbackIP(fqdn string, baseDomain string) net.IP {
    clean := strings.TrimSuffix(strings.ToLower(fqdn), ".")
    // 提取最左侧的主机名 Label
    labels := strings.Split(clean, ".")
    if len(labels) < 2 {
        return nil
    }
    ipDashed := labels[0] // 获得 "192-168-1-100"
    parts := strings.Split(ipDashed, "-")
    if len(parts) != 4 {
        return nil
    }
    // 转换为标准 IPv4 并校验内网合法性
    ...
}
```
**性能特征**：纯内存算法字符串切分与字节转换，单核可支撑 **200,000+ QPS**，不需要任何数据库存储设备与 IP 的映射关系，抗并发能力极其强悍。

---

### 4. 云端 ACME 代理网关规格（`eqt-acme-proxy`）

云端代理网关负责编排 Let's Encrypt 交互，并实施极其严密的安全与配额管控。

#### 4.1 访问鉴权与防刷（DRM 硬件指纹联动）
- **客户端鉴权请求头**：
  ```http
  POST /api/v1/cert/provision HTTP/1.1
  Host: api.eqt.net.im
  X-EQT-Device-ID: <device-id>
  X-EQT-Hardware-Signature: <base64-ed25519-sig>
  X-EQT-Timestamp: 1725888000
  Content-Type: application/json

  {
    "csr_pem": "-----BEGIN CERTIFICATE REQUEST-----\n..."
  }
  ```
- **服务端防刷规则**：
  1. 签名防篡改：利用 [`pkg/server/hardware.go`](file:///home/yelon/develop/me/eqrcp/pkg/server/hardware.go) 中登记的公钥，强校验硬件指纹签名；
  2. 防重放：时间戳窗口限制在 ±60 秒内；
  3. 频控保护：单设备 24 小时内最多请求 3 次，防止恶意刷爆 Let's Encrypt 接口。

#### 4.2 Let's Encrypt 配额与频控（Rate Limits）防御策略
Let's Encrypt 对单个主域名（Registered Domain）存在每周申请证书上限（默认 50 张/周）。针对该客观瓶颈，本方案设计了三级防护梯次：
1. **梯次 1：证书超长有效期与懒惰续签（Lazy Renewal）**：
   Let's Encrypt 证书有效期为 90 天。客户端在剩余有效期小于 **15 天**时才发起续期，平均每台设备每年仅消耗 4 次签发配额；
2. **梯次 2：Public Suffix List (PSL) 独立申报**：
   向 Mozilla 维护的 Public Suffix List 提交申请，将 `direct.eqt.net.im` 注册为公共后缀。注册成功后，每一个 `<node-id>.direct.eqt.net.im` 将被视为一个独立的注册域名，**彻底解除主域名每周 50 张的限制**（Tailscale 与 DuckDNS 均采用此标准方案）；
3. **梯次 3：官方 Rate Limit Exemption 白名单**：
   在 PSL 生效过渡期，直接向 Let's Encrypt 官方提交“开源与公信基础设施配额豁免申请”，可直接将每周签发额度提升至 10,000~100,000 张/周。

---

## 四、威胁模型与安全性深入对比（Threat Modeling & Formal Analysis）

| 威胁场景（Threat Scenarios） | 当前阶段方案（通配符私钥同步） | 演进方案（本地私钥自生成 Tailscale 路线） |
| :--- | :--- | :--- |
| **场景 1：公共 Wi-Fi 蹭网者抓包（Passive Sniffing）** | 🛡️ **安全**。TLS 1.3 ECDHE 临时密钥协商，事后抓包无法解密（前向保密 PFS）。 | 🛡️ **安全**。完全相同的前向保密性，传输链路高强度密文。 |
| **场景 2：同内网恶意用户劫持（Active MITM）** | ❌ **不安全**。恶意用户同样拥有通配符私钥，可通过 ARP 劫持伪造目标服务，手机绿锁常亮无法察觉。 | 🛡️ **完全免疫**。攻击者绝不可能拥有受害设备的本地独立私钥，伪造证书将直接触发浏览器致命红色拦截警报。 |
| **场景 3：云端服务器被入侵 / 数据库泄露** | ⚠️ **存在风险**。若云端 VPS 证书库被脱库，泄露通配符私钥导致全网证书失效。 | 🛡️ **绝对安全**。云端自始至终**根本不存在任何客户端私钥**，黑客攻破云端数据库也拿不到任何私钥！ |
| **场景 4：单台用户 PC 中木马导致私钥被提取** | 💥 **全局灾难**。通配符私钥一旦被提取并公开，全网通配符证书被 CA 吊销，全体用户集体瘫痪。 | 🟢 **影响严格隔离**。仅该物理机私钥被盗，爆炸半径仅限单机。云端直接吊销该设备子域，不影响任何其他用户。 |
| **场景 5：离线局域网环境文件传输** | 🛡️ **安全可用**。本地持有证书缓存即可握手。 | 🛡️ **安全可用**。证书有效期长达 90 天，在此期间 100% 纯局域网离线运行，无需连外网。 |

---

## 五、平滑演进与落地实施路线图（Rollout & Migration Milestones）

为了保障现有庞大用户群体的平滑过渡，避免因架构剧变产生任何阻断，制定以下四阶段实施路线图：

### Phase 1：双模兼容与云端代理基础设施就绪（Cloud & Core Foundations）
- **交付目标**：
  1. 在 `cloudflare/eqt-drm-api` 中扩展 `/api/v1/cert/provision` 接口与 DNS-01 代理流程；
  2. 改造 `cmd/eqt-dns`，支持 `<ip>.<node-id>.direct.eqt.net.im` 两级域名的无状态 IP 提取与精确 TXT 质询应答；
  3. 客户端实现 `pkg/cert/provisioner.go` 本地私钥生成与 CSR 组装单测。

### Phase 2：桌面端静默无感自动置备（Desktop Silent Provisioning）
- **交付目标**：
  1. 桌面端启动时，优先探测本地是否存在已激活的设备专属证书（`~/.config/eqt/certs/<node-id>/`）；
  2. 若不存在，在后台非阻塞协程中静默调用云端代理接口完成首次自签，并落盘存储；
  3. 彻底淘汰对外部 `scripts/sync-certs-from-vps.sh` 脚本的手动依赖，普通用户安装即可享受原生零配置 TLS。

### Phase 3：容灾平滑降级（Fail-Soft）持续守护
- **交付目标**：
  - 继承既有 Fail-Soft 设计准则：若新机器处于纯内网无网环境首次启动、且云端签发暂时无法连通时，**依然保持平滑自动降级至 HTTP 传输**（见 [`desktop/gui/agent.go:1031-1034`](file:///home/yelon/develop/me/eqrcp/desktop/gui/agent.go#L1031-L1034)），杜绝新环境任何形式的一击瘫痪。

### Phase 4：旧版通用通配符证书优雅下线（Graceful Deprecation）
- **交付目标**：
  - 当绝大多数活跃客户端已平滑升级为专属设备证书后，停用旧版 `*.direct.eqt.net.im` 通配符分发，将通配符私钥彻底销毁，完成安全闭环。

---

## 六、总结与权威结论

1. **第一性归宿**：
   本架构彻底打破了“使用 TLS 就必须在客户端分发通配符私钥”的工程妥协，通过**本地独立私钥自生成 + 云端 ACME DNS-01 代理中继**，将非对称密码学的安全边界推向极致；
2. **零牺牲体验**：
   在维持移动端（尤其是 iOS Safari）**免装 App、扫码即连、安全绿锁 🔒、100GB 大文件原生流式零 OOM 下载**全部核心优势的前提下，实现了真正的**私钥零离机、零扩散、零泄露风险**；
3. **技术就绪度**：
   该方案依托标准的 RFC 8555（ACME）、X.509 标准证书与 Go 官方标准库，完全规避了 RFC 9345 在浏览器生态与网络协议栈中的死胡同，是 EQT 迈向高安全、工业级分布式传输系统的最坚固基石。
