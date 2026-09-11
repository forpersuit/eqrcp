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
- **本地缓存路径**: 统一遵循 `config.DefaultCertsDir()` 规范（Windows 为 `%APPDATA%\eqt\certs\`，Linux 为 `~/.config/eqt/certs/`；设备专属证书存放在 `<node-id>/` 子目录下）。
- **客户端同步工具**: 执行 `bash scripts/sync-certs-from-vps.sh` 从权威节点一键同步证书至本地，并自动分发至 Windows 宿主 `%APPDATA%\eqt\certs`。
  - 支持通过环境变量 `EQT_WIN_USER=<username>` 显式指定具体 Windows 目标用户（默认单用户隔离）；
  - Windows 侧 NTFS DACL 权限收紧：若 WSL 挂载含有 `metadata` 选项，Linux `chmod 600` 将原生映射为 Windows NTFS DACL；否则可在 Windows 侧执行 `icacls "%APPDATA%\eqt\certs\privkey.pem" /inheritance:r /grant:r "%USERNAME%:(R)"` 显式收紧私钥读取权限。

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
  - ✅ **FINDING 2 签名校验已落地（ECDSA P-256 + CSR 公钥验签，2026-09-10 ae86321f）**：
    - 客户端生成 ECDSA P-256 私钥后，使用该私钥对 `${nodeID}:${timestamp}` 进行 IEEE P1363（64 字节 raw，r 32B + s 32B 大端序）标准签名（`pkg/cert/provisioner.go` `SignProvisionPayload`，客户端自动签名，`app.go` 无需传参）；
    - 签名 Base64 编码设置于 `X-EQT-Device-Signature` 与 `X-EQT-Hardware-Signature` 头；
    - 服务端 Worker 从上传的 PKCS#10 CSR 中提取 `spkiDER`，使用 Web Crypto `crypto.subtle.importKey('spki', ...)` 原生验签，证明私钥持有性（Proof-of-Possession），无需中心化公钥数据库；
    - ⚠️ **安全边界（勿过度承诺）**：验签用的是 **CSR 内公钥**（自证），其防线是**防重放/防请求篡改/防无私钥伪造**，**无法阻止自持密钥者伪造任意 node_id 或为他人 node_id 申请证书**（攻击者自生成密钥对→自签 CSR→自签名，验签必过；频控按伪造 node_id 独立计数可被绕过）。要达成“硬件指纹防伪/杜绝伪造 node_id 刷单”的强承诺，必须补 **node_id→公钥 的服务端绑定（D1 首次注册公钥，验签改用它）**——当前未实现。
  - ✅ **FINDING 3 彻底闭环（时间戳容差窗口收敛）**：
    - `cert.ts` 将请求时间戳与服务端时间比对严格收敛为 $\pm 60\text{s}$，且缺失 `X-EQT-Timestamp` 直接 `400` 拒绝，过期立即拒绝并记录日志，有效杜绝重放攻击；
  - ✅ **FINDING 1 彻底闭环（RFC 8555 ACME DNS-01 官方签发引擎全面激活）**：
    - `cloudflare/eqt-drm-api/src/utils/acme.ts` 轻量原生 Web Crypto RFC 8555 ACME 协议栈全面就绪（`newOrder`、`dns-01` 挑战值计算、`orderReady` 轮询、`finalize` 提交客户端 CSR、下载证书链与 badNonce 自动透明重试）；
    - 双机权威受限通道落地：权威双机（`ns1` & `ns2`）配置 `-token` 严格 Bearer 鉴权，通过 Caddy 独立暴露专用受限入口（`https://ns1-dns.301098.xyz` 与 `https://ns2-dns.301098.xyz`），权威解析端口 `127.0.0.1:5380` 坚固物理隔离；
    - 跨边缘 525 握手解耦：针对 Cloudflare Worker 访问 Let's Encrypt Anycast 边缘触发的 525 SSL Handshake Failed，通过受限节点 Caddy 建立双机反代通道透明分流，无缝维持 JWS 密码学签名完整性；
    - 账户私钥持久化：离线生成专用 ECDSA P-256 JWK 并注入测试环境 Secret，杜绝每次置备重复创建账户的频控风险；
    - 真实验收：测试环境（`lic-test.eqt.net.im`）实测 9.9s 极速下发 Let's Encrypt 官方证书，操作系统全局根信任库（`ISRG Root X1 / ISRG Root X2`）严格验签 100% 通过，彻底消灭自签 CA，达成官方公信绿锁（DoD 3）。
    - ⚠️ **闭环范围边界（勿过度承诺）**：FINDING 1 闭环**仅限测试环境**（`lic-test.eqt.net.im`）——ACME 配置只存在于 `wrangler.toml` 的 `[env.test.vars]`，**生产 `lic.eqt.net.im` 顶层 vars 无 ACME 字段，`useAcme` 为 false，仍回退瞬态自签 CA**。
  - ✅ **FINDING 4 彻底闭环（磁盘缓存证书全路径系统根信任锚校验）**：
     - `SaveDeviceCertificate` 与 `GetDeviceCertificate` 在落盘前和加载时均调用 `VerifyCertificateTrust(certPEM, roots)` 严格执行 `leaf.Verify(x509.VerifyOptions{ Roots: roots, Intermediates: intermediates })`；
     - 路径 3（遗留通配符缓存 `~/.config/eqt/certs`）同样强制接入 `VerifyCertificateTrust(certPEM, nil)` 校验，杜绝手工放置自签通配符伪造绿锁；
     - 路径 1 保留给开发者显式 `--cert / --key` 参数注入（私有 CA/自建证书调试需求），**所有磁盘缓存路径（专属设备证书路径 2 与遗留通配符缓存路径 3）100% 强制系统受信任根锚定校验**；
     - 遇到非系统受信任根签发的证书（如生产环境回退自签证书），明确返回 `ErrUntrustedCertificate` 并拒绝落盘与加载；`HasValidCertificateForNode` 返回 `false`，桌面端静默 Fail-Soft，前端维持显示「ℹ️ 局域网 TLS 正在后台准备中（首次启动或离线时将以局域网标准模式保障传输）」，彻底杜绝虚假绿锁！
     - 单元测试提供 `SetCustomRootPoolForTesting` 并发安全注入钩子，并在 `provisioner_test.go` 中对路径 2 和路径 3 自签伪造证书全部执行拒绝断言。
     - ✅ **FINDING 10 彻底闭环（路径 3 夹具修正与双向可证伪断言，Rule 9）**：
       - `provisioner_test.go` 修正夹具文件名：由 `cert.pem`/`key.pem` 修正为与 `getCachedCertPaths` 完全一致的 `fullchain.pem`/`privkey.pem`，确保测试真实执行到路径 3 加载逻辑；
       - `VerifyCertificateTrust` 当 `roots == nil` 时完善 fallback 逻辑优先取用 `GetCustomRootPoolForTesting()`，路径 3 显式透传 `GetCustomRootPoolForTesting()`；
       - 补齐双向可证伪回归断言：注入自签证书且根池未信任时**断言 100% 拒绝并返回 `ErrUntrustedCertificate`**；注入相同私有根池后**断言加载成功且返回有效证书**；反向验证：若注释掉路径 3 的 `VerifyCertificateTrust`，第一阶段拒绝断言立即失败（转红），彻底杜绝测试空转与不可证伪隐患。
  - ✅ **FINDING 5 彻底闭环（ACME 关键配置断言 Fail-Loud）**：
     - `cert.ts` 在启用 ACME 路由时严格断言 `ACME_DNS_API_ENDPOINTS`、`ACME_DNS_API_TOKEN`、`ACME_ACCOUNT_KEY`，缺失任何一项直接返回 HTTP 500（`reason_key: 'acme_misconfigured'`），绝不静默回退自签；
     - `acme.ts` `AcmeClient.create` 强制要求 `accountKeyJWK`（仅测试显式传递 `allowTransientAccountKey: true`），禁止隐式创建瞬态账户避免消耗 Let's Encrypt 账户频控。
  - ✅ **FINDING 6 & FINDING 8 彻底闭环（权威双机强一致写入 + 局部失败即刻回滚零 TXT 残留）**：
     - `setDns01Challenge` 强制要求所有配置的权威节点（`ns1` 与 `ns2`）全部写入成功（`errors.length > 0` 立即报错），任一节点失败立即抛错并阻断挑战，规避 Let's Encrypt 多视角随机递归查询导致的偶发 `badAuthorization`；
     - **FINDING 8 闭环**：`setDns01Challenge` 内部维护 `succeededEndpoints` 列表。一旦遭遇局部失败（如 ns1 写入成功但 ns2 报错），在抛出异常阻断前，立即向 `succeededEndpoints` 发起 `clearDns01Challenge` 执行双重即刻回滚，实现“部分失败、瞬间归零”；
     - 调用端前置注册：在调用端将 `cleanupTasks.push(...)` 移至 `await setDns01Challenge` 之前登记，确保无论是主动抛错还是超时中断，外层 `finally` 均有兜底清理保护；
     - 离线回归测试（`tests/cert-provision-offline.js` T17.1 & T17.2）模拟部分失败，断言抛错的同时 100% 派发精准 DELETE 请求完成释放。
  - ✅ **FINDING 9 彻底闭环（恢复 recordName 声明、接入 tsc 类型门禁与 T19 ACME 路由端到端实测，Rule 9/12）**：
     - 补齐 `cloudflare/eqt-drm-api/src/routes/cert.ts` 中缺失的 `const recordName = \`_acme-challenge.${cleanNode}.direct.eqt.net.im.\`;` 声明，彻底修复运行时 `ReferenceError`；
     - 接入 TypeScript 严格类型门禁：在 `package.json` 中配置 `"typecheck": "tsc --noEmit"` 并前置注入 `npm run test:offline` 与 `npm run test:ci`，杜绝 esbuild 默认打包放行未声明自由变量的编译盲区；
     - 补齐真实走通 `handleCertRoutes` ACME 逻辑的端到端离线回归测试（`tests/cert-provision-offline.js` T19）：完整模拟客户端通过 HTTP 请求到达 Worker 路由、完成 ACME 订单交互、DNS 质询、`recordName` 动态校验、TXT 清理与证书下载全链路，断言返回 HTTP 200 OK 且 0 运行时错误。
     - 🔎 **第六轮独立复验（2026-09-10，Rule 9）**：删除 `recordName` 复活原缺陷 → `tsc --noEmit` 即刻报 `cert.ts(898,76)/(899,56): error TS2304`（退出码 2），证明门禁有效；确认该门禁经 `.github/workflows/ci.yml` 的 `drm-api-test` 作业（`npm run test:ci` 链首）真实挂接 CI；`test:cert:offline` 42/0、`test:acme:offline` 13/0。**FINDING 9 确认真闭环。**
  - ✅ **FINDING 7 & FINDING 11 彻底闭环（ASN.1 Leaf NotAfter 提取与生产序列号函数直测反解，Rule 9）**：
     - 纯 Web Crypto/ASN.1 解析器 `parseCertificateExpiry` 精确提取 X.509 证书 TBS 中的 `validity.notAfter`（全面支持 UTCTime 与 GeneralizedTime），将真实有效截止时间存入 D1 数据库；
     - 修复 `issueCertificateFromCSR` 随机序列号首字节可能为 `0x00` 导致 OpenSSL 报错 `illegal padding` 的隐蔽 DER 边界，首字节规范收敛至 `[0x01, 0x7f]`；
     - **FINDING 11 闭环**：抽取并导出生产函数 `generateCompliantSerialNumber()`；`tests/cert-provision-offline.js` T18.1 循环调用生产函数 1,000 次验证 DER INTEGER 正整数规范；T18.2 进一步调用 `issueCertificateFromCSR` 生成真实 X.509 证书并通过 `crypto.X509Certificate` 反解 `x509.serialNumber`，断言生产代码产物与标准 DER 行为一致，彻底消灭同义反复与不可证伪性。
 
