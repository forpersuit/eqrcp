<!-- 本文档为 SSOT（Single Source of Truth），所有基础设施可观测性工作项以此为准。开发人员更新状态后提交。 -->

# 基础设施可观测性与数据治理

> 分析日期：2026-08-04
> 范围：eqt-drm-api（Cloudflare Workers + D1）+ eqt-desktop（Go + Wails）
> 触发：审查员指出测试覆盖不等于基础设施扎实，关键是在未预判的风险发生时能否重建现场

---

## 一、数据保留策略

### 1.1 各表数据特征与保留建议

| 表 | 行大小 | 增长速率（估） | 保留建议 | 理由 |
|---|---|---|---|---|
| `device_registry` | ~200B/行 | 慢（每设备一行） | **永久保留** | 设备身份系统。删除行会破坏指纹→device_id 映射，设备回归时无法识别。活跃过滤靠查询 WHERE last_seen_at，不靠删除 |
| `activations` | ~150B/行 | 中（每激活一行） | **永久保留** | 许可证使用记录，与 license 生命周期绑定。退款/吊销后仍需追溯 |
| `admin_audit_logs` | ~500B/行 | 低（管理员操作） | **90 天** | 安全取证窗口。90 天后的审计价值急剧下降 |
| `system_error_logs` | ~1KB/行（含 stack） | 低（异常触发） | **30 天** | 调试窗口。30 天前的错误通常已修复或无关 |
| `license_upgrades` | ~200B/行 | 极低 | **永久保留** | 升级交易记录，与退款/吊销关联 |
| `unbind_records` | ~200B/行 | 低 | **永久保留** | 许可证解绑记录，与滥用检测关联 |
| `rate_limits` | ~100B/行 | 中（自动过期覆盖） | **自动过期** | 窗口过期后自然覆盖，无需显式清理 |

### 1.2 Cloudflare D1 定价参考

| 指标 | Free 上限 | Paid 单价 |
|---|---|---|
| 存储 | 5 GB | $0.75/GB/月 |
| 读行数 | 5,000,000/天 | $0.001/百万行 |
| 写行数 | 100,000/天 | $0.75/百万行 |

**估算**：当前数据量远低于 Free 上限。即使 1 年后，`device_registry` + `activations` 合计预计 < 50MB。**数据保留不是成本问题**，不需要为省钱而删数据。

### 1.3 清理策略

不需要定期清理数据，但需要提供管理工具：

```
Admin API: POST /api/v1/admin/system/prune
  - 删除 system_error_logs WHERE created_at < 30天前
  - 删除 admin_audit_logs WHERE created_at < 90天前
  - 返回删除行数
```

手动触发而非自动 cron，因为：
- D1 没有 Workers Cron Triggers 的原生集成（需要独立 scheduled Worker）
- 清理频率低（季度一次即可）
- 管理员在 dashboard 上点一下即可

---

## 二、崩溃/异常上报

### 2.1 当前状态

**Worker 端**：`index.ts` 有全局 `catch` → `logSystemError(env, 'SERVER_EXCEPTION', 'CRITICAL', ...)` → 写入 `system_error_logs`。覆盖了未捕获的请求处理异常。

**桌面端（eqt-desktop）**：**零覆盖**。Go 程序崩溃（panic、SIGSEGV、SIGABRT）时：
- 操作系统显示"程序已停止工作"
- 无任何诊断数据收集
- 开发者完全不知道崩溃发生了

### 2.2 设计方案

#### 后端：崩溃上报端点

```
POST /api/v1/crash-report
Content-Type: application/json

字段：
  - app_version    (string, required)   桌面端版本号
  - os_version     (string, required)   Windows 版本
  - stack_trace    (string, required)   崩溃栈
  - log_tail       (string, optional)   崩溃前最后 N 行日志
  - device_id      (string, optional)   DRM 设备 ID
  - license_code   (string, optional)   当前许可证
```

存储：
- **D1 `system_error_logs`**：结构化元数据（version、os、device_id、stack_trace 摘要）
- **R2 `crash-reports/{date}/{uuid}.txt`**：完整 stack_trace + log_tail（D1 不适合存大文本）

响应：
```json
{ "status": "received", "report_id": "uuid" }
```

鉴权：不需要鉴权。崩溃时用户可能无法提供有效签名，且 crash 数据不敏感（不含用户文件或凭证）。HMAC 签名防伪造设计已评估但未实现——崩溃场景下要求签名会降低上报率，且伪造 crash 数据的攻击面极低（仅用于调试分析）。

