# Hacker News (Show HN) 全球首发攻坚指南与文案包

> **平台属性**：全球顶级极客、黑客与独立开发者社区（news.ycombinator.com）
> **官方规则**：严格遵循 [Show HN Guidelines](https://news.ycombinator.com/showhn.html)。标题必须以 `Show HN: ` 开头，禁止营销套话，重在技术深度与真实实用价值。

---

## 一、提交元数据 (Submission Metadata)

* **提交页面 (Submit URL)**：`https://news.ycombinator.com/submit`
* **推荐标题 (Title)**（< 80 字符，客观、克制、直击极客痛点）：
  ```text
  Show HN: EQT – App-free local file sharing across PC, Mac and mobile at LAN speed
  ```
  *(备选标题 2: `Show HN: EQT – AirDrop alternative for any device with zero mobile app and LAN-TLS`)*
* **URL**：
  ```text
  https://eqt.net.im/
  ```

---

## 二、发帖后一楼置顶深度自述评论 (The Creator's First Comment)

> **核心策略**：提交 URL 后，**立即在自己帖子的评论区发布这一条深度自述**（HN 用户习惯看一楼了解作者背景和技术内幕）。

```markdown
Hi HN! I’m the solo developer behind EQT (Easy QR Transfer) — https://eqt.net.im/

### The Problem: The 30-Centimeter Frustration
How often does this happen at your desk? Your computer (Windows workstation, Mac, or Linux box) is sitting literally 30 centimeters away from your phone (iPhone or Android). You have a 2GB raw 4K video clip, a batch of client mockups, or an archive of log files you need to move between them immediately.

Logically, data only needs to jump across your local Wi-Fi router. But in reality, modern cross-platform options are surprisingly painful:
- **AirDrop**: Incredible engineering, but strictly walled inside Apple’s garden. If you use Windows + iPhone, or Mac + Android, you simply don't exist.
- **Cloud Drives (Dropbox, Google Drive, iCloud)**: You upload gigabytes over your slow home internet uplink just to download it right back onto the screen in front of you. It wastes bandwidth and cloud quotas.
- **Messaging Apps**: They recompress videos into blurry artifacts, have file size limits, and bounce your private data across remote servers halfway across the globe.
- **Third-Party Utilities**: Almost every tool requires installing an ad-bloated app on both devices, signing up for an account, or fighting fragile Bluetooth handshakes.

### The First-Principle Solution
Why should transferring a file between two devices on the exact same desk require an external server, an app install, or an account?

With EQT, your desktop computer spins up an instant, isolated local transfer node and displays an ephemeral QR code. Any phone points its stock camera app at the screen, which immediately opens a clean, responsive transfer page in Mobile Safari or Chrome.

### Technical & Architectural Highlights:

1. **Zero Mobile App Required (The Browser Is Your Client)**:
You only run the lightweight desktop client (built in Go + Wails/webview) on your workstation. The mobile end is purely web-based with zero app downloads and zero account creation.

2. **True Physical Gigabit LAN Speed**:
Data streams directly across your local Wi-Fi or Ethernet network via HTTP/2 streams. There is no cloud proxy, no external relay, and no artificial throttling. Speeds regularly hit 60–100+ MB/s (limited only by your physical router). A 2GB file takes seconds, not minutes.

3. **Zero-Config LAN-TLS (The Trusted Green Padlock)**:
This was easily the hardest technical challenge during development. Modern mobile browsers (iOS Safari and Android Chrome) strictly block camera scanning, streaming APIs, and progressive web features on plain insecure `http://` local IP addresses. However, self-signed certificates trigger terrifying red security warnings ("Your connection is not private") that ruin the user experience.
EQT solves this natively: it automates local TLS loopback (`*.direct.eqt.net.im`) paired with genuine, publicly trusted Let's Encrypt / Google Trust Services certificates. Zero configuration, zero root certificate imports—your mobile browser immediately receives a valid green HTTPS padlock with full web API hardware acceleration.

4. **Two-Way Sharing & Real-time Web Chat**:
EQT supports bidirectional sharing, clipboard text syncing, and automatic ZIP bundling for batch folders.

5. **Privacy First & Honest Sustainable Model**:
- Your files and clipboard content never touch external servers.
- Core everyday local transfers are completely free with zero ads and zero tracking scripts.
- For power users needing advanced multi-interface routing, automated loopback DNS failover, or team workflows, there is an honest, one-time lifetime license. No predatory recurring monthly subscriptions.

I’m hanging out here all day—I’d love to hear your feedback on the network architecture, performance on different router topologies, or cross-device workflows!
```

---

## 三、HN 极客常见提问应对预案 (FAQ Cheatsheet)

1. **问：这和 LocalSend / Snapdrop / PairDrop 有什么区别？**
   * **答**：
     * 与 LocalSend 相比：LocalSend 强制两端（包括手机）都必须去应用商店下载安装 App；而 EQT 手机端**零安装**，系统相机扫码即传。
     * 与 Snapdrop / PairDrop 相比：它们依赖 WebSockets 公网信令服务器与 WebRTC，在复杂企业多网卡/对称 NAT 下极易“互相看不见”，且大文件常导致浏览器内存溢出；EQT 采用稳定的 Go 物理千兆流式传输，结合免配置的公网 CA 权威局域网 TLS 绿锁，100% 可用且不掉线。

2. **问：局域网 TLS 绿锁是怎么实现的？会有隐私泄露吗？**
   * **答**：
     * 完全没有泄露。客户端仅利用通配符域名（`*.direct.eqt.net.im`）解析到本地局域网 IP（RFC 1918 私有地址回环）。
     * 传输全过程直接在本地设备间加密握手，证书由 Let's Encrypt 公共信任根签名，真实文件流永远不经过任何云端或中继节点。

3. **问：为什么不是开源的？**
   * **答**：
     * EQT 是一款专注打磨体验的独立商业数字化工具。我们日常核心功能永久免费无广告，高级功能采取透明的一次回购终身授权（Lifetime License），以此维持长期的高质量协议维护、自动化权威证书签发与跨系统兼容适配，拒绝靠月租流氓订阅或卖数据盈利。
