# Public Suffix List (PSL) 社区申报材料与 PR 模板

> **申报目标**：将 `direct.eqt.net.im` 收录入 Mozilla [Public Suffix List](https://publicsuffix.org/) 的 **PRIVATE** 分区。  
> **核心诉求**：使每个设备专属子域名 `<node-id>.direct.eqt.net.im` 被各大浏览器、操作系统及公信 CA（如 Let's Encrypt）判定为独立的有效顶级注册域（eTLD+1），彻底解除单注册域每周 50 张证书的限额，为数百万台 EQT 局域网设备的单机专属证书铺平道路。

---

## 一、 Mozilla PSL PR 提交内容草案

### 1. PR 标题
`Add direct.eqt.net.im to PRIVATE section`

### 2. PR 描述正文（Markdown）

```markdown
### Submitter Information
- **Organization**: EQT Project / ForPersuit
- **Contact Email**: security@eqt.net.im / forpersuit@gmail.com
- **Website**: https://eqt.net.im
- **Source Code Repository**: https://github.com/forpersuit/eqrcp

### Domain Information
- **Domain**: `direct.eqt.net.im`
- **Section**: PRIVATE
- **WHOIS Verification**: Domain `eqt.net.im` is registered and controlled by the submitter organization.

### Technical Justification & Architecture
EQT (Easy Quick Transfer) is an open-source, peer-to-peer local network data transfer application.
To guarantee end-to-end security without sharing private keys, EQT assigns a deterministic, hardware-isolated subdomain to each peer instance:
`*.<node-id>.direct.eqt.net.im`

- **Wildcard Resolution**: An authoritative DNS cluster (`ns1.eqt.net.im` / `ns2.eqt.net.im`) dynamically resolves dotted/dashed local IPs (e.g., `192-168-1-50.<node-id>.direct.eqt.net.im` -> `192.168.1.50`).
- **ACME Certificates**: Each peer node independently generates its own ECDSA private key locally (zero private key leakage) and obtains standard X.509 TLS certificates via ACME DNS-01 challenges.
- **Why PSL is Required**: Without inclusion in the PSL, all `<node-id>.direct.eqt.net.im` subdomains are grouped under `eqt.net.im`, hitting Let's Encrypt rate limits (50 certificates per week per registered domain). Inclusion under the PRIVATE section ensures that `<node-id>.direct.eqt.net.im` is treated as a separate administrative domain boundary, matching the exact precedents set by `ts.net` (Tailscale), `plex.direct` (Plex), and `duckdns.org`.

### Verification Steps
1. Query NS for `direct.eqt.net.im`:
   ```sh
   dig NS direct.eqt.net.im +short
   # ns1.eqt.net.im.
   # ns2.eqt.net.im.
   ```
2. Query loopback resolution:
   ```sh
   dig A 192-168-1-100.a1b2c3d4e5f6.direct.eqt.net.im @ns1.eqt.net.im +short
   # 192.168.1.100
   ```
```

### 3. `public_suffix_list.dat` 文件 Patch 变更

在 `public_suffix_list.dat` 的 `===BEGIN PRIVATE DOMAINS===` 部分追加：

```text
// EQT : https://eqt.net.im
// Submitted by ForPersuit <security@eqt.net.im>
direct.eqt.net.im
```

---

## 二、 申报核验清单 (Submission Checklist)

- [x] 权威 DNS 双机高可用在位（`ns1.eqt.net.im: 128.241.227.181`，`ns2.eqt.net.im: 103.232.92.220`）；
- [x] DNS 权威服务器对两级回环子域名 `192-168-x-x.<node-id>.direct.eqt.net.im` 的 A 记录查询具备原生解析能力；
- [x] DNS-01 `_acme-challenge.<node-id>.direct.eqt.net.im.` TXT 质询记录应答能力已在位；
- [x] 域名所有权及专用安全联系邮箱配置完毕；
- [ ] 发起 GitHub PR 流程并跟踪 Mozilla 社区人工审核进展（预期 1~3 个月）。
