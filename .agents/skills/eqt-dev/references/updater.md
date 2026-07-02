# EQT 自动更新与签名验证技术参考 (EQT Auto-Update & Verification Reference)

本指南详述 EQT 的自动更新机制、Ed25519 验签细节、多环境编译及 Cloudflare Pages 部署注意事项。

---

## 1. 自动更新与验签机制避坑 (Update & Signature Verification Troubleshooting)

### 1.1 验签失败的根本成因
当客户端在 `devMode` 或 `debugLog` 日志中显示 `VerifyUpdateSignature: Ed25519 signature verify result: false` 时，说明下载的 `.exe` 二进制文件与对应的 `.sig` 签名文件不匹配。
- **CI/CD 覆盖漏洞**：若发布新版本时重新触发了 GitHub Actions 自动编译工作流（`.github/workflows/release.yml`），工作流会重新编译并上传最新的二进制文件到 Release。如果工作流中**未执行加签步骤**重新计算哈希并生成对应的 `.sig`，则会造成 Release 页面上“新二进制”与“旧签名”并存。
- **解决方法**：工作流在编译 Windows 可执行文件并打包至 Release 时，必须紧跟 `go run scripts/generate-update-sig/main.go out/eqt-desktop-windows-amd64.exe` 进行自动加签，并把生成的 `.sig` 资产同步上传发布。

### 1.2 离线加签调试
若需在本地或生产中紧急修正已有的 Release 签名，可将目标 `.exe` 文件下载到本地，运行如下指令自动计算其哈希、利用内置 `testPrivateKeySeedHex` 进行 Ed25519 数字签名：
```bash
go run scripts/generate-update-sig/main.go <path/to/eqt-desktop-windows-amd64.exe>
```
运行后会在同级目录下生成同名 `.sig` 文件，随后在 GitHub Release 中使用 `gh release upload <tag> <file.sig> --clobber` 将其重新覆盖即可。

### 1.3 前端设置界面闪烁与重新渲染机制
- **重绘冲突**：由于前端采用“全量覆写 `innerHTML`”模式，当后台进程通过 SSE 推送状态更新包并执行重新渲染时，会瞬间销毁原本展开的 Select 下拉菜单或处于输入状态的 Input 元素，造成严重的闪烁和焦点丢失。
- **解决方法**：在后台状态事件监听器中，检查如果当前激活的面板为设置（`state.activePanel === 'settings'` 或 `'redeem'`），则只更新内存状态，跳过全局大渲染，等待用户点击 `Save` 或通过局部机制进行重绘，完美解决交互冲突。

### 1.4 手动 Check Now 时遵循 Auto-Update 策略
- **手动/自动控制**：手动点击更新检测按钮（`Check now`）时，系统会根据当前的 `autoUpdateMode`（`off`/`notify` 仅提示，`download`/`silent` 自动触发下载）智能分流，确保在开发和生产环境下更新策略一致。

---

## 2. 自动更新的运行链路与集成测试验证机制

### 2.1 自动更新核心运行链路
自动更新采用“前端 UI -> Wails Go App 内存 Agent -> 云端/GitHub API”的单进程集中调用架构：
1. **版本检测**：前端触发 `CheckForUpdates` Wails 绑定方法。App 内存 Agent 会直接调用 `server.CheckForUpdates` 请求 `EQT_LICENSE_SERVER`（默认是云端中转 Worker 接口 `/api/v1/update/check`），如果最新发布版本高于当前运行版本，根据当前客户端 `GOOS` 和 `GOARCH` 过滤并匹配出主二进制资产与配套的 `.sig` 签名文件资产，返回两者的绝对下载链接。
2. **包下载与验签**：在 `DownloadUpdate` 中，内存 Agent 直接异步下载二进制包及签名文件并调用 `server.DownloadUpdate`。使用内置的 Ed25519 公钥（`defaultUpdatePublicKeyHex`）对包的 SHA-256 哈希值进行验签，确认包内容未被篡改后，存放到本地缓存路径。
3. **安全替换与重启**：内存 Agent 检测当前是否有活跃的局域网传输任务，若有则拒绝安装更新。若应用处于空闲状态，在调用 `server.InstallAndRestart` 后，开始安装：
   - **Windows**：将当前运行的 `.exe` 重命名为 `.exe.old`，写入新二进制，然后启动新进程退出旧进程，并在下次启动时清理 `.old`。
   - **POSIX (Linux/macOS)**：写入 `.new` 临时文件，并通过 `os.Rename` 原子覆盖旧的二进制。