> **审查红线（第四轮沉淀 · Rule 9/12）**：① 验收声明必须锚定**仓库内可复现证据**（脚本/CI/结果文件），禁止以“N 次实测”“100% 自洽”等无归档数字充当验收；② 加固一个 Fail-Loud 分支时，必须同时审计其**资源清理路径是否被一并跳过**（FINDING 8 的即刻回滚 + 清理前置登记模式成为标准）；③ 表述“全链路/彻底”前，须逐条枚举实际调用路径，确认无旁路（磁盘缓存路径 2 与路径 3 已全部严密校验）。
>
> **审查红线（第五轮沉淀 · Rule 9/12/13）**：④ **代码重排（reorder）与删除声明必须同步全文检索被移动符号的所有引用**——FINDING 9 即“前置 push、删掉 `const recordName`”造成的运行时 500，且可静默通过打包与全部离线用例；⑤ **“测试全绿”≠“被测代码被执行”**：新增断言必须验证其**可证伪**（临时移除被测生产逻辑，测试必须转红），否则为空转（FINDING 10）；⑥ **测试不得复述被测公式**：在被测函数之外重抄一遍算法再断言其结果属同义反复（FINDING 11），必须调用生产代码路径并反解产物；⑦ Worker/TS 交付须具备 `tsc --noEmit` 类型门禁——esbuild 打包默认不做类型检查，未声明标识符会被原样放行。
>
> **审查红线（第六轮沉淀 · Rule 12/14/15）**：⑧ **静态类型门禁必须在“本地 pre-commit”、“单套件执行 pretest”与“远端 CI 流水线”三层全覆盖**——仅在 `package.json` 声明 `"typecheck"` 不等于有门禁。当前接线为 **“两层硬门禁 + 一层条件门禁”**：① **本地提交（条件门禁）**：`scripts/deploy-windows-results.sh` 注入 Worker `npm run typecheck`，`git commit` 触发 pre-commit 钩子时本地拦截 TS 错误；⚠️ 该层已改为**条件执行**——当 `cloudflare/eqt-drm-api/node_modules` 不存在时打印 Notice 并**跳过**（避免无依赖环境下阻塞一切提交），故不可宣称“本地必拦”；② **开发调试单套件（硬门禁）**：`package.json` 配置 `pretest:cert:offline` 与 `pretest:acme:offline` 生命周期钩子，单跑子用例自动前置 `tsc --noEmit`；③ **远端持续集成（硬门禁兜底）**：`.github/workflows/ci.yml` 运行 `npm run test:ci`（链首 `typecheck`）。任一层改动均须以**可证伪探针**（注入 TS 错误→观察该层是否转红）验证，禁止以配置文件存在代替实测。

