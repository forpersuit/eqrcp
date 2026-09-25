# Let's Encrypt 官方 Rate Limit 豁免申请表单与技术说明书

> **状态**：✅ **官方审核已批准并部署生效 (Approved & Deployed)**  
> **生效时间**：2026-09-25（由 ISRG 平台团队邮件确认）  
> **审批结果**：  
> - **Rate Limit Type**: `Certificates per Registered Domain`  
> - **绑定账户**: `https://acme-v02.api.letsencrypt.org/acme/acct/3704177676`  
> - **生效新限额 (New Limit)**: **`10,000+ 20000`**（原 50 张/周提升至 20,000~30,000 张/周）  
> - **适用域**: `*.direct.eqt.net.im` / `direct.eqt.net.im`  
> **核心诉求**：保障 Mozilla Public Suffix List (PSL) 审查窗口期内，公网新设备单机专属 TLS 证书置备与平滑演进不受中断。

---

## 一、 官方申请表单问答草案

### 1. Basic Information
- **Contact Email**: leeyelon@gmail.com
- **Organization / Project Name**: EQT Project (https://eqt.net.im)
- **Primary Domain**: `direct.eqt.net.im` (parent: `eqt.net.im`)
- **ACME Account ID / URI**: `https://acme-v02.api.letsencrypt.org/acme/acct/3704177676`

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

---

## 二、 完整实操步骤指南（Step-by-Step Execution Runbook）

向 Let's Encrypt 申请配额豁免是全免费的，由非营利组织 ISRG（Internet Security Research Group）人工审批。整个申请与生效流程分为以下 5 个标准步骤：

### 步骤 1：前置准备——获取生产环境 ACME 账户 URI（Account URI）

> ⚠️ **关键前提**：Let's Encrypt 的速率豁免**不是直接绑定裸域名，而是严格绑定到您的「ACME 生产账户 URI」+ 域名**。若没有提供真实的 Account URI，申请会被直接退回。

1. **登录您的云端代理网关或证书申请机器（VPS / 服务器）**；
2. **提取或创建正式生产环境 ACME 账户**：
   - **如果使用 Certbot**，运行以下命令提取账户 URI：
     ```bash
     grep -o 'https://acme-v02.api.letsencrypt.org/acme/acct/[0-9]*' /etc/letsencrypt/accounts/acme-v02.api.letsencrypt.org/directory/*/regr.json
     ```
   - **如果使用 Lego（Go 语言官方客户端）**：
     ```bash
     # 查看 accounts 目录下的 account.json
     cat ~/.lego/accounts/acme-v02.api.letsencrypt.org/*/account.json | grep -o 'https://acme-v02.api.letsencrypt.org/acme/acct/[0-9]*'
     ```
   - **实际账户（已从 ns1 自动提取）**：`https://acme-v02.api.letsencrypt.org/acme/acct/3704177676`
3. 将该真实 URI 填入第一部分问案草案的第 1.4 项。

---

### 步骤 2：访问官方申请入口并打开表单

1. 官方申请专用入口（ISRG Formstack）：  
   👉 [https://isrg.formstack.com/forms/rate_limit_adjustment_request](https://isrg.formstack.com/forms/rate_limit_adjustment_request)  
   *(官方文档来源：[Let's Encrypt Rate Limits Documentation](https://letsencrypt.org/docs/rate-limits/#new-certificates-per-registered-domain))<br>
2. 打开后点击 **"Begin Application"** 启动 11 步多页向导表单。

---

### 步骤 3：逐项填报申请材料（Copy & Paste）

将本文档 **§一《官方申请表单问答草案》** 的内容逐项复制至表单对应输入框中：

1. **Your Email Address**：填写 `leeyelon@gmail.com`；
2. **Organization / Project**：填写 `EQT Project (https://eqt.net.im)`；
3. **Domain(s) Needing Exemption**：填写 `direct.eqt.net.im`（同时注明父域 `eqt.net.im`）；
4. **ACME Production Account ID/URI**：粘贴步骤 1 获取的生产账户 URI；
5. **Which limit do you need raised and to what value?**：
   - 选择并填写：*Certificates per Registered Domain: 20,000 per week*；
   - *New Orders: 1,000 per 3 hours*；
6. **Detailed Explanation / Architecture**：
   - 完整粘贴 §一.3 的架构阐述（强调“去中心化局域网传输”、“客户端本地自生成私钥零泄露”、“自建双机权威 DNS 提供 DNS-01 验证”、“同步申请 Mozilla PSL 中”）；
7. **Mitigation of Failures & Anti-Abuse**：
   - 强调已实施 Pre-flight 本地探测与 30 天自动续约窗口，杜绝向 Let's Encrypt 发送无效或突发风暴请求；
8. 点击 **Submit（提交）**。

---

### 步骤 4：邮件沟通与技术答辩（预计 1 ~ 3 周）

1. **自动回执**：提交后，您的联系邮箱会在 10 分钟内收到一封确认邮件（包含 Case / Ticket 编号）；
2. **人工复核质询**：
   Let's Encrypt 工程师（通常来自 ISRG 平台团队）可能会通过邮件回复 1~2 个技术问题，常见问题及标准应答口径如下：
   - **问**：*你们为什么不能使用单张通配符证书？*  
     **答**：*如果使用单张通配符，就必须把私钥复制分发给全网所有终端设备，造成严重的私钥泄露风险与同网 MITM 攻击；我们坚持单机单私钥零扩散。*
   - **问**：*你们是否有加入 Public Suffix List 的计划？*  
     **答**：*是的，我们已经正式起草了 Mozilla PSL 申报材料（附带 PR 链接），本豁免是审核生效前的过渡方案。*
3. **批准通知**：审核通过后，您将收到官方发来的确认邮件：  
   `"Your Rate Limit Exemption Request for direct.eqt.net.im has been approved. The new limits are now active on your ACME Account."`

---

### 步骤 5：生效验收与密码学适配落地（Verification & Deployment）

1. **官方审批邮件确认（已闭环 ✅）**：
   - **时间**：2026-09-25 05:38 GMT
   - **发件方**：ISRG / Let's Encrypt Review Team
   - **审批内容**：
     - *Rate Limit Type*: Certificates per Registered Domain
     - *Registration ID*: `https://acme-v02.api.letsencrypt.org/acme/acct/3704177676`
     - *New Limit*: `10,000+ 20000`（提升至 20,000~30,000 张/周）
     - *部署状态*: 已在全球边缘部署生效（"We have approved and deployed the following rate limit adjustment that you requested."）

2. **密码学与工程适配落地（已闭环 ✅）**：
   - **RSA JWK 导入与 RS256 原生支持**：Cloudflare Worker (`cloudflare/eqt-drm-api`) 中的 `AcmeClient` 已扩展支持 RSA-2048 账户密钥（`kty: RSA`），签名算法自动切换为 `RS256`（`RSASSA-PKCS1-v1_5` + `SHA-256`）；
   - **RFC 7638 RSA Thumbprint 标准计算**：按标准字典序（`e`, `kty`, `n`）计算 SHA-256 摘要，准确导出 DNS-01 TXT 验证值；
   - **生产账户 URI 强绑定 (`kid`)**：通过环境变量 `ACME_LE_ACCOUNT_URL` 将 JWS 请求头中的 `kid` 严格锚定至 `https://acme-v02.api.letsencrypt.org/acme/acct/3704177676`，跳过冗余 `newAccount` 探测并杜绝临时账户导致配额回退；
   - **离线门禁验收通过**：`test:acme:offline`（T5.1~T5.6）及 `test:cert:offline`（T25.6）自动化断言 100% 通过。

