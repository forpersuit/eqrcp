# EQT 授权找回（License Recovery via Device Register Piggyback）设计分析

> 分析日期：2026-08-27
> 分析方式：基于现有客户端代码（`pkg/server/hardware.go`、`pkg/server/license.go`、`desktop/gui/app.go`）的静态审查 + 本设计文档
> 目的：评估「复用启动时的匿名设备注册请求，捎带回因为本地 `license.lic` 缺失而丢失的已绑定付费授权」这一方案

---

## 0. 结论先行

**方案整体成立，且方向正确。** 它实际上正是「重复激活 / 本地证书丢失后重新拿回授权」这一已有流程缺失的一环。但在按字面实现前，有两处硬伤需要先定夺：

| # | 严重度 | 一句话描述 |
|---|--------|-----------|
| **H1** | 硬伤 | `device/register` 的轻量匿名语义装不下完整授权证书，必须拆分独立通道 |
| **H2** | 硬伤 | 指纹缺失时「3 选 2」门限会把找回静默降级为永久免费，需与服务端判定语义分离 |
| **H3** | 取决于表语义 | 服务端 activations 表存「绑定码」还是「设备清单」，决定找回查询的写法 |
| A1 | 提醒 | 多授权仲裁的 D1 join 需在到期/仅试用场景正确退化为 free |
| A2 | 提醒 | 找回落地必须与 register 的 fail-open 语义隔离，失败不能被吞掉 |
| B1 | 正面确认 | 签名协议与三选二指纹校验复用现有 V2 payload，无需改验签 |

下文先梳理现状（为何这个设计能成立），再逐条展开硬伤、仲裁与热恢复。

---

## 1. 现状梳理：为什么这个设计能成立

### 1.1 客户端没有「本地证书缺失时的找回」路径

`pkg/server/hardware.go` 启动时（`startFingerprintAndLicenseWorkflow`，约 :216-235）：

- 本地存在 `license.lic` → `VerifyLocalLicense()` + `ForceOnlineLicenseSync()`（在线对账，SSOT，用于吊销/解绑）；
- **本地不存在** → `RegisterDeviceOnline()` 匿名注册，仅用于免费版设备打卡 + Dev 权限识别，拿回 `{ device_id, tier, is_dev }`。

问题：若用户在此机器上激活过付费授权，但本地 `.lic` 丢失/损坏/被清理，启动时**只会**走免费注册，付费状态无法自愈。本设计正是补上这一环。

### 1.2 现有签名 + 指纹基础设施已具备

`pkg/server/license.go`：

- `VerifyLicenseSignature`（:64-104）：Ed25519，内置公钥，V2 payload 即
  `license_code|tier|uuid_hash|cpu_hash|disk_hash|device_id|expires_at|max_devices` —— **已经包含 `device_id`**。
- `VerifyFingerprint`（:178-194）：三选二模型，空值跳过不算匹配（与 CLAUDE.md 的「空值防呆」规则一致）。
- `VerifyAPIResponse`（:494-506）+ `doOnlineLicenseSync`（:514+）：在线对账返回的证书校验、合并与落盘逻辑**已存在**。

因此本设计「拿回一张新签证书」可以复用现有验签/落盘链路，不需要新发明签名协议。

---

## 2. 硬伤 H1 —— register 的轻量通道装不下完整证书

### 2.1 现状

`RegisterDeviceOnline`（`hardware.go:392-448`）响应只解四个字段：

```go
var resData struct {
    DeviceID string `json:"device_id"`
    Tier     string `json:"tier"`
    IsDev    bool   `json:"is_dev"`
}
```

按设计往 `device/register` 响应里塞完整 `LicenseCertificate`，JSON payload 从几百字节涨到 1-2KB，且语义混入：
- `device/register` 的定位是「免费设备打卡 + Dev 识别」（hardware.go:389 注释明确写 `anonymous device registration request for free users`）；
- 它整体是 **fail-open**（网络失败静默返回，`hardware.go:422-428`），找回授权绝不能继承这种「失败就当作没有」的语义。

