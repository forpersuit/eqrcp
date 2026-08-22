# Sandbox Beta 测试版许可证约束方案

> 设计 + 开发计划。目标:用 **email + device_id 白名单** 约束测试版程序的可运行环境,实现「登记才可激活、删除登记即无法激活、测试码统一 8 天有效」。
> 涉及模块:`eqt-drm-api`(Worker 激活/校验/签发)、`eqt-admin`(白名单管理 UI 已就绪)。

---

## 1. 背景与目标

测试软件允许任意安装使用:未兑换即 free 模式,打开 eqt 自然产生设备指纹并完成免费匿名注册,获得**服务端权威 device_id**(持久化在 `device_id.dat`)。用户在 admin sandbox 登记自己的 device_id + email 后:

1. **只有白名单内的 email 可以激活测试码**(不登记 → 不能激活)。
2. **激活码只能在其绑定的 device 上使用**(device 不匹配 → 不能激活)。
3. **admin 删除某 device 的登记 → 该 device 立即失去激活/续期能力**。
4. **测试码统一最长 8 天有效**(不管码本身显示 LIFETIME 还是几天)。
5. 不限制购买次数、码不支持续期、不做个人化 —— 均接受,理由:码被 device 绑定,外泄影响有限。

**残余风险(已接受)**:完全复制整机硬件环境+已激活证书的克隆机。删除白名单可阻止克隆机再次激活;离线场景由 7 天 lease 兜底。

---

## 2. 现状盘点(已验证的事实)

### 2.1 白名单表 `sandbox_beta_testers`(auth.ts)
- 字段:`device_id, email, notes, status(默认 active), created_at`
- 索引:`idx_beta_device` **UNIQUE** on device_id、`idx_beta_email` **UNIQUE** on email
- **问题 A**:device 唯一索引禁止「一个 device 搭配多个 email」—— 与用户需求冲突,需降级为普通索引。
- **问题 B**:seed 数据是「device-only / email-only」分离记录,语义模糊,需改为 device+email 成对记录。
- 该表目前在激活路径 **从不被查询**(装饰性)。

### 2.2 激活路径 `/api/v1/activate`(drm.ts:335-719)
- 校验链:`status active → 限流 → 黑名单 → expires(基于 expires_at)→ pending upgrade → 已激活检测(isAlreadyActivated)→ [!isAlreadyActivated 分支] registerOrRefreshDevice 拿 authoritativeDeviceId → bound_device_id 校验(516-526)→ max_devices → INSERT activation → 签名响应(finalExpiresAt)`。
- **问题 C**:`bound_device_id` 校验(516-526)只在 `!isAlreadyActivated` 分支内 → 已激活设备重装(指纹匹配)会跳过;且删除白名单不会让已签发码失效 —— 无法实现「删除即失效」。
- **问题 D**:激活响应/本地证书的 `expires_at` 取自 `baseExpiresAt`(默认 license.expires_at,购买码可能 LIFETIME)→ 无 8 天上限。

### 2.3 校验入口 `/api/v1/verify`(drm.ts:722-920)
- 已激活设备在线续期走这里,签名续期同样用 `baseExpiresAt`(896)。
- **问题 E**:若只在 activate 收紧 8 天,verify 会把有效期续回 LIFETIME,绕过约束 —— 8 天上限必须两处同时生效。

### 2.4 签发入口(admin.ts)
- `mint-test-license`(1335):强制 device_id+email;**expDays 默认 7 可被 body 覆盖**;插入 license(`source='test'`, `bound_device_id=deviceId`, `buyer_email=email`)。未校验白名单存在。
- `generate-license source='test'`(166):已 gate 在 test 环境;要求 expires_in_days。
- Paddle sandbox 购买(paddle.ts):`source='purchase'`,写 `buyer_email`,expires_at 由 Paddle 产品决定(LIFETIME/订阅期),**无 device 绑定**。

### 2.5 环境判定
- `isTestEnvironment(env, url)`:`ENVIRONMENT==='test'` 或 host 含 `-test.`/`localhost`/`127.0.0.1`。默认(未配置)= 生产,沙箱接口 403。
- `normalizeLicenseSource`:`test` 码 / synthetic 交易 id → `'test'`;真实 paddle id → `'purchase'`。

---

## 3. 方案设计

### 3.1 判定 gate

对激活/校验请求,满足以下任一即需执行 sandbox 约束:

```
needsSandboxConstraint = (licenseSource === 'test') || isTestEnvironment(env, url)
```

- `licenseSource === 'test'`:test 码在**任何**环境都受约束(生产环境拿到 test 码也过不了白名单)。
- `isTestEnvironment`:test 环境内**所有**码受约束(覆盖 Paddle sandbox 测试购买码,不区分 source)。

生产环境普通 purchase/admin/promo 码完全不受影响。

### 3.2 白名单实时校验(替代 bound_device_id)

以白名单为运行时唯一权威:

```
查询:SELECT * FROM sandbox_beta_testers
      WHERE LOWER(email) = LOWER(license.buyer_email) AND status='active'
1. buyer_email 为空            → 403(无登记邮箱)
2. 白名单查无此 email         → 403(未登记测试资格)
3. 命中记录的 device_id 为空   → 403(登记未绑定设备,email-only 条目不可用于激活)
4. 权威 device_id ≠ 记录.device_id → 403(测试码仅限绑定设备)
5. 全部通过                   → 允许
```

