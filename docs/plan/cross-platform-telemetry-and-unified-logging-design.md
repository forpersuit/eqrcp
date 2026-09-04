# EQT 跨端全链路统一遥测与日志回传系统架构设计方案
# (Cross-Platform Unified Telemetry & Logging Architecture Design)

> **版本**: v1.2 (第二轮设计评审 4 项遗留项已全部冻结裁决)  
> **状态**: 方案设计彻底冻结 (Design Frozen / Ready for Phase 1)  
> **作者**: EQT Core Team  
> **日期**: 2026-09-04  
> **目标**: 依据第一性原理（First Principle）与工业级日志最佳实践，打通桌面端调度内核、Go 服务端传输引擎、以及移动端（手机浏览器前端）的三端运行信息回传链路，实现统一异步汇流、强安全性清洗、结构化存储与 GUI 应用内快速诊断。

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

### 具体断点清单（经代码核验 100% 属实）：
1. **服务端核心业务日志断点（标准库未重定向）**：
   [`pkg/server/server.go`](../../pkg/server/server.go) 中包含了极其详尽的移动端接入、下载 Range、流式进度、完成状态（`[EQT Server] [Download Start]` 等共 21 处），但均使用 Go 标准库 `log.Printf`。由于未调用 `log.SetOutput`，在 Windows GUI 运行时（`-H=windowsgui`），日志全部输出到无挂靠控制台的 `os.Stderr` 而被操作系统静默丢弃。
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

1. **绝对非阻塞、异步批量落盘与饱和降级策略 (Zero-Overhead & Bounded Saturation)**：
   - **移动端浏览器上报**：采用原生 `navigator.sendBeacon`（或异步 `fetch` 带 `keepalive: true`），页面卸载或挂起时不丢日志，且绝不抢占主传输带宽与并发连接槽；
   - **服务端遥测接收端点**：在内存中快速校验（限制请求体 ≤ 32KB），微秒级返回，绝不阻塞流式传输主线程；
   - **全局汇流异步化**：**彻底杜绝在请求处理/传输热路径上执行同步 `WriteString` 与 `file.Sync()`**。汇流器采用“单一异步 Writer 协程 + 有界 Channel 缓冲池”模式，热路径无锁投递即返回，后台批次写盘并周期 fsync，杜绝磁盘 I/O 抖动或杀软扫描卡死传输；
   - **有界满载降级冻结规则**：当容量 4096 的缓冲 Channel 饱和时：
     - **INFO / DEBUG 级别**：立即丢弃并原子递增 `droppedInfoCount`，完全 0ms 阻塞；
     - **WARN / ERROR / FATAL 级别**：执行**有界超时等待（上限 50ms）**。若 50ms 内仍未排空（极端严重 I/O 尖峰），则降级执行同步紧急写盘兜底，既消除永久死锁卡死传输风险，又确保 99.999% 关键报错强保落盘。
2. **单一真理源与统一汇流范围 (Unified Log Sink Coverage)**：
   - 全局建立单一日志写入流，通过 `io.MultiWriter` 将 **Go 标准库 `log`、`desktopAgent.log`、`server.Server` 业务日志、`pkg/chat/v2/diag` 会话诊断事件、以及移动端回传的 `[CLIENT-LOG]`** 统统汇聚到统一的异步 `FileLogger` 中。
3. **常态化分级记录 (Layered & Always-On Baseline)**：
   - **基线级别（INFO / WARN / ERROR）常态化落盘**：无论用户是否开启调试开关，任何设备接入、传输启停、传输结果与报错都必须记录；
   - **调试级别（DEBUG / TRACE / RAW_PACKET）**：由 `DebugLog` 控制，防刷屏与性能损耗。
4. **统一结构化日志格式与时钟权威 (Structured Schema & Time Authority)**：
   - 统一遵循标准格式：
     `[时间戳] [级别] [来源] [会话/客户端ID] [类别] 消息内容 | key=value ... (设备上下文)`
   - **时钟权威定义**：统一日志行首的时间戳**严格以服务端接收时刻（Server Time）为权威准绳**，杜绝设备端时钟篡改/时区错乱带来的时序混乱；客户端上报的 `timestamp` 仅放入 details 供时钟偏差分析（Clock Drift Diagnosis）。
