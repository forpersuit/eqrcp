# EQT 局域网 TLS 私钥零泄漏与设备专属 ACME 自动化架构设计方案

> **文档标识**：`docs/mechanism/lan-tls-zero-leak-acme-architecture.md`  
> **文档性质**：系统核心安全架构设计方案、当前工程实现现状与已知缺陷分析报告  
> **现役基线版本**：`v1.36.123+`  
> **最后修订日期**：2026-09-13  
> **关联技术组件**：
> - 客户端核心：[`pkg/cert/provisioner.go`](../../pkg/cert/provisioner.go), [`pkg/cert/cert.go`](../../pkg/cert/cert.go), [`pkg/server/hardware.go`](../../pkg/server/hardware.go), [`pkg/config/config.go`](../../pkg/config/config.go)
> - 桌面端与 GUI：[`desktop/gui/app.go`](../../desktop/gui/app.go), [`desktop/gui/main.go`](../../desktop/gui/main.go), [`desktop/gui/frontend/src/components/tls_status.js`](../../desktop/gui/frontend/src/components/tls_status.js), [`desktop/gui/frontend/src/i18n.js`](../../desktop/gui/frontend/src/i18n.js)
> - 权威 DNS 服务：[`cmd/eqt-dns/main.go`](../../cmd/eqt-dns/main.go)（权威节点 `ns1.eqt.net.im`, `ns2.eqt.net.im`）
> - 云端置备网关：[`cloudflare/eqt-drm-api/src/routes/cert.ts`](../../cloudflare/eqt-drm-api/src/routes/cert.ts), [`cloudflare/eqt-drm-api/src/utils/acme.ts`](../../cloudflare/eqt-drm-api/src/utils/acme.ts)
> - 现役技术报告：[`docs/mechanism/lan-tls-security-protocol-technical-report.md`](lan-tls-security-protocol-technical-report.md)

---

