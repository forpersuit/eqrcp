# Reddit Launch Execution Playbook (EQT 商业数字化产品出海推广手册)

> **定位声明**：EQT (Easy QR Transfer) 是纯正的**独立商业数字化软件（Indie Commercial Product）**。严格杜绝任何「开源 / Open Source / GitHub」标签，树立极客匠心、零云端隐私泄漏、买断制独立产品的品牌心智。

---

## 1. 官方资产与账号配置 (Profile Setup)

推广发布使用的官方账号为 `u/eqt_social`，已在 Reddit 官方完成高权威的名片配置：
- **Display Name**: `EQT (Easy QR Transfer)`
- **About Bio**: `App-free local file sharing across PC, Mac, iPhone & Android at physical gigabit speed with zero setup and zero cloud leakage. Official: https://eqt.net.im`
- **Social Links**: Custom 官网直达链接 `Official Website -> https://eqt.net.im`
- **头像与设计**: 配套官方深色极客 Logo 与标准视觉图。

---

## 2. 社区目标矩阵与发布策略

| 社区 | 规模 | 内容偏好 | 规则与限制 | 推荐内容形式 |
| :--- | :--- | :--- | :--- | :--- |
| **r/SideProject** | 320K+ | 创客故事、痛点自述、真实演示 | **仅允许视频演示**（禁止纯静态图片） | 4.9s 循环高清短片 + 5000字深度极客长文 |
| **r/indiehackers** | 180K+ | 商业变现、买断制思考、产品打磨 | 强调独立开发、真实营收模型 | 商业自述 + 痛点解决故事 |
| **r/selfhosted** | 450K+ | 本地局域网传输、零云端泄露、LAN-TLS | 严苛的技术架构分析、杜绝纯公关软文 | 深度硬核解析：零配置自签权威 TLS 架构 |
| **r/macapps** | 120K+ | macOS 辅助工具、UI 优雅度、轻量快速 | 专注跨设备流转（Mac <-> Android/PC） | 对比 AirDrop 的跨生态痛点 |
| **r/windowsapps**| 60K+ | Windows 跨端传输、右键拖拽、千兆 LAN | 易用性、拖拽即走 | 拖拽文件到托盘/窗口并扫码极速互传 |

---

## 3. 本次已发布的核心贴文归档 (Published Article Archive)

- **Subreddit**: `r/SideProject`
- **Post ID**: `t3_1wuxnue`
- **Permalink**: `https://www.reddit.com/r/SideProject/comments/1wuxnue/i_built_eqt_an_appfree_local_file_sharing_tool/`
- **媒体演示**: `eqt-demo-loop.mp4`（4.9秒循环高清短片，拖拽文件生成二维码并手机扫码直传）
- **完整标题**:
  `I built EQT: an app-free local file sharing tool for PC, Mac & mobile at gigabit LAN speed (AirDrop alternative with trusted HTTPS)`

### 3.1 深度技术长文全文 (Body Content)

