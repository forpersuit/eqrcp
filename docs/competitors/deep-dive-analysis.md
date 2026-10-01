# 13 款主流跨端与局域网文件传输竞品深度调研

本文档对 AlternativeTo 平台与市场上 13 款主流文件传输竞品进行技术架构、传输路径、商业模式及用户体验的深度解剖，并给出与 EQT (Easy QR Transfer) 的直接对比与 AlternativeTo 词条关联推荐文案。

---

## 1. PairDrop (网页端 WebRTC 局域网传输)
* **官网/词条**：`https://pairdrop.net/` | [AlternativeTo](https://alternativeto.net/software/pairdrop/about/)
* **架构原理**：继承自 Snapdrop 的 WebRTC 浏览器点对点方案。通过公共信令服务器（Signaling Server）协调同一外网 IP 下的浏览器客户端，建立 WebRTC DataChannel 进行 P2P 传输。
* **核心优势**：双端纯网页免安装，开源免费，UI 类似 AirDrop 气泡。
* **致命痛点**：
  1. **信令发现极其脆弱**：两端必须同时打开网页且处于同一个 NAT 外网 IP；在企业复杂局域网、多子网、开启 VPN 或对称型 NAT 时，两端经常“互相隐形看不见”。
  2. **大文件容易卡死与内存溢出**：WebRTC DataChannel 依赖浏览器 JavaScript 内存分片缓冲，传输几 GB 的大视频时经常出现浏览器标签页内存溢出崩溃。
  3. **缺少桌面原生常驻与物理网卡绑定能力**。
* **EQT 对比优势**：
  * EQT 桌面端原生常驻，采用成熟的物理局域网 HTTP/2-TLS 流式传输，不依赖公网 WebSockets 信令服务器，100% 成功发现；
  * 原生文件读写流，轻量吞吐 4K 几十 GB 大文件毫无内存压力，跑满物理千兆网速。
* **AlternativeTo 关联推荐文案**：
  > *"PairDrop is great for small web-based shares, but its WebRTC discovery often fails across enterprise subnets or VPNs. EQT eliminates fragile signaling by generating direct LAN QR codes with zero-config TLS certificates, delivering true physical gigabit transfers without WebRTC disconnects."*

---

## 2. Send Anywhere (ESTmob 出品)
* **官网/词条**：`https://send-anywhere.com/` | [AlternativeTo](https://alternativeto.net/software/send-anywhere/about/)
* **架构原理**：基于 6 位数字密钥或短链接的文件传输。核心流程通常依赖其中继服务器和云端中转存储（保留 48 小时）。
* **核心优势**：无论设备是否在同一局域网均可凭借 6 位码取件，支持多平台客户端。
* **致命痛点**：
  1. **重度恶心广告与强制月租订阅**：免费版充满全屏弹窗广告；高级版（Sendy / Plus）每月强制收取 $5.99+ 的昂贵订阅费。
  2. **云端中继限速与网络浪费**：即便两台设备并排放在同一张桌子上，也往往强制走公网中继服务器上传和下载，浪费大量带宽且速度极慢。
  3. **严重机密与隐私泄露风险**：文件被上传并托管在第三方商业云服务器上。
* **EQT 对比优势**：
  * EQT 彻底免除外部云端中转，100% 本地局域网物理直连；
  * **完全零广告，绝不搞流氓月租订阅**，核心功能免费，高级功能一次性终身买断。
* **AlternativeTo 关联推荐文案**：
  > *"Tired of Send Anywhere's predatory monthly subscriptions, full-screen mobile ads, and slow cloud relays? EQT transfers files directly over your physical local network with zero cloud storage, zero ads, zero subscriptions, and no mobile app required."*

---

## 3. SHAREit (茄子快传)
* **官网/词条**：`https://www.ushareit.com/` | [AlternativeTo](https://alternativeto.net/software/shareit/about/)
* **架构原理**：利用手机自建 Wi-Fi 热点（Wi-Fi Direct / SoftAP），接收端连接热点后通过私有协议传输。
* **核心优势**：在无 Wi-Fi 路由器的户外场景下可离线传输大型手机游戏包与安装包。
* **致命痛点**：
  1. **极其严重的臃肿化与流氓行为**：App 安装包高达 100MB+，充斥短视频、小游戏、信息流以及后台常驻唤醒。
  2. **过度侵犯用户隐私**：索取设备通讯录、精准地理位置、相机、后台自启动等与传文件无关的大量危险权限。
  3. **跨 PC 与 iOS 体验极差**：在电脑与苹果设备上配对繁琐至极，且常常断流。
* **EQT 对比优势**：
  * EQT 纯粹克制，专注于文件与剪贴板高效传输，零后台驻留流氓行为，零隐私权限索取；
  * 移动端根本不需要下载任何 App，原生相机扫码即传。
* **AlternativeTo 关联推荐文案**：
  > *"SHAREit has become bloated adware with invasive tracking. EQT provides a clean, ultra-fast alternative: no phone app required, no predatory permissions, and instant browser-based gigabit transfers."*

---

## 4. Wormhole (基于浏览器的云端加密快传)
* **官网/词条**：`https://wormhole.app/` | [AlternativeTo](https://alternativeto.net/software/wormhole-app/about/)
* **架构原理**：端到端加密公网云端共享工具（Firefox Send 精神续作）。文件在浏览器端使用 AES-GCM 加密后上传至 Wormhole 云存储，接收方通过带密钥的链接下载。
* **核心优势**：链接自动过期（24小时/100次下载），UI 极简优雅，端到端加密。
* **致命痛点**：
  1. **必须先上传至公网服务器**：对于局域网同一桌面的设备互传，明明相距 30 厘米却要绕道公网数据中心，严重受制于宽带的上行瓶颈（通常仅 20~30Mbps）。
  2. **单文件大小受限**：超过 5GB 或 10GB 必须双方实时保持网页在线或者付费。
* **EQT 对比优势**：
  * EQT 是真正的**无盘纯物理局域网流式传输**，无需将文件上传到任何中间服务器；
  * 传输速率直接跑满物理千兆网卡（60~100+ MB/s），不受任何公网带宽和文件大小限制。
* **AlternativeTo 关联推荐文案**：
  > *"Unlike Wormhole which forces you to upload gigabytes to cloud servers over slow ISP uplinks, EQT streams files straight across your physical LAN at 100+ MB/s with zero external internet consumption."*

---

## 5. Warpinator (Linux Mint 官方局域网工具)
* **官网/词条**：[GitHub / Linux Mint](https://github.com/linuxmint/warpinator) | [AlternativeTo](https://alternativeto.net/software/warpinator/about/)
* **架构原理**：基于 Python/gRPC 的局域网文件传输服务，利用 mDNS / Zeroconf 在本地网络自动发现同网设备。
* **核心优势**：Linux Mint 默认预装，本地网络加密传输，无任何云端依赖。
* **致命痛点**：
  1. **对非 Linux 生态支持极弱**：虽然有社区移植的 Windows 和 Android 版本，但稳定性差；iOS 上几乎没有可用官方应用。
  2. **强制两端安装客户端**：无法给身边的 iPhone 或访客 Android 手机快速传文件。
* **EQT 对比优势**：
  * EQT 完美覆盖 Windows、macOS、Linux 桌面主流系统，且移动端（iOS / Android）**无需安装任何客户端**，扫码即传。
* **AlternativeTo 关联推荐文案**：
  > *"Warpinator is great on Linux Mint but struggles across iOS and general mobile devices. EQT brings high-speed local network transfer to every platform, requiring only a stock phone camera scan with zero mobile app installation."*

---

## 6. Croc (极客命令行 CLI 传输)
* **官网/词条**：[GitHub / schollz/croc](https://github.com/schollz/croc) | [AlternativeTo](https://alternativeto.net/software/croc/about/)
* **架构原理**：Go 语言编写的 CLI 工具，通过 PAKE (Password-Authenticated Key Exchange) 和短语口令建立中继与本地直接传输通道。
* **核心优势**：极客开发者最爱，支持断点续传、端到端加密，终端一行命令即传。
* **致命痛点**：
  1. **无现代 GUI 与移动端体验**：手机上无法方便地使用 CLI，普通办公用户、设计师或商业客户完全无法上手。
* **EQT 对比优势**：
  * EQT 同样具备 Go 原生高并发低资源开销的底层基因，但提供了极致优雅的现代桌面 GUI 与移动端扫码 Web 界面，兼具专业性能与大众易用性。
* **AlternativeTo 关联推荐文案**：
  > *"Croc is unmatched in the terminal, but impossible for non-technical teammates and mobile devices. EQT gives you the same raw Go performance and local encrypted speed, wrapped in an app-free mobile QR workflow."*

---

## 7. AlterSend
* **官网/词条**：`https://altersend.com/` | [AlternativeTo](https://alternativeto.net/software/altersend/about/)
* **架构原理**：结合二维码配对与网页下载的 P2P 传输工具。
* **核心优势**：支持二维码配对后在浏览器下载，强调隐私无云端存储。
* **致命痛点**：
  1. 依赖 WebRTC 打洞信令，在没有公网互联网接入的纯离线局域网下容易失效；
  2. 局域网 Web 服务缺乏受信任的公共 CA 泛域名证书（缺少类似 EQT 的 `*.direct.eqt.net.im` 专利回路），容易在 iOS 上被拦截。
* **EQT 对比优势**：
  * 纯正局域网原生 TLS 绿锁，离线物理网络 100% 连通。

---

## 8. RetroShare
* **官网/词条**：`https://retroshare.cc/` | [AlternativeTo](https://alternativeto.net/software/retroshare/about/)
* **架构原理**：构建在 GPG 信任链之上的 Friend-to-Friend (F2F) 暗网去中心化通讯网络，整合邮件、论坛、VoIP 与文件共享。
* **致命痛点**：极其庞大厚重，属于极客抗审查网络，完全脱离日常两台设备间轻快传文件的现实场景。

---

## 9. NearDrop
* **官网/词条**：[GitHub / grishka/NearDrop](https://github.com/grishka/NearDrop) | [AlternativeTo](https://alternativeto.net/software/neardrop/about/)
* **架构原理**：在 macOS 上逆向模拟 Google Nearby Share / Quick Share 的接收端。
* **致命痛点**：仅单向支持 Android 发到 Mac；不支持 Windows，无法反向从 Mac 发送到手机，无法与 iPhone 互传。
* **EQT 对比优势**：全双工双向传输，支持 Windows / Mac / Linux 与 iOS / Android 全生态。

---

## 10. Nothing Warp
* **官网/词条**：[AlternativeTo](https://alternativeto.net/software/nothing-warp/about/)
* **架构原理**：浏览器扩展插件，在已登录该插件的浏览器间同步剪贴板文本与小文件。
* **致命痛点**：局限于装有插件的桌面浏览器，无法处理大型本地文件，移动端不支持。

---

## 11. DashBeam (原 AltSendme)
* **官网/词条**：[AlternativeTo](https://alternativeto.net/software/altsendme/about/)
* **架构原理**：加密直连传输，项目规模小，网络自适应能力与协议成熟度较弱。

---

## 12. Air Delivery
* **官网/词条**：[AlternativeTo](https://alternativeto.net/software/air-delivery/about/)
* **架构原理**：轻量级 WebRTC 免登录文件分享，面临与 PairDrop 类似的信令依赖与大文件卡顿问题。

---

## 13. Sharrr
* **官网/词条**：[AlternativeTo](https://alternativeto.net/software/sharrr/about/)
* **架构原理**：端到端加密、异步并行上传传输，本质上偏向带加密的网盘/中继分享方案。

---

## 三、AlternativeTo 关联攻坚战术速查

在 AlternativeTo 上为 EQT 提交“**Suggest as alternative**”时，优先级最高的核心词条与推荐评语：

1. **AirDrop**：
   * *“The cross-platform AirDrop that works on Windows, Linux, PC, and Android without requiring iOS or macOS exclusivity.”*
2. **LocalSend**：
   * *“Unlike LocalSend which forces mobile receivers to download an app from the App Store / Google Play, EQT enables app-free mobile browser transfers via QR scan.”*
3. **PairDrop / Snapdrop**：
   * *“Replaces fragile WebRTC STUN/TURN signaling with true physical gigabit LAN HTTP/2 streaming backed by genuine LAN-TLS wildcard certificates.”*
4. **Send Anywhere**：
   * *“A clean, privacy-first alternative without predatory monthly subscriptions, full-screen mobile ads, or mandatory cloud uploads.”*
5. **Wormhole**：
   * *“For devices on the same desk, EQT streams files at 100+ MB/s across your local Wi-Fi instead of wasting internet bandwidth uploading to cloud servers.”*
