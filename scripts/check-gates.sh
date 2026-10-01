#!/usr/bin/env bash
# EQT G-Layer Pre-commit Gate Checker
# Enforces Hard Invariants on staged changes (The Diff Ratchet).
# Execution budget: < 2 seconds.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd "$script_dir/.." && pwd)"

# Check if there are staged changes
if git -C "$root_dir" diff --cached --quiet; then
  exit 0
fi

echo "=== [EQT G-Gate] Checking staged changes against Hard Invariants ==="

# 1. Check for suppressions & swallowed errors (Anti-Cheating Gate)
# Only inspect added lines in code files (.go, .js, .ts, .svelte, .py)
staged_added_lines=$(git -C "$root_dir" diff --cached -U0 -- '*.go' '*.js' '*.ts' '*.svelte' '*.py' | grep -E '^\+[^+]' || true)

if [[ -n "$staged_added_lines" ]]; then
  # 1.1 Suppressions: //nolint, @ts-ignore, # type: ignore, as any
  if echo "$staged_added_lines" | grep -qE '//nolint|@ts-ignore|# type:\s*ignore|\bas any\b'; then
    echo "❌ [Gate Error] Detected suppression annotations in staged changes (//nolint, @ts-ignore, type: ignore, as any)." >&2
    echo "   Rule [HI-3]: Fix the underlying type/lint issue. Do not suppress without human waiver." >&2
    exit 1
  fi

  # 1.2 Swallowed errors: _ = err (Go), empty catch (JS/TS)
  if echo "$staged_added_lines" | grep -qE '_\s*=\s*err\b|catch\s*\([^)]*\)\s*\{\s*\}'; then
    echo "❌ [Gate Error] Detected swallowed error in staged changes (_ = err or empty catch {})." >&2
    echo "   Rule [HI-3 / Fail Loud]: Errors must be propagated, wrapped, or explicitly logged. Never silently swallow." >&2
    exit 1
  fi
fi

# 2. Check for inline onclick in frontend and template files (exclude markdown)
frontend_staged_diff=$(git -C "$root_dir" diff --cached -U0 -- 'desktop/gui/frontend/*' 'pkg/pages/*' ':!*.md' || true)
if [[ -n "$frontend_staged_diff" ]]; then
  if echo "$frontend_staged_diff" | grep -E '^\+[^+]' | grep -qiE 'onclick\s*='; then
    echo "❌ [Gate Error] Detected inline 'onclick=' in frontend templates or components." >&2
    echo "   Rule [P-FE-3]: Never construct inline onclick HTML. Use standard addEventListener." >&2
    exit 1
  fi
fi

echo "✅ [EQT G-Gate] Staged changes passed all hard invariant checks."
exit 0
