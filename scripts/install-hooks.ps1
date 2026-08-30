# Install git hooks for eqt development.
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$HooksDir = Join-Path $ProjectRoot ".git\hooks"

if (-not (Test-Path $HooksDir)) {
    throw ".git\hooks not found. Run from a git checkout."
}

$PreCommitContent = @'
#!/usr/bin/env bash

set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# 1. 只有显式声明 EQT_DEPLOY_ON_COMMIT=1 时，才执行全量 Windows 编译、测试、杀进程与验收目录部署
if [[ "${EQT_DEPLOY_ON_COMMIT:-0}" == "1" || "${EQT_BUILD_ON_COMMIT:-0}" == "1" ]]; then
  echo "=== eqt pre-commit: deploy Windows acceptance artifacts (explicitly enabled) ==="
  "$root_dir/scripts/deploy-windows-results.sh"
  echo "=== eqt pre-commit completed ==="
  exit 0
fi

# 2. 默认模式：纯提交，绝对零副作用（不杀进程、不编译 Windows/Wails、不生成交付件）
# 仅对暂存的 Go 代码执行轻量 gofmt 格式化，耗时 < 0.05s
staged_go_files="$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null | grep '\.go$' || true)"
if [[ -n "$staged_go_files" ]]; then
  echo "$staged_go_files" | xargs gofmt -w 2>/dev/null || true
  echo "$staged_go_files" | xargs git add 2>/dev/null || true
fi

exit 0
'@

$PreCommitPath = Join-Path $HooksDir "pre-commit"
Set-Content -Path $PreCommitPath -Value $PreCommitContent -Encoding UTF8

Write-Host "Pre-commit hook installed successfully." -ForegroundColor Green
Write-Host "Default behavior: Fast pure commit (<0.05s, zero side effects, no process kills, no recompile)."
Write-Host "When Windows acceptance deployment is needed:"
Write-Host "  - Run: '.\scripts\deploy-windows-results.sh' directly"
Write-Host "  - Or: 'EQT_DEPLOY_ON_COMMIT=1 git commit -m \"...\"'"
