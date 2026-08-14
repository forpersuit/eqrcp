购买→铸码→兑换→解绑 链路审查报告

结论速览

链路存在 1 个阻断级缺陷(购买履约铸码在生产必然失败)、多个高危设备上限绕过/本地提权、以及一个结构性断点:GUI「解绑」与服务端「吊销」是单向脱节的。核心风险集中在三段:服务端铸码(paddle.ts 的 MD5)、服务端去重口径不一致(设备上限绕过)、GUI 解绑只清本地不释放名额。

---
🔴 阻断级

B1. 购买履约铸码使用 crypto.subtle.digest("MD5"),生产 Worker 必然抛异常 → 真实购买无法铸码

cloudflare/eqt-drm-api/src/routes/paddle.ts:447

const checkHashBuf = await crypto.subtle.digest("MD5", encoder.encode(checkSumPayload));
- 已核验:WebCrypto 的 SubtleCrypto.digest 仅支持 SHA-1/256/384/512,不支持 MD5;Cloudflare Workers 遵循标准 WebCrypto,该调用会抛 NotSupportedError。全库检索确认唯一的 MD5 polyfill 只存在于测试文件 tests/verify-subscription-cancel.js 与 tests/verify-pending-lifetime-upgrade-offline.js(注释还写着「Node 的 WebCrypto 不支持 MD5」,说明作者误以为 Worker 支持 MD5)。
- 后果:transaction.completed 走到「首次履约铸码」分支(paddle.ts:435-449)就抛异常,被外层 catch(794 行)吞掉返回 500,许可证永远铸不出来,购买流程整体中断。
- 修复:改为 crypto.subtle.digest("SHA-256", ...) 取前 4 字节做校验位(与 admin.ts:190 的 email hash 一致)。

---
🟠 高危

H1. 设备数上限可被绕过:去重 SQL 用「单指纹 OR」,与 matchFingerprint 的「≥2 项」口径冲突

cloudflare/eqt-drm-api/src/routes/drm.ts:512-521(条件 INSERT 的 NOT EXISTS)、548-563(回退查询),对照 utils/blacklist.ts:6-16(matchFingerprint 要求 ≥2)与 utils/device-registry.ts:60(compareCount > 0,1 项即可)。
- 已核验:激活前的「已激活」判断用 matchFOT EXISTS 与回退查询用 uuid_hash=? ORcpu_hash=? OR disk_hash=?(任一单项)。攻击设备与已激活设备共享一个指纹分量(如同型号 CPU 的 hash 天然相同)时,INSERT 被 NOT EXISTS 拦下 changes===0,回退查询命中 → alreadyActivated=true → 跳过 max_devices_reached → 仍签出合法证书返回 200,不消耗名额也不落 activation 行,可无限激活。
- 修复:SQL 去重口径统一为「≥2 项非空匹配回后应用层用 matchFingerprint判定;device_registry 阈值也提到 ≥2。

H2. 本地提权:/set-paid-status HTTP 端点未鉴权,可强制置付费

cmd/desktop_agent.go:857-882(handler)+ rejectCrossOriginDesktopAgent(578-588)。
- 已核验:该端点接收任意 {"paid":true} 直接 server.SetPaidStatus(...),无任何鉴权;服务绑定 127.0.0.1:48176。rejectCrossOriginDesktopAgent 只在「存在 Origin 且不受信任」时拒绝,无 Origin 的原生进程直接放行;且 trustedDesktopAgentLocalHost(609-616)把任意 loopback/私网/link-local IP 都视为受信任 Origin,局域网内任意网页可跨源 CSRF。/activate、/reset-license 同样暴露。
- 缓解但不足:是内存级绕过,下次 VerifyLocfalse,但仍是明确 DRM 提权洞。
- 修复:生产路由下线 /set-paid-status(dev/test 钩子),并收紧 Origin 白名单(去掉 ip.IsPrivate())。

H3. 单指纹设备:服务端已扣名额、客户端却

pkg/server/license.go:282(激活守卫只拒「三项全空」)vs 345(VerifyFingerprint 要求 ≥2)。
- 已核验:服务端 drm.ts:351 也只拒「三项全空」。当设备只能取到 1 项有效指纹(虚拟机/容器/权限受限)时,服务端接受激活、ActivatedDevices +1,但本地 matches=1 < 2 → 返回 "fingerprint check failed",.lic 不落盘、名额已被消耗。
- 修复:激活前就要求「至少 2 项有效非空指或在单指纹场景显式降级判定。

