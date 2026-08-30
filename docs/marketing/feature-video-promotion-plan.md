# EQT (Easy QR Transfer) — 核心功能短视频推广计划 (欧美与全球海外受众版)

在 Twitter (X)、TikTok、YouTube Shorts、Instagram Reels 等海外主流短视频平台上，“**终端生成二维码 -> 手机自带相机秒扫 -> 80MB/s 局域网物理满速 -> 跨端即时 Chat 剪贴板同步**”具有极强的**视觉冲击力与极客爽感**。

本文档面向**欧美及全球海外受众（Tier-1 市场）**，以中文为脚本底座，全面采用海外真实生活与工作流场景（如 AirDrop 无法跨 Windows/安卓、Slack 企业监控、iPhone 4K ProRes 导入 PC 剪辑等），规划了 4 支 15~30 秒的高转化分镜头脚本。

---

## 1. 短视频推广定位与视觉爽点 (Core Visual Hooks)

| 视频定位 | 核心功能点 | 海外目标受众 | 视觉爽点 (Visual "Aha!" Moment) |
| :--- | :--- | :--- | :--- |
| **视频 1: 痛点直击型** | 扫码免装 App 极速传文件 | Windows + iPhone 混合办公族、跨端极客 | 扔掉数据线，打破 AirDrop 苹果封闭围墙，终端一敲扫码即传 |
| **视频 2: 多设备并发型** | Receive & Share 多端并发 | 团队 Standup、Hackathon、会议现场 | 1 台电脑屏幕，4 部不同品牌设备（iPhone, Pixel, Mac, ThinkPad）同时扫码并发下载 |
| **视频 3: 极客私密 Chat 型** | Chat 局域网即时加密聊天 | 开发者、DevOps、隐私自建党 | 敏感 API Token 绝不上报 Slack 企业云端，两端秒级同步剪贴板，关闭即焚 |
| **视频 4: 硬核性能狂飙型** | 跑满局域网千兆物理带宽 | YouTubers、摄影师、4K 剪辑师 | 20GB iPhone 4K ProRes 视频在 85MB/s 速度下 100 秒直传 Windows PC |

---

## 2. 核心短视频分镜头脚本 (15~30s Overseas Video Scripts)

---

### 🎬 视频 1：《打破 AirDrop 苹果围墙：Windows 电脑 3 秒直连 iPhone》
* **时长**：18 秒
* **目标平台**：Twitter Video / TikTok / YouTube Shorts
* **BGM/音效**：轻快律动 Lo-Fi + 键盘敲击声

| 秒数 | 画面 (Visual) | 台词/字幕 (Voiceover / Overlay) | 画面细节说明 |
| :--- | :--- | :--- | :--- |
| **0 - 3s** | 特写：Windows 电脑想用 AirDrop 传文件，提示“No Apple device detected”，旁边放着 iPhone，红色 ❌ | “Why is AirDrop STILL locked to Apple in 2026?” (为什么 2026 年了 AirDrop 还锁在苹果全家桶？) | 直击欧美 Windows+iPhone 用户的巨大痛点 |
| **4 - 8s** | 切换到 Windows 终端输入 `eqt send ./document.pdf`（或托盘右键点击 Share），瞬间弹出一个清晰的二维码 | “Meet EQT — an open-source Go tool. Run one command to generate a local QR code.” | 展现极致轻量与极客感 |
| **9 - 14s** | 实拍：拿起 iPhone，使用 iOS 原生相机扫码，Safari 浏览器瞬间打开并以 80MB/s 满速完成下载预览 | “Zero mobile app! Any phone camera scans to download instantly over local WiFi.” | 突出“免装 App”与“内网极速” |
| **15 - 18s** | 电脑终端与手机同框，定格在 GitHub 开源仓库主页 | “100% offline & open-source. Link in the pinned reply below!” | 引导查看评论区第一条链接 |

---

### 🎬 视频 2：《震撼并发：团队会议无需 AirDrop，10台设备同时扫码下载》
* **时长**：22 秒
* **目标平台**：Twitter Video / LinkedIn / YouTube Shorts
* **BGM/音效**：震撼科技节拍音效

