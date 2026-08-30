#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$script_dir/.." && pwd)"
hooks_dir="$project_root/.git/hooks"

if [[ ! -d "$hooks_dir" ]]; then
  echo "error: .git/hooks not found. Run from a git checkout." >&2
  exit 1
fi

cat > "$hooks_dir/pre-commit" <<'EOF'
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
EOF

chmod +x "$hooks_dir/pre-commit" 2>/dev/null || true

echo "Pre-commit hook installed successfully."
echo "Default behavior: Fast pure commit (<0.05s, zero side effects, no process kills, no recompile)."
echo "When Windows acceptance deployment is needed:"
echo "  - Run: './scripts/deploy-windows-results.sh' directly"
echo "  - Or: 'EQT_DEPLOY_ON_COMMIT=1 git commit -m \"...\"'"
