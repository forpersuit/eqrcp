# EQT (Easy QR Transfer) — Twitter (X) 推广策略与多维文案资产库

本文档为 EQT 在 Twitter (X) 平台上的官方推广全案。内容围绕**核心功能（Chat 局域网即时加密通信、Receive & Share 多设备并发互传、免数据线极简轻便）**与**目标用户身份角色（程序员、视频创作者、跨端办公白领、学生学者）**多维展开，并为**每条推文配备了详细的效果配图视觉设计指南**。

全部文案均基于**中文打底模板**，并提供**英语、日语、德语等多语种国际化转译**。所有推文严格经过物理字符长度校验（<= 280 单元）并遵循 Twitter 推荐算法法则（正文 100% 零外链，链接全部在评论区第一条沉淀）。

---

## 1. Twitter (X) 算法推荐逻辑与发推黄金法则

### 1.1 零外链降权原则 (No-Link Penalty)
* **算法机制**：Twitter 对正文中包含外链（如 github.com、http 链接）的推文施加重度降权（曝光量减少 50%~80%）。
* **执行规范**：**所有主帖正文严禁出现任何链接**。所有 GitHub 开源地址、官网、文档链接统一在**评论区第 1 条 (First Reply / 置顶评论)** 中发布，正文尾部仅保留指引符号（如 `👇 开源地址与下载见评论区第1条`）。

### 1.2 互动权重倍率 (Engagement Multipliers)
* 🔖 **Bookmark（书签/收藏） [~30x - 50x 权重]**：算法最高权重点赞指标。文案中高频自然植入“建议先 Bookmark 收藏防丢”、“建议收藏备用”。
* 🔁 **Retweet / Repost（转发） [~20x 权重]**：高扩散指标，引导转发给饱受微信传文件困扰的同事和朋友。
* 💬 **Reply（评论互动） [~20x - 50x 权重]**：结尾以开放式痛点问题或投票引发讨论，提升推文驻留时长 (Dwell Time)。

### 1.3 字符计量标准与物理校验
* Twitter 计量标准：单字节 ASCII（英文/数字/半角符号）计 **1 单元**，双字节 CJK（中日韩汉字/全角符号/Emoji）计 **2 单元**。单条推文上限为 **280 单元**（纯中文约 140 字）。
* 本文所有推文均经自动化脚本校验，字符数全部落在 **200 ~ 276 单元**的安全区间。

---

## 2. 核心功能推文矩阵与效果配图指南 (Feature-Driven Matrix)

---

### 🔥 主打功能 A：Chat 局域网即时加密聊天与剪贴板同步 (Star Feature)

> **定位**：解决电脑与手机间高敏感信息（API Token、密码、代码、多张截图）的安全互通，会话关闭即焚，零云端扫描。

#### 📝 推文文案 (中文)
```text
平时电脑手机互传 API Token、密码或代码，还在用微信？

• 微信不安全、易被云端扫描留痕
• 剪贴板跨端不同步
• 离开工位忘记退微信隐患大

试试 EQT Chat：
终端敲一行命令生成临时加密房间，手机扫码秒连！
两端文字、代码、截图即时双向互通，关闭即焚。

👇 开源地址与安装见评论区第1条
```
* **字符数**：274 / 280 单元 (安全)
* **外链检查**：无外链 (通过)

#### 🎨 效果配图设计指南 (Visual Guide)
* **配图构图**：**左电脑右手机 16:9 双拼对比图**。
  - **左半屏（PC 侧）**：黑色深色终端中执行 `eqt chat`，显示精美的 ASCII 二维码，旁边嵌有 VS Code 代码编辑器高亮显示的一串 API Key。
  - **右半屏（手机侧）**：手机浏览器打开的 EQT Chat 极简聊天界面，清晰展示刚才复制的 API Key 已瞬间同步至对话气泡中，并带有一键“复制到剪贴板”高亮按钮。
  - **视觉焦点**：画面中央带有“局域网点对点直连 · 0 云端残留”绿色盾牌安全徽章。

#### 💬 评论区第 1 条 (First Reply)
```text
🔗 开源项目地址: https://github.com/forpersuit/eqt
官网 & 文档: https://eqt.net.im

💻 一行命令快速体验 Chat 模式:
eqt chat --browser

完全开源、纯 Go 单二进制文件，断网也能在局域网内加密互传！求个 Star ⭐️ 支持！
```

---

### 🌐 次主打功能 B：Receive & Share 多设备局域网并发传输