| 秒数 | 画面 (Visual) | 台词/字幕 (Voiceover / Overlay) | 画面细节说明 |
| :--- | :--- | :--- | :--- |
| **0 - 4s** | 场景：会议室或 Hackathon 现场，桌上摆放着 MacBook、ThinkPad、iPhone 15、Google Pixel 与 iPad | “Sharing 5GB of design assets with a mixed team of Mac, Windows & Android?” | 展现跨生态多设备分发痛点 |
| **5 - 10s** | 演示者在笔记本上运行 `eqt send ./project-assets/`，屏幕中央展示交互二维码 | “No Slack channels. No Google Drive links. Just run EQT.” | 突出摆脱云盘与聊天软件中转 |
| **11 - 17s** | 俯拍镜头：全场 4~5 只手拿着各自的 iPhone、Pixel 和 iPad 同时对准屏幕扫码，所有人手机浏览器同时并发全速下载 (85MB/s) | “Everyone scans the SAME QR code and downloads concurrently at full gigabit LAN speed!” | **极具视觉冲击力的核心卖点** |
| **18 - 22s** | 所有人设备显示“Download Complete”，大家点头微笑 | “The fastest way to share locally. Save this for your next meeting!” | 引导 Bookmark 收藏与转发 |

---

### 🎬 视频 3：《开发者专属：比 Slack 更安全的局域网私密 Chat》
* **时长**：20 秒
* **目标平台**：Twitter Video / Reddit / YouTube Shorts
* **BGM/音效**：沉浸式极客电子音效

| 秒数 | 画面 (Visual) | 台词/字幕 (Voiceover / Overlay) | 画面细节说明 |
| :--- | :--- | :--- | :--- |
| **0 - 3s** | 屏幕特写：VS Code 里的 `.env` 配置文件有一串 OpenAI API Key 和数据库密码 | “Never paste private API keys into corporate Slack or Discord DMs.” | 唤醒企业 IT 审计与隐私安全痛点 |
| **4 - 9s** | 终端敲入 `eqt chat`，手机相机扫码进入 Web 端。电脑端复制 API Key，手机端网页瞬间同步显示 | “Run `eqt chat` to spin up an ephemeral encrypted room on your local network.” | 展现 Chat 模式毫秒级跨端互通 |
| **10 - 15s** | 手机端点击“Copy to Clipboard”，并在移动端测试工具中一键粘贴运行 | “Instant bidirectional clipboard & text sync. 100% peer-to-peer, zero cloud telemetry.” | 突出双向剪贴板与 0 遥测 |
| **16 - 20s** | 终端按下 `Ctrl+C`，终端显示“Session destroyed, memory wiped” | “Close terminal, session burns instantly. Open source on GitHub!” | 强调阅后即焚与极客属性 |

---

### 🎬 视频 4：《85MB/s 跑满千兆：iPhone 4K ProRes 视频秒传 Windows 电脑》
* **时长**：16 秒
* **目标平台**：Twitter Video / TikTok / YouTube Shorts
* **BGM/音效**：速度感加速音效

| 秒数 | 画面 (Visual) | 台词/字幕 (Voiceover / Overlay) | 画面细节说明 |
| :--- | :--- | :--- | :--- |
| **0 - 3s** | iPhone 相册中勾选 3 段 4K 60fps ProRes 视频素材（显示 12.8 GB），准备导入 Windows PC 剪辑 | “Moving 12GB of 4K ProRes video from iPhone to Windows DaVinci Resolve?” | 创作者核心痛点 |
| **4 - 10s** | 手机扫码打开 EQT 网页接收端，点击上传，实时仪表盘显示 `86.4 MB/s`，进度条迅速拉满 | “Forget glitchy cables and slow cloud drives. Stream directly over Wi-Fi 6 at 85MB/s!” | 突出速度对比与实时仪表盘 |
| **11 - 16s** | Windows 电脑文件夹中瞬间出现 3 段无损 ProRes 原片，直接拖入 DaVinci Resolve 流畅剪辑 | “100% lossless & full speed. Bookmark this for your workflow! 👇 Link in comments.” | 闭环交付与转化引导 |

---

## 3. 短视频制作与海外平台发布 SOP

### 3.1 海外发布技术标准
* **字幕语言**：全英文大字硬字幕（Bold Sans-Serif 粗体无衬线，关键词如 `Zero App`, `85MB/s`, `Local LAN`, `Open Source` 加明黄色高亮）。
* **分辨率与比例**：
  - 竖屏版（9:16，1080x1920）：适配 TikTok, YouTube Shorts, Instagram Reels, Twitter Mobile。
  - 横屏版（16:9，1920x1080）：适配 Twitter Desktop, Reddit (`r/golang`, `r/selfhosted`)。
* **首帖置顶转化规范**：视频发出后 30 秒内，在评论区发布英文 First Reply 并 Pin 置顶，引导前往 GitHub 仓库与官网下载。
