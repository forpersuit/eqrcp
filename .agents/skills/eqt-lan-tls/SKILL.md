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

