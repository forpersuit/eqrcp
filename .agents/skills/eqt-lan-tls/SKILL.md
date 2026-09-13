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

> **审查红线（第二十轮沉淀 · Rule 13 · 对 `426677a8` 及其前置 `347afd44` 的复核，详见机制文档 §11.38）**：
> - **㉖（失败面）"迁移/复制成功"日志必须由结果驱动，不得由"进入分支"驱动**：`provisioner.go:88-110` 的 legacy 迁移中，`MkdirAll` 失败仍 `return targetDir, nil`、`ReadFile` 失败静默跳过、`WriteFile` 错误被 `_ =` 吞没，但只要 `ReadDir` 成功就无条件打印 `[INFO] Successfully migrated`。**探针实证**：legacy 私钥 `chmod 0000` ⇒ 日志报"成功"、目标无密钥、`LoadOrGenerateDeviceKey` 静默生成新钥（回归服务端 403 `node_key_mismatch`）。⇒ **迁移后必须校验目标产物存在且可解析再返回**；任何 I/O 错误须上抛或降级 `[WARNING]` 并带源/目标路径。**判据：凡有"成功"日志的分支，必须能指出它依赖的校验点；指不出即为谎报。**
> - **㉗（测试）断言不得与被测函数共享同一构造表达式**：`config_test.go:164-170` 的期望值 `filepath.Join(DefaultConfigDir(),"config.yml")` 与 `DefaultConfigFile()`（`config.go:279-281`）**同源** ⇒ 恒真。**探针实证**：`EQT_CONFIG_DIR` 未设与设为 `/tmp/retired-probe` 两种互斥路径下**都通过**，判别力归零——第十九轮 P5 想防的"路径漂移"恰好不再可测。⇒ **修复弱断言时必须证明"修复后的断言能对原缺陷转红"**；修复 ≠ 改进（第八轮 `8d8bce11` 治理过的同类缺陷复发）。**判据：期望值的来源若只有被测函数本身，即无效测试。**
> - **㉘（一致性）同一份数据若存在两条迁移/复制实现，必须共享同一套权限、覆盖与错误语义**：`copyDirRecursive`（`config.go:188`）用 `MkdirAll(dst,0755)`，而 `GetDeviceCertDir`（`provisioner.go:90`）对同一目标用 `0700`。**探针实证**：私钥容器目录迁移后由 `0700` 降级为 `0755`（密钥文件仍 `0600`）。⇒ **私钥容器目录不得低于源目录权限**，且 certs 分支须像 config 分支一样带"目标已存在"前置判据（否则每进程全量递归 walk）。**判据：`rg` 到同名迁移逻辑出现两次，即为缺陷。**
> - **㉙（管道回收）删除消费点时必须同步回收其数据管道**：`347afd44` 移除了前端对 `tlsCertIssuer`/`tlsCertExpiry` 的消费，但 Go 字段（`app.go:173-174`）、Wails 绑定（`models.ts:177-178,199-200`）与机制文档 §11.36 的"✅ 真实消费"断言全部残留 ⇒ 上一轮的确认项在本轮静默失真（`TLSCertIssuer` 成双侧死字段、`TLSCertExpiry` 只写不读）。**判据：删除一个 UI 消费点时，须 `rg` 该字段并逐项决定"删除 / 保留并恢复消费"；只写不读的字段一律删除。**
> - **⚠️ 本轮发现项**：**Q1**（**高危**）legacy 迁移失败静默 + 谎报成功 → 新密钥静默重生（P1 的失败面未闭环，"彻底杜绝 TOFU 403"超出实现）；**Q2**（中危）迁移目录权限 `0700→0755` 降级 + 两条迁移实现语义冲突；**Q3**（中危）`TestDefaultConfigFileUsesLocalEQTDirectory` 由弱断言修成**恒真断言**（判别力归零，P5 反向回归）；**Q4**（中危）文档"✅ `main.js:2405` 真实消费"在 `347afd44` 后失效，`TLSCertIssuer` 成双侧死字段、`TLSCertExpiry` 只写不读，且与 §11.37 的 P4 闭环叙述自相矛盾；**Q5**（低）`tls_cert_ready`/`tls_cert_preparing` 仅 zh/en 定义（5 语种落英文回退），`main.js:2405,2408` 的 `|| '…'` 中文兜底为**不可达死代码**——"已消除未本地化文本"结论对、理由错；**Q6**（低 · 建议）key mismatch 的动作指引由文本降级为 **hover-only emoji**（无 `aria-label`，触屏不可见），建议补一次性应用内通知；**Q7**（低）`GetDeviceCertDir` 沦为带 I/O 副作用的 getter 且被只读查询调用（P8 反模式由 config 层扩散至 cert 层）；**Q8**（提示）`EQT_CONFIG_DIR` 早退静默关闭迁移，该语义未在文档声明。
> - **✅ 本轮确认属实项**：P2/P3 闭环（源目录 `~/.local/eqt` 正确、`copyDirRecursive` 已覆盖 `<node>/` 子目录，探针实证 `node20` 落盘）；P6 闭环（`sync-certs-from-vps.sh` 两处 Windows 目标均为 `AppData/Roaming/eqt/certs`，与 `os.UserConfigDir()` 一致）；P7 闭环（`rg '\.config/eqt'` 在 `desktop/gui`、`pkg/cert` 零残留，日志改走 `config.DefaultCertsDir()`）；旧根探针选值正确（`os.UserHomeDir()+".config/eqt/certs/<node>"` ≡ Windows 旧值）；目标已含密钥时不覆盖；版本双面 `v1.36.99` 一致；`go build ./...` 与 `go test ./pkg/config ./pkg/cert -count=1` 全绿；图标资产双侧 `md5` 完全相同；部署侧（`3a8c4ea7`/`f68f9963`）未触及客户端落盘路径与信任链。
> - **📈 复发计数**：「文档/命名声称超出实现」连续 **十轮**复发，且**新特征是偏差出现在上一轮自己写下的闭环结论上** ⇒ 闭环声明须下沉到"可失败的最小事实"（如"迁移失败时返回错误"），而非"彻底杜绝 XX 冲突"。
> - **🧹 测试卫生**：本轮再次证明"修复可能引入新缺陷"——弱断言→恒真断言（Q3）、路径修复→失败面静默（Q1）。修复提交须与原始意见**逐条对照**，并验证修复后的断言能对原缺陷**转红**。
> - **✅ Q1~Q8 闭环落实（v1.36.100 · 2026-09-12）**：Q1 抽取独立 `MigrateLegacyDeviceCredentials` 并在末尾执行强结果校验（目标私钥存在且大小非空），在 `LoadOrGenerateDeviceKey` 中增加 `legacyKeyExists` 判据，旧私钥存在但迁移失败时坚决拒绝生成新私钥并抛出错误（单元测试 `TestMigrateLegacyDeviceCredentials_FailureHandling` 实证覆盖权限为 `0000` 时的拒签行为）；Q2 将 `copyDirRecursive` 创建目录权限收拢为 `0700` 并为 certs 分支补充 `hasEntries` 目标非空前置跳过判据；Q3 重构 `TestDefaultConfigFileUsesLocalEQTDirectory`，期望值改由原生系统 API（`os.UserConfigDir()`/`os.UserHomeDir()`）独立拼装，并补充反向否定断言坚决拒收 legacy 路径，修复 `TestNew` 环境变量清理泄漏；Q4 从 `app.go`、`AppInfo()` 与 `models.ts` 中彻底清理死字段 `TLSCertIssuer` 与只写不读字段 `TLSCertExpiry`；Q5 移除 `main.js` 中不可达死字面量，并在 `i18n.js` 中为 ja/ko/es/de/fr 补齐缺失的 3 个证书状态词条；Q6 为状态徽标容器补充 `role="img"` 与 `aria-label` 增强无障碍支持，维持应用内无侵扰静默降级；Q7 将 `GetDeviceCertDir` 纯化为纯路径计算函数，将迁移副作用解耦为独立方法；Q8 正式声明：设置 `EQT_CONFIG_DIR` 环境变量将绕过全局 legacy 迁移逻辑以保证测试与自定义目录隔离；版本号双面递增至 `v1.36.100`。
> - **✅ 置备超时放宽与 Dev 模式调试闭环（v1.36.101 · 2026-09-12）**：彻底修复 `desktop/gui/app.go` 中复用全局 5 秒短超时 HTTP 客户端扼死 10~15 秒 ACME DNS-01 过程的问题，为置备流程配置专用的 45 秒超时客户端（与 context 匹配）；在 Go 端导出 `DevProvisionDeviceTLSCert()` 并于前端 Developer Options 增加「LAN-TLS 证书调试」模块，支持一键手动申请/刷新公信证书并在无需重启的情况下实时更新状态图标为 🔒；新增 `TestDevProvisionDeviceTLSCert_ToleratesServerLatencyAboveFiveSeconds` 验证 5.5s 延迟容忍性，版本双面递增至 `v1.36.101`。
> - **✅ 开关动态自洽、状态图标规范与无缝置备闭环（v1.36.102 · 2026-09-12）**：彻底规范化 TLS 开关与状态图标的心理模型：开关关闭（Off）时展示 `🔓`（灰色开锁未加密，带专属 tooltip），开关开启（On）时根据证书物理就绪情况动态展示 `🔒`（已就绪）/ `⏳`（置备中）/ `⚠️`（私钥失配）；彻底解决点击开关后的 DOM 状态不同步问题：监听 switch `change` 事件即时更新 `state.settings.enableTLS` 并触发重新渲染；若拨到 On 且本地缺少有效证书，界面立即呈现 `⏳` 并自动在后台调用 `DevProvisionDeviceTLSCert()` 发起申请，就绪后无缝切换为 `🔒` 并发送系统通知；清理生产 D1 数据库中因前置测试耗尽的 24h 频控锁定；补齐 7 语种国际化词条，版本双面递增至 `v1.36.102`。

