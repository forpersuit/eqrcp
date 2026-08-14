审查完成。我把两份 0814-chain* 报告与 f07bf8a 的实际 diff 逐一对照,并核验了当前代码、schema、以及构建结果。结论如下。

总体结论

这次提交覆盖了报告中的大部分阻断/高危项,方向正确;但引入了 1 个编译级阻断(Worker 无法部署)和 1 个幂等性回归,另有几处"部分修复"和若干新引入的小问题。

---
🔴 阻断级(必须先修)

1. paddle.ts 未导入 isD1RateLimited → Worker 无法构建

cloudflare/eqt-drm-api/src/routes/paddle.ts:832 新增的 M5 限流调用:

if (await isD1RateLimited(env, `query:${transactionId}`, 30, 60000)) { ... }

但 paddle.ts 的 import 块里没有从 ../utils/rate-limit 引入 isD1RateLimited(只有 drm.ts:7 引入了它)。npx tsc --noEmit 实测:

src/routes/paddle.ts(832,15): error TS2304: Cannot find name 'isD1RateLimited'.

后果:wrangler deploy 会直接失败,整个 DRM 后端当前处于不可部署状态。修法是给 paddle.ts 的 ../utils/rate-limit import 补上 isD1RateLimited。这是本次提交最严重的问题——Go 侧 go build ./... 通过,但 TS 侧编译不过。

---
🟠 高危回归

2. 移除 activations INSERT 的 NOT EXISTS 后,去重依赖只剩"读后写"预检,幂等性退化

drm.ts:517-541 的 INSERT 现在只剩 WHERE (SELECT COUNT(*) ...) < max_devices,原先的 NOT EXISTS(单指纹 OR 去重)被整体删除;而 schema.sql:24-44 与 auth.ts:232-240 的 activations 表只有非唯一索引 idx_activations_license,没有任何唯一约束。

原来的 NOT EXISTS 虽然口径错误(导致 H1 绕过),但它确实兜住了"同一设备 D1 重试超时"的重复插入场景——代码注释里还明确写着 e.g. D1 retry timeout。现在去掉后:

- 重试时先跑 SELECT * FROM activations WHERE license_code = ? 做 matchFingerprint(≥2) 预判;
- 若首次写入尚未对读副本可见(D1 读滞后/超时重试),预检判"未激活" → 直接 INSERT → 同设备第二行 activation 落库,重复占一个名额,且后续 max_devices 计数失真。

修复建议:保留去重但换成 matchFingerprint(≥2) 语义的 NOT EXISTS,或更干净地给 (license_code, device_id) 加唯一索引(现在 device_id 已是权威 ID,天然适合做幂等键)。这是"修 H1 顺带把幂等保护也删了"的典型问题。

---
逐条对照(报告 → 实际修复)

