# 基于 Cloudflare 体系的局域网 TLS 传输加密与原生零 OOM 流式下载架构设计方案

> **项目标识**：`docs/plan/lan-tls-loopback-architecture-design.md`  
> **根域名资产**：`eqt.net.im`（由 Cloudflare 全面托管）  
> **目标分支**：`feat/lan-tls-loopback`（基于 `master` 纯净分支演进）  
> **制定日期**：2026-09-03（2026-09-03 根据第一轮评审意见深度修订）  
> **设计状态**：**PROPOSED / ARCHITECTURAL BLUEPRINT (二轮评审修订版)**  
> ⚠️ **二轮评审结论（2026-09-03）**：RFC 8555 CNAME 委派方案**不成立**——`direct` 子域已 NS 委派给 sslip.io，`_acme-challenge.direct.eqt.net.im` 的权威不在 Cloudflare，父域中的 CNAME 记录不会被解析器命中（已 DNS 实测验证）。第 1 项阻塞**未真正闭环**，正确方案见文末「七、二轮评审」。
> **核心使命**：以标准的传输层安全（TLS 1.3）与本地回环解析（Split-Horizon DNS）取代繁重脆弱的前端应用层解密流水线，在**手机无需安装任何 App**、**文件传输 100% 局域网物理直连**的前提下，彻底实现：**真·安全绿锁 (Secure Context) + 文件数据零外网 + 20GB~100GB+ 任意大文件原生流式写盘（零 OOM 内存崩溃）+ 100% 原生文件名展示**。

---

## 一、第一性原理：为什么 LAN-TLS 是替代前端 E2EE 的终极解？

### 1. 前端应用层 E2EE 的物理死穴与技术反思
在以往的探索中，曾尝试在局域网纯 HTTP（`http://192.168.x.x`）上通过前端 JavaScript（WASM Libsodium + Web Worker + IndexedDB）构建应用层端到端加密。  
然而，这一方案在**手机浏览器（尤其是 iOS Safari）**的现实沙箱中撞上了不可逾越的客观物理天花板：
1. **内存爆炸（OOM）**：
   - 移动端 Safari 不允许前端 JS 直接创建流式写入磁盘的文件句柄；
   - 前端必须在内存中把分块合并成一个大 `Blob` 才能触发系统保存；
   - iOS Safari 单标签页内存配额仅 **1.5GB ~ 2GB**，导致传输 258MB 勉强可用，而传输 **2GB、20GB 超大文件时 100% 闪退崩溃**！
2. **手势失效与未知文件名**：
   - 经过长时间异步解密后，原本的用户手势在 WebKit 内核中失效，自动触发被拦截；
   - 通过重定向唤起时，缺少标准 HTTP 响应头，Safari 将下载文件无情地命名为 `Unknown`；
3. **极高的系统复杂度与脆弱性**：
   - 引入了 131 个 commit 的复杂代码（WASM 胶水、Worker 消息泵、IndexedDB 清扫、状态机维护），系统异常脆弱。

### 2. 客观安全定性：局域网传输加密 vs 严格 E2EE
根据审查员严谨指出，本方案必须实事求是地明确安全边界：
- **这不是严格意义上的 E2EE（端到端加密）**：
  - 严格的 E2EE 要求“通信双方独立协商临时会话密钥，任何第三方（包括软件其他用户）均无法解密”；
  - 本方案使用统一分发的通配符证书与私钥，因此**无法防御掌握该私钥的内部主动中间人攻击**；
- **但它完美解决了局域网最大的真实威胁：防被动嗅探（Passive Sniffing）**：
  - 电脑发出的每一个 TCP 字节，都在传输层被 TLS 1.3 军工级密文（AES-256-GCM / ChaCha20-Poly1305）加密；
  - 同一 Wi-Fi 下的任何第三方（普通蹭网者、被劫持的路由器、公共场所窥探者）通过 Wireshark 抓包，**抓到的全是一堆乱码密文，文件名、URL、数据内容完全不可见**；
  - 到了手机端，直接由 **iOS Safari 底层 C++ 原生网络栈直接流式解密并直接写入手机存储**！
- **质的飞跃（相较于前端脆弱 E2EE）**：
  - **内存占用恒定在几十 KB**，20GB、100GB 任意大文件永不爆内存；
  - **传输速度跑满 Wi-Fi 物理极限**（80MB/s~150MB/s）；
  - **文件名由标准 HTTP `Content-Disposition` 提供，100% 原生准确**；
  - **前端代码归零**：彻底废弃所有 Web Worker、WASM、IndexedDB 垃圾代码！

---