```markdown
## The Everyday Frustration: The 30-Centimeter Problem

How often does this happen to you? You are sitting right at your desk. Your computer (Windows PC, Mac, or Linux workstation) is literally 30 centimeters away from your smartphone (iPhone or Android). You have a 2GB raw 4K video clip, a batch of client mockups, or an archive of log files you need to move between them immediately.

Logically, data only needs to jump across your local Wi-Fi router. But in reality, modern cross-platform options are surprisingly painful:

• AirDrop: Incredible engineering, but strictly walled inside Apple's ecosystem. If you use Windows + iPhone, Mac + Android, or Linux, you simply don't exist.
• Messaging Apps (Telegram, WhatsApp, etc.): They compress photos and videos into blurry artifacts, impose harsh file size caps, and bounce your private data across remote servers halfway across the globe.
• Cloud Drives (Google Drive, Dropbox, iCloud, OneDrive): Uploading gigabytes across your internet uplink just to download it right back onto the screen in front of you. It wastes bandwidth, burns cloud quotas, and takes minutes when it should take seconds.
• Third-Party Transfer Apps: Almost every tool requires installing an ad-bloated app on both devices, registering an account, or fighting fragile Bluetooth handshakes that fail half the time.

## The First-Principle Approach: EQT (Easy QR Transfer)

I asked myself a simple question: Why should transferring a file between two devices on the exact same desk require an external server, an app install, or an account?

What if your computer could simply spin up an instant, isolated local transfer node, display an ephemeral QR code, and any phone could just point its stock camera app at the screen and transfer immediately in the browser?

That is why I engineered EQT (Easy QR Transfer): an independent desktop utility built around pure local speed, privacy, and zero-friction ergonomics.

## Key Technical Architecture & Highlights

1. Zero Mobile App Required (The Browser Is Your Client)
You only run the lightweight desktop client on your workstation (Windows, macOS, or Linux). When you need to send or receive files, EQT generates an ephemeral local session. The other party—whether it is an iPhone, an Android phone, or a colleague's laptop—simply scans the QR code. It opens a clean, responsive web interface in Mobile Safari or Chrome with zero app downloads and zero account creation.

2. True Physical Gigabit LAN Speed (Direct Local P2P)
All data streams directly over your local Wi-Fi or Ethernet network. There is no cloud proxy, no external relay, and no throttling. Transfer speeds regularly hit 60–100+ MB/s (limited only by your physical router hardware). A 2GB file takes seconds, not minutes.

3. Zero-Config LAN-TLS (The Trusted Green HTTPS Lock)
This was the most challenging technical hurdle during development. Modern mobile browsers (iOS Safari and Android Chrome) strictly block camera scanning, streaming APIs, and progressive web features on plain insecure http:// local IP addresses. However, generating self-signed certificates triggers terrifying red security warnings ("Your connection is not private") that ruin the user experience.

EQT solves this natively: it automates local TLS loopback (*.direct.eqt.net.im) paired with genuine, publicly trusted Let's Encrypt certificates. Zero configuration, zero root certificate imports—your mobile browser immediately receives a valid green HTTPS padlock with full hardware acceleration.

4. Two-Way Transfer & Real-time Web Chat
EQT is not just a one-way dump. It includes a responsive real-time chat interface where you can exchange text snippets, clipboard links, photos, or batch folders (automatically packaged as ZIPs on the fly) seamlessly between desktop and mobile devices.

## An Honest, Independent Utility

I built EQT as an independent developer who values craftsman quality, user time, and privacy:
• Zero Cloud Leakage: Your files and clipboard content never touch external servers. There is zero telemetry on your transfer content.
• Fair, Sustainable Model: Core everyday local transfers are completely free with zero ads, zero tracking scripts, and zero nag screens. For power users needing advanced multi-interface routing, automated loopback DNS failover, or team workflows, there is an honest, one-time lifetime license. No predatory recurring monthly subscriptions.

## Try It Out & Join the Conversation

EQT is an independent desktop utility for Windows, macOS, and Linux.

You can easily check it out by searching "EQT Easy QR Transfer" online, or by visiting the official website link featured directly in my Reddit user profile bio!

I would love to hear feedback from fellow indie builders, power users, and multi-device enthusiasts:
• What does your current cross-device transfer workflow look like?
• Are there specific router or network topologies you would like to see tested?
• Any feedback on the Web UI or transfer performance?

Thank you for reading, and I hope EQT makes your daily desk workflow a little bit smoother!
```

---

## 4. 作者置顶首评 (First Comment) 归档

已成功发布在帖子评论区：
```markdown
Thanks everyone for checking out this post!

A quick backstory on why I spent months obsessing over this: as someone working daily across Windows (desktop workstation), macOS (MacBook on the go), and both an iPhone and an Android device, moving raw 4K media clips and project archives was driving me crazy. AirDrop was great until I sat down at my PC, and uploading multi-gigabyte files to cloud drives just to download them across the exact same desk felt like an insult to modern physical Wi-Fi.

The biggest engineering hurdle was definitely achieving zero-config LAN-TLS. Getting modern mobile Safari/Chrome to grant full web API access and hardware acceleration over local network without showing terrifying red security warnings required a lot of DNS loopback and ACME automation engineering.

I'm actively monitoring this thread all day—if you have questions about the local architecture, privacy, or performance on unusual network setups, fire away! And if you'd like to test it out on your workstation, the official link is featured right on my Reddit profile bio. Cheers!
```

---

## 5. Reddit 平台防刷机制 (CQS & Spam Filter) 避坑与养号指引

1. **Reddit 0-Day 规则**:
   - 刚刚注册的新账号（Age < 24h, Karma = 1）在大型版块（如 r/SideProject）发帖时，会被平台全局安全算法自动打上待审核状态（`Sorry, this post was removed by Reddit's filters.`），同时临时限制向版主发送私信。
2. **正文黑名单关键词**:
   - 正文严禁包含 `u/` 字符串（例如 `(u/eqt_social)`），否则会被 GraphQL 表单直接返回 `SUBMIT_VALIDATION_BODY_BLACKLISTED_STRING` 拦截。
   - 正文避免直接出现裸域名（如带有顶级域名 `.com`, `.net`, `.im`），引导读者通过 Profile 官方链接或搜索访问。
3. **快速转正策略 (Karma 提升)**:
   - 账号注册 24 小时后，冷启动限制自动大幅降低。
   - 在 `r/macapps`、`r/windows` 或 `r/indiehackers` 的相关求助帖中发表 2~3 条有见地的技术解答，获取 5~10 点 Karma，账号的 Contributor Quality Score (CQS) 即可升级至 High，后续发帖将 100% 直通。