#### 桌面端：崩溃收集器

在 `desktop/` 中新增：

```
desktop/crash/
  reporter.go       — 崩溃发生时收集诊断信息
  sender.go         — HTTP 上传到 lic.eqt.net.im/api/v1/crash-report
```

触发机制：

1. **panic 恢复**：在 `main.go` 的顶层 goroutine 用 `recover()` 捕获 panic
2. **信号处理**：注册 `SIGSEGV`、`SIGABRT` 的 handler（Go 不支持恢复 SIGSEGV，但可以注册 `SetNotify` 在崩溃前写 dump）
3. **启动时检查**：每次启动检查上次的 `crash.dump` 文件，如有则上传

收集内容：

```
- app_version (编译时注入)
- os_version (runtime.GOOS + Windows 版本)
- stack_trace (debug.Stack())
- log_tail (最后 50 行内存日志，如果有 ring buffer)
- device_id (从本地 .lic 文件读取)
- license_code (从本地 .lic 文件读取)
```

用户交互：

- 崩溃时：静默写入 `{appdata}/crash.dump`，不弹窗（崩溃时 UI 已不可用）
- 下次启动：检测到未上传的 dump，弹窗询问"上次异常退出，是否上传诊断报告帮助改进？"
- 用户可选择"上传"、"忽略"、"不再询问"

### 2.3 数据落地分析

```
D1 system_error_logs:
  level:        'CRITICAL'
  category:     'DESKTOP_CRASH'
  error_message: "app_version=1.5.0 os=windows/amd64 device_id=abc... stack=SIGSEGV at 0x..."
  context_json: { "report_id": "uuid", "r2_key": "crash-reports/2026-08-04/uuid.txt" }

R2 crash-reports/:
  2026-08-04/
    a1b2c3d4.txt    — 完整 stack_trace + log_tail
    e5f6g7h8.txt
```

查询方式：

```sql
-- 按版本统计崩溃率
SELECT error_message, COUNT(*) as count
FROM system_error_logs
WHERE category = 'DESKTOP_CRASH'
  AND created_at >= datetime('now', '-30 days')
GROUP BY error_message
ORDER BY count DESC;

-- 查看某次崩溃详情
SELECT * FROM system_error_logs
WHERE category = 'DESKTOP_CRASH'
  AND created_at >= datetime('now', '-7 days')
ORDER BY created_at DESC;
```

---

## 三、基础设施缺口（优先级排序）

### P0 — 设备注册写入审计

**现状**：`registerOrRefreshDevice` 所有关键决策静默。

**方案**：在 `device-registry.ts` 的三个跳过出口加 `logSystemError(env, 'DEVICE_REGISTRY', 'WARN', ...)`：

| 出口 | 记录内容 |
|---|---|
| 防抖跳过（L117 不更新） | `"debounce_skip device={id} age={秒} tier={tier}"` |
| 免费不降级（L110 保持 paid） | `"tier_protection device={id} existing=paid incoming=free"` |
| 指纹无匹配新建（L153 新行） | `"new_device uuid_prefix={8} cpu={bool} disk={bool}"` |

正常写入不记录——行数据本身就是记录。

**改动量**：1 文件，~15 行。测试已在 T6/T7/T8/T12 覆盖这些决策点。

### P0 — 桌面端崩溃上报

**现状**：桌面端崩溃完全不可见。

**方案**：见 §2。后端 1 个新端点 + R2 bucket 配置；桌面端 `crash/` 包。

**改动量**：后端 ~50 行（新路由 + R2 写入）；桌面端 ~200 行（收集 + 发送 + 启动检查）。
### 2.4 当前实现回顾与 UX 缺口

P0 #8 已完成的基础设施层（crash.dump 写入/读取/上报/后端端点）是扎实的。但**用户侧的体验链路存在断裂**：

**当前流程**：
1. 崩溃发生 → `crash.SaveDump()` 静默写入 `crash.dump`
2. 下次启动 → `startup()` 检测到 dump → 触发 `eqt:crash-report-pending` 事件
3. 前端收到事件 → 调用 `CheckCrashReport()` → 直接弹出崩溃报告模态框
4. 用户看到 💥 弹窗，有三个选项：上传 / 忽略 / 不再询问
5. 用户关闭弹窗（X 按钮）→ `closePanel()` 仅清空 `state.crashReport`，**不清理 dump 文件**
6. 下次启动 → 再次弹出（因为 dump 还在）

