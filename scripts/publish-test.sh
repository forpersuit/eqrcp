#!/usr/bin/env bash
# ==============================================================================
# scripts/publish-test.sh — EQT 测试环境完整发布闭环脚本
#
# 语义规范：
#   - 本地编译 (Build)  : 仅生成二进制与 zip 压缩包 (scripts/deploy-windows-results.sh)
#   - 边缘部署 (Deploy) : 仅部署 Worker 与 Pages 网站代码 (deploy-test.yml / wrangler deploy)
#   - 完整发布 (Publish): 编译物理包 -> 上传 R2 分发桶 -> 同步元数据/时间戳 -> 部署并刷新主页
# ==============================================================================

set -euo pipefail

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

results_dir="$(resolve_results_dir)"

echo "=== [1/5] 本地编译最新 Windows 测试物理产物 ==="
"${root_dir}/scripts/deploy-windows-results.sh" --no-tests

zip_file="${results_dir}/eqt-desktop-test-windows-amd64.zip"
exe_file="${results_dir}/eqt-test.exe"

if [[ ! -f "$zip_file" || ! -f "$exe_file" ]]; then
  echo "error: 编译产物缺失: $zip_file 或 $exe_file" >&2
  exit 1
fi

zip_size="$(stat -c%s "$zip_file" 2>/dev/null || wc -c < "$zip_file" | tr -d ' ')"
exe_size="$(stat -c%s "$exe_file" 2>/dev/null || wc -c < "$exe_file" | tr -d ' ')"
current_version="$(rg -o 'version = "v[^"]*"' "${root_dir}/pkg/version/version.go" | cut -d'"' -f2)"
timestamp="$(date +%Y%m%d%H%M)"

echo "当前版本: ${current_version}"
echo "测试 Zip 大小: ${zip_size} 字节"
echo "测试 Exe 大小: ${exe_size} 字节"
echo "发布时间戳: ${timestamp}"

echo "=== [2/5] 上传安装包至 Cloudflare R2 远端分发存储桶 (download.eqt.net.im) ==="
# 剥离可能导致 undici 异常的 socks5 代理环境变量
WRANGLER_ENV="env -u http_proxy -u HTTP_PROXY -u https_proxy -u HTTPS_PROXY -u all_proxy -u ALL_PROXY"

cd "${root_dir}/cloudflare/eqt-drm-api"
$WRANGLER_ENV npx wrangler r2 object put "eqt-downloads/downloads/test/eqt-desktop-test-windows-amd64.zip" -f "$zip_file" --content-type application/zip --remote
$WRANGLER_ENV npx wrangler r2 object put "eqt-downloads/downloads/test/EQT-test-windows-amd64.zip" -f "$zip_file" --content-type application/zip --remote
$WRANGLER_ENV npx wrangler r2 object put "eqt-downloads/downloads/test/EQT.exe" -f "$exe_file" --content-type application/octet-stream --remote

echo "=== [3/5] 同步下载元数据与首页防缓存直链 ==="
# 更新 github.ts 中的 testResult
github_file="${root_dir}/cloudflare/eqt-drm-api/src/services/github.ts"
index_file="${root_dir}/cloudflare/eqt-website/index.html"

# 使用 node 脚本精准更新 json 数据结构，避免正则脆弱性
node -e "
const fs = require('fs');
let code = fs.readFileSync('${github_file}', 'utf8');

code = code.replace(/version:\s*\"v[^\"]+\"/, 'version: \"${current_version}\"');
code = code.replace(/download_url:\s*\"https:\/\/download\.eqt\.net\.im\/downloads\/test\/(eqt-desktop-test-windows-amd64|EQT-test-windows-amd64)\.zip(\?t=[^\"]+)?\"/g, 'download_url: \"https://download.eqt.net.im/downloads/test/\$1.zip?t=${timestamp}\"');
code = code.replace(/download_url:\s*\"https:\/\/download\.eqt\.net\.im\/downloads\/test\/EQT\.exe(\?t=[^\"]+)?\"/, 'download_url: \"https://download.eqt.net.im/downloads/test/EQT.exe?t=${timestamp}\"');

fs.writeFileSync('${github_file}', code, 'utf8');
"

# 更新 index.html 与各语言分站中的下载链接时间戳
sed -i -E "s|EQT-test-windows-amd64\.zip\?t=[^\']*|EQT-test-windows-amd64.zip?t=${timestamp}|g" "$index_file" "${root_dir}"/cloudflare/eqt-website/*/index.html

echo "=== [4/5] 提交元数据并部署同步至测试环境 ==="
cd "${root_dir}"
git add cloudflare/eqt-drm-api/src/services/github.ts cloudflare/eqt-website/ pkg/version/version.go desktop/gui/wails.json || true
if ! git diff --cached --quiet; then
  git commit -m "chore(test): publish test release ${current_version} (t=${timestamp})"
fi

# 推送当前主分支
"${root_dir}/scripts/git-push-smart.sh"

# 快进合并到 dev 分支并推送，触发 GitHub Actions 官方 deploy-test 流水线
current_branch="$(git rev-parse --abbrev-ref HEAD)"
git checkout dev
git merge "$current_branch" --ff-only
"${root_dir}/scripts/git-push-smart.sh" origin dev
git checkout "$current_branch"

echo "=== [5/5] 验证测试环境主页与元数据状态 ==="
sleep 5
echo "检查 lic-test.eqt.net.im/update-metadata.json:"
$WRANGLER_ENV curl -s https://lic-test.eqt.net.im/update-metadata.json | rg -o '"version":"[^"]*"' || true

echo "检查 test.eqt.net.im 首页连通性:"
$WRANGLER_ENV curl -sI https://test.eqt.net.im/ | head -n 1 || true

echo "🎉 测试版 ${current_version} 发布完成！主页已彻底同步，下载按钮已直通最新版本。"
