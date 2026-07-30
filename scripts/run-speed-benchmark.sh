#!/usr/bin/env bash

set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== EQT Transfer Speed Benchmark (Standalone Script) ==="
go run "$root_dir/scripts/benchmark-speed/main.go" "$@"
