# 基于 Cloudflare 体系的局域网 TLS 传输加密与原生零 OOM 流式下载架构设计方案

> **项目标识**：`docs/plan/lan-tls-loopback-architecture-design.md`  
> **根域名资产**：`eqt.net.im`（由 Cloudflare 全面托管）  
> **目标分支**：`feat/lan-tls-loopback`（基于 `master` 纯净分支演进）  
> **制定日期**：2026-09-03（经两轮架构评审最终定稿）  
> **设计状态**：**APPROVED ARCHITECTURAL BLUEPRINT (二轮评审决议闭环版)**  
> **核心使命**：以**纯 Cloudflare 权威体系（动态会话 A 记录 + 通配符 TLS 1.3）**彻底替代前端应用层脆弱的 E2EE（WASM/Worker/IDB），在**手机无需安装任何 App**、**文件数据 100% 局域网物理直连**的前提下，彻底实现：**官方公信安全绿锁 (Secure Context) + 文件数据零外网 + 20GB~100GB+ 任意大文件原生流式写盘（零 OOM 内存崩溃） + 100% 原生正确文件名展示**。

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

## 二、架构决策演进与二轮评审定调（为什么选择纯 Cloudflare 方案）

在方案演进中，针对“局域网 IP 如何与合法证书结合”经历了三次关键决议：

```text
[初代构想: NS 委派 sslip.io] ──(一轮评审阻塞: sslip.io 无法响应 DNS-01 TXT)──►
[二轮尝试: RFC 8555 CNAME 委派] ──(二轮评审证伪: DNS 委派点下子树跳转，CNAME 无法被查询)──►
[最终裁决: 纯 Cloudflare 体系 (方案 A)]
  ├── 1. 彻底移除 NS 委派，*.direct.eqt.net.im 权威 100% 留在 Cloudflare
  ├── 2. 通配符证书 *.direct.eqt.net.im 在 Cloudflare 权威下通过 DNS-01 直签，零阻塞！
  ├── 3. 局域网 IP 映射改由 Worker「动态会话 A 记录」提供，零外部不可靠依赖！
```

**方案 A 的决定性优势**：
1. **零外部第三方依赖**：彻底脱离无 SLA、无商业保障的免费公共服务（`sslip.io` / `nip.io`）；
2. **全球顶级解析性能**：直接由 Cloudflare 全球 Anycast 节点解析，国内延迟低至 2~10ms（远快于跨国境外节点）；
3. **会话级隔离与防污染**：会话专属子域（如 `s-a1b2c3d4.direct.eqt.net.im`），有效避免内网 IP 冲突与 DNS 缓存混淆。

---

## 三、总体网络拓扑与物理数据流向（纯 Cloudflare 闭环）

