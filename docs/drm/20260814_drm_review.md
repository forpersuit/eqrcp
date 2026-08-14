# EQT DRM 工程深度审查报告

> 审查日期：2026-08-14
> 审查方式：静态代码审查（只读，未改动任何源码）
> 审查范围：Cloudflare Workers 后端 `cloudflare/eqt-drm-api`（D1/R2/Paddle/Admin/Portal）、Go 客户端 `pkg/server`（license/hardware/chat_limiter）、Wails 桌面端授权链路，以及三者之间的上下游契约
> 交叉比对基准：`.agents/skills/eqt-drm/SKILL.md`（权威规范 SSOT）、`schema.sql`（表结构 SSOT）、`docs/portal/`、`docs/deploy/`

---

## 0. 结论编号约定

| 系列 | 含义 |
|------|------|
| **A 系列** | 早期审计已发现的问题，本次对其中的 **A1 / A2** 做深挖（其余 A 项已在上一轮审查中汇报，不在本文重复） |
| **D 系列** | 本次深挖过程中**新发现**的问题（D1–D6） |

本文聚焦「需要深挖」的主题：**A1、A2** 以及新发现的 **D1–D6**，每条均给出 `file:line` 证据链、复现路径、影响面与修复建议，并在第 9 节给出严重度排序与修复优先级。

---

## 1. 深挖 A1 —— `auto_renew` 列迁移顺序缺陷（严重度：高）

### 1.1 一句话结论

`licenses.auto_renew` 这一列**既不在 `schema.sql` 里，也不在任何运行时建表/迁移函数里被创建**；它只能由 `portal.ts` 内部一个**私有**函数 `ensureAutoRenewColumn` 按需补列。而 Paddle Webhook 处理器（`paddle.ts`）直接读写 `auto_renew` 却**从未调用该补列函数**，因此在「用户从未打开过 Portal」的场景下，`subscription.canceled` / `subscription.updated` Webhook 会因 `no such column: auto_renew` 抛错并返回 500。

### 1.2 证据链（file:line）

`auto_renew` 这一列的「出生证明」只有一处：

- `src/routes/portal.ts:74-87` —— `async function ensureAutoRenewColumn(env)`，**未加 `export`（私有）**，核心语句：
  - `portal.ts:77`：`ALTER TABLE licenses ADD COLUMN auto_renew INTEGER DEFAULT 1`

它只在两条 Portal 路由里被调用：

- `portal.ts:99`（`GET /api/v1/user/licenses` 列表查询入口）
- `portal.ts:539`（`POST /api/v1/user/toggle-auto-renew` 切换自动续费入口）

而权威 schema 与运行时建表**都没有**这一列：

- `schema.sql:6-22`（`licenses` 建表语句）—— 无 `auto_renew` 列
- `src/utils/auth.ts:213-230`（`ensureDrmTables` 中 `licenses` 的 `CREATE TABLE IF NOT EXISTS`）—— 无 `auto_renew` 列

但 Paddle Webhook 却在**没有补列保护**的情况下直接写这一列：

- `src/routes/paddle.ts:750`（`subscription.canceled` 处理器）：
  `UPDATE licenses SET auto_renew = 0 WHERE paddle_subscription_id = ?`
- `src/routes/paddle.ts:804` / `:805`（`subscription.updated` 恢复续费分支）：
  `UPDATE licenses SET ... auto_renew = 1 ... WHERE paddle_subscription_id = ?`

关键：`paddle.ts` 的 import（`paddle.ts:11`）只引入了 `ensureLicensePaddleTxnIndex` 与 `ensureLicenseSourceColumns`，**没有** `ensureAutoRenewColumn`。且该函数是私有函数，`paddle.ts` 想调用也无法跨模块访问。

### 1.3 触发路径 / 复现