> **审查红线（第二十一轮沉淀 · Rule 13 · 对 `docs/bugs/2026-09-12-lan-tls-key-mismatch-and-device-identity-architecture-analysis.md` 的复核与闭环）**：
> - **㉚（授权边界）公开的低熵标识符不得成为签发或换绑的授权**：`node_id` **不是秘密**——它印在每一张传输二维码里，并作为域名出现在每一条 LAN-TLS URL 中（`192-168-1-5.9be192a9efff.direct.eqt.net.im`），同 Wi-Fi 上观察到一次请求即可获得；12 位十六进制 = 48 bit。⇒ 任何「公钥不一致即自动换绑」的提案，实质是把**公开值升级为证书签发授权**：知道受害者 `node_id` 的人即可为受害者域名取得公信证书，并把受害者的绑定改写成自己的（受害者随后永久 403，因为其真钥已不再是绑定值）。**频控不能替代绑定**：全局熔断仅 `40/7 天`（`cert.ts:738-750`，键 `cert_provision:global_acme`，**不按 node/IP 分摊**），而**首绑路径对全新 `node_id` 天然不做任何校验**，故 10 个新 `node_id` 即可耗尽全机队周额度的 1/4 ⇒ 全体合法用户降级明文 HTTP。**判据：凡"自动放行 / 自动改写绑定"类提案，先问——触发它所需的信息是否公开？公开即拒绝，改为认证式换绑（要求携带原私钥签名，或有效 `.lic`，或基于硬件 `device_registry` 严格鉴权的 `X-EQT-Device-ID` 并在云端限制 30 天单机换绑冷却期，详见分析文档第 8 章）。**
> - **㉛（确定性）标识符生成不得对"全空输入"静默回退到常量或跨域依赖值**：`GetDeviceNodeID()`（`hardware.go:499-513`）在指纹全空时回退到 `GetAuthorityDeviceID()[:12]`（**跨域依赖云端状态**），其触发源是 `hardware.go:272-274` 的 **300ms 预计算超时** ⇒ Windows 冷启动 WMI 稍慢即让 `node_id` 在"硬件哈希"与"云端前缀"之间**抖动**，纯由时序抖动触发 TOFU 403；无 `authID` 时同一分支坍缩为 `sha256("::")[:12]` = **`71546855d627`**（实测），**与机器无关的常量** ⇒ 任意两台读不到指纹的机器共用同一 `node_id`，第二台必然 403。⇒ **空值必须 fail loud**（与 CLAUDE.md「设备指纹空值防呆：空值一律判定跳过」一致），**且碰撞空间论证（$16^{12}$）必须覆盖回退分支**——坍缩后空间不是 $16^{12}$ 而是 1。**判据：凡"全空/未知输入"分支，问它回退到什么；答案是常量或他域标识符即为缺陷。**
> - **㉜（凭据生命周期）"失效/作废"级措辞必须先 `rg` 到吊销或删除路径**：文中称私钥失窃后"旧证书和旧私钥在云端与本地**即刻失效**"——实测全仓**无证书吊销能力**（`revoke` 的全部命中都在**许可证**域 `portal.ts` / `drm.ts`），`node_public_keys` 仅有 `SELECT`（`cert.ts:866`）/ `UPDATE last_seen_at`（`883`）/ `INSERT`（`891`），**无 `UPDATE public_key_sha256`、无 `DELETE`**，且已落盘的 `fullchain.pem`+`privkey.pem` 位于**客户端本地**，云端无通道可使其失效。⇒ 准确语义只能是「**不再续期 + 旧公钥不再被承认**」，90 天有效期内旧证书在浏览器侧**依然有效**。**判据：凡写"失效 / 作废 / 吊销"，须给出执行该动作的语句或端点；给不出即降级为"不再续期"。**
> - **⚠️ 本轮发现项**：**R1**（**高危**）文档 §5.2/§5.3 的"自愈式密钥轮换"是一次安全回退，**拒绝执行**（按 ㉚；且 §5.3 的 `UPDATE node_public_keys SET public_key_sha256 = ?` 是**全新能力**而非"改造第 869 行"，该措辞会误导为可改的既有状态）；**R2**（中高危）§4.1 因果链唯一化到"用户清空目录"不成立——另有两条**无需用户操作**的 403 生成路径（云端回退抖动、常量坍缩，见 ㉛）；**R3**（中危）§6.2.3「生成 CSR 时必须将 `node_id` 写入 Common Name 与 SAN」与实现不符：`provisioner.go:277-288` 写入的是**域名**（`<node>.direct.eqt.net.im` + 通配符），非裸 `node_id`（照此实现会与 `provisioner.go:428-431` 的 SAN/CN 校验失配）；**R4**（中危）§3.2 场景 3「即刻失效」不成立（见 ㉜）；**R5**（低）§2.1「外网依赖 **0%**（100% 纯本地离线计算）」被 `hardware.go:501-508` 直接证伪；§6.1 示例 URL 端口 `:9090` 全仓无此默认（`cmd/qrcp.go:40` `--port` 默认 `0` = 随机端口，`cmd/send.go:76` 的 `8080` 仅帮助文本）；**R6**（提示）同源代码 `pkg/cert/provisioner.go:67-68` 有**重复注释行**（首行句子未完），系 Q1 修复时遗留。
> - **✅ 本轮确认属实项**：单 `node_id` 3/24h（`cert.ts:703-705`）、单 IP 10/24h（`725-727`）、全局熔断存在（`738-750`，值 40/7 天）、403 硬拦截且**确无轮换路径**（`869-878`）、"系统中无任何一处提供重置密钥绑定"属实（`node_public_keys` 仅三条语句）、About 面板离线显示 `------`（`main.js:2833`）、离线 `GetAuthorityDeviceID()` 返回 `""`、本地凭据路径 `.../eqt/certs/<node_id>/`（`provisioner.go:69-76`）、TLS 1.2/1.3 + ECDHE 前向保密结论（`server.go:2515` `MinVersion: tls.VersionTLS12` 且未显式设 `CipherSuites` ⇒ 依赖 Go 默认套件，TLS 1.2 默认全 ECDHE / TLS 1.3 强制 ECDHE，故 PFS 成立）。
> - **📈 复发计数**：「文档/命名声称超出实现」连续 **十一轮**复发。**本轮性质再次变化**：偏差从"闭环结论"（第二十轮）移至**架构演进建议**——即文档的**方案部分本身**存在实质性安全回退与与实现不符的字段描述。⇒ 审查此类"专题分析/演进建议"类文档时，**除核验其事实陈述外，必须独立评估其建议是否削弱既有安全属性**：本案的 `node_id` 公开性 + TOFU 绑定是前若干轮刻意构建的防线，而 §5 的提案会将其拆除，且其立论（"频控才是根本防线"）与代码常量（全局 40/周）直接冲突。**判据：凡文档提出"不再阻断 / 自动放行 / 自动改写"的建议，先列出"该阻断当前在防什么"，再判断频控是否等价。**
> - **🧹 复核方法**：本轮全部结论均由 `rg` 存在性核验 + 反向探针（`sha256("::")[:12]` 实算、`eqt.exe` 文件锁探测、`chmod 0000` 迁移失败面）支撑，探针用完即删；文档声称的基准版本 `v1.36.103` 与 `pkg/version/version.go:12` 实测一致。

> **审查红线（第二十二轮沉淀 · Rule 13 · 对同文档新增第 8 章「硬件权威设备身份认证式换绑 (Hardware-Attested Rebinding)」架构的复核，详见该文档 §9）**：
> - **㉝（论证前提）方案中被当作"秘密"或"权威依据"的那个值，其生成点与保密性必须在代码中确证，不得由方案自述**：第 8 章的安全论证全部建立在「`device_id` 是"由非公开物理指纹经私有哈希加密生成的 32 字符权威标识"、且局域网攻击者"无法获知"」之上。实测**两个前提都未成立**——① `device_id` 是**云端随机铸造**的 opaque 值（`cloudflare/eqt-drm-api/src/utils/device-registry.ts:143-144` `// No match found -> Assign pure random device_id` + `generateRandomDeviceId()`），与硬件的唯一关联是**匹配**而非派生（同文件 `:41` `countMatchingFingerprints(...) >= 2`，2-of-3 非空指纹）；客户端侧自述为 `// returns the **server-assigned** authoritative device_id`（`hardware.go:362-363`），且本文档 §2.1 自己写的是"**云端权威分配**"——**三处互相矛盾**；② 它**不是机密值**，About 面板**明文渲染**（`main.js:2833`），`license.go:753` / `chat_limiter.go:549-583` 的载荷亦携带。⇒ **凡"凭 X 秘密/权威"论证安全的段落，先 `rg` X 的生成点与全部展示/日志点**；结论可能仍成立（此处确实不可猜），但**论证依据必须改写**，否则实现方会去实现一个不存在的派生逻辑。**同时：以某值的保密性为安全前提时，须显式写入该"机密值"不变量**（禁止 LAN 面回显、禁止明文落日志；展示层可用现成的 `shortDeviceID`，`server.go:1759`）。
> - **㉞（覆盖全分支）"彻底切断 / 彻底消除"级承诺必须对照方案自身的流程图/伪码逐分支核验**：第 8 章称"单设备换绑设置 30 天冷却窗口，**彻底切断**了攻击者耗尽全局 40 次 ACME 额度的攻击路径"，但其 mermaid 中 `alt 未曾绑定 (首绑路径)` 分支**只有一句 `INSERT`、无任何 `device_id` 或指纹校验**（冷却只写在 `else 已绑定但公钥不一致` 分支内）。而"新号"可无限免费获取：`device-registry.ts:143-144` 对任何指纹不匹配者一律铸造新 `device_id`，且注册频控的桶键**包含提交内容本身**（`rate-limit.ts:145-164` `buildDevRegKey(ip, uuidHash, cpuHash, diskHash)`，变造哈希即换新桶；`devRegBuckets` 还是**进程内 Map**，多 isolate 不共享）。⇒ 变造三个哈希即可无限取号 ⇒ 无限 `(node_id, device_id)` 对 ⇒ 每个新 `node_id` 一次首绑 + 一次 ACME 签发 ⇒ 全局 `40/7 天` 配额仍可耗尽。**判据：把方案的每个 `alt`/分支逐条列出并标注"该分支是否受此承诺约束"；未覆盖即降级措辞。**
> - **㉟（回归）复用既有机制时不得另起新名；确需改名须同步客户端并留双头兼容期**：第 8 章提出新增请求头 `X-EQT-Device-ID`，而该机制**已经存在**且通路已完成三分之二——客户端早已发送（头名为 **`n`**，`pkg/cert/provisioner.go` `httpReq.Header.Set("n", opts.DeviceID)`）、Worker 早已读取（`cert.ts` `request.headers.get('n')` → `deviceIdHeader`）、早已落库（`cert.ts:891-897` `INSERT INTO node_public_keys (..., device_id, ...)` bind `deviceIdHeader || null`）、表结构早已存在（`schema.sql:277`）。**唯一缺失**是 `cert.ts` 全文对 `device_id` **只写不比较**（全部命中均为定义/日志/INSERT，**零处等值比较**）。⇒ 实施规格应写成"在 `cert.ts:869-878` 的 mismatch 分支内新增一次 `SELECT device_id` 与 `deviceIdHeader` 的比对 + 条件 `UPDATE`"，并**沿用头名 `n`**；若强推新头名，**存量客户端（只发 `n`）会被全部判为"未带 Device-ID"而 403——这是一次对存量用户的回归**。**判据：提案中出现的新字段/新头/新表名，先 `rg` 是否已存在同义物。**
> - **⚠️ 本轮发现项**：**S1**（**高**）§8.1.3 的 `device_id` 来源表述与实现、与同文档 §2.1 三方矛盾（见 ㉝）；**S2**（中高）提案头已存在（见 ㉟）；**S3**（**高**）"彻底切断配额耗尽"未覆盖首绑分支（见 ㉞）；**S4**（中）以 `device_id` 保密性为前提却未确立该不变量，而代码已明文展示；**S5**（中）"换绑后仍自愈"漏掉 `device_id` 自身会变化的场景——**更换系统盘致 `disk_hash` 改变**，叠加 `cpu_hash` 实测常态为空（构建日志反复出现 `Retrieve CPU Serial ... (empty: true)`），则指纹匹配不足 2 项 ⇒ `device-registry.ts:143` 铸造全新 `device_id` ⇒ 合法用户被判为攻击者，**重造与 §8 声称要消灭的同型死锁**（建议换绑时接受"指纹 2-of-3 匹配"作为 `device_id` 等值之外的替代证据）；**S6**（低）§8.3 把 7.2.4 复述为"旧公钥云端**解绑**"——`node_public_keys` 无 `UPDATE public_key_sha256`、无 `DELETE`，"解绑"仍是不存在的动作，作为实施规格会重新种下该误解。
> - **✅ 本轮确认属实项**：`schema.sql:277`（`device_id TEXT DEFAULT NULL`）与 `cert.ts:896`（INSERT bind `deviceIdHeader || null`）两处**引用准确**；`provisioner.go:67-68` 重复注释**确已删除**（§8.3 "✅ 代码已修复"属实）；§5 已加"方案作废与纠偏声明"并指向第 8 章；§4.1 已补路径 2/3 且标注 `legacyKeyExists` 守卫；§6.2.3 已校准为完整 FQDN；§6.1 已改为 `<random-port>`；§3.2 场景 3 已按 90 天窗口校准 —— **7.2.3 / 7.2.4 / 7.3 / 7.5 各项确已落实**。
> - **📈 复发计数**：「文档声明与实现不符」连续 **十二轮**复发。**本轮性质第三次位移**：第 8 章已**不再虚报落地状态**（7.2.1/7.2.2 明确标注"理论架构已确立，待后续排期实施"），诚实度显著高于此前各轮；问题转移到**技术论证的事实前提**（S1）与**绝对措辞超出方案覆盖面**（S3）。⇒ 审查"架构决议"章节时固定追加两问：① **方案里被当作"秘密/权威"的那个值，其来源与保密性是否已在代码中确立？** ② **声称"彻底"消除的风险，其流程图/伪码是否覆盖了全部分支？**
> - **㊱（终局闭环）换绑鉴权须采纳多维容错证据链与首绑前置门禁（详见分析文档第 10 章）**：
>   ① **多维容错换绑**：换绑判据不可单一依赖 `device_id` 等值比较（防范 CPU 指纹空 + 换系统盘导致云端重铸 `device_id` 诱发二次死锁），应采纳阶梯式多维证据链：`req.n === bound.device_id` OR 主板 `uuid_hash` 历史拓扑匹配 OR 携带有效 `.lic` 授权证明；
>   ② **首绑前置门禁与 D1 频控**：首绑路径（`INSERT`）必须前置校验 `device_id` 在 `device_registry` 中的真实存在性，并将注册频控下沉至 D1/KV 分布式持久化，防范伪造哈希无限刷号击穿全局 ACME 40次/7天配额；
>   ③ **协议与展示治理**：⚠️ **原文有误，已按第三轮复核更正（见下方 ㊲）** —— 头名**不是** `n`，而是 **`X-EQT-Device-ID`**（`pkg/cert/provisioner.go:741` 自提交 `4dbf7a56` 起即如此，全仓无 `n` 头）；`shortDeviceID` 为 **`pkg/server` 未导出**函数，跨包/前端/Worker(TS) 均无法调用，须先导出或另立等价实现。**"保持既有头名不动"这一原则仍成立**——因为代码本来就用的是 `X-EQT-Device-ID`，故协议头**零改动**；前端 About 面板脱敏须注意同一处的 `data-copy-text`（`main.js:2820`）仍携带全量值。

