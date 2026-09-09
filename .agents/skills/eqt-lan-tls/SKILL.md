---
name: eqt-lan-tls
description: Architectural guidelines, disaster recovery, authoritative DNS operation, and ACME DNS-01 wildcard TLS provisioning for EQT LAN-TLS Loopback.
---

# EQT LAN-TLS Loopback Architecture & Deployment Skill

## 1. 核心架构第一性原理 (Core Principles)
- **目标**：在局域网纯内网传输中实现零配置、免自建 CA、100% 浏览器原生公信信任的 HTTPS (TLS 1.3) 安全链路。
- **回避的陷阱**：
  1. 彻底规避前端笨重易 OOM 的 Web Crypto E2EE 分块加密/解密逻辑；
  2. 规避 Cloudflare 单 Zone 3,500 条 DNS 记录上限与 4 次/秒全局频控（不采用动态写 A 记录路线）；
  3. 规避自签名证书（Untrusted Self-Signed CA）导致的浏览器红标警告与阻止下载。
- **工业级标准路线 (Plex / Jellyfin 路线)**：
  - 基于公信通配符证书（`*.direct.eqt.net.im`）；
  - 局域网内网 IP（如 `192.168.0.201`）通过算法无状态映射为回环域名（`192-168-0-201.direct.eqt.net.im`）；
  - 流量 100% 物理局域网传输，仅初次连接前由公共 DNS 递归解析一次。

---

## 2. 权威 DNS 双机灾备与负载均衡规范 (RFC 1035 NS Delegation)

### 2.1 节点架构
- **节点 1 (ns1.eqt.net.im)**: `128.241.227.181` (Ubuntu Linux, 53 UDP/TCP, 127.0.0.1:5380 HTTP)
- **节点 2 (ns2.eqt.net.im)**: `103.232.92.220` (Ubuntu Linux, 53 UDP/TCP, 127.0.0.1:5380 HTTP)
- **安全基准**：HTTP 管理端口强行锁定在 `127.0.0.1:5380`，仅限本地或 SSH 安全通道调用，严禁公网开放！

### 2.2 Systemd 守护配置
```ini
[Unit]
Description=EQT Authoritative LAN-DNS Service
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/eqt-dns -domain direct.eqt.net.im -listen <SERVER_IP> -port 53 -http-listen 127.0.0.1 -http-port 5380
Restart=always
RestartSec=2s
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

### 2.3 ACME 账户异地容灾与故障转移 (ACME Account High Availability & Failover)
- **核心风险**：获得 Let's Encrypt 官方速率配额豁免（Rate Limit Exemption）的生产账户（Account URI: `https://acme-v02.api.letsencrypt.org/acme/acct/3704177676`）凭据若仅保存在单台 VPS（`ns1 / light181`），一旦该机器发生物理损坏或被云厂商封禁，重新向 ISRG 官方申请工单转移需耗时 1~3 周。
- **协议事实 (RFC 8555 First Principle)**：Let's Encrypt ACME 协议完全不校验客户端 IP 地址，仅以账户私钥（`private_key.json`）的 JWS 密码学签名作为唯一合法身份认证。
- **三地容灾落地**：
  1. **主控节点 (ns1)**：`/etc/letsencrypt/accounts/acme-v02.api.letsencrypt.org/directory/8742533468e55d7c5fd9b8137a6d4fa3/`；
  2. **从属节点镜像 (ns2)**：完全同步镜像至 `/etc/letsencrypt/accounts/`（权限 `700`，私钥 `0400`，严格限定 root 读取）；
  3. **离线运维冷备 (Dev Ops)**：保存于开发运维机 `~/.config/eqt/backup/acme-account/`（防范云端误删）。
- **故障接管判定与机制**：
  - **DNS 业务解析**：双 NS 委派下全球公共 DNS 递归解析自动 failover 切换至 `ns2`，局域网传输业务 0 秒级中断；
  - **证书签发接管**：`ns2` 只需安装 certbot，配置调用本地 `127.0.0.1:5380` 的 challenge hook，即可立即继承该账户的全部 20,000 张/周配额，无缝恢复签发。