H4. 兑换成功硬编码 codeDate: 'LIFETIME' + 状态竞态,可能假显示「永久版」或激活后回退免费

desktop/gui/frontend/src/main.js:5764-57'LIFETIME'}))、5701-5707(!status.isPaid时清空本地 license)。
- 已核验:confirmRedeem 成功无条件写 LIFETIME,靠后续 loadStatusData 覆盖;但 getLicenseDisplayName(189-190)/computeLicensePlanState 依据 codeDate==='LIFETIME' 显示「永久版」。若
loadStatusData 失败或返回空,UI 长期误显 ).isPaid 因快照陈旧仍为false,会把刚写入的 license 清掉。
- 修复:以 ActivateLicense 返回值 / status.licenseExpiresAt 为唯一真相,缺失显示「待同步」;激活成功后短期信任本地 license。

---
🟡 中危

M1. GUI「解绑」与服务端「吊销」单向脱节(链路核心断点)

pkg/server/license.go:515-524、desktop/gui/app.go:1385-1392、desktop/gui/agent.go:1132-1134、cmd/desktop_agent.go:918-933。
- 已核验:ResetLicense() 只删本地 .lic +  何 /api/v1/unbind/revoke 调用(rg确认)。服务端真正释放名额的接口是 POST /api/v1/user/unbind-device(portal.ts:307,需邮箱登录 + activation_id),GUI 完全没接。
- 双重后果:
  a. 解绑后旧设备仍占服务端 activations es_reached;
  b. 更糟:本地重置后服务端仍认为旧码在该设备激活中,再兑换另一个码会命中 evaluateStacking 的 cross_code_stacking_blocked(drm.ts:200),GUI 侧根本换不了码,只能去网页门户解绑。
- 修复:ResetLicense 时 best-effort 调服务端解绑接口,并把服务端结果反馈 GUI;或至少提示「本地已清除,服务端名额未释放」。

M2. 自助门户登录表 auth_codes 从未建表,/api/v1/user/send-code、/verify-code 必失败