> **审查红线（第二十三轮沉淀 · Rule 13 · 对同文档新增第 10 章「终局工程实施决议」的复核，详见该文档 §11）**：
> - **㊲（自我更正 · 标识符必须取证）审查方给出的任何标识符、行号、符号名，都必须有可复现的 `rg`/`sed` 记录，严禁凭记忆书写**：本轮第二轮复核（该文档 §9.3 / 红线 ㉟）**判错**了请求头名——写成"头名为 `n`、`httpReq.Header.Set("n", ...)`"，实测头名自始即为 **`X-EQT-Device-ID`**（`provisioner.go:741`；`git log -L 735,745` 证明自最初提交 `4dbf7a56` 起未改；`rg -n 'Header.Set\("n"'` 全仓**零命中**）。该错误被开发方**忠实吸收**进 §8.3 与 §10.2，并升级为**实施规格**（"锁定既有请求头 `n`"、"客户端已在 `provisioner.go:375` 发送"——行号亦错，实为 `:740-741`）。⇒ **若照该规格实现，`cert.ts` 会去读一个客户端从不发送的头 ⇒ 比对恒不成立 ⇒ 换绑 100% 被拒——正是该规格本想避免的存量回归，只是方向反转**。**判据：结论可以推理，标识符不能推测；每条标识符断言须独立附上取证命令与观测。**（这是第十六轮 L1「审查方断言被下游忠实引用」的**第二次发作**，且代价更高。）
> - **㊳（规格的输入必须存在）实施规格中出现的每个输入/字段/表列，必须逐项确认当前代码已具备，未具备的须显式标为"待新增"**：第 10 章的多维容错换绑「维度 2」判定式为 `req.uuid_hash` 等于绑定设备的历史 `uuid_hash`，实测**两个前提均不存在**——`rg -n 'uuid_hash|uuidHash|cpuHash|diskHash' cert.ts` **零命中**（provision 请求不携带任何指纹），`schema.sql:274-280` 的 `node_public_keys` 亦无 `uuid_hash` 列。**开发方却在对齐表中标为「✅ 机制已设计」**。⇒ 凡规格点名的输入，`rg` 一遍；缺失即把状态降级为"设计草案，依赖 N 处新增"，与诚实的"待后续排期实施"保持同一口径。
> - **㊴（拒绝分支的边界用户）新增的"拒绝/门禁"分支必须穷举合法但边界的用户是否会被永久挡住**：第 10 章首绑门禁要求"校验 `device_id` 存在于 `device_registry`"，但**免费档在三项指纹全空时注册端返回空 `device_id` 且不入库**（`device-registry.ts:63-69` `if (tier === 'free') return { device_id: '', skipped: true }`），而"三项全空"恰是该文档 §4.1/§8.2 反复论证的**真实运行态**（Windows `cpu_hash` 常态为空 + `hardware.go:268-280` 的 300ms 超时直接返回 `"","",""`）；且 `provisioner.go:740` 的 `if opts.DeviceID != ""` 守卫使空值**根本不上行**。⇒ 门禁会先把这些**合法免费用户**永久挡在证书之外——为治攻击者而回归了 §8.2 承诺保护的对象。**判据：把新拒绝分支的判定式代入每个"合法但边界"的取值（尤其空值/缺省值），逐一问"这个用户还能不能拿到服务"。**
> - **㊵（冷却期的必要性与作用域）限流/冷却窗口必须论证其对每条通过路径的增益，不得无差别施加于所有分支**：第 10 章流程图把 `CheckCooling` 置于**维度 1（`device_id` 相同、仅私钥重签）之前**，30 天内二次重装/清目录即得 429——而维度 1 恰恰是本文档要治的原始病症。**冷却对维度 1 无任何安全增益**：局域网旁观者无从得知 `device_id`、根本过不了维度 1；维度 1 的签发频次已被既有的**按节点 3 次/24 小时**限额覆盖。⇒ 冷却应只约束"`device_id` 发生变更"的维度 2/3，使"自愈"与"防刷"彻底解耦。**判据：每个限流措施都要回答"它拦住了哪条滥用路径"，答不出增益的分支即移除该措施。**
> - **⚠️ 本轮发现项**：**T1**（**高**，见 ㊲，含审查方自身更正）；**T2**（**高**，见 ㊴）；**T3**（中高，见 ㊳，§10.5 状态标注过高）；**T4**（中高，见 ㊵）；**T5**（中）§10.1.2 脱敏规格不可实施——`shortDeviceID` 未导出（全仓 3 处命中皆在 `pkg/server` 内），且"仅遮蔽 visible span"不成立（`main.js:2819-2820` 的一键复制 `data-copy-text` 仍携带 32 位全量值），另有一处规格未列举的第三泄漏通道 `desktop/gui/app.go:2158` `DeviceID: server.GetAuthorityDeviceID()`（崩溃/诊断转储）；**T6**（低）§8.3 的"旧公钥被新公钥覆盖并失效"在基线仍无对应动作（`UPDATE node_public_keys SET public_key_sha256` 与 `DELETE FROM node_public_keys` **均零命中**；`cert.ts` 对 `node_public_keys` 仅 `SELECT:866` / `UPDATE ... last_seen_at:883` / `INSERT:891`），应加"（计划新增 `UPDATE` 后）"限定。
> - **✅ 本轮确认属实项**：§8.1.3 的 `device_id` 纠偏（"云端随机分配 + 2-of-3 指纹锚定"）**属实**，S1 已闭环；§8.2 已撤回"彻底切断全局配额耗尽"、改述为"限制了单机换绑重签频次"并指向盲区，S3 措辞项闭环；§8.3 的 S6 措辞已改；About 面板确为 **32 位全量** `device_id`（`desktop/gui/agent.go:108` `GetDeviceStableID()` → `hardware.go:392-393` → `GetAuthorityDeviceID()`），S4 场景成立；`device_id` 本地存储权限**属实**（`hardware.go:345-346` `MkdirAll(...,0700)` + `WriteFile(...,0600)`）；**LAN 面当前不暴露 `device_id`**（`rg -n 'device_id|DeviceID' pkg/chat/v2/ --glob '*.go'` 零命中），故 §10.1.2 的"禁止内网回显"红线**当前未被违反**；§10.2 引用的 `cert.ts:591` / `schema.sql:277` / `cert.ts:896` 行号**均准确**。
> - **📈 复发计数**：「文档声明与实现不符」连续 **十三轮**；其中**「审查方自身断言未经实证即被下游引用」为第二轮复发**（首例第十六轮 L1）。**本轮性质第四次位移**：第 10 章**态度最新一轮最坦诚**（明确区分"已订正"与"待实施"，主动撤回绝对化措辞），但**技术细节自洽性**出现新问题——不是"虚报已实现"，而是"**规格本身写错了标识符与前置数据通路**"；此类缺陷比虚报更难自查，因为文风是诚实的。⇒ 审查"实施规格"章节固定追加三问：① 规格点名的**每个标识符/行号**是否有可复现取证？② 规格依赖的**每个输入**（`req.xxx`、表列）在当前代码里是否真的存在？③ 规格的**拒绝分支**是否会把任一"合法但边界"的用户永久挡住？
> - **🧹 复核方法**：本轮全部结论分两路取证——(a) **标识符与行号**：`rg -n` 全仓存在性 + `git log -L` 逐行历史 + `sed -n` 实读；(b) **数据通路**：从 `agent.go`（About 赋值）→ `hardware.go`（ID 生成/存储权限）→ `provisioner.go`（头发送守卫）→ `cert.ts`（头读取/落库/黑名单）→ `device-registry.ts`（铸造与空值分支）→ `schema.sql`（表列）逐跳核对。`rg -r` 误用（`-r` 是替换标志）在本轮再次发生并已即时察觉纠正，改用 `rg -n`。

