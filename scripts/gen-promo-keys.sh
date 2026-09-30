#!/bin/bash
# scripts/gen-promo-keys.sh
# EQT X (Twitter) 推广促销激活码按需生成器
# 支持单码即时生成与批量铸造，支持自动注入 Cloudflare D1 远程/本地数据库，并一键输出格式化的英文私信 (DM) 文本。

set -euo pipefail

COUNT=1
TIER="PLUS"
MAX_DEVICES=2
DURATION_DAYS=365
REDEEM_WINDOW_DAYS=60
BATCH_ID="x_campaign_$(date +%Y%m%d)"
ENV="remote" # remote | local | dry-run
OUTPUT_FILE=""

show_help() {
    cat << EOF
EQT X (Twitter) 促销激活码按需生成器

用法:
  ./scripts/gen-promo-keys.sh [选项]

选项:
  -n, --count <数量>         生成激活码数量 (默认: 1)
  -t, --tier <PLUS|PRO>      激活码级别 (默认: PLUS)
  -d, --duration <天数>      激活后有效天数 (默认: 365，即 1 年期)
  -m, --max <设备数>         支持最大设备数 (默认: 2)
  -b, --batch <批次名>       Batch ID 标记 (默认: x_campaign_YYYYMMDD)
  -l, --local                写入本地 D1 数据库 (默认: 远程云端 D1)
  --dry-run                  仅在本地生成激活码与私信文案，不写入数据库
  -o, --output <文件路径>    将生成的激活码列表保存到指定文件
  -h, --help                 显示帮助信息

示例:
  # 场景 1: X 上有人评论 "KEY"，按需即时生成 1 个 1 年期 Plus 激活码并输出私信文本
  ./scripts/gen-promo-keys.sh

  # 场景 2: 批量预生成 50 个 1 年期 Plus 激活码存入文件备用
  ./scripts/gen-promo-keys.sh -n 50 -o docs/marketing/campaigns/promo_keys_50.txt

  # 场景 3: 本地演练生成（不写云端数据库）
  ./scripts/gen-promo-keys.sh -n 3 --dry-run
EOF
}

while [[ "$#" -gt 0 ]]; do
    case $1 in
        -n|--count) COUNT="$2"; shift ;;
        -t|--tier) TIER=$(echo "$2" | tr 'a-z' 'A-Z'); shift ;;
        -d|--duration) DURATION_DAYS="$2"; shift ;;
        -m|--max) MAX_DEVICES="$2"; shift ;;
        -b|--batch) BATCH_ID="$2"; shift ;;
        -l|--local) ENV="local" ;;
        --dry-run) ENV="dry-run" ;;
        -o|--output) OUTPUT_FILE="$2"; shift ;;
        -h|--help) show_help; exit 0 ;;
        *) echo "错误: 未知参数 $1"; show_help; exit 1 ;;
    esac
    shift
done

if [[ "$TIER" != "PLUS" && "$TIER" != "PRO" ]]; then
    echo "错误: tier 必须是 PLUS 或 PRO"
    exit 1
fi

DATE_STR=$(date +%Y%m%d)
CREATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# 计算兑换截止窗口（默认 60 天内需首次激活）
if date --version >/dev/null 2>&1; then
    # GNU date (Linux)
    REDEEM_DEADLINE=$(date -u -d "+${REDEEM_WINDOW_DAYS} days" +"%Y-%m-%dT%H:%M:%SZ")
else
    # BSD date (macOS)
    REDEEM_DEADLINE=$(date -u -v "+${REDEEM_WINDOW_DAYS}d" +"%Y-%m-%dT%H:%M:%SZ")
fi

echo "============================================================"
echo "  🚀 EQT 促销激活码生成器 (X Campaign Mint)"
echo "============================================================"
echo "  生成数量:       ${COUNT}"
echo "  套餐级别:       ${TIER}"
echo "  有效天数:       ${DURATION_DAYS} 天 (首次激活后起算)"
echo "  最大设备数:     ${MAX_DEVICES}"
echo "  兑换截止窗口:   ${REDEEM_DEADLINE}"
echo "  推广批次:       ${BATCH_ID}"
echo "  目标环境:       ${ENV}"
echo "============================================================"
echo ""

GENERATED_KEYS=()
SQL_STATEMENTS=()

