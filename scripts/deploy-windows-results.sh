#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/deploy-windows-results.sh [--no-tests] [--skip-gui]

Close running eqt desktop processes, build fresh Windows artifacts, and copy
them to the manual acceptance directory.

Environment:
- EQT_RESULTS_DIR overrides the output directory.
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
  if [[ -n "${EQT_RESULTS_DIR:-}" ]]; then
    printf '%s\n' "$EQT_RESULTS_DIR"
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

close_eqt_processes() {
  if [[ -f "/mnt/c/Windows/System32/taskkill.exe" ]]; then
    /mnt/c/Windows/System32/taskkill.exe /F /IM "eqt*" >/dev/null 2>&1 || true
  elif command -v taskkill.exe >/dev/null 2>&1; then
    taskkill.exe /F /IM "eqt*" >/dev/null 2>&1 || true
  elif command -v taskkill >/dev/null 2>&1; then
    taskkill /F /IM "eqt*" >/dev/null 2>&1 || true
  fi

  pkill -f 'eqt(\.exe)?$' >/dev/null 2>&1 || true
  pkill -f 'eqt-launcher(\.exe)?$' >/dev/null 2>&1 || true
  pkill -f 'eqt-desktop(\.exe)?$' >/dev/null 2>&1 || true
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

echo "Closing running eqt desktop processes..."
close_eqt_processes

if [[ "$run_checks" -eq 1 ]]; then
  echo "Running go fmt..."
  (cd "$root_dir" && go fmt ./...)

  if command -v golangci-lint >/dev/null 2>&1; then
    echo "Running golangci-lint..."
    (cd "$root_dir" && golangci-lint run --timeout=2m) || echo "Warning: golangci-lint found some code issues. (Please review above warnings)"
  else
    echo "golangci-lint not found on this machine, skipping code lint check. (Recommended: install golangci-lint to intercept errors early)"
  fi

  echo "Running go vet on root module..."
  (cd "$root_dir" && go vet ./...)

  echo "Running Go tests..."
  (cd "$root_dir" && env GOCACHE="${GOCACHE:-/tmp/eqt-go-build}" go test -timeout 180s ./...)
  # Sync wails.json version with pkg/version/version.go
  raw_ver="$(grep -o 'version = "[^"]*"' "$root_dir/pkg/version/version.go" | cut -d'"' -f2 | sed 's/^v//')"
  if [[ -n "$raw_ver" && -f "$root_dir/desktop/gui/wails.json" ]]; then
    node -e "
      const fs = require('fs');
      const p = '$root_dir/desktop/gui/wails.json';
      const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
      cfg.info = cfg.info || {};
      cfg.info.productVersion = '$raw_ver';
      cfg.info.companyName = 'EQT';
      cfg.info.copyright = 'Copyright © 2026 EQT';
      cfg.author = cfg.author || {};
      cfg.author.name = 'EQT';
      fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
    " || true
  fi

  if wails_cmd="$(find_wails)"; then
    echo "Generating Wails bindings..."
    rm -f /tmp/wailsbindings || true
    (cd "$root_dir/desktop/gui" && "$wails_cmd" build -platform windows/amd64 -s)
    rm -f /tmp/wailsbindings || true
  fi
  echo "Building GUI frontend..."
  (cd "$root_dir/desktop/gui/frontend" && npm run build)
  echo "Building Chat v2 frontend..."
  (cd "$root_dir/pkg/chat/v2/web" && npm run build)

  echo "Running go vet on desktop module..."
  (cd "$root_dir/desktop/gui" && go vet ./...)

  echo "Running GUI Go tests..."
  (cd "$root_dir/desktop/gui" && env GOCACHE="${GOCACHE:-/tmp/eqt-go-build}" go test -timeout 180s ./...)
fi

echo "Building Windows CLI artifacts..."
(cd "$root_dir" && env GOCACHE="${GOCACHE:-/tmp/eqt-go-build}" GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o "$results_dir/eqt.exe" ./cmd/eqt)

if [[ "$build_gui" -eq 1 ]]; then
  if wails_cmd="$(find_wails)"; then
    echo "Building Windows Wails GUI (consolidated)..."
    rm -f /tmp/wailsbindings "$root_dir/desktop/gui/eqt-desktop-res.syso" || true
    (cd "$root_dir/desktop/gui" && env GOCACHE="${GOCACHE:-/tmp/eqt-go-build}" "$wails_cmd" build -clean -ldflags "-H=windowsgui" -o eqt-desktop.exe -platform windows/amd64)
    rm -f /tmp/wailsbindings "$root_dir/desktop/gui/eqt-desktop-res.syso" || true
    # The Wails GUI binary is the consolidated 3-in-1 tool. Overwrite eqt.exe.
    cp "$root_dir/desktop/gui/build/bin/eqt-desktop.exe" "$results_dir/eqt.exe"
  fi
fi

# Package Windows installer/executable into zip archive for official website distribution
echo "Packaging Windows distribution zip..."
python3 -c "
import zipfile, os
results_dir = '$results_dir'
exe_path = os.path.join(results_dir, 'eqt.exe')
if os.path.exists(exe_path):
    zip_path = os.path.join(results_dir, 'eqt-desktop-windows-amd64.zip')
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.write(exe_path, 'EQT.exe')
    print(f'Packaged {zip_path} successfully (containing EQT.exe)')
" || true

# Close any lingering test agent processes that may have spawned during tests
echo "Ensuring all lingering processes are closed..."
close_eqt_processes

echo "Acceptance artifacts written to: $results_dir"