---

## 3. ACME DNS-01 自动化签发与续期机制 (Let's Encrypt Automation)

### 3.1 签发流程
- **认证钩子 (`/etc/letsencrypt/hooks/auth-hook.sh`)**:
  ```bash
  #!/bin/bash
  # Push challenge to Node 1 locally
  curl -s -X POST http://127.0.0.1:5380/acme/challenge -H 'Content-Type: application/json' -d "{\"value\":\"$CERTBOT_VALIDATION\", \"ttl\": 3600}"
  # Push challenge to Node 2 via SSH tunnel
  ssh -p 2234 -o StrictHostKeyChecking=no root@103.232.92.220 "curl -s -X POST http://127.0.0.1:5380/acme/challenge -H 'Content-Type: application/json' -d '{\"value\":\"$CERTBOT_VALIDATION\", \"ttl\": 3600}'"
  sleep 10
  ```
- **清理钩子 (`/etc/letsencrypt/hooks/cleanup-hook.sh`)**:
  ```bash
  #!/bin/bash
  curl -s -X DELETE "http://127.0.0.1:5380/acme/challenge?value=$CERTBOT_VALIDATION"
  ssh -p 2234 -o StrictHostKeyChecking=no root@103.232.92.220 "curl -s -X DELETE 'http://127.0.0.1:5380/acme/challenge?value=$CERTBOT_VALIDATION'"
  ```

### 3.2 证书与密钥管理安全基线
- **绝对禁止**: 切勿将 Let's Encrypt 证书私钥（`privkey.pem`）直接提交推送到公开 Git 仓库，否则触发全网扫描吊销。
- **本地缓存路径**: `~/.config/eqt/certs/`（`fullchain.pem` 与 `privkey.pem`）。
- **客户端同步工具**: 执行 `bash scripts/sync-certs-from-vps.sh` 从权威节点一键同步证书至本地，并自动分发至 Windows 宿主 `%USERPROFILE%\.config\eqt\certs`。
  - 支持通过环境变量 `EQT_WIN_USER=<username>` 显式指定具体 Windows 目标用户（默认单用户隔离）；
  - Windows 侧 NTFS DACL 权限收紧：若 WSL 挂载含有 `metadata` 选项，Linux `chmod 600` 将原生映射为 Windows NTFS DACL；否则可在 Windows 侧执行 `icacls "%USERPROFILE%\.config\eqt\certs\privkey.pem" /inheritance:r /grant:r "%USERNAME%:(R)"` 显式收紧私钥读取权限。

### 3.3 权威委派与 Cloudflare 代理红线
- **必须灰云 (DNS-only)**: 在 Cloudflare 面板中，`ns1.eqt.net.im` 与 `ns2.eqt.net.im` 两条 A 记录**必须保持 DNS-only（灰云图标）**，严禁开启 Cloudflare Proxy（橙云）。若误开橙云会导致权威 NS 解析至 CF Anycast 边缘，造成 RFC 1035 委派链路断裂，公共 DNS 递归失败。

---

## 4. EQT 客户端与服务端接入规范

1. **域名转换**:
   `pkg/cert.FormatDirectDomain("192.168.0.201")` ➔ `"192-168-0-201.direct.eqt.net.im"`
2. **启用安全服务**:
   当 `cfg.Secure = true` 时，服务端自动尝试从 `~/.config/eqt/certs` 加载通配符证书；未指定 FQDN 时自动将有效内网 LAN IP 转换为回环子域名；
3. **前端表现**:
   浏览器地址栏自动显示绿色安全锁 🔒，`window.isSecureContext === true`，原生流式下载零 OOM 畅通运行。

---

## 5. 桌面端 GUI 设置与模式适配 (Desktop GUI Integration)

