# 权威 DNS 双机部署、ACME 容灾与系统集成参考手册 (Authoritative DNS & ACME Ops Reference)

本参考文档包含 EQT LAN-TLS 双机权威 DNS 运维、Systemd 守护配置、Let's Encrypt 账户三地容灾及 GUI/移动端代理穿透的完整实物细节。

---

## 1. 权威 DNS 双机灾备与负载均衡规范 (RFC 1035 NS Delegation)

### 1.1 节点架构
- **节点 1 (ns1.eqt.net.im)**: `128.241.227.181` (Ubuntu Linux, 53 UDP/TCP, 127.0.0.1:5380 HTTP)
- **节点 2 (ns2.eqt.net.im)**: `103.232.92.220` (Ubuntu Linux, 53 UDP/TCP, 127.0.0.1:5380 HTTP)
- **安全基准**：HTTP 管理端口强行锁定在 `127.0.0.1:5380`，仅限本地或 SSH 安全通道调用，严禁公网开放！

### 1.2 Systemd 守护配置
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

### 1.3 ACME 账户异地容灾与故障转移 (ACME Account High Availability & Failover)
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

## 2. ACME DNS-01 自动化签发与续期机制 (Let's Encrypt Automation)

### 2.1 签发流程
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

### 2.2 证书与密钥管理安全基线
- **绝对禁止**: 切勿将证书私钥（`privkey.pem`）直接提交推送到公开 Git 仓库，否则触发全网扫描吊销。
- **本地缓存路径**: 统一遵循 `config.DefaultCertsDir()` 规范（Windows 为 `%APPDATA%\eqt\certs\`，Linux 为 `~/.config/eqt/certs/`；设备专属证书存放在 `<node-id>/` 子目录下）。
- **客户端同步工具**: 执行 `bash scripts/sync-certs-from-vps.sh` 从权威节点一键同步证书至本地，并自动分发至 Windows 宿主 `%APPDATA%\eqt\certs`。
  - 支持通过环境变量 `EQT_WIN_USER=<username>` 显式指定具体 Windows 目标用户（默认单用户隔离）；
  - Windows 侧 NTFS DACL 权限收紧：可在 Windows 侧执行 `icacls "%APPDATA%\eqt\certs\privkey.pem" /inheritance:r /grant:r "%USERNAME%:(R)"` 显式收紧私钥读取权限。

### 2.3 权威委派与 Cloudflare 代理红线
- **必须灰云 (DNS-only)**: 在 Cloudflare 面板中，`ns1.eqt.net.im` 与 `ns2.eqt.net.im` 两条 A 记录**必须保持 DNS-only（灰云图标）**，严禁开启 Cloudflare Proxy（橙云）。若误开橙云会导致权威 NS 解析至 CF Anycast 边缘，造成 RFC 1035 委派链路断裂，公共 DNS 递归失败。

---

## 3. 桌面端 GUI 与网络环境细节

### 3.1 WebView2 系统代理拦截防护与 CSP 规范
- **代理穿透**：Windows 系统开启系统代理（如本地 Clash/V2Ray `127.0.0.1:10808`）时，WebView2 内核会无差别拦截外部顶级域名（包括 `.im`），导致访问 `*.direct.eqt.net.im` 本地回环时挂起或被代理拒绝。必须在启动前通过环境变量 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 追加 `--proxy-bypass-list=<local>;127.0.0.1;localhost;*.lan.eqt.im;*.direct.eqt.net.im;10.*;192.168.*;172.16.*;…;172.31.*`（`desktop/gui/main.go:285`），或追加 `--no-proxy-server`（直连模式）强制绕过代理。
- **CSP 策略**：Wails `AssetServer.Middleware` 的 `Content-Security-Policy` 中 `connect-src` 必须显式包含 `https://*.direct.eqt.net.im:* ws: wss:`，防止内嵌 iframe 或外部网络通道被浏览器策略阻断。

### 3.2 移动端代理拦截与直连分流准则
- **现象与成因**：移动端（iOS / Android）开启代理应用时，由于 `*.direct.eqt.net.im` 后缀为曼岛顶级域名（`.im`），绝大多数公网分流规则集默认将其判定为境外域名或未知域名，导致流量被分流给境外代理节点，或在 TUN 模式下被劫持分配 Fake-IP（`198.18.0.0/16`）。境外代理节点无法路由回用户局域网私有 IP，造成扫码访问彻底超时失败。
- **应对方案**：在各分流工具中将 `direct.eqt.net.im` 加入 DIRECT 直连规则与 fake-ip-filter 避开劫持。
