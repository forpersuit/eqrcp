# AlternativeTo Submission & Listing Package for EQT (Easy QR Transfer)

本文档为 EQT 在全球最大软件替代品推荐平台 **[AlternativeTo.net](https://alternativeto.net)** 的标准提交收录元数据包与竞品截流配置指南。

---

## 1. 软件核心属性配置 (Application Metadata)

| 字段 (Field) | 提交内容 (Value) | 说明 |
| :--- | :--- | :--- |
| **Application Name** | `EQT (Easy QR Transfer)` | 品牌全称，便于关键词与缩写检索 |
| **Official Website URL** | `https://eqt.net.im/` | 官方权威落地页 |
| **License Type** | `Freemium` (Proprietary / Commercial) | 基础局域网互传永久免费，专业特性终身买断 |
| **Cost / Pricing** | Free for basic LAN transfer; $29.99 Lifetime License for Pro | 透明买断制，拒绝订阅陷阱 |
| **Supported Platforms** | • Windows<br>• macOS<br>• Linux<br>• Web<br>• Android (Browser)<br>• iPhone (Browser) | 强调接收端与移动端免装任何客户端 |

---

## 2. 简短摘要 (Short Pitch / Tagline)

> **Short Description (< 150 字符)**:  
> `App-free local file sharing across PC, Mac, iPhone & Android at physical gigabit speed with zero setup and zero cloud leakage.`

---

## 3. 详细产品描述 (Long Description)

```markdown
EQT (Easy QR Transfer) is an independent, desktop-first local file transfer utility built for pure speed, privacy, and zero-friction ergonomics across PC, Mac, and mobile devices.

### The Everyday Problem: The 30-Centimeter Frustration
How often does this happen to you? You are sitting at your desk. Your computer (Windows PC, Mac, or Linux workstation) is literally 30 centimeters away from your smartphone (iPhone or Android). You have a 2GB raw 4K video clip, a batch of client mockups, or an archive of log files you need to move between them immediately.

AirDrop is strictly walled inside Apple's ecosystem. Cloud drives waste time and bandwidth by bouncing your gigabytes across external internet relays. Messaging apps compress photos and videos into blurry artifacts. Most third-party tools force you to install ad-bloated apps on both devices.

### The First-Principle Solution
Why should transferring a file between two devices on the exact same desk require an external server, an app install, or an account?

With EQT, your desktop computer spins up an instant, isolated local transfer node and displays an ephemeral QR code. Any mobile device simply points its stock camera app at the screen and transfers immediately inside Mobile Safari or Chrome.

### Key Architectural Highlights:
1. **Zero Mobile App Required**: You only run the lightweight client on your desktop workstation. The mobile end is purely web-based with zero app downloads and zero account creation.
2. **True Physical Gigabit LAN Speed**: Data streams directly across your local Wi-Fi or Ethernet network. No cloud proxy, no throttling. Speeds regularly hit 60–100+ MB/s. A 2GB file takes seconds, not minutes.
3. **Zero-Config LAN-TLS (The Trusted Green Padlock)**: EQT natively automates local TLS loopback (*.direct.eqt.net.im) paired with genuine, publicly trusted Let's Encrypt certificates. Zero configuration, zero root certificate imports—your mobile browser immediately receives a valid green HTTPS padlock with full web API hardware acceleration.
4. **Two-Way Sharing & Real-time Web Chat**: EQT supports bidirectional sharing, clipboard text syncing, and automatic ZIP bundling for batch folders.
5. **Zero Cloud Leakage & Privacy First**: Your files and clipboard content never touch external servers. 

### Pricing & Philosophy:
Core everyday local transfers are completely free with zero ads and zero tracking scripts. For power users needing advanced multi-interface routing, automated loopback DNS failover, or team workflows, there is an honest, one-time lifetime license. No predatory recurring monthly subscriptions.
```

---

## 4. 核心分类与标签矩阵 (Categories & Tags)

在 AlternativeTo 提交表单时必须填入以下标签，最大化搜索覆盖度：

- `file-sharing`
- `file-transfer`
- `local-area-network`
- `lan-transfer`
- `p2p-transfer`
- `qr-code`
- `airdrop-alternative`
- `privacy`
- `wifi-transfer`
- `cross-platform`
- `desktop-utility`
- `no-cloud`

---

## 5. 核心替代竞品截流关系 (Suggested Alternatives to Link)

一旦词条初审上线，需在以下知名竞品页面点击 **"Suggest as Alternative"** 将 EQT 关联至竞品榜单：

1. **AirDrop** (Apple 封闭生态替代)
   - *Why EQT is an alternative*: Works seamlessly between Windows, Mac, Linux, iPhone, and Android without requiring Apple hardware on both ends.
2. **LocalSend**
   - *Why EQT is an alternative*: LocalSend requires installing an app on mobile devices. EQT requires zero mobile installation—phones connect immediately via stock camera and browser.
3. **Snapdrop / PairDrop**
   - *Why EQT is an alternative*: Snapdrop relies on public WebRTC signaling servers that frequently suffer downtime. EQT runs as an independent local desktop engine with trusted LAN-TLS loopback and zero external dependency.
4. **Quick Share (Nearby Share)** (Google/Android 生态替代)
   - *Why EQT is an alternative*: No Google account requirement, works seamlessly on iOS and macOS.
5. **Send Anywhere**
   - *Why EQT is an alternative*: Does not bounce transfers through public internet relays or inject advertisements; delivers pure physical LAN throughput.
6. **Feem**
   - *Why EQT is an alternative*: Modern web interface, zero mobile app installation, no advertisements.

---

## 6. 视觉资产准备 (Visual Assets)

- **App Icon**: `docs/img/transparent.png` (512x512 PNG, 高清深色透明背景)
- **Screenshots**:
  1. `dist/reddit-assets/app-share.png` (桌面端文件分享与即时二维码主界面)
  2. `dist/reddit-assets/app-chat-4-mobile.png` (手机端免安装 Web 界面与极速传输状态)
  3. `dist/reddit-assets/app-chat-2-chatting.png` (跨端局域网双向聊天与剪贴板同步)
  4. `dist/reddit-assets/before_submit.png` (完整工作流与特性概览)
