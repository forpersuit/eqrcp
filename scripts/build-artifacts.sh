#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/build-artifacts.sh [--out DIR] [--windows] [--gui] [--no-tests]

Build the executables needed for current eqrcp development and testing.

Default behavior:
- build and test the current-platform CLI
- build Windows CLI artifacts for Explorer and launcher testing

Options:
- --out DIR    Output directory. Default: dist/test-artifacts
- --windows    Build Windows CLI artifacts
- --gui        Also build Wails desktop app artifacts
- --no-tests   Skip go test and frontend build checks
EOF
}

out_dir="dist/test-artifacts"
build_windows=1
build_gui=0
do_checks=1

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
    --windows)
      build_windows=1
      ;;
    --gui)
      build_gui=1
      ;;
    --no-tests)
      do_checks=0
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

build_current_cli() {
  local target_dir="$build_root/current"
  mkdir -p "$target_dir"
  (cd "$root_dir" && GOCACHE="${GOCACHE:-/tmp/eqrcp-go-build}" go build -o "$target_dir/eqrcp" .)
}

build_windows_cli() {
  local target_dir="$build_root/windows-amd64"
  mkdir -p "$target_dir"
  (cd "$root_dir" && env GOCACHE="${GOCACHE:-/tmp/eqrcp-go-build}" GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o "$target_dir/eqrcp.exe" .)
  (cd "$root_dir" && env GOCACHE="${GOCACHE:-/tmp/eqrcp-go-build}" GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags -H=windowsgui -o "$target_dir/eqrcp-launcher.exe" ./cmd/eqrcp-launcher)
}

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

linux_wails_tags() {
  if pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
    printf 'webkit2_41'
  fi
}

build_gui_current() {
  local wails_cmd
  if ! wails_cmd="$(find_wails)"; then
    echo "Skipping current GUI build: wails CLI not found in PATH." >&2
    return 0
  fi
  case "$(uname -s)" in
    Linux*)
      local target_dir="$build_root/current"
      local tags
      mkdir -p "$target_dir"
      tags="$(linux_wails_tags)"
      if [[ -n "$tags" ]]; then
        (cd "$root_dir/desktop/gui" && env GOCACHE="${GOCACHE:-/tmp/eqrcp-go-build}" "$wails_cmd" build -clean -tags "$tags" -o eqrcp-desktop)
      else
        (cd "$root_dir/desktop/gui" && env GOCACHE="${GOCACHE:-/tmp/eqrcp-go-build}" "$wails_cmd" build -clean -o eqrcp-desktop)
      fi
      cp "$root_dir/desktop/gui/build/bin/eqrcp-desktop" "$target_dir/eqrcp-desktop"
      ;;
  esac
}

build_gui_windows() {
  local target_dir="$build_root/windows-amd64"
  local wails_cmd
  if ! wails_cmd="$(find_wails)"; then
    echo "Skipping Windows GUI build: wails CLI not found in PATH." >&2
    return 0
  fi
  (cd "$root_dir/desktop/gui" && env GOCACHE="${GOCACHE:-/tmp/eqrcp-go-build}" "$wails_cmd" build -clean -o eqrcp-desktop.exe -platform windows/amd64 -windowsconsole)
  cp "$root_dir/desktop/gui/build/bin/eqrcp-desktop.exe" "$target_dir/eqrcp-desktop.exe"
}

run_checks() {
  (cd "$root_dir" && env GOCACHE="${GOCACHE:-/tmp/eqrcp-go-build}" go test ./...)
  (cd "$root_dir/desktop/gui/frontend" && npm run build)
  (cd "$root_dir/desktop/gui" && env GOCACHE="${GOCACHE:-/tmp/eqrcp-go-build}" go test ./...)
}

if [[ "$do_checks" -eq 1 ]]; then
  run_checks
fi

build_current_cli

if [[ "$build_windows" -eq 1 ]]; then
  build_windows_cli
fi

if [[ "$build_gui" -eq 1 ]]; then
  build_gui_current
  build_gui_windows
fi

echo "Build artifacts written to: $build_root"