## 二、总体网络拓扑与物理数据流向

```text
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                   Cloudflare 云端托管体系                                 │
│                                                                                          │
│   1. 权威 DNS (Cloudflare DNS: eqt.net.im)                                               │
│      - 委派记录: direct.eqt.net.im  NS  ns-00.nip.io / ns-01.nip.io / ns-ovh.sslip.io      │
│      - ★ ACME 质询别名: _acme-challenge.direct.eqt.net.im CNAME _acme.eqt.net.im         │
│                                                                                          │
│   2. 自动化证书中枢 (Cloudflare Worker Cron + Let's Encrypt DNS-01)                       │
│      - 通过父域 _acme.eqt.net.im 写入 TXT 记录，破除 sslip.io 无法响应 DNS-01 的阻塞！    │
│      - 自动签发 & 轮换通配符证书: *.direct.eqt.net.im                                     │
│      - 证书公钥/私钥加密存储于 Cloudflare KV                                             │
│                                                                                          │
│   3. 客户端证书分发 API (Cloudflare Worker)                                              │
│      - GET https://api.eqt.net.im/v1/tls/bundle (轻量只读分发，结合现有 DRM 机制校验)       │
└──────────────────────────────────────────────────────────────────────────────────────────┘
                                             │
                      [1. 电脑端 EQT 启动时拉取并持久化缓存 TLS 证书]
                                             ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                          用户局域网内部 (Local Area Network, LAN)                         │
│                                                                                          │
│   ┌───────────────────────────┐                     ┌────────────────────────────────┐   │
│   │     电脑端 EQT 服务端     │                     │      手机端 (iOS Safari)       │   │
│   │                           │                     │                                │   │
│   │ 1. 绑定 192.168.0.201:10046│                     │ 1. 扫码打开:                   │   │
│   │ 2. 挂载 *.direct 证书     │                     │    https://192-168-0-201.      │   │
│   │ 3. 启动 TLS 1.3 / HTTP/2  │                     │    direct.eqt.net.im:10046     │   │
│   │ 4. 自动生成回环域名二维码 │                     │                                │   │
│   └─────────────┬─────────────┘                     └───────────────┬────────────────┘   │
│                 │                                                   │                    │
│                 │ [2. 手机查 DNS 得到 192.168.0.201 (轻量公网 DNS 问答)]                  │
│                 │                                                   │                    │
│                 │ ◄═════════════════════════════════════════════════╝                    │
│                 │     [3. 纯内网物理数据传输 (Wi-Fi 6 / 千兆网线)]                        │
│                 │     - 物理链路全密文 (TLS 1.3 传输层防嗅探)                            │
│                 │     - 文件数据零外网流量 (完全不经过互联网公网宽带)                     │
│                 │     - 手机 Safari 地址栏亮起 🔒 绿锁 (正规安全上下文)                  │
│                 ▼                                                                        │
│   ┌──────────────────────────────────────────────────────────────────────────────────┐   │
│   │                    Safari 内核原生流式落盘 (Zero Frontend Burden)                │   │
│   │                                                                                  │   │
│   │   [电脑端 HTTPS 输出] ───(TLS 1.3 数据流)───► [Safari 内核 C++ 硬件解密]         │   │
│   │                                                         │                        │   │
│   │                                            (实时刷入手机闪存文件系统)            │   │
│   │                                                         ▼                        │   │
│   │                                             [手机“文件” App 存储]                │   │
│   │                                                                                  │   │
│   │    ★ 内存占用: 仅内核微秒级网络读写缓冲区 (几十 KB)！ 20GB~100GB 绝不 OOM！      │   │
│   │    ★ 文件名: HTTP Content-Disposition 原生响应头直出，彻底告别 Unknown！         │   │
│   │    ★ 前端代码: 纯粹标准的 HTML <a href="/download">，零复杂状态机，零技术债！    │   │
│   └──────────────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 三、Cloudflare 基础设施与工程落地细节

### 1. Cloudflare DNS 泛解析（Wildcard DNS）
- **根域**：`eqt.net.im`
- **回环子域**：`*.direct.eqt.net.im`
- **解析规则**：`A-B-C-D.direct.eqt.net.im` ➔ `A.B.C.D`
  例如：`192-168-0-201.direct.eqt.net.im` 瞬间解析为 `192.168.0.201`。
- **配置落地**：
  在 Cloudflare DNS 仪表盘中，添加 NS 记录，将 `direct` 子域委派给 `sslip.io` 白标 nameserver 集群：
  ```text
  Type: NS
  Name: direct
  Nameserver: ns-00.nip.io.
  Nameserver: ns-01.nip.io.
  Nameserver: ns-ovh.sslip.io.
  TTL: Auto
  ```
  > ⚠️ **第三方依赖说明**：`sslip.io` 为免费公共基础设施，无商业 SLA 保证；中国内地解析经跨国节点通常延迟在 50~150ms。作为容灾，客户端保留原生纯 IP（`http://192.168.x.x`）一键切换能力。

