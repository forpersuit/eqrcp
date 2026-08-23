#!/usr/bin/env bash
#
# Create a discount (coupon) code in Paddle Billing (Live or Sandbox).
#
# Usage:
#   PADDLE_API_KEY=pdl_live_xxx ./scripts/paddle-create-discount.sh -c <CODE> [-a <PERCENT>] [-u <LIMIT>] [--sandbox]
#
# Examples:
#   # 创建 Live 生产环境 100% 折扣、单次使用（一次性）优惠码 EQT100VIP
#   PADDLE_API_KEY=pdl_live_xxx ./scripts/paddle-create-discount.sh -c EQT100VIP -a 100 -u 1
#
#   # 创建 Sandbox 测试环境 100% 折扣码
#   PADDLE_API_KEY=pdl_sdbx_xxx ./scripts/paddle-create-discount.sh -c EQTTEST100 -a 100 -u 1 --sandbox
#

set -euo pipefail

CODE=""
AMOUNT="100"
USAGE_LIMIT="1"
DESCRIPTION=""
BASE_URL="https://api.paddle.com"
PRODUCT_ID="pro_01kyd2j68kvpd9vek49yss00qw"

show_help() {
  cat << 'HELP'
Paddle 折扣码 (Coupon) 自动创建工具

用法:
  PADDLE_API_KEY=<key> ./scripts/paddle-create-discount.sh [选项]

选项:
  -c, --code <CODE>         折扣码字符串 (例如: EQT100VIP，必填)
  -a, --amount <PERCENT>    折扣百分比 (默认: 100，即全额免费)
  -u, --usage <LIMIT>       最大使用次数 (默认: 1，即一次性)
  -d, --desc <TEXT>         描述文本 (默认: "EQT 100% Off Promo")
  -p, --product <ID>        限定适用商品 ID (默认: pro_01kyd2j68kvpd9vek49yss00qw)
  --sandbox                 使用 Paddle Sandbox 环境 (默认使用 Live 生产环境)
  -h, --help                显示帮助信息
HELP
}

while [[ "$#" -gt 0 ]]; do
  case $1 in
    -c|--code) CODE="$2"; shift ;;
    -a|--amount) AMOUNT="$2"; shift ;;
    -u|--usage) USAGE_LIMIT="$2"; shift ;;
    -d|--desc) DESCRIPTION="$2"; shift ;;
    -p|--product) PRODUCT_ID="$2"; shift ;;
    --sandbox) BASE_URL="https://sandbox-api.paddle.com" ;;
    -h|--help) show_help; exit 0 ;;
    *) echo "未知选项: $1"; show_help; exit 1 ;;
  esac
  shift
done

if [[ -z "$CODE" ]]; then
  # 自动生成 8 位大写随机折扣码
  RAND_HEX=$(openssl rand -hex 4 | tr 'a-z' 'A-Z')
  CODE="EQT100-${RAND_HEX}"
fi

if [[ -z "${PADDLE_API_KEY:-}" ]]; then
  echo "错误: 缺少 PADDLE_API_KEY 环境变量。"
  echo "用法: PADDLE_API_KEY=pdl_live_... $0 -c $CODE"
  exit 1
fi

if [[ -z "$DESCRIPTION" ]]; then
  DESCRIPTION="EQT ${AMOUNT}% Off One-time Promo (${CODE})"
fi

# 构造 Paddle Discounts API Payload
PAYLOAD=$(cat << JSON
{
  "description": "${DESCRIPTION}",
  "type": "percentage",
  "amount": "${AMOUNT}",
  "code": "${CODE}",
  "recur": false,
  "usage_limit": ${USAGE_LIMIT},
  "restrict_to": ["${PRODUCT_ID}"]
}
JSON
)

echo "========================================="
echo "正在向 Paddle (${BASE_URL}) 创建折扣码..."
echo "折扣码 (Code):    ${CODE}"
echo "折扣幅度:         ${AMOUNT}%"
echo "使用次数限制:     ${USAGE_LIMIT} 次"
echo "适用商品:         ${PRODUCT_ID}"
echo "========================================="

RESPONSE=$(curl -sS -w "\n%{http_code}" -X POST "${BASE_URL}/discounts" \
  -H "Authorization: Bearer ${PADDLE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "${PAYLOAD}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
RESP_BODY=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" ]]; then
  echo "✅ 成功创建 Paddle 购买折扣码！"
  echo "$RESP_BODY"
  echo "========================================="
  echo "买家在收银台结账时，在 'Add discount' 输入: ${CODE} 即可抵扣 ${AMOUNT}%。"
  echo "========================================="
else
  echo "❌ 创建失败 (HTTP ${HTTP_CODE}):"
  echo "$RESP_BODY"
  exit 1
fi
