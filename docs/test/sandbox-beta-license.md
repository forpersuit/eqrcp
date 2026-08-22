# Sandbox Beta 测试版许可证约束方案

> 设计与技术契约。目标：用 **email + device_id 白名单与硬件指纹门禁** 约束测试版程序的可运行环境，实现「登记才可激活、绑定设备专属运行、删除登记实时阻断、标准生命周期管理」。
> 涉及模块：`eqt-drm-api`（Worker 激活/校验/签发）、`eqt-admin`（白名单与在线设备管理 UI）。

---

## 1. 背景与目标

测试软件允许任意安装使用：未兑换即 free 模式，打开 eqt 产生设备指纹并完成免费匿名注册，获得**服务端权威 device_id**（持久化在 `device_id.dat`）。用户在 admin sandbox 登记自己的 device_id + email 后：

1. **只有白名单内的 email 可以激活测试码**（不登记 → 不能激活）。
2. **激活码只能在其绑定的 device 上使用**（device 不匹配 → 不能激活）。
3. **admin 删除某 device 的登记 → 该 device 立即失去激活/续期能力**（实时门禁）。
4. **测试激活码遵循标准生命周期**：默认 30 天或由管理员按需指定时长，到期客户端证书自动失效；离线场景由 7 天 lease 兜底。
5. **管理后台实时监控与即时控制**：管理员可查阅绑定设备的激活时间、最近活跃时间（`last_seen_at`）、IP 及地理位置，随时可一键吊销或删除白名单。

---

## 2. 核心架构与技术实现

### 2.1 白名单表 `sandbox_beta_testers`

- **字段**：`id, device_id, email, notes, status(默认 active), created_at`
- **索引**：
  - `idx_beta_email` **UNIQUE**：保证每个测试邮箱只有一条生效记录。
  - `idx_beta_device` **普通索引**：允许一个测试设备关联多个测试邮箱场景。
- **UPSERT 与覆盖更新**：添加已存在邮箱时自动更新其关联的 `device_id` 和 `notes`，支持传递空值解绑设备。

### 2.2 门禁判定 gate (`needsSandboxConstraint`)

对激活/校验请求，满足以下任一即需执行 sandbox 约束：

```ts
function needsSandboxConstraint(licenseSource: string, env: Env, url?: URL): boolean {
  return licenseSource === "test" || isTestEnvironment(env, url);
}
```

- `licenseSource === 'test'`：test 码在**任何**环境都受白名单与绑定设备约束（即使在生产环境也无法跨越白名单）。
- `isTestEnvironment`：test 环境内**所有**码受白名单约束（覆盖 Paddle sandbox 测试购买码）。

### 2.3 白名单实时校验 (`assertSandboxTesterAllowed`)

以白名单为运行时权威准入依据：

```
查询: SELECT * FROM sandbox_beta_testers WHERE LOWER(email) = LOWER(license.buyer_email) AND status = 'active'
1. buyer_email 为空                 → 403 (无登记邮箱)
2. 白名单查无此 email               → 403 (未登记测试资格)
3. 命中记录的 device_id 为空         → 403 (登记未绑定设备, email-only 条目不可用于激活)
4. 权威 device_id ≠ 记录.device_id   → 403 (测试码仅限授权测试设备)
5. 全部通过                         → 允许激活 / 验证
```

- **防篡改**：比对所用的是由服务端基于硬件指纹计算出的 `authoritativeDeviceId`，绝不信任客户端自报的 `device_id` 参数。
- **全局拦截**：白名单校验位于 `/api/v1/activate`（分支外）与 `/api/v1/verify` 统一路径，删除白名单后，下一次激活或心跳验证立即 403 阻断。

### 2.4 签发与生命周期管理 (`mint-test-license`)

- **先登记后签发**：`POST /api/v1/admin/sandbox/mint-test-license` 强制校验 `sandbox_beta_testers` 存在对应的 `(device_id, LOWER(email), status='active')` 记录。
- **标准生命周期**：默认签发 `expires_in_days: 30, duration_days: 30`，客户端证书在 `expires_at` 到期后离线自动失效。

---

## 3. 接口规范

### 3.1 获取白名单列表
```http
GET /api/v1/admin/sandbox/testers
```
- **鉴权**：Cloudflare Access JWT (生产) 或 Admin Token (测试)。在生产环境自动返回 403 `SANDBOX_ONLY`。
- **响应**：`{ success: true, testers: [{ id, device_id, email, notes, status, created_at }] }`

### 3.2 登记 / 更新测试资格 (UPSERT)
```http
POST /api/v1/admin/sandbox/testers
Content-Type: application/json

{
  "device_id": "b0036718cb9a469999d2910cdf418b1f",
  "email": "tmp@301098.xyz",
  "notes": "Core QA machine"
}
```
- **更新语义**：若 `email` 已存在，执行 UPDATE 更新 `device_id`（传空值可清空）与 `notes`，返回 `{ success: true, id, updated: true }`。

### 3.3 删除测试资格
```http
DELETE /api/v1/admin/sandbox/testers/:id
```
- **响应**：`{ success: true, deleted_id: 123 }`（若 ID 不存在返回 404）。

### 3.4 签发测试激活码
```http
POST /api/v1/admin/sandbox/mint-test-license
Content-Type: application/json

{
  "device_id": "b0036718cb9a469999d2910cdf418b1f",
  "email": "tmp@301098.xyz",
  "tier": "PLUS",
  "expires_in_days": 30,
  "duration_days": 30
}
```
- **响应**：`{ success: true, license_code: "EQT-TEST-PLUS-...", bound_device_id, buyer_email, expires_at, duration_days }`

---

## 4. 安全与残余风险应对

1. **离线已激活设备**：管理员删除白名单后，新激活与下一次在线 verify 立即失效；若设备长期完全断网，由客户端 7 天离线 Lease 强制兜底收回权限。
2. **硬件伪造攻击防御**：攻击者若试图盗用白名单中的公开 `device_id`，但其硬件指纹不符时，服务端权威设备注册模块计算出的 `authoritativeDeviceId` 不匹配，直接抛出 403 拒绝激活。
3. **生产环境硬隔离**：所有 `/sandbox/*` 端点及 `source='test'` 发码在生产环境均通过 `isTestEnvironment` 严格阻断（403 `SANDBOX_ONLY`）。
