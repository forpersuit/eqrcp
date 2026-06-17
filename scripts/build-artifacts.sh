#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/build-artifacts.sh [--out DIR] [--windows] [--gui] [--no-tests]
                                  [--cli-linux] [--cli-macos] [--cli-all]

Build the executables needed for current eqt development and testing.

Default behavior:
- build and test the current-platform CLI
- build Windows CLI artifacts for Explorer and launcher testing

Options:
- --out DIR    Output directory. Default: dist/test-artifacts
- --windows    Build Windows CLI artifacts (default on)
- --cli-linux  Cross-compile linux amd64 + arm64 CLI
- --cli-macos  Cross-compile darwin amd64 + arm64 CLI
- --cli-all    Shortcut for --windows --cli-linux --cli-macos
- --gui        Also build Wails desktop app artifacts (host platform + windows)
- --no-tests   Skip go test and frontend build checks
EOF
}

out_dir="dist/test-artifacts"
build_windows=1
build_cli_linux=0
build_cli_macos=0
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
    --cli-linux)
      build_cli_linux=1
      ;;
    --cli-macos)
      build_cli_macos=1
      ;;
    --cli-all)
      build_windows=1
      build_cli_linux=1
      build_cli_macos=1
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
  (cd "$root_dir" && GOCACHE="${GOCACHE:-/tmp/eqt-go-build}" go build -o "$target_dir/eqt" .)
}

build_windows_cli() {
  local target_dir="$build_root/windows-amd64"
  mkdir -p "$target_dir"
  (cd "$root_dir" && env GOCACHE="${GOCACHE:-/tmp/eqt-go-build}" GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o "$target_dir/eqt.exe" .)
  (cd "$root_dir" && env GOCACHE="${GOCACHE:-/tmp/eqt-go-build}" GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags -H=windowsgui -o "$target_dir/eqt-launcher.exe" ./cmd/eqt-launcher)
}

build_linux_cli() {
  for arch in amd64 arm64; do
    local target_dir="$build_root/linux-$arch"
    mkdir -p "$target_dir"
    (cd "$root_dir" && env GOCACHE="${GOCACHE:-/tmp/eqt-go-build}" GOOS=linux GOARCH="$arch" CGO_ENABLED=0 go build -o "$target_dir/eqt" .)
  done
}

build_macos_cli() {
  for arch in amd64 arm64; do
    local target_dir="$build_root/darwin-$arch"
    mkdir -p "$target_dir"
    (cd "$root_dir" && env GOCACHE="${GOCACHE:-/tmp/eqt-go-build}" GOOS=darwin GOARCH="$arch" CGO_ENABLED=0 go build -o "$target_dir/eqt" .)
  done
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
      local target_dir="$build_root/linux-amd64"
      local tags
      mkdir -p "$target_dir"
      tags="$(linux_wails_tags)"
      if [[ -n "$tags" ]]; then
        (cd "$root_dir/desktop/gui" && env GOCACHE="${GOCACHE:-/tmp/eqt-go-build}" "$wails_cmd" build -clean -tags "$tags" -o eqt-desktop)
      else
        (cd "$root_dir/desktop/gui" && env GOCACHE="${GOCACHE:-/tmp/eqt-go-build}" "$wails_cmd" build -clean -o eqt-desktop)
      fi
      cp "$root_dir/desktop/gui/build/bin/eqt-desktop" "$target_dir/eqt-desktop"
      ;;
    Darwin*)
      local arch_suffix
      case "$(uname -m)" in
        arm64) arch_suffix="arm64" ;;
        x86_64) arch_suffix="amd64" ;;
        *) arch_suffix="$(uname -m)" ;;
      esac
      local target_dir="$build_root/darwin-$arch_suffix"
      mkdir -p "$target_dir"
      (cd "$root_dir/desktop/gui" && env GOCACHE="${GOCACHE:-/tmp/eqt-go-build}" "$wails_cmd" build -clean -o eqt-desktop)
      if [[ -d "$root_dir/desktop/gui/build/bin/eqt-desktop.app" ]]; then
        cp -R "$root_dir/desktop/gui/build/bin/eqt-desktop.app" "$target_dir/"
      else
        cp "$root_dir/desktop/gui/build/bin/eqt-desktop" "$target_dir/eqt-desktop"
      fi
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
  (cd "$root_dir/desktop/gui" && env GOCACHE="${GOCACHE:-/tmp/eqt-go-build}" "$wails_cmd" build -clean -ldflags "-H=windowsgui" -o eqt-desktop.exe -platform windows/amd64)
  cp "$root_dir/desktop/gui/build/bin/eqt-desktop.exe" "$target_dir/eqt-desktop.exe"
}

run_checks() {
  (cd "$root_dir" && env GOCACHE="${GOCACHE:-/tmp/eqt-go-build}" go test ./...)
  (cd "$root_dir/desktop/gui/frontend" && npm run build)
  (cd "$root_dir/desktop/gui" && env GOCACHE="${GOCACHE:-/tmp/eqt-go-build}" go test ./...)
}

if [[ "$do_checks" -eq 1 ]]; then
  run_checks
fi

build_current_cli

if [[ "$build_windows" -eq 1 ]]; then
  build_windows_cli
fi

if [[ "$build_cli_linux" -eq 1 ]]; then
  build_linux_cli
fi

if [[ "$build_cli_macos" -eq 1 ]]; then
  build_macos_cli
fi

if [[ "$build_gui" -eq 1 ]]; then
  build_gui_current
  build_gui_windows
fi

echo "Build artifacts written to: $build_root"
