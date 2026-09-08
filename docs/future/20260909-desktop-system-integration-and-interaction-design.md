# 桌面系统级深度集成与人机交互设计规范
## (Desktop System Integration & Advanced UX Architecture)

> **文档状态**：Roadmap 级未来架构规划与设计规范 (Future Design Proposal)  
> **归档日期**：2026-09-09  
> **关联模块**：`desktop/gui/`, `cmd/eqt-launcher/`, `pkg/server/`, `scripts/`

---

## 一、 第一性原理与交互愿景 (First Principles & UX Vision)

EQT 致力于成为跨端局域网传输的终极生产力工具。优秀桌面生产力工具的核心特征是：
1. **“指尖随叫随到 (Ubiquitous & Instant)”**：无需在开始菜单或深层目录中繁琐查找应用，通过全局热键和系统右键即可就地触发；
2. **“轻量无感常驻 (Zero-Distraction Background)”**：不霸占任务栏与屏幕前台，静默常驻托盘，以丰富但克制的状态微表情向用户传达连接健康度；
3. **“直觉物理交互 (Physical Intuition)”**：支持将文件随手拖到托盘或悬浮靶场，无需确认直接完成握手分发。

本规范确立 EQT 桌面端在 **系统托盘 (System Tray)**、**快捷二维码 (Quick QR HUD)**、**全域拖拽传输 (Drag & Drop)**、**系统右键菜单 (Context Menu)** 与 **全局快捷键 (Global Hotkeys)** 上的系统级架构与交互实现标准。

---

## 二、 托盘图标现代化、快捷二维码 HUD 与拖拽传输

### 1. 系统托盘图标状态机与动态微表情
托盘图标不仅是进程驻留的标识，更是传输健康度的一级晴雨表。规范定义 4 种确定性状态：

```
                ┌──────────────────────────────────────────────┐
                │             TrayState (托盘状态机)           │
                └──────────────────────┬───────────────────────┘
                                       │
       ┌──────────────────┬────────────┴─────────────┬─────────────────┐
       ▼                  ▼                          ▼                 ▼
   【IDLE】          【LISTENING】             【TRANSFERRING】     【ALERT/OFFLINE】
  常驻就绪态          监听与待扫码               高速吞吐传输中        离线或网络故障
 (自适应深浅黑白)   (右下角常驻绿点)           (流动转圈动态进度)    (橘黄色警告小角标)
```

- **动态进度环渲染 (Progress Ring)**：
  - Windows: 传输大文件时，通过 Win32 GDI+ 内存位图动态合成扇形进度环（10% 步进），直接在托盘 16x16 / 32x32 图标上展示实时总进度；
  - macOS: 利用 NSStatusItem 自定义 View 绘制原生 Retina 级微小动态扇区；
- **传输完成微震动与角标**：传输完成后展示绿勾微表情，并在 2 秒后平滑退回 IDLE 状态。

### 2. 快捷二维码悬浮面板 (Quick QR HUD Popover)
传统桌面工具在用户点击托盘时要么弹出简陋的纯文本右键菜单，要么弹出一个笨重的主窗口，割裂感极强。EQT 引入轻量级 **Quick QR HUD 悬浮卡片**：

#### 视觉与交互规范：
- **位置自适应**：精准吸附在任务栏托盘图标正上方（Windows 底部任务栏）或正下方（macOS 顶部状态栏），外围带 8px 阴影与现代半透明磨砂亚克力 (Acrylic / Mica) 材质；
- **点击外域失焦自动隐退 (Click-Away Auto-Dismiss)**：按 `Esc` 或鼠标点击卡片外部区域时，毫秒级平滑淡出，不驻留屏幕；
- **HUD 卡片内容架构**：
  ```
  +-------------------------------------------------------+
  |  EQT 极速互联                        [ 模式: Send ▼ ] |
  |  ---------------------------------------------------  |
  |             ┌─────────────────────────┐               |
  |             │                         │               |
  |             │     高清自适应二维码    │               |
  |             │       (高对比度)        │               |
  |             │                         │               |
  |             └─────────────────────────┘               |
  |  ---------------------------------------------------  |
  |  🌐 局域网地址: 192.168.1.108:9876      [ 复制链接 ]  |
  |  📶 绑定网卡: WLAN (Intel Wi-Fi 6)      [ 切换网卡 ]  |
  |  🟢 当前状态: 等待手机扫码 (0 台已连接)               |
  +-------------------------------------------------------+
  ```
- **核心组件功能**：
  - **模式快速切换 Tab**：无需进入主界面，在 HUD 顶部直接切换 `Send / Receive / Chat`，二维码原地重绘刷新，服务无缝热切换；
  - **网卡快捷下拉**：遇到双网卡或开启了 WSL 虚拟网卡导致手机无法连通时，直接在 HUD 底部下拉选择物理 Wi-Fi 网卡，即刻更新二维码，降低用户排障门槛。