> **定位**：开会、聚会、家庭场景下，1 台电脑向多部手机同时下发大文件，或多部手机同时向电脑汇总照片，跑满内网千兆。

#### 📝 推文文案 (中文)
```text
给办公室开会或聚会朋友传大文件，不用一个个建群：

① 电脑输入 `eqt send ./photos/`
② 全场多台 iPhone、安卓同时扫同一个二维码
③ 所有人并发跑满内网千兆带宽极速下载！

不加好友、不建群、手机 0 安装。

建议【Bookmark 收藏】备用，👇 开源地址见评论区
```
* **字符数**：226 / 280 单元 (安全)
* **外链检查**：无外链 (通过)

#### 🎨 效果配图设计指南 (Visual Guide)
* **配图构图**：**俯拍/透视场景实拍风格图**。
  - **画面中心**：一台发光的笔记本电脑，屏幕中央显示大号交互式二维码。
  - **画面四周**：环绕着 3~4 台不同品牌与系统的移动设备（iPhone 15、Google Pixel、华为 Mate、iPad），所有设备均使用原生相机/浏览器对准屏幕扫码。
  - **UI 状态**：每台手机屏幕上都显示着正在全速下载的进度条（标注 `82.4 MB/s`），展现多端并发传输的震撼感。

#### 💬 评论区第 1 条 (First Reply)
```text
🔗 GitHub 仓库: https://github.com/forpersuit/eqt
支持 Windows / macOS / Linux 全平台！

💡 小贴士：局域网内任意手机无需安装任何 App，原生浏览器打开即下，极度适合开会临时分发资料！
```

---

## 3. 用户身份与真实应用场景矩阵 (Persona & Use-Case Matrix)

---

### 👨‍💻 场景 1：全栈/移动端开发者与 DevOps 工程师
* **传输具体内容**：`.apk` / `.ipa` 测试安装包、`crash.log` 崩溃日志、`id_rsa.pub` 公钥、OAuth 调试 Callback URL、JSON 响应报文。

#### 📝 推文文案 (中文)
```text
写代码/测移动端时，如何一秒把打包好的 APK 和日志丢到测试机？

告别数据线插拔和 ADB 报错：
• 终端敲 `eqt app.apk` 弹出二维码
• 测试机相机一扫直接安装
• 敲 `eqt chat` 两端互甩 JSON 与崩溃日志

单二进制 Go 神器，0 依赖开箱即用。

👇 GitHub 仓库与体验见评论区置顶
```
* **字符数**：239 / 280 单元
* **效果配图指南**：
  - **画面**：开发桌面视角。显示 VS Code / GoLand 终端刚刚编译出 `build.apk`，输入 `eqt app.apk` 后打印二维码；旁边放置的 Android 测试机屏幕显示“正在从局域网安装应用”卡片。

---

### 📹 场景 2：自媒体创作者、摄影师与剪辑师
* **传输具体内容**：手机拍摄的 4K 60fps ProRes / HDR 视频片段、无损 RAW 照片集、CapCut / Premiere 工程压缩包。

#### 📝 推文文案 (中文)
```text
手机拍了 20GB 的 4K 视频，怎么最快丢到电脑剪辑？

❌ 微信传输：压缩画质成渣
❌ 网盘中转：上传下载各耗半天
❌ 数据线：找转换头与驱动识别繁琐
✅ EQT 扫码：内网 80MB/s 跑满千兆，原画无损直传！

纯本地局域网点对点，不耗公网流量。

建议先【收藏】防丢，👇 开源地址见评论区
```
* **字符数**：266 / 280 单元
* **效果配图指南**：
  - **画面**：对比风格图。左侧展示“微信视频画质被压缩马赛克/网盘限速 50KB/s 红色告警”；右侧展示“EQT 85MB/s 绿色满速仪表盘 + 电脑端原画 4K 视频无损播放”。

---

### 💼 场景 3：跨平台混合办公白领与远程工作者
* **传输具体内容**：PDF 合同协议、PPT 演示文稿、客户临时长文案、手机验证码与跨端剪贴板。

#### 📝 推文文案 (中文)
```text
Windows 电脑 + iPhone，如何拥有比 AirDrop 还爽的互传体验？

同一 WiFi 下：
• 电脑托盘右键选文件生成二维码
• iPhone 自带相机一扫秒存相册
• 手机向电脑回传大文件，扫码直接选

无需安装手机 App，打破苹果生态壁垒！

👇 开源项目与下载见评论区第1条
```
* **字符数**：243 / 280 单元
* **效果配图指南**：
  - **画面**：现代整洁办公桌面。Windows 11 任务栏右键托盘点击“EQT Share”，屏幕跳出二维码；iPhone 相机取景框扫码后，Safari 浏览器无缝预览高清 PDF 合同。