### 2.2 本地与集成测试验证方法
- **单元测试 (`server/update_test.go`)**：通过 `TestVerifyUpdateSignature`、`TestCheckForUpdates` 和 `TestDownloadUpdate` 验证签名校验合法性、语义化版本反降级逻辑、及下载写入完整性。
- **集成测试 (`cmd/desktop_agent_test.go`)**：在 `TestDesktopAgentUpdateEndpoints` 中通过 `httptest` 创建 Mock Update 服务，临时修改 `EQT_LICENSE_SERVER` 环境变量重定向客户端，并使用测试私钥种子对测试包加签，模拟并发访问 `/update/check`、`/update/download` 及有任务冲突/空闲时的 `/update/install`。

### 2.3 Wails 编译与 Binding 生成环境避坑 (Wails Build & Bindings Generation in CI)
- **问题成因**：在没有显示器（`DISPLAY`/`WAYLAND_DISPLAY` 环境变量为空）的 headless Linux CI/CD 容器中执行 `wails build`，Wails 在生成绑定时会编译并执行一个临时的 `wailsbindings` 可执行文件。如果主程序路由逻辑中，在无 DISPLAY 且无参数时自动退回到 CLI 模式并直接调用 Cobra 命令，Cobra 会因为缺失必要参数返回错误并以 exit status 1 退出，最终导致 Wails 绑定生成步骤失败。
- **解决方案**：在应用入口（`main()`）最前端，对 `os.Args[0]` 的文件名进行判断。如果文件名中包含 `"wailsbindings"` 字符串，强制走 GUI 模式启动 `startWailsGUI()` 从而让 `wails.Run`接管。Wails 在运行时会拦截 `wails.Run` 以提取反射绑定并正常退出，该过程不依赖实际的 X服务器或 DISPLAY，能在 CI 容器中平滑编译成功。

### 2.4 Cloudflare Pages 自动部署中的分支覆盖与生产域名映射漏洞
- **问题成因**：由 Release 标签（例如 `v*`）触发 of GitHub Actions checkout 流程是分离的 HEAD，Wrangler 会自动将分支名称识别为 tag 名（如 `v1.7.3`）。若不指定分支参数，Wrangler 会把其判定为 Preview Branch 部署，更新 `head.eqt-27c.pages.dev` 却**不会更新**生产主域名 `eqt-27c.pages.dev`，导致主域名的 `update-metadata.json` 保持为旧的 404/Redirect 状态，使得客户端无法发现新版本。
- **解决方案**：在 `.github/workflows/release.yml` 的 Pages 部署命令中强制指定 `--branch=master` 参数（即 `npx wrangler pages deploy cloudflare/eqt-website --project-name=eqt --branch=master`），确保即使从 Tag 触发，Wrangler 依然会将此次部署映射为 Production，直接刷新生产环境的主域名并使最新的 `update-metadata.json` 物理生效。

---

## 3. Go embed 强缓存更新失效机制与彻底刷新策略

- **问题成因**：Go 编译器（`go run` 或普通的 `go build`）具有非常强大的文件编译缓存机制。如果在 Go 源码文件（例如 `pages.go`）中使用 `//go:embed` 嵌入了本地静态资源（如 `assets/tus.min.js`），当静态资源文件内容在物理上发生改变，但 `pages.go` 源码本身未进行任何字符更改时，Go 编译器可能会直接命中编译缓存，使用以前缓存的数据，而**不会读取新的静态资源文件**进行重新打包。这会导致在本地已修复的资源在编译出来的二进制和返回给浏览器的 HTTP 响应中依然是损坏的旧缓存。
- **解决方案**：
  1. **触发源码更新**：对包含 `//go:embed` 声明的 Go 源码文件（如 `pkg/pages/pages.go`）添加一行无实际语义影响的空行或注释，强迫编译器识别为源码变化。
  2. **强制全量编译与清理**：在编译前先执行 `go clean -cache` 清除编译缓存，然后在 build 时添加 `-a` 参数强制全量重建所有包：
     ```bash
     go clean -cache
     go build -a -o ./test_eqt ./cmd/eqt
     ```
  3. **清理浏览器强缓存**：被 embed 的静态资源如果带有较长的缓存期请求头（如 `Cache-Control: public, max-age=86400`），浏览器会走强缓存。在进行 CDP 仿真或者前端测试时，应使用忽略缓存参数的重载指令（例如 `navigate_page` 传入 `ignoreCache: true` 或带上随机时间戳 `?t=123` 进行调试）。
