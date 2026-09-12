# main 接口压测（k6）

被测对象：`popstar-miniapp-api`（main 的 HTTP 入口，默认 8080）。
provider / order-provider 是 Dubbo 服务没有 HTTP 端口，不在本工具范围内。

## 快速开始

```bash
brew install k6                                  # macOS
./run.sh scenarios/public-store.js               # 不传 BASE_URL 默认打本机 http://127.0.0.1:8080/miniapp/api
BASE_URL=https://<测试环境网关>/miniapp/api ./run.sh scenarios/public-store.js
```

> `BASE_URL` 要带上 `/miniapp/api`：那是 `server.servlet.context-path`，由 Nacos
> （`main-api-*.properties`）下发，本地代码库里搜不到，漏掉的话所有接口都是 404。

`public-store.js` 是免登录场景，不需要 token，用来先验证网络通不通、脚本对不对。

带鉴权的场景需要先准备 token：

```bash
cp tokens.example.json tokens.json               # 内容换成 job 打印的 token 数组，见下方第 3 条
BASE_URL=https://<网关> VUS=20 ./run.sh scenarios/user-readonly.js
```

## 目录

```
lib/config.js     地址、鉴权头名、通用请求参数
lib/auth.js       token 池，按 VU 编号分配
lib/checks.js     业务码校验 + 通用阈值
scenarios/        场景脚本，一个脚本对应一个真实用户行为
run.sh            入口，结果写到 results/
```

## main 特有的几个坑

**1. HTTP 状态码恒为 200，内置错误率指标失效**

`GlobalExceptionHandler` 把所有异常都包成 `ApiResult` 返回，没有 `@ResponseStatus`。
k6 内置的 `http_req_failed` 只看状态码，业务报错时它依然算成功，错误率永远是 0。
所以判成功一律用 `checkApi()`，看自定义指标 `biz_failed`，不要看 `http_req_failed`。

**2. 鉴权头是 `satoken`，不是 `Authorization: Bearer`**

对应 `application.yml` 的 `sa-token.token-name`。token 格式 `AES(userId)-random16`。

**3. token 由 xxl-job 任务批量签发**

`/user/login/wxlogin` 必须走微信 code2session，压测机造不出合法 code；
`UserLoginController` 里原有的测试临时登录分支已经被注释掉，没有旁路可走。

main 里加了任务 `loadTestUserJobHandler`（`LoadTestUserJob`）专门干这事：

```
{}                              默认，只给库里已有的压测账号签发 token
{"mode":"both","count":50}      造 50 个账号再统一签发
{"mode":"user","count":50,"profileRatio":0.6}   只造账号，60% 资料完整
{"limit":20,"tokenTtl":7200}    只给 20 个账号签，有效期 2 小时
{"mode":"both","count":5,"dryRun":true}         试跑
```

token 以 JSON 数组整段打进 xxl-job 日志，复制粘贴到本目录的 `tokens.json` 即可。
不落盘、不入库，避免有效凭证留在服务器上。生产环境默认拒绝执行，
确需执行要显式传 `"allowProd":true`。

签出来的 token **默认 48 小时过期**，不跟随 sa-token 全局的 15 天——压测 token
会经日志和聊天工具流转，短有效期能把泄露后的可利用窗口压到最小。过期了重跑一次任务即可。
要更长得显式传 `tokenTtl`。

压测账号靠 username 的 `loadtestk6_` 前缀识别，openId 是 28 位纯随机数字，
手机号是 199 号段。sa-token 配了 `is-concurrent: true`，
压测 token 不会因为同一账号在别处登录被挤掉。

**4. 异常访问检测会把压测流量当攻击**

`SatokenConfigure` 里按 userId 计数，5 分钟窗口：

| 窗口内访问次数 | 后果 |
|---|---|
| ≥ 20 | token 有效期缩短到 20 分钟 |
| ≥ 40 | 缩短到 5 分钟 |
| ≥ 60 | 缩短到 1 分钟 |
| ≥ 100 | **强制登出**，token 直接作废 |

只对带 `@CheckToken` 的接口生效：`/user/info/show_me`、`/user/info/upload_avatar`、
`/user/info/submit_advice`、`/user/behavior/*`。压这些接口时 token 数量必须够分摊，
否则跑几十秒就全员被踢，测出来的是风控不是性能。
当前场景脚本都避开了这批接口。

**5. `@UserLock` 接口有用户级互斥锁**

`/user/info/car_save`、`/store/confirm_wash`、`/order/stop_washing`、
`/order/scan_plate_confirm`。同一个 token 并发打会大量抢锁失败，
所以 `auth.js` 按 `__VU` 取模分配 token，保证 1 个 VU 固定绑 1 个用户。

**6. `/order/store_next_step` 是长轮询**

`DeferredResult`，请求会挂住直到超时或被唤醒。它占的是连接不是 CPU，
指标口径和普通接口完全不同，必须单独建场景，不要混在同一个 VU 的串行流程里。

## 写接口的边界

下单（`/order/create_order`）、券核销（`/coupon/redeem`）、退款这类写接口
会污染真实订单表、报表和支付链路。在确认有测试商户/测试门店隔离机制之前，
不要在生产环境常态化跑，本目录也暂不提供对应场景脚本。