```text
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                   Cloudflare 云端托管体系                                 │
│                                                                                          │
│   1. 权威 DNS (Cloudflare DNS: eqt.net.im) —— 权威 100% 留驻 Cloudflare                     │
│      - 无任何第三方 NS 委派，完全自主可控                                                │
│      - 动态会话 A 记录由 Worker 自动创建与回收 (DNS-only, 短 TTL)                           │
│                                                                                          │
│   2. 自动化证书中枢 (Cloudflare Worker Cron + Let's Encrypt DNS-01)                       │
│      - 权威在 Cloudflare，Worker 直接通过 Cloudflare API 写入 _acme-challenge TXT         │
│      - 全自动签发 & 轮换公信通配符证书: *.direct.eqt.net.im (零阻塞！)                     │
│      - 证书公钥/私钥加密存储于 Cloudflare KV                                             │
│                                                                                          │
│   3. 核心 API 网关 (Cloudflare Worker: api.eqt.net.im)                                   │
│      - GET  /v1/tls/bundle  ➔ 客户端拉取/更新 TLS 通配符证书包                             │
│      - POST /v1/session/dns ➔ 电脑端传输时注册内网 IP，动态创建 s-<id>.direct A 记录      │
│      - POST /v1/session/end ➔ 传输结束，异步删除该临时 A 记录                             │
└──────────────────────────────────────────────────────────────────────────────────────────┘
                                             │
                  [1. 电脑端启动拉取 TLS 证书；每次传输注册动态 A 记录]
                                             ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                          用户局域网内部 (Local Area Network, LAN)                         │
│                                                                                          │
│   ┌───────────────────────────┐                     ┌────────────────────────────────┐   │
│   │     电脑端 EQT 服务端     │                     │      手机端 (iOS Safari)       │   │
│   │                           │                     │                                │   │
│   │ 1. 绑定 192.168.0.201:10046│                     │ 1. 扫码打开:                   │   │
│   │ 2. 挂载 *.direct 证书     │                     │    https://s-a1b2c3d4.         │   │
│   │ 3. 启动 TLS 1.3 / HTTP/2  │                     │    direct.eqt.net.im:10046     │   │
│   │ 4. 生成动态会话二维码     │                     │                                │   │
│   └─────────────┬─────────────┘                     └───────────────┬────────────────┘   │
│                 │                                                   │                    │
│                 │ [2. 手机查 Cloudflare Anycast DNS 秒级返回内网 IP] │                    │
│                 │                                                   │                    │
│                 │ ◄═════════════════════════════════════════════════╝                    │
│                 │     [3. 纯内网物理数据传输 (Wi-Fi 6 / 千兆网线)]                        │
│                 │     - 物理链路全密文 (TLS 1.3 传输层防嗅探)                            │
│                 │     - 文件数据零外网流量 (完全不经过互联网公网宽带)                     │
│                 │     - 手机 Safari 地址栏亮起 🔒 绿锁 (官方公信安全上下文)               │
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

## 四、工程落地与模块实现规格

### 1. Cloudflare DNS 权威配置与清理
- **清理历史委派**：删除此前在 Cloudflare 添加的 `direct` NS 委派记录，确保 `eqt.net.im` 对 `*.direct.eqt.net.im` 拥有 100% 权威；
- **通配符证书签发（DNS-01 零阻碍）**：
  - 域名：`*.direct.eqt.net.im`；
  - ACME 自动化脚本直接调用 Cloudflare API：在 `eqt.net.im` Zone 内直接创建 `_acme-challenge.direct` 的 TXT 记录；
  - Let's Encrypt 在 Cloudflare 权威节点验证成功，签发全球公信证书！

### 2. Cloudflare Worker API 落地规格
部署在 `api.eqt.net.im` 上的轻量路由：
1. **`GET /v1/tls/bundle`**：
   - 响应通配符证书公钥与私钥（基于 Cloudflare KV 缓存）；
2. **`POST /v1/session/dns`**：
   - **入参**：`{ "sessionId": "a1b2c3d4", "lanIp": "192.168.0.201" }`
   - **逻辑**：调用 Cloudflare API 创建一条 A 记录：
     - Name: `s-a1b2c3d4.direct.eqt.net.im`
     - Content: `192.168.0.201`
     - TTL: `60`（DNS-only 灰色云）
   - **返回**：`{ "domain": "s-a1b2c3d4.direct.eqt.net.im", "ok": true }`
3. **`POST /v1/session/end`**：
   - 传输完成时调用，删除对应 A 记录；
   - **GC 兜底**：Worker Cron 每小时自动扫描并清理创建时间超过 4 小时的孤儿 A 记录。

### 3. 电脑端 EQT（Go 后端）双模自适应启动（基于 master 纯净代码）
在 `pkg/server/` 中接入纯净 TLS 流程：
1. **启动自检**：
   - 检查本地是否已有有效的 `direct.cert` 与 `direct.key`（若无则后台异步拉取并落盘缓存）；
   - 检测本机活动局域网 IP（例如 `192.168.0.201`）；
2. **服务监听与二维码生成**：
   - **公网正常**：
     - 调用 `POST /v1/session/dns` 注册动态 A 记录，获得 `s-a1b2c3d4.direct.eqt.net.im`；
     - 以标准 TLS 1.3 / HTTP/2 启动服务（挂载通配符证书）；
     - 二维码呈现：`https://s-a1b2c3d4.direct.eqt.net.im:10046/send/xxx`；
   - **完全离线机房（容灾兜底）**：
     - 若外网不通或 Worker 超时（>2s），**静默降级启动原生 HTTP 模式**；
     - 二维码呈现：`http://192.168.0.201:10046/send/xxx`，确保断网也能传！

