#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/deploy-windows-results.sh [--no-tests] [--skip-gui]

Close running eqrcp desktop processes, build fresh Windows artifacts, and copy
them to the manual acceptance directory.

Environment:
- EQRCP_RESULTS_DIR overrides the output directory.
- Default output directory is E:\developer\results on Windows, or
  /mnt/e/developer/results when running under WSL/Linux with the E drive mounted.
EOF
}

run_checks=1
build_gui=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-tests)
      run_checks=0
      ;;
    --skip-gui)
      build_gui=0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

resolve_results_dir() {
  if [[ -n "${EQRCP_RESULTS_DIR:-}" ]]; then
    printf '%s\n' "$EQRCP_RESULTS_DIR"
    return
  fi
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      printf 'E:/developer/results\n'
      ;;
    *)
      printf '/mnt/e/developer/results\n'
      ;;
  esac
}

close_eqrcp_processes() {
  if [[ -f "/mnt/c/Windows/System32/taskkill.exe" ]]; then
    /mnt/c/Windows/System32/taskkill.exe /F /IM "eqrcp*" >/dev/null 2>&1 || true
  elif command -v taskkill.exe >/dev/null 2>&1; then
    taskkill.exe /F /IM "eqrcp*" >/dev/null 2>&1 || true
  elif command -v taskkill >/dev/null 2>&1; then
    taskkill /F /IM "eqrcp*" >/dev/null 2>&1 || true
  fi

  pkill -f 'eqrcp(\.exe)?$' >/dev/null 2>&1 || true
  pkill -f 'eqrcp-launcher(\.exe)?$' >/dev/null 2>&1 || true
  pkill -f 'eqrcp-desktop(\.exe)?$' >/dev/null 2>&1 || true
}

find_wails() {
  local wails_cmd
  if wails_cmd="$(command -v wails 2>/dev/null)"; then
    printf '%s\n' "$wails_cmd"
    return 0
  fi
  wails_cmd="$(go env GOPATH)/bin/wails"
  if [[ -x "$wails_cmd" ]]; then
    printf '%s\n' "$wails_cmd"
    return 0
  fi
  return 1
}

results_dir="$(resolve_results_dir)"
mkdir -p "$results_dir"

echo "Closing running eqrcp desktop processes..."
close_eqrcp_processes

if [[ "$run_checks" -eq 1 ]]; then
  echo "Running Go tests..."
  (cd "$root_dir" && env GOCACHE="${GOCACHE:-/tmp/eqrcp-go-build}" go test ./...)
  echo "Building GUI frontend..."
  (cd "$root_dir/desktop/gui/frontend" && npm run build)
  echo "Running GUI Go tests..."
  (cd "$root_dir/desktop/gui" && env GOCACHE="${GOCACHE:-/tmp/eqrcp-go-build}" go test ./...)
fi

echo "Building Windows CLI artifacts..."
(cd "$root_dir" && env GOCACHE="${GOCACHE:-/tmp/eqrcp-go-build}" GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o "$results_dir/eqrcp.exe" .)
(cd "$root_dir" && env GOCACHE="${GOCACHE:-/tmp/eqrcp-go-build}" GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags -H=windowsgui -o "$results_dir/eqrcp-launcher.exe" ./cmd/eqrcp-launcher)

if [[ "$build_gui" -eq 1 ]]; then
  if wails_cmd="$(find_wails)"; then
    echo "Building Windows Wails GUI..."
    (cd "$root_dir/desktop/gui" && env GOCACHE="${GOCACHE:-/tmp/eqrcp-go-build}" "$wails_cmd" build -clean -ldflags "-H=windowsgui" -o eqrcp-desktop.exe -platform windows/amd64)
    cp "$root_dir/desktop/gui/build/bin/eqrcp-desktop.exe" "$results_dir/eqrcp-desktop.exe"
  fi
fi

# Close any lingering test agent processes that may have spawned during tests
echo "Ensuring all lingering processes are closed..."
close_eqrcp_processes

echo "Acceptance artifacts written to: $results_dir"
