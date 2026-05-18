# GitHub 工程规范与发布流程指南

## 一、项目现状

- **仓库地址**: `git@github.com:forpersuit/eqrcp.git`
- **已有配置**: `.goreleaser.yml`（GoReleaser 配置，支持 Linux/macOS/Windows 多平台构建）
- **缺失部分**: GitHub Actions CI/CD 工作流、自动化发布流程、标签规范

---

## 二、Git 提交规范（Conventional Commits）

GitHub 社区广泛采用 [Conventional Commits](https://www.conventionalcommits.org/) 规范，格式如下：

```
<类型>(<范围>): <简短描述>

[可选的详细说明]

[可选的 Breaking Change 说明]
```

### 类型（type）

| 类型 | 用途 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat(chat): add floating avatar for long messages` |
| `fix` | 修复 Bug | `fix(bubble): remove whitespace around file cards` |
| `refactor` | 重构（不改功能） | `refactor(css): extract bubble-content from :has() selector` |
| `style` | 样式调整（不影响逻辑） | `style(chat): soften sender color palette` |
| `docs` | 文档变更 | `docs: add GitHub workflow guide` |
| `test` | 测试相关 | `test(server): add chat SSE reconnection tests` |
| `chore` | 构建/工具变更 | `chore: update GoReleaser config for arm64` |
| `perf` | 性能优化 | `perf(render): debounce scroll handler` |

### 范围（scope）— 可选但推荐

本项目可用范围：`chat`, `qr`, `send`, `receive`, `desktop`, `config`, `server`, `pages`, `launcher`

### 完整示例

```
feat(chat): add sticky avatar for long messages

- Avatar stays visible while scrolling within a long message
- Uses CSS position: sticky on .avatar-stack
- z-index ensures avatar stays above bubble content
```

---

## 三、Git 分支策略

### 推荐的分支模型

```
master (主分支，始终可部署)
  ├── feat/xxx  (功能分支)
  ├── fix/xxx   (修复分支)
  └── docs/xxx  (文档分支)
```

### 工作流程

1. 从 `master` 创建功能分支：`git checkout -b feat/floating-avatar`
2. 在功能分支上开发并提交
3. 推送到 GitHub：`git push origin feat/floating-avatar`
4. 在 GitHub 上创建 Pull Request（PR）
5. 代码审查通过后合并到 `master`
6. 删除功能分支

### 当前项目简化模式

项目目前直接在 `master` 上提交，这在早期阶段是可接受的。当有多人协作或需要代码审查时，应切换到 PR 模式。

---

## 四、GitHub Actions CI/CD 自动化

### 4.1 需要创建的文件结构

```
.github/
└── workflows/
    ├── ci.yml          # 持续集成（每次推送/PR 自动测试）
    └── release.yml     # 自动发布（打标签时构建多平台产物）
```

### 4.2 CI 工作流 (`ci.yml`)

**作用**：每次推送代码或创建 PR 时，自动运行测试和构建检查。

```yaml
name: CI

on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        go-version: ['1.25', '1.26']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: ${{ matrix.go-version }}
      - run: go mod download
      - run: go test ./...
      - run: go build -o eqrcp .

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.25'
      - uses: golangci/golangci-lint-action@v6
        with:
          version: latest
```

### 4.3 Release 工作流 (`release.yml`)

**作用**：当推送版本标签（如 `v1.0.0`）时，自动用 GoReleaser 构建多平台可执行文件并发布到 GitHub Releases。

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-go@v5
        with:
          go-version: '1.25'
      - uses: goreleaser/goreleaser-action@v6
        with:
          distribution: goreleaser
          version: latest
          args: release --clean
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 4.4 创建工作流文件

在项目根目录执行：

```bash
mkdir -p .github/workflows
```

然后将上面的 YAML 内容分别写入 `.github/workflows/ci.yml` 和 `.github/workflows/release.yml`。

---

## 五、发布流程（从标签到可下载）

### 5.1 版本号规范（SemVer）

遵循 [语义化版本](https://semver.org/lang/zh-CN/)：`MAJOR.MINOR.PATCH`

- **MAJOR**：不兼容的 API 变更
- **MINOR**：向后兼容的新功能
- **PATCH**：向后兼容的 Bug 修复

示例：`v0.1.0` → `v0.1.1`（修 Bug）→ `v0.2.0`（新功能）→ `v1.0.0`（正式版）

### 5.2 发布步骤

```bash
# 1. 确保所有变更已提交并推送到 master
git add .
git commit -m "feat(chat): improve bubble layout and avatar behavior"
git push origin master

# 2. 创建版本标签
git tag -a v0.2.0 -m "Release v0.2.0: chat mode improvements"

# 3. 推送标签到 GitHub
git push origin v0.2.0

# 4. GitHub Actions 自动触发：
#    - GoReleaser 构建所有平台的二进制文件
#    - 创建 GitHub Release 页面
#    - 上传构建产物（zip/tar.gz）到 Release 页面
#    - 生成 checksums.txt 校验文件

# 5. 用户可以在 GitHub Release 页面下载对应平台的可执行文件：
#    https://github.com/forpersuit/eqrcp/releases
```

### 5.3 预发布（Pre-release）

如果版本还不稳定，可以标记为预发布：

```bash
git tag -a v0.2.0-rc.1 -m "Release candidate v0.2.0-rc.1"
git push origin v0.2.0-rc.1
```

在 GoReleaser 中配置 `prerelease: auto`，带 `-rc`、`-beta` 等后缀的标签会自动标记为预发布。

---

## 六、GoReleaser 配置说明

当前项目已有 `.goreleaser.yml`，它配置了：

| 配置项 | 说明 |
|--------|------|
| `builds[0]` | 主程序 `eqrcp`，支持 Linux/macOS/Windows，架构 386/amd64/arm/arm64 |
| `builds[1]` | Windows 启动器 `eqrcp-launcher`，使用 `-H=windowsgui` 隐藏控制台窗口 |
| `archives` | Windows 平台同时生成 `.zip` 和 `.tar.gz` |
| `checksums` | 生成 `checksums.txt` 用于验证下载完整性 |
| `nfpms` | 生成 Linux `.deb` 和 `.rpm` 安装包 |

### 可选增强

1. **添加 Homebrew Tap**（macOS 用户可用 `brew install`）：
   ```yaml
   brews:
     - repository:
         owner: forpersuit
         name: homebrew-tap
       directory: Formula
   ```

2. **添加 Scoop Manifest**（Windows 用户可用 `scoop install`）：
   ```yaml
   scoop:
     bucket:
       owner: forpersuit
       name: scoop-bucket
   ```

3. **添加 Changelog 自定义**：
   ```yaml
   changelog:
     sort: asc
     filters:
       exclude:
         - '^docs:'
         - '^test:'
         - '^chore:'
     groups:
       - title: '🚀 新功能'
         regexp: "^.*feat[(\\w)]:.*$"
         order: 0
       - title: '🐛 Bug 修复'
         regexp: "^.*fix[(\\w)]:.*$"
         order: 1
       - title: '♻️ 重构'
         regexp: "^.*refactor[(\\w)]:.*$"
         order: 2
       - title: '其他变更'
         order: 999
   ```

---

## 七、Chat/Send/Receive 模式隔离分析

### 7.1 当前架构

项目有 4 个独立页面模板，完全隔离：

| 页面 | Go 变量 | 用途 | 路由 |
|------|---------|------|------|
| QR 页面 | `pages.QR` | 展示二维码，send/receive 模式共用 | `/` |
| Chat 页面 | `pages.Chat` | 聊天模式专用界面 | `/chat` |
| Upload 页面 | `pages.Upload` | 接收模式下文件上传 | `/upload` |
| Done 页面 | `pages.Done` | 传输完成确认 | `/done` |

### 7.2 隔离状态

**CSS 完全隔离** ✅：每个页面是独立的 HTML 文档，有各自的 `<style>` 块，CSS 变量名相同但值不同，互不影响。

- QR 页面使用蓝色主题（`--accent: #2563eb`）
- Chat 页面使用绿色主题（`--accent: #156f5a`）

**JS 完全隔离** ✅：每个页面有独立的 `<script>` 块，没有共享 JS 状态。

**路由隔离** ✅：在 `server/server.go` 中：
- QR 页面由 `qrHandler` 处理
- Chat 页面由 `chatHandler` 处理（`server/chat.go`）
- Upload 页面由 `uploadHandler` 处理
- Done 页面由 `doneHandler` 处理

**结论**：Chat 模式的 CSS/JS/HTML 修改不会影响 send/receive 模式，两者完全隔离。

### 7.3 需要注意的风险点

1. **共享 Go 后端逻辑**：`server/server.go` 中的通用 HTTP 处理如果被修改，可能影响所有模式
2. **共享配置**：`config/` 中的配置项如果变更，会影响所有模式
3. **共享构建产物**：所有模式编译进同一个二进制文件，一个模式的 Bug 可能导致整体崩溃

---

## 八、GitHub 仓库设置建议

### 8.1 仓库设置

1. **Settings → General**：
   - ✅ 勾选 "Always suggest updating pull request branches"
   - ✅ 勾选 "Allow auto-merge"
   - ✅ 设置 "Require status checks to pass before merging"（CI 通过后才能合并）

2. **Settings → Branches**：
   - 添加 `master` 分支保护规则
   - ✅ Require pull request reviews before merging
   - ✅ Require status checks to pass

3. **Settings → Secrets**：
   - `GITHUB_TOKEN` 已自动提供，无需手动设置
   - 如需发布到其他包管理器，需添加对应 Token

### 8.2 Release 页面增强

发布后可以手动编辑 Release 页面，添加：

- 📋 **变更摘要**：基于 Conventional Commits 自动生成的 Changelog
- 📸 **截图**：如果涉及 UI 变更，附上截图
- ⚠️ **破坏性变更说明**：标记不兼容的 API 变更
- 🔗 **关联 Issue**：链接到相关 Issue 编号

---

## 九、快速检查清单

### 每次提交前

- [ ] `gofmt` 格式化修改的 Go 文件
- [ ] `go test ./...` 全部通过
- [ ] `go build -o eqrcp .` 构建成功
- [ ] 提交信息符合 Conventional Commits 规范

### 发布前

- [ ] 更新 `version/version.go` 中的版本号（如需要）
- [ ] 确认所有测试通过
- [ ] 创建版本标签并推送
- [ ] 等待 GitHub Actions 构建完成
- [ ] 在 Release 页面补充说明和截图

### 尚需完成的配置

- [ ] 创建 `.github/workflows/ci.yml`
- [ ] 创建 `.github/workflows/release.yml`
- [ ] 在 GitHub 仓库 Settings 中配置分支保护
- [ ] 更新 `.goreleaser.yml` 中的 homepage URL（当前指向上游 qrcp）
