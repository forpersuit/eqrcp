# Pre-commit Hook 完整总结

## 问题背景

用户需要在提交前自动：
1. 关闭正在运行的eqrcp相关exe
2. 运行测试（包括GUI相关测试）
3. 重新构建exe并保存到 `E:\developer\results`

## 为什么Git Hook比较复杂？

### 核心原因：Git不跟踪.git目录

**设计原则**：
- `.git/` 目录存储Git的元数据和配置
- Git不会把自己的配置文件纳入版本控制
- `git add .git/hooks/pre-commit` 不起作用

### 业界标准做法

1. 把hook脚本放在项目根目录或 `scripts/` 目录（可以被Git跟踪）
2. 提供安装脚本，让开发者手动安装到 `.git/hooks/`
3. 在文档中说明如何安装

## 实现方案

### 文件结构

```
scripts/
├── install-hooks.sh      # Bash安装脚本（Linux/Mac）
└── install-hooks.ps1     # PowerShell安装脚本（Windows）

docs/
├── git-hooks-setup.md    # Hook安装和使用文档
└── pre-commit-hook-summary.md  # 本文档

.git/hooks/
└── pre-commit            # 实际的hook脚本（不被Git跟踪）
```

### 安装方法

**Windows (PowerShell)**:
```powershell
.\scripts\install-hooks.ps1
```

**Linux/Mac (Bash)**:
```bash
bash scripts/install-hooks.sh
```

## Hook执行流程

```
git commit
    ↓
pre-commit hook触发
    ↓
Step 1: 关闭eqrcp进程
    ├── eqrcp.exe
    ├── eqrcp-launcher.exe
    └── eqrcp-desktop.exe
    ↓
Step 2: 运行测试
    ├── Go tests: go test ./...
    ├── GUI frontend build: npm run build
    └── GUI Go tests: go test ./... (in desktop/gui)
    ↓
Step 3: 重新构建项目
    ├── 当前平台CLI
    ├── Windows CLI (eqrcp.exe, eqrcp-launcher.exe)
    └── Wails GUI (eqrcp-desktop.exe)
    ↓
保存到 E:\developer\results
    ↓
继续commit
```

## Hook功能详解

### 1. 关闭进程

**Windows**:
```powershell
Get-Process -Name eqrcp -ErrorAction SilentlyContinue | Stop-Process -Force
```

**Linux/Mac**:
```bash
pkill -f "eqrcp$"
```

### 2. 运行测试

**Go测试**:
```bash
go test ./...
```

**GUI前端构建**:
```bash
cd desktop/gui/frontend
npm run build
```

**GUI Go测试**:
```bash
cd desktop/gui
go test ./...
```

### 3. 构建项目

**当前平台CLI**:
```bash
go build -o E:/developer/results/eqrcp .
```

**Windows CLI**:
```bash
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o E:/developer/results/eqrcp.exe .
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags -H=windowsgui -o E:/developer/results/eqrcp-launcher.exe ./cmd/eqrcp-launcher
```

**Wails GUI**:
```bash
cd desktop/gui
wails build -clean -o E:/developer/results/eqrcp-desktop.exe -platform windows/amd64
```

## 使用技巧

### 跳过Hook

如果需要跳过hook直接提交：
```bash
git commit --no-verify -m "commit message"
```

### 卸载Hook

```bash
# Windows
Remove-Item .git\hooks\pre-commit

# Linux/Mac
rm .git/hooks/pre-commit
```

### 重新安装Hook

如果hook脚本更新了，重新运行安装脚本即可：
```powershell
.\scripts\install-hooks.ps1
```

## 优势

✅ **可追踪**：安装脚本在Git版本控制中  
✅ **标准化**：符合业界最佳实践  
✅ **跨平台**：支持Windows和Linux/Mac  
✅ **文档化**：有完整的使用说明  
✅ **灵活性**：可以选择安装或跳过  
✅ **自动化**：提交前自动测试和构建  
✅ **质量保证**：确保提交的代码通过测试

## 注意事项

1. **首次使用**：需要手动运行安装脚本
2. **测试失败**：如果测试失败，commit会被阻止
3. **构建失败**：如果构建失败，commit会被阻止
4. **跳过hook**：使用 `--no-verify` 可以跳过hook
5. **更新hook**：hook脚本更新后需要重新安装

## 相关文档

- [Git Hooks Setup](./git-hooks-setup.md) - Hook安装和使用指南
- [AGENTS.md](../AGENTS.md) - 项目开发规范
- [Git Hooks官方文档](https://git-scm.com/book/en/v2/Customizing-Git-Git-Hooks)

## 提交历史

- `b0004a2` - Add tests and GUI frontend build to pre-commit hook
- `d3c48f7` - Add git hooks installation scripts and documentation
- `721e876` - Add pre-commit hook to close eqrcp processes and rebuild

## 总结

通过标准的Git Hook安装脚本方案，我们实现了：
1. ✅ 自动关闭eqrcp进程
2. ✅ 自动运行Go测试
3. ✅ 自动构建GUI前端
4. ✅ 自动运行GUI测试
5. ✅ 自动重新构建exe
6. ✅ 自动保存到指定目录

这个方案符合First Principle，使用业界标准做法，确保代码质量和构建一致性！