### 3. 全域拖拽传输 (Drag-and-Drop & Floating Dropzone)
实现“所见即所传”的物理直觉：

```
[用户在桌面选中 3 个文件] ──────► 拖拽至屏幕右下角托盘图标
                                          │
                                          ▼
                ┌──────────────────────────────────────────────────┐
                │ 托盘图标上方瞬间展开半透明 Dropzone 悬浮靶场     │
                │ 提示: “松开鼠标立即发起局域网极速分享”          │
                └─────────────────────────┬────────────────────────┘
                                          │ 用户松开鼠标
                                          ▼
                ┌──────────────────────────────────────────────────┐
                │ 1. 自动计算文件总大小 (如 45.2 MB)               │
                │ 2. 自动启动后台 Send 模式                        │
                │ 3. 自动弹出 Quick QR HUD，二维码即刻呈现         │
                └──────────────────────────────────────────────────┘
```

- **主界面全屏 Drop 蒙层**：当主窗口处于前台时，拖拽任意文件进入窗口，窗口即刻触发渐变毛玻璃蒙层与虚线靶心动效，展示文件数量与“释放以发送”。

---

## 三、 系统上下文右键菜单深度优化 (System Context Menu)

### 1. 业务场景与用户意图
- **文件/多文件/文件夹右键**：用户在系统资源管理器中选定文件，右键菜单中直接出现带有 EQT 品牌小图标的选项：
  - `通过 EQT 发送 (Send via EQT)`
- **文件夹空白处右键**：用户浏览到某个工作目录，右键空白处直接出现：
  - `在此开启 EQT 接收 (Receive Here via EQT)`

### 2. 跨平台底层注册规范
- **Windows (10 & 11)**：
  - **Windows 10 / 传统菜单**：
    - 文件/多文件：注册 `HKCU\Software\Classes\*\shell\EQT.Send`
    - 文件夹：注册 `HKCU\Software\Classes\Directory\shell\EQT.Send`
    - 文件夹空白处：注册 `HKCU\Software\Classes\Directory\Background\shell\EQT.Receive`
  - **Windows 11 现代菜单 (一级菜单直达)**：
    - 传统注册表项在 Windows 11 下会被折叠进“显示更多选项”；
    - 采用 Sparse Package（稀疏清单签名包）与轻量 COM `IExplorerCommand` 接口集成，使 EQT 原生驻留 Windows 11 一级右键菜单，与复制、粘贴并列，极速呼出。
- **macOS (Finder)**：
  - 基于 Finder Sync 扩展与 macOS 快捷操作 (Quick Actions / Services)，在 Finder 右键呈现 `Share via EQT` 与 `Receive Files Here`。
- **Linux (GNOME / KDE)**：
  - 遵循 FreeDesktop 规范，在 `~/.local/share/kio/servicemenus/` (KDE Dolphin) 与 `~/.local/share/nautilus-python/extensions/` (GNOME Files) 安装对应轻量脚本。

### 3. 单实例守护进程与本地 IPC 管道通信架构
右键菜单集成最致命的工程陷阱是：**每次右键调用都启动一个新的可执行程序，导致多进程打架、端口占用冲突与黑框弹窗**。

EQT 采用 **IPC 代理分发模型 (Proxy-Daemon Model)**：

```
[系统资源管理器右键点击]
         │
         ▼
[执行轻量级代理程序 eqt-launcher.exe / eqt-cli.exe --ipc-send "D:\Files\Report.pdf"]
         │
         ├──► 步骤 1: 尝试连接常驻主进程的本地 IPC 管道 (Named Pipe / Unix Domain Socket)
         │
         ├──► 【场景 A: 主进程已常驻托盘】
         │      通过 IPC 发送 JSON 报文:
         │      {"action": "send", "paths": ["D:\\Files\\Report.pdf"], "timestamp": 1788880000}
         │      主进程接收指令 -> 激活托盘 -> 瞬间弹出 Quick QR HUD 并进入发送就绪态
         │      轻量级代理即刻退出 (耗时 < 15ms，零黑框，零多余端口)
         │
         └──► 【场景 B: 主进程未运行】
                轻量代理以后台静默方式拉起 EQT 主程序，并将文件参数无缝传入
```

#### 本地 IPC 管道契约：
- **Windows 管道名称**：`\\.\pipe\eqt_runtime_ipc_<UserHash>`
- **macOS / Linux Socket 路径**：`$XDG_RUNTIME_DIR/eqt.sock` 或 `~/.local/state/eqt/eqt.sock`
- **安全防范**：管道绑定用户级别权限，仅接受当前登录用户的本地进程通信，严格校验文件路径合法性，阻断恶意路径注入。

---

## 四、 全局快捷键支持与即时模式唤醒 (Global Hotkeys)

### 1. 快捷键定义矩阵与默认方案
为了满足键盘流高效用户的“盲操”需求，预设一套无冲突、符合现代操作系统交互习惯的全局热键方案（用户可在设置面板中自由修改）：