1. **设置开关 (`enableTLS`)**:
   - 存在于 `DesktopSettings` 结构体中，持久化于用户的 `config.yml`（`enableTLS: true` 与 `secure: true`）；
   - 在桌面端设置（Settings）界面的高级选项中提供“局域网传输加密 (LAN-TLS)”开关（`settings-enable-tls`），支持 7 国多语言（中/英/日/韩/西/德/法）。
2. **容灾平滑降级 (Fail-Soft Fallback)**:
   - 调度内核在 `runTask` 中执行探针检测：若用户开启了 TLS 开关但本机尚未安装证书缓存，**自动平滑降级为 HTTP 传输**并产生日志警告，彻底防止新环境一击瘫痪。
3. **多模式自适应覆盖**:
   - **Send (Share) 模式**: 二维码直接渲染 `https://*-*-*-*.direct.eqt.net.im:.../send/<token>`；
   - **Receive 模式**: 二维码渲染 `https://*-*-*-*.direct.eqt.net.im:.../receive/<token>`，支持通过 HTTPS 和 Tus 协议加密直传；
   - **Chat 模式**: 前端 Svelte 逻辑自适应 `window.location.protocol === 'https:' ? 'wss:' : 'ws:'`（既有前端自适应行为），WebSocket 控制信令自动升级为 `wss://` 加密协议，会话数据防局域网窥探。
4. **二维码离线渲染与回环解耦 (Offline Base64 QR Rendering)**:
   - 桌面端 GUI 二维码（涵盖 Share、Receive、Chat 及 Current 视图）统一由 Go 后端调度内核在任务创建时内存级离线生成 Base64 Data URL（`data:image/png;base64,...`）直出到 `TaskRecord.QRCode`。
   - 前端消费层优先直取 `task.qrCode`，规避了桌面端 WebView2 向 `https://<ip>.direct.eqt.net.im:<port>/qr/image` 发起网络 HTTP/HTTPS 回环请求，彻底免疫因路由器 DNS 重绑定防护 (DNS Rebinding Protection)、无外网离线环境或本地自发自收 TLS 握手竞争引起的破图风险。
5. **WebView2 系统代理拦截防护与 CSP 规范 (Proxy Bypass & CSP Guidelines)**:
   - **代理穿透**：Windows 系统开启系统代理（如本地 Clash/V2Ray `127.0.0.1:10808`）时，WebView2 内核会无差别拦截外部顶级域名（包括 `.im`），导致访问 `*.direct.eqt.net.im` 本地回环时挂起或被代理拒绝。必须在启动前通过环境变量 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 追加 `--proxy-bypass-list=*.direct.eqt.net.im;<-loopback>` 强制绕过代理。
   - **CSP 策略**：Wails `AssetServer.Middleware` 的 `Content-Security-Policy` 中 `connect-src` 必须显式包含 `https://*.direct.eqt.net.im:* ws: wss:`，防止内嵌 iframe 或外部网络通道被浏览器策略阻断。
6. **Chat 启动状态同步机制 (Chat Ready Synchronization)**:
   - 桌面端 `pushTask(action="chat")` 必须通过专用就绪通道（`chatReadyCh`）等待底层 HTTP/HTTPS 服务监听并产生有效 `PageURL` 与 `QRCode`（超时 10s），避免异步瞬态返回空 URL 导致前端被重置为“Waiting for network URL...”或由于局部状态覆盖而陷入死循环。