```
用户通过 Paddle 订阅付费（transaction.completed 触发 mint，licenses 行建立，含 paddle_subscription_id）
   → 用户从未打开 Portal（不触发 portal.ts:99/539，auto_renew 列不存在）
   → Paddle 侧发生取消/停续（用户在 Paddle 自助门户取消，或扣款失败自动停续）
   → subscription.canceled Webhook 到达 paddle.ts:750
   → UPDATE licenses SET auto_renew = 0 ... → SQLite: no such column: auto_renew
   → 抛错 → Webhook 返回 500 → Paddle 进入重试风暴
```

**注意这不是「只有本地/测试库才踩」的问题**：因为 `schema.sql` 本身也没有 `auto_renew`（需要 Portal 首次访问才动态补列），所以**生产 D1 同样处于「列可能不存在」的叠加态**——是否踩雷取决于「用户是否先访问过 Portal」这一时序。

### 1.4 影响

1. **订阅取消/恢复链路可能 500**，自动续费状态无法落库，`auto_renew` 与 Paddle 侧真实状态脱节。
2. 叠加 `d1-retry` 的 `isRetryableD1Error` 对 `no such column` 采取 **fail-fast 不重试**（见 `src/utils/d1-retry.ts`，`syntax error` 类错误直接终止），问题不会通过重试自愈。
3. `src/index.ts:111-120` 的全局兜底会把它记成 `SERVER_EXCEPTION` CRITICAL 并触发 Telegram 告警，造成运维噪音、掩盖真正故障。

### 1.5 修复建议

1. **把 `auto_renew INTEGER DEFAULT 1` 补进权威 schema**（`schema.sql` 的 `licenses` 表）与 `ensureDrmTables` 的 `licenses` 建表语句，让列成为「一等公民」。
2. **把 `ensureAutoRenewColumn` 提升为 `src/utils/auth.ts` 的导出函数**，并在 `paddle.ts` 的 `subscription.canceled` / `subscription.updated` 处理器入口处（与 `ensureLicenseSourceColumns` 同位置）调用一次。
3. 建议为所有 `ensure*` 迁移函数建立一份「列清单 ↔ schema.sql」的对照测试（见 D1），从机制上杜绝此类漂移复发。

---

## 2. 深挖 A2 —— `subscription.canceled` 忽略 `effective_from` 语义（严重度：中高）

### 2.1 一句话结论

`paddle.ts` 的 `subscription.canceled` 处理器把**所有**取消事件一律当成「关掉自动续费、本期权益保留到 `expires_at`」处理，**不区分** Paddle 的 `effective_from`（`next_billing_period` vs `immediately`）。这与 Portal 侧主动取消（`effective_from: "immediately"` + 本地即时吊销）的语义不一致，导致「立即生效」的取消（如拒付、欺诈、用户立即取消）仍会保留付费权益直到期末。

### 2.2 证据链（file:line）

- `src/routes/paddle.ts:747-750`（`subscription.canceled` 分支）注释明确写着：
  > `// 1. Just turning off auto-renewal: DO NOT revoke active period, set auto_renew = 0`
  随后执行 `UPDATE licenses SET auto_renew = 0 ...`，**没有读取/分支 `effective_from`**。
- `src/routes/paddle.ts:743-835` 整段 `subscription.canceled` / `subscription.updated` 逻辑均未出现 `effective_from` 判断。
- 对照 Portal 侧自服务取消：
  - `src/routes/portal.ts:642-810`（`POST /api/v1/user/cancel-subscription`）：调用 Paddle 时显式传 `effective_from: "immediately"`，并在本地同步 `revoke`（立即吊销）。
  - `src/routes/portal.ts:537-639`（`toggle-auto-renew`）：调用 Paddle 时传 `effective_from: "next_billing_period"`（仅停续、保留本期）。

也就是说：**用户从 Portal 主动取消 → 立即吊销；而 Paddle 侧主动发来的 `immediately` 取消 → 仍然保留权益**。两条路径对「立即取消」的处理相反。

### 2.3 触发路径 / 复现

