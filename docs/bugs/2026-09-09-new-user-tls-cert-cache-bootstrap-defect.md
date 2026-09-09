# 缺陷复盘与落地方案：新用户首次运行 TLS 证书缓存缺失体验断层及静默自举机制

> **复盘日期**：2026-09-09  
> **文档位置**：`docs/bugs/2026-09-09-new-user-tls-cert-cache-bootstrap-defect.md`  
> **涉及组件**：桌面端 GUI（`desktop/gui/app.go`、`desktop/gui/agent.go`、`desktop/gui/frontend/src/main.js`）、证书管理模块（`pkg/cert/cert.go`）、云端授权中继服务（`lic.eqt.net.im`）  
> **核心命题**：新用户在全新环境中安装并运行 EQT 桌面端，设置面板默认开启「启用局域网回环 TLS (HTTPS)」，但因本地缺少证书缓存，立即出现黄色警告 `⚠️ 未检测到本地有效证书缓存，无证书时将自动降级为 HTTP 传输。`，且首次传输降级为明文 HTTP。本文复盘该体验断层的第一性根因，并制定完整的 Phase 0 静默自举落地方案（Auto-Bootstrapping）。

---

## 一、 缺陷现象与用户体验断层

### 1. 现象描述
1. 用户在全新电脑（Windows / macOS / Linux）下载、解压或安装 EQT 桌面端并启动；
2. 打开「设置（Settings）」页面，发现「启用局域网回环 TLS (HTTPS)」处于勾选状态（系统默认值开启）；
3. 开关下方紧接着呈现明显的黄色警告提示：
   ```text
   ⚠️ 未检测到本地有效证书缓存，无证书时将自动降级为 HTTP 传输。
   ```
4. 用户发起任何分享（send）、接收（receive）或聊天（chat）任务，移动端扫描屏幕二维码时，访问的均为未加密的 `http://<lan-ip>:port` 协议；浏览器地址栏无绿锁，且移动端高级 Web API（如剪贴板访问、录音权限等）被浏览器禁用；
5. **用户心理感受**：用户产生困惑与挫败感——*“既然程序宣传局域网原生公信 TLS 绿锁传输，且默认勾选了开启，为什么还会提示我没有证书？证书应该去哪里弄？难道需要我手动跑脚本或者买证书吗？”*

---

## 二、 代码机理剖析与历史根因