cloudflare/eqt-drm-api/src/routes/portal.ts:138,155,192,202。
- 已核验:schema.sql 与所有 ensure* 只有 verification_codes(67auth_codes。INSERT INTO auth_codes 会抛 i/v1/auth/send-code→verification_codes是通的。若门户前端走 portal.ts 的 /user/* 路径,则门户邮箱登录(解绑/退款/取消订阅的前置)整体不可用。待确认 portal.html 实际调用的是哪条路径(其 JS 做了 n/n 混淆)。      - 修复:补建 auth_codes 表,或删遗留路径统

M3. 退款/拒付后许可证可被 subscription.updated(status=active) 复活

cloudflare/eqt-drm-api/src/routes/paddle.ts:738-748。
- 已核验:恢复分支只判 status IN ('revoked','suspended'),不判 revoke_reason。退款(revoke_reason='refunve 时,下一周期 webhook会把已退款许可证复活为 active。
- 修复:恢复前校验 revoke_reason IN ('past_due','paused','subscription') 才允许,refund/chargeback/admin 一律不复活。

M4. 续费覆盖 paddle_transaction_id,破坏幂等键 → 重放原 webhook 重复铸码

cloudflare/eqt-drm-api/src/routes/paddle
- 已核验:续费 UPDATE ... paddle_transaction_id = 最新txn 把原 txn 覆盖。幂等 SELECT(176 按 paddle_transaction_id 查)查不到原 txn → 重放原 transaction.completed 会再铸一张许可证。
- 修复:续费不覆盖原 txn id(另设 last_renewal_txn_id),或用独立事件表记录已处理事件 ID。

M5. /api/v1/paddle/license-query 无认证,凭 transaction_id 可取走激活码

cloudflare/eqt-drm-api/src/routes/paddle.ts:810-839。
- 已核验:GET 仅凭 transaction_id 即返回 license_code/tier/expires_at。transaction_id 会出现在结账跳转 URL、日志、邮件里,泄露面比激活码更大。
- 修复:查询加买家邮箱匹配 / 短时间窗口 / 一次性 redeem token。

M6. .lic 文件读改写无互斥 + GetLocalLice

pkg/server/license.go:258-261(VerifyLocalLicense 写)、493-496(sync 写)、527-553(缓存)。
- 已核验:VerifyLocalLicense 是「读→改 LastSeenLocalTime→整写」,期间若 doOnlineLicenseSync/激活写入新证书会     last-write-wins 回退;且 VerifyLocalLicen,缓存里的 LastSeenLocalTime永远陈旧;外部删除 .lic 后 GetLocalLicenseInfo(被崩溃上报、snapshot 使用)仍返回过期数据。ForceOnlineLicenseSync 也无可重入去重,启动强制对账 + GUI 手动刷新可能并发触发。
- 修复:加 licenseFileMu 保护读写删;sync 加 in-flight 去重;写盘后同步刷新缓存。

M7. 时钟篡改状态单向锁定,进程内无法恢复

pkg/server/license.go:239-243(检测回拨 → SetClockTampered(true))、599-617、687-694。
- 已核验:全库只有 SetClockTampered(true),没有任何 SetClockTampered(false)(rg 确认)。GetPaidStatus() 在 cachedIsTampered 为真时恒返回 false。一次 NTP 抖动/双系统时钟差/BIOS                                           掉电即永久锁死付费态,时钟恢复也无法复原,etails(chat_limiter)重置时清usage.ClockTampered,与 license.go 内存的 cachedIsTampered 不一致。
- 修复:VerifyLocalLicense 成功(时钟已正常)或激活成功时把 tampered 复位 false。                                
M8. Wails 绑定方法内同步阻塞网络(违反项目非阻塞规则)

desktop/gui/app.go:1394-1408(RefreshLicenseStatus 同步 ForceOnlineLicenseSync,HTTP 10s)、1377-1383(ActivateLicense 20s)。
- 已核验:这些是 Wails 绑定方法,在主线程同步发网络请求,违反 CLAUDE.md「Wails 核心交互主线程禁止同步阻塞 network HTTP」,可能卡死 GUI / context deadline e
- 修复:改后台 goroutine 异步 + 内存缓存 + RegisterPaidStatusCallback 回推,主线程微秒返回。

M9. 解绑配额计数竞态(非原子)

cloudflare/eqt-drm-api/src/routes/portal.ts:367-401。
- 已核验:SELECT COUNT(unbind_records) → DELETE activation → INSERT unbind_record 三步无事务,并发两笔可突破 MAX_YEARLY_UNBINDS(4);INSERT 失败还会出现「activation 已删但无记录」。

 信任私网 + 空 Origin 放行)

cmd/desktop_agent.go:578-616。
- 已核验:trustedDesktopAgentLocalHost 信任 ip.IsPrivate()(192.168.x/10.x/172.16-31.x),且 origin=="" 直接放行。局域网任意网页(托管在局域网设备上)可 fetch('http://127.0.0.1:PORT/reset-license', POST) 触发本地解绑(DoS);handleResetLicense 甚至不解析 body 最易触发。

---
🟢 低危 / 待确认

- L1 App.SetPaidStatus 暴露在 Wails 绑定(app.go:1368、App.d.ts:87),WebView 内脚本可强制付费态,生产应移除或
gate。
- L2 激活码明文写入日志:App.ActivateLicense 打 code=%s(app.go:1378)、Dev 面板回显完整码(main.js:4699)。
- L3 handleActivate 一切错误统一 400 且透传服务端错误文本(cmd/desktop_agent.go:908-912),无法区分网络失败/码无效/设备上限。
- L4 激活码随机段:admin 铸码 6 字节(12 h^6,主键冲突无重试;校验位用 MD5本身是坏味道(即便换成 SHA 也是非加密校验位)。
- L5 响应明文返回 buyer_email(drm.ts:681/854),持码可读买家邮箱(PII)。
- L6 前端 loadLicense() 在 render 路径隐式写 state(违反 render 纯函数规则);resetLicense 无防重入双击会并发两次;redeemSecret='EQT-LOCAL-2026-V1' 硬编码死代码。
- L7 activate 不校验 ExpiresAt/VerifySignature(license.go:340-347),若服务端返回缺 verify_signature 会「激活成功→重启变免费」;doOnlineLicenseSync 写盘前无 MkdirAll 且忽略写错误。

---
建议修复优先级

1. B1(MD5 → SHA-256)—— 不修则购买永远铸
2. H1(单指纹 OR 绕过上限)+ H3(单指纹扣名额不落盘)—— 统一「≥2 项非空匹配」口径。
3. H2/L1(下线 /set-paid-status 与 App.Se
4. M1(GUI 解绑接通服务端 unbind)—— 这是「解绑」链路的核心断点。
5. M2/M5/M3/M4 —— 门户登录表、license-query 鉴权、退款复活、续费幂等。
6. M6/M7/M8/M9/M10 —— 并发/缓存/时钟/非阻塞/CSRF 健壮性。