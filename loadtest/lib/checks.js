/**
 * 业务成功率校验。
 *
 * 为什么不能直接用 k6 内置的 http_req_failed：
 * main 的 GlobalExceptionHandler 把所有异常都包成 ApiResult 返回，没有 @ResponseStatus，
 * 所以业务失败时 HTTP 状态码依然是 200。内置指标会把这些请求算成"成功"，
 * 错误率永远是 0，阈值门禁形同虚设。必须解析 body 里的 code 字段。
 */
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// 业务失败率：口径是「HTTP 非 200 或 body.code 非 200」，压测报告以这个为准
export const bizFailRate = new Rate('biz_failed');
// 按业务口径统计的耗时，便于和 http_req_duration 对照
export const bizDuration = new Trend('biz_duration', true);

/**
 * 解析并校验 main 的统一响应 {code, message, data, timestamp}。
 *
 * @param {object} res       k6 http 响应
 * @param {string} name      接口名，用于 check 输出
 * @param {object} [opts]
 * @param {boolean} [opts.wrapped=true]  响应是否被 GlobalResponseAdvice 包装。
 *        PublicController 标了 @IgnoreWrapper，返回的是裸对象，没有 code 字段，传 false。
 * @param {function} [opts.validate]     额外的数据校验，入参是 data（或裸 body），返回布尔
 * @returns {object|null} 成功时返回 data，失败返回 null
 */
export function checkApi(res, name, opts) {
  const options = opts || {};
  const wrapped = options.wrapped !== false;

  let body = null;
  let parseOk = false;
  try {
    body = res.json();
    parseOk = body !== null && typeof body === 'object';
  } catch (e) {
    // 响应不是 JSON（网关 502、WAF 拦截页等），保持 parseOk=false 走失败分支
    parseOk = false;
  }

  const httpOk = res.status === 200;
  const codeOk = wrapped ? parseOk && body.code === 200 : parseOk;
  const data = !parseOk ? null : (wrapped ? body.data : body);

  let dataOk = true;
  if (codeOk && typeof options.validate === 'function') {
    dataOk = options.validate(data) === true;
  }

  const passed = httpOk && codeOk && dataOk;

  check(res, {
    [name + ' HTTP 200']: () => httpOk,
    [name + ' 业务码正常']: () => codeOk,
    [name + ' 数据可用']: () => dataOk,
  });

  bizFailRate.add(!passed, { name: name });
  bizDuration.add(res.timings.duration, { name: name });

  if (!passed) {
    // 只打前 300 字符，避免高并发下日志刷爆
    console.warn(
      `[${name}] 失败 status=${res.status} body=${String(res.body).slice(0, 300)}`
    );
  }

  return passed ? data : null;
}

/**
 * 通用阈值。各场景脚本可以在自己的 options.thresholds 里覆盖。
 * http_req_failed 仍然保留，但它只能反映网关层可用性，不代表业务成功率。
 */
export const commonThresholds = {
  'http_req_duration': ['p(95)<500', 'p(99)<1000'],
  'http_req_failed': ['rate<0.01'],
  'biz_failed': ['rate<0.01'],
  'checks': ['rate>0.99'],
};