### 4. 移动端 Web 交互（极致极简）
- 前端**彻底删除**所有 WASM Libsodium、Worker 消息调度、IndexedDB 分块落盘代码；
- 手机打开页面直接处于 **Safari 官方安全绿锁 🔒** 状态；
- 用户点击【开始下载】后，直接发起带真实文件名头的原生流式下载；
- Safari 弹出官方正规下载弹窗：**“您要下载‘xxxx.zip’吗？[下载] [查看]”**；
- 边收边流式写入闪存，**内存占用仅几十 KB，20GB~100GB+ 极速稳定传输，彻底杜绝 OOM 闪退！**

---

## 五、极端网络边界与容灾矩阵

| 边界场景 | 现象与影响 | 架构级防呆与容灾对策 |
| :--- | :--- | :--- |
| **1. 路由器开启 DNS Rebinding 保护** | 极少数严格企业路由器拦截公网 DNS 返回 192.168.x.x | 页面初始化设置 2.5s 探活超时；桌面端界面与终端始终提供一键切换【纯内网 IP 模式】（`http://192.168.0.201`），零阻塞兜底 |
| **2. 电脑处于无外网完全离线机房** | 电脑无法向 Cloudflare 拉取新证书，无法注册动态 A 记录 | 电脑端启动时首先探测外网联通性；若无外网，**直接静默启动原生 HTTP 模式**，无感降级，确保离线传输 100% 可用 |
| **3. 传输中断或会话异常退出** | 遗留动态 A 记录堆积 | Worker 设置短 TTL，并通过 Cron 定时任务每小时自动执行全局清理，保持 DNS 干净清爽 |

---

## 六、实施里程碑路线图（Milestones）

- [ ] **Phase 1: Cloudflare 基础设施升级（本周内）**
  - [ ] 清理 Cloudflare DNS 中的历史 NS 委派记录，恢复权威掌控；
  - [ ] 申请 `*.direct.eqt.net.im` 通配符证书，并在 Worker 中实现自动轮换与分发 API；
  - [ ] 部署 Worker `POST /v1/session/dns` 动态 A 记录注册与清理接口；
- [ ] **Phase 2: master 纯净基线改造（Go 服务端）**
  - [ ] 编写轻量 TLS 证书拉取与本地缓存模块（`pkg/server/tls.go`）；
  - [ ] 改造 `server.go` 支持动态会话注册与自适应 TLS 1.3 / HTTP/2 启动；
  - [ ] 二维码与链接渲染接入 `s-<id>.direct.eqt.net.im`；
- [ ] **Phase 3: 移动端体验与全链路真机压测**
  - [ ] iPhone Safari 真机扫码打开，验证官方公信绿锁 🔒；
  - [ ] 实测 258MB、2GB、10GB+ 超大文件传输，验证零内存溢出闪退、文件名 100% 正确；
- [ ] **Phase 4: 合并交付与文档收尾**
  - [ ] 执行全套回归测试套件 `go test ./...`；
  - [ ] 合入 `master`，正式发布全新一代局域网安全流式传输特性。

---

## 七、评审意见决议与闭环追踪总表（Review & Errata Resolution）

