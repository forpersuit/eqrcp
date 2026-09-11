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

echo "=== eqt pre-commit: deploy Windows acceptance artifacts ==="
EQT_PRE_COMMIT_CONTEXT=1 "$root_dir/scripts/deploy-windows-results.sh"

# Pre-commit boundary: if version sync modified wails.json, stage it alongside version.go
if [[ -f "$root_dir/desktop/gui/wails.json" ]] && ! git -C "$root_dir" diff --quiet "$root_dir/desktop/gui/wails.json" 2>/dev/null; then
  git -C "$root_dir" add "$root_dir/desktop/gui/wails.json"
fi

echo "=== eqt pre-commit completed ==="
EOF

chmod +x "$hooks_dir/pre-commit" 2>/dev/null || true

echo "Pre-commit hook installed."
echo "The hook runs scripts/deploy-windows-results.sh before each commit."
echo "Default acceptance output:"
echo "  Windows/MSYS: E:/developer/results"
echo "  WSL/Linux:   /mnt/e/developer/results"
echo "Override with EQT_RESULTS_DIR when needed."
