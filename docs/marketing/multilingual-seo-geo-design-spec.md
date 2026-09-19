# EQT 官网多语种 SEO/GEO 深度适配与最新功能对齐落地设计规范 (Multilingual SEO & GEO Architecture Spec)

> **版本**：v1.1 (已吸收工程与架构审查审查意见修订通过)  
> **文档属性**：官方站点多语种 SEO、GEO、最新功能对齐与 Cloudflare Pages 静态工程架构落地规范  
> **状态**：审查通过 (Approved with Engineering Review Enhancements)

本文档系统阐述 EQT (Easy QR Transfer) 官方站点针对**全球多语种市场**的传统搜索引擎优化 (SEO)、生成式 AI 引擎优化 (GEO)、以及与**近期提交的重大核心功能**全面对齐的工程架构落地设计方案。

---

## 1. 背景与核心问题诊断 (First-Principle Root Cause Analysis)

### 1.1 现状与致命痛点
当前官方站点（代码位于 `cloudflare/eqt-website`）虽然维护了 7 国语言（英、中、日、韩、西、德、法）的词条字典，但在公域搜索引擎与 AI 检索生态中存在三大结构性断层：

1. **多语种在搜索引擎与 AI 爬虫中完全隐形**：
   - 现网采用纯客户端 JavaScript 动态替换机制（`index.html` 源码默认为英文，加载后由前端脚本根据 Cookie/LocalStorage 修改 DOM）。
   - Googlebot、Bingbot、百度蜘蛛以及 Perplexity/GPT 检索爬虫均以**无状态、无 Cookie** 的方式发起匿名请求，且绝大多数不执行客户端 DOM 替换脚本。
   - Cloudflare Pages 中间件检测 `CF-IPCountry` 时，因主流爬虫节点多部署于欧美数据中心，爬虫被一律分发英语页面。
   - **后果**：非英语母语用户（中/日/韩/德/法/西）在 Google 或 AI 搜索中用母语搜索相关需求时，EQT 的收录率与召回率为 **0%**。
2. **直接违反 Google 多语言国际化规范 (Google i18n Search Guidelines)**：
   - Google 官方明令禁止“仅通过 Cookie 或 IP 识别在单一 URL 上提供多语言内容”。
   - 官方准则要求：**不同语言必须拥有独立的唯一 URL 路径**（如 `/zh/`、`/ja/`），且必须在 `<head>` 中配置双向 `hreflang` 映射声明。
3. **最新提交的重要功能与高价值搜索心智严重脱节**：
   - **标准端口 (80/443) 首选与自动降级**（Commit `1dcc9524`）：消除手机扫码 URL 中的非标端口号、穿透企业防火墙阻断。官网全文提及率为 0。
   - **Android 跨端全场景正式确立**（Commit `8116d6bd`）：Campaign C2 已明确将 Android 与 iOS 并列，但官网代码全站无 `Android` 关键词。
   - **AirDrop 跨生态替代品心智**（Campaign C2 全案）：高搜索量意图词（如 "AirDrop for Windows", "AirDrop alternative"）在官网完全缺失。
   - **移动端 0 安装 Web Chat 深度体验优化**（后台防断连、键盘自适应、弹性视口）：官网缺乏场景化承接。
   - **缺失现代 GEO 核心资产 `/llms.txt` 与 Schema.org JSON-LD 结构化数据**。

---

## 2. 总体架构设计：静态预渲染与物理子路径体系 (Static Pre-rendering & Physical Routing)

遵循 **Simplicity First（简单至上）** 原则，不引入沉重复杂的全栈 SSR 框架（如 Next.js/Nuxt），在现有的纯静态 Cloudflare Pages 架构上，通过轻量级构建脚本生成独立的物理子目录：

