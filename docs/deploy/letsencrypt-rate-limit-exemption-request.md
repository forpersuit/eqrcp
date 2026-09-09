# Let's Encrypt 官方 Rate Limit 豁免申请表单与技术说明书

> **申请目标**：向 Let's Encrypt 提交官方 [Rate Limit Exemption Request](https://letsencrypt.org/contact/) 表单。  
> **核心诉求**：申请将主域名 `eqt.net.im` / `direct.eqt.net.im` 的证书签发速率限制由默认的 50 张/周，临时提升至 **20,000 张/周**，以保障 Mozilla Public Suffix List (PSL) 审查窗口期（1~3 个月）内，公网新设备单机专属 TLS 证书置备与平滑演进不受中断。

---

## 一、 官方申请表单问答草案

### 1. Basic Information
- **Contact Email**: security@eqt.net.im / forpersuit@gmail.com
- **Organization / Project Name**: EQT Project (https://eqt.net.im)
- **Primary Domain**: `direct.eqt.net.im` (parent: `eqt.net.im`)
- **ACME Account ID / URI**: `https://acme-v02.api.letsencrypt.org/acme/acct/XXXXX`

### 2. Requested Limits & Timeline
- **Requested Certificates per Registered Domain**: 20,000 per week
- **Requested New Orders per 3 Hours**: 1,000 per 3 hours
- **Expected Duration**: 6 months (covering the transition period until Mozilla PSL PR is merged and deployed across WebPKI ecosystems)

### 3. Architecture & Technical Overview
- **Why do you need this exemption?**:
  EQT is an open-source decentralized local file transfer system (GitHub: `forpersuit/eqrcp`). To safeguard users against LAN MITM eavesdropping without sharing a single wildcard private key among untrusted devices, EQT adopts a zero-leak per-device ACME architecture:
  - Every user machine generates its own ECDSA P-256 private key locally on install (the private key never leaves the physical machine).
  - A cloud gateway (`lic.eqt.net.im`) acts as an ACME DNS-01 proxy to write TXT challenges to our authoritative DNS servers (`ns1.eqt.net.im` / `ns2.eqt.net.im`).
  - Let's Encrypt issues a dedicated certificate for `*.<node-id>.direct.eqt.net.im`.
- **Pre-flight & Quality of Service Guarantees**:
  - **Pre-flight Self-Checks**: Our proxy verifies TXT record propagation locally before triggering ACME challenges, ensuring near-zero validation failures.
  - **Renewal Window**: Devices renew certificates strictly during the 30-day window before expiration, preventing duplicate and burst orders.
  - **Public Suffix List Plan**: A formal submission to the Mozilla PSL PRIVATE section is being submitted concurrently. This rate limit exemption serves as a reliable buffer to guarantee seamless user onboarding during community review.

### 4. Incident Response & Revocation Policy
- All certificate issuance requests are authenticated via hardware-bound cryptographic signatures.
- If a security incident occurs, revocation will be executed through the Cloudflare Worker orchestration gateway within 4 hours.
