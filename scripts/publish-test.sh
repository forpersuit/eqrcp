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

# 检查当前分支必须是 master
current_branch="$(git -C "$root_dir" rev-parse --abbrev-ref HEAD)"
if [[ "$current_branch" != "master" ]]; then
  echo "error: 测试发布闭环必须在 master 分支执行，当前分支为: ${current_branch}" >&2
  exit 1
fi

# 检查工作区必须干净
if ! git -C "$root_dir" diff --quiet || ! git -C "$root_dir" diff --cached --quiet; then
  echo "error: 工作区存在未提交的更改，请先提交或 stash 后再执行发布。" >&2
  exit 1
fi

echo "=== [1/6] 本地编译最新 Windows 测试物理产物 ==="
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

echo "=== [2/6] 上传安装包至 Cloudflare R2 远端分发存储桶 (download.eqt.net.im) ==="
# 剥离可能导致 undici 异常的 socks5 代理环境变量并注入 CI=true 禁用交互提示
WRANGLER_ENV="env -u http_proxy -u HTTP_PROXY -u https_proxy -u HTTPS_PROXY -u all_proxy -u ALL_PROXY CI=true"

cd "${root_dir}/cloudflare/eqt-drm-api"
$WRANGLER_ENV npx wrangler r2 object put "eqt-downloads/downloads/test/eqt-desktop-test-windows-amd64.zip" -f "$zip_file" --content-type application/zip --remote
$WRANGLER_ENV npx wrangler r2 object put "eqt-downloads/downloads/test/EQT-test-windows-amd64.zip" -f "$zip_file" --content-type application/zip --remote
$WRANGLER_ENV npx wrangler r2 object put "eqt-downloads/downloads/test/EQT.exe" -f "$exe_file" --content-type application/octet-stream --remote

echo "=== [3/6] 生成并上传测试更新元数据至 R2 ==="
stage_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$stage_dir"
}
trap cleanup EXIT
cp "$zip_file" "$stage_dir/eqt-desktop-test-windows-amd64.zip"
cp "$zip_file" "$stage_dir/EQT-test-windows-amd64.zip"
cp "$exe_file" "$stage_dir/EQT.exe"
go run "${root_dir}/scripts/generate-update-metadata/main.go" "${current_version}" "$stage_dir" "$stage_dir/update-metadata.json" test
$WRANGLER_ENV npx wrangler r2 object put "eqt-downloads/downloads/test/update-metadata.json" -f "$stage_dir/update-metadata.json" --content-type application/json --remote
rm -rf "$stage_dir"
trap - EXIT

echo "=== [4/6] 同步下载元数据与首页防缓存直链 ==="
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

echo "=== [5/6] 部署同步 Cloudflare 边缘服务至测试环境 ==="
cd "${root_dir}/cloudflare/eqt-drm-api"
$WRANGLER_ENV npx wrangler deploy --env test
cd "${root_dir}/cloudflare/eqt-feedback-api"
$WRANGLER_ENV npx wrangler deploy --env test
cd "${root_dir}"
node "${root_dir}/scripts/build-i18n-website.js"
cd "${root_dir}/cloudflare/eqt-website"
$WRANGLER_ENV npx wrangler pages deploy ./ --project-name=eqt-test --branch=dev

echo "=== [6/6] 提交元数据并同步推送主分支与 dev 分支 ==="
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

echo "=== 验证测试环境主页与元数据状态 ==="
sleep 3
echo "检查 lic-test.eqt.net.im/update-metadata.json:"
$WRANGLER_ENV curl -s https://lic-test.eqt.net.im/update-metadata.json | rg -o '"version":"[^"]*"' || true

echo "检查 test.eqt.net.im 首页连通性:"
$WRANGLER_ENV curl -sI https://test.eqt.net.im/ | head -n 1 || true

echo "🎉 测试版 ${current_version} 发布完成！产物、边缘服务与主页已彻底同步，下载按钮已直通最新版本。"