```
用户订阅年付（本期已扣款，licenses.expires_at = 下一年）
   → Paddle 侧发生 effective_from = immediately 的取消（拒付 chargeback / 欺诈风控 / 用户在 Paddle 自助门户选立即取消）
   → subscription.canceled Webhook 到达 paddle.ts
   → 当前代码只置 auto_renew=0，licenses.status 仍为 'active'，expires_at 不变
   → 用户在本期剩余时间内仍可正常 verify / activate，继续享有付费权益
```

### 2.4 影响

1. **超额授权（over-grant）**：立即生效的取消（尤其是拒付/欺诈）未即时吊销，用户可继续使用付费功能至期末。
2. **反滥用计数失真**：拒付/欺诈本应进入 `revoke` + abuse-window 计数（`blacklist.ts` 的滚动 365 天 ≥3 次拉黑），但因走了「只关续费」分支而未落 `revoked_at`/`revoke_reason`，绕过退款滥用黑名单。
3. **客户端在线对账无法感知吊销**：`.lic` 对账（`/verify`）看到 `status='active'`，不会触发 `ResetLicense()`。

### 2.5 修复建议

1. 在 `subscription.canceled` 处理器中读取 `data.effective_from`（Paddle 字段），分支处理：
   - `next_billing_period` → 仅 `auto_renew = 0`，保留本期（现状，正确）。
   - `immediately` → 走与 Portal 一致的本地 `revokeLicenseSql` 吊销路径，并正确写入 `revoke_reason`（如 `subscription` / `chargeback`），纳入 abuse-window 计数。
2. 补充订阅取消/恢复的离线单测（`tests/verify-subscription-cancel.js` 已有 `npm run test:subscription:offline`，应扩展覆盖 `effective_from=immediately` 分支）。

---

## 3. 新增 D1 —— 运行时建表与 `schema.sql` 漂移：`activations.trace_id` 无运行时保障（严重度：中）

### 3.1 一句话结论

`ensureDrmTables`（运行时兜底建表）的 `activations` 建表语句**漏掉了 `trace_id` 列**，而 `/activate` 的 INSERT 又**硬编码写入了 `trace_id`**。任何「未先执行 `schema.sql`、靠运行时建表」的 D1（本地 `wrangler dev`、新测试库、误部署的裸库）都会在激活时 `no such column: trace_id` 失败。这暴露了「运行时迁移函数」与「schema.sql SSOT」之间缺乏一致性校验的机制性风险。

### 3.2 证据链（file:line）

- `schema.sql:39`：`activations` 表含 `trace_id TEXT DEFAULT NULL`（权威 schema 有）。
- `src/utils/auth.ts:231-241`：`ensureDrmTables` 中的 `activations` `CREATE TABLE IF NOT EXISTS` **没有 `trace_id`**（只有 `id/license_code/uuid_hash/cpu_hash/disk_hash/device_id/activated_at`）。
- `src/utils/auth.ts:58-84`：`ensureActivationNetworkColumns` 补了 `client_ip/ip_country/user_agent/city/region/latitude/longitude`，**同样没有 `trace_id`**。
- `src/routes/drm.ts:518`：`/activate` 的 INSERT 列清单明确包含 `trace_id`。

（对照：`system_error_logs.trace_id` 是**有**运行时保障的 —— `src/utils/error-logger.ts:97` 与 `src/routes/crash-report.ts:115` 各自做了幂等 `ALTER TABLE system_error_logs ADD COLUMN trace_id`。唯独 `activations.trace_id` 没有对应保障。）

### 3.3 触发路径 / 复现

```
新建一个 D1（未跑 npm run db:init:remote --file=schema.sql）
   → 首次请求命中 requireAdminAuth → utils/auth.ts:431/443 调用 ensureDrmTables
   → activations 表被按 231-241 的「缩水版」创建（无 trace_id）
   → 客户端 POST /api/v1/activate
   → drm.ts:518 INSERT ... trace_id ... → no such column: trace_id → 500
```

### 3.4 影响