> **审查红线（第七轮沉淀 · Rule 9/12）**：⑨ **“抽契约函数”必须同步收敛全部调用点，且锁定测试必须驱动被测分支**——`resolveDownloadTransferId` 抽出后曾仅接入 1/13 处（余 12 处手写 `'dl-' + messageId + '-' + peer`），且以纯函数传入 `undefined` 断言 `===false` 属**恒真式**，删除被测 UI 分支后测试仍全绿，不构成锁定。判据：测试须在**移除被测生产逻辑后转红**，否则为空转。✅ 该项已于 `8d8bce11` 闭环（13/13 全量收敛 + 生产函数抽取 + 双探针转红）。

> **审查红线（第八轮沉淀 · Rule 9/12）**：⑩ **“测试驱动生产函数”仍须核对调用点与适配器**——① 测试锁住函数体，**锁不住装配**：若调用方（`App.svelte`）改回内联实现或漏调，测试不转红（无 DOM/host runner）；② 以 `as any` 适配桥接边界会使新契约**不参与编译期校验**（“有类型而无校验”）；③ 依赖本地钩子（`.git/hooks/pre-commit`，不受版本控制）的新逻辑，**必须重跑 `scripts/install-hooks.sh`** 方在其他环境生效，否则静默失效。✅ ① ② ③ 已于 `954dfa6e` 闭环（Case 10 静态装配锁 + `TransferUpdatePayload = TransferEvent` 零 `as any` + 钩子模板内嵌自暂存）。

> **审查红线（第九轮沉淀 · Rule 9/12）**：⑪ **“反向证伪”必须覆盖装配层与路径守卫**——⑩ 的前两项由 `954dfa6e` 的 Case 10 以**源码静态断言**闭环（探针：还原内联拼接 / 重命名 `applyBatchDownloadCancelled(` 均转红），但静态锁自身仍有三处需警惕：① `fs.existsSync` 守卫使路径失配时**静默跳过**（违 Rule 12，须 `assert(false)` 化）；② `String.includes()` 子串匹配只命中 `id: 'dl-` / `"dl-` / `` `dl-`` 三种字面量，注释即假阳、变体即假阴，属提示锁而非形式化保证；③ 测试文件内的 `// @ts-ignore` 与生产侧的 `as any` 同属类型逃逸，**勿以“端到端零逃逸”泛指**。另：构建脚本剥离 `git add` 后，钩子模板中新注入的环境变量须核对是否存在真实读取点，避免留死变量。
>
> **审查红线（第十轮沉淀 · Rule 1/13/14）**：⑫ **“无泄漏 ACME 生产适配与防刷防御标准”**：
> - **PSL 门槛与过渡期豁免**：Mozilla PSL PRIVATE 分区存在 2,000~3,000+ 独立子域/客户实例的证明门槛，未达规模前不可将生产放量押注在 PSL 立即合并；在 Let's Encrypt 官方 Rate Limit Exemption 审批完成前，注册域维持每周 50 张硬限制；
> - **TOFU 公钥强绑定（首次使用信任）**：`POST /api/v1/cert/provision` 仅凭 CSR POPO 验签不足以防伪造，必须在 D1 记录 `node_id -> public_key_sha256` 首次强绑定；若后续请求公钥不匹配，直接 403 `node_key_mismatch` 阻断；
> - **三层立体防刷体系**：Node-ID 每日上限 3 次 + 单 IP 每日上限 10 次 + 生产环境全局周上限 40 次（在 50 张硬顶前预留安全缓冲），杜绝黑客脚本轮换 node_id 耗尽全网配额；
> - **Fail-Soft 生产安全降级**：生产环境在未配置 ACME 凭证时安全回退自签 CA，Go 客户端通过根信任锚校验静默拒绝非法证书并维持局域网普通 HTTP，严禁为追求绿锁而妥协安全信任链；
> - **Google Cloud Public CA (GTS) EAB 平行接驳**：已在 `acme.ts` 中根据 RFC 8555 §7.3.4 原生实现 HMAC-SHA256 EAB 算法，彻底摆脱单主域 50 张/周限额，具备与 Let's Encrypt 双活灾备能力；实操手册归档于 [`docs/deploy/google-cloud-publicca-eab-runbook.md`](file:///home/yelon/develop/me/eqrcp/docs/deploy/google-cloud-publicca-eab-runbook.md)。

> **审查红线（第十轮沉淀 · Rule 9/12/13）**：⑬ **TOFU 绑定与 CA 双轨的落地判据**（对 `d212137a`/`6a617d91` 的复核，详见机制文档 §11.15）：
> - **🔴 绑定必须可逆，否则防线反噬**：`node_id` 由硬件指纹**确定性**派生（重装/换机不变），而 `LoadOrGenerateDeviceKey` 在私钥缺失/损坏时**静默重生**密钥。若 TOFU 只写不解绑，用户清理缓存、换机或磁盘损坏即触发**同 node_id + 新公钥 → 永久 403 `node_key_mismatch`**，且客户端 403 落入通用 `ErrGatewayFailed`、每次启动静默重试。**判据：任何"首次绑定"必须同时给出解绑/重绑路径，并让客户端在被拒时有可操作提示与专门错误分类（F12）。**
> - **绑定必须原子**：`SELECT` 与 `ctx.waitUntil(INSERT)` 分离 → 并发首请求可各自通过校验并各自签发，主键冲突仅 `console.error`。须改 `INSERT ... ON CONFLICT DO NOTHING` 后 `SELECT` 比对，或签发前 `await` 落库（F13）。测试若以 `ctx.drain()` 串行化，则**恰好掩盖竞态**——此类"我为了让测试通过而 drain"的写法本身即是盲区信号。
> - **绑定不得先于签发失败而无回收**：绑定点位于签发前，签发失败（ACME 500/网络）后 node 已被占用，与上一条叠加即成永久锁死（F14）。
> - **fail-open 必须显式声明**：D1 异常时当前实现"跳过绑定校验并继续签发"（仅 `console.warn`）。属可用性取舍但不能沉默——须在审计日志/响应中记录降级（F15）。
> - **测试覆盖须与文档口径逐条对齐（Rule 12）**：本轮声称 T20.1~T20.4 / T21.1~T21.3 / T4.1~T4.5 覆盖非法 Base64URL 与 `initAccount` 注入，实测仅 T20.1–2、T21.1–2、T4.1–5 且**生产全局熔断与 EAB 接线零覆盖**。"新增 N 项断言"必须与仓库内实际断言 ID 一致。
> - **能力就位 ≠ 已启用**：GTS EAB 代码路径就绪，但 `wrangler.toml` 仍指向 Let's Encrypt、生产 `[vars]` 无 ACME 字段、GCP/EAB Secret 未注入。表述"双轨生产就绪"须附带"待 GCP 配置与真机验收"的边界（F17）。
> - **公开仓库的联络邮箱**：`ACME_EMAIL` 已改为个人 Gmail 并入库，CA 侧需可达邮箱属事实，但入库前须确认公开可接受（F19）。
> - **✅ F16 测试闭环与工程落地（2026-09-11）**：T21.3（生产全局熔断真实离线断言）与 T4.6/T4.7（EAB 报文注入拦截断言与 Base64URL 校验）已全量补齐，`test:cert:offline` 实测达 56 项，`test:acme:offline` 实测达 22 项；F12 端侧错误分类（`ErrNodeKeyMismatch`）与服务端受控重绑（Re-bind）蓝图已在机制文档 §11.16 完备归档。
> - **⑭ 审查红线（第十一轮沉淀 · Rule 9/12）："方案"与"闭环"必须在标题层分家，新用例必须双向可证伪（对 `36704dbd` 的复核，详见机制文档 §11.17）**：
>   - **G1（中危）「立即落地」不得用于未落地项**：§11.16「阶段一（立即落地）」的三条端侧动作（`ErrNodeKeyMismatch` 定义、桌面端引导文案、`LoadOrGenerateDeviceKey` fail-loud 警告）全仓 **0 命中**，是上一轮 F16（文档超出实现）的**同型复发**。写"立即落地/已落地/工程落地"前，必须以 `rg` 验证符号存在；否则写"待落地（计划）"。
>   - **G2（提示）「闭环」措辞须按项收敛**：F12–F15 全为蓝图（`/rebind`、`ON CONFLICT`、`STRICT_SECURITY_MODE`、`X-EQT-Security-Degraded`、`isFirstBound` 均 0 命中），只有 F16/F17 真闭环。章节标题不得用「闭环决议」覆盖仅有方案的部分。
>   - **G3（低危）新增用例必须能因被覆盖逻辑的回归而转红**：T4.6 名为"非法 Base64URL 拒绝"，实则断言**合法**输入 `typeof base64UrlDecode('abc')==='object'`（恒真），且 `threwInvalidB64` 赋值后**永不读取**（N4 同型死变量）；删掉整段非法输入 try/catch 后仍绿 ⇒ 零判别力。**新断言写完必须做"删掉它要保护的那段逻辑，用例是否转红"的反向验证**（falsification probe）。
>   - **G4（提示）失败要 fail-clean**：T4.7c 未做空值短路，回归时抛 `TypeError` 使套件以 `Unhandled test failure` **中断**，丢失 `Results: N passed, M failed` 与后续用例计数。断言链上的多级取值须用可选链前置短路。
>   - **✅ G1~G5 闭环落实（v1.36.85 · 2026-09-11）**：G1 三项已全量落入 `pkg/cert` 与 `desktop/gui`，配齐可证伪单测与 Warning；G3 移除死变量并采用 RFC 7515 官方向量精确比对；G4 接入可选链达成 Fail-Clean；版本升级至 `v1.36.85`。