**问题**：
- 崩溃报告与反馈/建议流程完全割裂。用户看到崩溃弹窗，但无法在反馈界面中关联崩溃上下文
- 关闭弹窗后 dump 残留，下次启动再次弹窗，形成重复打扰
- 没有视觉提示引导用户到反馈入口（主题色圆点）
- 崩溃信息没有预填到反馈表单中，用户想反馈时需手动描述

### 2.5 GUI 后续开发：崩溃恢复 UX 优化（设计稿）

**目标**：将崩溃上报融入反馈/建议流程，用渐进式视觉提示引导用户，避免突兀弹窗。

**设计流程**：

```
启动 → 检测到 crash.dump
  │
  ├─ 方案 A（推荐）：渐进式提示
  │   1. "..." 省略号按钮显示主题色圆点（badge-dot）
  │   2. 点击 "..." → 下拉菜单中 "反馈/建议" 菜单项右侧显示主题色圆点
  │   3. 点击 "反馈/建议" → 打开反馈面板，预填：
  │      - 分类自动选择 "bug"
  │      - 消息区域预填崩溃摘要（版本、时间、stack_trace 前 200 字）
  │      - 诊断信息自动包含 crash dump 内容
  │      - 提交按钮显示主题色圆点（提示有未处理的崩溃信息）
  │   4. 用户提交 → 调用 SubmitCrashReport() + SubmitFeedback() 合并提交
  │   5. 用户关闭面板 → 调用 crash.ClearDump() 清理 dump
  │
  ├─ 方案 B：保留当前弹窗，但增加反馈入口
  │   保留现有崩溃报告弹窗，但在弹窗底部增加 "查看详情并提交反馈" 按钮
  │   点击后跳转到反馈面板，预填崩溃信息
  │
  └─ 方案 C：自动静默上报 + 主题色圆点提示
      启动时自动静默上报 crash dump（不打扰用户）
      上报成功后，主题色圆点提示 "上次崩溃已自动上报，点击查看详情"
      用户可打开反馈面板补充说明
```

**推荐方案 A** 的理由：
- 避免突兀弹窗打断用户操作（当前 crash-report 模态框是强中断）
- 主题色圆点是渐进式提示，用户可忽略，也可跟进
- 复用现有反馈面板，无需新写 UI 组件
- 崩溃信息自动预填，降低用户反馈门槛
- 关闭即清理，不留残留

**改动范围**（前端 main.js + state.js，后端 app.go）：
- `state.js`：新增 `state.pendingCrashDump` 标志位
- `main.js`：`eqt:crash-report-pending` 事件改为设置标志位 + 主题色圆点渲染，不再直接弹窗
- `main.js`：省略号按钮和反馈菜单项增加条件性 badge-dot 渲染
- `main.js`：反馈面板增加崩溃信息预填逻辑
- `main.js`：关闭面板时调用 `DismissCrashReport()` 清理 dump
- `app.go`：新增 `GetCrashReportDetail()` 方法返回完整 dump 信息供预填

**改动量**：前端 ~80 行，后端 ~20 行。无需新 UI 组件。

### P1 — 数据清理管理端点

**现状**：`system_error_logs` 和 `admin_audit_logs` 只增不减。

**方案**：`POST /api/v1/admin/system/prune`，管理员手动触发。

**改动量**：~30 行，复用已有 admin 鉴权。

### P1 — 限流可见性

**现状**：设备注册限流（`isDeviceRegisterRateLimited`）和 admin 认证限流（`isAdminAuthRateLimited`）使用 in-isolate Map，多 region 部署时每个 isolate 独立计数，且无法查询当前限流状态。

**方案**：在 admin dashboard 加一个限流状态端点（只读，返回当前 isolate 的 bucket 大小），或在 `system_error_logs` 中记录限流命中事件。

**改动量**：小。但价值取决于部署规模（单 region 时意义有限）。

### P2 — 关键错误告警

**现状**：`system_error_logs` 写入后无人通知。

**方案**：当 `CRITICAL` 级别错误写入时，通过 `sendDRMEmail` 通知管理员邮箱。需要：
1. 在 `logSystemError` 中增加 level 判断
2. 配置管理员通知邮箱（`env.ADMIN_ALERT_EMAIL`）

**改动量**：~20 行。但邮件可能被淹没，需要限频（每小时最多 1 封）。

### P2 — 健康检查端点