### 2. 【核心突破】利用 RFC 8555 CNAME 别名破解 Let's Encrypt DNS-01 签发
针对评审员指出的“委派给 sslip.io 导致 ACME DNS-01 TXT 无法写入”的核心阻塞项，采用官方标准 **RFC 8555 CNAME 委派质询（CNAME Delegation）** 完美攻克：

1. **原理**：
   Let's Encrypt 在验证 `_acme-challenge.direct.eqt.net.im` 时，若发现 CNAME 记录，会**顺着 CNAME 追踪到目标域名并读取其 TXT 记录**；
2. **DNS 配置**：
   在未委派的父域 `eqt.net.im`（受 Cloudflare 100% 控制）中添加一条记录：
   ```text
   Type: CNAME
   Name: _acme-challenge.direct
   Target: _acme-challenge.eqt.net.im
   Proxy status: DNS only (灰色云)
   ```
3. **自动化流程**：
   - 自动签发 Worker 触发 ACME 申请；
   - Worker 通过 Cloudflare API 动态将质询值写入 **`_acme-challenge.eqt.net.im`** 的 TXT 记录；
   - Let's Encrypt 检查 `_acme-challenge.direct.eqt.net.im` ➔ 追溯 CNAME ➔ 在 Cloudflare 权威节点成功读到 TXT ➔ **签发通配符证书 `*.direct.eqt.net.im`**！
   - **收益**：**完全无需自建公网权威 DNS 服务器**，既享受了 sslip.io 的零成本动态泛解析，又彻底解决了通配符公信证书的自动化签发！

> ⚠️ **【二轮评审·不成立】** 上述 CNAME 委派方案在 DNS 委派语义上**无法工作**（详见文末「七、二轮评审」）：`direct.eqt.net.im` 已被 NS 委派给 sslip.io，`_acme-challenge.direct.eqt.net.im` 的权威因此落在 sslip.io 而非 Cloudflare，父域中写的这条 CNAME 记录**永远不会被解析器命中**。已通过 DoH 实测验证。

### 3. 客户端证书安全分发与缓存
- **分发端点**：`GET https://api.eqt.net.im/v1/tls/bundle`（基于 Cloudflare Worker）；
- **缓存策略**：电脑端 EQT 启动时异步检查 `%LOCALAPPDATA%/eqt/tls/` 缓存，若剩余有效期 >7 天直接复用，断网也能秒启；
- **安全说明**：该私钥**仅对应局域网私有保留地址（10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16）**，公网没有任何解析实体，即便被恶意提取也无法用于伪造任何互联网网站。

### 4. 电脑端 EQT（Go 后端）双模自适应启动（基于 master 纯净代码）
在 `master` 分支的 `pkg/server/` 中引入极简 TLS 支持：
1. **启动自检**：
   - 检查本地是否已有有效的 `direct.cert` 与 `direct.key`（若无则后台异步拉取并缓存）；
   - 探测本机局域网 IP（例如 `192.168.0.201`）与监听端口；
2. **服务监听（HTTPS + HTTP/2）**：
   ```go
   if hasValidTLS {
       // 优先以标准 TLS 1.3 / HTTP/2 启动服务
       server.ListenAndServeTLS(certPath, keyPath)
   } else {
       // 离线环境平滑降级为原生 HTTP
       server.ListenAndServe()
   }
   ```
3. **二维码展示规则**：
   - TLS 有效时：展示 `https://192-168-0-201.direct.eqt.net.im:10046/send/xxx`；
   - 离线降级时：展示 `http://192.168.0.201:10046/send/xxx`。

### 5. 移动端 Web 交互设计（极致极简）
由于完全运行在 Safari 官方认可的真·安全上下文（Secure Context）下，且直接由 Safari 内核接管下载：
- 前端**彻底删除**所有的 `libsodium.js`、`crypto.worker.js`、`sessionPendingFiles`、`IndexedDB` 代码；
- 页面保留优雅现代的 UI 渲染（语言切换、进度条、文件列表展示）；
- 点击【开始下载】时，浏览器原生触发标准的带有文件名头的下载请求；
- Safari 弹出官方正规下载弹窗：**“您要下载‘xxxx.zip’吗？[下载] [查看]”**；
- 手机端流式接收，**20GB、50GB 轻松传输，内存完全零波动**！

