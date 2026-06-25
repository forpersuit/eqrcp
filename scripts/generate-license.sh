#!/bin/bash
# scripts/generate-license.sh
# EQT 兑换码生成与数据库导入脚本

# 默认参数
TIER="PLUS"
MAX_DEVICES=2
EXPIRES="LIFETIME"
ENV="remote" # 默认写入云端 D1 数据库，也可以是 local

# 帮助信息
show_help() {
    echo "EQT 激活码生成器"
    echo "使用方法: ./generate-license.sh [选项]"
    echo "选项:"
    echo "  -t, --tier <PLUS|PRO>      激活码级别 (默认: PLUS)"
    echo "  -m, --max <设备数>         最大设备限制 (默认: 2)"
    echo "  -e, --expires <LIFETIME|ISO时间> 过期时间 (默认: LIFETIME)"
    echo "  -l, --local                写入本地 D1 数据库 (默认是云端 D1)"
    echo "  -h, --help                 显示帮助信息"
    echo "示例:"
    echo "  ./generate-license.sh -t PLUS -m 2 -e LIFETIME"
    echo "  ./generate-license.sh -t PRO -m 1 -e 2027-06-25T12:00:00Z"
}

# 解析命令行参数
while [[ "$#" -gt 0 ]]; do
    case $1 in
        -t|--tier) TIER="$2"; shift ;;
        -m|--max) MAX_DEVICES="$2"; shift ;;
        -e|--expires) EXPIRES="$2"; shift ;;
        -l|--local) ENV="local" ;;
        -h|--help) show_help; exit 0 ;;
        *) echo "未知选项: $1"; show_help; exit 1 ;;
    esac
    shift
done

# 规范化大写
TIER=$(echo "${TIER}" | tr 'a-z' 'A-Z')

if [ "${TIER}" != "PLUS" ] && [ "${TIER}" != "PRO" ]; then
    echo "错误: 级别必须为 PLUS 或 PRO"
    exit 1
fi

# 生成随机激活码格式: EQT-TIER-YYYYMMDD-RANDOM-CHECK
# YYYYMMDD 为当前日期，RANDOM 为 6 位大写随机字符
DATE_STR=$(date +%Y%m%d)
# 使用 /dev/urandom 兼容 macOS/Linux 随机数生成
RAND_STR=$(tr -dc 'A-Z0-9' < /dev/urandom 2>/dev/null | head -c 6)
if [ -z "${RAND_STR}" ]; then
    # 兼容没有 /dev/urandom 字符过滤的情况
    RAND_STR=$(openssl rand -hex 3 | tr 'a-z' 'A-Z')
fi

# 计算简易校验码保证格式端正
CHECK_SUM=$(echo -n "${TIER}-${DATE_STR}-${RAND_STR}" | md5sum | head -c 4 | tr 'a-z' 'A-Z')

LICENSE_CODE="EQT-${TIER}-${DATE_STR}-${RAND_STR}-${CHECK_SUM}"
CREATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "========================================="
echo "  成功生成 EQT 兑换码！"
echo "========================================="
echo "兑换码:   ${LICENSE_CODE}"
echo "套餐类型: ${TIER}"
echo "最大设备: ${MAX_DEVICES}"
echo "有效期至: ${EXPIRES}"
echo "创建时间: ${CREATED_AT}"
echo "写入数据库: ${ENV}"
echo "========================================="

# 拼装 SQL 语句
SQL="INSERT INTO licenses (license_code, tier, status, max_devices, expires_at, created_at) VALUES ('${LICENSE_CODE}', '${TIER}', 'active', ${MAX_DEVICES}, '${EXPIRES}', '${CREATED_AT}');"

echo "SQL: ${SQL}"
echo ""

# 执行 wrangler 命令插入 D1 数据库
DB_NAME="eqt-drm-db"

# 检查当前目录下或父目录下是否存在 wrangler 配置
# 如果在 cloudflare/eqt-drm-api 目录下运行，可以直接执行 wrangler
# 如果在根目录下运行，则需要进入对应的子目录
CWD_DIR=$(pwd)
WRANGLER_DIR="${CWD_DIR}/cloudflare/eqt-drm-api"
if [ ! -d "${WRANGLER_DIR}" ]; then
    # 如果本身就在子目录中
    if [ -f "${CWD_DIR}/wrangler.json" ] || [ -f "${CWD_DIR}/wrangler.toml" ] || [ -f "${CWD_DIR}/wrangler.jsonc" ]; then
        WRANGLER_DIR="${CWD_DIR}"
    else
        # 兜底：如果没找到直接就在根目录查找并建立
        WRANGLER_DIR="${CWD_DIR}"
    fi
fi

# 执行
echo "正在尝试将激活码插入 D1 数据库..."
WRANGLER_FLAGS=""
if [ "${ENV}" = "remote" ]; then
    WRANGLER_FLAGS="--remote"
else
    WRANGLER_FLAGS="--local"
fi

# 临时置空 CLOUDFLARE_API_TOKEN，防止过期 Token 干扰 wrangler 部署，强制回归浏览器登录认证
(
    cd "${WRANGLER_DIR}" || exit 1
    export CLOUDFLARE_API_TOKEN=""
    npx wrangler d1 execute "${DB_NAME}" ${WRANGLER_FLAGS} --command="${SQL}"
)

if [ $? -eq 0 ]; then
    echo "========================================="
    echo "  恭喜！兑换码已成功存入 ${ENV} D1 数据库！"
    echo "  用户现在可以使用此码在 EQT 客户端上激活了。"
    echo "========================================="
else
    echo "错误: 执行 wrangler d1 execute 失败。请检查是否已在 ${WRANGLER_DIR} 目录下完成登录 (npx wrangler login) 并且网络畅通。"
fi
