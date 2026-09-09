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
   - **输出示例**：`https://acme-v02.api.letsencrypt.org/acme/acct/198273645`
3. 将该真实 URI 填入第一部分问案草案的第 1.4 项。

---

### 步骤 2：访问官方申请入口并打开表单

1. 打开浏览器访问 Let's Encrypt 官方联系页面：  
   👉 [https://letsencrypt.org/contact/](https://letsencrypt.org/contact/)
2. 在页面中定位到 **"Request a Rate Limit Exemption"（申请速率限制豁免）** 模块；
3. 点击直达官方专用申请表单（通常为 Let's Encrypt 官方 Google Form 链接，或通过社区专用支持通道）。

---

### 步骤 3：逐项填报申请材料（Copy & Paste）

将本文档 **§一《官方申请表单问答草案》** 的内容逐项复制至表单对应输入框中：

1. **Your Email Address**：填写 `security@eqt.net.im` 或核心运维人员的正式企业/项目邮箱；
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

### 步骤 5：生效验收与限额突破验证（Verification）

收到批准通知后，在测试脚本或云端 Worker 中执行验收：
1. **使用被授权的同一个 ACME 账户**发起证书签发请求；
2. 为测试节点申请超过默认 50 张限额的子域名证书（例如在 1 小时内签发 60 张不同的 `<node-id>.direct.eqt.net.im` 证书）；
3. **验收标准**：
   - 第 51 张及之后的请求不再返回 HTTP 429 `rateLimited` 错误；
   - 证书全部正常签发并在自建权威 DNS 完成质询验证；
4. 归档豁免批准邮件，记录 6 个月到期时间，并在到期前评估 Mozilla PSL 的合并推进进度。

