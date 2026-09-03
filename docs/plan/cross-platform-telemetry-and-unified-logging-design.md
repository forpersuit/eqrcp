# EQT 跨端全链路统一遥测与日志回传系统架构设计方案
# (Cross-Platform Unified Telemetry & Logging Architecture Design)

> **版本**: v1.0  
> **状态**: 方案设计中 (Draft / Pending Implementation)  
> **作者**: EQT Core Team  
> **日期**: 2026-09-03  
> **目标**: 依据第一性原理（First Principle）与工业级日志最佳实践，打通桌面端调度内核、Go 服务端传输引擎、以及移动端（手机浏览器前端）的三端运行信息回传链路，实现统一汇流、结构化存储与 GUI 应用内快速诊断。

---

## 一、背景与现状痛点分析 (Context & Problem Statement)

当前 EQT 支持 Send（分享下载）、Receive（接收上传）、Chat（双向会话）三种核心局域网传输模式，并已上线基于自建权威 DNS 的官方通配符 LAN-TLS 回环加密（`*.direct.eqt.net.im`）。

但在用户排查网络传输问题、设备连接中断或移动端体验故障时，现有的日志体系存在以下**四大结构性断点（甚至处于黑洞状态）**：

```text
[移动端手机浏览器]          [Go HTTP 服务端]                [桌面 Agent 调度]          [GUI 桌面主进程]
  Safari / Chrome            server.Server                  desktopAgent              eqt-desktop.exe
         │                         │                              │                         │
         ├─ console.log(前端报错)  │                              │                         │
         │  (仅留在手机本地)       │                              │                         │
         │  ❌ 无回传通道          │                              │                         │
         │                         │                              │                         │
         │                         ├─ log.Printf(标准库)          │                         │
         │                         │  [Download Start / Chunk]    │                         │
         │                         │  ❌ 未重定向，全进 os.Stderr │                         │
         │                         │     (Windows GUI 无控制台丢弃)│                         │
         │                         │                              │                         │
         │                         │                              ├─ agent.log.Infof        │
         │                         │                              │  (Writer 为空，进 Stdout)│
         │                         │                              │  ❌ 同样丢失            │
         │                         │                              │                         │
         ▼                         ▼                              ▼                         ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 GUI 端 desktop.log (实际现状)                                  │
│                                                                                               │
│  - fileLogger.enabled 默认关闭（未勾选 DebugLog 则不写入）                                    │
│  - 仅记录 "EQT GUI Starting..." 和少量 Wails 内部启动日志                                     │
│  - 移动端接入、下载开始/进度/完成、上传分块、网络中断、手机端环境信息：100% 缺失！           │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 具体断点清单：
1. **服务端核心业务日志断点（标准库未重定向）**：
   [`pkg/server/server.go`](../../pkg/server/server.go) 中包含了极其详尽的移动端接入、下载 Range、流式进度、完成状态（`[EQT Server] [Download Start]` 等），但均使用 Go 标准库 `log.Printf`。由于未调用 `log.SetOutput`，在 Windows GUI 运行时（`-H=windowsgui`），日志全部输出到无挂靠控制台的 `os.Stderr` 而被操作系统静默丢弃。
2. **桌面调度内核日志断点（Agent Writer 为空）**：
   [`desktop/gui/agent.go`](../../desktop/gui/agent.go) 中的 `agent.log` 使用 `logger.New(flags.Quiet)` 创建，其内部 `io.Writer` 为 `nil`，仅调用 `fmt.Printf`，同样在无控制台 GUI 环境下全部丢失。
3. **文件写入门槛过严（常态化运行不落盘）**：
   [`desktop/gui/main.go`](../../desktop/gui/main.go) 中 `FileLogger.enabled` 仅在 `DebugLog || DevMode` 为 true 时才开启。普通用户在遇到问题时，`desktop.log` 文件内空空如也，失去排查价值。
4. **移动端浏览器前端运行态失联**：
   移动端打开下载/上传页面时，手机浏览器的能力侦测（如 `isSecureContext`、`navigator.share` 支持）、用户点击行为、网络重试报错等只在移动端手机控制台打印，桌面端毫无感知。
5. **排查交互体验脱节**：
   GUI 端的日志项只能通过外部操作系统编辑器打开系统深处的 Cache 目录，缺乏应用内即时查看和一键复制排查报告的能力。

---

## 二、第一性原理与设计准则 (First Principles & Best Practices)

根据分布式与桌面端工程最佳实践，本方案确立以下核心设计原则：

1. **绝对非阻塞与零损耗 (Zero-Overhead & Non-Blocking)**：
   - 移动端浏览器上报必须采用 `navigator.sendBeacon`（或异步低优先级 `fetch`），页面卸载或挂起时不丢日志，且绝不抢占主传输带宽；
   - 服务端遥测接收端点必须在内存中快速校验（限制请求体 ≤ 32KB），通过无锁/轻量队列快速返回，响应时延 ≤ 1ms，绝不阻塞流式传输主线程。
2. **单一真理源与统一汇流 (Unified Log Sink)**：
   - 全局建立单一日志写入流，通过 `io.MultiWriter` 将 Go 标准库 `log`、`desktopAgent.log`、`server.Server` 业务日志以及移动端回传的 `[CLIENT-LOG]` 汇聚到统一的 `desktop.log`。
3. **常态化分级记录 (Layered & Always-On Baseline)**：
   - **基线级别（INFO / WARN / ERROR）常态化落盘**：无论用户是否开启调试开关，任何设备接入、传输启停、传输结果与报错都必须记录；
   - **调试级别（DEBUG / TRACE / RAW_PACKET）**：由 `DebugLog` 控制，防刷屏与性能损耗。
4. **统一结构化日志格式 (Structured Log Schema)**：
   统一遵循标准格式：
   `[时间戳] [级别] [来源] [会话/客户端ID] [类别] 消息内容 | key=value ... (设备上下文)`
5. **最小权限、脱敏与隐私安全 (Privacy & Security)**：
   - 严禁打印证书私钥、凭证签名、用户文件内私密内容；
   - URL Token 截断保留前后 6 位，文件名截断保留 60 字符；
   - 遥测端点实施单 IP 频率限制（Rate Limiting），防止恶意日志洪泛（Log Flooding）。
6. **存储配额与自动轮转 (Log Rotation & Quota Control)**：
   - 单文件上限 10MB，自动轮转保留 3 个归档（`desktop.log.1`、`desktop.log.2`），全局日志磁盘占用严格约束在 30MB 以内。

---

## 三、总体架构与链路设计 (System Architecture)

```mermaid
sequenceDiagram
    autonumber
    participant M as 移动端浏览器 (Mobile Web)
    participant S as EQT HTTP 服务端 (Go Server)
    participant A as 桌面调度内核 (desktopAgent)
    participant L as 全局统一汇流器 (FileLogger)
    participant F as 物理磁盘 (desktop.log)
    participant G as 桌面端 GUI (Wails Frontend)

    Note over M,G: 阶段一：模式启动
    G->>A: 发起任务 a.Share() / Receive() / Chat()
    A->>L: [INFO] [GUI] runTask started (action, bind, tls)
    A->>S: 启动服务 Server.New()
    S->>L: [INFO] [SRV] Server listening at 192-168-0-201.direct...

    Note over M,G: 阶段二：移动端扫码接入
    M->>S: HTTP GET /send/<token>
    S->>L: [INFO] [SRV] Client Connected (IP: 192.168.0.50, UA: iPhone)
    M->>M: 页面加载完成，侦测环境 (SecureContext, ShareAPI)
    M-->>S: POST /client-log (sendBeacon: PAGE_LOAD)
    S->>L: [INFO] [CLIENT] [a1b2c3] PAGE_LOAD Safari ready (iOS 17.4)

    Note over M,G: 阶段三：文件传输执行
    M->>S: 发起流式下载 / Tus 分块上传
    S->>L: [INFO] [SRV] [Download Start] File=demo.mp4, Size=1.2GB
    M-->>S: 发生异常 (网络超时/用户取消/落地失败)
    M-->>S: POST /client-log (sendBeacon: ERROR / INTERRUPT)
    S->>L: [WARN] [CLIENT] [a1b2c3] Transfer error (Abort/Quota)
    S->>L: [INFO] [SRV] [Download Complete] 1.2GB / 100% OK

    Note over L,F: 阶段四：物理落盘与应用内排查
    L->>F: 统一格式追加写入 (带 10MB 轮转保护)
    G->>L: a.GetLogTail(200) 读取最新日志
    G->>G: GUI 应用内日志面板直接呈现并支持一键导出
