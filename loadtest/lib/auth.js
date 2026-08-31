/**
 * token 池。
 *
 * 为什么不在压测里现场登录：
 * main 的 /user/login/wxlogin 必须拿微信 code 走 code2session，压测机造不出合法 code；
 * UserLoginController 里原有的测试临时登录分支已经被注释掉，没有旁路可走。
 * 所以采用离线预置 token 方案：用真实测试账号在小程序登录后导出 token，写入 tokens.json。
 * sa-token 配置 timeout=1296000（15 天）、is-concurrent=true，导出的 token 可以长期复用、
 * 也不会因为账号在别处登录被挤掉。
 *
 * 为什么需要一个「池」而不是一个 token：
 * SatokenConfigure 的异常访问检测按 userId 计数，5 分钟窗口内同一用户访问
 * ≥20 次开始缩短 token 有效期、≥100 次直接强制登出（只对带 @CheckToken 的接口生效）。
 * 另有 @UserLock 的用户级互斥锁。所以 VU 必须按 userId 打散，1 个 VU 固定绑 1 个 token。
 */
import { TOKEN_HEADER } from './config.js';

// k6 的 open() 按「当前脚本文件所在目录」解析相对路径，本文件在 lib/ 下，
// 所以默认值要写成 ../tokens.json 才指向 loadtest/tokens.json。
const TOKENS_FILE = __ENV.TOKENS_FILE || '../tokens.json';

/**
 * init 阶段一次性读入，所有 VU 共享同一份只读数组（k6 会做内存共享）。
 * 文件缺失时给出明确指引，不要让脚本带着空池跑出一堆 401。
 */
const tokens = (function loadTokens() {
  let raw;
  try {
    raw = open(TOKENS_FILE);
  } catch (e) {
    throw new Error(
      `读不到 token 文件 ${TOKENS_FILE}。请复制 tokens.example.json 为 tokens.json 并填入真实 token（该文件已在 .gitignore 中）`
    );
  }
  const list = JSON.parse(raw);
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`${TOKENS_FILE} 内容为空或不是数组`);
  }
  return list;
})();

/**
 * 按 VU 编号取 token，同一个 VU 每轮拿到的都是同一个用户，
 * 保证 @UserLock 不会自己和自己抢锁、访问计数也能均摊。
 * __VU 从 1 开始，取模前先减 1。
 */
export function currentToken() {
  return tokens[(__VU - 1) % tokens.length];
}

/** VU 数超过 token 数时会有多个 VU 共用同一 userId，跑之前提示一下 */
export function tokenCount() {
  return tokens.length;
}

/** 组装鉴权头，合并到 params 的 headers 里用 */
export function authHeaders() {
  const h = {};
  h[TOKEN_HEADER] = currentToken();
  return h;
}