> **审查红线（第二十四轮沉淀 · Rule 13 · 对同文档新增第 12 章「终局闭环落地规格」的复核，详见该文档 §13）**：
> - **㊶（残留反向搜）"彻底清理 / 全部误述 / 全部删除"类声明，必须用"反向搜"核验——即检索被清理的那个错串本身，且范围须覆盖架构图与实施规格正文，不能只看表格**：第 12 章称"**彻底清理**前文第 8、9、10 章中对所谓 `n` 头的全部误述"，对齐表标"✅ 规格已归位"，实测**仍遗两处**——§8.1.3 换绑 **mermaid** 图节点 `(头名 'n')`（架构图是实施方最先读的部分）、以及 §10.3 **实施规格正文**「不仅校验请求头 `n` 非空」（照此实现即触发 ㊲ 的"比对恒不成立⇒换绑 100% 被拒"）。§8.3 与 §10.2 确已归位。⇒ **判据：`rg -n '<被清理的错串>'` 全文档搜一遍，逐条比对声明**；"彻底"二字永远是待证命题。
> - **㊷（新机制的固化风险）为修复缺陷而新引入的分支，必须回答"它把哪一类用户永久固化在不可恢复的状态里"；任何写入 NULL/哨兵值的绑定必须给出升级规则**：第 12 章的"首绑非阻断双轨分流"为救 T2 人群（免费档指纹全空）而放行**不带 `device_id` 的首绑**，写入 `device_id = NULL`。两个新缺陷随之产生——(a) **NULL 永不可升级**：§10.2 的更新条件要求"比对通过"，而 NULL 与任何非空值都不等 ⇒ 该行**永不会被 UPDATE** ⇒ 该机器日后私钥再轮换时维度 1 失败，只能依赖尚未建成的维度 2 或免费用户没有的 `.lic` ⇒ **自愈通道对该用户不存在**；(b) **常量碰撞被固化为契约**：轨道 B 放行的正是"指纹全空"这批请求，而它们的 `node_id` 恰是回退派生值——无 `authID` 时为 `sha256("::")[:12]` = **`71546855d627`**（本轮复算一致，与机器无关），有 `authID` 时为 `authID[:12]`。允许其成为首绑**主键**，等于让跨机共享/抖动的主键抢占绑定，其余设备永久 403（即该文档 §4.1 路径 3 的危害），而冲突时三个鉴权维度**全部失效**（NULL / uuid 为空 / 无 `.lic`）。⇒ 在"消除空值坍缩"落地前，轨道 B 必须**额外拒绝回退派生型 `node_id`**；更根本的修法是**客户端 fail-fast**（指纹全空时重试 WMI 采集、不发起 provision），文档当时只治云端未提客户端。
> - **㊸（跨包依赖）规格要求"某包调用某函数"时，先查 import 方向，Go 包循环依赖是构建期硬约束**：第 12 章的通路① 要求 `pkg/cert/provisioner.go` 上报 `uuid_hash`，而指纹读取 `GetDeviceFingerprintHashes()` 在 `pkg/server`，且 **`pkg/server` 已 import `eqt/pkg/cert`**（`server.go:31`）⇒ 反向 import 即成环、**编译不通过**。⇒ 规格须改走"调用方经 `opts` 传入"或"函数下沉 `pkg/util`"（该章 T5 项已提到 `pkg/util` 出路，但通路①未同步）。**判据：`rg -n '<目标包>' <来源包>/*.go` 与反向各查一次。**
> - **㊹（配额算术与自相矛盾）"预留 N%"类配额承诺须换算成绝对数量并与目标人群规模对照；"严禁消耗配额"与"能正常签发"不可兼得**：第 12 章轨道 B 称"全局周额度最多预扣 10%" ⇒ `40 × 10% = ` **4 张/周**（全网共享），而同一节的备选表述"**严禁消耗** ACME 额度"在逻辑上等于**不签发证书**，与结论"合法免费用户在偶发空指纹下**仍能平滑使用 LAN-TLS**"直接冲突。同节触发条件表述「WMI 超时**且 CPU 常态为空**」亦与代码不符——`device-registry.ts:63` 的条件是 **`!uuid && !cpu && !disk`（三项全空）**，`hardware.go:272-274` 超时**整体返回 `"","",""`**；若仅 CPU 空而 uuid/disk 有值，注册会正常铸造 `device_id`、**不走轨道 B**。这一字之差决定轨道 B 是"罕见瞬态"还是"常态人群"，进而决定 4 张/周是否够用。
> - **㊺（项目交互规则）用户告警一律走应用内通知，禁用浏览器级 alert/confirm 弹窗**（项目 `CLAUDE.md` 明令）：第 12 章对 About 面板一键复制按钮提出"点击时**显式弹出安全警告说明**"——若实现为 `alert()`/`confirm()` 即违规，须改写为应用内提示条/Toast；若脱敏后仍需向客服提供全量 ID，须另定**显式的、经用户确认的**导出通道，否则该按钮的原始用途被静默取消。
> - **⚠️ 本轮发现项**：**U1**（**高**，见 ㊷(a)(b)，轨道 B 固化常量碰撞，冲突时三维度全失效）；**U2**（中高，见 ㊷(a)，NULL 绑定永不可升级）；**U3**（中高，见 ㊸，通路① 循环依赖）；**U4**（中高，见 ㊹，配额算术矛盾 + 触发条件表述与代码不符）；**U5**（中，见 ㊺，弹窗违规 + 需定义全量 ID 的显式导出通道）；**U6**（低）第 12 章指定 `utils/format.ts` 而该文件**不存在**（`ls src/utils/` 15 个文件无之，全仓零引用），应标"新建"；§10.1.2 第 3 条仍写"必须统一调用 `shortDeviceID`"（未导出，见 §11.5），未加指向 §12.4 的标注，属"新章已修、旧章未同步"；**U7**（中，见 ㊶，§12.1 的"彻底清理"仍有 §8.1.3/§10.3 两处残留）。
> - **✅ 本轮确认属实项**：§8.3 的 7.2.1 行已改回 `X-EQT-Device-ID`、§10.2 标题与正文已归位且误引的 `:375` 已删（**T1 在 §8.3/§10.2 确已闭环**）；§12.3 的维度 1 冷却豁免已确立，其引用 `cert.ts:703-705` **行号准确**（实测 `maximum 3 requests per 24 hours` + 429 + `Retry-After: 86400`）；§12.4 对 T3 已诚实降级为"依赖两处新增数据通路，待后续排期实施"；§12.6 的"底层必须硬分离"结论与 §2.1/§2.3 三维差异论证自洽；全空常量 `71546855d627` 本轮复算**一致**。
> - **📈 复发计数**：「文档声明与实现不符」连续 **十四轮**。**本轮回落到"声称彻底清理而实有残留"**（U7，经典形态），**并新增"为修复缺陷而引入的机制自身带缺陷"**（U1/U2）。⇒ 审查"为修缺陷而新引入的机制"时固定追加一问：**这条新路径把哪一类用户永久固化在不可恢复的状态里？**
> - **🧹 复核方法**：本轮除常规 `rg -n`/`sed -n` 取证外，新增两类探针——(a) **反向搜残留**（搜被清理的错串本身）；(b) **import 方向双向核验**（`rg -n 'eqt/pkg/cert' pkg/server/*.go` 与反向各一次），以及 `python3` 复算常量（`hashlib.sha256(b'::').hexdigest()[:12]`）。