1. **本地/测试环境激活直接失败**，误导开发者误判为业务逻辑问题。
2. **机制性隐患**：`ensureDrmTables` 与 `schema.sql` 是两套并行的 schema 来源，缺少 diff 校验，未来任何列的新增都可能重演「一边有、一边没有」的漂移。
3. 生产环境因按 `schema.sql` 部署而不受影响，但依赖「人工记得跑 migration」而非「代码自洽」，违背 `schema.sql` 作为 SSOT 的初衷。

### 3.5 修复建议

1. 将 `activations.trace_id` 补进 `ensureActivationNetworkColumns`（或新建 `ensureActivationTraceIdColumn`），与网络列同等幂等处理。
2. 更彻底：为「`ensureDrmTables` 建表 SQL ↔ `schema.sql`」建立一条自动化 diff 测试（解析两边列清单做集合对比），从机制上锁死漂移。现有 `npm run test:schema-cache:offline` 可扩展为此类断言。

---

## 4. 新增 D2 —— 客户端 verify 对账不发送 `device_id`，服务端硬件漂移容忍成死分支（严重度：中）

### 4.1 一句话结论

服务端 `/verify` 提供了一条「`device_id` 匹配 + 至少 1 项指纹匹配」的硬件漂移容忍分支（专门用于用户换了 2 项硬件、只剩 1 项指纹可对的场景）。但 Go 客户端的在线对账 `doOnlineLicenseSync` 构造的 verify 请求体**从不携带 `device_id`**，导致这条容忍分支对客户端对账路径**永远不可达**。

### 4.2 证据链（file:line）

- 服务端 `src/routes/drm.ts:816-817`：
  ```ts
  // Hardware drift tolerance: device_id matches AND at least 1 fingerprint matches
  if ((body as any).device_id && act.device_id && act.device_id === (body as any).device_id) {
  ```
  依赖 `body.device_id` 才能放宽匹配（`drm.ts:807` 的 `countMatchingFingerprints(...) >= 2` 之外再叠加 device_id 兜底）。
- 客户端 `pkg/server/license.go:466-473`（`doOnlineLicenseSync`）请求体只含：
  ```go
  reqBody, _ := json.Marshal(map[string]string{
      "license_code": cert.LicenseCode,
      "uuid_hash":    uuid,
      "cpu_hash":     cpu,
      "disk_hash":    disk,
      "app_version":  version.Version(),
  })
  ```
  —— **无 `device_id` 字段**。

### 4.3 触发路径 / 复现

```
用户在设备 A 激活（服务端 activations 落盘 device_id + 3 项指纹）
   → 用户升级硬件，换掉主板 + CPU，只保留系统盘（3 项指纹只剩 disk 匹配）
   → 激活 /activate 路径可借 device_id 识别同一设备（drm.ts:573 等）
   → 但后台静默对账 doOnlineLicenseSync → /verify
   → body 无 device_id → countMatchingFingerprints 只有 1 项 → <2 → 判定设备不符
   → 服务端返回 403/404 → 客户端 ResetLicense() 降级为免费版
```

结果是「激活能通过、对账却把授权洗掉」的**状态抖振**：硬件升级用户会在 12 小时节流后的下一次后台对账被错误降级。

### 4.4 影响

1. 服务端花力气实现的硬件漂移容忍在**客户端主路径**（对账）上失效，只有 `device_id` 恰好能通过其它途径（如匿名注册缓存）传上来时才能生效，而 `doOnlineLicenseSync` 明确没传。
2. 硬件升级用户遭受「被服务端错误降级」的体验与信任损失。
3. 客户端本就有权威 `device_id` 可用（`hardware.go:354-364` `GetAuthorityDeviceID()` / `.lic` 中的 `DeviceID`），却未在 verify 请求中透出，属契约不对称。

### 4.5 修复建议

1. 客户端 `doOnlineLicenseSync` 的请求体补充 `device_id`（来源 `cert.DeviceID`，其次 `GetAuthorityDeviceID()`），与服务端 `drm.ts:816` 的容忍分支对齐。
2. 在离线单测中新增「换 2 项硬件、保留 device_id 对账应成功」的用例，锁定该契约。

---