要点:
- 用**权威 device_id**(`registerOrRefreshDevice` 按指纹返回)比对,绝不信任请求体里的 `device_id`。
- 校验放在 activate **分支外**(对所有激活请求,含已激活设备重装)与 verify 路径,实现「删除白名单 → 下一跳 activate/verify 即 403」。
- `bound_device_id` 字段继续保留写入(兼容已有数据),但激活校验不再依赖它;白名单查询失败即拒绝,保证删除白名单生效。

### 3.3 8 天硬上限

```
SANDOX_TEST_MS = 8 * 86400 * 1000
hardExpiry = license.created_at + SANDOX_TEST_MS
baseExpiresAt = min(baseExpiresAt, hardExpiry)   // LIFETIME 视为无穷大
```

- 施加在 activate 与 verify 两处、`evaluateLicenseExpiration` 之前:过期时现有 `license_expired` 路径自动 403;未过期则签名证书 `expires_at` 收敛到 8 天,客户端本地 8 天后自动过期,离线由 7 天 lease 兜底(更严)。
- 不修改 licenses 表:8 天是「服务端判定上限」,与码本身 expires_at 取更早者。

### 3.4 签发侧一致性

- `mint-test-license`:**先校验白名单已登记**(device+email 同一条 active 记录),否则 400 —— 强制「先登记后签发」。
- `mint-test-license`:`expires_in_days` **默认 8、上限 8**(`Math.min(Number(body.expires_in_days || 8), 8)`)。
- admin 面板 `Licenses.svelte` 的 per-tester「签发测试码」按钮从已登记行取 device+email,mint 校验天然通过,前端无需改动。

---

## 4. 数据模型变更(auth.ts `ensureBetaTestersTable`)

| 项 | 现 | 改 |
|---|---|---|
| `idx_beta_device` | UNIQUE | 普通索引(迁移:`DROP INDEX IF EXISTS idx_beta_device` 后重建非唯一) |
| `idx_beta_email` | UNIQUE(保留) | 不变(一个 email 一行,email→唯一 device) |
| seed(测试环境) | device-only ×1 + email-only ×2 | 成对记录 ×3:`(b0036718…, tmp@301098.xyz)`、`(b0036718…, anon@301098.xyz)`、`(占位 device, seed@301098.xyz)` |

迁移幂等:每次 ensure 时尝试 drop 旧唯一索引,再创建普通索引。

---

## 5. 代码改动清单

| 文件 | 改动 |
|---|---|
| `src/utils/auth.ts` | 索引降级 + 迁移 + seed 成对 |
| `src/routes/drm.ts` | import `isTestEnvironment`/`ensureBetaTestersTable`;新增 3 个 helper(`needsSandboxConstraint`/`assertSandboxTesterAllowed`/`applySandboxExpiry`);activate 分支外加白名单校验 + 8 天收紧;verify 同;删除 516-526 bound 校验 |
| `src/routes/admin.ts` | mint 前白名单存在校验;expDays 默认 8 上限 8 |
| `package.json` | 1.9.5 → 1.10.0(功能增加,小版本 +1) |
| `tests/verify-sandbox-beta-offline.js` | 更新 seed 断言;新增用例(见 §6) |

无 Go 侧改动(客户端激活请求已携带指纹与 device_id;device_id 由服务端权威判定)。

---

## 6. 测试计划(`verify-sandbox-beta-offline.js`,`node --experimental-sqlite`)

现有 7 组测试保持通过(seed 成对后断言同步微调):
- Test 1 seed 断言;Test 5B mint(成对白名单命中);Test 6 spoofing(权威 ID ≠ 白名单 device → 403);Test 7 合法激活(权威 ID = 白名单 device → 200)。

新增:
- **Test 8 8 天过期**:mint 码后把 `created_at` 拨到 9 天前 → activate → 403 expired;verify 同理。
- **Test 9 删除白名单 → 激活 403**:登记新 device+email → mint 码 → 激活 200 → DELETE 白名单行 → 新指纹再激活 → 403。
- **Test 10 删除白名单 → verify 403**:激活成功后删除白名单 → verify → 403。
- **Test 11 email-only 登记 → 激活 403**:`POST /sandbox/testers`(仅 email)→ generate source=test 码(该 email)→ activate → 403(登记未绑定设备)。
- **Test 12 Paddle 测试购买码(test 环境)**:insert `source='purchase'`, `expires_at='LIFETIME'`, `buyer_email=tmp@` → activate(test 环境)→ 200 且 `expires_at = created_at+8d`。

---

## 7. 边界与残余风险

1. **离线已激活设备**:删除白名单后,新激活/下一次 verify 立即失效;一直离线的撑到 7 天 lease。要「秒级失效」需客户端启动强制在线校验,成本高,不纳入。
2. **首次登记前提**:权威 device_id 来自免费匿名注册(telemetry 开启)。关 telemetry 则 About 显示空、无法登记 → 无法激活 —— 恰好符合「登记才可激活」。
3. **整机复制**:接受为残余风险(见 §1)。
4. **EQT_TESTING 豁免**:运行时若设 `EQT_TESTING=true` 会跳过本地 7 天 lease/时钟回滚;代码内无人 Setenv,由部署环境决定 —— 测试版部署不得设置。
5. **生产库无白名单记录**:test 码在生产环境激活 → 白名单查无 → 403,天然防泄露。

---

## 8. 验收标准(DoD)

- [ ] `go test ./...`(主仓库)与 eqt-drm-api 离线测试全绿,无 silent skip
- [ ] 上述 5 组新增用例全部通过
- [ ] 编译通过(esbuild bundle 无 TS 错误)
- [ ] 提交并推送(`scripts/git-push-smart.sh`),版本 1.10.0