7. **移动端代理拦截与直连分流准则 (Mobile Proxy & Fake-IP Bypass)**:
   - **现象与成因**：移动端（iOS / Android）开启代理应用（如 Clash、Shadowrocket、Surge、Quantumult X 等）时，由于 `*.direct.eqt.net.im` 后缀为曼岛顶级域名（`.im`），绝大多数公网分流规则集（如 Loyalsoldier, ACL4SSR）默认将其判定为境外域名或未知域名，导致流量被分流给境外代理节点，或在 TUN 模式下被劫持分配 Fake-IP（`198.18.0.0/16`）。境外代理节点无法路由回用户局域网私有 IP（`192.168.x.x` / `10.x.x.x`），造成扫码访问彻底超时失败。
   - **规范指引**：在移动端代理工具中将 `*.direct.eqt.net.im` 加入直连白名单：
     - 规则分流：`DOMAIN-SUFFIX,direct.eqt.net.im,DIRECT`（或 QX `HOST-SUFFIX,direct.eqt.net.im,direct`）；
     - Fake-IP 过滤：在 `dns.fake-ip-filter` 中声明 `'*.direct.eqt.net.im'`，避免域名被 TUN 虚拟 IP 劫持；
     - 功能开关：确保客户端已开启“绕过局域网 (Bypass LAN / 局域网直连)”开关。

---

## 6. 移动端 WebKit / Safari HTTPS 下载规范 (WebKit Strict Attachment Requirements)

1. **缓存头冲突规避**:
   - 在 HTTPS 协议下进行文件附件下载（`Content-Disposition: attachment`）时，iOS / iPadOS Safari 的底层下载沙箱（`NSURLSessionDownloadTask`）严格遵循 RFC 约束：如果服务端返回了 `Cache-Control: no-cache` 或 `no-store` 以及 `Pragma: no-cache`，WebKit 会认为该数据不可落盘暂存，直接中断网络连接并抛出系统级错误 **“无法下载此文件 / 无法下载，请重试”**。
   - **正确配置**：必须使用 `Cache-Control: private, no-transform`，并彻底移除 `Pragma` 和 `Expires` 头。
2. **显式 MIME Content-Type**:
   - 严禁对附件下载返回空白或完全依赖自动嗅探；对 `.zip` 强制 `Content-Type: application/zip`，对常规文件优先通过扩展名映射，回退使用 `application/octet-stream`，防止 Safari 拒绝保存。
3. **Range 探测防误判**:
   - Safari 在发起附件下载前通常会预发探测请求（如 `Range: bytes=0-1`）；若分块请求完全交付成功，切勿标记为“传输中断 (Transfer interrupted)”，防止前端轮询产生误报。
4. **内联多媒体传输与安全沙箱规范 (Inline Media Security & Zero-Job Isolation)**:
   - **Stored-XSS 防护**：不可信文件（如 `.svg`, `.html`, `.xml` 等）严禁以内联方式（`Content-Disposition: inline`）下发，即使客户端携带 `?inline=1` 亦必须服务端强制降级为 `attachment` 并应用私有缓存规则。内联白名单仅放行栅格图（`png, jpg, webp, gif, bmp, avif, ico`）。
   - **CSP Sandbox 隔离**：所有内联静态响应必须注入 `Content-Security-Policy: default-src 'none'; sandbox` 与 `X-Content-Type-Options: nosniff`，即使通过顶层窗口新标签页打开，也能完全剥离同源脚本执行权限。
   - **被动加载零 Job 解耦**：`<img>` 等内联流式请求属于被动资产加载，严禁调用 Transfer Manager 创建并广播 Transfer Job（`queued/started/completed`），数据流直接以 `io.Copy(w, reader)` 直出，避免多图加载或断线重连回放时引发全房间事件风暴与 UI 抖动。
   - **统一带宽节流 (Unified Bandwidth Throttling)**：内联媒体传输必须与常规下载统一挂载到带宽调度器（`bandwidth.Scheduler`），受限（免费降级）会话下同样执行每写节流，杜绝通过图片内联或大图预览旁路限速。
   - **流就绪前置判定 (Rendezvous Readiness Before Header Commit)**：在跨节点中继/对端流式代理模式下，必须等待发送端流建立就绪后才可发送 `WriteHeader(200)`。严禁在尚未拿到有效数据流前提前提交 200 OK，防止超时阶段产生多余的 WriteHeader 异常或给客户端造成破图截断。

---

## 7. Windows GUI 子系统日志句柄避坑准则 (Windows GUI Handle Safety)