## 5. 新增 D3 —— 设备指纹匹配器语义不一致：device-registry 严格全匹配 vs 黑名单 3选2（严重度：中高）

### 5.1 一句话结论

`device-registry.ts` 的 `matchRegistryFingerprint` 是**严格全匹配**（任意一个「双方都非空但不相等」的分量即整体失败），而不是 SKILL.md §1 与黑名单模块所规定的 **3选2（允许 1 项非空不一致）**。这会让「换掉 1 项硬件」的同一台物理设备在 `device_registry` 里**被判为新设备、重新分配 device_id**，造成权威设备 ID 漂移与注册表重复行。

### 5.2 证据链（file:line）

- `src/utils/device-registry.ts:36-61` `matchRegistryFingerprint`：
  ```ts
  if (reqU && dbU) { if (reqU !== dbU) return false; compareCount++; }
  if (reqC && dbC) { if (reqC !== dbC) return false; compareCount++; }
  if (reqD && dbD) { if (reqD !== dbD) return false; compareCount++; }
  return compareCount >= 2;
  ```
  关键差异在 `if (reqU !== dbU) return false` —— **任一非空分量不等即提前判负**。
- 对照 `src/utils/blacklist.ts:6-16` `countMatchingFingerprints`：
  ```ts
  if (clientUuid && storedUuid && clientUuid === storedUuid) matches++;
  ...
  ```
  这是**正确的 3选2**（只累加相等项，允许 1 项不同，最后 `>= 2` 判定）。
- 权威规范 `.agents/skills/eqt-drm/SKILL.md` §1 明确：空值跳过、**至少 2 项非空匹配即合法**。

### 5.3 触发路径 / 复现

```
用户激活后，仅更换系统盘（uuid、cpu 不变，disk 变化）
   → activations 表用 3选2（countMatchingFingerprints）仍判为同一设备 → 不新增激活席位
   → 但 device_registry 用严格匹配（matchRegistryFingerprint）→ disk 分量不等 → return false
   → registerOrRefreshDevice 走到 device-registry.ts:162-163 → 生成全新 device_id 并 INSERT
   → 同一物理设备在 device_registry 出现两行；权威 device_id 漂移
   → 后续解绑 / 审计 / 按 device_id 的反滥用命中全部错乱
```

### 5.4 影响

1. **`device_registry` 膨胀**：硬件小改动即产生新注册行，污染「设备 → 授权」映射。
2. **权威 device_id 漂移**：`activations.device_id`（旧）与 `device_registry.device_id`（新）不一致，`drm.ts:816` 的 `device_id` 兜底匹配、解绑闭环、审计追溯都随之失真。
3. **同一套「3选2」业务语义在两个模块被实现成了相反的结果**，违反单一事实来源，是隐蔽的定时炸弹。

### 5.5 修复建议

1. `matchRegistryFingerprint` 改为复用 `blacklist.ts` 的 `countMatchingFingerprints` 语义（允许 1 项非空不一致，`>=2` 判定），删除内部 `return false` 的提前判负。
2. 将「3选2 匹配」抽成单一共享函数（如 `utils/fingerprint.ts`），`blacklist.ts` 与 `device-registry.ts` 统一引用，从根上杜绝语义分叉。

---

## 6. 新增 D4 —— email 明文未规范化，归属校验依赖 hash 兜底（严重度：低）

### 6.1 一句话结论

`licenses.buyer_email`（明文）在 mint 时**未做 trim/lower 规范化**，而归属校验的明文比较路径依赖「session.email 已在登录时被规范化」这一**隐含前置**，一旦未来某条路径写入未经规范的明文，明文匹配会漏；当前功能正确是因为 `buyer_email_hash`（lower+trim 后哈希）做了兜底。属于**一致性脆弱点**而非现行 bug。

### 6.2 证据链（file:line）

