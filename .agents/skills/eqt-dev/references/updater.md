# EQT 自动更新与签名验证技术参考 (EQT Auto-Update & Verification Reference)

本指南详述 EQT 的自动更新机制、Ed25519 验签细节、多环境编译及 Cloudflare Pages 部署注意事项。

---

## 1. 自动更新与验签机制避坑 (Update & Signature Verification Troubleshooting)

### 1.1 验签失败的根本成因
当客户端在 `devMode` 或 `debugLog` 日志中显示 `VerifyUpdateSignature: Ed25519 signature verify result: false` 时，说明下载的二进制文件与对应的 `.sig` 签名文件不匹配。
- **CI/CD 覆盖漏洞**：若发布新版本时重新触发 GitHub Actions 工作流（`.github/workflows/release.yml`），编译并上传最新的二进制文件到 Release，但未执行加签步骤生成对应的 `.sig`，会造成 Release 页面上“新二进制”与“旧签名”并存。
- **解决方法**：工作流在编译 Windows 可执行文件并打包至 Release 时，必须紧跟 `go run scripts/generate-update-sig/main.go out/eqt-desktop-windows-amd64.exe` 进行自动加签，并将生成的 `.sig` 资产同步上传发布。

### 1.2 离线加签调试
若需在本地或生产中紧急修正已有的 Release 签名，将目标 `.exe` 文件下载到本地，运行：
```bash
go run scripts/generate-update-sig/main.go <path/to/eqt-desktop-windows-amd64.exe>
```
运行后在同级目录生成同名 `.sig` 文件，随后在 GitHub Release 中使用 `gh release upload <tag> <file.sig> --clobber` 重新覆盖。

### 1.3 前端设置界面闪烁与重新渲染机制
- **重绘冲突**：前端全量覆写 `innerHTML` 模式下，后台通过 SSE 推送状态更新包并全量重绘时，会瞬间销毁展开的 Select 下拉菜单或正在输入的 Input，造成闪烁和焦点丢失。
- **解决方法**：后台状态事件监听器中，判断当前激活面板为设置（`state.activePanel === 'settings'` 或 `'redeem'`）时只更新内存状态，跳过全局全量重绘。

### 1.4 手动 Check Now 遵循 Auto-Update 策略
手动点击更新检测按钮（`Check now`）时，系统根据 `autoUpdateMode`（`off`/`notify` 仅提示，`download`/`silent` 自动触发下载）智能分流。

---

## 2. 自动更新的运行链路与集成测试验证机制

### 2.1 自动更新核心运行链路
采用“前端 UI -> Wails Go App 内存 Agent -> 云端/GitHub API”的单进程集中调用架构：
1. **版本检测**：前端触发 `CheckForUpdates` 绑定方法。App 内存 Agent 调用 `server.CheckForUpdates` 请求 `EQT_LICENSE_SERVER`（默认是 Worker 接口 `/api/v1/update/check`），对比语义化版本号，匹配当前 `GOOS` 和 `GOARCH` 对应的二进制资产与 `.sig` 签名资产链接。
2. **包下载与验签**：`DownloadUpdate` 异步下载二进制包及签名文件，使用内置 Ed25519 公钥（`defaultUpdatePublicKeyHex`）验签 SHA-256 哈希值，确认未篡改后存入本地缓存。
3. **安全替换与重启**：检测无活跃传输任务后，调用 `server.InstallAndRestart`：
   - **Windows**：将当前 `.exe` 重命名为 `.exe.old`，写入新二进制，启动新进程并退出旧进程，下次启动清理 `.old`。
   - **POSIX (Linux/macOS)**：写入 `.new` 临时文件，通过 `os.Rename` 原子覆盖。

### 2.2 本地与集成测试验证方法
- **单元测试 (`server/update_test.go`)**：通过 `TestVerifyUpdateSignature`、`TestCheckForUpdates` 和 `TestDownloadUpdate` 验证签名合法性、语义化版本反降级及写入完整性。
- **集成测试 (`cmd/desktop_agent_test.go`)**：在 `TestDesktopAgentUpdateEndpoints` 中通过 `httptest` 创建 Mock Update 服务，修改 `EQT_LICENSE_SERVER` 环境变量重定向客户端，模拟并发访问 `/update/check`、`/update/download` 及安装流程。

### 2.3 Wails 编译与 Binding 生成环境避坑
- **问题成因**：在无显示器（无 `DISPLAY`）的 headless Linux CI 容器中执行 `wails build` 时，编译绑定的临时 `wailsbindings` 程序缺少 CLI 参数可能报错退出。
- **解决方案**：在应用入口（`main()`）最前端检测 `os.Args[0]` 是否包含 `"wailsbindings"`，若是则强制走 GUI 模式启动 `startWailsGUI()`，让 Wails 提取反射绑定后正常退出。

### 2.4 Cloudflare Pages 部署主分支覆盖
在 `.github/workflows/release.yml` 的 Pages 部署命令中显式指定 `--branch=master`（`npx wrangler pages deploy cloudflare/eqt-website --project-name=eqt --branch=master`），确保 Tag 触发时依然映射为 Production 主域名更新。

---

## 3. Go embed 强缓存更新失效机制与彻底刷新策略

- **问题成因**：在 `pages.go` 等源码中使用 `//go:embed` 嵌入本地静态资源（如 `assets/tus.min.js`）时，物理资源修改但 Go 源码未修改可能命中编译缓存。
- **解决方案**：
  1. 对包含 `//go:embed` 声明的 Go 源码添加空行或注释，强迫编译器识别变化。
  2. 编译前执行 `go clean -cache`，编译时添加 `-a` 强制全量重建：
     ```bash
     go clean -cache
     go build -a -o ./test_eqt ./cmd/eqt
     ```
  3. 调试静态资源时清理浏览器强缓存（如重载时带上 `ignoreCache: true` 或随机时间戳）。