| 默认全局快捷键 | 对应动作与响应行为 |
| :--- | :--- |
| **`Alt + Shift + S`** (Win/Linux)<br>**`Opt + Shift + S`** (macOS) | **即时发送 (Quick Send)**：瞬间呼出轻量原生文件选择器，用户确定文件后即刻在托盘弹出 Quick QR HUD |
| **`Alt + Shift + R`** (Win/Linux)<br>**`Opt + Shift + R`** (macOS) | **即时接收 (Quick Receive)**：就地拉起 Receive 模式并展开托盘二维码浮窗，等待手机上传 |
| **`Alt + Shift + C`** (Win/Linux)<br>**`Opt + Shift + C`** (macOS) | **即时协同 (Toggle Chat)**：毫秒级置顶呼出 / 隐藏 Chat 桌面窗口，实现随叫随走的跨端局域网通信 |
| **`Alt + Shift + Q`** (Win/Linux)<br>**`Opt + Shift + Q`** (macOS) | **即时二维码 (Toggle Quick QR HUD)**：快速在任务栏托盘上方显示或隐藏当前二维码面板 |

### 2. 底核热键注册与冲突自适应退避机制
- **底核实现**：
  - Windows: 基于 Win32 `RegisterHotKey` / `UnregisterHotKey` 监听全局键盘事件；
  - macOS: 基于 Cocoa `NSEvent.addGlobalMonitorForEvents` 或 Carbon `RegisterEventHotKey`；
  - Linux: 优先通过 FreeDesktop `org.freedesktop.portal.GlobalShortcuts` (适配 Wayland 现代桌面)；X11 环境降级为 `XGrabKey`。
- **冲突防呆**：
  - 若用户设定的快捷键被 IDE、聊天软件（如 QQ、微信）或其他系统软件抢占，系统注册失败时**禁止抛出致命错误**；
  - 托盘图标展示微弱黄色提示，并在桌面端偏好设置面板标注“`Alt+Shift+S` 已被其他程序占用，请点击重新配置”，引导用户一键录制新组合键。

### 3. 窗口毫秒级呈现：“冷热解耦”缓存架构
由于 Chromium / WebView2 / WebKit 进程初次创建需要耗费 200~500ms，若用户按下快捷键才开始“冷启动窗口”，会有明显的卡顿顿挫感。

- **预热机制 (Window Warmup)**：主进程启动时，在后台以隐藏模式（`Visible: false`）预初始化好 Chat 窗口与 Quick QR 浮窗 DOM；
- **唤醒即呈现**：快捷键触发时，底层仅执行 Win32 `ShowWindow(SW_SHOW)` / `BringWindowToTop()`，呼出耗时 <20ms，真正达成丝滑无感的“即叫即显”。

---

## 五、 商业化分级规划 (Free vs Plus/Pro Tier)

根据产品授权与商业化体系（`docs/payment/` 与 `docs/crypto/`）：

| 桌面系统集成能力 | Community 社区免费版 | Pro / Plus 商业版 |
| :--- | :--- | :--- |
| **托盘图标与 HUD** | 基础黑白/彩色静态图标，标准托盘浮窗 | **动态扇形进度环动画**、多种精美毛玻璃 HUD 主题皮肤 |
| **拖拽传输 (Drag-Drop)** | 支持拖入主界面传输 | **全域托盘图标靶场**、桌面常驻 Mini 悬浮挂件 |
| **系统右键菜单集成** | 支持标准文件“通过 EQT 发送” | **Windows 11 一级菜单原生驻留**、文件夹空白处“在此接收”、高级右键批量宏规则 |
| **全局快捷键 (Hotkeys)** | 提供 4 组固定预设快捷键 | **全键位自由定制**、支持快捷键联动自定义目录与指定网卡配置 |

---

## 六、 实施与演进路线 (Roadmap & Milestones)

1. **Phase 1 (IPC 管道与轻量 CLI 桥接)**：
   - 落地 `pkg/ipc/` 跨平台本地管道通信模块；
   - 改造 `cmd/eqt-launcher`，支持 `--ipc-send` 与 `--ipc-receive` 参数，验证多实例调用自动路由至常驻托盘主进程。
2. **Phase 2 (系统右键菜单脚本化安装器)**：
   - 编写 Windows 注册表一键注入与卸载脚本（通过 Go 运行时受控写入 `HKCU`，无需管理员权限 UAC 弹窗）；
   - 提供桌面端设置面板中的“启用/关闭系统右键集成”开关。
3. **Phase 3 (全局热键监听与 Quick QR HUD 浮窗)**：
   - 封装 Go 语言跨平台热键注册器；
   - 开发轻量级 Quick QR HUD 独立浮动窗口，打通网卡快速切换与模式瞬时切换。
4. **Phase 4 (全域拖拽靶场与托盘动效升级)**：
   - 引入 Windows Shell DropTarget 接口，实现托盘图标级文件接收。