- `src/utils/crypto.ts:14-17` `sha256Hex` —— 只做 SHA-256，**不做 lower/trim**。
- `src/routes/paddle.ts` mint 路径：`buyer_email` 存**原始输入**，`buyer_email_hash` 存规范化后哈希（`paddle.ts:288` 处先 `trim().toLowerCase()` 再哈希）。
- `src/utils/crypto.ts:23-32` `licenseOwnedByEmail`：明文分支 `String(license.buyer_email).trim().toLowerCase() === norm` 会自行规范化，但 **hash 分支直接比较传入的 `emailHash`**。
- 调用方（如 `portal.ts`）传入的 `emailHash` 是由 `session.email` 直接 `sha256Hex` 得来；`session.email` 的规范化发生在 `routes/auth.ts` 登录发码阶段（`auth.ts:213/217` 处 `email.trim().toLowerCase()`）。
- 因此链路成立的前提是：**`session.email` 永远在写入时就已 lower**。这一前提是隐式约定，未被任何断言保护。

### 6.3 影响

当前无实际故障。风险在于未来改动（例如某条路径用原始输入直接写 `buyer_email`、或改用未经 lower 的来源构造 `emailHash`）会静默破坏归属校验，导致 Portal 查不到自己的 license（`not_license_owner` 403）。

### 6.4 修复建议

1. 在 `sha256Hex` 上层提供统一入口 `emailHash(email)`（内部 `trim().toLowerCase()` 后哈希），所有 `buyer_email_hash` 的产生与比对都走它，消灭「调用方记得/不记得 lower」的分歧。
2. 在 mint 写入时对 `buyer_email` 明文同样做 `trim().toLowerCase()`，与 `buyer_email_hash` 对齐。

---

## 7. 新增 D5 —— OTP 失败计数复用 `verification_codes` 表，语义双载（严重度：低）

### 7.1 一句话结论

OTP 登录的「校验失败计数」并非独立表，而是**复用 `verification_codes` 表**，用 `email` 列存 `fail:{purpose}:{ip}:{email}` 键、`code` 列存失败次数、`created_at` 存窗口起点。功能可用，但 `code` 列被赋予「6 位验证码 / 失败次数」两套语义，且计数键含 IP，可维护性与可审计性差。

### 7.2 证据链（file:line）

- `src/routes/auth.ts:26-29`：`otpFailStorageKey` 生成 `fail:{purpose}:{ip}:{email}`。
- `src/routes/auth.ts:31-40` `isOtpVerifyBlocked`：读 `code` 列当失败次数，`created_at` 当窗口起点。
- `src/routes/auth.ts:42-64` `recordOtpVerifyFail`：`INSERT OR REPLACE ... code = String(fails)`。
- `src/routes/auth.ts:66-68` `clearOtpVerifyFails`：`DELETE WHERE email = failKey`。

### 7.3 影响

1. **语义双载**：`verification_codes.code` 同时承载「验证码」与「失败计数」，任何误操作（如对 `fail:` 前缀行误读为验证码）都会产生混乱，审计/调试成本高。
2. **IP 参与计数键**：用户切换 IP（移动网络/代理）即可重置失败计数窗口，弱化了防爆破强度（但 60s 发码冷却与黑名单仍兜底）。
3. 正常验证码行（`portal:{email}` / `checkout:{email}`）与失败行（`fail:...`）混在同一张表，删除逻辑需靠前缀字符串区分，脆弱。

### 7.4 修复建议

1. 为 OTP 失败计数建独立表（如 `otp_fail_counters(purpose, ip, email, fails, window_start)`），与验证码生命周期彻底解耦。
2. 若短期不动表，至少在注释/类型上显式标注 `code` 列的「验证码/失败计数」双语义，并考虑失败计数键去掉 IP 或改用更稳定的维度（如 email + 租户）以提升抗绕过。

---

## 8. 新增 D6 —— `detectBuyerLang` 将加拿大（CA）误判为法语（严重度：低）

### 8.1 一句话结论

买家语言探测把 `CA`（加拿大）归入法语阵营，但加拿大英语人口占多数，加拿大用户会收到法语邮件。

### 8.2 证据链（file:line）