```
[构建期: scripts/build-i18n.js]
  │
  ├── 1. 强制绝对根路径手术 (href/src 统一加上 /，避免子目录 404 陷阱)
  ├── 2. 读取 index.html 模板 & translations 字典
  ├── 3. 静态预渲染各语言文本到真实 HTML DOM (纯静态直出，TTFB < 50ms)
  ├── 4. 注入对应语言专属 Meta、hreflang 互联声明、合规的 JSON-LD
  └── 5. 输出物理子目录:
        cloudflare/eqt-website/
          ├── index.html        (默认英文 en，canonical & x-default)
          ├── zh/index.html     (简体中文原生静态页，lang="zh")
          ├── ja/index.html     (日文原生静态页，lang="ja")
          ├── ko/index.html     (韩文原生静态页，lang="ko")
          ├── de/index.html     (德文原生静态页，lang="de")
          ├── fr/index.html     (法文原生静态页，lang="fr")
          └── es/index.html     (西班牙文原生静态页，lang="es")

[运行期: Cloudflare Pages Edge & Client]
  │
  ├── 访问各物理子路径 (/zh/, /ja/) ──> 纯静态直出 (爬虫100%抓取对应母语文本，锁定语言上下文)
  ├── 访问根路径 / ──> 纯静态英文直出；若检测到中文IP且未设偏好，客户端提供轻量软性横幅 (Soft Suggestion)
  └── 访问 /llms.txt ──> 纯文本 Markdown 机器知识库 (提供中英核心产品能力与问答)
```

---

## 3. 关键工程陷阱防范与修正机制 (Hardened Engineering Safeguards)

经工程与架构审查，必须在代码实施中贯彻以下硬性防范准则：

### 3.1 P0 级陷阱：全站资源绝对根路径化（杜绝子目录 404 崩溃）
现网模板中若使用相对路径（如 `assets/favicon.png`、`js/api-base.js`、`portal.html`），在 `/zh/` 下会被解析为 `/zh/assets/...`，导致图标、图片、核心脚本与外链全线 404 瘫痪。
* **强制修复规范**：
  1. 所有 HTML 资源标签统一加上前导正斜杠：
     - `<link rel="icon" href="/assets/favicon.png" type="image/png"/>`
     - `<img src="/assets/favicon.png" .../>`
     - `<img src="/assets/app-chat.png" .../>`
     - `<script src="/js/api-base.js"></script>`
     - 导航与外链统一修正为绝对根路径：`href="/portal.html"`、`href="/pricing.html"`。
  2. 内联 JS 脚本（如 `galleryData`）中的静态图片路径统一加上根斜杠：`src: "/assets/app-chat.png"`。
* **构建断言防回归 (Fail-Loud Gate)**：
  构建脚本输出后，必须执行自动检测：扫描所有 HTML 产物，若匹配到 `(href|src)="assets/` 或 `(href|src)="js/` 等无根斜杠的相对路径，立即抛出致命异常并中断构建，禁止带病上线。

### 3.2 P0 级陷阱：重构语言下拉框为“确定性物理路由导航”
禁止在多子路径环境下仅就地刷写 DOM，否则会导致 URL 与实际语言错乱、客户端根据系统语言暴力覆盖用户访问等问题。
* **强制修复规范**：
  1. **点击下拉框直接跳转物理 URL**：
     ```javascript
     langDropdownPanel.querySelectorAll('button[data-lang]').forEach(btn => {
         btn.addEventListener('click', (e) => {
             const targetLang = btn.getAttribute('data-lang');
             localStorage.setItem('eqt-lang', targetLang);
             document.cookie = `eqt-lang=${targetLang}; path=/; max-age=31536000; SameSite=Lax`;
             
             // 物理 URL 导航并保留当前锚点
             const hash = window.location.hash || '';
             const targetPath = targetLang === 'en' ? '/' : `/${targetLang}/`;
             if (window.location.pathname !== targetPath) {
                 window.location.href = targetPath + hash;
             }
         });
     });
     ```
  2. **构建期直接烧录语言指示文案**：
     在生成 `zh/index.html` 时，预渲染引擎直接输出 `<span id="current-lang-txt">简体中文</span>`，无需客户端跳变。
  3. **子目录静态页面强制锁定语言**：
     在 `/zh/` 物理页面中，前端脚本判定处于该子路径时，**禁止**读取 `navigator.language` 去篡改当前 DOM，彻底杜绝内容闪烁 (FOUC) 与误重置。

