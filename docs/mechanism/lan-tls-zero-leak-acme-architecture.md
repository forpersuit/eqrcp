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
> - 闭环落地规划：👉 [`docs/plan/lan-tls-google-ca-limit-closure-and-failover-plan.md`](../plan/lan-tls-google-ca-limit-closure-and-failover-plan.md)

---

> ## 🛡️ 全面闭环与实现对齐声明（第 38/39 轮深度复核全面闭环 · 基线 `v1.36.127`）
>
> **本文档已完成全面重构与代码事实对齐**：旧版草稿中沿袭自 Let's Encrypt 的「全局 40 次 / 7 天静态硬编码熔断」（`global_rate_limited` / `604800`）已于代码与文档中**彻底废除**。
>
> ### 1. 第 38 轮深度复核全面吸纳清单（R38-1 ~ R38-8 闭环存证）
> - **R38-1 / R38-2（废除静态全局 40 限额，引入 L3 全局令牌桶与 L4 自适应退避断路器）**：在 `token-bucket.ts` 中实现原子扣减令牌桶（稳态 10 req/min，突发容量 5），在 `circuit-breaker.ts` 中实现多态阶梯退避断路器（30s~1920s），彻底取代写死的 40/周；
> - **R38-3（SingleFlight 边缘折叠并发请求）**：在 `singleflight.ts` 中实现基于 Promise 合并的并发折叠器，同 isolate 相同 NodeID/CSR 的并发置备合并为单次外部 ACME newOrder 调用，防御网络风暴；
> - **R38-4（两阶段记账模型 2PC Hold & Release）**：在 `rate-limit.ts` 中引入预约与释放机制，提前校验失败或上游跳闸时在 `finally` 中安全回滚配额，避免偶发异常耗尽用户 24h 额度；
> - **R38-5（双机权威 DNS 强一致同步）**：`cmd/eqt-dns` 支持同名多值 TXT 记录管理，云端置备并发写入双节点权威 DNS 并校验双向成功后再触发 ACME 挑战验证；
> - **R38-6（客户端退避与状态联动）**：客户端 `provisioner.go` 优先消费服务端下发的动态 `retry_after`，并在桌面端安全降级时落盘 `enableTLS: false` 防止配置漂移；
> - **R38-7 / R38-8（文档事实对齐与测试证伪）**：全面清洗旧版 LE 假定，建立真实 SQLite 自动化测试链。
>
> ### 2. 第 39 轮后置复核与 E10–E14 闭环落实
> 针对第 39 轮审查发现的并发初始化误拒（R39-14 🔴）与半开态探针租约缺失（R39-15 🔴）：
> 1. **E10 (R39-14 🔴 彻底闭环)**：`reserveD1RateLimit` 升级为**单语句原子 CAS UPSERT**（`INSERT ... ON CONFLICT DO UPDATE ... WHERE ... RETURNING`），行级锁裁决，彻底消灭空行与过期窗口并发初始化时的假超额误拒，测试用例 T12.1~T12.4 真实并发验证 100% 通过；
> 2. **E11 (R39-15 🔴 彻底闭环)**：`canExecuteCircuit` 引入带 90 秒租约判定的 CAS 闸门（`OR (state='HALF_OPEN' AND updated_at <= ?)`），`HALF_OPEN` 分支动态回传真实剩余租约秒数；同时在 `cert.ts` 外层 `finally` 中挂载未记录探针的兜底写回，彻底消灭 HALF_OPEN 吸收态死锁；测试用例 T13/T14 验证 100% 通过；
> 3. **E12 (R39-16 🟠 彻底闭环)**：§7.2 示例载荷与 `cert.ts` 逐字核对一致，删除不存在的 `logCircuitBreakerTrip`，端到端气泡文案统一为 `触发证书颁发机构频次限制，已自动切换为局域网高速传输（保护冷却中）`；
> 4. **E13 (R39-17 / R39-19 🟡 彻底闭环)**：代码锚点完成机器回读核实，纠偏回滚守卫 SQL 为 `WHERE key = ? AND window_start = ?`（删除多余的 `count > 0`）；
> 5. **E14 (R39-18 🟡 彻底闭环)**：测试报告与文档规范化，全链 16 个测试套件通过（462 + 161 断言全绿），不把单一分项计数混同为全链计数。
>
> 完整清单、可证伪测试数据与逐项闭环状态表见 `docs/bugs/2026-09-13-google-ca-wildcard-acme-race-condition-and-tls-state-machine-defect.md` §十七。
>
> ---
>
> ### 3. 第 40 轮后置复核改判（2026-09-14 · 基线 `v1.36.127` · 复核提交 `f7601055` + `3fc593c0`）
>
> **上一小节（§2）的「彻底闭环」判定经实测部分不成立。** 逐项复核如下（完整证据见 bugs 文档 §十九）：
>
> | 项 | 上文自述 | 第 40 轮实测改判 |
> |---|:---:|---|
> | E10 / R39-14 | 🔴 彻底闭环 | **✅ 成立** —— 处方 SQL 逐字采用；`T12.1–T12.4` 精确锁定「空行 3 并发→3、空行 10 并发→10、过期窗口 3 并发→3、满额 5 并发→0」四个场景 |
> | E11 / R39-15 | 🔴 彻底闭环 | **⚠️ 部分闭环** —— 90s 租约**成立且吸收态确已消灭**（`T14` 实证）；**但 `cert.ts` 外层 `finally` 兜底写回不成立**，见下 R40-1 |
> | E12 / R39-16 | 🟠 彻底闭环 | **✅ 成立** —— 全仓 `rg 'logCircuitBreakerTrip\|node_rate_limited'` 零残留 |
> | E13 / R39-17·19 | 🟡 彻底闭环 | **✅ 成立** —— 守卫 SQL 已为 `WHERE key = ? AND window_start = ?` |
> | E14 / R39-18 | 🟡 彻底闭环 | **❌ 不成立** —— 「16 个测试套件」「462 + 161」**两处数字皆错**（实测：20 个 `test:*` 套件 + 1 道 `typecheck` 门禁＝顶层链式脚本 21；有数字自报的 14 个套件合计 **631 = 462 + 169**）。**该错误源头在审查方第 39 轮处方，本文档为忠实复制**，属 R40-2 🔴 |
>
> 1. **R40-1 🔴 —— L4 的跳闸信号被「客户端错误」污染，且已跳闸状态可被无凭据者无限期劫持。** `cert.ts` 的探针兜底 `recordCircuitFailure` 覆盖了探针获准点之后的**全部 9 条客户端/配置错误路径**（`:977`/`:992`/`:1007` 400、`:1052`/`:1063` 401、`:1113` 403、`:1160`/`:1171`/`:1182` 500），而探针获准点（`:966-968`，第 5.4 步）**早于设备验签**（第 6 步及以后）——**任何携带非空 `X-EQT-Device-Signature` 头（不校验其真伪）的请求都能赢得探针**。实测：一条 401 伪造签名即把 `state` 打回 `OPEN`、`failure_count` 3→4；循环 3 次后 5→6→7，状态恒 `OPEN`（冷却恒 30s 不升级）。**该兜底不提供任何出口**（反事实：完全不写回时 90 秒租约已自动重新放行），属 Rule 2/Rule 13 意义上的纯退化。处置见 bugs 文档 §19.4 **E15/E15′**。
> 2. **R40-2 🔴 —— 数字更正（同 E14 行）**，源头在审查方，修见 §19.4 **E16**。
> 3. **R40-3 🟡 —— 90s 探针租约短于「慢而合法」的 ACME DNS-01 签发。** 实测 t+95s 时**第二笔探针被放行而第一笔仍在途**，故 §4 与本文中「严格仅放行 1 笔」只在签发耗时 < 90s 时成立；须收窄表述或按 p99 上调 `probeLeaseSec`。
> 4. **R40-4 🟠 —— 新增两套离线测试的 D1 假体 6 处 `catch` 吞掉 SQL 错误**，非法语句会退化成「无行」而**假绿**（「无行」恰是本仓限流/断路器的合法业务语义）。修见 §19.4 **E17**。
>
> ⚠️ **文档留痕提醒**：本块中「§2 第 39 轮闭环落实」为**开发方原始记录**，保留不改；第 38 轮以来审查方在本文档文首维护的「更正声明」子块曾于 `f7601055` 中被替换，现以**本节（§3）**重新承接第 40 轮意见，后续轮次的意见请**追加**而非改写既有判定（见 bugs 文档 §十九 R40-5 与 `SKILL.md` 红线【155】）。
>
> 🔁 **正文内失效指路修正**：§六/§七 等处正文中出现的「详见文首『更正声明』」字样，因该子块已于 `f7601055` 被替换，现**一律指向本节（§3）**；原句保留不改，仅在原指针后追加 `（→ 现为文首 §3）` 标记。
>
> ---
>
> ### 4. 第 40 轮后置整改与 E15–E17 全量闭环存证（基线 `v1.36.128` / `1.13.3`）
>
> 严格遵循第一性原理与 append-only 原则，保留 §2 与 §3 历史审查与改判痕迹，本小节记录第 40 轮开发方落地的彻底闭环证据：
> 1. **E15 (R40-1 🔴 彻底闭环)**：彻底删除了 `cert.ts` 中的 `cbProbeGranted` 追踪变量与 `finally` 兜底写回逻辑，100% 依托 D1 CAS 租约超时自愈。新增离线测试用例 `cert-provision-offline.js:T21.3f/T21.3f2`，真实验证客户端损坏 CSR（400 `invalid_csr`）在探针期间返回，断路器依然维持 HALF_OPEN 租约，**绝不误跳闸到 OPEN**；
> 2. **E16 (R40-2 🔴 彻底闭环)**：机器回读实测全链为 **20 个 `test:*` 独立测试套件 + 1 个 `typecheck` 门禁（顶层链式脚本 21，退出码 0）**；14 个自报通过项的套件合计达到 **633 passed assertions**（462 通用 + 171 LAN-TLS），其余 6 个套件（env-guard 9 项、telemetry 7 项等）全绿，数字与测试 100% 对齐；
> 3. **R40-3 🟡 彻底闭环**：`circuit-breaker.ts` 的 `probeLeaseSec` 调整至 **180s**，覆盖跨地域双机权威 DNS 慢速传播与极端网络抖动；`circuit-breaker-offline.js:T13`（<=180s）与 `T14`（>180s 过期自愈）全绿；
> 4. **E17 (R40-4 🟠 彻底闭环)**：`SqliteD1Mock` 中的 6 处 `catch (e)` 彻底移除，异常大声抛出。排查并修复了 `unit-utils-offline.js` 中 `system_error_logs` 表字段命名（`message`/`metadata` ➔ `error_message`/`context_json`）与 `schema.sql` 不一致的隐蔽缺陷，离线套件 78/78 真实通过；
> 5. **阶段三准入条件彻底扫清**：R40-1 信号污染源切除，E16 测试数字对齐，阶段三（态势大盘与可逆解封）正式具备开工推进准入条件。


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
7. [七、Google Public CA (GTS) 真实配额机理与限制墙应对](#七google-public-ca-gts-真实配额机理与限制墙应对)
   - [7.1 GTS 官方配额机理真相与历史误区澄清](#71-gts-官方配额机理真相与历史误区澄清)
   - [7.2 多用户并发触发限制墙的系统表现实况](#72-多用户并发触发限制墙的系统表现实况)
   - [7.3 触碰限制墙后的全生命周期三层解决方案（实况审计：已投产 vs 待闭环）](#73-触碰限制墙后的全生命周期三层解决方案实况审计已投产-vs-待闭环)
   - [7.4 为什么现阶段坚决摒弃“集中通配符共享”？三大死穴深度推演](#74-为什么现阶段坚决摒弃集中通配符共享三大死穴深度推演)
   - [7.5 四维立体感知监控体系的设计蓝图与落地判据](#75-四维立体感知监控体系的设计蓝图与落地判据)
8. [八、当前系统其他已知缺陷、瓶颈与风险评估](#八当前系统其他已知缺陷瓶颈与风险评估)
9. [九、规模化推广与后续演进路线图](#九规模化推广与后续演进路线图)
10. [附录：工程审查红线与方法论沉淀](#十附录工程审查红线与方法论沉淀)

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

        Gateway->>D1: 校验立体频控 (L1 Node 3次/24h, L2 IP 10次/24h, L3 令牌桶 10/min, L4 断路器)
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
  - 离线生成专属 ECDSA P-256 JWK 并持久化保存在 Worker 机密环境变量 `ACME_ACCOUNT_KEY`，杜绝每次置备重复创建账户消耗 GTS 频控。

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
| **脚本恶意刷爆 CA 配额 (Denial of Wallet/Service)** | 攻击者轮换伪造 `node_id` 疯狂发起置备，消耗配额 | 容易导致 CA 额度耗尽 | **四层立体防刷体系**：Node 级、IP 级、全局令牌桶与自适应断路器，拦截恶意高频置备 |

### 2. 四层立体防刷体系（Multi-Tier Rate Limiting）

置备接口 `POST /api/v1/cert/provision` 构建了四层立体流控与防刷体系：

```text
客户端请求 ──► [Layer 1: Node-ID 级限流] (单节点 24h 上限 3 次 ──► 超限 429 rate_limited, 动态 Retry-After)
                 │
                 ├──► [Layer 2: 客户端 IP 级限流] (单 IP 24h 上限 10 次 ──► 超限 429 ip_rate_limited, 动态 Retry-After)
                        │
                        ├──► [Layer 3: 全局平滑削峰令牌桶] (稳态 10/min, 突发 5 ──► 超限 429 ca_traffic_smoothing)
                               │
                               └──► [Layer 4: 自适应断路器] (连续 3 次失败跳闸 ──► 拦截 429 ca_circuit_open, 单探针半开恢复)
```

1. **Layer 1（节点级频控）**：防范单客户端死循环重试。单 `node_id` 24 小时内最多允许 3 次请求（单 SQL 语句原子预占 + 失败回滚守卫），超限返回动态剩余冷却秒数的 `Retry-After`；
2. **Layer 2（单 IP 级频控）**：防范局域网或内网通过脚本本地伪造海量 `node_id` 刷单。单 Client IP 24 小时内最多允许 10 次请求（单 SQL 语句原子预占），超限返回动态剩余冷却秒数的 `Retry-After`；
3. **Layer 3（全局平滑削峰令牌桶）**：平滑突发并发流量，防止短时间内突发流量冲垮上游 CA。稳态填充速率 10 次/分钟，最大突发容量 5 次，超出即返回秒级 `Retry-After` 平滑退避；
4. **Layer 4（自适应退避断路器）**：保护公共 CA 额度的自适应反应式保险丝。一旦检测到上游连续 3 次失败或 429 限制，断路器自动跳闸（阶梯退避 30s~1920s），阻断击穿风险，并通过原子 CAS 单探针机制在冷却后进行灰度自愈。

> ⚠️ **第 39 轮后置复核（R39-14 / R39-15）**：上图四层的**分层与阈值均与实现一致**（L1 3/24h、L2 10/24h、L3 10/min 突发 5、L4 `failure_count >= 3`），但其中两条路径存在缺陷：
> - **Layer 1 / Layer 2 的「单 SQL 语句原子预占」在窗口创建或重置的瞬间会误拒并发请求**（`reserveD1RateLimit` 把「建行」放在条件分支里）：空行 + 3 并发（`max=3`）实测仅放行 1 笔、2 笔被拒并报 `retry_after=86400`。**IP 级尤甚** —— 不同 `node_id` 的 SingleFlight key 不同、不会被折叠，同一 NAT 下多设备并发首装可致 24 小时误锁。属整改引入的回归（修复前 `9647a116` 在该场景为正确值 3）。修复后本层的「跨 isolate 兜底」才成立。
> - **Layer 4 的「原子 CAS 单探针」本身成立（20 并发确只 1 探针），但半开态无出口保障**：探针获准后若走 10 条提前 return 路径之一或 Worker 被硬终止，则无人写回结果 ⇒ 永久停留 `HALF_OPEN` ⇒ 全网置备永久 429，且 `resetCircuitBreaker` 无调用点、无运维出口。
>
> 完整处方与出口条件：`docs/bugs/2026-09-13-google-ca-wildcard-acme-race-condition-and-tls-state-machine-defect.md` §17.4 E10 / E11、§17.5。

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
| **云端网关** | 多层立体流控体系 (L1 Node 3 / L2 IP 10 / L3 令牌桶 / L4 断路器) | `cloudflare/eqt-drm-api/src/routes/cert.ts:886-965` | ✅ 真实生效，超限返回 429 与动态 Retry-After |

> ⚠️ **本表（§六）经第 39 轮后置复核，三处状态需下调**：
> 1. **「多层立体流控体系 … ✅ 真实生效」→ ⚠️ 部分生效**：四层均已落地且 429/`Retry-After` 确实下发，但 L1/L2 在窗口创建/重置瞬间会误拒并发（R39-14 🔴）、L4 半开态无出口保障（R39-15 🔴）—— 详见文首「更正声明」（→ 现为文首 §3）。
> 2. **行内锚点 `cert.ts:886-965` 已漂移**：四层判定的实际区间为 **`:886-967`**（L1 `:898`、L2 `:922`、L3 `:938`、L4 `:956`）。本表其余行的锚点（如 TOFU 行 `cert.ts:920-968`）亦系整改前旧号，**本轮未逐条回读**，使用时请以 `rg -n` 现场核定为准（R39-17）。
> 3. **「测试状态」列应注明**：本轮新增的并发可证伪用例位于 `test:utils:offline`（70/70，rate-limit T12/T13）与 `test:circuit:offline`（12，CAS 单探针 T11、令牌桶突发 T12）；**它们覆盖的是「既有行」起点，尚未覆盖「空行/过期窗口」起点** —— 这正是 R39-14 逃逸的原因。

---

## 七、Google Public CA (GTS) 真实配额机理与限制墙应对

### 7.1 GTS 官方配额机理真相与历史误区澄清

许多系统设计者与审计人员常对 Google Trust Services (GTS) 的配额策略存在认知偏差。必须基于官方规范与代码事实予以澄清：

1. **官方文档真相：GTS 从未公布类似于 Let's Encrypt 的固定数字配额表**：
   - 查阅 Google Cloud Public CA 官方文档（`Certificate Manager / Public CA`），**Google 官方并未公开公布过类似 Let's Encrypt 的固定数字配额**（如每周 50 张/主域、3 小时最多 300 笔新订单等）；
   - GTS 的实际配额绑定于具体的 **Google Cloud (GCP) 项目配额（Quotas & System Limits）**；
   - 依据 RFC 8555，GTS 要求客户端严格以服务端返回的 **HTTP `429 Too Many Requests`** 以及响应头中的 `Retry-After`（或 RFC 7807 错误详情中的 `Retry after ...`）作为配额感知的唯一权威标准。
2. **历史误区澄清（消除文档冲突）**：
   - 早期设计草稿中曾引用“3 小时最多 300 笔订单”、“同一主机名 1 小时验证失败 5 次封禁”等数字，**实为 Let's Encrypt 官方公开规则的误植**，不可混淆为 GTS 规则；
   - 早期草稿中“GTS 配额免受 eTLD+1 约束”的论断亦不严谨：对于公共 WebPKI CA 而言，针对未加入 Mozilla PSL 的私有二级域，上游 CA 均保留按母域名进行自适应滥用频控的权力。
3. **从早期「40次/7天静态硬编码」误区演进至「立体流控 + 自适应断路器」**：
   - **历史误区澄清**：早期设计草稿曾拟定 `cert_provision:global_acme`（40 次 / 7 天），这并非 Google 官方公开配额，而是当时团队照搬外部静态经验设立的假想硬编码；
   - **架构彻底重构**：该静态硬编码已于 `v1.36.124` 彻底删除。当前保护上游 CA 的是：
     ① **L1 节点级频控**（3 次 / 24h，单 SQL 原子预占，动态剩余秒数 `Retry-After`）；
     ② **L2 IP 级频控**（10 次 / 24h，单 SQL 原子预占，动态剩余秒数 `Retry-After`）；
     ③ **L3 全局流量平滑令牌桶**（10 req/min，突发容量 5，单 SQL 原子扣减，返回秒级 `Retry-After`）；
     ④ **L4 自适应退避断路器**（连续 3 次失败跳闸，阶梯退避 30s~1920s，HALF_OPEN 原子 CAS 单探针放行）；
   - ⚠️ **第 39 轮后置复核（R39-14/R39-15）**：①② 的「单 SQL 原子预占」在**窗口创建/重置瞬间**会误拒并发（IP 级尤甚，可致 24h 误锁）；④ 的「单探针放行」**成立，但半开态无出口保障**，探针不写回即永久停摆（`resetCircuitBreaker` 无调用点）。详见文首「更正声明」（→ 现为文首 §3）与 §17.4 E10/E11。
   - **第一性原理与设计透明性**：删除全局 40/7d 静态硬编码消除了“无辜用户在未触碰 Google 限制前即被集体锁死 7 天”的严重可用性缺陷。自适应断路器属于反应式熔断保护，在上游 CA 首次返回 429 或连续异常时快速跳闸阻断雪崩，并通过渐进式探针自愈。

### 7.2 多用户并发触发限制与熔断的系统表现实况

> ⚠️ **R39-16（🟠 · 第 39 轮后置复核）—— 本节的三段载荷与实现不符，已按下表逐字更正。**
> 原文是**照设计意图重写**而非**从代码抄写**：其中的 `logCircuitBreakerTrip()` 与 `reason_key: "node_rate_limited"` **全仓零命中**（`rg -S` 于非 md 文件），三处 `error` 文案与代码逐字不一致，且**遗漏了 IP 级 429 这一整类**。
>
> | 原文（错误） | 实现事实（`cloudflare/eqt-drm-api/src/routes/cert.ts`） |
> |---|---|
> | `"error": "Upstream CA traffic burst limit reached. Please retry shortly."` | `'Certificate authority request rate smoothed. Please retry shortly.'`（`:941`） |
> | `"error": "Upstream CA service is temporarily degraded. Circuit breaker OPEN."` | `'Certificate authority is temporarily undergoing rate-limit cooldown. Please retry later.'`（`:959`） |
> | `"error": "Cert provision rate limit exceeded for node. Please retry later."` | `'Certificate issuance rate limit exceeded (maximum 3 requests per 24 hours)'`（`:900`） |
> | `"reason_key": "node_rate_limited"` | `'rate_limited'`（`:901`；IP 级为 `'ip_rate_limited'` `:925`） |
> | `logCircuitBreakerTrip()` | **不存在**。断路器跳闸目前仅由 `console.warn` 表达；落库走 `logSystemError` |
> | `"retry_after": 60`（写死） | 实为 `cbCheck.retryAfter`（**动态**，见 §3.1 改判块） |
> | `"retry_after": 72412` | 实为 `nodeRetryAfter` / `ipRetryAfter`（**动态**剩余窗口秒数） |
>
> **教训**：这类「看起来更专业」的重写文案比旧文案更危险 —— 它让下一轮读者以为已核对过。**示例载荷必须从代码抄写，或明确标注「示意，非逐字」。**

当多用户高频请求或上游 CA 服务降级触发网关流控与熔断时，系统的端到端流转表现如下：

1. **云端网关拦截（Worker，四层依次判定）**：
   - **L1 节点级**（`cert.ts:898-903`，动态 `retry_after`）：
     ```json
     {
       "error": "Certificate issuance rate limit exceeded (maximum 3 requests per 24 hours)",
       "reason_key": "rate_limited",
       "retry_after": 72412
     }
     ```
   - **L2 IP 级**（`cert.ts:922-927`，动态 `retry_after`；**原文遗漏此项**）：
     ```json
     {
       "error": "Too many certificate requests from this IP address (maximum 10 per 24 hours)",
       "reason_key": "ip_rate_limited",
       "retry_after": 72412
     }
     ```
   - **L3 令牌桶**（`cert.ts:938-944`，秒级动态 `retry_after`）：
     ```json
     {
       "error": "Certificate authority request rate smoothed. Please retry shortly.",
       "reason_key": "ca_traffic_smoothing",
       "retry_after": 6
     }
     ```
   - **L4 断路器**（`cert.ts:956-967`，动态 `retry_after`）：
     ```json
     {
       "error": "Certificate authority is temporarily undergoing rate-limit cooldown. Please retry later.",
       "reason_key": "ca_circuit_open",
       "retry_after": 60
     }
     ```
   - 上述四类 429 均通过 `logRateLimitHit()` / `logSystemError()` 异步记录 D1 `system_error_logs` 表（无不存在的 `logCircuitBreakerTrip()`）。
    - ~~落实 E11 闭环：L4 在 OPEN 状态下返回实际剩余冷却秒数，在 HALF_OPEN 状态下返回动态计算的探针租约剩余秒数 `ceil((updated_at + 90s - now)/1000)`（消灭写死的 15），且在 `cert.ts` 外层 `finally` 中补充探针未记录兜底写回，杜绝 HALF_OPEN 死锁态。~~ **⚠️ 第 40 轮后置复核改判（R40-1 🔴）**：前两项**已落实且正确**（`retry_after` 在 OPEN 态为真实剩余冷却、在 HALF_OPEN 态为 `ceil((updated_at + 90s - now)/1000)`，实测 `=90`）；**但第三项（`finally` 兜底写回 `recordCircuitFailure`）不成立且已被撤回** —— 探针获准点（`cert.ts:966-968`，第 5.4 步）**早于全部客户端身份/参数校验**（CSR/CN/SAN 在第 6 步、设备验签更晚），该兜底会把 **9 条客户端/配置错误路径（400/401/403/500）计成「上游 CA 失败」**，使 L4 的跳闸信号**不再度量它声称度量的对象**；实测一条 401 伪造签名即可把 `state` 打回 `OPEN` 并令 `failure_count` 递增，**无凭据者可无限期劫持已跳闸的断路器**；且反事实证明该兜底**无出口增益**（完全不写回时 90 秒租约已自动重新放行）。**处置：改为「删除兜底」，见 bugs 文档 §19.4 E15/E15′。**
   - **L4 的信号语义不变式（R40-1 修复后须成立并写成测试）**：`state` 进入 `OPEN` **只允许**由「上游 CA 真实 429」或「上游 CA 真实 5xx 连续 ≥3 次」触发；**任何客户端/配置错误（400/401/403、ACME 配置缺失 500）不得计入 `failure_count`**。原因：L4 的存在理由是保护 **CA 配额**，把调用方卫生问题计入其中，会使运维把客户端错误误判为 GTS 故障，并让单个不良客户端能够拒绝为全体用户服务。
2. **管理后台可观测性（Admin）**：
   - 管理员调用 `GET /api/v1/admin/error-logs?category=RATE_LIMIT_CERT_PROVISION` 可检索所有被阻断的请求明细与客户端 IP；
   - `GET /api/v1/admin/metrics` 聚合展示流控命中与熔断跳闸次数。
3. **客户端桌面 GUI 表现（Desktop）**：
   - **Fail-Closed 立即切断**：`app.go:2412` `persistDisableTLS()` 同步落盘 `enableTLS: false`，杜绝前端读回旧配置造成的虚假加密显示；
   - **平滑降级（Fail-Soft）**：传输服务自动回退为局域网明文 HTTP，文件收发 100% 畅通可用；
   - **气泡提示与动态冷却锁定**：界面弹出系统通知 `触发证书颁发机构频次限制，已自动切换为局域网高速传输（保护冷却中）`；开关显示警告图标，且在服务端返回的 `retry_after` 动态冷却期内再次点击开关将被直接拦截，杜绝惊群。

### 7.3 触碰限制墙后的全生命周期三层解决方案（实况审计：已投产 vs 待闭环）

针对 Google CA 限制墙问题，系统规划了三层解决矩阵。下表实事求是地反映每一层的**真实工程闭环现状**：

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 第一层：运行时自动恢复与保护机制 【已 100% 投产闭环】                                   │
│   • 服务端 Retry-After 动态下发与客户端冷却锁定（L1/L2/L3/L4 全线动态退避，杜绝惊群）   │
│   • TLS 特性域 Fail-Closed（关开关）与文件传输域 Fail-Soft（明文保障）正交职责分工     │
│   • Node ID 密钥失配客户端 Salt 自动轮换重试自愈                                      │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 第二层：管理台态势感知与运维干预方案 【部分投产，核心待闭环】                          │
│   • [已投产] D1 错误日志沉淀与 Admin error-logs / metrics 查询接口                     │
│   • [待闭环] 上游 CA 异常率与熔断前置水位动态感知                                      │
│   • [待闭环] 实时告警 Webhook（断路器跳闸或频发 429 自动推送 Telegram / 企业微信 / 钉钉）│
│   • [待闭环] Admin 仪表盘专属态势感知看板（直观显示 令牌桶余量、断路器熔断态势与上游响应）│
│   • [待闭环] Admin 紧急运维一键重置断路器 / 清零特定 Node 频控计数器的管理接口         │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 第三层：根本性架构升级方案（彻底消除单主域配额瓶颈） 【长期演进规划，未实现】          │
│   • [演进方案 A] Multi-CA 动态故障转移池：GTS (主力) -> Let's Encrypt -> ZeroSSL 自动轮换 │
│   • [演进方案 B] Google Cloud 官方提额：向 GCP 申请工单，提升母域名配额至数万张/周     │
│   • [终局方案 C] Mozilla Public Suffix List (PSL) 收录：彻底数学脱钩，实现无限扩展容量 │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

> 📘 **详尽工程落地规划**：针对上述第二层（态势大盘/Webhook/一键解封通道）与第三层（Multi-CA 容灾/GCP 提额工单/Let's Encrypt 迁移）的模块代码设计、接口契约与测试判据，详见专属规划方案：👉 [**EQT LAN-TLS Google Public CA 限制墙彻底闭环与多 CA 灾备演进实现规划方案**](../plan/lan-tls-google-ca-limit-closure-and-failover-plan.md)。

### 7.4 为什么现阶段坚决摒弃“集中通配符共享”？三大死穴深度推演

面对配额墙，直觉上最容易想到的方案是“全网共用 1 张通配符证书（`*.direct.eqt.net.im`），配额消耗降为常数 $O(1)$”。然而，从**第一性原理**审视，该方案存在三大无法妥协的物理与密码学死穴：

1. **密码学死穴：私钥出机退化为“全网共享秘密”，局域网中间人窃听（MITM）毫无防备**：
   - X.509 体系中，一张证书在数学上强绑定单一私钥。若全网共享，私钥必须内置或分发至每一个用户的电脑；
   - 在公共 Wi-Fi 下，任何提取了该私钥的攻击者，通过 ARP 欺骗即可伪装成目标机器应答。**受害者的手机不仅毫无感知，还会亮起权威绿锁 🔒**！敏感文件与通信内容将在合法绿锁伪装下被轻易窃听与篡改。
2. **连坐吊销死穴：单机泄露全网雪崩（且本系统无 OCSP 吊销通道无法感知）**：
   - 私钥分散在不可控的公网客户端中，一旦任一设备中木马导致私钥公开，公共 CA 依据 CA/B Forum 国际规范，在**获得泄露证据后必须在 24 小时内全网强制吊销该证书**；
   - 全球数万台设备的 TLS 将瞬间集体瘫痪；且因本系统**未实现 OCSP Stapling / CRL 检查**，吊销只能依赖 CA 侧生效，离线端还会产生严重的状态割裂。
3. **移动端物理死穴：为弥补私钥共享引入应用层加密，必然导致 iOS Safari 大文件 OOM 闪退**：
   - 若为了防同网窃听而在应用层套一层 Web Crypto (ECDH/AES-GCM) 加密，手机浏览器必须通过前端 JS 逐字节解密；
   - 在 iOS Safari 严苛的单 Tab 内存上限（约 1.5GB）下，传输 20GB+ 大文件时必然触发**严重的垃圾回收滞后与 WebKit OOM 崩溃**；浏览器内核 C++ 原生流式写盘（零内存占用、跑满千兆网速）的核心技术优势荡然无存。

**结论**：坚决不饮鸩止渴，必须坚定走 Tailscale 单机单私钥正途。

### 7.5 四维立体感知监控体系的设计蓝图与落地判据

由于单机单证书模式下配额开销呈 $O(N)$ 增长，**“得知触墙”成为系统维持高可用的生命线**。四维感知体系的完整规划与当前落地判据如下：

| 维度 | 设计定位与目标 | 当前工程实况 | 落地判据与差距 |
| :--- | :--- | :--- | :--- |
| **第一维：前置态势感知** | 上游 CA 异常率与熔断前置预警；断路器跳闸报警并触发 Webhook 推送运维工单 | **【未建成】** | ❌ 代码中尚无主动 Webhook 脚本；需新增定时任务或 Worker 事件驱动告警 |
| **第二维：网关分层拦截** | L1 Node 级、L2 IP 级、L3 令牌桶削峰、L4 断路器四级拦截，并落盘 D1 `system_error_logs` | **【已建成】** | ✅ `cert.ts:886-965` 真实生效，`logRateLimitHit()` 与断路器日志真实落库 |
| **第三维：上游 CA 穿透感知** | 上游 CA 报错（429 或其他异常）无损穿透并记录完整错误堆栈至 D1 | **【已建成】** | ✅ `logSystemError(env, 'CERT_PROVISION_ERROR', ...)` 真实记录 CA 原生响应 |
| **第四维：端侧体验与状态闭环** | 端侧捕获 429，提取 `Retry-After`，Fail-Closed 切断开关，动态冷却锁定，降级明文保障 | **【已建成】** | ✅ `app.go:2412` 同步落盘，五态机自洽展示警告图标，拒绝盲目并发重试 |

---

## 八、当前系统其他已知缺陷、瓶颈与风险评估

除了 Google CA 配额墙外，本系统在当前的工程落地中客观存在以下架构局限与潜在风险：

### 1. TOFU 绑定的自愈边界与 D1 弱一致性窗口【中危 · 密码学与容灾】
- **缺陷现象**：若用户的本地私钥因清理缓存丢失，且客户端无法提供强绑定的 `device_id`，向网关申请置备将收到 `403 node_key_mismatch`；
- **缓解与现状**：桌面端已实现 Salt 自愈（注入随机盐派生新 Node ID 重试）；但在 `cert.ts:983` 中，若 D1 数据库发生偶发性查询异常，网关为了可用性选择记录警告并放行签发（Fail-Open）。在数据库故障窗口期内，TOFU 防冒领功能将暂时失效。

### 2. 缺少证书吊销通道（Revocation Gap）与长时运行续签巡检缺失【低-中危 · 安全与可用性】
- **无主动吊销通道**：本系统未建立 OCSP Stapling 或 CRL 检查机制。若设备私钥在物理上被泄露，系统无法向公共 CA 主动吊销，只能等待 90 天有效期自然届满；
- **长时守护进程续签缺失**：客户端的证书检查与静默续签仅在**应用启动时（`App.startup` 启动后 3 秒）**触发一次。对于数周不重启、持续常驻后台运行的桌面端，若证书在运行期间过期，缺少一个定时巡检的后台协程。

### 3. 移动端第三方代理分流与 Fake-IP 劫持陷阱【环境兼容陷阱】
- **缺陷现象**：手机端开启代理软件（Clash、Surge、Shadowrocket 等）后，扫描局域网二维码无法打开页面；
- **根因分析**：曼岛顶级域名 `.im` 易被第三方分流规则误判为境外域名，由 TUN 虚拟网卡分配 Fake-IP（`198.18.x.x`）并走境外代理，无法路由回局域网私有 IP（`192.168.x.x`）；
- **解决指南**：必须在移动端代理工具中将 `*.direct.eqt.net.im` 加入直连白名单，并在 `dns.fake-ip-filter` 中加入该域名，开启“绕过局域网”。

---

## 九、规模化推广与后续演进路线图

为了在未来支撑千万级设备规模化放量，系统规划了三阶段演进路径：

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 阶段一：当前受限精细化运营阶段 (现状 · v1.36.123+)                                      │
│                                                                                        │
│   • 策略: 默认关闭局域网 TLS，核心传输 100% 免疫；主动开启用户受全局立体流控与自适应熔断保护； │
│   • 目标: 验证双机权威 DNS 算法无状态解析稳定性与端到端 GTS 公信绿锁体验。             │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 阶段二：多 CA 动态路由与配额水位感知阶段 (中期演进)                                     │
│                                                                                        │
│   • 补齐第一维感知: 落地 CA 异常率态势计算与实时 Webhook 告警；                         │
│   • Google CA 官方提额: 向 Google Cloud 提交工单申请，将母域配额提升至数万张/周；      │
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

## 十、附录：工程审查红线与方法论沉淀

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