| 评审意见项 | 评审性质 | 原始评审核心疑虑 | 方案最终闭环措施与修改结论 | 最终状态 |
| :--- | :--- | :--- | :--- | :---: |
| **1. 无法获取 Let's Encrypt 证书** | **【阻塞项】** | NS 委派导致 sslip.io 无法返回 DNS-01 TXT；二轮评审指出 CNAME 方案因 Zone Cut 同样不成立 | **终极闭环（方案 A）**：彻底放弃 NS 委派，将 `*.direct.eqt.net.im` 权威 100% 留驻 Cloudflare；通配符证书通过 Cloudflare API 直接完成 DNS-01 签发（零阻塞！）；局域网 IP 映射改由 Worker 动态创建会话级 A 记录。彻底根除阻塞！ | ✅ **已彻底闭环** |
| **2. sslip.io nameserver 勘误与依赖风险** | **【事实勘误】** | 原 nameserver 错误；公共免费服务无 SLA 承诺，跨境延迟高 | **终极闭环**：全案彻底剔除对第三方 sslip.io / nip.io 的依赖，全链路迁移至 Cloudflare Anycast 原生 DNS（全球延迟 <10ms，高可靠性）。 | ✅ **已彻底闭环** |
| **3. 安全定性夸大** | **【定性修正】** | 客户端共享私钥，无法抵御内部主动中间人攻击，不属于严格意义的 E2EE | **闭环**：正文第 1.2 节重构，客观定性为“针对局域网 Wi-Fi 被动抓包嗅探的传输层加密”，实事求是明确安全威胁模型边界。 | ✅ **已彻底闭环** |
| **4. 零外网流量表述不严谨** | **【表述澄清】** | 文件走内网，但初次连接有一次公网 DNS 解析问答，延迟 >50ms | **闭环**：正文精确定位为“文件数据传输零外网；连接前由 Cloudflare 毫秒级返回一次轻量 DNS 问答”，消灭概念混淆。 | ✅ **已彻底闭环** |
| **5. 原生流式零 OOM 判断** | **【方案认可】** | 浏览器原生下载接管流式写盘，彻底解决前端 Blob 内存爆炸 | **闭环**：确立为全案核心底座坚决贯彻，彻底淘汰复杂前端 WASM/Worker/IDB 解密代码。 | ✅ **已彻底闭环** |

---

## 八、第三轮评审（实现代码审查, commit 10ad097a）—— 文档与代码已脱节, 需决策追认

> **审查对象**：`10ad097a Implement LAN-TLS loopback architecture and dual-node authoritative DNS`
> **审查范围**：`cmd/eqt-dns`（权威 DNS 服务）、`pkg/cert`（域名映射/证书加载）、`pkg/server/server.go`（Secure 接线）、`.agents/skills/eqt-lan-tls/SKILL.md`、go.mod/.gitignore。
> **验证命令**：`go build ./...` ✅；`go vet ./cmd/eqt-dns ./pkg/cert` ✅；`go test ./pkg/cert ./cmd/eqt-dns ./pkg/server -run TestLanTLSLoopbackServer` ✅（本机存在 `~/.config/eqt/certs` 缓存）。
> **总体结论**：代码自身可编译、单测可过、vet 干净，但**落地架构与上文"方案 A = 纯 Cloudflare" 的 APPROVED 定稿互相矛盾**；文档必须先于合并被追认，否则 master 上的文档与代码描述的是两套完全不同的系统。

### 8.1 【阻塞·决策项】架构断层：实现 = 自建双机权威 DNS（方案 C），非 APPROVED 方案 A

