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
- **节点 1 (ns1.eqt.net.im)**: `128.241.227.181` (Ubuntu Linux, 53 UDP/TCP, 5380 HTTP)
- **节点 2 (ns2.eqt.net.im)**: `103.232.92.220` (Ubuntu Linux, 53 UDP/TCP, 5380 HTTP)
- **DNS 委派**:
  在 Cloudflare 上配置 `direct.eqt.net.im NS ns1.eqt.net.im` 与 `ns2.eqt.net.im`。
  全球递归 DNS 自动根据 RTT 延迟进行就近负载均衡，且具备毫秒级宕机自动故障转移（Failover）。

### 2.2 轻量服务 cmd/eqt-dns
- 基于工业级开源库 `github.com/miekg/dns` 构建，单静态二进制 (~7MB)，常驻内存仅 1.5MB~6MB。
- **A 记录解析**: 正则无状态提取 `*-*-*-*` 局域网 IPv4，瞬间返回 A 记录，抗几十万 QPS。
- **TXT 记录解析**: 处理 `_acme-challenge.direct.eqt.net.im`，用于 Let's Encrypt 证书签发与自动续期。
- **Systemd 守护配置**:
  ```ini
  [Unit]
  Description=EQT Authoritative LAN-DNS Service
  After=network.target

  [Service]
  Type=simple
  ExecStart=/usr/local/bin/eqt-dns -domain direct.eqt.net.im -listen <SERVER_IP> -port 53 -http-port 5380
  Restart=always
  RestartSec=2s
  LimitNOFILE=65535

  [Install]
  WantedBy=multi-user.target
  ```

---

## 3. ACME DNS-01 自动化签发与续期机制 (Let's Encrypt Automation)

### 3.1 签发流程
使用 `certbot` 结合自定义 Hook 脚本进行双机同步推送：
- **认证钩子 (`/etc/letsencrypt/hooks/auth-hook.sh`)**:
  ```bash
  #!/bin/bash
  # Push challenge to Node 1
  curl -s -X POST http://128.241.227.181:5380/acme/challenge -H 'Content-Type: application/json' -d "{\"value\":\"$CERTBOT_VALIDATION\", \"ttl\": 3600}"
  # Push challenge to Node 2 via SSH
  ssh -p 2234 -o StrictHostKeyChecking=no root@103.232.92.220 "curl -s -X POST http://127.0.0.1:5380/acme/challenge -H 'Content-Type: application/json' -d '{\"value\":\"$CERTBOT_VALIDATION\", \"ttl\": 3600}'"
  sleep 10
  ```
- **清理钩子 (`/etc/letsencrypt/hooks/cleanup-hook.sh`)**:
  ```bash
  #!/bin/bash
  curl -s -X DELETE "http://128.241.227.181:5380/acme/challenge?value=$CERTBOT_VALIDATION"
  ssh -p 2234 -o StrictHostKeyChecking=no root@103.232.92.220 "curl -s -X DELETE 'http://127.0.0.1:5380/acme/challenge?value=$CERTBOT_VALIDATION'"
  ```

### 3.2 证书与密钥管理安全基线
- **绝对禁止**: 切勿将 Let's Encrypt 证书私钥（`privkey.pem`）直接提交推送到公开 Git 仓库，否则触发全网扫描吊销。
- **本地缓存路径**: `~/.config/eqt/certs/`（`fullchain.pem` 与 `privkey.pem`）。

---

## 4. EQT 客户端与服务端接入规范

1. **域名转换**:
   `pkg/cert.FormatDirectDomain("192.168.0.201")` ➔ `"192-168-0-201.direct.eqt.net.im"`
2. **启用安全服务**:
   当 `cfg.Secure = true` 时，服务端自动尝试从 `~/.config/eqt/certs` 加载通配符证书；未指定 FQDN 时自动将内网 IP 转换为回环子域名；
3. **前端表现**:
   浏览器地址栏自动显示绿色安全锁 🔒，`window.isSecureContext === true`，原生流式下载零 OOM 畅通运行。
