#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/build-windows-gui.sh [--out DIR]

Build Windows executables for manual GUI testing.

Output:
- eqt.exe
- eqt-launcher.exe
- eqt-desktop.exe

Options:
- --out DIR    Output directory. Default: dist/manual/windows-gui
EOF
}

out_dir="dist/manual/windows-gui"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)
      shift
      out_dir="${1:-}"
      if [[ -z "$out_dir" ]]; then
        echo "error: --out requires a directory" >&2
        exit 2
      fi
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
if [[ "$out_dir" = /* ]]; then
  build_root="$out_dir"
else
  build_root="$root_dir/$out_dir"
fi
mkdir -p "$build_root"

find_wails() {
  local wails_cmd
  if wails_cmd="$(command -v wails 2>/dev/null)"; then
    :
  else
    wails_cmd="$(go env GOPATH)/bin/wails"
  fi
  if [[ ! -x "$wails_cmd" ]]; then
    return 1
  fi
  printf '%s\n' "$wails_cmd"
}

env_cache="${GOCACHE:-/tmp/eqt-go-build}"

echo "Building Windows CLI executables..."
(cd "$root_dir" && env GOCACHE="$env_cache" GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o "$build_root/eqt.exe" ./cmd/eqt)
(cd "$root_dir" && env GOCACHE="$env_cache" GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags -H=windowsgui -o "$build_root/eqt-launcher.exe" ./cmd/eqt-launcher)

wails_cmd="$(find_wails)"
if [[ -z "$wails_cmd" ]]; then
  echo "error: wails CLI not found in PATH or GOPATH/bin" >&2
  exit 1
fi

echo "Building Windows GUI executable..."
(cd "$root_dir/desktop/gui" && env GOCACHE="$env_cache" "$wails_cmd" build -clean -ldflags "-H=windowsgui" -o eqt-desktop.exe -platform windows/amd64)
cp "$root_dir/desktop/gui/build/bin/eqt-desktop.exe" "$build_root/eqt-desktop.exe"

echo "Windows GUI artifacts written to: $build_root"
