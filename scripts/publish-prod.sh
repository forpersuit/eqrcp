#!/usr/bin/env bash
# ==============================================================================
# scripts/publish-prod.sh — EQT 生产环境完整发布闭环脚本
#
# 语义规范：
#   - 本地编译 (Build)  : 仅生成二进制与 zip 压缩包 (scripts/deploy-windows-results.sh)
#   - 边缘部署 (Deploy) : 仅部署 Worker 与 Pages 网站代码 (deploy.yml / wrangler deploy)
#   - 完整发布 (Publish): 推送 master -> 创建并推送版本 Tag -> 触发 GitHub Actions
#                         官方 Release 流水线进行安全加签、发布与 R2 归档 -> 同步部署官网
# ==============================================================================

set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 检查当前分支必须是 master
current_branch="$(git -C "$root_dir" rev-parse --abbrev-ref HEAD)"
if [[ "$current_branch" != "master" ]]; then
  echo "error: 生产发布必须在 master 分支执行，当前分支为: ${current_branch}" >&2
  exit 1
fi

# 检查工作区必须干净
if ! git -C "$root_dir" diff --quiet || ! git -C "$root_dir" diff --cached --quiet; then
  echo "error: 工作区存在未提交的更改，请先提交或 stash 后再发布生产。" >&2
  exit 1
fi

current_version="$(rg -o 'version = "v[^"]*"' "${root_dir}/pkg/version/version.go" | cut -d'"' -f2)"
if [[ -z "$current_version" ]]; then
  echo "error: 无法从 pkg/version/version.go 解析当前版本号" >&2
  exit 1
fi

echo "=== [1/4] 确认发布版本与同步最新代码 ==="
echo "生产发布版本: ${current_version}"

# 确保 master 最新代码已推送至远程
echo "正在推送 master 分支至远程..."
"${root_dir}/scripts/git-push-smart.sh" origin master

echo "=== [2/4] 检查并创建生产版本 Tag (${current_version}) ==="
if git -C "$root_dir" rev-parse "${current_version}" >/dev/null 2>&1; then
  echo "提示: 本地已存在 Tag ${current_version}"
else
  echo "正在创建本地 Tag ${current_version}..."
  git -C "$root_dir" tag -a "${current_version}" -m "Release ${current_version}"
fi

echo "正在推送 Tag ${current_version} 至 GitHub (触发官方 release.yml 流水线)..."
"${root_dir}/scripts/git-push-smart.sh" origin "${current_version}"

echo "=== [3/4] 同步部署生产官网到 Cloudflare Pages (www.eqt.net.im) ==="
WRANGLER_ENV="env -u http_proxy -u HTTP_PROXY -u https_proxy -u HTTPS_PROXY -u all_proxy -u ALL_PROXY"
cd "${root_dir}/cloudflare/eqt-website"
$WRANGLER_ENV npx wrangler pages deploy ./ --project-name=eqt --branch=master

echo "=== [4/4] 验证生产环境连通性与服务状态 ==="
sleep 3
echo "检查 www.eqt.net.im 首页响应状态:"
$WRANGLER_ENV curl -sI https://www.eqt.net.im/ | head -n 1 || true

echo "检查 lic.eqt.net.im 健康状态:"
$WRANGLER_ENV curl -s https://lic.eqt.net.im/api/v1/health || true
echo ""

echo "🎉 生产发布已触发！"
echo "  1. GitHub Actions release.yml 正在运行（安全构建 Windows 生产客户端、生成签名、归档 R2 与 Release）。"
echo "  2. 生产官网已更新发布至 www.eqt.net.im。"
echo "  可访问: https://github.com/forpersuit/eqrcp/actions 跟踪 Release 流水线进度。"