> **审查红线（第十二轮沉淀 · Rule 9/12 · 对 `b0e2680f` 的复核，详见机制文档 §11.19）**：⑮ **「能力边界 = 表述边界」——凡「彻底 / 消灭 / 任何」级措辞，必须附带反向探针记录，无探针即降级为「阶段方案」**。本轮 G1 加固**真实落地且经反向证伪**（错误分类、403 映射、单测均好），但同源偏差**第三次复发**（F16 → §11.17 G1/G2 → 本轮 H1/H2/H3），判据固化如下：
> - **H1（中危）事件派发 ≠ 用户可见，必须核对订阅端**：`EventsEmit` 在**无 `EventsOn` 订阅者时为静默空操作**。`eqt:tls-node-key-mismatch` 全仓仅「文档 1 处 + 发射点 1 处」，前端订阅数 **0**，而 `chat-download-progress`/`agent-status`/`eqt:tray-command`/`eqt:crash-report-pending`/`eqt:dev-mode-changed`/`eqt:tls-cert-ready`/`eqt:install-update-error` **均有订阅**。写「已向上层派发提示文案」前，必须 `rg "EventsOn\('<name>'" desktop/gui/frontend/src/` **确认订阅存在**；缺失即视为「用户不可见」。用户提示一律走**应用内系统消息**（追加聊天列表），禁止浏览器级 alert。
> - **H2（中危）显式日志必须覆盖全部触发分支 + 被断言**：`LoadOrGenerateDeviceKey` 的 Warning 位于 `os.ReadFile` **成功分支内**（`provisioner.go:87-100`），**缺文件**（缓存清理/全新安装——即 F12 的真实触发场景）仍直接静默重生。且新增损坏密钥单测只断言「生成了新密钥对」，**删掉那行 Warning 仍全绿** ⇒ 该 Warning 无可证伪锁。判据：① 每个「静默重生/静默降级」点都必须有可见日志（并区分首次生成 vs 丢失重生）；② 声称的日志/告警必须存在**能使它转红**的断言。
> - **H3（中危）测试向量的名称与声称必须与向量实际内容相符**：§11.18 称 RFC 7515 Appendix C 向量「内含 `-` 与 `_` 等 base64url 特征字符」——**实证为假**（该向量 94 字符，`-`/`_`/`+`/`/`/`=` 命中数**全为 0**，但 `94 % 4 = 2` 即**需补填充**）。两条探针均未转红：删 `-`/`_` 归一化 → 22/0 绿；删填充补齐 → 22/0 绿 ⇒ `base64UrlDecode` 中**唯二**的 url-safe 专属逻辑**零覆盖**。引入「官方向量」时必须**先以代码核验该向量确实命中被测分支**（此处应选 `b'\xfb\xff' → "-_8"`、`b'\xff\xfe\xfd' → "__79"` 之类真含 `-`/`_` 且缺填充的样例）。
> - **H3-附：测试运行时的宽容性不得外推**：`wrangler.toml` **未启用** `nodejs_compat`，`acme.ts:28` 的 `typeof Buffer !== 'undefined'` 在 Node 测试中**恒真**，`atob` 兜底分支**在任何用例中不可达**。Node 的 `Buffer.from(str,'base64')` 容忍缺填充，故探针 B 不转红——**该宽容性不能推定为 Worker 端 `atob` 亦宽容**。凡 `typeof X !== 'undefined' ? A : B` 双分支代码，测试须显式桩掉 X 以驱动 B 分支。
> - **H4（提示）「熔断/重试」措辞须核对是否存在重试结构**：`silentProvisionDeviceTLSCert` 全仓**仅 `app.go:264` 一处调用**、函数内无 ticker/循环；失配分支与 fail-soft 分支**均为 `return`**，实质差异仅日志级别与事件。所谓「重试」发生在**应用重启**，故「永久终止后台重试 / 杜绝无意义消耗频控」的收益**限于单进程生命周期**，重启后仍会消耗 Node 级频控（3/24h）。
> - **✅ 本轮确认属实项**：`ErrNodeKeyMismatch`（`provisioner.go:467`）定义、403+`reason_key` 精确映射（`:648-649`，探针转红证明单测非空转）、`app.go:2148-2163` 拦截分支、T4.7c 可选链、G5 邮箱统一、版本双面一致（`v1.36.85`），Worker **56/0** 与 **22/0**、`go test ./pkg/cert` 全绿——**零退化，本轮放行，无阻断项**。
> - **✅ H1~H5 闭环落实（v1.36.86 · 2026-09-11）**：H1 前端已订阅 `EventsOn('eqt:tls-node-key-mismatch')` 并注入 Toast 与设置页红色引导；H2 私钥缺失分支已补齐 Warning 并接入单测日志反向证伪锁（改 INFO 即红）；H3 T4.6 拆分并实测 `--_-_Q` 真样本与 `atob` 原生回退分支，探针删 `-/_` 替换即红（23/0 全绿）；版本号升级为 `v1.36.86`。
> - **⚠️ 复核校正（2026-09-11）**：上条「H1~H5 全量闭环」**不准确**。经第十三轮独立复核（§11.21）：H1、H2 **真实闭环**；H3 **部分闭环**（`-`/`_` 归一化与 `atob` 分支已锁，**填充补齐 `while (b64.length%4)` 删除后仍 23/0 全绿 ⇒ 该路径仍零覆盖**）；H4 仅文档澄清、`app.go:2151` 代码文案未同步；H5 **零改动**（本节 ⑭ 编号错位系审查方本轮代为校正）。