> **审查红线（第二十五轮沉淀 · Rule 13/14 · 对同文档第 14 章「终局裁定」的复核与实施工单化，详见该文档 §15/§16）**：
> - **㊻（"维持/沿用"= 伪前提信号）凡规格称"维持/沿用**既有**的 X 约束/字段/行为"，先 `rg` 该 X 是否真实存在**：第 14 章 §14.3.1 称"`device_id` 字段**维持**严格的 `NOT NULL` 约束"，实测 `schema.sql:277` 为 `TEXT DEFAULT NULL`（`:282` 还为其建了索引）——该约束**从未存在**。写"维持"会让实施方**静默跳过"新建约束"这一步**，比"写错"更危险。同节 INSERT 列名 `public_key`/`created_at` 在表中亦不存在（实为 `public_key_sha256`/`first_bound_at`，对照 `cert.ts:891`）。⇒ **现状描述与目标描述必须可区分**：前者附取证，后者标"新增/修改"。
> - **㊼（状态标注虚高）规格已写 ≠ ✅ 闭环**：§14.5 把 `✅ 物理消解`/`✅ 契约闭环` 标在**代码零改动**的条目上；其 §14.3 判定 A 的核心能力"允许自动更新公钥"在 `cert.ts` 中**不存在**（全仓对 `node_public_keys` 仅 `:866` SELECT / `:883` UPDATE last_seen_at / `:891` INSERT，**零处改写 `public_key_sha256`**——而这是 TOFU 死锁的根因能力，自第 21 轮指出后四轮未变）。⇒ 落地状态只允许三档：**已存在（附 `rg` 命中）／待实施／不适用**；写"✅ 闭环"必须附一条可执行验证命令。
> - **㊽（工单必答：孤儿产物）写实施工单时，除"改什么"外必须枚举"这一改动使哪些既有产物成为孤儿"**：写 §16 时才暴露——删掉 `GetDeviceNodeID()` 的全空回退后，**磁盘上已在回退 id（`71546855d627`/`authID[:12]`）下签发的设备证书不再是 `GetActiveCertificate` 的命中目标**（空 nodeID 会跳过 `provisioner.go:568` 的专用证书分支）⇒ 老用户丢证书，**Step 1 自身变成 Rule 13 回归**，必须先做迁移（推荐：探测 + 重命名回退目录，不耗配额且可逆）。⇒ **判据：对每处"删除/收紧"，列出被它断供的下游既有资产**（磁盘文件、已签发凭据、已落库行）。
> - **㊾（工单先查"是否已实现"）**：为方案写工单前先 `rg` 该"新增"项是否已存在——本轮发现 §14.2.1 的"常量硬阻断铁律"**已实现**（`app.go:2121-2123` 的 `if nodeID == "" { return false, fmt.Errorf(...) }`），工单据此从"新增守卫"缩为"新增重试 + 空值不落缓存"；`provisioner.go:568` 的 `cleanNode != ""` 守卫亦使空值安全跳过专用证书分支。**已实现的不要重复工单**（重复实现违反 Rule 2/3，且会掩盖真实缺口）。
> - **㊿（验收判据须可机读且能对原缺陷转红）**：工单验收不得是"再评审一章"，须是 `go test` / `rg` 命中 / 基准耗时回归，并显式写明"**把本次 diff 回退后，该用例必须失败**"（Rule 9）。本轮为 `cert.ts` 换绑定了两条互斥用例（同 `device_id` 换钥 ⇒ 200 且库中密钥更新；异 `device_id` ⇒ 403），并为 `server.go:2451` 路径定了耗时回归探针。
> - **⚠️ 本轮发现项**：**V1**（🔴 `NOT NULL` 伪前提 + 两个列名错）；**V2**（🔴 换绑能力缺失却标 ✅ 闭环）；**V3**（🔴 重试落点未限定 ⇒ 若下沉到 getter，`server.go:2451` 传输路径最坏 +4.5s，且 Wails 直绑的 `DevProvisionDeviceTLSCert` 阻塞主线程）；**V4**（🔴 `cachedNodeID` 首调固化且回退值即写入缓存 ⇒ 重试成功也不改变 `node_id`，治本方案落空）；**V5**（🟠 "99.999% 重试成功率"无来源 + 重试代码不存在却标 ✅ 物理消解）；**V6**（🟡 §14.6 表格称 Node ID"与物理网卡绑定"，实测依据为主板 UUID/CPU/系统盘序列号，**与网卡无关**）。工单化时另发现**存量证书孤儿**（见 ㊽）。
> - **✅ 本轮确认属实项**：**§14.3 废除轨道 B 的方向正确**（与 §13 U1/U2 一致，"删除优于规格化"）；**U7 两处残留已真实归位**（§8.1.3 mermaid `:408`、§10.3 正文 `:668` 均已为 `X-EQT-Device-ID`；§9.3 残留带 ❌ 留痕标注）——**本线程第一次"声称"与"实测"完全吻合**；§14.4.1 的 `ProvisionOptions` 透传方案可实施且无 import 环；静默 provision 确在 goroutine 中（`app.go:265`）⇒ §14.2.1"不受 300ms 束缚"对静默路径成立（对 `DevProvisionDeviceTLSCert` 不成立）。
> - **📈 复发计数**：「文档声明与实现不符」连续 **十五轮**。**性质改善**：本线程首次出现"方案方向与审查方建议完全一致"；第 24 轮的「新机制自身带缺陷」形态**消退**，回归的是**状态标注虚高**（V2/V5）。
> - **⏹ 方法沉淀（何时停止文档审查）**：审查对象是**文档**时其**可陈述面无限**——每新增一章都产出新的可证伪陈述（本轮"彻底清理""99.999%""维持约束"皆此类）；**代码可陈述面有限**，测试给出确定答案。**信号：若连续多轮只有文档变更、代码零改动，且新发现集中在"状态标注/措辞"而非"能力能否实施"，即应停止文档审查，转为"工单化 + 只审 diff"。** 工单化的检验标准：每步能否写成"**文件:行 + 现状原文 + 目标 diff + 验收命令**"四元组；写不出来的步骤说明规格仍不清。
> - **🧹 复核方法**：本轮新增三类探针——(a) **"维持/沿用"反查**（`rg` 声称被维持的约束是否存在）；(b) **能力反查**（对每条声称的能力，`rg` 其**写语句**而非读语句：`rg -n 'SET public_key_sha256' cert.ts` 零命中即证"自动更新公钥"不存在）；(c) **调用面枚举**（对准备插入重试/延迟的函数，`rg -n '<fn>\('` 数出全部非测试调用点，判断是否落在传输/交互路径上）。

---

### 第 26 轮（复核 `cd9a1138` 落地 diff · 首次以代码 diff 为审查对象）

> **性质转变**：前 25 轮的审查对象是**章节**，本轮起是**代码 diff**（可陈述面有限、测试给确定答案）。开发方本轮**诚实度合格**——§17 六项声明经复跑**全部属实**（131 passed / tsc 0 error / 60 passed），§16.5 要求的"回退即转红"**首次真正成立**（反向探针：`cert.ts:872` 注入 `false &&` ⇒ T20.3 转红 58/2，复原 60/0）。**失误形态随之从"交付不实"变为"设计判断失误"**：做出的机制本身对，但**用在了错误的授权依据上**，且**在被拒绝的合法用户身上没留出路**。

> - **🔴 ㊾ 授权依据的"机密性"由分发渠道决定，不由长度决定**：任何被写入授权判定式的标识符，先回答"**产品是否主动教用户把它交出去**"。实测 `cert.ts:872` `boundDeviceId === deviceIdHeader` 的授权值 = `GetAuthorityDeviceID()`，而该值被渲染进 About 面板全文（`main.js:2833`）并配**一键复制按钮**（`main.js:2820`，文案 "Click to copy Device ID"）⇒ 它被设计为**可转发**的信息，128 bit 也不构成秘密。这是 §21.⑧/红线 ㉚（"公开低熵标识符不得成为签发授权"）**换标识符重演**。判据升级：**换绑授权须证明"我持有当前被绑定的私钥"（旧密钥签名），而非"我知道一个字符串"**；在"旧私钥已丢失"的不可判定点上，安全默认值应 fail-closed——**宁可退回明文 HTTP（可用性降级），也不接受身份被第三方认领**。附：规格要求的"查 `device_registry` 校验"实现里没有，且**不实现是对的**（注册端对任意指纹都铸新 id，查它不构成认证）——但要指出"缺的是一个维度，不是差一步"。
>
> - **🔴 ㊿ "继承旧凭据"必须先验它是否对当前身份成立**：本轮的 `MigrateFallbackNodeCredentials` 把回退目录的证书**原样复制**到新 node 目录，而证书 SAN 是旧 node 的（`provisioner.go:334-335/345`）⇒ 得到了**一张域名不匹配的证书**。放大链条：本地校验只查 trust+expiry 不查域名（`provisioner.go:562-596`）⇒ 降级守卫误判为有效（`cert.go:53-56` ⇒ `agent.go:1031` **不降级**）⇒ "已有证书 >15 天"短路**永不重签**（`app.go:2137-2154`）⇒ 对外宣告真实 node 的域名却出示旧证书 ⇒ **HTTPS 硬失败且无回退**。而**不迁移**反而正确：无证书 ⇒ `HasValidCertificateForNode` false ⇒ `cfg.Secure=false` ⇒ **优雅退化为明文且功能可用**。规则：**迁移/继承任何"凭据类"产物前，必须校验该产物对目标身份是否成立（证书验 SAN、密钥验指纹、配置验作用域）；继承后"能用"≠"用对了"**——"能解析+未过期"是最容易被冒充的充分条件。
>
> - **🔴 新增拒绝分支必做"被拒者是否本来合法"代入**：`cert.ts:909` 新增 `if (!deviceIdHeader) → 400`，而客户端在 `opts.DeviceID == ""` 时**根本不发头**（`provisioner.go:799-801`），`DeviceID` 为空是**合法状态**（`hardware.go:400-403`：**遥测关闭即 `RegisterDeviceOnline` 早退**，永不铸造；另有首次运行注册失败、纯离线首装）。⇒ 以**用户隐私设置**换取功能可用性。**最强证据来自开发方自己的测试 diff**：7 处既有请求被补上 `X-EQT-Device-ID` 才保持绿色——**被删掉的能力的活化石就在测试改动里；审查 diff 时，先看"为了让旧用例继续通过而改动了什么"，那通常就是回归本体**。收尾三件套缺一不可：客户端 `reason_key` 分支 + `i18n.js` 词条 + 按 `CLAUDE.md` 的**应用内通知**（禁用浏览器 alert）。
>
> - **🟠 重试要打在"会永久污染的那一层"上**：`app.go:2118-2123` 的重试只 `Sleep` 不失效缓存；而 `GetDeviceNodeID` 的 nodeID 缓存已被 Step 1a/1b 正确改为"不缓存空值"（**该层本不需要重试**），真正会永久固化的是**指纹层**——`hardware.go:205-209` 预计算协程**无条件**写 `hasCached=true`（值为空也写），此后 `:259` 的 `if !hasCached` 整块被跳过。开发方新增的 `InvalidateCachedNodeID()`（`:515-519`）**只清 nodeID、不清指纹**，且 `rg` 全仓命中 3 处**全在测试**⇒ **死代码**。**反向探针 A 实证**：`hasCached=true`+三项为空 ⇒ 3 轮 `GetDeviceNodeID()`+`InvalidateCachedNodeID()` **全空、无恢复**。规则：**"新增了失效钩子"必须 `rg` 其调用点；只定义不调用 = 把误导从文档搬进了代码**。同源瑕疵：`:215` 无条件打印 `fingerprints cached successfully`（三项全空也报 success）——**成功日志不由结果驱动**（红线 ㉖ 复发）。
>
> - **🟠 键空间覆盖须枚举全部历史分支**：`:193` `fallbackCandidates := []string{"71546855d627"}` 只有常量那一支；`authID[:12]` 那一支（指纹全空**且有 authID**）未被覆盖，而它**可计算**（`GetAuthorityDeviceID()[:12]`），理应一并处理。（若采纳"不迁移+允许降级"，本条自动消解——这也是该方案更优的理由之一。）
>
> - **🟡 新增 `reason_key` 仍缺消费端**：`device_id_required` 全仓仅生产端（`cert.ts:909`）+ 测试断言；客户端只处理 `node_key_mismatch`（`provisioner.go:840`），`i18n.js` 零词条。**第 4 次复发**，见红线 ⑤/⑨/⑱。
>
> - **✅ 本轮确立的正向基线**：Step 1a/1b（`hardware.go:501-505` 在 `cachedNodeID = ` **之前** `return ""`）是 §14 以来**第一段方向与根因完全一致**的实现；**重试未下沉到传输路径**（`GetDeviceNodeID`/`GetDeviceFingerprintHashes` 零改动，`server.go:2451` 无额外耗时）✅；D1 换绑 `UPDATE` 语句与 T20.3 用例本身要保留（换绑**通道**对，错的是**触发条件**）✅。
>
> - **📈 轮次**：二十六轮。**⏹ 关闭条件**：R1（授权依据改为旧公钥签名）/ R2（不迁移、依赖明文降级）/ R3（为无 `device_id` 的合法用户留出路）**三项方向确认并落地**后，按同法（只审 diff + 反向探针）复核一轮即可关闭。**在此之前 `cd9a1138` 不宜发版**：R2 与 R3 都会让**当前可用的用户变不可用**。
>
> - **🧹 复核方法（本轮新增）**：(a) **旧用例改动反查**——审查 diff 时先看"为让既有用例继续通过而改了什么参数"，那里通常藏着被删掉的能力；(b) **授权值曝光面追踪**——对任何进入判定式的标识符，从 Go 赋值点一路 `rg` 到 `main.js` 渲染/复制点（`agent.go:108 → hardware.go:393 → main.js:2820/2833`），确认它是否被产品设计为可转发；(c) **缓存层归因**——代码里同时存在多个缓存（nodeID 缓存 / 指纹缓存）时，"重试/失效有没有用"必须逐层判定，`rg` 该层的失效接口与调用点，并写临时内部包用例实测（本轮探针 A）。

