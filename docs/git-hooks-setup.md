# Git Hooks Setup

## 为什么Git Hook比较复杂？

### Git不跟踪.git目录

Git有一个重要的设计原则：**Git不会跟踪 `.git/` 目录的内容**。

原因：
- `.git/` 目录存储Git的元数据和配置
- Git不会把自己的配置文件纳入版本控制
- 这就是为什么 `git add .git/hooks/pre-commit` 不起作用

### 标准做法

业界标准做法是：
1. 把hook脚本放在项目根目录或 `scripts/` 目录（可以被Git跟踪）
2. 提供安装脚本，让开发者手动安装到 `.git/hooks/`
3. 在README中说明如何安装

## 安装Pre-commit Hook

### Windows (PowerShell)

```powershell
.\scripts\install-hooks.ps1
```

### Linux/Mac (Bash)

```bash
bash scripts/install-hooks.sh
```

## Hook功能

Pre-commit hook会在每次提交前自动：

1. **关闭所有eqt进程**
   - eqt.exe
   - eqt-launcher.exe
   - eqt-desktop.exe

2. **运行测试**
   - Go tests: `go test ./...`
   - GUI frontend build: `npm run build`
   - GUI Go tests: `go test ./...` (in desktop/gui)

3. **重新构建项目**
   - 构建当前平台CLI
   - 构建Windows CLI (eqt.exe, eqt-launcher.exe)
   - 构建Wails GUI (如果wails可用)

4. **保存到指定目录**
   - 所有exe保存到 `E:\developer\results`

## 卸载Hook

```bash
# Windows
Remove-Item .git\hooks\pre-commit

# Linux/Mac
rm .git/hooks/pre-commit
```

## 跳过Hook

如果需要跳过hook直接提交：

```bash
git commit --no-verify -m "commit message"
```

## 其他常见的Git Hook

- `pre-push` - 推送前执行
- `post-commit` - 提交后执行
- `pre-rebase` - rebase前执行
- `post-merge` - merge后执行

## 参考资料

- [Git Hooks官方文档](https://git-scm.com/book/en/v2/Customizing-Git-Git-Hooks)
- [Husky](https://github.com/typicode/husky) - Node.js项目的hook管理工具