### 2.2 建议

拆一条独立轻量通道，复用同一批硬件指纹：

```
POST ${license_server}/api/v1/device/restore
  或复用 /api/v1/activate 的 verify 端点 + scope=restore
```

- 由 `RegisterDeviceOnline()` 成功后的同一 goroutine 调用，或与注册并行；
- 服务端做同样「联合查询 + 仲裁」，但返回 `VerifyAPIResponse` 形状；
- 客户端直接走 `doOnlineLicenseSync` 那套**已验证**的解析/合并/落盘逻辑，不新增一条验签路径。

> 如坚持简化，至少要在 register 响应里区分「识别信息」与「授权证书」，并让证书字段走**独立的、同步、非 fail-open**的落地路径（见 A2）。

---

## 3. 硬伤 H2 —— 指纹缺失会把找回静默降级为永久免费

### 3.1 问题

服务端按「当前设备指纹 3 选 2」反查绑定关系。但三选二模型对**指纹缺失**的处理是**空值跳过**（`VerifyFingerprint` :182-190）。若某台机器极端只读到 1 个有效指纹（例如 CPU/磁盘序列读权限不足，仅有 uuid），匹配数永远不足 2：

- 服务端 `has_pending=false` → 返回 `{tier:"free"}`；
- 客户端永远无法找回 → **付费用户在该机器上被静默变成永久免费**。

### 3.2 建议

将「注册所需的指纹门限」与「找回确认的指纹门限」的**语义分开表述**：

- 注册（register）仍是 `all-empty → skip`（hardware.go:398；
  `ActivateLicenseOnline` 的 `validCount<2 → 拒绝`，license.go:339-341）；
- 找回（restore）的确认由**服务端按“是否能唯一确定该设备”**决定：
  - 至少 1 个指纹唯一定位该设备（如 uuid 匹配）即视为有效设备，不必强行要求 3 选 2；
  - 下限保护仍保留（不能 0 指纹匹配就下发）。

这样指纹缺失 ≠ 永久免费，而是退化为「设备无法唯一确认时才不发证」。

---

## 4. 硬伤 H3 —— activations 表语义决定找回查询写法（需服务端确认）

### 4.1 两种可能的存证语义

| 存证语义 | activations 表存什么 | 找回查询 | 「换机/重装」含义 |
|---|-------|-------|-------|
| **绑定码语义** | 授权码 → 该码绑定的**唯一设备**（activate 写入时生成） | 按「当前指纹能否命中某条绑定」join | 换机 = 转让，走另一套流程，不属于「找回」 |
| **设备清单语义** | 授权码 → **所有授权过的设备** | 按「当前指纹是否属于某码的设备集合」join | 换机 = 在该清单里命中即可找回 |

### 4.2 影响

若 activations 存的是绑定码语义，服务端反查是**按码找回原绑定**，`tier/expires` 由服务端算好、客户端只验签 —— 那么 H2 的「2+ 指纹」是唯一安全边界，合理。

若存设备清单语义，找回天然覆盖「换机 + 重装拿到同样 C:/D: 序列但 uuid 不同」的场景。

**在设计实现前先确认表语义**，否则 join 条件会写错。

---

## 5. 安全与仲裁确认

### 5.1 签名

- 新证书走 `VerifyLicenseSignature`（V1/V2 双格式兼容）+ `VerifyFingerprint`，与现有 `ApplyOfflineUpdateIfExists` / `ActivateLicenseOnline` 双验同套路；
- payload 已含 `device_id`（V2）与 `max_devices`，无需改客户端验签协议。

### 5.2 多授权仲裁

纯 D1 SQL 一次完成即可，客户端不参与：

- 过滤 `status NOT IN ('refunded','revoked')` 且 `expires_at`（或 `LIFETIME`）仍有效；
- 排序：`tier`（PRO > PLUS）→ 类型（LIFETIME > 期限）→ `activated_at` 最近；
- 取最高一条 → `has_pending=true + 返回证书`；否则 free。