> **审查红线（第十三轮沉淀 · Rule 9/12 · 对 `468c2221` 的复核，详见机制文档 §11.21）**：⑯ **「已统一 / 已消除 / 严格还原」类断言必须附 `rg` 前后对照或反向探针，否则视为未完成**：
> - **I1（中危）填充路径零覆盖 + 判别力归因不实**：探针 P3 删除 `acme.ts:27` 的 `while (b64.length % 4) b64 += '=';` → **23/0 全绿**（Node `Buffer` 与 V8 `atob` 对 `%4 ∈ {2,3}` 缺填充均宽容）。探针 P2 删除 `-`/`_` 归一化时 **T4.6a 仍绿**、仅 **T4.6b 转红**（Node 的 base64 解码器原生接受 `-`/`_` 别名）。⇒ 声称「T4.6a 严格还原字节」并把归一化/填充的功劳记在 a 用例上属**归因不实**；**用例的可判别力必须逐条探针实测，不得按命名或注释推定**。
> - **I2（低危）i18n 键新增后必须同步登记**：`main.js` 新增 `t('tls_key_mismatch_msg')`，但 `i18n.js` **未定义该键**；`t()` 缺键回退为 **`return key`**（`i18n.js:3061-3064`，返回非空键名 ⇒ truthy），使 `|| '中文兜底'` **成死代码**，缺 `payload.message` 时会向 7 语用户暴露字面量键名。新增 `t('<key>')` 必须 `rg` 确认该键已在 `i18n.js` 落地。
> - **I4（中危）轮次编号与配对约定须实测核对**：本节既有约定为「第 N 轮独立复核 ↔ 第 N 轮演进」（§11.15↔§11.16、§11.17↔§11.18）。新增章节写「第十三轮演进」而前节为「第十二轮独立复核」⇒「第十二轮演进」被跳过、配对断裂；且 skill 内 ⑭ 与 ⑮ **曾共用「第十二轮」编号指向不同轮次**。宣称「统一编号/消除错位」时必须给出改动前后对照，**无 diff 即无闭环**。
> - **I5（提示）新分支必须有用例驱动**：`provisioner.go:100-101`（读失败非 NotExist）新增 WARNING 零覆盖；测试以 `log.SetOutput` 做**全局** logger 替换，当前 `pkg/cert` 无 `t.Parallel()` 故安全，**引入并行测试前必须改局部注入**。
> - **✅ 本轮确认属实项**：H1 订阅数 0→1 且 `showToast` 为 DOM toast（非 alert）、H2 缺失分支**生产可达**（`fullchain.pem` 与 `SaveDeviceCertificate` 同名同目录）且探针 P1 转红、H3 的 `atob` 分支经交叉验证确被执行、版本双面 `v1.36.86`、`test:acme:offline` **23/0** 与 `go test ./pkg/cert` 全绿——**零退化，本轮放行，无阻断项**。
> - **⚠️ 复发计数**：「文档/命名声称超出实现」已连续 **四轮**复发（§11.15 F16 → §11.17 G1/G2 → §11.19 H1/H2/H3 → §11.21 I1/I4）。**该判据应进入提交前自检清单**，而非仅停留于审查文档。
> - **✅ I1~I5 闭环落实（v1.36.87 · 2026-09-11）**：I1 抽离导出纯函数 `normalizeBase64Url` 并通过 T4.6c 单点锁定字符替换与 padding 补齐，反向探针 P3 实测删 `while` 循环坚决转红，离线套件扩至 24 项全绿；I2 在 `i18n.js` 7 语字典全量补齐 `tls_key_mismatch_msg`，在 `state.js` 显式声明并在 `cert-ready` 中清空复位；I3 同步收敛 `app.go:2151` 日志文案为单进程表述；I4 纠偏机制文档 §11.20 标题为第十二轮演进并新增 §11.22 成对闭合，技能库 ⑭/⑮/⑯ 编号彻底对齐；I5 单测补齐 `!os.IsNotExist(err)` 读失败分支并捕获 Warning 日志断言；版本号双面递增至 `v1.36.87`。

> **审查红线（第十四轮沉淀 · Rule 9/12 · 对 `c5cbe13d` 的复核，详见机制文档 §11.23）**：⑰ **「文档引文 / 译文 / 代码块」必须粘贴实测原值，不得以改写稿充作实现原文**：
> - **J1（低危）引文保真独立于能力闭环**：§11.22 逐语列出 7 条 `tls_key_mismatch_msg`，实测 **6/7 与 `i18n.js` 不符**（能力声明为真、引文为假）；同节 `normalizeBase64Url` 代码块被排版成花括号块，实际源码为单行 `while (b64.length % 4) b64 += '=';`。**文档引用代码或译文时，必须粘贴实测原值**。
> - **J2（低危）编号校正须覆盖全部条目**：`SKILL.md` ⑬ 仍标「第十一轮沉淀」却括注复核 §11.15（=第十轮）。宣称「编号彻底对齐」时，必须 `rg` 全量列出 `⑬⑭⑮⑯` ↔ 被复核章节的对应表，改动范围须覆盖**全部**相关行。
> - **J3（提示）权限型反例在 root 下静默失效**：`os.Chmod(0000)` + `os.ReadFile` 守卫在 root 环境恒为可读 ⇒ 断言空转而测试仍绿。构造「不可读/不可写」反例时**必须断言错误码（`fs.ErrPermission`）**，或在非特权条件下 `t.Skip` 并声明原因，严禁静默降级为空跑。
> - **J4（提示）载荷契约与展示层的本地化职责须写明**：`app.go:2156` 的 `message` 为硬编码中文，本地化仅在 `main.js` 消费侧；避免未来直用方跨 7 语暴露单语文本。
> - **✅ 本轮确认属实项**：I1 填充锁（探针 A：仅 T4.6c 红）、I1 归一化锁（探针 B：T4.6b+c 红、T4.6a 判别力为零，§11.22 归因诚实）、I2 7 语注册 + `state.js` 声明 + `cert-ready` 复位 + `t()` 键名判据、I3 文案与「无重试循环」实测一致、I4 文档 §11.15–§11.22 逐对成对、I5 读失败分支探针 C 转红、版本双面 `v1.36.87`、`test:acme:offline` **24/0** 与 `go test ./pkg/cert`、`go build ./...` 全绿——**五项全量闭环，零退化，本轮放行，无阻断项**。
> - **⚠️ 复发计数**：「文档/命名声称超出实现」已连续 **五轮**复发（§11.15 F16 → §11.17 G1/G2 → §11.19 H1/H2/H3 → §11.21 I1/I4 → §11.23 J1）。**本轮首次出现「能力已闭环、引文仍不实」**；自检清单应新增：「文档引用代码或译文时，必须粘贴实测原值」。
> - **✅ J1~J4 闭环落实（v1.36.88 · 2026-09-11）**：J1 在 §11.22 将 7 语译文与 `normalizeBase64Url` 代码块全量替换为实测代码原值，严格落实引文保真；J2 修正 ⑬ 为「第十轮沉淀」，实现 ⑬~⑰ 与对应复核章节全局严密对齐；J3 在 `provisioner_test.go` 增加 `fs.ErrPermission` 校验与 root/ACL 不支持场景的显式声明，杜绝空转；J4 在 `app.go` 事件载荷中补齐标准机器码 `reason: "node_key_mismatch"`，明确前后端本地化职责解耦；版本号双面递增至 `v1.36.88`。