---

### 🎓 场景 4：高校学生、科研学者与考研党
* **传输具体内容**：iPad 手写笔记截图、论文文献 PDF、实验采集 `.csv` 数据集、课堂板书实拍照片。

#### 📝 推文文案 (中文)
```text
平板手写笔记、文献 PDF 怎么一键回传 Windows 电脑整理？

用 EQT 局域网接收模式：
• 电脑敲 `eqt receive` 生成专属接收码
• 平板相机一扫打开网页，批量上传几十篇论文与高清课件
• 电脑端瞬间收到原文件，自动分门别类

免装 App、不占云盘容量。

👇 开源体验见评论区
```
* **字符数**：244 / 280 单元
* **效果配图指南**：
  - **画面**：iPad 上 GoodNotes/Notability 手写笔记界面与 Windows 电脑资料夹并列，中间为 EQT Web 上传成功列表，清晰展示“批量上传 30 个 PDF 成功”。

---

## 4. 官方主打 6 推 Thread (Official Launch Thread — 中文标准底座)

> **定位**：用于官方账号置顶（Pin to Profile）或重大版本发布的完整深度科普串推。

---

### 🧵 Tweet 1/6 (Hook & 痛点共鸣)
```text
💻 跨设备传文件有多痛苦？
• 微信传图被二度压缩
• AirDrop 无法跨 Windows/安卓
• 云盘上传再下载，速度被卡几十K

用 Go 写了个局域网跨端互传工具【EQT】：
终端敲一行命令，手机扫码直接传，无需安装任何 App。

🧵 完整特性与设计思路：1/6
```
* **配图**：终端二维码 + 手机扫码双拼高清动图 (GIF)。

---

### 🧵 Tweet 2/6 (核心亮点 1：免装 App 扫码即用)
```text
✨ 1. 手机端零安装，扫码即用

手机不需要下载任何多余客户端：
① 电脑终端输入 eqt myfile.zip
② 终端自动打印交互二维码
③ 手机相机或浏览器一扫，直接开始超高速下载/上传

哪怕借用同事手机，也能5秒内完成交接。2/6
```
* **配图**：iPhone 自带原生相机扫码直出 Safari 下载界面截图。

---

### 🧵 Tweet 3/6 (核心亮点 2：千兆极速与隐私)
```text
⚡ 2. 跑满局域网千兆带宽

不走任何公网服务器中转，不限速不留痕：
• 传输速度只取决于你的内网路由器与网卡（轻松跑满 50MB/s - 100MB/s）
• 4K 视频、几 GB 的工程压缩包眨眼搞定
• 完全离线可用，断网环境下依然稳定互传

真正把内网带宽利用到极致。3/6
```
* **配图**：85MB/s 局域网大文件传输速度曲线与时间对比表。

---

### 🧵 Tweet 4/6 (核心亮点 3：局域网 Chat 临时房间)
```text
💬 3. 局域网端到端隐私聊天室 (Star Feature)

不仅是传文件，还内置了轻量局域网 Chat：
• 电脑输入 eqt chat，生成独立加密临时房间
• 手机电脑文字、多图、剪贴板无缝双向互通
• 数据纯本地点对点流动，绝不上传云端，彻底告别隐私泄露

临时发口令、长文本、Token 极度丝滑。4/6
```
* **配图**：EQT Web 聊天室界面，展示代码高亮、多图预览与剪贴板一键粘贴。

---

### 🧵 Tweet 5/6 (核心亮点 4：跨平台与架构)
```text
🛠️ 4. 极简架构与跨平台支持

基于 Go 语言原生开发，极小内存占用：
• 全平台覆盖：Windows、macOS、Linux/WSL
• 支持 CLI 命令行、桌面 GUI、系统托盘常驻与右键菜单
• 支持 HTTPS 自定义证书与多网卡智能绑定

极客在终端敲命令，小白用桌面托盘点右键，各自舒适。5/6
```
* **配图**：Windows 托盘 GUI 与 Linux 终端 CLI 并排展示图。

---

### 🧵 Tweet 6/6 (收尾互动 & 引导收藏)
```text
🔥 如果你也受够了各种云盘限速与跨平台传输壁垒：

• 欢迎【转发】并【Bookmark 收藏】此推文备用
• 你平时跨端传文件用什么？欢迎在评论区交流吐槽！

👇 开源项目地址与一键安装命令见【评论区第一条】：6/6
```
* **行动指令**：引导 Bookmark、Retweet 与评论区引流。

