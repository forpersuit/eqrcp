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

echo "=== eqt pre-commit: deploy Windows acceptance artifacts ==="
"$root_dir/scripts/deploy-windows-results.sh"
echo "=== eqt pre-commit completed ==="
'@

$PreCommitPath = Join-Path $HooksDir "pre-commit"
Set-Content -Path $PreCommitPath -Value $PreCommitContent -Encoding UTF8

Write-Host "Pre-commit hook installed." -ForegroundColor Green
Write-Host "The hook runs scripts/deploy-windows-results.sh before each commit."
Write-Host "Default acceptance output:"
Write-Host "  Windows/MSYS: E:/developer/results"
Write-Host "  WSL/Linux:   /mnt/e/developer/results"
Write-Host "Override with EQT_RESULTS_DIR when needed."