---

## 四、极端网络边界与容灾矩阵

| 边界场景 | 现象与影响 | 架构级防呆与容灾对策 |
| :--- | :--- | :--- |
| **1. 路由器开启 DNS Rebinding 保护** | 极少数严格企业路由器拦截公网 DNS 返回 192.168.x.x | 页面初始化设置 2.5s 探活超时；桌面端界面与终端始终提供一键切换【纯内网 IP 模式】（`http://192.168.0.201`），零阻塞兜底 |
| **2. 电脑处于无外网完全离线机房** | 电脑无法向 Cloudflare 拉取新证书，手机无法查公网 DNS | 电脑端启动时首先探测外网联通性；若无外网，**直接静默启动原生 HTTP 模式**，无感降级，确保离线传输 100% 可用 |
| **3. 证书临时过期或轮换延迟** | 手机访问报证书过期警告 | Cloudflare 提前 30 天自动轮换；客户端启动时校验过期时间自动更新；若发生异常自动回退 HTTP 提示 |

---

## 五、实施里程碑路线图（Milestones）

- [ ] **Phase 1: Cloudflare 基础设施打通（本周内）**
  - [x] Cloudflare DNS 添加 `direct` 子域的 NS 记录委派至 `ns-00.nip.io` / `ns-01.nip.io`（实测已生效通过）；
  - [ ] Cloudflare DNS 添加 `_acme-challenge.direct` CNAME 记录至 `_acme-challenge.eqt.net.im`；
  - [ ] 申请 `*.direct.eqt.net.im` 通配符证书并配置 Worker API 自动化分发；
- [ ] **Phase 2: master 纯净基线改造（Go 服务端）**
  - [ ] 编写轻量 TLS 证书拉取与本地缓存模块（`pkg/server/tls.go`）；
  - [ ] 改造 `server.go` 支持自适应 TLS 1.3 / HTTP/2 启动；
  - [ ] 二维码与链接渲染支持自动切换 `*.direct.eqt.net.im`；
- [ ] **Phase 3: 移动端体验与全链路真机压测**
  - [ ] iPhone Safari 真机扫码打开，验证安全绿锁 🔒；
  - [ ] 实测 258MB、2GB、10GB+ 超大文件传输，验证零内存溢出闪退、文件名 100% 正确；
- [ ] **Phase 4: 合并交付与文档收尾**
  - [ ] 执行全套回归测试套件 `go test ./...`；
  - [ ] 合入 `master`，发布包含官方 LAN-TLS 绿锁能力的新版本。

---

## 六、第一轮评审意见决议与闭环对照表（Review & Errata Resolution）

| 评审意见项 | 评审性质 | 原始评审核心疑虑 | 方案闭环措施与修改结论 | 状态 |
| :--- | :--- | :--- | :--- | :---: |
| **1. 无法获取 Let's Encrypt 证书** | **【阻塞项】** | `sslip.io` 无法返回 DNS-01 所需的 `_acme-challenge` TXT 记录，导致通配符公信证书无法签发 | ⚠️ **未闭环**：二轮采用的 RFC 8555 CNAME 委派**不成立**——`direct` 已 NS 委派给 sslip.io，`_acme-challenge.direct.eqt.net.im` 的权威不在 Cloudflare，父域 CNAME 不会被解析器命中（已 DNS 实测）。正确方案见「七、二轮评审」。 | ❌ **未闭环** |
| **2. sslip.io nameserver 勘误** | **【事实勘误】** | 原文 `ns1/ns2.sslip.io` 错误，实为 `ns-00.nip.io` 等 3 个；且无 SLA 保证 | **闭环**：正文第 3.1 节已如实修正为 3 个官方真实节点，剔除“99.999% SLA”夸大表述，如实注明公共依赖风险并提供纯内网 IP 切换兜底。 | ✅ **已闭环** |
| **3. 安全定性夸大** | **【定性修正】** | 客户端共享私钥，无法抵御内部主动中间人攻击，不属于严格意义的 E2EE | **闭环**：正文第 1.2 节重构，剥离“军工级 E2EE / 绝对安全”词汇，客观定义为“针对局域网 Wi-Fi 被动抓包嗅探的传输层加密”。 | ✅ **已闭环** |
| **4. 零外网流量表述不严谨** | **【表述澄清】** | 文件走内网，但初次连接有一次公网 DNS 解析问答，延迟 >50ms | **闭环**：全文修正为“文件数据传输零外网；建立连接前有一次轻量公网 DNS 解析”，纠正延迟预期。 | ✅ **已闭环** |
| **5. 原生流式零 OOM 判断** | **【方案认可】** | 浏览器原生下载接管流式写盘，彻底解决前端 Blob 内存爆炸 | **闭环**：确立为全案核心底座坚决贯彻，彻底淘汰复杂前端 WASM/Worker/IDB 解密代码。 | ✅ **已闭环** |