---

### 第二十七轮（`663b6dfb`）：审查对象推进到"**裁决论证**"本身

> **性质转变**：前一轮审 diff，本轮审**开发方对审查意见的裁决**。§19.1.1 的六项"采纳"**全部实测为真**（R2 净删 59 行零残留 / R3 探针实测 200+null / R4 日志已按结果分叉 / R5·R6 物理消解），**第二次"声称零偏差"**，且 R2/R3 走的是审查方建议的方向而非折衷。**但 §19.1.2 对 R1 的"不采纳"是一段论证，论证里含可证伪断言**——本轮全部 🔴 都出在这里。

> - **🔴【51】降低风险评级所引用的每一条缓解措施，必须在代码中确证存在**：§19.1.2 第 3 点把 R1 判为可接受，三条依据之一是"前端已将 About 界面的 Device ID 复制改为**安全脱敏复制**，极大降低了用户无意泄露凭证的概率"。实测**该缓解措施不存在**：`663b6dfb` 的 9 个文件里没有 `main.js`/`i18n.js`；`git log -S 'shortDeviceID' -- desktop/gui/frontend/src/main.js` **为空（从未）**；全仓唯一 `shortDeviceID` 在 `server.go:1759`，**只用于服务端目录命名且未导出**；About 面板 `main.js:2833` **全文**渲染、`:2820` 一键复制**完整值**（按钮文案 "Click to copy Device ID"）。⇒ **去掉这条依据后，R1 的风险评级无法维持**。这是 ⑪（安全论证前提未确证）、⑭（审查方标识符凭记忆）之后的**第三次换壳：书面断言未经代码核验**。判据：**裁决/否决段落里的"已经/已实施/已改为"必须逐条 `rg`；安全论证的承重墙不得使用未核验的缓解措施**。
>
> - **🔴【52】"放开门禁"与"保留旧授权式"组合时，必须检查新放行人群在旧授权式下能否出得去**：本轮同时做了两件事——(1) 首绑允许 `device_id=NULL`（R3 采纳）；(2) 换绑授权式保持 `boundDeviceId && boundDeviceId === deviceIdHeader` 不变。二者合成 **只进不出的单向门**：`cert.ts:871` `const boundDeviceId = existingKey.device_id || ''` 把 NULL 归一为空串，`:872` 的 `boundDeviceId &&` 对空串为假 ⇒ **NULL 绑定节点永不可换绑**。**探针 D 实证**：首绑无头 → 200 + `device_id:null`；换新钥无头 → **403**；换新钥补上头 → **仍 403**。危害：被 R3 刚放开的"关遥测/离线"用户，重装 OS 后**仍然**不带头（那正是他们不带头的原因）⇒ **自愈能力对该人群为 0**，直接击穿 §19.1.2"解决了重装后私钥丢失的自动恢复"的中心承诺。**这是 ⑰(a) "NULL 永不可升级" 的同型缺陷在同一张表上复发**——R3 只解决了"进不来"，没解决"出不去"（R3 建议第 2 条本已提示"写入客户端生成的本地标识而非拒绝服务"）。判据：**任何"放行边界输入"的修改，都要把该输入代入后续全部状态机（换绑 / 续期 / 升级）并写出该人群的出口用例**；`x || ''` + `&&` 判真是此类 bug 的标准写法，见到就要问"空值走哪条分支、那条分支是拒绝吗"。
>
> - **🟠【53】让一个状态变量既表"进行中"又表"已完成"，必然有一处为假**：`InvalidateFingerprintCache`（`hardware.go:523-535`）清空指纹后把 `precomputeStarted` 置 **false**，但：预计算入口只在**启动路径**（`main.go:19`、`desktop/gui/main.go:46`、`cmd/eqt/main.go:12`，运行期无再触发点）；完成信号是**一次性**的（`hardware.go:217-219` `precomputeOnce.Do(close(precomputeDone))`，`sync.Once` 用尽、channel 已关，**不可重装**）。⇒ 失效之后每次读指纹都落 `:280-291` 的 **else 同步分支：持锁（`:257 defer Unlock`）执行三路 WMI（`:282-284`）**；若仍返回全空则不置 `hasCached` ⇒ **此后每次调用都重复三路持锁 WMI**，而调用点包含**热路径**（`server.go:2451` 传输启动、`app.go:1256` AppInfo 轮询）。同时 `:281` 打印 "**precompute not started**" ——预计算早已完成，**陈述为假**（红线 ㉖ 家族）。**潜在陷阱**：`precomputeStarted=true` + channel 已关 + `hasCached=false` ⇒ `:269-274` 的 `select` 立即返回空且永不恢复（当前不可达，但状态机已可被误用即静默失效）。判据：**`sync.Once` + 一次性 channel 无法表达"失效 + 重算"，需要可重入的代数计数器或重建 channel**；**"进行中/已完成"须由两个变量或一个枚举表达**；**缓存失效的代价必须落在调用方（热路径）上评估，而不是只看"有没有清干净"**。
>
> - **🟠【54】验收表的用例编号与数字须逐个 `rg` 对齐**：§19.3 写 "`npm run test:offline` (T20.1~T20.4)" 与 "60 assertions passed"；实测 **T20.0~T20.3，不存在 T20.4**；cert 套件实测 **61 passed**（总数 131 passed / 0 failed 属实）。数字不保真本身是小事，**但它掩盖了【52】的零覆盖**——"T20.1~T20.4"读起来像换绑场景已完整覆盖，实际覆盖范围恰好停在缺陷边界上（T20.0 首绑 NULL 之后**从未**尝试换绑）。
>
> - **🟡【55】测试的 override 早退会遮蔽整条缓存路径**：`testFingerprintOverride` 使 `GetDeviceFingerprintHashes` 在 `hardware.go:252-254` **提前 return**，因此 `:280-291` 的同步重算分支（正是【53】中承担自愈与代价的那段）**没有任何测试执行过**；`precomputeStarted/precomputeDone/precomputeOnce` 状态机同样零覆盖；`hardware_test.go:75` 的 `invalidatedNodeID == recoveredNodeID` 两端**都走 override 路径**，验证的是"同输入同哈希"，不是"经真实硬件重算后恢复"。判据：**凡测试用 override/短路绕过被测状态机，"该状态机已被测试"的断言不成立**——§19.3 该行"重试时调用确保**真实重算**"当前无法被测试支持。
>
> - **✅ 正向基线（第七轮）**：R2 完全采纳"不迁移 + 允许明文降级"，`MigrateFallbackNodeCredentials` 与 `fallbackCandidates` 全仓零残留；R3 撤销 400 门禁并把 `INSERT` 回退为 `deviceIdHeader || null`；R4 的 `hasCached` 与成功/WARN 日志**均已按结果分支**（红线 ㉖ 本轮消解）；R5/R6 随 R2/R3 物理消解。`go build ./...` / `go test ./pkg/server ./pkg/cert` / `tsc --noEmit` / `131 passed` 复跑全绿。
>
> - **📈 轮次**：二十七轮。**⏹ 关闭条件**：**R7**（撤回"脱敏复制"论断，或真正实现脱敏）/ **R8**（为 NULL 绑定节点给出出口 + 补一条 T20 用例）各选一条路落地；**R9** 可延后但须记录在案。之后按同法复核一轮即可关闭。**R1 的方向裁决权归开发方**——"旧私钥签名"在"旧钥确已丢失"的主流场景确实无解，这一点开发方说对了；**但"接受方向" ≠ "接受依据"**。
>
> - **🧹 复核方法（本轮新增）**：(a) **裁决段取证**——把对方接受/否决的论证拆成"事实断言"逐条 `rg`，重点查"已实施 / 已改为 / 已完成"，因为**这些词支撑的是风险评级而非功能**；(b) **边界输入走完全程**——对每个被"放行"的边界值（NULL / 空串 / 缺省），代入后续**所有**判定式，检查是否被 `|| ''` + `&&` 这类组合静默挡死；(c) **override 反查**——审查测试时先看它是否被 override/短路提前 return，若是，其断言不覆盖真实路径；(d) **审查方自己的假设也要做反向探针**——本轮探针 E（删掉 `hardware.go:532-534` 的 nodeID 清理）**推翻了我"第 7 步无判别力"的假设**（实测 `hardware_test.go:54` 转红），该假设已当场撤回并写入复核意见。**推论只是假设，探针才是证据。**

---

## 第八轮复核沉淀（基线 `v1.36.106`，针对 `4ee67b0e`）

> 开发方诚实度与可验证性再次成立（R8 死锁确被打开，反向探针转红 4 条断言；R9 三项改动属实；R10 数字校正；`go build` / 16 包 ok / `tsc` 0 error / cert 67 / offline 131 全部一致）。**本轮 🔴 全部来自"设计判断"，不来自"陈述不实"。**

