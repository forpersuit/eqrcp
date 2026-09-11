# Google Cloud Public CA (Google Trust Services) EAB 凭证申请与配置实操手册

> **方案目标**：通过接入 **Google Trust Services (Google Public CA)** 的 RFC 8555 ACME 签发链路，从根本上突破 Let's Encrypt 对单个主域未加入 Mozilla PSL 时 **每周 50 张证书的硬性配额瓶颈**。  
> **核心优势**：
> - **突破配额瓶颈**：通过 Google Cloud 项目维度分配签发配额，突破 Let's Encrypt 对单个主域未加入 Mozilla PSL 时每周 50 张的速率限制（具体配额以 GCP 项目实际 Quotas 及配额申请为准，上线前经 Staging 真实标定）；
> - **全球原生公信信任**：GTS Root R1~R4 内置于 Windows、macOS、Linux、iOS、Android 以及 Chrome、Safari、Firefox、Edge 等所有现代操作系统与浏览器中，100% 呈现原生安全绿锁；
> - **完全免费**：Google Public CA 提供的 DV 单域/通配符证书完全免费；
> - **RFC 8555 标准兼容**：除初次注册账户时需携带一次性 EAB (External Account Binding) 外，其余 DNS-01 验证与证书签发流程与现有机制 100% 兼容。

---

## 一、 Google Cloud 控制台 3 分钟获取 EAB 凭证（无需本地安装 gcloud）

由于该操作需要绑定您的 Google Cloud 账号，您无需在本地机器或服务器安装任何软件，直接使用 Google Cloud 网页自带的 **Cloud Shell** 即可（若在本地机器执行，请确保先运行 `gcloud components install beta`）：

### 步骤 1：打开并登录 Google Cloud 控制台
1. 在浏览器中打开 [Google Cloud Console](https://console.cloud.google.com/) 并登录您的 Google 账号（例如 `leeyelon@gmail.com`）；
2. 在顶部导航栏选择或新建一个 Google Cloud 项目（如 `eqt-network` 或任意现有项目）。

---

### 步骤 2：激活 Cloud Shell（云端网页终端）
1. 点击控制台右上角导航栏的 **"Activate Cloud Shell"（激活 Cloud Shell）** 图标（命令行终端图标 `>_`）；
2. 页面底部将弹出一个已经自带 `gcloud`（含 beta 组件）且已完成认证的交互式终端窗口。

---

### 步骤 3：执行命令启用 Public CA API 并生成 EAB 密钥

在 Cloud Shell 终端中，依次复制并粘贴运行以下两条命令：

```bash
# 1. 启用 Google Public Certificate Authority 服务 API
gcloud services enable publicca.googleapis.com

# 2. 生成 External Account Binding (EAB) 凭据对（当前在 gcloud beta 组件中提供）
gcloud beta publicca external-account-keys create
```

**命令输出示例**：
```yaml
b64MacKey: a1b2c3d4e5f6... (一串 Base64URL 格式的安全密钥)
keyId: 876543210fedcba... (一串 32 字符的 Key ID)
```

> ⚠️ **安全警告与时效限制**：
> - `b64MacKey` 是敏感的 HMAC 签名密钥，**仅在生成时显示一次**，请立刻复制并妥善保存；
> - 该密钥必须在 **7 天内** 完成初次 ACME 账户注册，且该密钥仅能绑定**单一持久 ACME 账户**。一旦在 Worker 中成功注册并持久化账户私钥（`ACME_ACCOUNT_KEY`）后，该账户便永久有效，后续签发证书无需再次生成 EAB。

---

## 二、 Cloudflare Worker（云端控制面）环境变量接入

### 0. 前置依赖条件（全局 ACME 基础配置，缺失将直接 500 Fail-Loud）
切换至 Google Public CA 是对现有 RFC 8555 协议栈的增强。在配置 EAB 之前，必须确保 Cloudflare Worker 已经就绪以下基础基础设施凭证（`cert.ts:935-938` 强制断言）：
1. **`ACME_ACCOUNT_KEY` (Secret)**：Worker 的持久化 ECDSA P-256 账户私钥 JWK（GTS EAB 仅在首次创建账户时绑定此私钥，之后永久复用；若缺失直接报 500 `acme_misconfigured`）；
2. **`ACME_DNS_API_ENDPOINTS` 与 `ACME_DNS_API_TOKEN` (Vars / Secret)**：权威双机 DNS-01 质询 API 代理通道与 Bearer Token。

在上述基础配置具备后，仅需在 Cloudflare Worker 中补充配置以下 3 个 EAB 相关变量，即可将发证引擎无缝切换为 Google Trust Services：

### 1. 本地测试或配置测试环境（`wrangler.toml`）
在 `cloudflare/eqt-drm-api/wrangler.toml` 的对应环境（`[env.test.vars]` 或 `[vars]`）中指定：
```toml
# 切换为 Google Public CA 官方 ACME 目录
ACME_DIRECTORY_URL = "https://dv.acme-v02.api.pki.goog/directory"
ACME_EAB_KID = "<填入步骤 3 获取的 keyId>"
# ACME_EMAIL 可以配置为您的真实邮箱
ACME_EMAIL = "leeyelon@gmail.com"
```

### 2. 将 HMAC Key 配置为安全密钥（Wrangler Secret）
`b64MacKey` 属于敏感机密，不应硬编码提交到 Git。在 `cloudflare/eqt-drm-api/` 目录下执行：
```bash
# 测试环境配置
npx wrangler secret put ACME_EAB_HMAC_KEY --env test
# 提示输入时粘贴 b64MacKey

# 生产环境配置（待正式启用生产时）
npx wrangler secret put ACME_EAB_HMAC_KEY
# 提示输入时粘贴 b64MacKey
```

---

## 三、 工作原理与协议兼容说明

1. **JWS EAB 计算已原生落地**：  
   系统已在 `cloudflare/eqt-drm-api/src/utils/acme.ts` 中根据 **RFC 8555 Section 7.3.4** 原生实现了 Web Crypto `computeExternalAccountBinding` 算法（HMAC-SHA256 对账户 JWK 进行密码学锚定，零外部 npm 依赖）。
2. **免 525 握手失败**：  
   Google PKI 的 Anycast 端点由 Google Frontend (GFE) 直接承载，与 Cloudflare 边缘的出站 TLS 握手具备 100% 兼容性，出站请求无需走反代分流即可高速直连。
3. **双活灾备无缝切换**：  
   系统保持标准解耦：若需切回 Let's Encrypt，仅需删除 `ACME_EAB_KID` 并将 `ACME_DIRECTORY_URL` 恢复为 Let's Encrypt 目录，两套公信 CA 体系秒级热备切换。