### 1. 代码执行路径跟踪
- **本地证书探针**：
  在 [`pkg/cert/cert.go:63-78`](file:///home/yelon/develop/me/eqrcp/pkg/cert/cert.go#L63-L78) 中，`getCachedCertPaths()` 检查本地用户目录：
  ```go
  dir := filepath.Join(home, ".config", "eqt", "certs")
  certFile := filepath.Join(dir, "fullchain.pem")
  keyFile := filepath.Join(dir, "privkey.pem")
  ```
  若上述文件不存在，[`cert.HasValidCertificate("", "")`](file:///home/yelon/develop/me/eqrcp/pkg/cert/cert.go#L58) 立即返回 `false`。
- **GUI 状态暴露**：
  在 [`desktop/gui/app.go:1261`](file:///home/yelon/develop/me/eqrcp/desktop/gui/app.go#L1261) 中，`AppInfo` 结构体直接封装该探针结果：
  ```go
  HasValidTLSCert: cert.HasValidCertificate("", ""),
  ```
- **前端告警渲染**：
  在 [`desktop/gui/frontend/src/main.js:2398`](file:///home/yelon/develop/me/eqrcp/desktop/gui/frontend/src/main.js#L2398) 中，设置模板根据该标志位进行条件渲染：
  ```javascript
  ${!state.appInfo?.hasValidTLSCert ? `<span style="display: block; font-size: 11px; color: var(--accent-warn, #e6a23c); margin-top: 3px;">⚠️ ${escapeHTML(t('tls_cert_not_detected') || '未检测到本地有效证书缓存，无证书时将自动降级为 HTTP 传输。')}</span>` : ''}
  ```
- **运行时防御性降级**：
  在 [`desktop/gui/agent.go:1031`](file:///home/yelon/develop/me/eqrcp/desktop/gui/agent.go#L1031) 中，启动任务时严格做 Fail-Soft 检查：
  ```go
  if cfg.Secure && !cert.HasValidCertificate(cfg.TlsCert, cfg.TlsKey) {
      cfg.Secure = false // 强制降级为 HTTP
  }
  ```

### 2. 缺陷形成的历史背景
该断层源于项目演进过程中的阶段性割裂：
- **阶段一（基础设施搭建）**：团队成功申请并验证了 `*.direct.eqt.net.im` 官方通配符证书与私钥，并编写了自动化同步脚本 `scripts/sync-lan-tls-cert.sh`；
- **阶段二（开发者环境就绪）**：开发机与集成测试机运行了同步脚本，本地均常备证书缓存，因此开发与 CI 环境中全链路绿锁正常；
- **阶段三（容灾防御上线）**：为防止无证书时导致任务直接崩溃（Fail-Closed），增加了 `cert.HasValidCertificate()` 探针与前端告警提示，实现了平滑降级（Fail-Soft）；
- **遗漏缺口**：**未向真实终端新用户提供开箱即用的“静默拉取下发机制”**。导致新安装用户成为“无证书孤岛”，默认配置与真实环境脱节。

---

## 三、 第一性原理解决方案：Phase 0 静默自举管线（Auto-Bootstrapping）

### 1. 核心设计原则
1. **零用户干预（Zero Configuration）**：新用户无需执行任何配置、命令或脚本；
2. **非阻塞与微秒级响应（Non-blocking UI）**：绝对严禁在 Wails 启动主线程或 `/status` 轮询中同步发起网络请求；
3. **安全权限收敛（Least Privilege）**：私钥落盘必须严格配置操作系统级访问控制（Windows DACL 限制当前用户独占，Unix 设为 `0600`）；
4. **状态无缝自愈（Silent Self-Healing）**：拉取成功后原子更新内存缓存并通过事件总线驱动前端，告警自动消失，首发即绿锁。

### 2. 架构时序图

```text
┌──────────────┐             ┌──────────────┐             ┌─────────────────────┐
│ EQT GUI 前端 │             │ EQT 后端引擎 │             │ lic.eqt.net.im (CF) │
└──────┬───────┘             └──────┬───────┘             └──────────┬──────────┘
       │                            │                                │
       │ 1. App.startup()           │                                │
       │───────────────────────────►│                                │
       │                            │ 2. 启动异步自举 Goroutine       │
       │                            │──┐                             │
       │                            │  │ 探针: !HasValidCert()       │
       │                            │◄─┘                             │
       │                            │                                │
       │                            │ 3. HTTPS GET /cert/wildcard    │
       │                            │───────────────────────────────►│
       │                            │                                │
       │                            │ 4. 200 OK (PEM Bundle JSON)    │
       │                            │◄───────────────────────────────│
       │                            │                                │
       │                            │ 5. 原子落盘 (~/.config/.../certs)│
       │                            │──┐                             │
       │                            │  │ chmod 0600 / DACL 权限收敛   │
       │                            │  │ 原子刷新内存 cert 缓存       │
       │                            │◄─┘                             │
       │                            │                                │
       │ 6. 事件广播:               │                                │
       │    "eqt:tls-cert-ready"    │                                │
       │◄───────────────────────────│                                │
       │                            │                                │
       │ 7. state.appInfo 更新:     │                                │
       │    hasValidTLSCert = true  │                                │
       │    ⚠️ 警告自动消除          │                                │
       │    🔒 绿锁状态就绪          │                                │
       ▼                            ▼                                ▼
```

### 3. 具体工程改造落地规约

#### (1) 云端 Worker 分发端点（`lic.eqt.net.im`）
在已有的 Cloudflare Worker 服务中增加受控的通配符证书分发路由：
- **路由路径**：`GET /api/v1/cert/wildcard-bundle`
- **鉴权规则**：验证合法的设备特征指纹头（`X-EQT-Device-ID`）或随现有的设备初次注册接口（`POST /api/v1/device/register`）响应体合并下发；
- **响应体数据**：
  ```json
  {
    "success": true,
    "domain": "*.direct.eqt.net.im",
    "fullchain": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
    "privkey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
    "expires_at": "2026-12-01T00:00:00Z"
  }
  ```

#### (2) 客户端异步拉取模块（`pkg/cert/bootstrap.go`）
在 `pkg/cert` 包中新增无阻塞静默自举函数：
```go
// BootstrapWildcardCertAsync 在后台异步检查并静默自举拉取证书，不阻塞主流程
func BootstrapWildcardCertAsync(onSuccess func()) {
    go func() {
        if HasValidCertificate("", "") {
            return // 已有有效证书，跳过
        }
        bundle, err := fetchWildcardBundleFromCloud()
        if err != nil {
            return // 网络离线时静默退出，维持 Fail-Soft 降级为 HTTP
        }
        if err := saveCertBundleWithRestrictedPerms(bundle); err != nil {
            return
        }
        if onSuccess != nil {
            onSuccess()
        }
    }()
}
```

#### (3) 权限收敛与存储安全
- **Linux / macOS**：
  创建目录 `~/.config/eqt/certs`（`0700`），文件写入采用 `os.WriteFile(path, data, 0600)`；
- **Windows**：
  调用系统安全 API 或 `icacls`，将 `%USERPROFILE%\.config\eqt\certs\` 权限剥离继承，并赋予当前用户（`%USERNAME%`）独占完全控制权，禁止普通跨用户读取。

#### (4) 前端无感消除黄色提示
在 `desktop/gui/app.go` 启动自举成功回调中：
```go
wailsruntime.EventsEmit(a.ctx, "eqt:tls-cert-ready", true)
```
前端 `desktop/gui/frontend/src/main.js` 监听该事件：
```javascript
window.runtime.EventsOn("eqt:tls-cert-ready", () => {
    state.appInfo.hasValidTLSCert = true;
    renderSettings(); // 重新渲染设置，黄色警告立即消失
});
```

#### (5) 周期性巡检与自动续签（Auto-Renewal）
- 桌面端启动及常驻运行时，设立 24 小时定时巡检协程；
- 当检测到当前本地证书距离到期时间不足 30 天时，自动在后台静默发起拉取更新，完成热重载覆盖；
- 彻底实现用户端终身免维护。

---

## 四、 验收基准与成功准则 (Definition of Done)

1. **全新虚拟机/全新机器验收**：
   在一台全新的机器（无任何 `~/.config/eqt` 目录）运行 `eqt-desktop.exe`；
2. **零配置绿锁就绪**：
   启动后 1~3 秒内（视网络状况），设置界面未出现或自动消除了黄色感叹号提示；
3. **首发 HTTPS 验证**：
   在设置保持默认开启 TLS 的情况下，直接创建 send 任务，生成的二维码与直连链接为 `https://192-168-x-x.direct.eqt.net.im:<port>/<token>`，手机扫码进入后直接呈现官方公信绿锁，且无任何浏览器安全警告。
