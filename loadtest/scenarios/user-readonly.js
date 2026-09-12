/**
 * 场景：登录用户只读链路（首页 → 套餐 → 券 → 订单列表 → 排队信息）
 *
 * 覆盖接口（均为只读，不产生业务数据）：
 *   GET  /store/package_list        套餐列表
 *   GET  /coupon/list_available     可用券
 *   POST /order/order_list          订单列表（分页）
 *   GET  /order/queue_info          排队信息
 *
 * 这四个接口都没有 @CheckToken 注解，不会进 SatokenConfigure 的异常访问计数，
 * 也没有 @UserLock，是带鉴权场景里最安全的一组。
 * 若要压 @CheckToken 接口（/user/info/show_me、/user/behavior/*），
 * 注意 5 分钟窗口内同一 userId 超 100 次会被强制登出，token 数必须够。
 */
import http from 'k6/http';
import { sleep } from 'k6';
import { url, params, STORE_ID } from '../lib/config.js';
import { authHeaders, tokenCount } from '../lib/auth.js';
import { checkApi, commonThresholds } from '../lib/checks.js';

const VUS = Number(__ENV.VUS || 30);

export const options = {
  scenarios: {
    user_readonly: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: VUS },
        { duration: '2m', target: VUS },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: Object.assign({}, commonThresholds, {
    // 按接口单独设 p95 阈值，避免快接口把慢接口的数字平均掉、在总体指标里被掩盖
    'http_req_duration{name:store_package_list}': ['p(95)<500'],
    'http_req_duration{name:coupon_list_available}': ['p(95)<500'],
    'http_req_duration{name:order_list}': ['p(95)<500'],
    'http_req_duration{name:order_queue_info}': ['p(95)<500'],
  }),
};

export function setup() {
  const n = tokenCount();
  if (VUS > n) {
    console.warn(
      `VU 数(${VUS}) 大于 token 数(${n})，多个 VU 会共用同一 userId；` +
      `压 @CheckToken 接口时容易触发异常访问检测，建议补充 token`
    );
  }
  return { tokenCount: n };
}

export default function () {
  const auth = authHeaders();

  const pkg = http.get(url('/store/package_list'), params('store_package_list', auth));
  checkApi(pkg, 'store_package_list', { validate: (d) => Array.isArray(d) });

  const coupon = http.get(url('/coupon/list_available'), params('coupon_list_available', auth));
  checkApi(coupon, 'coupon_list_available', { validate: (d) => Array.isArray(d) });

  // 小程序端只允许按 statusCategory 分页查自己的单，userId 由 token 注入，请求体不用传
  const orderBody = JSON.stringify({ statusCategory: 'ALL', pageNum: 1, pageSize: 10 });
  const orders = http.post(url('/order/order_list'), orderBody, params('order_list', auth));
  checkApi(orders, 'order_list', {
    validate: (d) => d !== null && Array.isArray(d.records),
  });

  const queue = http.get(
    url(`/order/queue_info?storeId=${STORE_ID}`),
    params('order_queue_info', auth)
  );
  // 用户当前没有排队时返回空 map 也算正常，这里只校验业务码
  checkApi(queue, 'order_queue_info');

  sleep(1);
}