### 3.3 P1 级陷阱：规避 Google 结构化数据违规风险
* Google 官方《通用结构化数据指南》严厉禁止“幽灵数据”（Invisible Content）。若页面没有可视化的 FAQ 手风琴/卡片，内嵌 `FAQPage` JSON-LD 会被算法标记为作弊（Spammy Structured Markup），危及整站权重。
* **阶段化落地**：
  - **当前阶段**：仅注入 Google 官方标准完全合规的 `SoftwareApplication` + `Offer` 实体（明确声明产品名称、支持平台、定价与货币）。
  - **下一阶段**：待官网后续正式上线可视化 FAQ 组件后，再同步注入 `FAQPage` 结构化数据。

### 3.4 P1 级陷阱：边缘中间件精简与 Google 推荐的“软性横幅 (Soft Suggestion)”
* **取消边缘强制 302 重定向与爬虫 UA 白名单**：避免因维护脆弱的 UA 列表而误伤现代 AI 爬虫，同时保持 Pages 边缘无状态、零计算开销、纯静态极速分发。
* **根路径非侵入式轻量横幅**：
  中间件仅透传 `CF-IPCountry`；根路径 `/` 保持标准英文静态直出。若客户端检测到中文环境（且未显式设置偏好），在页面顶部呈现优雅、不阻挡主视觉的通知条：
  > *“检测到您的母语环境为中文，是否前往中文主页？ [前往中文版] [保持英文]”*

---

## 4. 最新提交重要功能在多语种中的词库与语义对齐 (Feature Parity Matrix)

必须将近期的重磅更新融入官网各语种的 Feature 卡片、Meta 描述与知识库中：

| 核心特性 | 英文关键词与价值表达 | 中文关键词与价值表达 | 日文 / 德文关键词表达 |
|---|---|---|---|
| **首选标准端口 (80/443)** | **Preferred Standard Ports**: Clean URLs without messy `:xxxx` ports. Effortlessly bypass strict enterprise firewalls & school network blocks. | **首选 80/443 标准端口**：生成干净无杂乱端口号的直链，轻松穿透公司企业网与校园受限防火墙，扫码秒连。 | **JA**: 標準ポート対応 (80/443ポート自動切替、企業ファイアウォール回避)<br>**DE**: Standard-Ports 80/443 für reibungslose Firewall-Umgehung. |
| **Android 跨端全场景支持** | **Universal Cross-Platform**: AirDrop for literally ANY device. iPhone, Android, Windows, Mac, Linux. Zero app needed on mobile. | **打破跨平台生态围墙**：真正支持任何设备的 AirDrop。iPhone、安卓手机与电脑互通，接收端手机 0 安装 0 注册。 | **JA**: iPhone・Android・PC対応、アプリ不要で相互転送。<br>**DE**: Echter AirDrop für jedes Gerät: iOS, Android & Windows. |
| **移动端 0 安装 Web Chat** | **Instant Zero-Install Mobile Web**: Scan and exchange files & clipboard notes in real-time. Background reconnect protection & fluid typing. | **免安装移动端极速工作台**：自带相机扫码即开，双向传图传视频、文字口令秒达，后台断线智能自愈，无惧键盘遮挡。 | **JA**: アプリインストール不要のWebチャット＆ファイル共有。<br>**DE**: Webbasierter Datenaustausch ohne App-Installation. |
| **纯局域网脱机与公信安全** | **Offline LAN Resilience & Green Lock**: 10–100MB/s Gigabit speed. Publicly trusted LAN-TLS certificates with browser green lock. Zero cloud relay. | **纯局域网脱机互联 & 权威绿锁**：物理满速 10~100MB/s 狂飙，官方公信 LAN-TLS 证书端到端加密，脱机可用，绝不上云。 | **JA**: クラウド不要の超高速ローカルWi-Fi転送、SSL暗号化。<br>**DE**: 100% lokales WLAN ohne Cloud, geprüfte TLS-Verschlüsselung. |

---