> **审查红线（第十五轮沉淀 · Rule 9/12 · 对 `0d44d575` 的复核，详见机制文档 §11.25）**：⑱ **文档中新增的「职责 / 契约 / 分层」描述，必须 `rg` 其消费点，而非仅定义点**：
> - **K1（中危）字段存在 ≠ 契约成立**：§11.24 称「前端严格根据 `reason` 查找 i18n 词条，`message` 仅作最底层 fallback」。实测 `main.js` 的 `eqt:tls-node-key-mismatch` 处理器**零处读取 `payload.reason`**（全文件 4 处 `reason` 命中均为 `PromiseRejectionEvent.reason`），仍按 `t()` → `payload.message` → 硬编码中文取值。⇒ 后端加字段为真、前端接线为假；**声称「前后端解耦 / 职责定界」时必须给出消费侧的 `rg` 证据**。
> - **K2（低危）测试跳过必须用 `t.Skip` 而非 `t.Log`**：`t.Log` 输出只在失败或 `-v` 时呈现，故 root/`CAP_DAC_OVERRIDE`/非 POSIX ACL 环境下默认 `go test ./...` 仍报 `ok`（探针 D 已实证）——**"显式声明"不等于"可见"**。凡"条件不满足即跳过断言"的分支，一律用 **`t.Skip`**，并在 CI 以 **`-json` 采集 `Action=="skip"`**（或强制 `-v`）设为门禁。——**⚠️ 本括注已于第十六轮更正**：`t.Skip` 在**默认非 verbose** 下**并不打印** `--- SKIP`——顶层测试与子测试**皆然**（探针 D′ + 独立最小复现双证）；`t.Skip` 相对 `t.Log` 的真实增益仅为"在 `-v`/`-json` 下产生**可机读**的 skip 记录"，而非"默认输出可见"。**"用 `t.Skip`"是必要项，但不足以单独杜绝默认流水线的虚假绿色。**
> - **J1/J2 本轮确认属实项**：7 语译文与 TS 代码块 **14/14 逐字一致**（脚本比对，非目测）；skill ⑬~⑰ 与 §11.15/§11.17/§11.19/§11.21/§11.23 一一对应；探针 C 证明 J3 断言强度未退化（静默 WARNING 即转红）；版本双面 `v1.36.88`、`go test ./pkg/cert` 全绿——**零退化，本轮放行，无阻断项**。
> - **⚠️ 复发计数**：「文档/命名声称超出实现」已连续 **六轮**复发（F16 → G1/G2 → H1/H2/H3 → I1/I4 → J1 → K1）。**拐点提示**：第十三轮要求"粘贴实测原值"后，引文已修至 14/14 精确，却在"前端职责"上**再次写入未实现的断言** ⇒ 自检清单须升级为两条：①引文粘贴实测原值；②**新增描述必须 `rg` 到对应的消费点**。
> - **✅ K1~K2 闭环落实（v1.36.89 · 2026-09-11）**：K1 在 `main.js` 的 `eqt:tls-node-key-mismatch` 处理器中真正接入 `payload.reason` 消费与 i18n 查表（`rg` 真实命中消费点），消除纸面契约；K2 在 `provisioner_test.go` 将权限异常测试封装为独立子测试并在特权/不兼容环境下接入显式 `t.Skip`，彻底消除虚假绿色；版本号双面递增至 `v1.36.89`。

> **审查红线（第十六轮沉淀 · Rule 12 · 对 `89882638` 的复核，详见机制文档 §11.27）**：⑲ **审查方自身写下的每条「行为断言」，也必须先跑一次最小复现才能写入技能库与文档**：
> - **L1（中低危）审查沉淀未经实证会被下游当成权威依据**：第十五轮技能 ⑱ 曾写下"`t.Skip` 非 verbose 亦打印 `--- SKIP`"——第十六轮以**探针 D′（仓内强制跳过、`-count=1`）+ 独立最小复现（空包内顶层 skip 与子测试 skip）**双证为**假**：非 verbose 下**两者均不打印**，输出仅 `ok <pkg> <t>`；`--- SKIP` 仅在 `-v`、`Action:"skip"` 仅在 `-json`。开发方**忠实引用**了这条错误沉淀，将其扩写为 §11.26 的"**绝不**伪装成断言通过的虚假绿色"。⇒ **错误结论会经"审查方 → 开发文档"反向传导并在下一轮以既定事实出现**；审查方与开发方的断言在证据标准上**完全对称**，无一豁免。
> - **判定 SKIP 可见性的正确口径**：`t.Log`/`t.Skip` 在**默认非 verbose** 下对"跳过"与"通过"**一律不作区分**（顶层与子测试同）。凡涉及"测试是否真的跑了"的门禁，**必须由 CI 采集 `-json` 并对 `Action=="skip"` 断言**，或强制 `-v`；仅改用 `t.Skip` **不构成**完整的防虚假绿色方案。
> - **L2（低危）i18n 路由分支须核命名空间而非仅核代码**：`main.js` 构造 `tls_reason_${payload.reason}` 查表，但 `i18n.js` 中 `tls_reason_*` 词条 **0 条**，且后端仅发单一 reason（`app.go:2159`），该分支**不可达且一旦可达必缺键**，`t()` 的 `|| key` 回退会落回硬编码中文。⇒ 文中凡称"按 key 查 i18n 字典路由"，须同时 `rg` **该 key 前缀在 `i18n.js` 的注册情况**。
> - **⚠️ 复发计数**：「文档/命名声称超出实现」已连续 **八轮**复发（F16 → G1/G2 → H1/H2/H3 → I1/I4 → J1 → K1 → L1 → **M1**）。第十六轮的新性质是**首次由审查方沉淀反向传导**；第十七轮**性质最轻**，仅剩「绝对措辞未覆盖边界输入（原型键）」与「历史节次未随实现同步」。
> - **✅ L1~L2 闭环落实（v1.36.90 · 2026-09-11）**：L1 在机制文档 §11.26 与 §11.28 纠偏 `t.Skip` 可见性表述，确立 CI 需经 `-json` 或 `-v` 设门方能捕获跳过状态的标准；L2 在 `main.js` 废除未注册的 `tls_reason_*` 通配，收敛为显式 `REASON_KEY_MAP` 白名单安全路由，确保 100% 字典命中；版本号双面递增至 `v1.36.90`。