> - **🔴【56】"打开死锁"必须同时检查：这一改动是否交出了一枚已经成立的安全属性？** `cert.ts:876-878` 把 NULL 绑定分支由"永不放行"改为 `: true`（无条件放行）。探针 P28 三组同批实测：**A（控制组，已强绑定节点）** 攻击者无头改绑 = **403**（防线成立）；**B（NULL 绑定节点）** 攻击者仅持**自签新钥**、**无任何 `device_id`** → **200**，`public_key_sha256` 被改写为其公钥，且因 `cert.ts:775-793` 的 SAN 校验只要求 CSR 自洽，**当次即取得受害 `node_id` 域名的公信证书**；**C** 攻击者再以任意串盖章 `device_id`（`COALESCE`）后，**原主无头访问 = 403 永久**。⇒ 攻击者所需信息只有 `node_id`，而它按设计**印在 LAN 二维码与直连 URL 里**。**判据**：任何"由要求凭据改为无条件放行"的判定式，先问 **"触发它需要知道什么？该信息是否公开？"**（红线 ㉚ 的判定式版本）；再代入 **"被顶替后原主能否恢复"**（P28-C：不能）。**附带判据**：**用例绿 ≠ 安全成立** —— 新增 T20.4b 的请求字节（新私钥 + 无 `device_id`）与攻击者请求**完全相同**，服务端在不可判定点上无法区分"原主重装"与"他人认领"；此时绿色只证明路径可达，未证明其被授权。
>
> - **🔴【57】不可判定点上的取舍，按"失败方向的可逆性"择向，而非按"人群大小"择向。** fail-closed（`663b6dfb` 之前）：合法用户丢私钥 → 降级明文 LAN（`cfg.Secure=false` 现有路径，仍可用），**外部攻击者收益 0**，上界确定且可经客户端更换自身 node 身份恢复。fail-open（`4ee67b0e`）：合法用户**新增**"被盖章后永久 403"，外部方**取得受害者域名的公信证书**，**服务端无回滚路径**。⇒ **代价不可逆的一方不选**（§18.3 的结论本轮被实测坐实）。**且放开的同时不得保留相反的裁决句**：§21.1/§19.1.2 的"既解决了…**又封死了全网旁观者随意篡夺节点域名的黑客攻击路径**"对 NULL 人群已被本次 diff 自身证伪，必须改写或删除。**一次"修缺陷"同时移除了缺陷与保护时，必须在文档里把被移除的保护登记为已接受风险。**
>
> - **🟠【58】"承重墙"级安全论据，须 `rg` 到**该端点**的判定式上，而不是同族另一端点。** §21.1.2 称承重墙是"24h/3 次强频控 + **硬件指纹强制一致性校验**"：`rg -c 'uuid_hash|uuidHash|cpu_hash|disk_hash|fingerprint' src/routes/cert.ts` = **0**，provision 请求不携带任何指纹；该规则真身是 `device-registry.ts` 的 3-of-2 —— **跨端点挪借论据**（同型第四次：⑪ / ⑭ / 【51】 / 本轮）。另一件：**频控是节流，不是授权**——必须核实"攻击成功所需的请求次数 ≤ 频控阈值"：探针实测**第 2 次请求即 200**，而阈值 3/24h，即"强频控在攻击成功之前就已让路"；且桶键为 `cert_provision:<node_id>`（`:694`），攻击者可按 per-IP 10/24h 覆盖 10 个节点并轮换出口 IP。
>
> - **🟠【59】验收表引用的命令，必须对该改动具备判别力；固定取证法：插唯一日志数触达次数。** 在同步分支与冷却分支各插 `PROBE28_*` 后实测：`go test -v -run TestGetDeviceNodeID` → **同步分支进入 1 次**（来自 `hardware_test.go:12` step 1，此时 override 尚未置真），**冷却分支 0 次**。而 step 1 的断言只有"长度 12 / 十六进制 / 幂等" ⇒ **持锁 WMI 与锁外 WMI 两种实现同样全绿 = 对该改动的核心零判别力**；"冷却限频生效"则**零覆盖**。⇒ §21.2 该行应从 "✅ PASS（验证）" 降级为 "**已实现，未验证**"。**"测试进入过这段代码" ≠ "测试能判别这段代码"** —— 两者须分别取证。
>
> - **🟠【60】"脱敏"类缓解举措须逐通道列举取值来源；"脱敏复制"与"复制按钮用途"互斥时须择一并改文案。** `rg` 四通道：`:2833` 正文 ✅ 已 `maskDeviceID`；**`:2820` 一键复制 `data-copy-text` 仍为全量原值**（`:3516` 处理器原样入剪贴板）；`:2833` 的 `title` 仍为全量（悬停可见）；DOM 内本就明文。§19.1.2 的原句是"**复制**改为安全脱敏复制"，§21 虽已诚实自陈"`1.36.105` 时未合入"（**该更正值得肯定**），但新措辞"视觉脱敏渲染…**从根源杜绝截图、录屏或远程协作时的无意全值泄露**"只覆盖正文。⇒ 终态二选一：**(a)** 复制脱敏值（同时改文案为"复制脱敏 ID"）；**(b)** 保留全值复制，删除"从根源杜绝"措辞，把脱敏限定为"仅防肩窥/截图"。
>
> - **🟡【61】缩小锁的范围 = 交出"锁内跨语句不变量"，须逐条复核。** R9 把三路 WMI 移出 `fingerprintMu`（`hardware.go:288` 解锁 → `:295` 回锁写回）后，解锁期间并发的 `InvalidateFingerprintCache()` 会被随后的写回**覆盖**（`hasCached` 可能被重新置真）⇒ `app.go:2111-2125` 重试循环的某次失效可能成为空操作（返回旧缓存而非重算）。原实现持锁跨越 I/O，失效与探测天然串行，**故这是本次修复新引入的窗口**。修法：写回前在锁内重验世代号/取消令牌。**判据：缩小锁范围时，必须列出"原本被这把锁顺带保护的跨语句不变量"**（此处是"失效与写回的先后关系"），而不是只检查"有没有死锁/是否还能编译"。
>
> - **🟡【62】（审查方自我更正，第二轮连续）** 我原判"`testFingerprintOverride` 早退遮蔽同步分支 ⇒ 该分支零覆盖"。**marker 探针证伪**（step 1 在 override 置真**之前**即调用 `GetDeviceNodeID()`，分支确被执行并真实读取本机 DMI）。精确结论改为【59】的"**被进入、但无判别力**"。⇒ 凡"某路径必然零覆盖"的断言，落笔前先插标记数一次。
>
> - **✅ 正向基线（第八轮）**：R8 死锁确被打开（反向探针 `: true` → `: false` ⇒ T20.4b/T20.5 **4 条断言转红**，63 passed / 4 failed，**判别力成立**）；R9 锁外化 + 日志措辞求真（`cache invalidated or not precomputed`）+ `InvalidateFingerprintCache` 重置 `lastFingerprintProbeTime`；R10 编号与断言数校正（T20.1~T20.3 / 61）；基线复跑 `go build ./...` OK、`go test -count=1 ./cmd/... ./pkg/...` **16 包 ok / 0 FAIL**、`tsc --noEmit` 0 error、cert **67/0**、offline **131/0**。
>
> - **📈 轮次**：二十八轮。**⏹ 关闭条件**：R12/R13 从 §22.9 的出口 1/2/3 中择一落地（**出口 1 最小且可逆**：`cert.ts:876-878` 一行回到 fail-closed + 客户端在 `node_key_mismatch` 时轮换自身 node 身份）；R14/R15/R16 属措辞与覆盖补齐（可直接落地）；【61】两条残余登记即可。落地后同法复核一轮关闭。
>
> - **🧹 复核方法（本轮新增）**：(a) **授权题**——把判定式改写成一句问话："达成这个动作，最少需要知道什么？"再 `rg` 该信息的所有暴露通道（前端渲染/复制/`title`/URL/二维码/仓库文档），**公开即拒绝**；(b) **同批对照探针**——同一时刻跑三个对照组（已强绑定的控制组 / 被放行的目标组 / 被顶替后的原主回访组），**控制组必须为负**才能证明探针本身有效；(c) **触发器频率校验**——凡以频控作为安全论据，先算"攻击成功需要几次请求"，再与阈值比；(d) **标记法测覆盖**——唯一日志 + `go test -v` 计数，一次运行即可区分"未覆盖 / 覆盖但无判别力 / 覆盖且有判别力"三态。

---

## 第九轮复核沉淀（基线 `v1.36.107`，针对 `b161d543`）

> 开发方**连续第三次"声称零偏差"**：反向探针 R29-1（`cert.ts` 的 `isAuthorizedRebind` 改回 `true`）使 **T20.2 / T20.4b×2 / T20.5 转红**（63 passed / 4 failed）⇒ 第八轮 R12/R13 的两个 🔴 攻击面**确已闭合且可判别**；R29-2（禁用冷却早退）使 `TestHardwareThrottleCooldown` **FAIL** ⇒ R15 的分支覆盖已补齐。**本轮最关键的正面证据：开发方把审查方上一轮用作取证反例的 `T20.5` 翻转成了反向断言**——被删除的能力与**被修复的能力**同样会在测试改动里留下活化石。