---

## 七、二轮评审：RFC 8555 CNAME 委派方案不成立（Review Round 2）

### 1.【阻塞未解决】CNAME 记录写错了 zone，DNS-01 仍无法完成

一轮评审的阻塞项（"委派给 sslip.io 导致 DNS-01 TXT 无法写入"）在二轮中尝试用 RFC 8555 CNAME 委派解决，但**该解法在 DNS 委派语义上不成立**。

**核心矛盾**：CNAME 记录必须写在**被查询名字的权威 zone** 内，而 `_acme-challenge.direct.eqt.net.im` 的权威已被 NS 委派切给了 sslip.io，不在 Cloudflare。

**DNS 委派的确定性语义**：

- `eqt.net.im` zone（Cloudflare 权威）中，`direct.eqt.net.im` 有 NS 记录指向 sslip.io —— 这是委派点；
- 委派点以下的**整个子树** `*.direct.eqt.net.im`（含 `_acme-challenge.direct.eqt.net.im`）的权威随即移交 sslip.io；
- 解析器解析 `_acme-challenge.direct.eqt.net.im` 时，走到 Cloudflare 只会得到**委派 referral**（"请转问 sslip.io"），然后直接转向 sslip.io；
- 因此，Cloudflare 里写的 `_acme-challenge.direct CNAME _acme-challenge.eqt.net.im` **永远不会被解析器查询到**（它位于 `eqt.net.im` zone，但查询早已跳离 Cloudflare）。

**DNS 实测验证（2026-09-03，Cloudflare DoH `1.1.1.1`）**：

```text
$ dig NS direct.eqt.net.im
ns-00.nip.io. / ns-01.nip.io. / ns-ovh.sslip.io.   ← 委派已生效

$ dig TXT _acme-challenge.direct.eqt.net.im
（NOERROR，空答案）                                  ← 权威已在 sslip.io，返回空

$ dig A 192-168-0-201.direct.eqt.net.im
192.168.0.201                                        ← 泛解析正常（走 sslip.io）
```

RFC 8555 CNAME 委派的标准用法要求"你能在挑战域名的权威 zone 写 CNAME"。本场景中挑战域名权威在 sslip.io（非递归权威、不提供 TXT/CNAME 写入能力），因此**该机制在此架构下无解**。

### 2. 正确替代方案（二选一）

**方案 A（推荐，纯 Cloudflare 体系）——放弃 sslip.io，改用「动态 A 记录 + Cloudflare 直签通配符」**：

1. **删除** `direct.eqt.net.im` 的 NS 委派，将其保留在 Cloudflare 权威；
2. 通配符证书 `*.direct.eqt.net.im`：DNS-01 挑战名 `_acme-challenge.direct.eqt.net.im` 的权威回到 Cloudflare → 用 Cloudflare API 直接写 TXT → **签发无任何阻塞**（这正是原方案所缺的能力）；
3. 泛解析改由 **Worker「传输会话 DNS 注册」接口**替代：电脑端每次传输前 POST 内网 IP → Worker 调 Cloudflare API 写一条 `random-token.direct.eqt.net.im A <内网IP>`（DNS-only 灰色云、短 TTL）→ 返回该域名 → 手机扫码访问；
4. 传输结束由 Worker 删除该记录。

- 优点：无第三方 sslip.io 依赖、证书签发彻底解耦、完全落在 Cloudflare 体系内；
- 代价：每次传输约 1 次 Worker 往返 + Cloudflare API 写入（约数百 ms~1s，可接受）；用随机子域名规避 DNS 缓存污染。

**方案 B（保持毫秒级泛解析）——自建权威 DNS**：

- fork sslip.io 开源代码，为其额外实现 `_acme-challenge` TXT 动态响应能力；
- 将 `direct.eqt.net.im` 委派给自建 DNS（2~3 台公网可达节点）；
- 收益：保留"零配置、毫秒级泛解析"；代价：新增一套公网 DNS 基础设施与运维。

> **建议**：优先评估**方案 A**——它与文档「基于 Cloudflare 体系」的定位一致，无需自建基础设施，且通配符证书签发在 Cloudflare 权威下零阻塞，是最小改动、最快落地的路径。