```

---

## 四、核心模块规格与详细实现方案

### 1. 移动端遥测探针规格 (Mobile Telemetry Client Probe)

在所有移动端页面模板（`pkg/pages/` 下的 `upload.tmpl.html`、`chat.tmpl.html` 及 Send 页面）中引入极轻量（< 2KB）的原生 JS 遥测探针模块 `telemetry.js`：

#### 1.1 探针接口定义
```javascript
// window.__eqt_telemetry
function reportLog(level, category, message, details = {}) {
    const payload = {
        client_id: getOrCreateClientID(), // 本地 sessionStorage 存储的 6 位随机串
        timestamp: Date.now(),
        level: level,                     // "INFO" | "WARN" | "ERROR"
        category: category,               // "PAGE_LOAD" | "ACTION" | "TRANSFER" | "SAVE" | "NETWORK"
        message: message,
        details: details,
        user_agent: navigator.userAgent
    };

    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    if (navigator.sendBeacon) {
        navigator.sendBeacon('/client-log', blob);
    } else {
        fetch('/client-log', {
            method: 'POST',
            body: blob,
            keepalive: true,
            headers: { 'Content-Type': 'application/json' }
        }).catch(() => {});
    }
}
```

#### 1.2 关键埋点场景
1. **页面加载与能力指纹 (PAGE_LOAD)**：
   - 记录：`isSecureContext`（是否处于加密上下文）、`navigator.share`（是否支持系统分享保存）、屏幕尺寸、设备型号；
2. **下载与传输交互 (ACTION / TRANSFER)**：
   - 记录：用户点击“开始下载”、开始分块读取、首字节到达（TTFB）、传输完成；
3. **异常与网络抖动 (NETWORK / ERROR)**：
   - 记录：fetch 捕获的异常名称（如 `AbortError`、`TypeError: Failed to fetch`）、重试次数、IndexedDB 配额异常。

---

### 2. 服务端 `/client-log` 路由与防护规格 (Server Telemetry Endpoint)

在 `pkg/server/` 中新增 `telemetry.go`：

#### 2.1 路由契约
- **Path**: `POST /client-log`
- **CORS**: 允许任意源（移动端通过 IP 或 direct.eqt 域名均可跨域直连）；
- **Payload 约束**:
  - `Content-Length ≤ 32KB`；
  - 超出长度直接返回 413 Payload Too Large，保护内存。
- **速率控制 (Rate Limiting)**：
  - 维护基于令牌桶或滑动窗口的轻量客户端限流器：单客户端每秒最多接收 10 条日志，超限丢弃并返回 429。

#### 2.2 数据结构 (Go Struct)
```go
type ClientLogEntry struct {
    ClientID  string         `json:"client_id"`
    Timestamp int64          `json:"timestamp"`
    Level     string         `json:"level"`    // INFO, WARN, ERROR
    Category  string         `json:"category"` // PAGE_LOAD, ACTION, TRANSFER, SAVE, NETWORK
    Message   string         `json:"message"`
    Details   map[string]any `json:"details,omitempty"`
    UserAgent string         `json:"user_agent,omitempty"`
}
```

#### 2.3 写入逻辑
接收解析后，格式化为统一结构行：
`[2026-09-03 23:45:00.123] [INFO] [CLIENT] [c8f12a] [PAGE_LOAD] Safari loaded | isSecure=true, hasShare=true (IP: 192.168.0.50)`
并直接调用全局统一日志汇流器写入。

---

### 3. 全局统一日志汇流器重构 (Global Log Sink & Redirection)

#### 3.1 进程级标准库重定向
在 `desktop/gui/main.go` 的 `startWailsGUI()` 初始化入口中：
```go
// 1. 初始化 FileLogger，默认以常态化 INFO 级别开启写入（解除此前 debugLog 强制绑定的静默 bug）
fileLogger := NewFileLogger(logPath, true) // 常态化开启
fileLogger.SetMinLevel(LogLevelInfo)        // 默认记录 INFO 及以上，Debug 模式开放全部

