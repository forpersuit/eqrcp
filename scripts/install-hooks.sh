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
"$root_dir/scripts/deploy-windows-results.sh"
echo "=== eqt pre-commit completed ==="
EOF

chmod +x "$hooks_dir/pre-commit" 2>/dev/null || true

echo "Pre-commit hook installed."
echo "The hook runs scripts/deploy-windows-results.sh before each commit."
echo "Default acceptance output:"
echo "  Windows/MSYS: E:/developer/results"
echo "  WSL/Linux:   /mnt/e/developer/results"
echo "Override with EQT_RESULTS_DIR when needed."