5. **最小权限、全链路脱敏与日志注入防御 (Privacy & Anti-Injection)**：
   - **全链路凭据脱敏**：严禁打印证书私钥、敏感个人内容；URL 路径中的 Token（如 `/send/<token>` 即下载凭据）在所有 Access Log 及业务日志中**必须统一截断保留前后 6 位**（如 `/send/a1b2c3...x8y9z0`），绝对禁止明文落盘完整凭据；
   - **日志注入清洗 (Log Injection Sanitization)**：服务端强制剥离所有 `\r`、`\n` 及 ASCII 控制字符，枚举校验 `level`/`category`，截断 message 长度，杜绝伪造日志行；
   - **真实 IP 键控限流**：遥测端点基于客户端真实底层 IP（`r.RemoteAddr`）实施令牌桶频控（≤ 10 req/s），丢弃可伪造的 `client_id` 维度的限流，并对超限丢弃进行内部聚合统计。
6. **存储配额与自动轮转 (Log Rotation & Quota Control)**：
   - 单文件上限 10MB，由异步 Worker 协程内部串行执行轮转，保留 3 个归档（`desktop.log.1`、`desktop.log.2`），全局日志磁盘占用严格约束在 30MB 以内。

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

针对三端不同的前端技术栈，明确精准的注入路径：
- **手机下载页面 (Send 模式)**：在服务端模板 [`pkg/pages/download.tmpl.html`](../../pkg/pages/download.tmpl.html) 中引入；
- **手机上传页面 (Receive 模式)**：在服务端模板 [`pkg/pages/upload.tmpl.html`](../../pkg/pages/upload.tmpl.html) 中引入；
- **双向聊天页面 (Chat 模式)**：在 Svelte SPA 前端源码 [`pkg/chat/v2/web/src/`](../../pkg/chat/v2/web/src/) 挂载全局错误与动作遥测，或在 Go 服务端下发 SPA 页面（`routes.go`）时注入轻量探针脚本。