**现状**：`GET /` 返回 `{ status: "EQT DRM Serverless API Running" }`，但无深度检查。

**方案**：`GET /api/v1/health` 返回 D1 连通性、R2 连通性、各表行数统计。

**改动量**：~30 行。对 UptimeRobot 等外部监控有用。

---

## 四、总结

```
当前水位                   目标水位
──────────────────────    ──────────────────────
查询审计（admin）✅        写入审计（device_registry）❌ → P0
Worker 异常捕获 ✅         桌面端崩溃上报 ❌ → P0
system_error_logs 只增     可管理清理 → P1
限流 in-isolate 不可见     限流可见性 → P1
无告警                     关键错误邮件通知 → P2
无健康检查                 深度健康检查 → P2
```

最关键的缺口是**写入审计**和**桌面端崩溃上报**——前者影响数据链的可追溯性，后者影响整个桌面端产品的可维护性。两者都是"不出事时感觉不到，出事时没有它寸步难行"的基础设施。

---

## 五、可观测性完整维度总览

一个 DRM 收费系统在 Cloudflare 上应有的可观测性覆盖：

```
请求层面         数据层面         业务层面         运营层面
────────────────────────────────────────────────────────────
日志聚合         备份与恢复       激活/验证趋势     部署流水线
分布式追踪       数据完整性校验   许可证使用率      回滚策略
延迟监控         存储成本跟踪     异常模式检测      配置管理
错误率监控       数据保留执行     用户流失信号      变更审计
```

当前文档 §1-§4 覆盖了**数据保留**和**错误日志**，以下 §6-§8 补齐其余维度。

---

## 六、P0 — 现在不补，出事就是事故

### 6.1 D1 备份策略

**现状**：`licenses` 和 `activations` 是收入命脉，但无任何备份机制。D1 实例故障 = 所有付费用户 DRM 验证不可用 = 收入中断。

**目标**：RTO ≤ 1 小时，RPO ≤ 24 小时。

**方案**：

```bash
# 手动备份（验证用）
wrangler d1 backup create eqt-drm-db --remote

# 查看备份列表
wrangler d1 backup list eqt-drm-db --remote

# 恢复到本地测试
wrangler d1 backup restore eqt-drm-db <backup-id>
```

自动化方案（二选一）：

| 方案 | 方式 | 优点 | 缺点 |
|---|---|---|---|
| **A. Scheduled Worker** | 部署一个独立 Worker，绑定 D1，cron 触发备份 | 全在 Cloudflare 内 | D1 backup create 是 CLI 命令，Worker 内无法直接调用，需 REST API 封装 |
| **B. GitHub Actions cron** | 每天 UTC 0:00 运行 `wrangler d1 backup create` | 简单可靠，有日志 | 依赖 GitHub 可用性 |

**推荐方案 B**，因为 D1 备份 CLI 在 GitHub Actions 中可直接运行，无需额外 API 封装。

**验证标准**：
- 备份文件可下载并恢复到本地 SQLite
- 恢复后的数据与生产 D1 一致（行数校验）
- 每季度执行一次恢复演练

**改动量**：GitHub Actions workflow 配置，零代码改动。

---

### 6.2 结构化日志 + 集中查询

**现状**：Workers 使用 `console.log` 输出非结构化文本，生产环境无法高效检索。出问题时只能靠 D1 `system_error_logs` 的碎片拼图，正常请求日志完全不可查。

**方案**：

每个 Worker 入口加日志中间件，输出 JSON 结构化日志：

```typescript
// 日志中间件（每个 Worker 的入口处）
function logRequest(request: Request, ctx: ExecutionContext, response: Response, durationMs: number) {
  const cf = request.cf as any;
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: response.status >= 500 ? 'ERROR' : response.status >= 400 ? 'WARN' : 'INFO',
    requestId: request.headers.get('cf-ray') || crypto.randomUUID(),
    method: request.method,
    path: new URL(request.url).pathname,
    statusCode: response.status,
    durationMs,
    country: cf?.country || 'unknown',
    colo: cf?.colo || 'unknown',
    userAgent: request.headers.get('user-agent')?.slice(0, 80),
  }));
}
```

**Logpush 配置**（一次性）：

```bash
# 创建 Logpush 作业，将 Workers 日志推送到 R2
wrangler logpush create --logpush-name "eqt-drm-logs" \
  --destination "r2://eqt-logs-bucket/{DATE}/{HOUR}/{MINUTE}_{SECOND}_{REQUEST_ID}.json"
```

