# Wails GUI构建问题说明

## 问题

提交时 `eqrcp-desktop.exe` 没有更新，时间戳停留在旧版本。

## 根本原因

**wails命令不在PATH中**，导致pre-commit hook跳过了Wails GUI的构建。

### 检查方法

```powershell
# 检查wails是否可用
wails version

# 检查wails位置
where.exe wails

# 检查GOPATH/bin
go env GOPATH
Test-Path "$(go env GOPATH)\bin\wails.exe"
```

## 解决方案

### 方案1：安装wails到PATH（推荐）

如果你需要每次提交都自动构建Wails GUI：

```bash
# 安装wails
go install github.com/wailsapp/wails/v2/cmd/wails@latest

# 验证安装
wails version

# 确保GOPATH/bin在PATH中
# Windows: 添加 %USERPROFILE%\go\bin 到系统PATH
# Linux/Mac: 添加 $HOME/go/bin 到 ~/.bashrc 或 ~/.zshrc
```

### 方案2：跳过Wails构建（快速）

如果Wails GUI构建太慢，或者不需要每次提交都构建：

```bash
# 设置环境变量跳过Wails构建
export SKIP_WAILS_BUILD=1
git commit -m "message"

# 或者使用--no-verify跳过整个hook
git commit --no-verify -m "message"
```

### 方案3：手动构建Wails GUI

只在需要时手动构建：

```bash
cd desktop/gui
wails build -clean -o E:/developer/results/eqrcp-desktop.exe -platform windows/amd64
```

## Hook行为说明

Pre-commit hook现在会：

1. **检查wails是否可用**
   - 检查 `command -v wails`
   - 检查 `$(go env GOPATH)/bin/wails`

2. **根据检查结果**
   - ✅ wails可用 → 构建Wails GUI
   - ⚠️ wails不可用 → 跳过，显示提示信息
   - ⏭️ SKIP_WAILS_BUILD=1 → 跳过，显示跳过信息

3. **不会阻止提交**
   - 即使wails不可用，也不会导致提交失败
   - 只有Go tests或CLI构建失败才会阻止提交

## 为什么这样设计？

### First Principle考虑

1. **Wails构建很慢**
   - 通常需要几分钟
   - 不是每次提交都需要更新GUI

2. **wails不是必需的**
   - CLI功能是核心
   - GUI是可选的增强功能

3. **灵活性**
   - 开发者可以选择是否构建GUI
   - 不强制要求安装wails

## 当前状态

```
eqrcp-desktop.exe: 2026/5/2 23:10:00 (旧版本)
eqrcp.exe:         2026/5/3 1:04:59  (最新版本)
eqrcp-launcher.exe: 2026/5/3 1:04:59  (最新版本)
```

**原因**：wails不在PATH中，hook跳过了GUI构建

**解决**：
- 安装wails → 自动构建
- 或手动构建 → 按需更新
- 或接受现状 → CLI已是最新

## 推荐做法

### 日常开发

```bash
# 跳过Wails构建，加快提交速度
export SKIP_WAILS_BUILD=1
git commit -m "message"
```

### 发布前

```bash
# 手动构建Wails GUI
cd desktop/gui
wails build -clean -o E:/developer/results/eqrcp-desktop.exe -platform windows/amd64

# 或者不设置SKIP_WAILS_BUILD，让hook自动构建
unset SKIP_WAILS_BUILD
git commit -m "Release v1.0.0"
```

## 相关文档

- [Git Hooks Setup](./git-hooks-setup.md)
- [Pre-commit Hook Summary](./pre-commit-hook-summary.md)
- [Wails官方文档](https://wails.io/)

## 跨平台构建命令

各平台的 Wails GUI 构建必须在对应宿主上执行（macOS 的 `.app` 不能在
Linux/Windows 上生成，反之亦然）。Bundle id 已统一为
`io.github.forpersuit.eqrcp-desktop`，定义在
`desktop/gui/build/darwin/Info.plist` 与对应 NSIS 模板里。

### Windows（amd64 / arm64）

```bash
cd desktop/gui
wails build -clean -platform windows/amd64
wails build -clean -platform windows/arm64
# 产生 NSIS 安装器
wails build -clean -nsis -platform windows/amd64
```

输出在 `desktop/gui/build/bin/`。

### macOS（需在 macOS 主机上跑）

```bash
cd desktop/gui
# 通用二进制（同时支持 Intel 与 Apple Silicon）
wails build -clean -platform darwin/universal
# 或者分开打两份
wails build -clean -platform darwin/amd64
wails build -clean -platform darwin/arm64
```

产物 `eqrcp-desktop.app/` 在 `desktop/gui/build/bin/`。Wails 会从
`desktop/gui/build/appicon.png` 自动生成 `.icns`。

**Codesign + Notarize**（需要 Apple Developer ID 证书）：

```bash
codesign --deep --force --verbose --sign "Developer ID Application: <Name>" \
  --options runtime \
  desktop/gui/build/bin/eqrcp-desktop.app

# 打包成 dmg（需要 create-dmg）
create-dmg desktop/gui/build/bin/eqrcp-desktop.app

# 公证
xcrun notarytool submit eqrcp-desktop.dmg \
  --apple-id "$APPLE_ID" --team-id "$TEAM_ID" \
  --password "$APP_SPECIFIC_PASSWORD" --wait

xcrun stapler staple eqrcp-desktop.dmg
```

签名/公证留到首个 stable release 之前再做（Track C3）。

### Linux

```bash
cd desktop/gui
# 系统需要 libwebkit2gtk-4.1-dev
wails build -clean -tags webkit2_41
```

产物 `eqrcp-desktop` 二进制在 `desktop/gui/build/bin/`。

**打包**：Linux 没有标准格式，常见三种：

- `.tar.gz` —— 最简单，直接 `tar czf eqrcp-desktop-linux-amd64.tar.gz -C build/bin eqrcp-desktop`。
- `.AppImage` —— 用 `linuxdeploy` + `appimagetool`，参考 Wails 官方示例。
- `.deb` —— 用 `nfpms`（goreleaser 已支持 CLI 的 deb，但 GUI 需要单独配置）。

`scripts/build-artifacts.sh --gui` 会调用对应宿主平台的 Wails 构建，并
把产物拷到 `dist/test-artifacts/{linux,darwin,windows}-{arch}/`。