## 目录
1. [一、第一性原理与核心设计目标](#一第一性原理与核心设计目标)
2. [二、系统总体架构与网络拓扑](#二系统总体架构与网络拓扑)
3. [三、核心协议时序与交互流程](#三核心协议时序与交互流程)
4. [四、核心技术组件与工程实现细节](#四核心技术组件与工程实现细节)
   - [4.1 客户端与桌面端调度引擎](#41-客户端与桌面端调度引擎pkgcert--desktopgui)
   - [4.2 双机自建权威 DNS 节点](#42-双机自建权威-dns-节点cmdeqt-dns)
   - [4.3 云端 ACME 置备代理网关](#43-云端-acme-置备代理网关cloudflare-worker)
   - [4.4 客户端运行环境隔离与网络协议合规](#44-客户端运行环境隔离与网络协议合规)
5. [五、安全威胁模型与纵深防御体系](#五安全威胁模型与纵深防御体系)
6. [六、当前系统落地实况与代码映射表](#六当前系统落地实况与代码映射表)
7. [七、当前系统已知缺陷、瓶颈与风险评估](#七当前系统已知缺陷瓶颈与风险评估)
8. [八、规模化推广与后续演进路线图](#八规模化推广与后续演进路线图)
9. [附录：工程审查红线与方法论沉淀](#九附录工程审查红线与方法论沉淀)

---

## 一、第一性原理与核心设计目标

### 1. 业务痛点：局域网传输为什么必须引入公信 TLS？

在纯局域网（LAN）文件传输中，业界通常采用直接暴露 HTTP 服务、移动端扫码通过内网 IP（如 `http://192.168.1.100:port`）下载的方式。然而在实际落地中，纯 HTTP 面临三个致命死穴：

1. **移动端 iOS Safari 大文件 OOM 闪退（内存死穴）**：
   - 在 iOS / iPadOS Safari 的底层 WebKit 下载沙箱中，纯 HTTP 传输触发的沙箱机制存在严格的内存上限（约 1.5GB）。当单文件传输超过 2GB 时，WebKit 无法维持持久流式写盘，直接触发应用层 OOM 崩溃并提示“无法下载此文件”。
   - 相比之下，在标准 HTTPS (TLS 1.2/1.3) 安全上下文中，浏览器能够完整激活 `window.isSecureContext` 与原生高效流式落地通道，彻底免疫大文件 OOM 闪退。
2. **自签名 CA 的信任阻断与极差体验（体验死穴）**：
   - 若采用自建 CA 签发的私有证书，移动端浏览器（Safari / Chrome）会弹出醒目刺眼的“不安全连接 / 证书不可信”红标警告，拦截用户正常访问，甚至禁止附件下载；
   - 要求终端用户手动下载并信任 `.mobileconfig` 描述文件在消费级场景完全不可行，违背了“开箱即用”的产品体验底线。
3. **明文窥探与数据篡改风险（安全死穴）**：
   - 局域网（如公共 Wi-Fi、合租公寓、联合办公网络）并非安全可信环境。同一物理网络内的任意第三方均可通过 ARP 欺骗或网络嗅探轻松截获甚至篡改正在传输的敏感个人隐私与商业文件。

### 2. 方案演进：为什么淘汰“通配符私钥共享”，坚守 Tailscale 零泄漏路线？

在实现免装 CA 的原生公信 TLS 过程中，系统经历了两个阶段的架构探索：

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 模式 A：过渡期集中通配符共享方案（1 张通配符证书 · 全员共享同一私钥）                          │
│                                                                                        │
│   云端统一生成: 公钥 Pub_0 + 私钥 Priv_0 ──► CA 签发 1 张 *.direct.eqt.net.im 通配符证书    │
│                                                  │                                     │
│   [全员分发模式] ────────────────────────────────┴─────────────────────────────────┐   │
│   │ 设备 1: 磁盘存储 Priv_0 副本 ──► 绑定 192-168-1-10.direct.eqt.net.im               │   │
│   │ 设备 2: 磁盘存储 Priv_0 副本 ──► 绑定 192-168-1-20.direct.eqt.net.im               │   │
│   │ 设备 N: 磁盘存储 Priv_0 副本 ──► 绑定 10-0-0-5.direct.eqt.net.im                   │   │
│   ▼                                                                                    │   │
│   ★ 致命隐患:                                                                          │   │
│     1. 私钥出机，退化为全网共享秘密：同网恶意用户可利用合法私钥实施主动中间人（MITM）窃听； │   │
│     2. 连坐吊销：单机私钥被提取并公开后，CA 将吊销全网通配符证书，导致所有客户端瞬间瘫痪；   │   │
│     3. 无法平民化：终端用户必须依赖运维脚本同步私钥。                                   │   │
└────────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 模式 B：演进版设备专属零泄漏方案（Tailscale 路线 · 单机单私钥 · 永不出机） ★★★           │
│                                                                                        │
│   设备 1: 本地安全生成 Priv_1 ──► 仅上传 CSR ──► CA 代理签发 *.node1.direct.eqt.net.im   │
│   设备 2: 本地安全生成 Priv_2 ──► 仅上传 CSR ──► CA 代理签发 *.node2.direct.eqt.net.im   │
│   设备 N: 本地安全生成 Priv_N ──► 仅上传 CSR ──► CA 代理签发 *.nodeN.direct.eqt.net.im   │
│   ▼                                                                                    │   │
│   ★ 核心优势:                                                                          │   │
│     1. 私钥独占、永不出机：从数学原理上杜绝私钥扩散与局域网内主动中间人攻击；            │   │
│     2. 故障完全隔离：单一设备即使泄露证书与私钥，影响半径严格局限于该设备专属子域名；    │   │
│     3. 全自动静默置备：客户端启动后全自动向云端代理申请公信证书，用户零感知。            │   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3. 必须坚守的五大物理硬性指标
任何架构与工程改动均不得违背以下第一性原则：
1. **移动端绝对零门槛**：无需安装任何 App，无需安装配置任何根证书，原生 Safari / Chrome 扫码秒连，呈现官方公信绿锁 🔒；
2. **物理局域网极速直连**：文件数据 100% 局域网点对点传输，跑满网线与 Wi-Fi 物理带宽（80MB/s~120MB/s+），严禁将传输流量中继到外网；
3. **百 GB 级文件零 OOM**：由底层原生 C++/Go 调度内核流式写盘，内存占用恒定，彻底杜绝前端网页解析大文件导致的内存溢出；
4. **私钥零泄露**：私钥在设备本地生成，原子加密落盘，云端服务器与任何第三方绝对不可触碰私钥；
5. **单机单私钥单子域**：每台设备拥有专属 `node_id`，绑定独立公信证书，同局域网内其他持证设备无法伪造或解密该设备的通信内容。

---

## 二、系统总体架构与网络拓扑

### 1. 系统全景拓扑图

```text
                               ┌───────────────────────────────────────────────┐
                               │   公共 CA (Google Trust Services / GTS)       │
                               │   RFC 8555 ACME DNS-01 验证接口               │
                               └───────▲───────────────────────────────┬───────┘
                                       │ (1) 订单与验证请求             │ (4) 权威递归查询
                                       │                               │     TXT 质询记录
                       ┌───────────────┴───────────────────────┐       │
                       │  云端置备网关 (Cloudflare Worker)      │       │
                       │  lic.eqt.net.im /api/v1/cert/provision│       │
                       │  - Web Crypto CSR 强校验              │       │
                       │  - TOFU 设备公钥绑定 (D1 数据库)      │       │
                       │  - 三层立体防刷限流                   │       │
                       └───────┬───────────────────────┬───────┘       │
               (2) 内部安全通信 │                       │ (2) 内部安全通信│
               Bearer Token 鉴权│                       │ Bearer Token 鉴权
                       ┌───────▼───────────────┐       ┌───────▼───────┴───────┐
                       │  自建权威 DNS 节点 1   │       │  自建权威 DNS 节点 2   │
                       │  ns1-dns.eqt.net.im   │       │  ns2-dns.eqt.net.im   │
                       │  - 算法无状态 A 记录  │       │  - 算法无状态 A 记录  │
                       │  - 内存多值 TXT 挑战  │       │  - 内存多值 TXT 挑战  │
                       └───────▲───────────────┘       └───────▲───────────────┘
                               │                               │
                       (5) 公共 DNS 递归查询（A 记录解析）        │
                               │                               │
       ┌───────────────────────┴───────────────────────────────┴───────────────────────┐
       │                                                                               │
       │                               局域网物理边界 (Local Area Network)              │
       │                                                                               │
       │   ┌────────────────────────────────┐     (6) HTTPS / WSS 局域网物理直连直传    │
       │   │  EQT 发送端设备 (Desktop/CLI)   ├─────────────────────────────────────┐   │
       │   │  - 节点 ID: cbb17e77a10f       │                                     │   │
       │   │  - 私钥: 本地 privkey.pem      │                                     │   │
       │   │  - 证书: fullchain.pem         │                                     │   │
       │   │  - 内网 IP: 192.168.1.100      │                                     │   │
       │   └───────────────▲────────────────┘                                     ▼   │
       │                   │                                      ┌───────────────────┴┐
       │      (0) 启动时静默置备 CSR 证书                          │ 手机端 Safari/Chrome │
       │          (仅传输 CSR，私钥不出机)                         │ 访问回环域名:        │
       │                   │                                      │ 192-168-1-100.    │
       │                   └──────────────────────────────────────┤ cbb17e77a10f.     │
       │                                                          │ direct.eqt.net.im │
       │                                                          └────────────────────┘
       └───────────────────────────────────────────────────────────────────────────────┘
```

### 2. 核心域名分级设计规范

为满足“单机单私钥”且“多网卡/动态 IP 无状态回环”的物理需求，系统制定了多层级域名规范：

| 域名层级 | 范例 | 角色与用途 | 解析规则 (权威 DNS) |
| :--- | :--- | :--- | :--- |
| **根主域** | `direct.eqt.net.im` | EQT LAN-TLS 专有主域 | 不对外提供直接 A 记录解析，仅做 NS 委派 |
| **设备专属根域** | `<node_id>.direct.eqt.net.im`<br>*(例: `cbb17e77a10f.direct.eqt.net.im`)* | 对应单台物理设备的专属身份根域 | 仅作为证书 CommonName 及 ACME 签发主体 |
| **设备回环内网 IP 域** | `<dashed-ip>.<node_id>.direct.eqt.net.im`<br>*(例: `192-168-1-100.cbb17e77a10f.direct.eqt.net.im`)* | 局域网传输使用的真实 FQDN 回环域名 | **算法无状态提取 dashed-ip**，直接响应对应 IPv4 A 记录（TTL 300s） |
| **ACME 质询域名** | `_acme-challenge.<node_id>.direct.eqt.net.im` | RFC 8555 DNS-01 验证记录 | 权威 DNS 内存返回置备网关设置的 TXT 质询值（TTL 60s） |
| **遗留兼容单级域** | `<dashed-ip>.direct.eqt.net.im` | 旧版通配符模式回退兼容 | 算法无状态解析 dashed-ip，返回对应 IPv4 |

---

## 三、核心协议时序与交互流程

### 1. 证书静默置备与生命周期管理完整时序图

```mermaid
sequenceDiagram
    autonumber
    participant Client as 客户端 (Desktop / CLI)
    participant Gateway as 云端置备网关 (Worker)
    participant D1 as D1 数据库 (绑定与限流)
    participant DNS as 双机权威 DNS (ns1 & ns2)
    participant CA as 公共 CA (Google GTS)

    Note over Client: 1. 本地检测证书缓存<br/>(~/.config/eqt/certs/<node_id>/)
    alt 缓存有效且剩余有效期 > 15 天
        Client->>Client: 验证根信任锚，直接装载使用 (绿锁)
    else 证书缺失或即将到期
        Client->>Client: 生成 ECDSA P-256 密钥对 (私钥 0600 落盘，永不出机)
        Client->>Client: 组装 PKCS#10 CSR (CN=node.direct... SAN=node..., *.node...)
        Client->>Client: 生成 IEEE P1363 验签载荷: Sign(nodeID + ":" + timestamp)
        
        Client->>Gateway: POST /api/v1/cert/provision<br/>(Body: csr_pem; Headers: Device-Signature, Timestamp, Device-ID)
        
        Note over Gateway: 2. 身份校验与防刷拦截
        Gateway->>Gateway: 校验时间戳容差 (严格 ±60s)
        Gateway->>Gateway: Web Crypto 校验 CSR 格式、SAN 域名规范
        Gateway->>Gateway: 验签 X-EQT-Device-Signature (Proof-of-Possession)
        
        Gateway->>D1: 查询 TOFU 绑定 (node_public_keys)
        alt 首次使用 (TOFU)
            Gateway->>D1: 异步记录绑定关系 (node_id -> pubkey_sha256)
        else 已绑定且公钥一致
            Gateway->>Gateway: 放行
        else 已绑定但公钥不匹配
            alt 携带强绑定的匹配 device_id
                Gateway->>D1: 授权密钥轮换，更新绑定的公钥
            else 未绑定 device_id 或设备不匹配
                Gateway-->>Client: 403 node_key_mismatch (阻断冒名申请)
            end
        end

        Gateway->>D1: 校验三层频控 (Node 3次/24h, IP 10次/24h, 全局 40次/7d)
        alt 触发限流
            Gateway-->>Client: 429 rate_limited / Retry-After
        end

        Note over Gateway,CA: 3. RFC 8555 ACME DNS-01 验证编排
        Gateway->>CA: newOrder (node.direct.eqt.net.im, *.node.direct.eqt.net.im)
        CA-->>Gateway: 返回两条独立的 DNS-01 挑战 Token
        Gateway->>Gateway: 计算两条挑战的 TXT 质询值 (val_1, val_2)
        
        Note over Gateway,DNS: 4. 双机强一致写入与传播确认
        Gateway->>DNS: 并发批量写入双值 TXT (_acme-challenge.<node>...)
        Gateway->>DNS: 权威端点传播自检轮询 (确认双机均已暴露双值 TXT)
        
        Gateway->>CA: 触发 CA 开始 DNS-01 验证
        CA->>DNS: 递归查询 _acme-challenge.<node> TXT 记录
        DNS-->>CA: 返回多值 TXT
        CA->>CA: 验证成功，订单转为 ready
        
        Gateway->>CA: finalizeOrder (提交客户端上传的 CSR DER)
        CA->>CA: 签发公信 X.509 证书
        CA-->>Gateway: 返回证书下载 URL
        Gateway->>CA: 下载完整证书链 fullchain.pem
        
        Gateway->>DNS: 异步清理 TXT 挑战记录 (释放内存)
        Gateway->>D1: 异步沉淀置备审计日志 (device_cert_provisions)
        Gateway-->>Client: 200 OK (cert_pem, expires_at)

        Note over Client: 5. 客户端落盘与根信任链验证
        Client->>Client: 验证证书是否由系统公信根信任库签发
        alt 根信任链验证通过
            Client->>Client: 证书原子落盘 (~/.config/eqt/certs/<node_id>/fullchain.pem)
            Client->>Client: 触发前端事件 eqt:tls-cert-ready，点亮绿色安全锁 🔒
        else 发现自签或不可信证书
            Client->>Client: 拒绝装载，Fail-Soft 降级为 HTTP 传输
        end
    end
```

---

## 四、核心技术组件与工程实现细节

### 4.1 客户端与桌面端调度引擎（`pkg/cert` & `desktop/gui`）

#### 4.1.1 私钥生成与存储安全
- **算法基准**：严格采用 NIST P-256（`secp256r1`）椭圆曲线算法，兼具高安全强度与移动端极速 TLS 握手特性。
- **存储隔离**：私钥保存于专属设备目录（Windows: `%APPDATA%\eqt\certs\<node-id>\privkey.pem`；Linux/macOS: `~/.config/eqt/certs/<node-id>/privkey.pem`）。
- **权限基线**：以 `0600` 权限原子落盘；在 Windows 下利用 NTFS DACL 严格收紧，仅当前登录用户具有只读权限。

#### 4.1.2 设备硬件指纹与 Node ID 派生
- **确定性派生源**：由主板 UUID、CPU 序列号、硬盘序列号通过级联哈希生成：
  $$\text{NodeID} = \text{SHA256}(\text{uuidHash} : \text{cpuHash} : \text{diskHash} [: \text{salt}])[:12]$$
- **自愈式 Salt 轮换**：若用户重装系统或清理本地缓存导致生成了新私钥，向云端申请时会触发 `403 node_key_mismatch`。客户端调度引擎捕获该状态后，自动在本地注入随机盐（Salt），派生全新的 12 位 Node ID 并发起重试，实现端侧静默自愈。

#### 4.1.3 客户端 CSR 组装与 POPO 持有性验签
- **CSR 内容规范**：
  - `CommonName`: `${node_id}.direct.eqt.net.im`
  - `SubjectAlternativeName` (SAN): 严格同时包含单域名与通配符子域：
    - `DNS: ${node_id}.direct.eqt.net.im`
    - `DNS: *.${node_id}.direct.eqt.net.im`
- **签名防重放机制**：
  - 客户端使用本地私钥对 `${node_id}:${timestamp}` 进行签名，导出 IEEE P1363 标准（64 字节，r 32B + s 32B 大端序）二进制；
  - Base64 编码后随请求头 `X-EQT-Device-Signature` 与 `X-EQT-Timestamp` 提交；
  - 置备网关提取 CSR 中的 SPKI 公钥，直接调用 Web Crypto `subtle.verify` 原生验签，证明私钥持有性（Proof-of-Possession），杜绝中间人篡改。

#### 4.1.4 系统受信任根证书锚定校验（Fail-Closed 校验）
- 为杜绝任何自签假证书或中间人伪造证书给用户带来虚假安全绿锁，客户端在落盘与装载时，强制执行系统信任锚校验：
  ```go
  opts := x509.VerifyOptions{
      Roots:         nil, // 强制加载宿主操作系统全局公信根证书库 (如 ISRG Root / GTS Root)
      Intermediates: intermediates,
      CurrentTime:   time.Now(),
  }
  _, err := leaf.Verify(opts)
  ```
- 若校验失败，明确返回 `ErrUntrustedCertificate`，严禁装载至内存，并保持底层普通 HTTP 降级传输。

#### 4.1.5 跨平台存储目录规范与存量升级平滑迁移
- **数据根规范**：统一收拢至系统标准用户配置目录（Windows 为 `%APPDATA%\eqt`，Linux/macOS 为 `~/.config/eqt`）。
- **防私钥孤儿化机制（`MigrateLegacyDeviceCredentials`）**：
  - 早期版本曾使用 `%USERPROFILE%\.config\eqt\certs`（Linux 习惯），Windows 升级后会导致老私钥对新路径不可见；
  - 若 `LoadOrGenerateDeviceKey` 误以为首次安装而静默生成新密钥，会导致撞上服务端 TOFU 强绑定而锁死为 403；
  - 系统在 `pkg/cert/provisioner.go` 中实现 `MigrateLegacyDeviceCredentials`：
    1. 自动探针检测旧目录是否存在；
    2. 创建目标目录并严格收敛权限为 `0700`；
    3. 迁移末尾对目标 `privkey.pem` 执行结果驱动的强校验（`os.Stat` 且 `Size() > 0`）；
    4. 配合 `legacyKeyExists` 判定：若旧私钥存在但迁移失败，明确报错并拒签新私钥，彻底消灭伪首次安装隐患。

#### 4.1.6 客户端置备 45 秒超时模型与 Dev 模式手动调试触发
- **置备耗时现实基准**：ACME DNS-01 握手包含订单创建、双机 TXT 发布、权威传播自检、CA 递归查询验证与证书签发，真实网络耗时通常为 **9~15 秒**。
- **长超时客户端解耦**：普通业务客户端默认设有 5 秒短超时，会导致置备在网关等待 CA 时被本地提前截断。系统在 `desktop/gui/app.go` 中采用专属长超时客户端：
  ```go
  provisionClient := &http.Client{Timeout: 45 * time.Second}
  ```
- **开发者模式支持（Dev Provisioning）**：
  - Go 端导出 `DevProvisionDeviceTLSCert()` 方法；
  - Settings 开发者选项中提供「🔄 申请 / 刷新设备证书」按钮，附带实时 Loading、Toast 反馈与即时重绘，无需重启软件即可热更新证书。

#### 4.1.7 桌面端 UI 五态机、14 个多语言词条与任务安全徽标
桌面端通过统一状态机管理 LAN-TLS 的界面反馈与生命周期：

| 状态标识 | 界面图标呈现 | 含义与流转逻辑 |
| :--- | :--- | :--- |
| `disabled` | ⚪ 灰色锁定图标 | 用户在设置中关闭了 TLS，或未开启局域网加密 |
| `preparing`| 🔵 蓝色旋转加载动画 | 启动后后台正在静默向网关申请置备证书（预计 10~15 秒） |
| `ready`    | 🟢 绿色公信安全锁 🔒 | 官方公信证书已验证并成功装载，HTTPS/WSS 完全就绪 |
| `mismatch` | 🟠 橙色警告盾牌 | 检测到公钥不匹配，端侧正在自愈轮换或提示需重置绑定 |
| `failed`   | 🔴 红色错误叹号 | 置备遭遇硬错误（如限流冷却），**强制切断开关（Fail-Closed）**并提示冷却时间 |

- **职责正交原则**：
  - **TLS 特性域（Fail-Closed）**：置备失败或限流时，必须切断 TLS 开关（落盘 `enableTLS: false`），严禁在界面呈现虚假的“加密中”标识；
  - **文件传输域（Fail-Soft）**：无论 TLS 状态如何，文件传输服务本身绝不崩溃，自动以普通明文 HTTP 协议保障传输 100% 可用。
- **任务卡片安全徽标（`.tls-security-badge`）**：在任务卡片、二维码弹窗与传输详情中，动态标识 `🔒 HTTPS` / `⚠️ HTTP (降级明文)` / `🔓 HTTP`。
- **全语言字典对齐**：在 `desktop/gui/frontend/src/i18n.js` 中完整收录 14 个 `tls_` 国际化词条（覆盖中/英/日/韩/西/德/法 7 种语言），包含状态提示、限流冷却气泡及无障碍 `role="img"` 属性。

#### 4.1.8 离线与无网环境解耦（Base64 二维码直出）
- 桌面端 GUI 二维码由 Go 后端调度内核在任务创建时内存级离线生成 Base64 Data URL（`data:image/png;base64,...`）直出到前端；
- 规避了 WebView2 向本地发起回环网络请求，彻底免疫路由器 DNS 重绑定防护（DNS Rebinding Protection）和脱网断网场景下的破图风险。

---

### 4.2 双机自建权威 DNS 节点（`cmd/eqt-dns`）

#### 4.2.1 RFC 1035 架构规范与部署拓扑
- **权威节点 1 (`ns1-dns.eqt.net.im`)**：`128.241.227.181` (Ubuntu Linux)
- **权威节点 2 (`ns2-dns.eqt.net.im`)**：`103.232.92.220` (Ubuntu Linux)
- **委派配置红线**：Cloudflare DNS 面板中的 `ns1` 与 `ns2` 记录**必须保持灰云（DNS-Only）**。严禁开启 Cloudflare Proxy（橙云），否则破坏 RFC 1035 委派链。
- **端口安全隔离**：DNS 标准查询暴露于 UDP/TCP `53` 端口；HTTP 管理端点锁定在内网回环 `127.0.0.1:5380`，由前端 Caddy 反代提供受限入口，并强制执行 Bearer Token 鉴权。

#### 4.2.2 算法无状态 A 记录解析引擎
- **无数据库/零磁盘 I/O**：解析核心 `parseIP(domain)` 采用纯内存运算：
  - 输入：`192-168-1-100.cbb17e77a10f.direct.eqt.net.im`
  - 提取：`192`, `168`, `1`, `100`，校验每个数值在 `0~255` 范围内
  - 输出：`192.168.1.100`
- **TTL 设定**：A 记录返回 TTL 统一设定为 **300 秒**。兼顾局域网 IP 短期缓存与设备切换 Wi-Fi 后的快速重定向。

#### 4.2.3 内存级多值 TXT 挑战管理器
- **同名多值支持**：针对主域名与通配符域名同时质询的场景，`AcmeStore` 内部采用 `map[string]map[string]time.Time` 结构：
  - 键 1：`_acme-challenge.cbb17e77a10f.direct.eqt.net.im.`
  - 键 2：具体的挑战值 `val_1` 与 `val_2`，映射到各自的过期时间。
- **自动老化清理**：DNS 查询响应时惰性淘汰过期条目，TTL 设定为 **60 秒**。

---

### 4.3 云端 ACME 置备代理网关（Cloudflare Worker）

#### 4.3.1 基础设施与配置事实清单
云端网关部署于 Cloudflare Worker（`cloudflare/eqt-drm-api`），其现役配置基线如下：

```toml
# wrangler.toml 现役核心配置
[vars]
ENVIRONMENT = "production"
ACME_DIRECTORY_URL = "https://dv.acme-v02.api.pki.goog/directory" # Google Trust Services (GTS)
ACME_EAB_KID = "b160e386be328f849159219f87cae8a5"
ACME_DNS_API_ENDPOINTS = "https://ns1-dns.eqt.net.im,https://ns2-dns.eqt.net.im"
ACME_EMAIL = "forpersuit@gmail.com"

routes = [
  { pattern = "lic.eqt.net.im", custom_domain = true }
]
```

#### 4.3.2 Google Public CA (GTS) RFC 8555 §7.3.4 EAB 密码学协议栈
- **External Account Binding (EAB) 原生实现**：
  - Google Public CA 要求在创建新账户（`newAccount`）时绑定 GCP 凭据；
  - 网关在 `acme.ts` 中根据 RFC 8555 §7.3.4 实现 JWS EAB 封装：
    - `protected`: `{"alg":"HS256","kid":"<ACME_EAB_KID>","url":"<directoryUrl>/newAccount"}`
    - `payload`: 待注册账户公钥的 JWK 格式
    - 签名算法：采用 `HMAC-SHA256`，使用从 GCP 控制台申请并经 Base64URL 解码的 `macKey` 进行签名。
- **账户密钥持久化（`ACME_ACCOUNT_KEY`）**：
  - 离线生成专属 ECDSA P-256 JWK 并注入 Worker 机密环境变量，杜绝每次置备重复创建账户消耗 GTS 频控。

#### 4.3.3 解决双域名 DNS-01 验证的时序竞态（Race Condition）
针对主域名与通配符子域，网关采用四阶段严格时序：
1. **阶段 1（挑战收集）**：遍历 Authorizations，计算主域名与通配符对应的 TXT 质询值，组装挑战集合；
2. **阶段 2（批量发布）**：在触发任何 CA 验证之前，将双值 TXT 记录并发推送到所有配置的权威节点（`ns1` 与 `ns2`）；
3. **阶段 3（传播自检）**：网关主动对各权威节点的 HTTP 状态发起轮询探针（`confirmDnsPropagation`），确认双机权威均已成功返回所有预期 TXT 值后，才进入下一阶段；
4. **阶段 4（触发验证）**：并发通知 CA 校验端点开始验证。

#### 4.3.4 权威双机强一致写入与局部失败即刻回滚
为规避 CA 多视角随机递归检查失败，网关严格要求双权威节点同时写入成功：
- 若节点 1 写入成功但节点 2 网络超时，网关立即向节点 1 下发 DELETE 请求回滚清除，实现“部分失败、瞬间归零”；
- 请求处理的 `finally` 块中前置注册清理闭包，无论成功、失败或超时中断，均确保清除 DNS 内存中的 TXT 残留。

---

### 4.4 客户端运行环境隔离与网络协议合规

#### 4.4.1 WebKit / iOS Safari HTTPS 附件下载协议规范
在 HTTPS 协议下进行文件下载（`Content-Disposition: attachment`）时，iOS / iPadOS Safari 的底层下载沙箱（`NSURLSessionDownloadTask`）对响应头极为挑剔：
1. **缓存头冲突规避**：若服务端返回了 `Cache-Control: no-cache` 或 `no-store` 以及 `Pragma: no-cache`，WebKit 会认为该数据不可落盘暂存，直接中断连接并抛出系统级错误 **“无法下载此文件 / 无法下载，请重试”**。服务端必须严格配置：
   ```http
   Cache-Control: private, no-transform
   ```
   并彻底移除 `Pragma` 和 `Expires` 响应头；
2. **显式 MIME 类型支持**：严禁对附件返回空白类型或完全依赖自动嗅探；对压缩包强制声明 `Content-Type: application/zip`；
3. **Range 探测防误判**：Safari 在下载前通常会预发 `Range: bytes=0-1` 探测请求，服务端必须正常响应 206 Partial Content，分块交付完毕切勿标记为“传输中断”。

#### 4.4.2 Windows WebView2 系统代理穿透与 CSP 规范
- **系统代理穿透**：Windows 系统开启系统代理（如 Clash/V2Ray `127.0.0.1:10808`）时，WebView2 内核会无差别拦截外部顶级域名（包括 `.im`），导致访问 `*.direct.eqt.net.im` 本地回环时挂起或被代理拒绝。桌面端在启动前通过环境变量 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 注入：
  ```text
  --proxy-bypass-list=<local>;127.0.0.1;localhost;*.lan.eqt.im;*.direct.eqt.net.im;10.*;192.168.*;172.16.*;…;172.31.*
  ```
  强制本地回环流量绕过代理；
- **CSP 策略规范**：Wails `AssetServer.Middleware` 的 `Content-Security-Policy` 中 `connect-src` 必须显式包含 `https://*.direct.eqt.net.im:* ws: wss:`，防止内嵌通信通道被浏览器策略拦截。

#### 4.4.3 移动端代理工具分流与 Fake-IP 绕过准则
- **现象与成因**：移动端开启代理应用（如 Clash、Surge、Shadowrocket）时，因 `.im` 为曼岛域名，绝大多数第三方分流规则集（如 ACL4SSR、Loyalsoldier）默认将其划分为境外域名，分配 Fake-IP（`198.18.x.x`）并走境外节点，导致无法路由回局域网私有 IP（`192.168.x.x`）；
- **配置指引**：在代理工具中将 `*.direct.eqt.net.im` 加入直连白名单：
  - 规则分流：`DOMAIN-SUFFIX,direct.eqt.net.im,DIRECT`
  - Fake-IP 过滤：在 `dns.fake-ip-filter` 中加入 `'*.direct.eqt.net.im'`
  - 客户端开关：开启“绕过局域网 (Bypass LAN / 局域网直连)”。

---

## 五、安全威胁模型与纵深防御体系

### 1. 威胁矩阵与防御措施

| 攻击类型 | 威胁场景推演 | 既有旧方案表现 | 演进新架构防御措施 |
| :--- | :--- | :--- | :--- |
| **局域网主动中间人攻击 (LAN MITM)** | 攻击者在公共 Wi-Fi 中通过 ARP 欺骗拦截局域网流量 | **失防**：攻击者提取机器上共享的通配符私钥，伪装服务端并呈现合法绿锁 | **完全免疫**：每台设备本地自生成独立私钥，攻击者无私钥，伪造证书无法通过 TLS 握手 |
| **私钥泄露连坐危机 (Global Blast Radius)** | 某一用户的私钥被木马窃取并在公网公开 | **全网瘫痪**：CA 启动全网证书吊销，全球所有用户的 TLS 功能连坐瘫痪 | **风险隔离**：仅泄露该特定 Node 的子域访问，其他千万台设备证书与密钥完全不受影响 |
| **重放攻击与请求伪造 (Replay / Spoofing)** | 攻击者监听合法的置备请求，重放刷单消耗配额 | 易遭重放 | **严格时钟与验签**：服务端强制 `±60s` 时间戳容差，且签名载荷绑定了时间戳，重放立即被拒 |
| **冒名占用与子域劫持 (Subdomain Takeover)** | 恶意用户伪造他人的 `node_id` 向云端申请证书 | 无法防范伪造身份 | **TOFU 首登强绑定**：D1 首次记录公钥哈希；未携带匹配设备特征的新公钥申请直接返回 403 阻断 |
| **脚本恶意刷爆 CA 配额 (Denial of Wallet/Service)** | 攻击者轮换伪造 `node_id` 疯狂发起置备，消耗配额 | 容易导致 CA 额度耗尽 | **三层立体防刷体系**：Node 级、IP 级以及生产全局熔断闸门，拦截恶意高频置备 |

### 2. 三层立体防刷体系（Multi-Tier Rate Limiting）

置备接口 `POST /api/v1/cert/provision` 构建了三层环环相扣的防御阻断线：

```text
客户端请求 ──► [Layer 1: Node-ID 级限流] (单节点 24h 上限 3 次 ──► 超限 429 rate_limited)
                 │
                 ├──► [Layer 2: 客户端 IP 级限流] (单 IP 24h 上限 10 次 ──► 超限 429 ip_rate_limited)
                        │
                        └──► [Layer 3: 生产全局熔断兜底] (全局 7天 上限 40 次 ──► 超限 429 global_rate_limited)
```

1. **Layer 1（节点级频控）**：防范单客户端死循环重试。单 `node_id` 24 小时内最多允许 3 次成功/失败请求，超限返回 `Retry-After: 86400`；
2. **Layer 2（单 IP 级频控）**：防范内网黑客通过脚本本地伪造海量 `node_id` 刷单。单 Client IP 24 小时内最多允许 10 次请求；
3. **Layer 3（全局生产熔断）**：作为保护公共 CA 额度的最终物理保险丝。全网在滑动 7 天内累计达到 40 次置备请求后，熔断器自动跳闸，直接返回 HTTP 429 与 `Retry-After: 604800`，绝不击穿上游 CA。

---

## 六、当前系统落地实况与代码映射表

下表客观对应系统各核心能力在当前仓库中的实际代码位置与运行状态：

| 模块组件 | 关键能力声明 | 源码物理锚点 | 运行机制与测试状态 |
| :--- | :--- | :--- | :--- |
| **客户端密钥** | 本地 ECDSA P-256 私钥生成与 0600 落盘 | `pkg/cert/provisioner.go:180` (`LoadOrGenerateDeviceKey`) | ✅ 真实生效，私钥永不出机 |
| **客户端 CSR** | CSR 组装（CN/SAN 严格包含单域名与通配符） | `pkg/cert/provisioner.go:269` (`GenerateDeviceCSR`) | ✅ 真实生效，格式符合 RFC 2986 |
| **客户端验签** | IEEE P1363 验签载荷自签名 | `pkg/cert/provisioner.go:307` (`SignProvisionPayload`) | ✅ 真实生效，自动签名 64 字节 |
| **客户端信任锚** | 系统公信根证书链严格校验（拒绝自签假证书） | `pkg/cert/provisioner.go:398` (`VerifyCertificateTrust`) | ✅ 真实生效，`x509.Verify` 锚定系统根 |
| **凭据平滑迁移** | 跨平台目录根统一与防私钥孤儿化迁移 | `pkg/cert/provisioner.go:107` (`MigrateLegacyDeviceCredentials`) | ✅ 真实生效，结果驱动且防止误死锁 |
| **置备超时管理** | 独立 45 秒专有置备 HTTP 客户端 | `desktop/gui/app.go` (`provisionClient`) | ✅ 真实生效，杜绝 5s 过早截断假死 |
| **客户端回环** | IPv4 算法无状态域名格式化 | `pkg/cert/provisioner.go:48` (`FormatDirectDomainWithNode`) | ✅ 真实生效，双模式无状态映射 |
| **桌面端状态机** | 前端五态机与安全锁 SVG 联动展示 | `desktop/gui/frontend/src/components/tls_status.js:52` | ✅ 真实生效，`disabled/ready/mismatch...` |
| **桌面端降级** | TLS 失败切断开关 (Fail-Closed) 与传输软降级 | `desktop/gui/app.go:2326`, `desktop/gui/agent.go` | ✅ 真实生效，普通 HTTP 传输不中断 |
| **代理与 CSP** | WebView2 代理穿透参数与 CSP 白名单注入 | `desktop/gui/main.go:285`, `desktop/gui/main.go:420` | ✅ 真实生效，绕过系统代理拦截 |
| **下载头规范** | WebKit 兼容私有缓存头与显式 MIME 映射 | `server/router.go` (`Cache-Control: private, no-transform`) | ✅ 真实生效，消除 Safari 下载中断 |
| **权威 DNS** | 算法无状态 IPv4 回环 A 记录解析引擎 (TTL 300s) | `cmd/eqt-dns/main.go:137` (`parseIP`), `:213` | ✅ 真实生效，双机 53 端口稳定运行 |
| **权威 DNS** | 内存级同名多值 TXT 管理器 (TTL 60s) | `cmd/eqt-dns/main.go:45` (`AcmeStore`), `:230` | ✅ 真实生效，支持双质询同时发布 |
| **云端网关** | RFC 8555 GTS ACME EAB 官方签发引擎 | `cloudflare/eqt-drm-api/src/routes/cert.ts:1074` | ✅ 真实生效，对接 Google Public CA |
| **云端网关** | 双域名 DNS-01 验证防竞态与双机强一致写入 | `cloudflare/eqt-drm-api/src/routes/cert.ts:1130-1160` | ✅ 真实生效，确认传播后触发验证 |
| **云端网关** | TOFU 设备公钥绑定与受控轮换 | `cloudflare/eqt-drm-api/src/routes/cert.ts:920-968` | ✅ 真实生效，绑定 D1 `node_public_keys` |
| **云端网关** | 三层立体防刷体系 (Node 3 / IP 10 / 全局 40) | `cloudflare/eqt-drm-api/src/routes/cert.ts:756-815` | ✅ 真实生效，超限返回 429 与 Retry-After |

---

## 七、当前系统已知缺陷、瓶颈与风险评估

在当前的工程落地与基础设施运行中，本系统客观存在以下架构瓶颈、已知缺陷与潜在风险。本节实事求是地逐一剖析，绝不隐瞒：

### 1. Google CA (GTS) 配额墙与全局熔断容量瓶颈【高危 · 业务容量】

- **缺陷现象**：
  网关设置的第三层全局熔断为 **40 次置备请求 / 7 天**。一旦触发熔断，后续所有新设备的置备请求将收到 HTTP 429（`reason_key: 'global_rate_limited'`）以及长达 7 天的冷却周期（`Retry-After: 604800`）。
- **根因分析**：
  1. **计数对象是“请求次数”而非“成功用户数”**：当前限流计算发生在签发**之前**（`cert.ts:802`）。若某次置备因网络波动、DNS 超时而失败重试，一次失败即消耗一次宝贵额度；仅当所有请求均一次性成功时，40 次请求才等价于 40 个新用户；
  2. **公共 CA 顶级域名硬限额约束**：在公共 CA 体系中，未获得配额豁免的主域名受限于 CA 的全局频控策略。为确保绝对不被 Google CA 封禁或拉黑，当前必须保守设置 40 次硬顶。
- **缓解与现状**：
  出厂默认将局域网 TLS 设置为关闭（`enableTLS: false`），由对隐私安全有高度进阶需求的用户在设置中主动开启；核心文件传输功能 100% 基于普通 HTTP 运行，不受配额墙任何影响。

### 2. 四维感知监控体系未完全闭环【中危 · 运维可观测性】

- **缺陷现象**：
  系统尚无法提前预测或主动感知配额见顶风险，运维人员无法在触碰限制墙前收到预警。
- **现状实测核对**：
  - **第一维（前置水位感知与 Webhook 告警）**：**【未建成】**。目前 D1 计数器仅作拦截判断，未实现 70% / 85% 水位告警逻辑，亦无 Telegram / 企业微信 Webhook 实时通知；
  - **第二维（云端网关拦截分层日志）**：**【已建成】**。命中限流会触发 `logRateLimitHit()` 写入 D1 `system_error_logs` 表，Admin 管理后台可通过 `/api/v1/admin/error-logs` 与 `rate_limit_hits_24h` 统计查看；
  - **第三维（上游 CA 错误捕获）**：**【已建成】**。网关在捕获到 CA 报错时，通过 `logSystemError` 将 CA 原始错误无损沉淀至 D1；
  - **第四维（端侧体验与状态闭环）**：**【已建成】**。端侧捕获 429 后提取 `Retry-After`，自动切断 TLS 开关（Fail-Closed）并提示冷却期，防止无意义重试。

### 3. TOFU 绑定的自愈边界与 D1 弱一致性窗口【中危 · 密码学与容灾】

- **缺陷现象**：
  若用户的本地私钥因清理缓存丢失，且客户端无法提供强绑定的 `device_id`，向网关申请置备将收到 `403 node_key_mismatch`。
- **现状与缓解措施**：
  - **客户端已实现 Salt 自愈**：桌面端在捕获到 `node_key_mismatch` 后，调度内核会自动在本地注入随机盐（Salt），重新派生全新的 Node ID 并重试，从而摆脱被锁死的 Node ID；
  - **D1 故障时的 Fail-Open 隐患**：在 `cert.ts:983` 中，若 D1 数据库发生偶发性查询异常，网关为了可用性选择记录警告并放行签发（Fail-Open）。这虽然保障了服务不中断，但在数据库故障窗口期内，TOFU 绑定防冒领功能将暂时失效。

### 4. 缺少证书吊销通道（Revocation Gap）与长时运行续签巡检缺失【低-中危 · 安全与可用性】

- **无主动吊销通道**：
  本系统未建立 OCSP Stapling 或 CRL 检查机制。若某台设备的本地私钥在物理上被第三方拷贝窃取，云端和客户端均无法向公共 CA 主动吊销该证书，该证书只能等待 90 天有效期自然届满；
- **长时守护进程续签缺失**：
  客户端的证书有效期检查与静默续签仅在**应用启动时（`App.startup` 启动后 3 秒）**触发一次。对于数周不重启、持续在后台常驻运行的桌面端设备，若证书在运行期间过期，系统缺少一个基于 Ticker 的周期性后台巡检协程。

### 5. 移动端代理分流与 Fake-IP 劫持陷阱【环境兼容陷阱】

- **缺陷现象**：
  手机端开启代理软件（Clash、Surge、Shadowrocket 等）后，扫描局域网生成的二维码无法打开页面或提示超时。
- **根因分析**：
  由于 `.im` 属于英国海外属地曼岛顶级域名，绝大多数第三方分流规则集（如 ACL4SSR、Loyalsoldier）默认将其划分为境外域名，由 TUN 虚拟网卡分配 Fake-IP（`198.18.x.x`）并转发至境外 VPS 代理。境外代理节点无法路由回用户的局域网私有 IP（`192.168.x.x`），导致连接超时。
- **解决指南**：
  必须在移动端代理工具中将 `*.direct.eqt.net.im` 加入直连规则（`DOMAIN-SUFFIX,direct.eqt.net.im,DIRECT`），并在 DNS 设置的 `fake-ip-filter` 中加入该域名，开启“绕过局域网”。

---

## 八、规模化推广与后续演进路线图

为了在未来支撑千万级设备规模化放量，系统规划了三阶段演进路径：

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 阶段一：当前受限精细化运营阶段 (现状 · v1.36.123+)                                      │
│                                                                                        │
│   • 策略: 默认关闭局域网 TLS，核心传输 100% 免疫；主动开启用户受全局 40次/周 熔断保护； │
│   • 目标: 验证双机权威 DNS 算法无状态解析稳定性与端到端 GTS 公信绿锁体验。             │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 阶段二：多 CA 动态路由与配额水位感知阶段 (中期演进)                                     │
│                                                                                        │
│   • 建设四维感知第一维: 建立 70%/85% 配额水位实时监测，实现 Telegram/Webhook 告警；   │
│   • Google CA 官方提额: 向 Google Trust Services 申请主域配额扩容（提升至数万张/周）； │
│   • 双轨热备故障转移: 搭建 GTS + Let's Encrypt 双 CA 动态切换，遇到 429 自动无缝降级。│
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 阶段三：Mozilla Public Suffix List (PSL) 彻底破局阶段 (终局方案)                        │
│                                                                                        │
│   • 官方收录: 推动 `direct.eqt.net.im` 正式并入 Mozilla PSL PRIVATE 分区 (PR #3258)；  │
│   • 数学脱钩: 成为公共后缀后，每个 `<node_id>.direct.eqt.net.im` 被 CA 视为独立主域名；  │
│   • 无限容量: 彻底摆脱顶级主域名每周限额，系统具备无限扩展并发能力，全量默认开启绿锁。   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 九、附录：工程审查红线与方法论沉淀

在系统的长期迭代与 38 轮工程复核中，团队沉淀了以下不可逾越的研发与审查红线：

1. **绝对禁止私钥出机**：任何方案、调试脚本或日志打印，严禁将设备端生成的私钥（`privkey.pem`）发送至云端或记录至公开文本；
2. **拒绝同义反复，测试必须具备反向可证伪性（Rule 9）**：
   - 编写单元测试或集成测试时，严禁在测试代码中复制一遍生产算法再进行断言；
   - 必须通过“人为破坏生产代码分支，测试立即转红”来验证测试的判别力。测试全绿不代表被测代码被执行；
3. **Fail-Loud 与资源前置清理闭环（Rule 12）**：
   - 任何加固分支抛出异常前，必须审查是否破坏了资源清理流程。在注册外部资源（如向权威 DNS 注入 TXT）时，必须采用“前置注册 Cleanup 闭包 + 局部失败即刻回滚”的坚固模式；
4. **编译期严格门禁覆盖三层环境**：
   - 静态类型检查（`tsc --noEmit`）必须覆盖本地 pre-commit 钩子、单元测试前置执行、以及 GitHub Actions 远端 CI 流水线，防止由于动态脚本特性导致未声明变量上线；
5. **代码事实与文档严密对齐**：
   - 文档中引用的所有配置、URL、标识符、函数名，必须与仓库代码真实状态逐字对齐，严禁基于历史记忆或过度承诺进行虚构描述。