// 2. 进程级标准库输出重定向
// 将整个进程内部 server.Server 中的 log.Printf / log.Println 汇聚入 desktop.log
log.SetOutput(io.MultiWriter(os.Stderr, fileLogger))

// 3. 桌面 Agent 日志桥接
app.agent.SetOutput(fileLogger)
```

#### 3.2 服务端访问日志中间件 (Access Log Middleware)
在 `pkg/server/server.go` 的 HTTP 路由入口包装轻量访问日志中间件：
对移动端访问的关键端点（`/send/`、`/receive/`、`/chat`、`/files/` 等），在连接建立时打印一行结构化 Access 日志：
`[2026-09-03 23:45:01.000] [INFO] [SRV] HTTP GET /send/token from 192.168.0.50 (200 OK)`
确保移动端一旦联网接入，服务端日志即刻留痕！

---

### 4. 日志轮转与物理存储保护 (Rotation & Quota Engine)

在 `desktop/gui/main.go` 的 `FileLogger` 中增加简单的尺寸轮转策略：
- 每次写入前（或按定时器检查），当 `desktop.log` 文件体积超过 10MB 时：
  1. 关闭当前文件句柄；
  2. 顺延移动：`desktop.log.1` -> `desktop.log.2`，`desktop.log` -> `desktop.log.1`；
  3. 创建新的 `desktop.log`；
  4. 保证磁盘占用上限恒为 ≤ 30MB。

---

### 5. GUI 端应用内诊断与日志查看面板 (In-App Log Viewer)

在桌面 GUI 中补充可视化查看通道：

#### 5.1 后端暴露 API (`desktop/gui/app.go`)
```go
// GetLogTail returns the last N lines of desktop.log for instant diagnosis.
func (a *App) GetLogTail(lines int) (string, error)