| 维度 | 定稿文档（方案 A） | 本提交实际实现（方案 C，自建） |
| :--- | :--- | :--- |
| 权威归属 | `*.direct.eqt.net.im` 权威 100% 留驻 Cloudflare，**彻底移除 NS 委派** | 在 Cloudflare 上做 `direct.eqt.net.im NS ns1/ns2` 委派，权威下沉到 2 台自建 Ubuntu VPS（`cmd/eqt-dns`） |
| IP→域名映射 | Worker 动态会话 A 记录 `s-<id>.direct…`（有状态、短 TTL） | **无状态确定性映射** `192-168-0-201.direct…`（代码内称为 loopback 域，等价 sslip.io 算法） |
| 证书签发 | DNS-01 TXT 由 Cloudflare API 直接写入 | ACME TXT 由自建权威 NS 直接应答，certbot hook 双机 HTTP/SSH 推送 |
| 依赖面 | 纯 Cloudflare Anycast + Worker | 2 台 VPS 常驻在线、打补丁、被监控；公共 53 端口 |

说明：方案 C 自洽且协议上可行（DNS-01 TXT 由被委派权威直接应答，绕开了二轮"RFC 8555 CNAME 委派失效"的坑，也绕开 Cloudflare 动态 A 记录配额/频控/TTL 缓存抖动），因此它**不是 bug，而是一次未经文档追认的方向切换**——`git log 351457b0` 显示"自建权威 DNS"本就是二轮评审挂起的备选。`pkg/cert` 与 server.go 已按方案 C 落地域名映射；`SKILL.md` 也已按方案 C 撰写。**要求**：由作者三选一：(1) 追认方案 C 为最终架构，把本文二~四节与标题 APPROVED 状态整体改写为方案 C；(2) 若坚持方案 A，则废弃 `cmd/eqt-dns`、删除 NS 委派并恢复 Worker 动态 A 记录；(3) 至少把本表与"设计状态"行的"纯 Cloudflare"字样标记为**已被本提交覆盖（SUPERSEDED）**，避免后续以错文档指导部署。合并 master 前文档与代码必须单一权威。

### 8.2 【安全高危】ACME challenge 注入可致域名接管（需修复后上线）

- 现象链：`cmd/eqt-dns/main.go:339` 管理 HTTP 固定绑 `":5380"`（全接口、无 `-listen` 选项）；鉴权在 `main.go:233-239` 仅在配置了 `-token`/`EQT_DNS_TOKEN` 时才生效，而 `SKILL.md` 3.1 的 systemd `ExecStart` **未带 `-token`**，且认证/清理 hook 的 `curl` 对 Node 1 **以明文公网 HTTP 且无任何凭证** POST/DELETE → 任何公网者可向 `http://<IP>:5380/acme/challenge` 注入任意 TXT value；
- 结果：`main.go:169-181` 对**任何** `_acme-challenge.*` 前缀查询无差别回放 store 中全部 value → 攻击者注入自己的 challenge 值后，Let's Encrypt 校验时能看到该值 → 攻击者 ACME 账户可被签发 `*.direct.eqt.net.im` 通配符证书 → **完整域名接管**（同域通配符私钥可冒充本工具全部局域网传输）。
- 修复方向（上线前必做其一/组合）：管理端口只绑 `127.0.0.1` 且两节点统一走 SSH 通道推送（对齐 SKILL 中 Node 2 的既有写法）；或强 Bearer `-token` 并把密钥同步进 hooks；`SKILL.md` systemd 示例必须补齐 `-token <openssl rand -hex 24>` 与 hook 携带 `Authorization`。代码侧建议：新增 `-http-listen` 参数、校验 value 仅允许 ACME base64url `[A-Za-z0-9_-]` 且 ≤255 字节。

### 8.3 评审意见决议与闭环追踪表（第三轮）