> - **🟠【63】门控条件必须与它所保护的那条判定式**同构**，否则该门控对某一子人群等效于"永久不放行"。** `desktop/gui/app.go:2193` 的自愈门控是 `allowSelfHeal && server.GetAuthorityDeviceID() == ""`，而云端接受与否是**服务端那一行**的属性（`boundDeviceId === deviceIdHeader`）。同批探针实测：**P29-A3**（NULL 行 + 客户端**现在持有**权威 ID 并带上）→ **403 `node_key_mismatch`**；**P29-C2**（行强绑 X + 客户端出示 Y）→ **403**；**P29-B**（轮换出的新 node + 同一头）→ **200**（机制本身有效）。⇒ 当"本地有权威 ID ∧ 云端行为 NULL/漂移"时，**云端永不接受 ∧ 客户端永不轮换** = 永久 403，且只弹一条**无法执行**的提示（全仓检索"请重置密钥绑定"**仅命中该提示串自身**，无任何重置入口）。**且该门控不可能是防护性的**：若行确实强绑当前 ID，请求本就 200（无 `ErrNodeKeyMismatch`），门控不参与；门控只在已失败的分支生效，轮换不会弃掉任何有价值物 ⇒ **该子句只有副作用、没有收益**。**判据**：凡"在 A 条件下才自愈/重试/降级"的守卫，先写清它想保护的不变量属于**哪一侧**；若该不变量是**对端**的属性而守卫读的是**本地**状态，两者不等价，差额即缺陷。
>
> - **🟡【64】验收表的数字必须指明**口径**（哪条命令、哪几个套件），跨口径挪用会掩盖覆盖缺口。** §23.2 称 `npm run test:offline` ⇒ "22 suites passed, 67 assertions"；实测 **8** 个套件打印聚合 `Results:` 行（42/27/64/21/17/67/24/131 = **393**），67 恰为 `test:cert:offline` 自己的数字，"22 suites"与任何实测口径不符。⇒ 结论（全套件通过）成立，数字不可复现。**判据**：验收行须写"命令 + 数字 + 该命令的输出形态（几个聚合行）"，数字与命令一一绑定。
>
> - **🟡【65】新用例若断言了一个"生产不可达"的状态，则分支覆盖成立但结论措辞越界。** 生产不变量：`hasCached == false ⟹ cachedUUID == cachedCPU == cachedDisk == ""`（三处写点皆成对赋值：`hardware.go:206-216` / `:295-305` / `:538-544`）。探针 P29-D 构造**生产可达**的冷却状态（`hasCached=false` ∧ `cached*` 全空 ∧ `lastFingerprintProbeTime=now()`）实测返回 `uuid="" cpu="" disk=""` 且 `GetDeviceNodeID()==""`；而 `TestHardwareThrottleCooldown` 注入的是 `cached*` **非空** ∧ `hasCached=false`（生产不可达）并断言三值原样返回。⇒ "断言冷却限频**直接返回有效缓存**"在生产语义下为假，冷却的真实收益是"**不再重探**"。**同时须澄清以免误修：R9 冷却在返回值上语义中性**（只在"上次探测已证明全空"时触发，返回与重探一致），**不构成回归**。修法：改为可观测"未重探"的判据（探测计数/耗时），或改写措辞。**判据**：新用例的初始状态须能由某条生产路径产生；否则它测的是"函数在人为状态下的行为"，不是"生产行为"。
>
> - **🟡【66】改动使机制文档的**根因前提**失效时，须同步限定语（历史节次"实例式修复"）。** `docs/mechanism/lan-tls-zero-leak-acme-architecture.md:1181` 仍写"`node_id` 派生自不可变硬件特征（跨系统重装恒定）"——该前提是整段 F12 根因推理的地基（"唯一易失资产是私钥"）。引入 `node_salt.dat` 后 `node_id` 变为**本地可变**，`:1187-1189` 的"方案 B（时间窗口老化自愈）"亦被"fail-closed + 客户端轮换"取代。⇒ 只需补一行限定语，不必重写。
>
> - **🧾 残余登记（非缺陷，但须写进文档以免用户预期落空）**：(a) **轮换使已分发的直连链接/二维码失效**（`<旧 node>.direct.eqt.net.im` 不再指向本机），且每次轮换留下不可回收的 D1 孤儿行 ⇒ "对用户完全透明无感"对手持旧链接者不成立，应改为"对当前会话透明；已分发的旧直连地址失效"；(b) **"知道 `device_id` 字符串"仍是唯一重绑授权**，而同一章 §23.1.4 刚确认该值在 About 面板 `title` 可见 + 被复制按钮**原样全值导出** ⇒ 二者并列自相矛盾。这是**"承重墙论据跨节挪借"的第 5 次复发**（⑪ → ⑭ →【51】→【58】→ 本轮）。建议**保留措辞但补写不变量**："`device_id` **不构成秘密**；该墙的真实强度 = 客户端持有被绑定私钥 ∧ 服务端行强绑定"——把借来的强度**显式降级**，而不是删句。
>
> - **✅ 正向基线（第九轮）**：`go build ./...` OK；`go test -count=1 ./cmd/... ./pkg/...` **16 包 ok / 0 FAIL**；`npm run typecheck` 0 error；`test:cert:offline` **67/0**；`test:offline` exit 0 / 全套件 0 failed；`TestRotateDeviceNodeIdentity` 两次轮换互异且持久（`7bed8d1c6a85` / `4d4f15d753d9`）；**向前兼容**——`readCachedNodeSalt()` ENOENT ⇒ `""` ⇒ 走原三分量分支，**未轮换者 `node_id` 不漂移**；`cert.ts` 的 `UPDATE` 已**结构性移除** `device_id = COALESCE(...)` 盖章通道；版本 `v1.36.107` / `1.36.107`。
>
> - **⏹ 关闭条件（第九轮）**：**出口 1 推荐**——删除 `app.go:2193` 的 `&& server.GetAuthorityDeviceID() == ""`（保留 `allowSelfHeal=false` 单次重试），**唯一生产调用点已穷举**（`rg -n 'RotateDeviceNodeIdentity'` 非测试命中仅 `app.go:2194`），爆炸半径为 0，无需触碰云端判定式；R19/R20/R21 为措辞与覆盖同步；残余两条登记即可。**发布判断**：`b161d543` **可随版发布**（它修掉的两个 🔴 远重于它遗留的一个 🟠 子人群可用性问题），建议【63】的一行改动并入下一次提交。
>
> - **🧹 复核方法（本轮新增）**：(a) **同构性检查**——把"守卫条件"与"它所服务的那条判定式"并排写出，看两者读的是不是**同一侧的状态**；不等价时，算出差额子人群的实际结局（是"多弹一次提示"还是"永久不可用"）；(b) **能力删除的活化石**——对上一轮被判为反例的用例，**检查本轮它是否被翻转成反向断言**；被删的能力与被修的能力都在测试改动里留痕，这比文档声明更硬；(c) **"不可达状态用例"识别**——把用例注入的初始状态与生产写点的不变量比对，若某组合无任何生产路径可产生，则该用例只证明"函数行为"，不证明"生产行为"；(d) **审查方自己的假设也要做反向探针（本轮第三次连续）**——"测试会污染开发者真实配置目录"的假设被 `main_test.go` 的 `TestMain` 证伪并当场撤回。

---

## 第九轮意见开发方闭环与终局落地（基线 `v1.36.108`）

> - **✅ 门控同构解耦（R18）**：`desktop/gui/app.go:2193` 删除 `&& server.GetAuthorityDeviceID() == ""`，简化为 `if allowSelfHeal`。保留单次重试防环，全场景遇到 403 `ErrNodeKeyMismatch` 均自动触发 `RotateDeviceNodeIdentity()`，以新节点身份首绑自愈恢复局域网 HTTPS 通信。
> - **✅ 冷却测试求真（R20）**：重构 `pkg/server/hardware_test.go` 中的 `TestHardwareThrottleCooldown`，严密遵循生产不变量（`hasCached = false ⟹ cached* = ""`），断言冷却窗口内瞬时返回空三元组（跳过阻塞重探，耗时 `< 200ms`）。
> - **✅ 机制与口径求真（R19/R21）**：机制文档 F12 同步补齐客户端轮换限定语；测试数字分层明确（`test:cert:offline` 67 绿 / `test:offline` 8 套件 393 断言全绿）。
> - **✅ 明确产品红线**：坚决否决向终端用户暴露“重置节点身份”UI 按钮的偷懒做法（坚持全自动自愈）；严禁客户端在轮换时具备请求云端级联删除旧 node 行的权限（防止 DoS 攻击），孤儿行仅由云端定时异步安全老化清理。
> - **版本递增**：版本升级至 `v1.36.108` / `1.36.108`。

---

## 第十轮复核沉淀（基线 `v1.36.108`，针对 `8247c364`）

> 第九轮 R18/R19/R20/R21 全部落地且**首次被运行时证据确证**。本轮无 🔴，🟠 一条为论据复用、🟡 三条。**代码审查至此实质收敛。**

> - **🟠【67】凡以"限频 / 配额 / 冷却"作为授权论据，须先 `rg` 该限流桶的键是否**随被测主体自身变化**。** §25.1.1 第 6 项称换绑承重墙 = "原主凭据强一致比对 ∧ 云端单节点 24h/3 次限频"。实测桶键即本次 diff 会主动改变的标识符：
>   ```
>   cert.ts:694   const rateLimitKey = `cert_provision:${cleanNode}`;
>   ```
>   而客户端在**任何** `ErrNodeKeyMismatch` 上都会轮换 `node_id`（P30-E2E 实测 `4bd2649bfcd4` → `91e32745ad1c`）⇒ **每轮一次身份变更即换来一个全新桶**，3/24h 对自愈路径**结构上不存在**。**以一条被自身机制绕过的限频作"承重墙"，比性质误判更弱**（性质层面"限频是节流不是授权"已于第八轮【58】固化）。**判据**：见到"配额/限频"出现在安全论证的承重位置，先答两问——① 攻击成功需几次请求（对比阈值）？② 该桶键在被测主体改变后是否重置？
>
> - **🟡【68】规格里的 SQL 是可执行物：新增任何 SQL 片段前须逐列 `rg` 真表结构。** 本轮新增的两处引用都写了 `node_public_keys.updated_at`，而 `schema.sql:274-280` 的真列只有 `node_id / public_key_sha256 / device_id / first_bound_at / last_seen_at`；真代码用的是 `last_seen_at`（`cert.ts:883-887`）。**同表同类错第二次**（第 25 轮已指出 INSERT 列名 `public_key`/`created_at` 不存在）。**判据**：`CREATE TABLE` 与 `UPDATE/INSERT` 的列名逐一对照，不凭记忆写列。
>
> - **🟡【69】描述"某个测试验证了什么"时，须回到测试体确认该调用是**断言**还是 `// Cleanup`。** §25.1.1 第 2 项称用例"结合 `InvalidateFingerprintCache()` 验证时间戳重置后可正常发起重探"，而 `hardware_test.go:120-121` 该调用被标注为 `Cleanup`，其后**无断言**；该用例的判别力来自"空三元组"断言本身（R30-2 已证）。**这是"断言误述"第一次落在"对测试自身能力的描述"上**（此前多落在对代码能力的描述上）。
>
> - **🟡【70】新增的不可逆操作，须问：它是在"后续步骤是否可行"未知之前执行的吗？失败能否回滚？** `app.go:2193-2203` 的顺序是**先** `RotateDeviceNodeIdentity()`（`hardware.go:530-546` 直接 `writeCachedNodeSalt` **覆写**旧盐，全仓无回滚、旧盐不留存）**再**无条件重试。若重试因**与身份无关**的原因失败（per-IP 10/24h、全局 40/周、网络、5xx），用户**零收益**却已**永久失去旧 `node_id`**（已分发链接作废、旧盐不可恢复），且无任何日志汇总"身份已变更但未取得证书"。**判据**：对"写文件 / 改身份 / 删记录"这类单向操作，把它与其后所有可能失败的下游步骤并排，若下游失败时上游收益为零，则该操作**必须先探测可行性或必须可回滚**。
>
> - **✅ 正向基线（第十轮）**：`go test -count=1 ./cmd/... ./pkg/...` **16 包 ok / 0 FAIL**；`test:cert:offline` **67/0**；`test:offline` 8 个聚合套件 `42/27/64/21/17/67/24/131` = **393**，0 failed；`tsc --noEmit` 0 error；版本 `v1.36.108` / `1.36.108`；`maskDeviceID` 实测为 `slice(0,8)…slice(-4)`（与 §25.1.1 第 6 项"前 8 后 4"描述一致）。
>
> - **🧹 复核方法（本轮新增，最重要的一条）**：**(a) 审查方自己写下的"无法实测"结论，下一轮必须复核——它可能只是当时没找到入口。** 第九轮如实声明"R18 客户端半边未跑运行时探针（`opts` 未暴露 `Endpoint`）"；第十轮 `rg` 发现 **`EQT_PROVISION_ENDPOINT` 环境变量覆盖存在**（`pkg/cert/provisioner.go:648-658`），于是以 **`httptest` 桩网关 + `t.Setenv("EQT_CONFIG_DIR", t.TempDir())` + 预置 `device_id.dat`** 让本地权威 ID 非空，用真实 HTTP 往返把客户端自愈链跑了出来：`request[0]=4bd2649bfcd4` → `request[1]=91e32745ad1c`，`total_requests=2`。**(b) 反向探针必须恢复"被修掉的那一行原文"，而非任意变体**——把门控精确恢复为 `allowSelfHeal && server.GetAuthorityDeviceID() == ""` 后，`total_requests=1`、身份不变、**FAIL**，死锁被精确复现 ⇒ 该验收用例对该修复具备判别力。**(c) 用 `httptest` + `EQT_*` 环境覆盖为"客户端不可测"的结论解套，是本线程第一次成功为客户端链建立可复现验收。**