// ExportDiagnosticsZip packages desktop.log, crash reports, and environment info into a zip file.
func (a *App) ExportDiagnosticsZip() (string, error)
```

#### 5.2 前端呈现 (`desktop/gui/frontend/`)
- 在“设置”或“关于”面板中：
  - 点击“运行日志”，在应用内直接弹窗展示最新 200 行格式化日志（支持自动刷新与关键字过滤，如高亮 `[CLIENT]`、`[SRV]`、`[ERROR]`）；
  - 提供“一键复制”与“导出排查包”按钮，彻底免去用户去文件管理器翻找目录的烦恼。

---

## 五、实施里程碑路线图 (Implementation Milestones)

- [ ] **Phase 1: 服务端与桌面调度日志汇流 (Log Sink Pipeline)**
  - [ ] 改造 `desktop/gui/main.go`，执行 `log.SetOutput(io.MultiWriter(os.Stderr, fileLogger))`；
  - [ ] 改造 `desktopAgent.log`，将其日志输出重定向至 `fileLogger`；
  - [ ] 调整 `FileLogger` 策略为默认常态化落盘（INFO 及以上）。
- [ ] **Phase 2: 服务端 `/client-log` 端点与限流保护 (Server Telemetry)**
  - [ ] 在 `pkg/server/` 实现 `/client-log` 接口，支持 JSON 解析与安全限流；
  - [ ] 在 `pkg/server/server.go` 增加移动端接入 Access Log 中间件；
  - [ ] 编写 `/client-log` 单元测试与越界保护测试。
- [ ] **Phase 3: 移动端页面轻量遥测探针埋点 (Mobile Client Probe)**
  - [ ] 在 `upload.tmpl.html` 与 `send` 模板中注入 `telemetry.js`；
  - [ ] 捕获页面加载指纹、下载触发、分块异常与保存状态并异步回传；
  - [ ] 验证移动端在断网、弱网及页面关闭时的 `sendBeacon` 鲁棒性。
- [ ] **Phase 4: GUI 应用内日志查看与导出诊断 (In-App Log Viewer)**
  - [ ] 在 `desktop/gui/app.go` 实现 `GetLogTail(lines int)`；
  - [ ] 在前端 Settings / About 面板构建可视化日志浮层与一键复制功能；
  - [ ] 增加多语言翻译（支持 7 国语言）。
- [ ] **Phase 5: 全链路联调与回归验证 (E2E Verification)**
  - [ ] 在本地及 Windows 实机上启动 Send/Receive/Chat 模式；
  - [ ] 移动端扫码接入并触发下载，核验 `desktop.log` 中各端信息全量体现；
  - [ ] 验证日志轮转、跨平台单用户目录权限与性能指标。

---

## 六、总结与交付准则

通过本架构落地，EQT 将彻底告别“移动端失联”与“GUI 日志黑洞”，建立起透明、结构化、安全无感的各端运行信息回传链路。排查任何局域网互联或大文件传输故障时，只需打开应用内日志面板，即可实现秒级定位。

---

## 七、首轮设计评审意见（commit 377e4983 · Draft v1.0）

> **复核对象**：`377e4983 docs(plan): add cross-platform telemetry and unified logging architecture design`（新增设计文档，Draft v1.0，尚未实现）。
> **复核结论（总体）**：§一 现状断点陈述与当前代码**逐条一致**——`pkg/server/server.go` 21 处 `log.Printf/Println` 均未 `SetOutput`（默认 os.Stderr，windowsgui 无控制台时丢失）；`desktop/gui/agent.go` 的 `agent.log` 用 `logger.New(flags.Quiet)`（内部 writer 为 nil，走 `fmt.Printf`→stdout）；`desktop/gui/main.go:330-335` `FileLogger.enabled = settings.DebugLog || settings.DevMode` 门控真实存在。设计方向（Always-On INFO 基线、token/文件名截断、≤32KB 上限、10MB×3 轮转 ≤30MB、应用内查看器）均属正确工业实践。但首轮评审发现 1 项**安全内部矛盾**、1 项**架构性能矛盾**、1 项**API 复用机会**与多处**代码事实错配**，详见下表。复核手段：代码直读 + `rg` 路由/嵌入审计（未跑构建，纯设计评审）。

| 评审意见项 | 评审性质 | 复核发现 | 建议处置与闭环措施 | 状态 |
| :--- | :--- | :--- | :--- | :---: |
| **1. Access Log 打印完整 `/send/<token>` 与 §二-5 截断原则自相矛盾** | **【安全·内部矛盾】** | §四-3.2 示例明文打印 `HTTP GET /send/token`，但 §二-5 已要求 URL Token 截断保留前后 6 位。该 token 即分享凭据（持 URL 即可下载），全量落盘与其自身脱敏准则冲突 | 修订 §四-3.2 示例为 `HTTP GET /send/abc123…（截断前后 6 位）`，并在中间件实现中统一调用与 §二-5 相同的截断函数，杜绝日志侧泄露完整凭据 | ⏳ 待作者修订 |
| **2. `/client-log` 无鉴权 + 自由格式字段，缺清洗与日志注入防护** | **【安全·设计缺口】** | 端点对局域网任意设备开放，`level/category/message/details/user_agent` 全由客户端自由填写且未定义枚举白名单、CR/LF 控制符剥离与字段长度上限——恶意或异常设备可伪造日志行（`\n` 注入）干扰排查；`client_id` 可伪造，仅可作展示维度 | 服务端强校验：`level`/`category` 枚举白名单、非法值降级 `INFO/OTHER`；剥离 `\r\n` 与控制字符、单条 message/字段长度封顶；忽略未知 JSON 字段；限流按远端 IP 键控（不可信 client_id），保留文档现行单 IP 限流表述 | ⏳ 待作者修订 |
| **3. 统一汇流仍走同步磁盘写，违背自身“非阻塞 ≤1ms”准则** | **【架构·性能矛盾】** | 现 `FileLogger.log()`（desktop/gui/main.go:119-127）每次调用同步 `WriteString + file.Sync()`；服务端另有按请求触发的 `[Download Chunk Done]`（pkg/server/server.go:2812）。若经 §四-3.1 `log.SetOutput(MultiWriter…)` 将热路径写盘同步挂在传输/处理 goroutine 上，磁盘抖动或 Defender/杀软扫描瞬间即阻塞传输，与 §二-1 “绝不抢占主传输带宽/时延 ≤1ms” 相悖 | 汇流器改为**单一异步 writer goroutine**：各端日志经无锁 channel（或 ring buffer）投递，后台协程批量落盘；`Sync()` 移出每条热路径（或周期 fsync）；轮转亦在 writer goroutine 内执行，天然串行化避免 MultiWriter 交错半行 | ⏳ 待作者修订 |
| **4. 提案新增 `agent.SetOutput`，应复用既有 `logger.NewWithWriter`** | **【正确性·API 复用】** | 仓库已存在 `logger.NewWithWriter(quiet, w io.Writer)`（pkg/logger/logger.go:81）与桥接先例 `diag.NewStdLoggerWithWriter(io.MultiWriter(os.Stderr, agent.fileLogger))`（agent.go:996-997，仅喂给 ChatV2Logger）；且 `agent.fileLogger = a.logger` 已在 app.go:186 注入 | Phase 1 改为：在 fileLogger 就绪处用 `logger.NewWithWriter(false, fileLogger)` 重建/替换 `agent.log`，而非发明 `SetOutput` 新接口；仅当 logger.Logger 需保持运行期动态切换时才新增 `SetOutput` 并说明理由 | ⏳ 待作者修订 |
| **5. 移动端模板目标错配：无 `chat.tmpl.html`，聊天页为 Svelte SPA** | **【口径·事实错配】** | `pkg/pages/` 实有 `download/upload/qr/done.tmpl.html` 四个，**无 `chat.tmpl.html`**；手机聊天页是 Svelte 构建产物 `pkg/chat/v2/web/dist`（go:embed `dist/*`，routes.go ServeContent/web.Dist 输出），非 Go 模板。§四-1 “upload/chat/Send 页面” 与 Phase-3 “upload 与 send 模板” 均需修正 | 修正为：手机下载侧=`download.tmpl.html`、上传侧=`upload.tmpl.html`；聊天侧注入需在 SPA 管道（dist 构建或对嵌入 index.html 做服务端 html/template 包裹，因 go:embed 只读不可直接改写）。明确三套注入路径而非一套模板逻辑 | ⏳ 待作者修订 |
| **6. sendBeacon 收不到响应码，429/413 “语义不可达”** | **【正确性·协议事实】** | `navigator.sendBeacon` 仅返回布尔，浏览器丢弃响应体；页面卸载/关闭后亦不重试。§四-2.1 “超限丢弃并返回 429” 对 beacon 客户端永远不可见，仅对 fetch 兜底分支有意义（且其 `.catch(()=>{})` 吞错） | 明确 429/413 仅是**服务端保护动作**（计数丢弃），不作客户端可见语义；服务端可在内部聚合输出一行 “dropped N client-log lines” 而非静默吞 ERROR，避免排查时高价值错误被限流遮没 | ⏳ 待作者修订 |
| **7. 客户端与服务端时间双源未定义权威值** | **【规范·口径】** | Payload 带 `client.timestamp`（设备时钟），而 §四-2.3 统一行时间戳取服务端到达时刻；未声明何者为权威，设备时钟偏差会造成时序错乱 | 统一行时间戳以**服务端接收时刻**为权威；客户端 `timestamp` 仅保留至 details 作时钟偏差参考（可选），文档显式声明 | ⏳ 待作者修订 |
| **8. “CORS 允许任意源”不必要** | **【规范·冗余】** | 三端页面均由同一 EQT 服务 host:port 提供，`/client-log` 为同源 POST，无跨域场景 | 建议删除 CORS 头或收紧为同源/仅来源白名单，避免无谓放大攻击面 | ⏳ 待作者修订 |
| **9. 遥测/日志设计正交于 LAN-TLS，入 feat 分支污染 PR** | **【过程·范围】** | 本设计（移动遥测回传/统一日志）与 `feat/lan-tls-loopback` 主题无关；并入该特性分支将污染最终合回 master 的 PR 范围 | 建议将该文档（及后续实现）改挂 `master` 独立演进或单独功能分支，LAN-TLS 分支保持单主题收束 | ⏳ 待作者决议 |
| **10. §一 三处断点陈述经代码核验全部属实** | **【正评·核实】** | 服务端 21 处 std `log` 无 SetOutput（server.go）；`agent.log` 走 `logger.New` 空 writer→stdout（agent.go:58）；`FileLogger` 门控 DebugLog\|\|DevMode（main.go:330-335）。现状描述无夸大 | 无需改动，可据此锁定 Phase 1 重构边界 | ✅ **确认无偏差** |