## 5. 多语种 SEO 标签与现代 GEO 规约

### 5.1 双向 `hreflang` 映射标准
在根目录 `/index.html` 以及所有 `/zh/`, `/ja/` 等子目录的 `<head>` 区域，注入标准双向映射：

```html
<link rel="canonical" href="https://www.eqt.net.im/zh/" />
<link rel="alternate" hreflang="x-default" href="https://www.eqt.net.im/" />
<link rel="alternate" hreflang="en" href="https://www.eqt.net.im/" />
<link rel="alternate" hreflang="zh" href="https://www.eqt.net.im/zh/" />
<link rel="alternate" hreflang="ja" href="https://www.eqt.net.im/ja/" />
<link rel="alternate" hreflang="ko" href="https://www.eqt.net.im/ko/" />
<link rel="alternate" hreflang="de" href="https://www.eqt.net.im/de/" />
<link rel="alternate" hreflang="fr" href="https://www.eqt.net.im/fr/" />
<link rel="alternate" hreflang="es" href="https://www.eqt.net.im/es/" />
```

### 5.2 根目录 `/llms.txt` 规范 (Standard LLM Knowledge Gateway)
在 `cloudflare/eqt-website/llms.txt` 部署纯文本 Markdown 知识库，专门面向 ChatGPT Search, Perplexity, Gemini, Claude 抓取：
- **产品一句话精准定义 (What is EQT)**：跨平台、零云端中继、纯局域网点对点极速传输与即时加密便签工具。
- **核心差异化壁垒 (Core Moats)**：
  1. 接收端 0 安装、0 注册，任何系统自带原生相机扫码秒开；
  2. 优先绑定标准 80/443 端口，消除杂乱端口号，穿透受限网络；
  3. 局域网物理满速 (10~100MB/s+)，完全不消耗公网流量，4K 视频原画零压缩；
  4. 官方公信 LAN-TLS 证书端到端加密，浏览器显示绿色安全锁。
- **多语种资源直链导航**。

### 5.3 合规 Schema.org (JSON-LD) 结构化语义注入
在 HTML 头部注入 `SoftwareApplication`：
```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "EQT (Easy QR Transfer)",
  "operatingSystem": "Windows 10+, macOS, Linux (Sender); iOS, Android (Receiver via Browser)",
  "applicationCategory": "UtilitiesApplication",
  "offers": [
    {
      "@type": "Offer",
      "name": "Free Tier",
      "price": "0",
      "priceCurrency": "USD"
    },
    {
      "@type": "Offer",
      "name": "Plus Yearly",
      "price": "11.99",
      "priceCurrency": "USD"
    },
    {
      "@type": "Offer",
      "name": "Plus Lifetime",
      "price": "29.99",
      "priceCurrency": "USD"
    }
  ],
  "description": "Cross-platform local LAN file transfer and chat via QR code with zero mobile app installation."
}
```

---

## 6. 边缘配置与部署流水线优化 (Cloudflare Pages Integration)

### 6.1 `_headers` 规则补齐
更新 `cloudflare/eqt-website/_headers`，确保子目录 HTML 与 GEO 文件正确缓存：
```
# HTML — short cache, always revalidate
/*/*.html
  Cache-Control: public, max-age=0, must-revalidate

# LLM Knowledge File
/llms.txt
  Content-Type: text/markdown; charset=UTF-8
  Cache-Control: public, max-age=86400
```

### 6.2 `sitemap.xml` 国际化补齐
在 `cloudflare/eqt-website/sitemap.xml` 中将各语种物理子路径完整补入，加入 `xhtml:link` 双向声明，并将 `lastmod` 刷新为当前日期。

### 6.3 工程流水线集成
在 `cloudflare/eqt-website/package.json` 中配置：
```json
{
  "scripts": {
    "build": "node ../../scripts/build-i18n-website.js",
    "deploy": "npm run build && wrangler pages deploy ./ --project-name=eqt"
  }
}
```
确保本地或 CI 每次发布前自动执行编译与绝对路径断言校验，杜绝代码与多语种生成物漂移。
