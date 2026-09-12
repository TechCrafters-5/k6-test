/**
 * 场景：门店公开信息查询（免登录只读）
 *
 * 覆盖接口：
 *   GET /public/store/queue_summary   门店排队概况
 *   GET /public/store/distance_limit  门店距离限制
 *
 * 选它做第一个场景的原因：PublicController 在 SatokenConfigure 的 excludePathPatterns 里，
 * 不需要 token，也不受异常访问检测和 @UserLock 影响，是验证「脚本对不对」成本最低的入口。
 *
 * 注意 PublicController 标了 @IgnoreWrapper，响应不经 GlobalResponseAdvice 包装，
 * 返回的是裸对象（没有 code 字段），所以 checkApi 要传 wrapped: false。
 */
import http from 'k6/http';
import { sleep } from 'k6';
import { url, params, STORE_ID } from '../lib/config.js';
import { checkApi, commonThresholds } from '../lib/checks.js';

export const options = {
  scenarios: {
    public_store: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: Number(__ENV.VUS || 30) },  // 爬坡
        { duration: '1m', target: Number(__ENV.VUS || 30) },   // 稳态
        { duration: '15s', target: 0 },                        // 收尾
      ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: Object.assign({}, commonThresholds, {
    // 按接口单独设 p95 阈值，避免快接口把慢接口的数字平均掉、在总体指标里被掩盖
    'http_req_duration{name:public_queue_summary}': ['p(95)<500'],
    'http_req_duration{name:public_distance_limit}': ['p(95)<500'],
  }),
};

export default function () {
  // 排队概况：不带经纬度，只按 storeId 查
  const summaryRes = http.get(
    url(`/public/store/queue_summary?storeId=${STORE_ID}`),
    params('public_queue_summary')
  );
  checkApi(summaryRes, 'public_queue_summary', {
    wrapped: false,
    validate: (d) => d !== null && typeof d === 'object',
  });

  const limitRes = http.get(
    url(`/public/store/distance_limit?storeId=${STORE_ID}`),
    params('public_distance_limit')
  );
  checkApi(limitRes, 'public_distance_limit', {
    wrapped: false,
    validate: (d) => d !== null && typeof d === 'object',
  });

  // 模拟用户思考时间，不要让单 VU 变成死循环打满
  sleep(1);
}
