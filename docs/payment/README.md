# EQT 支付与授权系统文档目录 (Payment & Licensing Documentation)

本目录集中整理了 EQT（Easy QR Transfer）项目在支付集成、购买流程、收银台验证、授权码加密及安全风险防范相关的核心技术文档与架构指南。

---

## 文档列表 (Documentation Index)

1. **[安全风险与漏洞分析 (Payment & Purchase Flow Risk Analysis)](security-risks-analysis.md)**
   - 详细分析网页购买流程的潜在漏洞（如收银台邮箱二次篡改、前端直接唤起收银台、Webhook 伪造与爆破防范）及应对防御机制。

2. **[购买流程与 E2E 验证规范 (Purchase Flow & E2E Verification)](purchase-flow.md)**
   - 记录结账前强制邮箱验证（Pre-Checkout Email Verification）、Paddle 收银台集成与时序图，以及 Chrome MCP 自动化全流程实测日志。

3. **[Paddle 支付系统集成指引 (Paddle Payment Integration)](paddle-payment.md)**
   - 包含从 Sandbox 到 Production 环境配置、Price ID、Client Token 替换以及密钥防护指南。

4. **[DNS 域名解析与支付域名配置 (DNS & Payment Setup)](dns-and-payment-setup.md)**
   - 记录 `lic.eqt.net.im` API 域名与 Cloudflare Worker / Custom Domain 解析与支付网关配置。

5. **[许可授权机制架构 (Licensing Architecture)](licensing-architecture.md)**
   - EQT 离线密码学激活码生成算法、硬件指纹提取与云端授权绑定设计。

6. **[DRM 流程与机制 (Current DRM Flow)](drm-flow.md)**
   - 当前生产实现的激活、离线证书、在线对账、tier 同步、吊销、GUI 状态与测试运维说明。

7. **[双重过期机制设计 (Licensing Double Expiration)](licensing-double-expiration.md)**
   - 记录按年订阅与终身买断的到期与网络时间防篡改校验机制。

8. **[许可套餐层级分析 (License Tier Analysis)](license-tier-analysis.md)**
   - Free / Plus Yearly / Plus Lifetime 等套餐功能的差异化设计与限制策略。

9. **[许可实现路线图 (Licensing Implementation Plan)](licensing-implementation-plan.md)**
   - 授权系统模块化的开发路线图与历史演进阶段。

10. **[套餐层级设计 (Tier Design)](tier-design.md)**
   - 商业化定价与套餐限制的详细设计。

用户自助 Portal（查授权 / 解绑 / 退款）文档见 **[`docs/portal/`](../portal/README.md)**。

---

## 相关：运维管理后台

用户自助 Portal 之外的 **Admin 控制台**（发码、吊销、错误审计）文档在 [`docs/admin/`](../admin/README.md)，工程在 `cloudflare/eqt-admin/`。

---

## 维护规范 (Maintenance Guidelines)

- 所有新增的支付网关、Webhook 处理逻辑或授权漏洞修复，必须同步在此目录更新相关文档。
- 敏感配置（如 Paddle 密钥、SMTP 密码、D1 私钥等）严禁写入文档，仅能在 Cloudflare Secrets 或环境变量中管理。
