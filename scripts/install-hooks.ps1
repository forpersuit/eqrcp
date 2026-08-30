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

# 1. Check if fast commit is requested via environment variable
if [[ "${EQT_SKIP_BUILD:-0}" == "1" || "${EQT_FAST_COMMIT:-0}" == "1" || "${EQT_NO_DEPLOY:-0}" == "1" ]]; then
  echo "=== [pre-commit] Fast commit mode enabled. Skipping heavy build and side effects. ==="
  exit 0
fi

# 2. Smart Diff: skip heavy build if only documentation/markdown/metadata files changed
changed_files="$(git diff --cached --name-only 2>/dev/null || true)"
if [[ -n "$changed_files" ]]; then
  non_doc_files="$(echo "$changed_files" | grep -v -E '^docs/|\.md$|^\.gitignore$|^LICENSE$|^\.github/' || true)"
  if [[ -z "$non_doc_files" ]]; then
    echo "=== [pre-commit] Only docs/metadata files modified. Skipping heavy build & side effects. ==="
    exit 0
  fi
fi

echo "=== eqt pre-commit: deploy Windows acceptance artifacts ==="
"$root_dir/scripts/deploy-windows-results.sh"
echo "=== eqt pre-commit completed ==="
'@

$PreCommitPath = Join-Path $HooksDir "pre-commit"
Set-Content -Path $PreCommitPath -Value $PreCommitContent -Encoding UTF8

Write-Host "Pre-commit hook installed." -ForegroundColor Green
Write-Host "The hook runs scripts/deploy-windows-results.sh before each commit."
Write-Host "Fast options:"
Write-Host "  - Use 'git commit -n' or 'git commit --no-verify' to bypass hook entirely."
Write-Host "  - Use 'EQT_FAST_COMMIT=1 git commit' or 'export EQT_FAST_COMMIT=1' to skip builds."
Write-Host "  - Commits containing only docs/*.md automatically skip recompile."
