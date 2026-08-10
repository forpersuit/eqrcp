# Paddle 商家账号注册、KYB 企业认证与合规开通指南 (IMPORTANT)

> **文档定位**：本文档为 EQT DRM 商业化结算体系中 Paddle 账号注册、企业/个人身份选择、KYB 审核解冻、域名合规及资金回国结汇的完整 SOP 与技术决策依据。

---

## 1. 账号注册类型选择分析：公司 (Company) vs 个人 (Individual)

当具备国内公司主体并拥有“技术进出口”和“货物进出口”经营范围时，**强烈建议使用公司 (Company) 身份注册 Paddle 账号**。

### 1.1 核心维度对比分析 (第一性原理)

| 评估维度 | 公司注册 (Company) — **推荐 ⭐️⭐️⭐️⭐️⭐️** | 个人注册 (Individual) — **不推荐 ❌** |
| :--- | :--- | :--- |
| **1. 资金回国与外汇** | **无额度限制**。可凭结算单据通过企业版跨境支付工具（Payoneer / LianLian / PingPong）或电汇合法结汇至国内对公账户。 | **受外管局每年 5 万美元结汇上限限制**。大额个人外汇入境会被抽查合规来源，难以说明合理性。 |
| **2. 税务合规与免税** | **享受软件/技术服务出口免增值税优惠**。凭经营范围与 Paddle 结算对账单可依法做**增值税零税率/免税申报**。 | 个人收款易构成“公私不分”或“隐匿收入”，存在个人所得税追缴风险，且公司的服务器与研发成本无法抵扣。 |
| **3. 风控与审核通过率** | **信任度高、不易触发风控**。Paddle 对具备营业执照及软件进出口经营范围的企业账号信任度极高，更容易快速通过审核。 | 个人账号防洗钱 (AML) 风控极严，交易量增大后极易触发二次审核或要求补交业务合法性证明。 |
| **4. 额度与长期拓展** | 无提现与交易额度限制，支持公对公 Wire Transfer 及企业支付通道。 | 交易额度受限，后期交易量上升后 Paddle 会主动要求强制升级/迁移为公司账号。 |
| **5. 主体迁移成本** | **一步到位**。账号属于公司无形资产，未来团队扩大、融资或架构变更均不受影响。 | **不支持直接更改名字迁移为公司**，后期若想换公司必须重新注册并重新走全套域名审核。 |

---

## 2. Paddle 平台账号 KYB 认证操作细节

在 Paddle 后台（Vendors Dashboard）填写 **Account Details (Company)** 时的填写规范：

### 2.1 主体基础信息 (Business Details)
- **Account Type**: 选择 `Company / Corporation`。
- **Company Legal Name**: 填写营业执照上的英文名称（若无官方英文名，使用规范的拼音翻译，如 `Shenzhen EQT Technology Co., Ltd.`）。
- **Company Registration Number**: 填写入营业执照上的 **18 位统一社会信用代码**。
- **Tax ID / VAT Number**: 国内公司此项可填信用代码或留空（除非已申请国际 VAT 号码）。
- **Legal Address**: 按照营业执照注册地址翻译为英文/拼音填写（包含国家、省份、城市、街道及邮编）。

### 2.2 业务与产品问卷 (Compliance Questionnaire)
- **Business Category**: 勾选 `Software` / `SaaS` / `Digital Goods`。
- **Product Description**: 简要说明销售的产品（示例：*EQT is a high-performance cross-platform file transfer and management software. We sell digital license codes for full-version software authorization.*）。
- **Customer Support Email**: 填写对外公开的客服邮箱（如 `support@eqt.net.im`）。

### 2.3 补充资质文件准备 (按需上传)
若 Paddle 风控系统要求补充上传身份与主体证明，需准备以下高清电子版文件：
1. **营业执照扫描件** (Certificate of Incorporation / Business License)。
2. **法人代表身份证明** (Legal Representative Passport or ID Card)。
3. **公司地址证明** (Proof of Business Address，如近 3 个月内的银行对账单或公用事业账单)。

---

