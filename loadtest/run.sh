#!/usr/bin/env bash
# k6 压测入口。
# 用法：BASE_URL=<网关地址> ./run.sh scenarios/public-store.js [k6 附加参数...]
#
# 常用环境变量：
#   BASE_URL      被测接口根地址 = 网关地址 + context-path（测试环境走公网，生产走内网）
#                 不传默认 http://127.0.0.1:8080/miniapp/api，即本机起的 popstar-miniapp-api
#   VUS           并发虚拟用户数，默认 30
#   STORE_ID      压测目标门店，默认 1
#   TOKENS_FILE   token 文件路径，默认 ./tokens.json（免登录场景不需要）
#   DASHBOARD     设为 1 开启 k6 内置实时看板（默认只绑 127.0.0.1）
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v k6 >/dev/null 2>&1; then
  echo "未找到 k6。macOS: brew install k6；Alibaba Cloud Linux/CentOS: dnf install https://dl.k6.io/rpm/repo.rpm && dnf install k6" >&2
  exit 1
fi

SCRIPT="${1:-}"
if [[ -z "$SCRIPT" ]]; then
  echo "用法: BASE_URL=<网关地址> $0 <场景脚本路径> [k6 附加参数...]" >&2
  echo "可用场景:" >&2
  ls scenarios/*.js | grep -v '_template' | sed 's/^/  /' >&2
  exit 1
fi
shift

if [[ ! -f "$SCRIPT" ]]; then
  echo "场景脚本不存在: $SCRIPT" >&2
  exit 1
fi

# 不传时默认打本机 8080，与 lib/config.js 里的默认值保持一致，本地起完 api 可直接压。
# 末尾的 /miniapp/api 是 server.servlet.context-path，由 Nacos（main-api-*.properties）下发，
# 本地代码库里搜不到；漏掉它所有接口都是 404。换环境时连同网关地址一起替换。
# 必须 export：k6 是子进程，只有导出到环境变量场景脚本里的 __ENV.BASE_URL 才读得到。
# 压测试/生产环境时务必显式传入——默认值只是图本地方便，不是让你在别的环境上凭记忆跑。
export BASE_URL="${BASE_URL:-http://127.0.0.1:8080/miniapp/api}"

mkdir -p results
STAMP="$(date +%Y%m%d-%H%M%S)"
NAME="$(basename "$SCRIPT" .js)"
SUMMARY="results/${NAME}-${STAMP}.json"

if [[ "${DASHBOARD:-0}" == "1" ]]; then
  # 内置看板默认只监听 127.0.0.1，远程查看需在安全组临时放行来源 IP 并用完即关
  export K6_WEB_DASHBOARD=true
  export K6_WEB_DASHBOARD_EXPORT="results/${NAME}-${STAMP}.html"
fi

echo "被测地址: $BASE_URL"
echo "场景脚本: $SCRIPT"
echo "并发 VUs: ${VUS:-30}"
echo "汇总输出: $SUMMARY"
echo

# --summary-export 保留机器可读结果，便于后续做趋势对比 / 接 CI 门禁
k6 run --summary-export "$SUMMARY" "$SCRIPT" "$@"