**A1 提醒**：若该设备只有一条「已过期」的试用码记录，仲裁后必须返回 free，不能残留 paid。

### 5.3 热恢复

`SetPaidStatus(true, ..., tier)` + 状态回调反射回前端（GUI `agent-status` 事件）这条事件链已在 `doOnlineLicenseSync` / tray 刷新中验证过，可行。

**A2 提醒**：找回落地不能继承 register 的 fail-open。签名校验、指纹确认、写盘、`SetPaidStatus` 应作为一个**同步、失败可见**的原子单元。

---

## 6. 实施路径建议（v2）

```
sequenceDiagram
    autonumber
    actor User as 用户
    participant GUI as EQT 客户端
    participant Server as Cloudflare DRM API
    participant D1 as Cloudflare D1 数据库

    User->>GUI: 启动 EQT (本地无 license.lic)
    GUI->>Server: POST /api/v1/device/register { uuid_hash, cpu_hash, disk_hash }
    Server->>D1: 联合查询 activations + licenses (匹配设备语义 & status='active')
    alt 找到有效的已绑定授权
        Server-->>GUI: HTTP 200 { device_id, tier, license_cert: {...} }
        GUI->>GUI: VerifyLicenseSignature() & VerifyFingerprint() 本地验签
        GUI->>GUI: 自动写入 ~/.local/eqt/license.lic
        GUI->>GUI: SetPaidStatus(true) 并触发界面热更新
        Note over GUI: 界面无感切换为 Plus 已激活状态！
    else 普通免费设备
        Server-->>GUI: HTTP 200 { device_id, tier: "free" }
        Note over GUI: 正常以免费模式运行
    end
```

变更清单：
1. **服务端**（`cloudflare/eqt-drm-api`）：在 `device/register`（或独立 restore 端点）实现硬件指纹反查绑定 + Ed25519 自动签名下发 + 多授权仲裁 SQL；
2. **客户端**（主要指 `pkg/server/hardware.go` / `license.go`）：`RegisterDeviceOnline` 接收并落地 `license_cert`，完成验签、静默写回与状态热刷新；
3. **测试**（`pkg/server/license_test.go`）：离线模拟「本地删除 .lic 后启动自动找回」全流程。

---

## 7. 决策与落地确认（已实现）

- [x] **activations 表存证语义（H3）**：确认 `activations` 表存储当前处于合法激活状态的设备清单。云端解绑时即删除记录。反查 SQL 关联 `licenses` 表（`status='active'` 且未过期），通过 `a.device_id = ? OR 3选2硬件指纹` 进行精确定位。
- [x] **端点通道选型（H1）**：采用捎带模式（Piggyback）。在 `POST /api/v1/device/register` 响应中以可选字段返回 `license_cert?: LicenseCertificate`，避免冷启动产生额外的网络往返（RTT）。客户端落地时执行严格同步验签与写盘，与 register 的 fail-open 完全隔离。
- [x] **指纹匹配下限规则（H2）**：服务端在 `findBestActiveLicenseForDevice` 中同时支持权威 `device_id` 命中与非空硬件指纹 3 选 2 匹配；客户端收到证书后通过 `VerifyLicenseSignature` 与 `VerifyFingerprint` 本地双重验签，保证安全下限。
- [x] **多授权仲裁与到期退化（A1）**：服务端在多候选授权中按 `PRO > PLUS`、`LIFETIME > 期限授权`、`activated_at DESC` 自动仲裁；过期或退款授权安全退化为 `free`。
- [x] **客户端热恢复与持久化（A2）**：通过 `SaveRestoredLicenseCertificate` 实现原子写盘（`~/.local/eqt/license.lic`）、内存状态更新与 GUI 事件广播。
- [x] **端到端自动化测试**：
  - Cloudflare DRM API：`tests/drm-register-offline.js` (Test 20)
  - Go 客户端：`pkg/server/license_test.go` (`TestRegisterDeviceOnlineAutoRecovery`)