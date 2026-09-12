/**
 * 压测全局配置：地址、鉴权头名、通用请求参数。
 * 所有可变项一律走环境变量，脚本里不硬编码任何地址和凭证。
 */

// 被测接口根地址 = 网关地址 + context-path，由 run.sh 传入。
// 默认值里的 /miniapp/api 是 server.servlet.context-path，由 Nacos 下发（本地配置文件里没有），
// 漏掉它所有接口都是 404。
export const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1:8080/miniapp/api').replace(/\/+$/, '');

/**
 * 鉴权头名称。
 * 对应 main 的 application.yml：sa-token.token-name: satoken
 * 注意不是 Authorization: Bearer，改配置时这里要同步。
 */
export const TOKEN_HEADER = __ENV.TOKEN_HEADER || 'satoken';

// 单请求超时。main 的 dubbo.consumer.timeout 是 12s，HTTP 层留一点余量
export const HTTP_TIMEOUT = __ENV.HTTP_TIMEOUT || '15s';

// 压测目标门店。默认 1，与 qrcode-list.json 里的 storeId=1 一致
export const STORE_ID = Number(__ENV.STORE_ID || 1);

/**
 * 通用请求参数。
 * tags.name 用于在 k6 汇总里按接口聚合，避免带参 URL 把指标打散。
 */
export function params(name, extraHeaders) {
  return {
    timeout: HTTP_TIMEOUT,
    tags: { name: name },
    headers: Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {}),
  };
}

export function url(path) {
  return BASE_URL + path;
}
