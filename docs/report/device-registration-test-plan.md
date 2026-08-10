# 设备注册与 DRM 授权系统测试流程与验证规范

> 状态：测试流程规范文档  
> 日期：2026-08-03  
> 关联报告：`docs/report/device-registration-server-side.md`

---

## 1. 概述与测试架构

本测试规范涵盖 EQT 软件设备注册、Ed25519 双版本签名对账、Portal 自助服务、Paddle 订阅生命周期管理（续费、退订不吊销、欠费吊销）以及全闭环 E2E 模拟的自动化验证流程。

系统测试架构包含 4 层验证网格：
1. **Go 侧底层架构单元测试** (`pkg/server/license_test.go`)：验证离线/在线对账、Ed25519 双版本签名格式与结构体契约锁 (`VerifyAPIResponse`)。
2. **Cloudflare D1 与 API 自动化测试** (`cloudflare/eqt-drm-api/tests/`)：针对特定业务路由进行实时 D1 数据库校验与 HTTP 状态断言。
3. **闭环 E2E 仿真测试** (`closed-loop-simulation.js`)：全流程仿真免费注册、付费激活、多设备超卖拦截、解绑与换机激活。
4. **UX / 响应式 Chrome DevTools E2E 仿真** (`.agents/skills/eqt-ux/SKILL.md`)：针对 Frontend View 进行无头/图形化自动化操作。

---

## 2. 自动化测试套件与执行命令

### 2.1 Go 后端核心与单源契约锁测试

运行 Go 语言核心包测试：

```bash
# 运行全仓 Go 单元测试
go test ./...

# 专门测试 DRM 授权与对账契约锁
go test -v ./pkg/server -run TestCrossPlatformContractLock
go test -v ./pkg/server -run TestVerifyLicenseSignature
go test -v ./pkg/server -run TestRegisterDeviceOnlineTelemetryDisabled
```

**验证判定标准**：
- `TestCrossPlatformContractLock` 必须直接 Unmarshal 生产环境导出的 `VerifyAPIResponse` 结构体，确保字段 JSON Tag 无漂移；
- `TestVerifyLicenseSignature` 验证 V2 证书签名（8 字段载荷含 device_id）校验成功，且对 V1 历史签名具备向后兼容解析能力；
- `TestRegisterDeviceOnlineTelemetryDisabled` 验证当 `enableTelemetry` 设为 `false` / `EQT_ENABLE_TELEMETRY=false` 时，启动静默拦截匿名设备注册请求；
- 对账签名（6 字段载荷含 device_id，`VerifySyncSignature`）由 `TestOnlineSyncDeviceIDUpdate` 等在线对账测试覆盖。

---

### 2.2 Cloudflare Workers / D1 API 专项测试

进入 API 测试目录：

```bash
cd cloudflare/eqt-drm-api
```

#### 1. 免费与匿名设备注册测试 (`tests/device-registration-test.js`)
测试匿名设备检查点注册、5分钟写防抖（Write Debouncing）与指纹粗精筛匹配。

```bash
node tests/device-registration-test.js
```

#### 2. 年付自动续订测试 (`tests/verify-yearly-renewal.js`)
测试 Paddle Webhook `transaction.completed` 在 `paddle_subscription_id` 匹配时：不铸造新码、准确原码延长 365 天、保持 `status = 'active'`。

```bash
node tests/verify-yearly-renewal.js
```

#### 3. 订阅退订不吊销与欠费即停测试 (`tests/verify-subscription-cancel.js`)
验证 Section 6.6 补充策略：
- 收到 `subscription.canceled`（主动退订/停用自动续费）时：仅设置 `auto_renew = 0`，卡券在到期日前**绝对保持 `active` 状态**，不发生过度吊销；
- 收到 `past_due` / `paused`（扣款失败/欠费）时：卡券状态更新为 `revoked`，记录 `revoke_reason = 'past_due'`。

```bash
node tests/verify-subscription-cancel.js
```

#### 4. 全闭环 E2E 综合仿真测试 (`tests/closed-loop-simulation.js`)
自动化覆盖 8 大连续真实业务场景：

```bash
node tests/closed-loop-simulation.js
```

**仿真步骤明细**：
1. **Webhook 铸造**：模拟支付成功下发新授权码；
2. **免费注册**：Device A 匿名 Check-in 获取 `device_id`；
3. **在线激活**：Device A 绑定授权码，获取服务端 Ed25519 V2 权威证书；
4. **在线对账**：Device A 启动 sync 续签 7 天租约；
5. **并发激活**：Device B 绑定第二名额；
6. **超卖防御**：Device C 尝试绑定第 3 台设备，触发 HTTP 400 (`max_devices_exceeded`)；
7. **Portal 解绑**：通过邮箱验证码与 Session 在 Self-service Portal 解绑 Device A；
8. **槽位复用**：Device C 重新发起激活成功，顺利占用空出的名额。

---

## 3. 手动 Windows 物理验收与 Hook 部署

每次核心逻辑修改完成后，按仓库 DoD 标准执行手动验收产物导出：

```bash
# 在 WSL / Linux 下执行项目 Hooks 部署与二进制构建
scripts/install-hooks.sh
```

**产物检查项**：
确认生成物已正确写入 `/mnt/e/developer/results` (或 Windows `E:\developer\results`)：
- `eqt.exe` (CLI 命令行可执行文件)
- `eqt-launcher.exe` (无控制台启动器)
- `eqt-desktop.exe` (Wails GUI 桌面客户端)

---

## 4. Git 提交与远程推送标准

完成测试与验证后，依据仓库规范完成工作树清理与推送：

```bash
# 使用 Smart Push 脚本自动探查网络并推送到 GitHub
scripts/git-push-smart.sh
```

**DoD 检查清单**：
- [x] `go test ./...` 100% 通过；
- [x] Node.js API 自动化测试套件 (`closed-loop-simulation.js`, `verify-subscription-cancel.js` 等) 100% 通过；
- [x] 物理构建产物已落盘到 `E:\developer\results`；
- [x] 工作树 Commit 清洁并已推送到 GitHub `master` 分支。