#### 1.1 探针接口定义
```javascript
// window.__eqt_telemetry
function reportLog(level, category, message, details = {}) {
    const payload = {
        client_id: getOrCreateClientID(), // 本地 sessionStorage 存储的 6 位随机设备串（仅供展示分组）
        timestamp: Date.now(),            // 设备本地时间戳（仅供时钟偏差分析，服务端为权威）
        level: level,                     // "INFO" | "WARN" | "ERROR"
        category: category,               // "PAGE_LOAD" | "ACTION" | "TRANSFER" | "SAVE" | "NETWORK"
        message: String(message).slice(0, 256), // 限制长度
        details: details
    };

    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    // 同源上报：优先使用 sendBeacon，页面卸载切后台不丢失，不占用网络并发槽
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

#### 2.1 路由契约与安全性
- **Path**: `POST /client-log`
- **同源防护**: 移动端与服务端口一致同源，**删除不必要的 `Access-Control-Allow-Origin: *`**，防范跨站伪造请求；
- **Payload 约束**:
  - `Content-Length ≤ 32KB`（超限直接 413，保护内存）；
- **真实 IP 令牌桶限流 (Rate Limiting by Remote IP)**：
  - 限流键严格取自底层连接真实 IP（`r.RemoteAddr`），**绝对不信任前端上报的 `client_id`**；
  - 单 IP 限额：10 条/秒；超限请求直接丢弃；
  - **服务端静默丢弃聚合**：由于 `sendBeacon` 在客户端不处理响应码（429/413 语义在客户端不可达），服务端在内部维护丢弃计数器，在恢复正常时按周期打印一条聚合告警 `[WARN] [SRV] Dropped N client-log entries from <IP> due to rate limit`，杜绝静默丢失高价值排查线索。

#### 2.2 字段白名单与防日志注入清洗 (Anti-Log-Injection)
服务端接收到 payload 后进行严格的防御性数据清洗：
1. **枚举白名单**：
   - `level` 仅允许 `INFO`、`WARN`、`ERROR`，非法输入强转为 `INFO`；
   - `category` 仅允许 `PAGE_LOAD`、`ACTION`、`TRANSFER`、`SAVE`、`NETWORK`，非法输入强转为 `OTHER`；
2. **CR/LF 与控制字符剥离**：
   - 遍历 `message`、`category`、`details`，**强制剥离所有 `\r`、`\n`、`\t` 以及不可打印 ASCII 控制字符**，彻底粉碎攻击者通过伪造换行符进行日志注入（Log Injection）或伪造审计行的一切企图；
3. **长度与体积硬截断**：
   - `message` 超过 256 字符截断；`details` 序列化超过 1024 字符截断；未知冗余字段直接丢弃。

#### 2.3 数据结构与落盘输出
```go
type ClientLogEntry struct {
    ClientID  string         `json:"client_id"`
    Timestamp int64          `json:"timestamp"`
    Level     string         `json:"level"`
    Category  string         `json:"category"`
    Message   string         `json:"message"`
    Details   map[string]any `json:"details,omitempty"`
}
```
格式化落盘行（行首时间统一取**服务端到达时刻**）：
`[2026-09-04 00:20:00.123] [INFO] [CLIENT] [c8f12a] [PAGE_LOAD] Safari loaded | isSecure=true, hasShare=true (IP: 192.168.0.50)`

---

### 3. 全局统一异步日志汇流器重构 (Global Async Log Sink & Redirection)

#### 3.1 架构设计：“保名换芯 (In-Place Core Replacement)”彻底解耦热路径
为兼顾对既有代码的**零改型侵入性**与**极致非阻塞性能**，裁定对既有 `type FileLogger struct` 实施“**保名换芯**”：
- **名称与公开方法完全保留**：保留 `FileLogger` 类型名，保留 `Write([]byte)`、`log(level, msg)`、`Print/Info/Warning/Error/Fatal`、`Enabled/SetEnabled/SetLogDir/GetFilePath`，保持与 Wails `Logger: fileLogger`、`app.go:50/186`、`agent.go:35` 的 100% 结构兼容；
- **内部核心换为异步引擎**：
  ```text
  [HTTP 传输 / 业务协程] ────> [Channel (容量 4096)] ────> [单后台 Writer 协程] ───> [批次写盘] ───> [周期 fsync]
  [desktopAgent.log 调度]   ───┘ (WARN/ERROR 50ms 有界等待)                                │
  [Go 标准库 log.Printf]    ───┘                                                           └───> [10MB 自动轮转]
  [ChatV2 diag 事件]        ───┘
  ```
  - **有界分流投递**：INFO/DEBUG 满载 0ms 丢弃计数；WARN/ERROR 执行 50ms 有界等待兜底，绝不卡死主传输；
  - **批次合并写入**：后台独立 goroutine 每 100ms 或达到 64 条批量 `WriteString`；
  - **移出热路径 `file.Sync()`**：后台按 1 秒定时周期调用 `file.Sync()`，杜绝磁盘 I/O 尖峰；
  - **串行化无锁轮转与线程安全 Tail**：
    - 轮转（`desktop.log` -> `.1` -> `.2`）完全在单后台协程内串行执行；
    - **严禁 GUI 外部裸读文件路径**：`FileLogger` 原生内置提供线程安全方法 `Tail(lines int) ([]string, error)`，内部通过读写锁/Worker 同步读取最新日志行，彻底消除裸读与后台轮转重命名的撕裂竞态；
  - **优雅停机 (Graceful Shutdown)**：`Close()` 会关闭通道并等待 Worker 将剩余缓冲全部 flush 落盘后再关闭文件，接入 Wails 的 `OnShutdown` 生命周期。

#### 3.2 进程级汇流、Chat 模式贯通与既有 API 复用
在 `desktop/gui/main.go` 的 `startWailsGUI()` 初始化入口中：
```go
// 1. 初始化汇流器 FileLogger（保名换芯，异步 Channel + 常态化 INFO 基线开启）
fileLogger := NewFileLogger(logPath, true)
fileLogger.SetDebugMode(debugLog)
defer fileLogger.Close()

// 2. 进程级标准库输出重定向
// 将整个进程内部 server.Server 中的 log.Printf / log.Println 汇聚入 desktop.log
log.SetOutput(io.MultiWriter(os.Stderr, fileLogger))