┌──────┬────────────────────┬────────────────┬───────────────────────────────────────────────────────────┐
│ 编号 │      报告问题      │      状态      │                           说明                            │
├──────┼────────────────────┼────────────────┼───────────────────────────────────────────────────────────┤
│ B1   │ paddle.ts MD5 铸码 │ ✅ 已修        │ paddle.ts:456 改 SHA-256,generate-license.sh 同步改       │
├──────┼────────────────────┼────────────────┼───────────────────────────────────────────────────────────┤
│ H1   │ 单指纹 OR 绕过上限 │ ⚠️             │ 口径统一为 matchFingerprint(≥2) + device-registry.ts:60   │
│      │                    │ 修了但引入回归 │ 提到 >=2;但见上面回归 #2                                  │
├──────┼────────────────────┼────────────────┼───────────────────────────────────────────────────────────┤
│ H2   │ /set-paid-status   │ ✅ 已修        │ 路由下线 + trustedDesktopAgentLocalHost 去掉              │
│      │ 提权               │                │ ip.IsPrivate()/IsLinkLocalUnicast(),仅留 loopback         │
├──────┼────────────────────┼────────────────┼───────────────────────────────────────────────────────────┤
│ H3   │ 单指纹扣名额不落盘 │ ✅ 已修        │ 服务端 activate 加 nonEmptyFpCount < 2 拒绝,与客户端      │
│      │                    │                │ VerifyFingerprint(≥2) 对齐                                │
├──────┼────────────────────┼────────────────┼───────────────────────────────────────────────────────────┤
│ H4   │ 硬编码 LIFETIME +  │ ⚠️ 部分        │ 改用 state.status?.licenseExpiresAt;但 fallback           │
│      │ 竞态               │                │ 有语义错(见 #3)                                           │
├──────┼────────────────────┼────────────────┼───────────────────────────────────────────────────────────┤
│ M1   │ GUI                │ ✅ 已修        │ ResetLicense() 异步 best-effort 调 /api/v1/device/unbind  │
│      │ 解绑与服务端脱节   │                │ + 新端点                                                  │
├──────┼────────────────────┼────────────────┼───────────────────────────────────────────────────────────┤
│ M2   │ auth_codes 死路由  │ ✅ 已修        │ portal.ts 删除 send-code/verify-code 两个死分支           │
├──────┼────────────────────┼────────────────┼───────────────────────────────────────────────────────────┤
│ M3   │ 退款后复活         │ ✅ 已修        │ paddle.ts:750 加 recoverableReasons 白名单                │
├──────┼────────────────────┼────────────────┼───────────────────────────────────────────────────────────┤
│      │ 续费覆盖 txn       │                │ 只加了"同 txn 重放"短路(paddle.ts:384),:411 仍            │
│ M4   │ 破坏幂等           │ ❌ 未修        │ paddle_transaction_id = 新txn;重放原始 txn1 仍会双铸(见   │
│      │                    │                │ #4)                                                       │
├──────┼────────────────────┼────────────────┼───────────────────────────────────────────────────────────┤
│ M5   │ license-query      │ ⚠️ 部分        │ 只加限流(30/min),未加邮箱匹配/一次性 token;且引入编译错   │
│      │ 无鉴权             │                │ #1                                                        │
├──────┼────────────────────┼────────────────┼───────────────────────────────────────────────────────────┤
│ M6   │ .lic               │ ❌ 未修        │ 无 licenseFileMu、无 in-flight 去重                       │
│      │ 无互斥/缓存陈旧    │                │                                                           │
├──────┼────────────────────┼────────────────┼───────────────────────────────────────────────────────────┤
│ M7   │ 时钟篡改单向锁死   │ ⚠️ 部分        │ 加了 SetClockTampered(false)(VerifyLocalLicense           │
│      │                    │                │ 成功路径),激活成功路径未加                                │
├──────┼────────────────────┼────────────────┼───────────────────────────────────────────────────────────┤
│ M8   │ Wails 同步阻塞网络 │ ❌ 未修        │ app.go 的 ActivateLicense/RefreshLicenseStatus 仍同步     │
├──────┼────────────────────┼────────────────┼───────────────────────────────────────────────────────────┤
│ M9   │ 解绑配额竞态       │ ❌ 未修        │ 且新端点本身也无事务、无 yearly 配额(见 #5)               │
├──────┼────────────────────┼────────────────┼───────────────────────────────────────────────────────────┤
│ M10  │ 空 Origin 放行     │ ⚠️ 部分        │ 只去掉了私网信任,origin=="" 仍放行                        │
└──────┴────────────────────┴────────────────┴───────────────────────────────────────────────────────────┘

chain2 文档对照:① 滚动续期 ✅(用 activated_at 固化,drm.ts:96/806 传入 matchedActivation.activated_at);② 跨码堆叠 ❌(文档本身标"需你决策",未动 evaluateStacking);③ GUI 重置不释放名额 ✅(同 M1);④ 死路由 ✅;⑤ portal 显示 ✅ 后端(加 is_expired/is_refunded),但 portal.html 前端未消费;⑥ activate/verify device_id 口径 ✅(verify 补了 device_id 匹配);⑩ Error→.message ✅;⑪ 死代码 ✅;⑦⑧ 未修。

---
🟡 其他发现

3. confirmRedeem 里 state.status?.tier 字段名错误 + codeDate 兜底语义错

main.js:5761 用 state.status?.tier,但 AgentStatus 的 JSON 字段是 licenseTier(app.go:103 json:"licenseTier"),所以 state.status?.tier 永远是 undefined,实际恒回退到 result.tier(代码里解析出的 tier,恰好正确,所以无害但不达意图)。

main.js:5759 的兜底 || result.codeDate:而 validateRedeemCode 返回的 codeDate 是 EQT-TIER-YYYYMMDD-... 里的发码日期 token(如 20260814),不是到期时间。若 licenseExpiresAt 缺失,会把发码日期当到期日写进 saveLicense,前端 :573 会把 20260814 渲染成畸形到期日。正确兜底应是 '' / 待同步态(报告 H4 原文就写了"缺失显示「待同步」")。

4. M4 只堵了"续费 txn 重放",没堵"原购 txn 重放"

paddle.ts:384 的短路只处理 subLicense.paddle_transaction_id === 当前 txn。而 :411 续费仍覆盖 paddle_transaction_id。于是续费后,重放最初那次 transaction.completed 时,幂等 SELECT(:177)按旧 txn 查不到 → 走铸码分支 → 双铸。报告 M4 建议的"不覆盖原 txn / 另设 last_renewal_txn_id / 事件表"未落地。

5. 新 /api/v1/device/unbind 端点无 yearly 配额、无事务

drm.ts:880-927:DELETE activation → INSERT unbind_record → UPDATE device_registry 三步无事务(与 M9 同款竞态);且完全没有 portal.ts 里 MAX_YEARLY_UNBINDS 那样的年度解绑配额。结果:用户可通过客户端解绑端点无限"解绑→重激活"换机,绕过 portal 侧设计的设备切换频率限制。建议至少对齐 portal 的配额口径。

6. 工作树未清理

git status 显示 pkg/config/testdata/eqt.yml、pkg/config/testdata/full.yml 两个文件仍处于 modified 未提交。按 DoD(工作树干净)需要确认是本次变更遗留还是有意保留。