for ((i = 1; i <= COUNT; i++)); do
    # 生成 6 位随机字符
    RAND_STR=$(tr -dc 'A-Z0-9' < /dev/urandom 2>/dev/null | head -c 6 || true)
    if [ -z "${RAND_STR}" ]; then
        RAND_STR=$(openssl rand -hex 3 | tr 'a-z' 'A-Z')
    fi

    # 计算 4 位 MD5 校验和保证激活码完整性
    CHECK_SUM=$(echo -n "${TIER}-${DATE_STR}-${RAND_STR}" | md5sum | head -c 4 | tr 'a-z' 'A-Z')
    LICENSE_CODE="EQT-${TIER}-${DATE_STR}-${RAND_STR}-${CHECK_SUM}"
    GENERATED_KEYS+=("${LICENSE_CODE}")

    # 构造 SQL 语句 (source='promo', duration_days=365, batch_id)
    SQL="INSERT INTO licenses (license_code, tier, status, max_devices, expires_at, duration_days, source, batch_id, created_at) VALUES ('${LICENSE_CODE}', '${TIER}', 'active', ${MAX_DEVICES}, '${REDEEM_DEADLINE}', ${DURATION_DAYS}, 'promo', '${BATCH_ID}', '${CREATED_AT}');"
    SQL_STATEMENTS+=("${SQL}")
done

# 如果指定了输出文件，写入激活码
if [ -n "${OUTPUT_FILE}" ]; then
    mkdir -p "$(dirname "${OUTPUT_FILE}")"
    printf "%s\n" "${GENERATED_KEYS[@]}" > "${OUTPUT_FILE}"
    echo "💾 已将 ${COUNT} 个激活码保存至: ${OUTPUT_FILE}"
fi

# 执行数据库写入
if [ "${ENV}" != "dry-run" ]; then
    CWD_DIR=$(pwd)
    WRANGLER_DIR="${CWD_DIR}/cloudflare/eqt-drm-api"
    if [ ! -d "${WRANGLER_DIR}" ]; then
        WRANGLER_DIR="${CWD_DIR}"
    fi

    echo "正在向 Cloudflare D1 写入激活码记录..."
    TMP_SQL_FILE=$(mktemp)
    printf "%s\n" "${SQL_STATEMENTS[@]}" > "${TMP_SQL_FILE}"

    WRANGLER_FLAGS=""
    if [ "${ENV}" = "remote" ]; then
        WRANGLER_FLAGS="--remote"
    else
        WRANGLER_FLAGS="--local"
    fi

    (
        cd "${WRANGLER_DIR}" || exit 1
        npx wrangler d1 execute "eqt-drm-db" ${WRANGLER_FLAGS} --file="${TMP_SQL_FILE}"
    )
    rm -f "${TMP_SQL_FILE}"
    echo "✅ 成功向 D1 (${ENV}) 写入 ${COUNT} 条激活码！"
    echo ""
else
    echo "⚠️  [DRY-RUN 模式] 未向数据库执行写入。"
    echo ""
fi

# 输出激活码及可直接用于 X 私信的模板
echo "============================================================"
echo "  🔑 生成的激活码列表与 X (Twitter) 私信回复模板"
echo "============================================================"

if [ "${COUNT}" -eq 1 ]; then
    FIRST_KEY="${GENERATED_KEYS[0]}"
    echo "激活码: ${FIRST_KEY}"
    echo ""
    echo "👇 直接复制以下文本发送 X 私信 (DM) 给用户:"
    echo "------------------------------------------------------------"
    cat << DM_EOF
Hey! Thanks for supporting EQT on X. Here is your free 1-Year Plus Pass (\$11.99 value):

🔑 License Key: ${FIRST_KEY}
📥 Download: https://www.eqt.net.im

Quick activation in 30s:
1. Launch EQT on your PC/Mac
2. Click the 💎 Diamond icon in the top right (Plan & License)
3. Paste the code into the box and click Redeem!

💡 On mobile right now? Bookmark this DM or forward it to yourself so you don't lose it! Enjoy frictionless transfers! 🚀
DM_EOF
    echo "------------------------------------------------------------"
else
    echo "共生成 ${COUNT} 个激活码:"
    for k in "${GENERATED_KEYS[@]}"; do
        echo "  • ${k}"
    done
    echo ""
    echo "私信模板参考 (单发给每位用户时替换 KEY):"
    cat << DM_MULTI_EOF
Hey! Thanks for supporting EQT on X. Here is your free 1-Year Plus Pass (\$11.99 value):

🔑 License Key: {LICENSE_KEY}
📥 Download: https://www.eqt.net.im

Quick activation: Launch EQT on your PC -> Click 💎 (Top Right) -> Paste your key and click Redeem.
💡 Bookmark this DM so you can activate when you're at your computer!
DM_MULTI_EOF
fi
echo "============================================================"