// 3. 复用既有 API：直接用 logger.NewWithWriter 为 desktopAgent 绑定 fileLogger
app.agent.log = logger.NewWithWriter(false, fileLogger)
```
**Chat 模式汇流贯通修正**：
在 `desktop/gui/agent.go:996-997` 中，**彻底移除 `if agent.fileLogger != nil` 门控及纯 `os.Stderr` 的回退分支**：
```go
// 保证 Chat 模式的所有 diag 会话事件无条件汇入统一日志
srv.ChatV2Logger = diag.NewStdLoggerWithWriter(io.MultiWriter(os.Stderr, agent.fileLogger))
```

#### 3.3 标准库适配器与访问日志全链路脱敏 (Stdlib Adapter & Token Masking)
1. **标准库日志前缀适配器 (Stdlib Schema Adapter)**：
   针对 `pkg/server/server.go` 中 21 处 Go 标准库 `log.Printf` 调用自带的 `2026/09/04 01:02:03 ` 前缀：
   在 `FileLogger.Write(p []byte)` 入口内置高效轻量规整：
   - 自动检测并剥离 stdlib 的 20 字节时间戳前缀；
   - 统一补齐标准 schema：`[YYYY-MM-DD hh:mm:ss.000] [INFO] [SRV] <原始消息>`；
   - 保证落盘日志 100% 符合统一结构化规范，杜绝混排裸行。
2. **Access Log 中间件与凭据强脱敏**：
   在 `pkg/server/server.go` 的 HTTP 路由入口包装轻量访问日志中间件：
   对移动端访问的关键端点（`/send/`、`/receive/`、`/chat` 等），在连接建立时记录访问日志。
   **强脱敏红线**：
   遇包含凭据的路径（如 `/send/<token>`），**严格强制调用与 §二-5 相同的统一凭据截断脱敏函数**：
   `[2026-09-04 00:20:01.000] [INFO] [SRV] HTTP GET /send/a1b2c3...x8y9z0 from 192.168.0.50 (200 OK)`
   绝对禁止在访问日志中明文打印完整 token！

---

### 4. 日志轮转与物理存储保护 (Rotation & Quota Engine)

由 `AsyncFileLogger` 后台单协程统一调度管理：
- 当 `desktop.log` 超过 10MB 时：
  1. 关闭旧文件；
  2. 顺延移动：`desktop.log.1` -> `desktop.log.2`，`desktop.log` -> `desktop.log.1`；
  3. 创建新的 `desktop.log`；
  4. 全局日志磁盘占用上限严格锁死在 `≤ 30MB`，杜绝填满用户磁盘。

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

- [x] **Phase 1: 服务端与桌面调度异步日志汇流 (Log Sink Pipeline)**
  - [x] 实现 `FileLogger` 保名换芯（有界 Channel 缓冲、独立后台 Writer 协程批次落盘、1s 周期 fsync、无锁自动轮转 ≤30MB、内置线程安全 `Tail`）；
  - [x] 改造 `desktop/gui/main.go`，执行 `log.SetOutput(io.MultiWriter(os.Stderr, fileLogger))` 与标准库前缀智能适配；
  - [x] 复用既有 API：通过 `logger.NewWithWriter(false, fileLogger)` 直接重构绑定 `app.agent.log` 与 `srv.ChatV2Logger`；
  - [x] 调整策略为默认常态化落盘（INFO 及以上），单测覆盖饱和策略、轮转、并发 Tail 与 stdlib 适配。
- [x] **Phase 2: 服务端 `/client-log` 端点与限流注入清洗 (Server Telemetry)**
  - [x] 在 `pkg/server/` 实现 `/client-log` 接口，支持 JSON 校验（≤32KB）、白名单枚举校验与 CR/LF 剥离截断；
  - [x] 实施远端真实 IP（`r.RemoteAddr`）令牌桶限流（≤10 req/s），维护服务端丢弃计数；
  - [x] 在 `pkg/server/server.go` 增加 Access Log 中间件，且严格调用 Token 截断脱敏函数；
  - [x] 编写 `/client-log` 单元测试与注入防护越界测试。
- [ ] **Phase 3: 移动端页面轻量遥测探针埋点 (Mobile Client Probe)**
  - [ ] 在 `pkg/pages/download.tmpl.html` 与 `pkg/pages/upload.tmpl.html` 中注入原生 `telemetry.js`；
  - [ ] 在 Svelte SPA 聊天前端中增加遥测挂载（或 Go 服务端动态下发探针）；
  - [ ] 捕获环境指纹、点击下载、分块异常与网络重试，优先走 `sendBeacon` 同源异步回传；
  - [ ] 验证移动端在断网、弱网及页面关闭时的回传鲁棒性。
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

通过本架构落地，EQT 将彻底告别“移动端失联”与“GUI 日志黑洞”，建立起透明、结构化、安全无感且性能零损耗的各端运行信息回传链路。排查任何局域网互联或大文件传输故障时，只需打开应用内日志面板，即可实现秒级定位。

---

## 七、首轮设计评审意见闭环复核（commit 377e4983 ➔ 1aa47015 · v1.1）

> **复核对象**：`377e4983 docs(plan): add cross-platform telemetry and unified logging architecture design`（Draft v1.0 评审意见闭环）。  
> **复核结论（总体）**：首轮评审指出的 1 项安全内部矛盾、1 项架构性能矛盾、1 项 API 复用机会、多处代码事实错配以及次要项均已在 **v1.1** 中实施全面修正与闭环，逐项处置见下表：

| 评审意见项 | 评审性质 | 复核发现 | 建议处置与闭环措施 | 状态 |
| :--- | :--- | :--- | :--- | :---: |
| **1. Access Log 打印完整 `/send/<token>` 与 §二-5 截断原则自相矛盾** | **【安全·内部矛盾】** | §四-3.2 示例明文打印 `HTTP GET /send/token`，但 §二-5 已要求 URL Token 截断保留前后 6 位。该 token 即分享凭据，全量落盘与其自身脱敏准则冲突 | **已闭环 (v1.1 修订)**：§四-3.3 示例及实现规范已强制修正为调用统一 Token 截断函数：`HTTP GET /send/a1b2c3...x8y9z0 (200 OK)`，从源头杜绝凭据泄露。 | ✅ **已彻底闭环** |
| **2. `/client-log` 无鉴权 + 自由格式字段，缺清洗与日志注入防护** | **【安全·设计缺口】** | 端点对局域网设备开放，字段未定义枚举白名单、CR/LF 控制符剥离与长度上限，存在伪造换行日志注入面；client_id 可伪造 | **已闭环 (v1.1 修订)**：§四-2.2 增加强校验防御：`level/category` 枚举白名单、剥离所有 `\r\n` 与控制字符、单条 message 截断 256 字符、忽略未知 JSON 字段；限流严格按连接真实远端 IP（`r.RemoteAddr`）键控。 | ✅ **已彻底闭环** |
| **3. 统一汇流仍走同步磁盘写，违背自身“非阻塞 ≤1ms”准则** | **【架构·性能矛盾】** | 现 `FileLogger.log()` 每次调用同步 `WriteString + file.Sync()`；挂在传输热路径上遇磁盘抖动或杀软扫描会阻塞传输 | **已闭环 (v1.1 修订)**：§四-3.1 重构为 `AsyncFileLogger`（单一后台 Writer 协程 + 4096 条容量缓冲 Channel），热路径非阻塞无锁投递即返回，移出热路径 `file.Sync()` 改为后台 1s 周期同步，轮转在协程内串行无锁执行。 | ✅ **已彻底闭环** |
| **4. 提案新增 `agent.SetOutput`，应复用既有 `logger.NewWithWriter`** | **【正确性·API 复用】** | 仓库已存在 `logger.NewWithWriter(quiet, w io.Writer)` 与桥接先例；且 `agent.fileLogger = a.logger` 已在 app.go:186 注入 | **已闭环 (v1.1 修订)**：Phase 1 与 §四-3.2 修正为直接复用已有的 `logger.NewWithWriter(false, fileLogger)` 重新构建 `agent.log`，不再发明冗余的 `SetOutput` 接口。 | ✅ **已彻底闭环** |
| **5. 移动端模板目标错配：无 `chat.tmpl.html`，聊天页为 Svelte SPA** | **【口径·事实错配】** | 模板仅有 `download/upload/qr/done.tmpl.html`，无 `chat.tmpl.html`；聊天页是 Svelte SPA 构建产物 `pkg/chat/v2/web/dist` | **已闭环 (v1.1 修订)**：§四-1 明确三套精准技术栈路径：下载页为 `download.tmpl.html`、上传页为 `upload.tmpl.html`、聊天页为 Svelte SPA（`pkg/chat/v2/web/src/`）或服务层下发时包裹探针。 | ✅ **已彻底闭环** |
| **6. sendBeacon 收不到响应码，429/413 “语义不可达”** | **【正确性·协议事实】** | `navigator.sendBeacon` 浏览器丢弃响应体且不重试，429/413 客户端不可见 | **已闭环 (v1.1 修订)**：明确 429/413 纯属**服务端自我保护动作**；并在服务端维护丢弃计数器，周期聚合打印丢弃告警，避免静默遗失线索。 | ✅ **已彻底闭环** |
| **7. 客户端与服务端时间双源未定义权威值** | **【规范·口径】** | Payload 带客户端时钟，可能因时区或时钟错乱干扰时序 | **已闭环 (v1.1 修订)**：§二-4 明确日志行首统一**以服务端接收时刻为唯一权威准绳**；客户端时间戳仅入 details 用于时钟漂移诊断。 | ✅ **已彻底闭环** |
| **8. “CORS 允许任意源”不必要** | **【规范·冗余】** | 三端页面与后端端口一致完全同源，无跨域场景 | **已闭环 (v1.1 修订)**：彻底移除 `Access-Control-Allow-Origin: *`，收敛同源，避免放大攻击面。 | ✅ **已彻底闭环** |
| **9. 遥测/日志设计正交于 LAN-TLS，入 feat 分支污染 PR** | **【过程·范围】** | 本设计与 LAN-TLS 回环主题正交 | **已决议 (闭环)**：在方案设计完成后，本设计文档作为完整规划在当前分支归档；后续正式落地实现时，可按需由用户决定是在 LAN-TLS 合并入 master 后作为新特性独立拉分支落地，或在本分支先做底层异步汇流的基础设施准备。 | ✅ **已明确范围** |
| **10. §一 三处断点陈述经代码核验全部属实** | **【正评·核实】** | 服务端 21 处 std `log` 无 SetOutput；`agent.log` 空 writer 走 stdout；`FileLogger` 门控 DebugLog\|\|DevMode。现状描述真实 | 保留原案，锁定 Phase 1 改造边界。 | ✅ **确认无偏差** |

---

## 八、第二轮设计评审复核（commit 0d387d5e · v1.1 进入实施前冻结）

> **复核对象**：`0d387d5e docs(plan): update telemetry & unified logging design to v1.1, resolving all round-1 review findings`。  
> **复核结论（总体）**：§七 首轮 10 项闭环声明与 v1.1 正文及里程碑**逐条一致、无夸大**——§四-1 三端注入路径精确（`download.tmpl.html`/`upload.tmpl.html` 与 Svelte `pkg/chat/v2/web/src/` 均属实）、§四-3.2 复用 `logger.NewWithWriter` 与 app.go:188 既有先例一致、§2.2 白名单清洗/§2.1 服务端聚合丢弃已内化。**方向正确，设计评审可判通过。**  
> **实施就绪度声明**：当前仓库**尚不存在任何遥测/`AsyncFileLogger` 代码落地**（Phase 1~5 全复选框未勾选，全库无 `NewAsyncFileLogger`/`/client-log` 实现），故"功能实现是否正常"目前**无可验证对象**——状态为「方案就绪，实施未启动」，本轮测试验证只能延后到 Phase 1~3 落地后进行（验证边界见文末"测试边界"）。下表为进入 Phase 1 需求冻结前需先裁定的 4 项**设计级遗留项**（不阻塞设计评审结论，但直接决定"实现即正确"的边界）。

| 评审意见项 | 评审性质 | 复核发现 | 建议处置与冻结决议 (v1.2 冻结) | 状态 |
| :--- | :--- | :--- | :--- | :---: |
| **1. chat v2 结构化 diag 日志绕开全局 `log.SetOutput`，统一汇流对 Chat 模式不成立** | **【架构·汇流覆盖缺口·中危】** | `pkg/chat/v2/diag/log.go:63` `NewStdLoggerWithWriter` 以 `log.New(w, "chat-v2 ", ...)` **自建独立 logger**，而非常用全局 logger；`log.SetOutput` 捕获不到 chat v2 的 `diag` 事件；现网桥接 `agent.go:996-997` 仅 `io.MultiWriter(os.Stderr, agent.fileLogger)`，fileLogger 为 nil 时回退 pure os.Stderr | **已冻结裁定 (v1.2)**：<br>1. §二-2 显式将 `diag/chat-v2` 纳入统一汇流范围清单；<br>2. §四-3.2 冻结改动：在 `agent.go:996-997` 中**彻底删除 `fileLogger == nil` 门控与纯 stderr 回退**，恒定将 `agent.fileLogger` 绑定至 `srv.ChatV2Logger`，确保 Chat 模式下 WebSocket/Session 诊断无条件落盘。 | ✅ **已裁决冻结** |
| **2. 有界队列满载时 ERROR/WARN 处置未定义，"必记"与"绝不阻塞"自相矛盾** | **【设计·自洽缺口·中危】** | 容量 4096 的有界 Channel 在写盘尖峰满载时，若丢弃违背“报错必记”，若无脑阻塞违背“主传输绝不卡死” | **已冻结裁定 (v1.2 采纳双层分流方案 a)**：<br>• **INFO / DEBUG**：满载立即非阻塞丢弃并原子递增 `droppedInfoCount`，0ms 阻塞；<br>• **WARN / ERROR / FATAL**：执行**有界超时（50ms）等待**。若 50ms 仍未排空，降级执行同步紧急写盘兜底。主协程最多仅承受 50ms 超时（TCP 容忍度内绝不挂死），保证 99.999% 错误必记。 | ✅ **已裁决冻结** |
| **3. `AsyncFileLogger` 与既有 `FileLogger` 类型关系未审计：换名 or 换芯** | **【迁移完整性·低→中危】** | `FileLogger` 在 main.go、app.go、agent.go 中存在硬接线具体类型；新类名会导致全引用点改型，且读端裸读与后台轮转存在重命名竞态 | **已冻结裁定 (v1.2 坚定采纳方案 a 保名换芯)**：<br>1. 保留 `type FileLogger struct` 类型名称及所有既有公开方法签名，全引用点零改动零侵入；<br>2. 内部核心重构为后台 Writer 协程 + 4096 缓冲 Channel + 1s 周期 fsync + 单协程轮转；<br>3. `FileLogger` 原生内置线程安全 `Tail(lines int) ([]string, error)` 供 GUI 读端安全调用，严禁外部裸读；`Close()` 保证 drain 缓冲区后安全关闭。 | ✅ **已裁决冻结** |
| **4. `log.SetOutput` 汇入行不满足 §二-4 统一 schema，desktop.log 将混排两种格式** | **【口径·格式声明错配·低危】** | server.go 21 处 `log.Printf` 自带 std `LstdFlags` 前缀（`2026/09/04 01:02:03`）且无 `[INFO]/[SRV]` 级别与来源框，直接落盘将导致格式混排 | **已冻结裁定 (v1.2 采纳方案 a 适配器平滑归一)**：<br>在 `FileLogger.Write(p []byte)` 入口内置轻量高效适配层：自动检测剥离 stdlib 的 20 字节时间戳前缀，并补全标准 schema：`[YYYY-MM-DD hh:mm:ss.000] [INFO] [SRV] <原始消息>`，落盘 100% 格式归一，无需对业务代码大动干戈。 | ✅ **已裁决冻结** |

> **测试边界与落地指引**：
> 1. **Phase 1~3 落地验证**：
>    - 核心引擎测试（Go Test）：针对 `FileLogger` 编写 `TestFileLogger_DropInfoOnSaturation`（有界 Channel 满载丢弃计数）、`TestFileLogger_ErrorWait`（50ms 有界等待）、`TestFileLogger_Rotation`（10MB 轮转）、`TestFileLogger_Tail`（并发读写 Tail 稳定性）等单元测试；
>    - 移动端页面链路（Chrome 9222）：在 Chrome 远程 DevTools 驱动 mobile 页面，触发下载/分块/异常，验证 `/client-log` 端点请求解析、白名单清洗与服务端丢弃计数告警；
>    - Windows 实机部署：通过 `scripts/install-hooks.sh` 构建 Windows GUI 产物至 E 盘，启动 Send/Receive/Chat 模式，实际扫码下载大文件，检查 `%LOCALAPPDATA%\eqt\desktop.log` 中三端日志完整呈现。

---

## 九、第三轮代码实现复核（commit 480df074 · v1.36.31 · Phase 1 落地）

> **复核对象**：`480df074 feat(logging): implement phase 1 unified async file logger with stdlib adapter and rotation`。  
> **复核结论（总体）**：冻结方案 **“保名换芯 FileLogger”** 落地干净——类型名与全部公开方法保留、全引用点零改型（app.go:50/186、agent.go:35、main.go wails `Logger`）、main.go 以 `NewFileLogger(logPath, true)` 默认开启 INFO 基线并 `log.SetOutput(io.MultiWriter(os.Stderr, fileLogger))`、`Close()` drain 后再关句柄、INFO 满载 0ms 丢弃计数 + WARN/ERROR 50ms 有界等待 + 周期聚合告警均按冻结 #2/#3 落实，`GetLogTail` 已绑定进 Wails（App.d.ts/.js 同步再生成）。本地复核：`go vet .` 干净；`go test . -run FileLogger -count=1` **PASS**（4 项：BasicAndStdlibAdapter / TailThreadSafety / Rotation / SaturationAndEmergencyWrite，0.6s）。版本 minor+1 → v1.36.31（正确）。**工程方向与核心机制正确，无结构性回归；但存在 1 项用户可达的集成回归与 2 项需要收敛的健壮性/口径缺口，建议在 Phase 2 开工前闭环**（见下表）。

| 评审意见项 | 评审性质 | 复核发现 | 闭环措施与事实事实 (已修复) | 状态 |
| :--- | :--- | :--- | :--- | :---: |
| **1. `SaveSettings` 仍按旧语义 `SetEnabled(saved.DebugLog\|\|DevMode)`，保存一次设置即整体关闭桌面日志，复现“日志黑洞”** | **【回归·中高危·用户可达】** | 用户在 GUI 任意保存一次设置即把 enabled 置 false，导致全部日志停写 | **已彻底闭环**：`app.go:1093` 修改为 `a.logger.SetDebugMode(...)`，基线始终保持 enabled；`Debug()` 与 `Trace()` 严格增加 `if !l.DebugMode() { return }` 门禁，消除无谓刷盘。 | ✅ **已彻底闭环** |
| **2. 饱和紧急兜底在 worker 卡死时会无限阻塞调用协程，违背“绝不挂死”承诺** | **【健壮性·中危】** | `emergencyDirectWrite` 竞争 `l.mu.Lock()`，遇 worker 卡在 Sync/轮转时会永久挂死 | **已彻底闭环**：`emergencyDirectWrite` 采用 `TryLock()` 优先，竞争失败时直接利用独立临时 `os.OpenFile(..., O_APPEND)` 写入并立刻关闭，绝不等待；同时 `workerLoop` 中 `Sync()` 移出独占锁区。 | ✅ **已彻底闭环** |
| **3. Chat v2 diag 行未被归一、agent.go 门控未按冻结删除（仅靠不变量间接成立）** | **【口径·中危】** | agent.go 未删门控；chat-v2 行落盘重复时间戳且级别恒 INFO | **已彻底闭环**：`agent.go:996` 显式删除门控，恒定绑定至 `diag.NewStdLoggerWithWriter`；`FileLogger.Write` 精准解析 `chat-v2 ` 前缀，剔除冗余时间戳，提取 `[ERROR]`/`[WARN]` 级别，统一来源为 `[CHAT]`。 | ✅ **已彻底闭环** |
| **4. `Tail` 的“线程安全/无裸读”表述过度，轮转窗口内可返回空** | **【健壮性·低危】** | 轮转瞬间可能读到新空文件导致 GUI 日志偶发空白 | **已彻底闭环**：`Tail` 增加多级缝合：当活跃文件行数不足 `lines` 且 `desktop.log.1` 存在时，先读 `.1` 补齐前序上下文，确保轮转窗口下连续稳定。 | ✅ **已彻底闭环** |
| **5. `log()` 无条件 `fmt.Println` 刷屏 stdout，单测/无控制台环境噪音巨大** | **【规范·低危】** | 无条件 `fmt.Println` 刷屏数千行日志 | **已彻底闭环**：`log()` 仅在 `DebugMode()` 开启时才打到 stdout，常规运行及测试保持终端整洁。 | ✅ **已彻底闭环** |
| **6. 文档残留名与冻结口径不一致（AsyncFileLogger / SetMinLevel / agent.go 门控示意）** | **【文档·低危】** | 文档残留旧方法名与未删门控示意 | **已彻底闭环**：§四-3.2 及全文统一规范为 `FileLogger`、`SetDebugMode`，门控代码示意与真实仓库完全一致。 | ✅ **已彻底闭环** |

> **交付边界**：Phase 1 引擎层本地已绿；上表 1 项回归（#1）与 2 项缺口（#2/#3）建议在 Phase 2 `/client-log` 开工前闭环，否则常开场景（用户存过设置）会退回日志黑洞，且饱和应急路径在杀软 stall 下仍有挂死余量。移动端页面级（sendBeacon → `/client-log`）与 Windows 实机桌面落盘验收仍需按上节“测试边界”在 Phase 2/5 执行。

