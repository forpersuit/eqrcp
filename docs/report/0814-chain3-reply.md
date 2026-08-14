审查完成。以下是针对最新提交 c46ad6e(结合 docs/report/0814-chain3.md 问题 #4)的结论。

结论:提交目标部分达成——Go 侧到位,JS 侧幂等表分支实际未覆盖

已验证(两个测试套件均通过)

- Go 侧 3 个子测试与 rejectCrossOriginDesktopAgent 实现逐一核对,全部正确:
  - reject_sec_fetch_cross_site:空 Origin + Sec-Fetch-Site: cross-site → 403 ✓(命中 desktop_agent.go:587-590)
  - reject_untrusted_referer:空 Origin + 恶意 Referer → 403 ✓(命中 desktop_agent.go:592-597)
  - allow_trusted_referer:127.0.0.1 loopback Referer → 200 ✓(命中 trustedDesktopAgentLocalHost,desktop_agent.go:620-626)
  - go test ./cmd -run TestDesktopAgentAllowsLocalAndWailsOrigins -v → 8/8 PASS,报告 #4 要求的「空 Origin 分支」这部分真实落地。
- JS Test Case 5 断言全部通过:node tests/verify-subscription-cancel.js → 5 个用例 100% 通过。

🔴 核心发现:Test Case 5 没测到「幂等表」分支,新增 mock 代码是死代码

真实 handler 的幂等检查是两步:先查 licenses.paddle_transaction_id(paddle.ts:177-186),命中即短路返回;查不到才落 paddle_processed_transactions 表(paddle.ts:188-201)。

Test Case 5 同时 seed 了 licenses 行和 paddle_processed_transactions 行,所以:

- 请求在第一步 SELECT license_code FROM licenses WHERE paddle_transaction_id = ? 就被 EQT-PLUS-ORIG 命中,短路返回,already processed 断言走的是 licenses 快路径;
- mock 新增的 FROM paddle_processed_transactions WHERE transaction_id = 查询分支(verify-subscription-cancel.js:104-108)、batch()、INSERT OR IGNORE INTO paddle_processed_transactions 处理全程从未被调用——所有用例(Cases 1-4 是订阅事件,Case 5 短路)都没进入 fulfillment 的 batch 路径(paddle.ts:349/428/494);

也就是说,报告 #4 点名要补的「幂等表重放断言」并没有真正交付——只覆盖了 licenses 分支,幂等表本身依然无测试。

修复建议:加第二个 replay 场景(或改 Case 5)——只 seed paddle_processed_transactions、不 seed licenses 行,让请求落到第二步,并额外断言 action: 'initial' 被一并返回(真实 handler 会带 action)。

次要观察

1. 问题 #5 在本次提交的新文件上复现:docs/report/0814-chain3.md 自身也缺结尾换行(与 0814-chains-replay1.md 一样)。
2. 问题 #1/#2/#3(索引预检、解绑配额 TOCTOU、syncInFlightMu 阻塞)本次未触及,仍按报告排期。
3. mock batch() 仍不模拟原子回滚(报告已接受),且因上述死代码问题,本次仍无调用点验证它。