---

### 💬 评论区第 1 条跟帖 (First Reply)
```text
🔗 项目已在 GitHub 完全开源，欢迎 Star 支持 ⭐️

📦 快速上手（macOS / Linux / Windows）：
• GitHub: https://github.com/forpersuit/eqt
• 官网 & 文档: https://eqt.net.im

💻 一行命令即刻体验：
go install github.com/forpersuit/eqt@latest
eqt send ./your-file.pdf

欢迎体验并提出 Issue / PR 意见！
```

---

## 5. 多语种国际化转译矩阵 (Multilingual Translation Matrix)

> 以中文高转化底座为基准，严格转译并校验字符长度，适配欧美、日本等高价值受众。

---

### 🇺🇸 英语篇 (English - US / Global Tech Twitter)

#### 🧵 EN Thread Hook (265 / 280 units)
```text
Cross-device file sharing is still painful:
• AirDrop is Apple-only
• Cloud drives throttle bandwidth
• Chat apps compress media

I built EQT — a blazing-fast local LAN transfer & chat tool in Go.

Scan terminal QR code, transfer instantly. No phone app. 🧵 1/5
```

#### 💬 EN Star Feature: Chat Mode (268 / 280 units)
```text
Sending API keys, tokens or code to your phone?

• Cloud sync leaves traces on remote servers
• Work chats are monitored

Try EQT Chat:
Scan terminal QR code. Instant bidirectional text, clipboard & photo sync over local LAN. Zero cloud.

👇 GitHub link in 1st reply
```

#### 🌐 EN Multi-Device Concurrency (276 / 280 units)
```text
Sharing files with multiple teammates in a meeting without AirDrop:

1. Run `eqt ./assets/` on PC
2. Multiple iPhones & Androids scan the SAME QR code
3. Everyone downloads concurrently at full local speeds (80MB/s)!

No accounts, zero mobile app.

RT & Bookmark! 👇 GitHub repo in 1st reply
```

#### 💬 EN 1st Reply (First Comment)
```text
🔗 EQT is 100% open source on GitHub:
👉 https://github.com/forpersuit/eqt

📦 Install via Go:
`go install github.com/forpersuit/eqt@latest`

Available for Windows, macOS, and Linux. If you find this helpful, dropping a ⭐️ on GitHub would mean the world!
```

---

### 🇯🇵 日语篇 (Japanese - Tech & Office Focus)

#### 📝 日语高转化推文 (245 / 280 units)
```text
Windows PCとスマホ間で写真や大容量ファイルを最速転送：

• アプリのインストール不要
• クラウド経由なし・データ完全ローカル
• PCのQRコードをカメラで読むだけ
• Wi-Fi物理最高速度で爆速転送

AirDrop不要でWindowsでも快適！

👇 リンクはリプライ欄へ
```

#### 💬 日语评论区第 1 条 (1st Reply)
```text
🔗 GitHubリポジトリ（オープンソース）:
👉 https://github.com/forpersuit/eqt

Windows / Mac / Linux対応。スマホはブラウザさえあればアプリ追加不要です！⭐️応援よろしくお願いします！
```

---

### 🇩🇪 德语篇 (German - Privacy & Local Speed Focus)

#### 📝 德语高转化推文 (270 / 280 units)
```text
Dateien zwischen PC & Handy übertragen ohne Cloud:

• 100% lokal im WLAN (bis 100 MB/s)
• Kein Upload auf fremde Server
• QR-Code im Terminal scannen & direkt laden
• Keine App auf dem Smartphone nötig

Open-Source Tool in Go.

👇 GitHub-Link & Infos im 1. Kommentar
```

#### 💬 德语评论区第 1 条 (1st Reply)
```text
🔗 Vollständig Open Source auf GitHub:
👉 https://github.com/forpersuit/eqt

100% datenschutzkonform, keine Cloud-Speicherung, keine Telemetrie. Star auf GitHub willkommen! ⭐️
```

---

## 6. 短视频动态推广联动计划

动态视觉与高转化短视频分镜头脚本（15~30 秒，涵盖扫码实操、多设备并发、Chat 剪贴板即时同步与 80MB/s 性能狂飙），请参阅独立专项文档：  
👉 **[EQT 核心功能短视频与动态视觉推广计划](feature-video-promotion-plan.md)**