- `src/routes/paddle.ts:16-30` `detectBuyerLang`：
  ```ts
  if (['FR', 'BE', 'CA'].includes(country)) return 'fr';
  ```
  `CA` 与法国、比利时一同映射为 `fr`。

### 8.3 影响

加拿大（英语区）买家收到的激活码/结账邮件为法语，本地化体验错误。仅影响邮件语种，不影响业务正确性。

### 8.4 修复建议

1. 将 `CA` 从法语列表移除（默认落入 `en`），或更精确地按 `address.postal_code`（魁北克省）判断法语，其余加拿大地区回退英语。
2. 若 Paddle 回传的 `country_code` 粒度不足以区分魁北克，最稳妥是 `CA → en`（默认英语）。

---

## 9. 严重度排序与修复优先级总表

| 优先级 | 编号 | 主题 | 严重度 | 位置 | 核心风险 |
|:---:|:---:|------|:---:|------|------|
| P0 | A1 | `auto_renew` 列迁移顺序缺陷 | 高 | `portal.ts:74/99/539`、`paddle.ts:750/804`、`schema.sql` | 订阅取消/恢复 Webhook 500，续费状态丢失 |
| P1 | D3 | 指纹匹配器语义不一致 | 中高 | `device-registry.ts:36-61` vs `blacklist.ts:6-16` | 换 1 项硬件即漂移 device_id，注册表污染 |
| P1 | A2 | `subscription.canceled` 忽略 `effective_from` | 中高 | `paddle.ts:743-835` vs `portal.ts:642-810` | 立即取消不吊销，超额授权、绕滥用计数 |
| P2 | D2 | verify 不传 `device_id`，漂移容忍死分支 | 中 | `license.go:466-473`、`drm.ts:816-817` | 硬件升级用户对账被错误降级 |
| P2 | D1 | 运行时建表与 `schema.sql` 漂移 | 中 | `auth.ts:231-241`、`drm.ts:518`、`schema.sql:39` | 裸库激活 `no such column: trace_id` |
| P3 | D6 | CA 误判法语 | 低 | `paddle.ts:28` | 加拿大英语用户收法语邮件 |
| P3 | D4 | email 明文未规范化 | 低 | `crypto.ts:14-17`、`paddle.ts` mint | 依赖隐式 lower 约定，归属校验脆弱 |
| P3 | D5 | OTP 失败计数复用验证码表 | 低 | `routes/auth.ts:26-68` | 语义双载，IP 键可被换 IP 重置 |

---

## 10. 修复建议汇总（按优先级）

1. **P0（A1）**：`auto_renew` 进 `schema.sql` + `ensureDrmTables`；`ensureAutoRenewColumn` 导出并在 `paddle.ts` webhook 入口调用。
2. **P1（D3）**：`matchRegistryFingerprint` 改为 3选2，与 `countMatchingFingerprints` 统一到单一共享函数。
3. **P1（A2）**：`subscription.canceled` 分支读取 `effective_from`，`immediately` 走本地吊销 + abuse 计数。
4. **P2（D2）**：客户端 `doOnlineLicenseSync` 请求体补 `device_id`。
5. **P2（D1）**：`activations.trace_id` 补运行时保障；建立 `ensureDrmTables ↔ schema.sql` diff 测试。
6. **P3（D4/D5/D6）**：统一 `emailHash()` 入口；OTP 失败计数独立成表或显式标注；`CA → en`。

---

## 附录：审查方法与范围边界

- **方法**：逐文件静态审查 + 跨文件交叉比对（客户端请求契约 ↔ 服务端处理契约、`schema.sql` ↔ 运行时迁移、SKILL.md 规范 ↔ 实际实现），每条结论均落到 `file:line`。
- **未覆盖**：未执行运行时/线上流量实测，Paddle `effective_from` 等外部字段的精确取值以 Paddle 官方文档为准，建议在沙箱环境按第 2 节建议补齐 `effective_from=immediately` 的闭环验证。
- **声明**：本次为只读审查，未修改任何源码；本报告即为交付物。