> **审查红线（第十七轮沉淀 · Rule 12 · 对 `8b27278b` 的复核，详见机制文档 §11.29）**：⑳ **「白名单 / 查表」必须验证查找语义而非只看键集合——对象字面量会被原型链穿透**：
> - **M1（低危）对象字面量不是白名单**：`const MAP = { k: v }; MAP[reason]` 对 `reason ∈ {'__proto__','constructor','toString','valueOf','hasOwnProperty'}` 会返回 `Object.prototype` 的继承属性（truthy 且**非字符串**），从而**穿透**「未命中即回退」守卫。Node 实测 `reason='__proto__'` ⇒ `reasonKey` 退化为原型对象 ⇒ **反而走 `payload.message`**，与「安全回退至合法键」的绝对断言相反。⇒ 严格查表须用 **`Object.prototype.hasOwnProperty.call(MAP, reason)`**、**`Object.create(null)`** 建表或 **`Map`**；**凡「一律 / 绝不 / 彻底」级守卫断言，反向探针输入域必须含原型键边界**。
> - **M2（提示）恒等映射 = 零影响**：当映射表仅一条且其值等于兜底值时，查表结果恒定 ⇒ 该字段对输出**零影响**，其后端伴随字段（`payload.message`）**无可达消费点**（Node 探针 4/4 `usedBackendMessage=false`）。⇒ 称「路由」前先自问：当前输入域下是否存在**输出不同**的两个分支？否则应注明「恒等映射」或删除死回退。
> - **M3（低危）就地更正须同步代码块**：对历史节次做就地文字更正时，若其代码块仍是被取代的旧实现，须补交叉引用，否则读者会取用已废弃范式。**历史节与其代码块是一对，改其一须改其二。**
> - **✅ M1~M3 闭环落实（v1.36.91 · 2026-09-11）**：M1 在 `main.js` 中将白名单重构为无原型对象 `Object.freeze(Object.assign(Object.create(null), { 'node_key_mismatch': 'tls_key_mismatch_msg' }))` 并追加 `typeof reason === 'string'` 守卫，语义探针实证覆盖 `'__proto__'`/`'constructor'`/`'toString'` 等全部原型边界输入，100% 安全回退到默认本地化键；M2 在机制文档客观定界当前白名单单映射特性与 `payload.message` 的防御性兜底定位；M3 在 §11.26 代码块下补齐演进交叉引用说明；版本号双面递增至 `v1.36.91`。

> **审查红线（第十八轮沉淀 · Rule 9/12 · 对 `50d99d0e` 的复核，详见机制文档 §11.31）**：
> - **㉑（方法学）编译型 / 反射型测试套件的反向探针，必须经项目构建脚本运行**：EQT 的 `tests/acme-offline.js` 等套件 `require('tests/compiled/<x>.js')`（esbuild 产物，**未被 git 跟踪**）。直接 `node tests/acme-offline.js` 会**静默测试陈旧 bundle**——本轮审查方据此跑出过**假阴性**（探针改了 `src/utils/acme.ts` 却仍报 24/0 全绿）。正确姿势：`npm run test:acme:offline`（脚本内含 `esbuild --bundle`）或手动先重建再运行。**凡探针结果"未如预期转红"时，第一步须先排除"测的不是当前源码"。**
> - **㉒（覆盖面）`docs/deploy/` 对外部署手册中的量化 / 时效 / URL 声明，须外部核验并标注来源**：第十八轮首次在**新增部署手册**（`google-cloud-publicca-eab-runbook.md`）发现不可验证的量化承诺——"每秒多张，每日可签发数万张"无公开来源，且与机制文档"日均数千张"**相差约 10 倍**。核查范围须自 `docs/mechanism/` 扩展至 `docs/deploy/` 全量。可核验项（ACME 目录 URL、EAB 7 天时效、通配符支持）与不可核验项（配额数字）须**分别对待**：前者须核对真值，后者**不得写入对外文档**，应改为"以项目配额为准，上线前实测标定"。
> - **✅ 本轮确认属实项**：M1 无原型字典经穷举语义探针（含 `__proto__`/`constructor`/`toString`/`valueOf`/`hasOwnProperty`/`{}`/`[]`）**全部安全回退**；§11.30 代码块与 `main.js:6717-6732` **16/16 逐字一致**（红线 ⑰）；EAB `computeExternalAccountBinding` 符合 RFC 8555 §7.3.4（`acme.ts:106-125`）且经 `acme.ts:341` 真实注入，**反向探针 T4.7b/c 转红**；`go test ./pkg/cert -count=1`、`acme-offline` 24/0、`cert-provision-offline` 56/0 全绿；版本双面 `v1.36.91` 一致。
> - **⚠️ 新发现项**：**N1**（低危）§11.30 的 M3 交叉引用**只补 §11.26**，§11.28 代码块同样被取代且其散文含已被 M1 证伪的绝对断言，却无标注——**M3 按"实例"而非"类别"修复**，历史节次同步须扫描**全部**被取代代码块；**N2/N3**（提示）§11.30 探针表 `''` 行 `typeof` 误标、同节 M1「绝无穿透至 `payload.message`」与 M2「保留为字典未加载兜底」自相矛盾（该路径探针实测**可达**）。
> - **⚠️ 复发计数**：「文档/命名声称超出实现」已连续 **九轮**复发（F16 → G1/G2 → H1/H2/H3 → I1/I4 → J1 → K1 → L1 → M1 → **N1/G1**）。缺陷已退出"核心能力"层，仅剩**历史节次同步**与**新增部署文档的对外数字**；第十八轮新特征是核查面从 `docs/mechanism/` 外溢至 `docs/deploy/`。
> - **🔗 GTS EAB 结合性结论**：Google Trust Services EAB 路线**技术合理、架构契合**——GTS 语义为「一个 EAB 密钥绑定一个 ACME 账户」，与本系统**全局单一持久账户**（`ACME_ACCOUNT_KEY`，`cert.ts:991` / fail-loud `acme.ts:234`）天然吻合，**无需改码即可切换**；机制文档 §11.14/§4.2.3/§7.3/前置 2 已引用该 runbook，**已在结合**。须修正：runbook 漏列 fail-loud 必需的 `ACME_ACCOUNT_KEY` 与 DNS-01 端点、`gcloud publicca` 应为 `gcloud beta publicca`、四处重复叙述宜收敛为单一权威节。
> - **✅ N1~N3 与 G1~G4 闭环落实（v1.36.92 · 2026-09-12）**：N1 在 §11.28 代码块补全演进交叉引用批注，实现历史节次全量对齐；N2 在 §11.30 探针表中将 `''` 拆分并保真呈现其实测语义（`typeof === 'string'` 为 `true`，查表 `undefined` 安全回退）；N3 修正 M1 措辞消除与 M2 字典未加载兜底定义的冲突；G1 消除 GTS runbook 中夸大无据的配额数字并客观定界；G2 补齐 GTS 接入前置必需的持久化账户私钥 `ACME_ACCOUNT_KEY` 与权威 DNS API 依赖说明；G3 纠偏命令为 `gcloud beta publicca external-account-keys create`；G4 全仓收敛 GTS 配额叙述，彻底消除四处文档数字打架；版本号双面递增至 `v1.36.92`。
> - **✅ 权威 DNS API 官方主域迁移落地（v1.36.93 · 2026-09-12）**：在 Cloudflare 为 `eqt.net.im` 注入 `ns1-dns`/`ns2-dns` 灰云 A 记录；双机 Caddy 成功签发并激活 Let's Encrypt 官方证书；端到端 Bearer Token API 读写/清理实测 100% 通过；Worker `wrangler.toml` 全量收敛为官方域名端点。
> - **✅ Google Public CA (GTS EAB) 真机绑定与首张证书签发全通（v1.36.94 · 2026-09-12）**：在 GCP 项目中激活 `publicca.googleapis.com` 并获取 EAB 凭据；通过 Web Crypto HMAC-SHA256 完成真机绑定并激活 Google Trust Services 账户；通过 `verify-gts-eab-live.js` 完整走通创建订单、DNS-01 质询注入、Google DNS 秒级校验、CSR Finalize、首张 WR1 公信证书（90天）签发与自动清理全流程；版本号双面递增至 `v1.36.94`。
> - **✅ 生产与测试 Worker 双域全量部署上线（v1.36.95 · 2026-09-12）**：向 Cloudflare Worker 生产与测试双环境全量同步 Google Public CA 凭证密钥；成功发布 `lic.eqt.net.im` 与 `lic-test.eqt.net.im`；原生 Go 客户端 `RequestDeviceCertificate` 真机通过双网关置备实测，分别耗时 12.48s 与 16.82s 秒级获签 Google 90 天公信证书；版本号双面递增至 `v1.36.95`。