| 评审意见项 | 评审性质 | 核心疑虑 | 建议处置 | 当前状态 |
| :--- | :--- | :--- | :--- | :---: |
| **1. 架构断层（方案 A vs 实现方案 C）** | **【阻塞·决策】** | 文档 APPROVED 为纯 Cloudflare 动态 A，代码落地自建双机权威 DNS + 无状态 dashed 映射 | 8.1 三选一，追认后整体改写文档与状态行 | ⏳ **待作者决策** |
| **2. ACME challenge 注入可致域名接管** | **【安全高危】** | 5380 全接口 + 无 token 部署示例 + 明文公网无鉴权推送，TXT 前缀泛匹配 | 8.2 修复：127.0.0.1/强 Bearer/SSH 通道三选一，hook 与 systemd 同步补齐 | 🔴 **未修复，禁止按 SKILL 原样部署** |
| **3. 证书自举缺失（半自动）** | **【范围澄清】** | `GetCertificate`（cert.go:39-55）只读本地缓存、缺失即 `New()` 报错；文档 §四.3"无则后台拉取落盘缓存"与 `/v1/tls/bundle` Worker 通道未实现；私钥仍须人工分发到每台 eqt PC | 文档将当前里程碑明确定位为"权威 DNS + 证书加载已完成，证书拉取/续期分发为待办"；补 Worker 或部署脚本前不得声称全自动 | ⏳ **文档口径待修正** |
| **4. 权威节点可靠性/同故障域** | **【运维风险】** | ns2 = `103.232.92.220` 与既有 aip 出口同机（5G 运营商网段，2026-08-29 起遭 Google 风控）；双节点无监控、无故障演练；"毫秒级 failover"表述过度（递归对超时并非即时切换） | 部署 checklist 增加：UptimeRobot 双节点 UDP/TCP 53 + 5380 监控；评估独立 VPS/第三 NS；Cloudflare 胶水 A 与防火墙 53/udp+tcp；文档弱化 failover 表述 | ⏳ **补充部署手册** |
| **5. `go test ./pkg/server` 依赖真实证书缓存** | **【测试健壮性】** | `TestLanTLSLoopbackServer`（lan_tls_test.go:15-27）在无 `~/.config/eqt/certs` 的机器上直接 `t.Fatalf`，不像 `TestGetCertificateCached` 有 Skip | 改为测试内自签 CA+SAN 证书或按缺失 Skip，保证 CI/干净机可过 | 🔴 **未修复** |
| **6. Secure + bind=0.0.0.0 分支短路缺陷** | **【正确性】** | server.go:2298-2326 `else if cfg.Secure` 被外层"外部 IP"分支短路：接口 any + Secure 时 https URL 指向公网 IP（证书不覆盖且需 NAT），0.0.0.0 兜底还会产出 `0-0-0-0.direct…` | Secure 优先取本机 LAN 接口 IP 映射直连域；补该分支单测 | 🔴 **未修复** |
| **7. TXT 应答未按记录名精确匹配** | **【低危·健壮性】** | main.go:169 对任意 `_acme-challenge.*` 前缀回放全部 value；当前单通配符无碍，未来多证书会串扰 | 精确匹配 `_acme-challenge.<zone>`（含 base wildcard 场景）；store 改按名称键控 | ⏳ **建议修复** |
| **8. 杂项与勘误** | **【低危】** | SOA serial=Unix 秒随查询抖动且 TXT 变更不推进 serial（现双主无 AXFR，可接受但需文档化）；parseIP 对带前导字符 label（`s-abc-192-168-1-50`）也命中解析——需命名规范约束；`.gitignore` 全局 `*.pem` 过宽建议收敛至 `/certs/`；go.mod tidy 移除 xdg/pb/color/yaml.v2 经全仓 grep 无源码引用（安全），miekg/dns v1.1.73 引入正常 | 依序小额处理；新增记录一律遵循 dashed 四段整 label 形态 | ✅ **记录在案** |

> **审查副产物（已验证，非缺陷）**：`go build ./...` 与 `go vet` 全绿；本地三组新测试通过；`privkey.pem`（241B）为 EC 密钥且已被 `.gitignore` 遮蔽、未入库——符合 SKILL §3.2 私钥严禁入库基线。
