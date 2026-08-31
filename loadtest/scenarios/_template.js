/**
 * 场景脚本模板：复制本文件改名后使用，一个脚本对应一个真实用户行为。
 *
 * 约定：
 *   - 只读接口可以直接常态化跑；写接口（下单/退款等）在有测试数据隔离前不要放进来
 *   - 每个 http 请求都要传 params(name)，否则带参 URL 会把指标打散、汇总不可读
 *   - 一律用 checkApi 判成功，不要只看 res.status——main 的异常也返回 HTTP 200
 */
import http from 'k6/http';
import { sleep } from 'k6';
import { url, params } from '../lib/config.js';
import { authHeaders } from '../lib/auth.js';   // 免登录场景删掉这行，避免强制要求 tokens.json
import { checkApi, commonThresholds } from '../lib/checks.js';

export const options = {
  scenarios: {
    my_scenario: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: Number(__ENV.VUS || 10) },
        { duration: '1m', target: Number(__ENV.VUS || 10) },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '15s',
    },
  },
  // 核心接口按各自 SLA 覆盖，不要无脑抄默认值
  thresholds: commonThresholds,
};

export default function () {
  const auth = authHeaders();

  const res = http.get(url('/替换成真实路径'), params('接口名', auth));
  checkApi(res, '接口名', {
    // PublicController 的接口带 @IgnoreWrapper，要加 wrapped: false
    // wrapped: false,
    validate: (d) => d !== null,
  });

  sleep(1);
}