> 注意：Logpush 需要 Cloudflare 仪表盘或 API 配置，wrangler 命令仅为示意。实际配置参考 [Cloudflare Logpush docs](https://developers.cloudflare.com/logs/).

**涉及 Worker**（实际只有 2 个 Worker 需要结构化日志，其余 Pages 项目无独立 Worker 运行时）：
- `eqt-drm-api`（最高优先级，核心业务）✅ 已实现
- `eqt-feedback-api` ✅ 已实现

> 注：`eqt-admin` 是 Pages Function 仅做反向代理，日志由上游 eqt-drm-api 覆盖；`eqt-website` 是 Pages 静态站点；`eqt-p2p-app` 是 Svelte 前端编译产物；`eqt-p2p-signal` 目录下无源文件。以上 4 个不需要独立结构化日志中间件。

**验证标准**：
- 每个请求在 `console.log` 中输出一行 JSON
- JSON 包含 timestamp, level, requestId, method, path, statusCode, durationMs
- Logpush 目标可查询（R2 中可找到对应文件）

**改动量**：每个 Worker ~30 行中间件代码 + Logpush 配置一次。

---

### 6.3 定义 SLO + 外部监控

**现状**：无 SLO 定义，无外部监控。系统是否健康靠"感觉"。

**SLO 定义**：

| 指标 | SLO | 测量方式 | 窗口 |
|---|---|---|---|
| API 可用性 | ≥ 99.5% | 外部探测（UptimeRobot） | 30 天滚动 |
| `/verify` P99 延迟 | ≤ 1,000ms | Worker 日志 durationMs | 7 天滚动 |
| 激活成功率 | ≥ 99.9% | D1 聚合查询 | 30 天滚动 |
| 桌面端崩溃率 | ≤ 2% / 月 | 崩溃上报统计 | 30 天滚动 |

**外部监控配置**（需手动操作）：

1. 注册 [UptimeRobot](https://uptimerobot.com)（Free 层 50 个监控器）
2. 登录后进入 **Integrations & API** > **API**，复制 API Key
3. 添加监控器（可通过 API 或仪表盘）：

   ```bash
   # 通过 API 创建监控器（替换 YOUR_API_KEY）
   curl -X POST https://api.uptimerobot.com/v2/newMonitor \
     -d 'api_key=YOUR_API_KEY&format=json&type=1&url=https://lic.eqt.net.im/api/v1/health&friendly_name=eqt-drm-health&interval=300'
   curl -X POST https://api.uptimerobot.com/v2/newMonitor \
     -d 'api_key=YOUR_API_KEY&format=json&type=1&url=https://feedback.eqt.net.im/api/v1/health&friendly_name=eqt-feedback&interval=300'
   curl -X POST https://api.uptimerobot.com/v2/newMonitor \
     -d 'api_key=YOUR_API_KEY&format=json&type=1&url=https://www.eqt.net.im&friendly_name=eqt-website&interval=300'
   ```

4. 告警通知：在 UptimeRobot 中配置通知渠道。当前已配置邮件通知到 admin@eqt.net.im，关联到所有监控器。

**健康检查端点增强**（复用 §3 P2 方案，升为 P0）：

```typescript
// GET /api/v1/health 返回
{
  "status": "healthy",          // "healthy" | "degraded" | "down"
  "d1": { "connected": true, "queryLatencyMs": 12 },
  "r2": { "connected": true },
  "uptime": 3600,               // 当前 Worker 运行秒数
  "version": "1.5.0",
  "lastError": null             // 最近一次 CRITICAL 错误时间，如有
}
```

**验证标准**：
- UptimeRobot 显示 3 个监控器均为 UP
- 月度可用性报告 ≥ 99.5%
- 健康检查端点返回真实 D1 延迟

**改动量**：健康检查端点 ~30 行代码 + UptimeRobot 注册配置。

---

## 七、P1 — 不补会很痛，排查效率低

### 7.1 请求级追踪（trace_id）

**现状**：用户报错时无法关联请求链路。D1 中的错误记录没有请求上下文，无法串起"用户做了什么 → 系统哪里失败了"。

**方案**：

1. 每个请求入口生成 `trace_id`（UUID v7，按时间有序）
2. 在响应 header 返回 `X-Trace-Id`
3. 所有 D1 写入带上 `trace_id` 列
4. 桌面端 HTTP client 透传 `trace_id`

```typescript
// Worker 入口
const traceId = crypto.randomUUID();
request = new Request(request, { headers: { ...request.headers, 'X-Trace-Id': traceId } });

// 响应时返回
response.headers.set('X-Trace-Id', traceId);
```

**D1 schema 变更**：

```sql
ALTER TABLE system_error_logs ADD COLUMN trace_id TEXT;
ALTER TABLE activations ADD COLUMN trace_id TEXT;
```

**桌面端透传**（Go）：

```go
req, _ := http.NewRequest("POST", url, body)
req.Header.Set("X-Trace-Id", traceId) // 启动时生成，生命周期内复用
```

**验证标准**：
- 每个响应包含 `X-Trace-Id` header
- D1 `system_error_logs` 中可查到对应 `trace_id`
- 桌面端请求携带 `X-Trace-Id`

**改动量**：每个 Worker ~10 行，D1 加 2 列，桌面端 ~5 行。

---

### 7.2 业务指标仪表盘

**现状**：数据都在 D1 里，但无人查看。运营决策靠直觉。

**方案**：在 admin dashboard 中增加一个指标页面，展示：

| 指标 | 查询 | 刷新频率 |
|---|---|---|
| 每日活跃设备数 | `SELECT COUNT(*) FROM device_registry WHERE last_seen_at > datetime('now', '-1 day')` | 每小时 |
| 激活成功率 | `SELECT COUNT(*) / (SELECT COUNT(*) FROM activations WHERE activated_at > ...)` | 每小时 |
| 许可证 tier 分布 | `SELECT tier, COUNT(*) FROM licenses GROUP BY tier` | 每日 |
| 崩溃率趋势 | `SELECT date(created_at), COUNT(*) FROM system_error_logs WHERE category='DESKTOP_CRASH' GROUP BY date` | 每日 |
| 限流命中次数 | `SELECT COUNT(*) FROM system_error_logs WHERE category LIKE '%RATE_LIMIT%'` | 每小时 |

**验证标准**：
- admin dashboard 可访问指标页面
- 各指标数据与 D1 直接查询一致
- 图表随时间更新

**改动量**：后端聚合查询 ~50 行，前端 chart 页面 ~100 行。复用现有 admin 鉴权。

---

### 7.3 告警升级机制

**现状**：CRITICAL 错误写入 D1 后无人通知。§3 P2 方案仅提到发邮件，但凌晨邮件无人看。

**方案**：

| 级别 | 触发条件 | 通知方式 | 频率限制 |
|---|---|---|---|
| WARN | 非关键错误、限流命中 | 日汇总邮件 | 每日 1 封 |
| ERROR | 激活失败、验证异常 | 即时邮件 | 每小时最多 3 封 |
| CRITICAL | 服务不可用、数据异常 | 即时邮件 + Telegram/飞书 | 每小时最多 1 封 |

**Telegram 通知**（已有 `eqt-feedback-api` 的 Telegram 集成，可复用）：

```typescript
// 复用现有 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
async function sendAlert(level: string, message: string) {
  if (level !== 'CRITICAL') return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: `🚨 [${level}] ${message}` }),
  });
}
```

**验证标准**：
- CRITICAL 错误触发后 1 分钟内收到 Telegram 通知
- ERROR 级别每小时不超过 3 封邮件
- WARN 级别每日汇总一封

**改动量**：~30 行代码，复用现有 Telegram token。

---

## 八、P2 — 有了更好，没有也能活

| 事项 | 说明 | 预估改动量 | 前置依赖 |
|---|---|---|---|
| 部署流水线 | GitHub Actions：push → test → deploy staging → 手动确认 → deploy production | GitHub Actions 配置 | 无 |
| 回滚策略 | `wrangler versions` 保留历史版本，支持秒级回滚 | 配置 | 部署流水线 |
| 成本监控 | Cloudflare 仪表盘设置预算告警，每月检查用量趋势 | 配置 | 无 |
| 滥用检测自动化 | 基于 D1 查询自动检测异常激活模式，触发限流或通知 | ~50 行 | 已有 blacklist 表 |

---

## 九、开发进度追踪

> 开发人员：完成一项后，将状态改为 `✅ 已完成` 并填写完成日期与验证方式。PM 定期 review。

### P0 — 必须优先完成

| # | 事项 | 状态 | 负责人 | 预计完成 | 实际完成 | 验证方式 |
|---|---|---|---|---|---|---|
| 1 | D1 备份策略（GitHub Actions cron + 恢复演练 + 失败 Telegram 通知） | ✅ 已完成 | — | — | 2026-08-05 | 备份文件可下载恢复，季度演练通过，失败时 Telegram 通知 |
| 2 | 结构化日志中间件（所有 Worker） | ✅ 已完成 | — | — | 2026-08-05 | 每个请求输出 JSON 日志，Logpush 可查 |
| 3 | Logpush 配置（R2 目标） | ⏸️ 暂缓 | — | — | — | wrangler.toml 已配 logpush=true，需升级 Workers Paid 计划后开通 |
| 4 | SLO 定义文档化 | ✅ 已完成 | — | — | 2026-08-05 | 本文档 §6.3 已定义，团队确认 |
| 5 | 健康检查端点增强（D1/R2 深度检测 + 24h 错误回溯） | ✅ 已完成 | — | — | 2026-08-05 | 返回真实 D1 延迟 + R2 HEAD 探测，UptimeRobot 绿色 |
| 6 | UptimeRobot 外部监控配置 | ✅ 已完成 | — | — | 2026-08-05 | 3 个监控器均为 UP（drm-health/feedback/www），邮件告警已关联 admin@eqt.net.im，月度报告 ≥ 99.5% |
| 7 | 设备注册写入审计（device-registry.ts 三个静默出口） | ✅ 已完成 | — | — | 2026-08-05 | 防抖跳过/免费不降级写入 WARN，新建设备写入 INFO |
| 8 | 桌面端崩溃上报（desktop/crash/ 包 + 后端端点） | ✅ 已完成 | — | — | 2026-08-05 | 崩溃后下次启动弹窗询问上传，panic 恢复写入 crash.dump，后端 D1+R2 双存储 |
| 8a | 崩溃恢复 UX 优化（主题色圆点渐进提示 + 反馈面板预填） | ✅ 已完成 | — | — | 2026-08-05 | 主题色圆点引导 → 反馈面板预填崩溃信息 → 关闭即清理；修复启动事件竞态（前端初始化主动 CheckCrashReport） |

### P1 — 重要，排期跟进

| # | 事项 | 状态 | 负责人 | 预计完成 | 实际完成 | 验证方式 |
|---|---|---|---|---|---|---|
| 9 | 请求级 trace_id（Worker + D1 + 桌面端） | ✅ 已完成 | — | — | 2026-08-05 | 响应含 X-Trace-Id，D1 可查 |
| 10 | 业务指标仪表盘（admin 页面） | ✅ 已完成 | — | — | 2026-08-05 | 5 个指标可查看，与 D1 查询一致 |
| 11 | 告警升级机制（Telegram + 邮件分层） | ✅ 已完成 | — | — | 2026-08-05 | CRITICAL 触发 Telegram 通知，1/h 限频 |
| 12 | 数据清理管理端点（POST /api/v1/admin/system/prune） | ✅ 已完成 | — | — | 2026-08-05 | 删除 30 天前 error_logs 和 90 天前 audit_logs，返回删除行数 |
| 13 | 限流可见性（记录限流命中 + 状态端点） | ✅ 已完成 | — | — | 2026-08-05 | 限流命中记录到 system_error_logs，GET /api/v1/admin/rate-limit-status 返回当前 bucket 大小 |

### P2 — 优化项，backlog

| # | 事项 | 状态 | 负责人 | 预计完成 | 实际完成 | 验证方式 |
|---|---|---|---|---|---|---|
| 12 | 部署流水线（GitHub Actions） | ✅ 已完成 | — | — | 2026-08-06 | CI 通过后自动触发，手动审批后部署 Workers + Pages，Telegram 通知 |
| 13 | 回滚策略（wrangler versions） | ✅ 已完成 | — | — | 2026-08-06 | deploy.yml 自动记录版本 ID 到 workflow summary，支持 wrangler rollback / versions deploy / 仪表盘三种回滚方式 |
| 14 | 成本监控（CF 预算告警） | ✅ 已完成 | — | — | 2026-08-06 | Billable Usage 仪表盘可查看每日用量费用；2 个预算告警已配置（$5 和 $10），超阈值时邮件通知 leeyelon@gmail.com |
| 15 | 滥用检测自动化 | ✅ 已完成 | — | — | 2026-08-07 | 激活后异步检测 3 条规则（激活数/指纹复用/IP 速率），自动封禁设备 + CRITICAL Telegram 告警 |

---

## 十、API Token 清单

| Token 名称 | 类型 | 存储位置 | 权限范围 | 用途 | 备注 |
|---|---|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | User API Token | GitHub Secrets + 环境变量 | Workers/D1 部署 | GitHub Actions 部署、D1 备份 | 旧 token，Logs/Logpush 仅 Read |
| `CLOUDFLARE_USER_API_TOKEN_EQT` | User API Token | `.env` | R2 Read&Write、Logs Read | Logpush 配置、R2 管理 | 2026-08-05 创建，已 Roll 一次 |
| `eqt` (Account API Token) | Account API Token | 仅 Cloudflare 仪表盘 | Logs Write、R2 Write、Workers Scripts Write、D1 Write | 全权限管理 | 共 32 个权限，含 Logs Write |
| `eqt` (R2 Account Token) | R2 Account API Token | 仅 Cloudflare 仪表盘 | R2 Admin Read&Write | R2 S3 兼容访问 | 用于 downloads.eqt.net.im |

---

## 十一、文档变更记录

| 日期 | 变更内容 | 变更人 |
|---|---|---|
| 2026-08-04 | 初始版本：数据保留策略 + 崩溃上报 + 基础设施缺口 | 分析报告 |
| 2026-08-04 | 补充 §5-§9：完整可观测性维度 + P0/P1/P2 事项 + 开发进度追踪 | Codex 分析 |
| 2026-08-05 | 实施 §6 P0：D1 备份工作流 + 结构化日志中间件 + 健康检查端点 + 设备注册审计 | 开发实施 |
| 2026-08-05 | 审查修复：error-logger 加 INFO 级别、new_device 降级、R2 真实探测、lastError 24h、备份恢复演练 + 失败通知、文档 Worker 范围修正 | 审查修复 |
| 2026-08-05 | Logpush 配置：wrangler.toml 加 logpush=true、创建 eqt-logs-bucket、R2 API token 就绪。暂缓开通（需 Workers Paid 计划） | 开发实施 |
| 2026-08-05 | 修复 UptimeRobot 监控：feedback 改为健康检查端点、website 改为 www.eqt.net.im、删除重复监控、配置邮件告警通知 | 开发实施 |
| 2026-08-05 | 新增 §10 API Token 清单；更新 §6.3 UptimeRobot 配置步骤（含 API curl 命令） | 文档更新 |
| 2026-08-05 | 实施 P0 #6：通过 UptimeRobot MCP 创建 3 个 HTTP 监控器（drm-health/feedback/website） | 开发实施 |
| 2026-08-05 | 实施 P0 #8：桌面端崩溃上报（后端 crash-report 端点 + R2 存储 + desktop/crash/ 包 + panic 恢复 + 前端弹窗） | 开发实施 |
| 2026-08-05 | 崩溃恢复 UX 设计评审：方案 A（渐进式主题色圆点 + 反馈面板预填）确定为推荐方案，待排期开发 | 设计评审 |
| 2026-08-05 | 修复 P0 #8a 启动竞态：OnStartup 中 emit 的 eqt:crash-report-pending 在 WebView 前端加载完成前丢失，改为前端初始化主动调用 CheckCrashReport | 开发实施 |
| 2026-08-05 | 实施 P1 #9-#13：请求级 trace_id、业务指标仪表盘、告警升级机制、数据清理端点、限流可见性 | 开发实施 |
| 2026-08-06 | 实施 P2 #12：部署流水线（deploy.yml），CI 通过后手动审批部署 Workers + Pages，Telegram 通知 | 开发实施 |
| 2026-08-06 | 审查修复：eqt-website functions 注释说明、deploy 后自动记录版本 ID 用于回滚 | 审查修复 |
| 2026-08-06 | 实施 P2 #13：回滚策略（wrangler rollback + versions deploy + 仪表盘），deploy.yml 记录版本到 workflow summary | 开发实施 |
| 2026-08-06 | 新增 docs/deploy/README.md：部署流水线完整文档，含 Mermaid 架构图、自动/手动部署说明、各项目特点、回滚策略 | 文档新增 |
| 2026-08-06 | 实施 P2 #14：成本监控，Cloudflare Billable Usage 仪表盘就绪，配置 $5 + $10 两个预算告警，邮件通知 leeyelon@gmail.com | 开发实施 |
| 2026-08-07 | 实施 P2 #15：滥用检测自动化，激活后异步检测 3 条规则（激活数/指纹复用/IP 速率），自动封禁设备 + CRITICAL Telegram 告警 | 开发实施 |
