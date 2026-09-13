#!/bin/bash
set -eo pipefail

# EQT DRM 授权与反破解体系离线全套自动化验证脚本 (DRM Verification SOP)

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
WORKER_DIR="${REPO_ROOT}/cloudflare/eqt-drm-api"

echo "=================================================="
echo " [1/2] 运行 Cloudflare Worker 端 DRM/Admin 核心套件"
echo "=================================================="
if [ -d "${WORKER_DIR}" ]; then
  cd "${WORKER_DIR}"
  npm run test:offline
else
  echo "Error: Worker directory not found at ${WORKER_DIR}"
  exit 1
fi

echo ""
echo "=================================================="
echo " [2/2] 运行 Go 端设备指纹与离线证书核心测试"
echo "=================================================="
cd "${REPO_ROOT}"
go test -count=1 -v ./pkg/server -run "Test.*License.*|Test.*Fingerprint.*"

echo ""
echo "=================================================="
echo " 🎉 全套 DRM 授权与离线防伪验证全部通过！"
echo "=================================================="
