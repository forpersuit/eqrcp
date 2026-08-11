# EQT 桌面端崩溃上报 · 流程机制与状态流转

> 适用范围：eqt-desktop（Go + Wails）
> 关联实现：`desktop/crash/`、`desktop/gui/main.go`（panic/signal）、`desktop/gui/app.go`（上报绑定）、`cmd/desktop_agent.go`（dev 调试端点）
> 后端契约：`POST https://lic.eqt.net.im/api/v1/crash-report`（`eqt-drm-api` Worker + D1 + R2）

---

## 一、崩溃收集总览

崩溃上报的目标是：**当桌面端发生未被预判的异常退出时，重建现场**——收集版本、设备、许可证、栈、日志，在下次启动时征询用户，决定是否把诊断数据回传。

```
崩溃触发 ──► 采集现场 ──► 落盘 crash.dump ──► 下次启动检测 ──► 用户反馈 ──► 上传后端
```

四个触发点：

| 触发点 | 代码位置 | 行为 |
|---|---|---|
| **panic 恢复** | `desktop/gui/main.go` `startWailsGUI` / `runCLIMode` 顶部 `defer recover()` | `crash.SaveDump(r)` 后 re-panic，OS 崩溃框照常出现 |
| **信号** | `desktop/gui/main.go` `setupSignalHandler()`（SIGABRT/SIGSEGV） | `crash.SaveDump(nil)` 后 `os.Exit(1)` |
| **dev 触发**（仅开发者模式） | `desktop/gui/app.go` `DevTriggerCrash()` 绑定 | 走同一采集路径落盘，**不退出进程**，便于联调 |
| **dev HTTP 端点**（仅 CLI/agent 模式） | `cmd/desktop_agent.go` `/dev/crash/trigger` | 同上，走回环控制面 |

> 关键设计：**崩溃时只落盘、不上传**。上传永远发生在**下次启动**，由用户显式触发，避免在 UI 已崩溃/网络不可用时硬上传。

---

## 二、崩溃流程（sequence）

```
[触发]                  [采集]                          [落盘]
panic / signal  ──►  Collect() 抓取:
  (SaveDump)          ├─ version.Version()  ─ app_version
                      ├─ runtime.GOOS/GOARCH ─ os_version
                      ├─ debug.Stack()      ─ stack_trace
                      ├─ GetDeviceStableID() ─ device_id (读硬件指纹/证书)
                      ├─ GetLocalLicenseInfo() ─ license_code (读 .lic)
                      └─ time.Now()         ─ timestamp
                          │
                          ▼
              DumpFile{ Report, Uploaded:false, Dismissed:false }
                          │
                          ▼
         ~/.local/eqt/crash.dump   (JSON, 0644)
```

**采集细节**
- `crash.Collect()`（`reporter.go`）：Stack 由 `debug.Stack()` 生成；`device_id` 用 `server.GetDeviceStableID()`（优先证书 `DeviceID`，否则匿名缓存 ID）；`license_code` 从本地 `license.lic` 读取。任一缺失不影响上报（fail-open）。
- `crash.SaveDump()`：从 `recovered`（panic 值）或内置 `"crash: SIGABRT or fatal error"`（signal/nil）拼栈前消息，加上完整 `debug.Stack()`。
- 落盘路径 `config.DefaultConfigDir()/crash.dump`。

---

## 三、下次启动检测（startup check）

```
eqt-desktop 启动
      │
      ▼
App.startup() ──► crash.HasPendingDump()  ← LoadDump()：
      │                                        ├─ 文件不存在      → nil（无 pending）
      │                                        ├─ parse 失败      → error（不弹窗，不误报）
      │                                        └─ Uploaded||Dismissed=true → nil
      ▼
  有 pending？
  ├─ 否 ──► 静默继续
  └─ 是 ──► EventsEmit('eqt:crash-report-pending', true)
                 │
                 ▼
          前端 CheckCrashReport() ──► CrashReportInfo{ appVersion, timestamp, stackTrace(截断500) }
                 │
                 ▼
          打开崩溃上报面板（非 alert，in-app 面板）
```

**状态机（`DumpFile`）**：

```
                    ┌─────────────────────────────┐
                    ▼                             │
  PENDING ──用户点"上传"──► UPLOADED (SubmitAndClean)──► 下次启动不再提示
     │
     ├─用户点"忽略"───► 删除文件 (ClearDump)   ────► 下次启动不再提示
     │
     └─用户点"不再询问"（Dev 面板内 severer） ──► DISMISSED (MarkDismissed)
                                                      │ 文件保留(标记 Dismissed)
                                                      └─► 永不提示
```

| 动作 | 前端按钮 | Go 绑定 | 落盘效果 |
|---|---|---|---|
| 上传 | `#crash-report-upload` | `SubmitCrashReport()` | `SubmitAndClean` → 成功后 `MarkUploaded` |
| 忽略 | `#crash-report-ignore` | `DismissCrashReport()` | `ClearDump()`（删文件） |
| 不再询问 | `#crash-report-never-ask` | `DismissCrashReportPermanently()` | `MarkDismissed()`（留文件标记） |

---

