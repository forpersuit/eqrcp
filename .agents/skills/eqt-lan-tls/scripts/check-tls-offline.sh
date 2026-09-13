#!/bin/bash
set -eo pipefail

# EQT LAN-TLS 架构离线全套自动化验证脚本 (Verification & Quality Gate SOP)
# 该脚本在完全离线环境下执行全量单元测试、反向探针与静态类型检查

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
WORKER_DIR="${REPO_ROOT}/cloudflare/eqt-drm-api"

echo "=================================================="
echo " [1/2] 运行 Cloudflare Worker 端离线全套测试套件"
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
echo " [2/2] 运行 Go 端 pkg/cert 核心置备与密钥测试"
echo "=================================================="
cd "${REPO_ROOT}"
go test -count=1 -v ./pkg/cert/...

echo ""
echo "=================================================="
echo " 🎉 全套 LAN-TLS 离线质量门禁验证全部通过！"
echo "=================================================="
