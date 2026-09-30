# EQT (Easy QR Transfer) — 全球官方推介核心底稿 (Global Launch Pitch & Positioning)

> 💡 **文档定位**：本文档为 EQT 面向**欧美及全球非中文市场（Tier-1 区域为主）**的官方推介核心母版。遵循**第一性原理**，拒绝空洞虚浮的营销术语，以真挚诚恳的独立开发者自述，讲透产品为什么诞生、解决了日常工作流中的哪根刺、技术壁垒与物理边界，以及公开透明的商业契约。
> 
> **语言规划**：
> 1. [第一部分：中文打底思考母版 (Chinese Foundational Blueprint)](#第一部分中文打底思考母版-chinese-foundational-blueprint)
> 2. [第二部分：官方正式英文发布稿 (English Global Launch Pitch)](#第二部分官方正式英文发布稿-english-global-launch-pitch)
> 3. [第三部分：德语与日语国际化核心推介 (Tier-1 Localization)](#第三部分德语与日语国际化核心推介-tier-1-localization)

---

## 第一部分：中文打底思考母版 (Chinese Foundational Blueprint)

### 1. 起点反思：在 2026 年，跨设备传东西为什么依然像上个世纪？

在写下 EQT 的第一行代码之前，我无数次在日常工作和生活中陷入过这种让人烦躁的窘境：

- **AirDrop 苹果生态孤岛**：在欧美，许多人手持 iPhone，工作主力机却是 Windows 台式机或 Linux 工作站。手机随手拍了一段几百兆的 4K 视频想要剪辑，AirDrop 连影子都找不到；找数据线不仅繁琐，还经常遇到驱动识别故障或接口接触不良。
- **协同软件的企业监控与格式折叠**：电脑上刚配置好一段测试用的 API Token、SSH 私钥或密码，想弄进手机测试。如果发进 Slack 或 Microsoft Teams，会被企业安全审计系统存底记录；如果发进 WhatsApp 或 Telegram，又把私密敏感信息永久留在了第三方云端。
- **协同工具的“下载绑架”**：朋友、同事或客户就坐在你对面，距离不到半米。你想把一份 1GB 的设计工程包发给对方，市面上的互传工具却往往要求“对方手机也必须去 App Store 下载一个 50MB 的 App 并完成配对”。很多时候，等安装配对折腾完，现场沟通的耐心早已被消耗殆尽。
- **云盘的“双重等待与降速”**：先花 10 分钟上传到 Google Drive 或 Dropbox，对方再花 10 分钟下载，不仅平白消耗公共外网流量，原本 30 秒能解决的碰头交代，硬生生被拉长为冗长的等待。

我不禁从第一性原理反思：
> **两台设备明明就在同一张桌子上，连着同一个 Wi-Fi，物理距离不过几十厘米。为什么数据非要绕地球半圈走第三方云端？为什么非要强迫接收方下载一个可能几个月才打开一次的手机 App？**

数据的物理流动，本该像呼吸一样自然。这就是我独立打造 EQT 的唯一初心。

---

### 2. EQT 是什么？它的交互哲学

EQT 是一款专注于**电脑（PC/Mac/Linux）与移动设备（iOS/Android）之间无摩擦极速互传与即时轻量交互**的桌面端工具。

它的底层逻辑只有一句话：**“电脑发起，手机自带相机一扫，即刻直连，用完即焚。”**

打开软件，你会看到 3 个清晰纯粹的场景模式：

1. **Share 模式（电脑 ➔ 手机）**：选择单个文件、多张照片或一整个文件夹，电脑屏幕立即亮出二维码。手机扫码直接以物理网卡最高速度下载。如果是文件夹，后台自动在内存中流式打包为 organized ZIP 压缩包，手机点一下整包存入，无需逐张保存。
2. **Receive 模式（手机 ➔ 电脑）**：电脑开启接收监听，手机扫码打开极简 Web 界面，直接勾选手机相册里的 4K 原片或大文件，直传电脑指定硬盘目录。一条数据线都不用插。
3. **Chat 模式（临时局域网私密房间 & 剪贴板互通）**：手机扫码进入点对点加密房间。双向极速同步文本、网址、Token、代码片段与截图。手机端支持一键复制到系统剪贴板。用完随手关掉窗口，全部记录当场彻底销毁，不留任何痕迹。

---

### 3. 为什么 EQT 用起来如此顺手？（核心差异化与工程细节）

- **📱 接收端彻底免装 App（Zero Mobile App）**：这是对接收方极致的尊重。任何 iPhone 或安卓手机，只要有原生相机或主流浏览器，扫码即用。不强迫任何人下载客户端，不要求注册任何账号。
- **⚡ 物理千兆满速（10MB/s ~ 100MB/s+）**：数据 100% 走本地 Wi-Fi / 局域网物理直连，完全不经过外部中继服务器，不受公共外网宽带限速影响，几秒钟冲过几个 G。
- **🔒 业内领先的 Zero-Config LAN-TLS 本地安全绿锁**：以往局域网网页传文件，手机一打开总是弹出大红字“不安全”，并且 iOS Safari 会强制禁止网页访问原生剪贴板。EQT 实现了零配置的局域网 HTTPS 权威机构证书环回，扫码即带官方公信“绿色安全锁”，剪贴板与原生分享 API 丝滑调用。
- **🌐 标准网页端口（80/443）**：传统局域网工具喜欢用 53317 等高位冷门端口，在大学校园网、星巴克、机场或企业 Wi-Fi 下常被路由器防火墙直接封死。EQT 智能首选标准网页端口，公共网络畅通无阻。
- **🚆 断网与出差神仙技巧（个人热点即局域网）**：在没有 Wi-Fi 的高铁、航班候机室或户外，手机随手开个“个人热点”，笔记本连上，它就构成了一个完全合法的物理局域网。**不耗费任何手机流量**，照样能以 50MB/s 满速传输大文件。

---

### 4. 坦诚相告：它的边界与我的初心

作为一个认真的独立开发者，我必须诚实地说明它现阶段的边界：

- **严格局限于同一局域网**：EQT 当前是一款纯粹的局域网直传软件。设备必须在同一个 Wi-Fi 或热点下。它不是远程云盘，也不假装自己能跨城异地同步。
- **把局域网体验做到极致**：我不打算在这里兜售宏大的商业叙事。在两台设备碰头的那些场景里，能让你感到“真快、真方便、真顺手”，就是这个小工具最大的价值。

---

### 5. 公开透明的商业化规则

我希望 EQT 能够长期、健康地独立维护下去，因此制定了非常克制且体面的商业化契约：

1. **日常应急，终身免费 (Free Forever for Casual Use)**：每天提供充足的完全无限制极速传输额度，以及日常即时 Chat 体验时间。对于偶尔发个文档、倒腾几张照片的用户，免费版终身够用，**绝无任何开屏牛皮癣广告，绝无流氓后台捆绑**。
2. **专业高频用户的买断选项 (Plus License)**：如果你是视频创作者、影视后期、摄影师或混合办公极客，需要高频批量并发狂飙传输特大文件，我们提供了透明的一次性买断（Lifetime）或年费选项。没有任何诱导扣费套路，一份支持独立开发者的纯粹契约。

---

## 第二部分：官方正式英文发布稿 (English Global Launch Pitch)

> 适用平台：Product Hunt, Hacker News (Show HN), Reddit (`r/selfhosted`, `r/software`, `r/golang`), Twitter/X 官方发布贴，个人技术博客。

### Headline Options
- **Headline A (Direct Problem-Solver - Recommended)**:  
  *Why is moving files between PC, iPhone & Android in 2026 still painful? Introducing EQT: AirDrop for literally any device with zero mobile apps.*
- **Headline B (Show HN / Technical)**:  
  *Show HN: EQT – Fast cross-device LAN file transfer and ephemeral chat via QR code with zero-config local TLS (Written in Go)*
- **Headline C (Creator / Lifestyle)**:  
  *Dump 4K ProRes videos from iPhone to Windows PC in seconds. No cables, no cloud, no mobile app required.*

---

### Body Content

Hey everyone,

Today I'm thrilled (and honestly a little nervous) to introduce my first independent digital product: **EQT (Easy QR Transfer)**.

#### 1. The Genesis: Sitting 30 cm away, why does data take a trip around the globe?

Before writing the first line of code for EQT, I ran into the same infuriating friction almost daily:

- I shoot a 1.8GB 4K video on my iPhone and want to edit it on my powerful Windows rig. But **AirDrop is walled inside Apple's garden**. Cloud drives make me wait 15 minutes to upload and another 15 minutes to download. Grabbing a USB cable means dealing with flaky driver prompts.
- I configure a 200-character API token or temporary password on my desktop and need it on my phone for testing. Pasting it into Slack or Teams gets it logged by corporate compliance bots. Emailing it clutters my inbox.
- A colleague or client sits right across the desk. I want to share a 1GB project archive. Most local sharing tools demand that **the other person also installs a 50MB app from the App Store and pairs devices first**. By the time they finish installing, the flow of the conversation is ruined.

I couldn't help asking from first principles:  
**Both devices are on the exact same Wi-Fi network, sitting inches apart. Why does data have to route through a cloud server on the other side of the planet? And why should anyone be forced to install a mobile app they'll only use once a month?**

Moving data between nearby devices should be as frictionless as breathing.

---

#### 2. What is EQT?

EQT is a lightweight desktop utility (Windows, macOS, Linux) designed for **frictionless, blazing-fast local file transfers and ephemeral clipboard sharing**.

Its core philosophy is straightforward:  
**Initiate on your computer, scan the dynamic QR code with your phone camera, transfer instantly over local Wi-Fi, and close.**

It comes with 3 focused modes:

1. **Share Mode (PC ➔ Phone)**: Drop a single file, a bunch of photos, or an entire folder into EQT. A clean QR code pops up on your screen. Any phone scans it and downloads at full network speed. Folders are streamed on-the-fly as organized ZIP archives—no pre-compression disk bloat.
2. **Receive Mode (Phone ➔ PC)**: Put EQT in receive mode, scan the code from your phone, and select photos, 4K clips, or documents directly in your mobile browser. Files land directly in your chosen desktop folder at 50–100MB/s+.
3. **Chat Mode (Encrypted Local Room & Clipboard Bridge)**: Scan to open an instant, encrypted peer-to-peer room. Sync text, links, API tokens, and screenshots both ways. Tap the **'Copy to Clipboard'** button on mobile to grab passwords instantly. Once you close the desktop window, the room and all messages are permanently destroyed.

---

#### 3. Why does EQT feel so effortless?

- **📱 Zero Mobile App Required**: Your friends or teammates install **nothing**. No App Store downloads, no sign-ups, no permission prompts. Any modern phone with a stock camera and a web browser connects in 2 seconds.
- **⚡ Unleashed Gigabit LAN Speeds (10MB/s – 100MB/s+)**: 100% direct peer-to-peer transfer over your local router. It bypasses public broadband caps and won't consume a single kilobyte of mobile cellular data.
- **🔒 Zero-Config LAN-TLS (Native Green Padlock)**: Traditional browser-based LAN tools trigger scary red *"Not Secure"* warnings in mobile browsers and block native clipboard access. EQT solves this with automated trusted local TLS loopback—you get an authentic HTTPS green padlock out of the box with zero manual certificate imports.
- **🌐 Standard Web Ports (80/443)**: Most local tools pick random high ports like 53317, which campus, hotel, and office firewalls block by default. EQT intelligently binds to standard web ports to glide through strict corporate networks without hiccups.
- **🚆 The "Personal Hotspot" Hack**: Waiting at a train station or airport with no Wi-Fi? Turn on your phone's personal hotspot and connect your laptop. It forms an instant, legitimate local network. You can blast gigabytes across devices at full Wi-Fi speed without burning your cellular data allowance!

---

#### 4. Honest Boundaries & Creator Philosophy

As an indie developer, I believe in being 100% transparent about what EQT is and isn't:

- **Strictly Local Network Only**: Both devices must be on the same Wi-Fi or hotspot. EQT does not offer remote cloud relay, and it doesn't pretend to be Dropbox.
- **Do One Thing Wonderfully**: My goal isn't to build a bloated "all-in-one productivity ecosystem." If EQT can save you from reaching for a cable or waiting on slow cloud uploads during those few critical minutes of your day, it has done its job.

---

#### 5. Transparent & Fair Pricing

I want EQT to be sustainably maintained for years to come:

- **Free Forever for Casual Everyday Use**: Generous daily high-speed transfer allowances and ephemeral Chat sessions are completely free. For occasional document transfers and photo sharing, you will never have to pay a dime. **No obnoxious popup ads, no sneaky background bloatware.**
- **Plus License for Power Users**: For video editors, photographers, and developers who move massive folders and run heavy parallel transfers every day, we offer an honest annual pass ($11.99/yr) or a lifetime license ($29.99). No predatory auto-renew traps—just a clean deal to support independent software craftsmanship.

---

#### 6. Give It a Spin & Tell Me What You Think!

This is my very first independent release, and there are definitely edges left to polish. If you regularly move files between your desktop and mobile devices, I'd love for you to try it:

- 🌐 **Official Website & Download**: [https://www.eqt.net.im](https://www.eqt.net.im)
- 💬 **Feedback & Ideas**: Whether it's a bug on a specific mobile browser or a feature wish, feel free to drop a comment below or open an issue on GitHub. I read and reply to every single one!

---

## 第三部分：德语与日语国际化核心推介 (Tier-1 Localization)

### 🇩🇪 Deutsch (German Pitch — Fokus: Datenschutz & Lokales Netzwerk)

**Titel**: *Dateitransfer zwischen PC, iPhone & Android ohne Cloud. EQT: Die AirDrop-Alternative ganz ohne App-Installation.*

**Kernbotschaft**:
Warum müssen private Fotos und Passwörter über fremde Server laufen, wenn beide Geräte auf demselben Schreibtisch stehen?

- **Keine App auf dem Smartphone nötig**: Einfach mit der Standard-Kamera den QR-Code auf dem PC scannen – der Download startet direkt im Browser.
- **100% Lokales WLAN (LAN)**: Reine Peer-to-Peer-Übertragung mit voller Router-Geschwindigkeit (10–100 MB/s). Ihre Dateien berühren niemals eine Cloud.
- **Zero-Config LAN-TLS**: Echtes vertrauenswürdiges HTTPS-Zertifikat im lokalen Netz. Keine Warnmeldungen im Browser, nativer Zugriff auf die Zwischenablage.
- **Privater Chat & Zwischenablage**: Passwörter, API-Keys und Links blitzschnell zwischen Rechner und Smartphone austauschen. Nach dem Schließen des Fensters wird alles rückstandslos gelöscht.
- **Freemium & Fair**: Kostenlos für den täglichen Normalgebrauch, keine nervige Werbung, DSGVO-konform durch reinen Lokalbetrieb.

---

### 🇯🇵 日本語 (Japanese Pitch — フォーカス: アプリ不要・爆速・シンプル)

**タイトル**: *PCとスマホ間のファイル転送で、もう迷わない。アプリ不要・QRコードをかざすだけで爆速転送「EQT」*

**コアメッセージ**:
目の前にあるパソコンとスマホなのに、なぜクラウドを経由して待たなければいけないのでしょうか？

- **スマホ側のアプリインストール不要**: 標準カメラでPC画面のQRコードを読み取るだけ。ブラウザ経由ですぐにダウンロード・アップロードが完了します。
- **Wi-Fi物理フルスピード転送**: クラウドを一切経由しない純粋なローカル通信。1GB〜3GBの動画やRAW写真も、10MB/s〜100MB/s以上の超高速で劣化なくそのまま届きます。
- **安心のZero-Config HTTPS暗号化**: ローカル環境でも警告の出ない安全なHTTPS通信を実現。クリップボードのコピーもワンタップでスムーズ。
- **履歴が残らない一時チャット**: パスワードやトークン、URLをPCとスマホ間で即時共有。ウィンドウを閉じればデータは跡形もなく自動消去されます。
- **ずっと無料で日常利用可能**: わずらわしい広告はゼロ。まずは気軽にお試しください。
