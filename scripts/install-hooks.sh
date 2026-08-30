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
EOF

chmod +x "$hooks_dir/pre-commit" 2>/dev/null || true

echo "Pre-commit hook installed."
echo "The hook runs scripts/deploy-windows-results.sh before each commit."
echo "Fast options:"
echo "  - Use 'git commit -n' or 'git commit --no-verify' to bypass hook entirely."
echo "  - Use 'EQT_FAST_COMMIT=1 git commit' or 'export EQT_FAST_COMMIT=1' to skip builds."
echo "  - Commits containing only docs/*.md automatically skip recompile."