## 3. 域名审核 (Checkout Domain Review) 快速解冻 Checklist

在 Paddle Dashboard 的 **Checkout -> Domain Settings** 提交域名（如 `eqt.net.im`）后，域名状态会处于 `pending_review`。请按以下 Checklist 确认网站部署情况以确保快速通过：

### 3.1 域名审查必备项 (Pass Criteria)
- [x] **公网可访问**：域名必须解析到真实的生产服务器，不能有密码锁、不能返回 404 或 `Under Construction`。
- [x] **明码标价**：网站页面（如 `pricing.html`）必须清晰展示商品介绍与对应价格（例：`$29.9 Lifetime` / `$9.9/year`）。
- [x] **合规三件套 (Legal Pages)**：页脚 (Footer) 必须包含以下 3 个独立页面的链接：
  - **服务条款 (Terms of Service)** (`terms.html`)
  - **退款政策 (Refund Policy)** (`refund.html`)：明确退款期限与条件（如 14 天/30 天无条件退款）。
  - **隐私政策 (Privacy Policy)** (`privacy.html`)
- [x] **客服联系方式**：页脚或 Contact 页面须写明客服电子邮箱（如 `support@eqt.net.im`）。
- [x] **Paddle MoR 声明**：在服务条款或页脚中写明名义商家声明：
  > *"Our order process is conducted by our online reseller Paddle.com. Paddle.com is the Merchant of Record for all our orders."*

---

## 4. 资金合规回国与税收申报链路设计

基于中国外汇管理与税务规则，通过 Paddle MoR 收取的海汇资金回国完整闭环如下：

```
[海外客户下单付款] ──► [Paddle (扣除 MoR 佣金 & 代缴当地消费税/VAT)]
                             │
                             ▼
                 [Paddle 结算打款 (USD/EUR)]
                             │
                             ▼
      [第三方跨境支付企业版账户 (如 Payoneer / LianLian / PingPong)]
                             │
                             ▼
     [凭 Paddle Monthly Statement 结算单做技术出口合规结汇]
                             │
                             ▼
        [人民币资金直接进入国内公司对公账户] ──► [公司财务做增值税免税/零税率申报]
```

### 4.1 财务与税务注意事项
1. **凭证留存**：每月下载 Paddle 出具的 **Payout Statement / Monthly Revenue Statement**，作为海汇收入的合法对账凭证。
2. **免税申报**：凭经营范围中的“技术进出口”及海汇结汇水单，向税务部门办理数字服务技术出口的增值税零税率或免税备案。

---

## 5. 工程参数配置与上线部署清单

域名 `approved` 且 KYB 通过后，在当前工程中完成以下参数切换：

1. **前端价格页 [`cloudflare/eqt-website/pricing.html`](../cloudflare/eqt-website/pricing.html)**：
   ```javascript
   const PADDLE_ENV = "production";
   const PADDLE_TOKEN = "live_xxxxxx";              // 生产 Client-Side Token
   const PRICE_LIFETIME_ID = "pri_01xxxxxx";        // 生产 Lifetime Price ID
   const PRICE_YEARLY_ID = "pri_01xxxxxx";          // 生产 Yearly Price ID
   ```
2. **后端 DRM 服务 [`cloudflare/eqt-drm-api/src/types.ts`](../cloudflare/eqt-drm-api/src/types.ts)**：
   - 同步更新 `PRICE_LIFETIME_ID` 和 `PRICE_YEARLY_ID` 常量。
3. **Cloudflare Worker 秘钥配置**：
   ```bash
   cd cloudflare/eqt-drm-api
   echo -n "pdl_ntfset_xxxxxx" | npx wrangler secret put PADDLE_WEBHOOK_SECRET
   echo -n "pdl_xxxxxx" | npx wrangler secret put PADDLE_API_KEY
   npx wrangler deploy
   ```
4. **后台真探针验收**：
   - 访问 `https://lic.eqt.net.im/admin/` 进入 System Health 页面，确认 **Paddle API Probe** 显示为 `api_reachable` (200 OK)。