- **陷阱**：在带有 `-H=windowsgui` 标志编译的 Windows GUI 进程中，操作系统默认不分配控制台，`os.Stderr` 的文件描述符为非法句柄（`INVALID_HANDLE_VALUE`）。
- **严重后果**：若使用标准库 `io.MultiWriter(os.Stderr, fileLogger)`，由于 `os.Stderr` 排在第一位，其 `Write` 必定返回错误，导致 `io.MultiWriter` 立即短路退出，**后续的 `fileLogger` 永远收不到任何日志字节，造成 GUI 模式下日志全盘静默丢失**。
- **解决方案**：必须使用容错的 `safeMultiWriter`，遍历各个 writer 独立执行 `Write`，彻底隔离 `os.Stderr` 的错误，保障核心文件日志 100% 稳定落盘。

---

## 8. 演进架构：单机私钥零泄漏与设备专属 ACME 自动化 (Zero-Leak Evolution)

- **核心演进**：彻底淘汰过渡期通配符私钥共享与脚本同步机制，演进至工业级 Tailscale 路线（本地 ECDSA P-256 私钥自生成，永不出机；云端基于硬件指纹代理 RFC 8555 ACME DNS-01 签发）。
- **详尽架构机制文档**：详见核心技术蓝图 [`docs/mechanism/lan-tls-zero-leak-acme-architecture.md`](file:///home/yelon/develop/me/eqrcp/docs/mechanism/lan-tls-zero-leak-acme-architecture.md)。

---

## 9. Mozilla Public Suffix List (PSL) 官方收录与自动化合规基线 (Mozilla PSL Inclusion)

- **官方 Pull Request**: [publicsuffix/list#3258](https://github.com/publicsuffix/list/pull/3258) (`Add direct.eqt.net.im to PRIVATE section`)
- **自动化 CI 审查标准**:
  - PR 正文必须使用官方自动化模板（严禁裁剪、压缩或删除任何表单项与复选框），7 个 `<!-- FILL IN -->` 必须严丝合缝闭环；
  - 官方 CI `PR template check / check-template (pull_request_target)` 必须 100% 通过（已秒级 Successful 通过）。
- **PRIVATE 分区字母序铁律**:
  - PRIVATE section 按照公司/组织名称字母序排列（`public_suffix_list.dat` 声明 `Note: these are in alphabetical order by company name`）；
  - `EQT` (Eq...) 必须严格位于 `// encoway GmbH` 之后、`// EU.org` 之前；
  - 必须通过官方 Go 校验工具：`tools/psltool fmt ../public_suffix_list.dat` 与 `tools/psltool validate ../public_suffix_list.dat`（输出 `PSL file is valid`）。
- **双机权威 DNS 常驻验证记录**:
  - `ns1` (`128.241.227.181`) 与 `ns2` (`103.232.92.220`) 的 systemd 服务挂载 `-psl-url https://github.com/publicsuffix/list/pull/3258`；
  - 权威解析器原生响应 `_psl.direct.eqt.net.im.` TXT 查询，全球公共递归解析（`1.1.1.1` / `8.8.8.8`）实时可查且必须长期保持。

---

## 10. 云端证书置备网关与桌面端静默置备调度 (Cloud Gateway & Silent Provisioning)

- **云端置备接口 (`POST /api/v1/cert/provision`)**:
  - 路径：`cloudflare/eqt-drm-api/src/routes/cert.ts`；
  - 鉴权防刷：时间戳防重放（±300s）、设备黑名单过滤、D1 持久化频控（单设备 24h 最多 3 次，超限返回 429 与 `Retry-After: 86400` 并记录 `RATE_LIMIT_CERT_PROVISION`）；
  - 强密码学 CSR 校验：纯 Web Crypto 解析 PKCS#10 DER，严格校验 CommonName 为 `${node_id}.direct.eqt.net.im`，SAN 必须同时且仅包含单域名与通配符 `*.${node_id}.direct.eqt.net.im`；
  - 证书颁发与审计：90 天标准 X.509 签发，异步记录至 `device_cert_provisions` 审计表；
  - 细致结构化日志：全链路覆盖 `[START]`, `[RATE-LIMIT]`, `[CSR-PARSE]`, `[ISSUE]`, `[SUCCESS]`, `[ERROR]`，保留 `trace_id`。
- **桌面端静默置备调度 (`App.startup`)**:
  - 启动后 3 秒低优调度 `silentProvisionDeviceTLSCert`；
  - 探测本地 `~/.config/eqt/certs/<node-id>/fullchain.pem`，有效且剩余大于 15 天时直接复用，临期或缺失时非阻塞静默发起云端置备；
  - 置备成功后发射 Wails 事件 `eqt:tls-cert-ready`，前端设置面板平滑切换为绿锁；
  - 离线或异常时保持 Fail-Soft 降级，普通 HTTP 传输不受任何影响。
- **测试环境与上线前文案治理 (Test Isolation & Staging Governance)**:
  - 测试环境隔离：Cloudflare Worker 测试环境部署在 `lic-test.eqt.net.im`，绑定专用隔离 D1 数据库 `eqt-drm-db-test`（`c4e4e57f-3b75-4198-8c60-3584758e9b47`）；
  - 动态端点覆盖：Go 端 `pkg/cert` 支持通过环境变量 `EQT_PROVISION_ENDPOINT` 灵活切换置备网关；
  - 生产环境真实处境适配：在 Mozilla PSL 合并生效与 Let's Encrypt 频控豁免完成官方审批前，TLS 处于非默认开启状态。官网（`cloudflare/eqt-website`）各语言对外文案收敛隐藏 TLS 免装证书说明，重点宣导“局域网物理内网极速直连”、“零云端中继”、“无外网流量消耗”；待未来正式全量放开后再行恢复。
- **🔴 公信绿锁验收红线与测试环境推进策略（2026-09-10 复核更新）**：
  - ⚠️ **现状标记**：`cert.ts` 当前签发引擎为**每请求瞬态自签 CA**（Issuer `EQT LAN-TLS Intermediate CA`，`issueCertificateFromCSR` 未传 signingKey 时临时生成），**非 Let's Encrypt 公信签发**——手机扫码会触发 `NET::ERR_CERT_AUTHORITY_INVALID` 红屏，[`docs/bugs/2026-09-09-new-user-tls-cert-cache-bootstrap-defect.md`](file:///home/yelon/develop/me/eqrcp/docs/bugs/2026-09-09-new-user-tls-cert-cache-bootstrap-defect.md) §四 DoD 3 绿锁验收尚未达成；公网新用户放行前必须接入真实 LE DNS-01 代理（详见 [`docs/mechanism/lan-tls-zero-leak-acme-architecture.md`](file:///home/yelon/develop/me/eqrcp/docs/mechanism/lan-tls-zero-leak-acme-architecture.md) §七.9 FINDING 1）。
  - 💡 **PSL 范围澄清与测试环境策略**：PSL 的第一性原理是为公网海量用户规模化时破除主域每周 50 张限额；**测试环境每周消耗极低（<50张）且有 Staging（30,000张/周）托底，测试环境绝对不需要等待 PSL，可直接在测试环境率先落地 RFC 8555 Let's Encrypt DNS-01 代理闭环！**
  - **验收四条（评估“官方公信绿锁”链路是否真正达成时逐条核对）**：
    1. 签发 CA 是否存在于浏览器/OS 信任存储库（自建/瞬态 CA 一律判失败，浏览器必红屏）；
    2. 云端是否真实存在 ACME client 交互（NewOrder/DNS-01/Finalize，而非手写 X.509 自签）；
    3. 服务端是否实际校验硬件签名 `X-EQT-Hardware-Signature`（仅透传 = 防刷未落地）；
    4. 时间戳反重放窗口与规格一致（机制文档承诺 ±60s，实现当前为 ±300s）。