## 四、反馈上传（feedback upload）

```
用户点"上传"
      │
      ▼
SubmitCrashReport()  (app.go)
      ├─ LoadDump()  校验存在
      ├─ ReadLogTail(desktop.log, 50)  ── log_tail（末 50 行）
      └─ crash.SubmitAndClean(dump.Report)
            ├─ crash.Submit()  ── POST  http(s)://{EQT_CRASH_SERVER 或 lic.eqt.net.im}/api/v1/crash-report
            │        body: { app_version, os_version, stack_trace, log_tail,
            │                device_id, license_code, timestamp }
            │        └─ 期望 200 + {"status":"received","report_id": "uuid"}
            ├─ 成功 ── MarkUploaded() ── 返回 report_id
            └─ 失败 ── 报错，dump 保留，下次启动仍可再传
```

**响应契约**（`sender.go` `Submit`）：
- 非 200 → error（含 status code）
- `status != "received"` → error（`unexpected status`）
- body 非 JSON → error（`parse crash report response`）
- 成功 → 返回 `report_id`

**后端落库**（`eqt-drm-api`，本仓库外）：
- D1 `system_error_logs`：`level=CRITICAL`、`category=DESKTOP_CRASH`、结构化摘要 + `context_json{report_id, r2_key}`
- R2 `crash-reports/{date}/{uuid}.txt`：完整 `stack_trace` + `log_tail`
- 鉴权：**无**（崩溃时无法可靠携带签名；crash 数据不含用户文件/凭证）

**幂等/语义**：上传成功即 `MarkUploaded`；网络失败则保留 dump → 下次启动重新弹窗。不会重复弹窗；离线用户永远可手动延迟上传。

---

## 五、开发/联调（dev-only 开关）

三处 dev 入口，均只读回环或仅在开发者模式下可见：

| 入口 | 触发方式 | 前置条件 | 行为 |
|---|---|---|---|
| **GUI 崩溃开关** | 设置 → 开发者选项 → "💥 触发崩溃测试" | GUI 处于 dev 模式 | 调 `DevTriggerCrash()` → 写 dump → 提示重启；**重启后走完整弹窗流程** |
| **CLI HTTP** | `curl -X POST 127.0.0.1:48176/dev/crash/trigger` | 设置 `devMode`，agent 运行 | 同上，写 dump 不退出 |
| **CLI HTTP 读** | `curl 127.0.0.1:48176/dev/crash/dump` | dev | 返回 `hasPending/uploaded/dismissed/report` |
| **CLI HTTP 上传** | `curl -X POST 127.0.0.1:48176/dev/crash/report` | dev（可用 `EQT_CRASH_SERVER` 指本地） | 现存 dump 上传，返回 `report_id` |

**守卫**：`/dev/*` 端点 `requireDevMode()`：非 dev（`settings.DevMode||DebugLog` 均 false）→ **403**；非回环 Origin → 拒。`DevTriggerCrash()` 绑定仅出现在 dev 选项面板（其本身不校验，但 UI 不暴露）。

**为何"触发崩溃"不实际退出进程**：真实崩溃会 `os.Exit`，测试副作用不可控。dev 开关只复用"采集→落盘"链路，进程保留，随后重启即可演练完整的上报交互。

---

## 六、验证方式

**单元测试**（`desktop/crash/*_test.go`）
- `reporter_test.go`：SaveAndLoadDump / HasPendingDump（none/pending/uploaded/dismissed）/ ClearDump / MarkUploadedThenDismissed / Collect / SaveDumpWithNil / ReadLogTail
- `sender_test.go`：Submit 请求体 7 字段 + 成功解析 / 非200 / 非常规 status / 非JSON / 网络失败 / SubmitAndClean 端到端上报+标记上传

**dev 端点测试**（`cmd/desktop_agent_dev_test.go`）
- 非 dev → 403；trigger/dump/report 生命周期；上报成功 vs 失败（502）；405
- 全部用 `t.TempDir` + `t.Setenv` 隔离真实 `~/.local/eqt/`

**手动演练**
1. dev 模式 → 设置面板点"触发崩溃测试" → 提示重启。
2. 重启 eqt-desktop → 出现崩溃上报弹窗 → 点"上传"（logs 见 `report_id`）或"忽略"/"不再询问"。
3. CLI 模式：`EQT_AGENT_PORT` 起 agent → `curl 127.0.0.1:48176/dev/crash/dump` / `trigger` / `report`。

---

## 七、边界与已知限制

- **SIGSEGV 恢复是尽力而为**：Go 运行时对 SIGSEGV 行为随平台变化；SIGABRT 对 fatal error 可靠。
- **崩溃时不上传**：无网络/UI 崩溃时不硬传，靠下次启动兜底。
- **上传目标仅 127.0.0.1 绑定 + dev 守卫**：生产环境 `/dev/*` 不可达。
- **后端契约一致性**：`report_id`/`status:"received"` 契约由 sender 测试锁定；生产端点在 `eqt-drm-api`（本仓库外）确认。
- **Fingerprint 空值防呆**：`device_id` 采集走既有指纹逻辑，空字段跳过比较，不影响上报。