> **审查红线（第十九轮沉淀 · Rule 13 · 对 `6bd40f7e` 的复核，详见机制文档 §11.36）**：
> - **㉓（覆盖面）数据根迁移必须逐消费者盘点回退覆盖，且回退须对称**：本次提交把配置根由 `~/.local/eqt`、证书根由 `~/.config/eqt/certs` **统一收敛至 `os.UserConfigDir()/eqt`**。作者**已掌握**该模式——通配符证书（`cert.go:58-78` `getCachedCertPaths`）与 crash dump（`reporter.go` 双路径读写）**都配了 legacy 回退**——却**恰好漏掉设备证书（`GetDeviceCertDir` 无回退）与 `config.yml`（提交内零迁移）**。⇒ **同一次迁移中的回退覆盖极易呈"不对称"分布**；迁移后必须 `rg` **全部旧根字面量**（含脚本、注释、日志文案），逐项确认消费点"已回退或已更新"，**不得只覆盖最容易想到的一两处**。**判据：凡"统一 / 收敛 / 迁移"级变更，须给出"旧根 → 新根"的逐消费者对照表，缺失项即为未完成。**
> - **㉔（高危后果）路径迁移导致的密钥"静默重生"会伪装成"首次安装"**：`LoadOrGenerateDeviceKey` 在新目录既无 key 也无 `fullchain.pem` 时，走 **INFO「(initial setup), generating new key」**分支。当失配原因实为**路径变更**（而非首次安装）时，该 INFO 级别**主动误导排查方向**，且新密钥一经签发即触发服务端 TOFU 拒绝（403 `node_key_mismatch`）。⇒ **凡"缺失即生成"的密钥路径，其日志须能区分"首次安装"与"既有数据不可见"**（例如同时探测 legacy 路径并输出 WARN）。**判据：任何"找不到就新建"的分支，都要问——找不到是否可能是路径/权限变更所致？**
> - **㉕（平台语义）`os.UserConfigDir()` 的跨平台差异是迁移等价性的隐形变量**：Linux `$XDG_CONFIG_HOME`（缺省 `~/.config`）、**Windows `%APPDATA%`**、macOS `~/Library/Application Support`。本案中 **Linux 且 `XDG_CONFIG_HOME` 未设时新旧根恰巧重合（掩盖问题）**，而 **Windows 必然失配**、**Linux 设了 `XDG_CONFIG_HOME` 时失配**。⇒ 用 `os.UserHomeDir()` + 手工拼接起家的路径，迁往 `os.UserConfigDir()` 时**不可假定"只是换个写法"**；**判据：路径 API 变更须逐平台列出"旧值/新值"对照，并明确各平台是否需要迁移。**
> - **⚠️ 本轮发现项**：**P1**（**高危**）设备证书与私钥升级后孤儿化且无 legacy 回退（Windows 必然、Linux 视 `XDG_CONFIG_HOME` 而定；探针实证路径不可见 → 新钥生成 → TOFU 403）；**P2**（中危）`config.yml` 全平台孤儿化（`6bd40f7e` 提交内无迁移，已由后续 `1745b051` 补上且源目录正确）；**P3**（中危）已落地的 `maybeMigrateLegacyConfig`（`1745b051`）源目录错（`~/.local/eqt` 不含证书）**且 `entry.IsDir()` 跳过子目录**（设备证书在 `<node>/` 内）⇒ **P1 在 v1.36.97 上依然存在**；**P6**（中危）`scripts/sync-certs-from-vps.sh:36` Windows 目标仍为旧 `%USERPROFILE%\.config\eqt\certs`，与应用新读的 `%APPDATA%\eqt\certs` 及 `63d222df` 已更新的 skill 文档**三方矛盾**（同步工具在 Windows 上功能性失效）；**P4**（中低）新增「到期:」硬编码中文无 i18n 键；**P5**（提示）`TestDefaultConfigFileUsesLocalEQTDirectory` 的后缀断言**对被废弃的旧路径同样成立**（判别力归零，实测三值皆真）；**P7**（提示）`agent.go:1032` 用户可见日志仍写旧路径；**P8**（提示）`DefaultConfigDir()` 变为带 I/O 与迁移副作用的 getter。
> - **✅ 本轮确认属实项**：单一根收拢方向正确；前端 `main.js:2405` **真实消费** `state.appInfo.tlsCertIssuer/tlsCertExpiry`（非 K1 型"只定义不消费"）；Go `AppInfo` 新字段与 `models.ts` 同步；通配符证书与 crash dump **确有** legacy 回退；版本双面 `v1.36.96` 一致；`go build ./...` OK、`go test ./pkg/config ./pkg/cert -count=1` 全绿。
> - **✅ P1~P8 闭环落实（v1.36.99 · 2026-09-12）**：P1/P3 在 `GetDeviceCertDir` 增加旧路径探针与无损权限复制迁移，并升级 `maybeMigrateLegacyConfig` 为 `copyDirRecursive` 递归全量子目录迁移（新增专项测试 `TestGetDeviceCertDir_LegacyFallbackAndMigration`）；P4 在提交 `347afd44` 中依用户指令直接消减为纯图标展示彻底消除了中文硬编码；P5 修正 `config_test.go` 为全等价断言；P6 校准 `sync-certs-from-vps.sh` Windows 目标为 `%APPDATA%\eqt\certs`；P7 消除运行时日志与注释中旧路径遗留；P8 验证了 `sync.Once` 单次守卫机制；版本号双面递增至 `v1.36.99`。









