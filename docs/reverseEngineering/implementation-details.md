# EQT 防逆向与安全防护技术实现细节规格书

> **文档版本**：v1.0  
> **更新时间**：2026-08-24  
> **代码对应版本**：`v1.35.0`  
> **核心源码定位**：`pkg/server/chat_limiter.go`、`pkg/server/license.go`、`pkg/server/hardware.go`、`cmd/chat.go`

---

## 目录
1. [数据层 HMAC-SHA256 防篡改实现](#1-数据层-hmac-sha256-防篡改实现)
2. [Ed25519 非对称密码学验签体系](#2-ed25519-非对称密码学验签体系)
3. [硬件指纹采集与“3 选 2”模糊匹配算法](#3-硬件指纹采集与3-选-2模糊匹配算法)
4. [7 天脱机离线租约与时钟防倒拨机制](#4-7-天脱机离线租约与时钟防倒拨机制)
5. [网络时间异步探测与冷启动防锁死算法](#5-网络时间异步探测与冷启动防锁死算法)
6. [CLI 入口物理阻断与 GUI 专属防护](#6-cli-入口物理阻断与-gui-专属防护)
7. [防逆向攻击面与代码对照索引](#7-防逆向攻击面与代码对照索引)

---

## 1. 数据层 HMAC-SHA256 防篡改实现

### 1.1 威胁模型
攻击者试图通过直接用文本编辑器修改本地配置文件（`chat_usage.json`），将 `used_seconds` 改为 `0`、将 `used_transfers` 改为 `0`，或将 `is_paid` 字段强制改为 `true`。

### 1.2 实现细节
- **源码文件**：[`pkg/server/chat_limiter.go`](file:///home/yelon/develop/me/eqrcp/pkg/server/chat_limiter.go#L253-L268)
- **密钥派生**：HMAC Key 采用动态机器特征绑定：
  ```go
  machineKey := GetDeviceStableID()
  key := []byte("EQT_USAGE_HMAC_v1:" + machineKey)
  ```
- **签名 Payload 结构**：
  ```text
  V1|<Date>|<UsedSeconds>|<UsedTransfers>|<UsedReceiveTransfers>|<IsPaid>|<ClockTampered>
  ```
- **防篡改判定与自锁流程**：
  1. 读取 `chat_usage.json` 时，提取字段并重新计算 `expectedMAC`。
  2. 若 `usage.MAC != "" && usage.MAC != expectedMAC`：
     - 判定为 `tampered = true`；
     - 强制将 `usage.ClockTampered = true`；
     - 强制将已用秒数置为最大值 `usage.UsedSeconds = 600`，已用传输次数置为 `5`；
     - 异步调用 `SetClockTampered(true)` 广播全系统，内存付费态被即刻销毁。

---

## 2. Ed25519 非对称密码学验签体系

### 2.1 威胁模型
攻击者试图伪造 Cloudflare Workers DRM 签发的授权文件（`license.lic`），或通过搭建本地 Mock 服务返回伪造的付费成功报文。

### 2.2 实现细节
- **源码文件**：[`pkg/server/license.go`](file:///home/yelon/develop/me/eqrcp/pkg/server/license.go#L100-L175)
- **公私钥分离机制**：
  - **私钥 (Private Key Seed)**：仅部署在 Cloudflare Workers 边缘环境变量（`ED25519_PRIVATE_KEY`），绝不打包进客户端二进制。
  - **公钥 (Public Key Hex)**：通过 Go build tags 区分环境并硬编码进客户端：
    - 生产公钥 (`env_defaults_prod.go`)：`08443678...`
    - 测试公钥 (`env_defaults_dev.go`)：`ce07f02c...`（仅 `-tags eqtdev` 时编译）
- **两级验签 Payload**：
  1. **激活授权签名 (Activation Signature)**：
     ```text
     ACTIVATE|<tier>|<licenseCode>|<uuidHash>|<cpuHash>|<diskHash>|<expiresAt>|<redeemedAt>
     ```
  2. **在线对账与租约签名 (Sync Signature)**：
     ```text
     SYNC|<deviceID>|<usageDate>|<usedSeconds>|<usedTransfers>|<quotaFlag>|<serverTime>
     ```
  3. **密码学验证**：
     ```go
     ed25519.Verify(pubKey, []byte(payloadStr), sigBytes)
     ```
     只要攻击者无法获取 Cloudflare 边缘环境的 32 字节私钥 Seed，任何篡改或伪造证书在数学上均无法通过验证。

---

## 3. 硬件指纹采集与“3 选 2”模糊匹配算法

### 3.1 威胁模型
- 攻击者将一台电脑激活生成的 `license.lic` 复制到其他多台电脑上共享使用；
- 正常用户因硬件局部升级（如仅更换 CPU 或加装新硬盘）导致指纹突变被误判为未授权。

### 3.2 实现细节
- **源码文件**：[`pkg/server/hardware.go`](file:///home/yelon/develop/me/eqrcp/pkg/server/hardware.go) 与 [`pkg/server/license.go`](file:///home/yelon/develop/me/eqrcp/pkg/server/license.go#L177-L194)
- **指纹采集项**：
  1. 主板 UUID (`curUUID`)：Windows 通过 `wmic csproduct get uuid`，Linux/WSL 读取 `/sys/class/dmi/id/product_uuid`；
  2. CPU 序列号 (`curCPU`)：通过 CPUID 指令 / WMI 查询；
  3. 主硬盘序列号 (`curDisk`)：Windows 通过 `wmic diskdrive get serialnumber`，Linux 读取 `udevadm` / `lsblk`。
- **单向不可逆哈希**：
  采集到的原始字符串通过 SHA-256 哈希后存储，不在内存或网络传输中暴露硬件明文。
- **3 选 2 容错匹配与空值防呆规则**：
  ```go
  matches := 0
  // 严格防呆：若任何一方为空字符串，直接跳过，不得算作匹配
  if cert.UUIDHash != "" && curUUID != "" && cert.UUIDHash == curUUID { matches++ }
  if cert.CPUHash != "" && curCPU != "" && cert.CPUHash == curCPU { matches++ }
  if cert.DiskHash != "" && curDisk != "" && cert.DiskHash == curDisk { matches++ }

  // 必须满足至少 2 项有效硬件指纹一致
  return matches >= 2
  ```

---

## 4. 7 天脱机离线租约与时钟防倒拨机制

### 4.1 威胁模型
- 付费用户在无外网环境（出差、飞机、私有局域网）下需要正常使用，不能因断网而丢失特权；
- 恶意用户在脱机状态下无限倒拨操作系统时钟以企图长期白嫖。

### 4.2 实现细节
- **源码文件**：[`pkg/server/license.go`](file:///home/yelon/develop/me/eqrcp/pkg/server/license.go#L241-L300)
- **7 天离线租约判定**：
  ```go
  lastSync, err := time.Parse(time.RFC3339, cert.LastOnlineSyncTime)
  if time.Now().After(lastSync.Add(7 * 24 * time.Hour)) {
      // 连续断网超 7 天（168 小时），租约到期，安全退回 Free 降级模式
      SetPaidStatus(false, "", "", "")
      return false
  }
  ```
- **时钟回退防作弊检查**：
  本地证书中维护字段 `LastSeenLocalTime`。每次验证时与当前本地时间对比：
  ```go
  if cert.LastSeenLocalTime != "" {
      lastSeen, err := time.Parse(time.RFC3339, cert.LastSeenLocalTime)
      if err == nil {
          // 允许 10 分钟以内的合理时间飘移
          if time.Now().Before(lastSeen.Add(-10 * time.Minute)) {
              // 判定为恶意倒拨时钟，触发锁定
              SetClockTampered(true)
              SetPaidStatus(false, "", "", "")
              return false
          }
      }
  }
  ```
- **I/O 节流优化**：
  为了避免高频写入导致 SSD 磨损，`LastSeenLocalTime` 限制**每 1 分钟最多写盘 1 次**。

---

## 5. 网络时间异步探测与冷启动防锁死算法

### 5.1 威胁模型
- Free 用户试图通过断网并不断篡改系统时间，无限重复享受每日免费 5 分钟的满速额度；
- 在正常连网状态下，应用冷启动时由于异步网络请求存在延迟，不能误将正常连网用户当成断网离线用户而误判为超额。

### 5.2 实现细节
- **源码文件**：[`pkg/server/chat_limiter.go`](file:///home/yelon/develop/me/eqrcp/pkg/server/chat_limiter.go#L107-L175)
- **多级全球网络时间探测**：
  1. 首选：EQT DRM API 许可证服务器（`lic.eqt.net.im`）；
  2. 备选 1：Cloudflare 全球边缘 CDN（`www.cloudflare.com`）；
  3. 备选 2：国内高可用接入点（`www.baidu.com`）。
- **非阻塞异步获取与冷启动状态机**：
  ```go
  var (
      netTimeMu         sync.Mutex
      netTimeOffset     time.Duration
      netTimeCached     bool
      netTimeLastCheck  time.Time
      netTimeIsChecking bool
      netTimeFirstFetch bool = true
  )
  ```
  1. **冷启动窗口期 (First Fetch)**：首次启动时 `netTimeFirstFetch = true`，乐观允许读取当天真实的用量文件，消除启动瞬间闪烁超额；
  2. **异步回调实时刷新**：后台协程请求成功后，调用 `limiterInstance.invalidateCache()`，立即重置用量缓存，确保后续请求秒级对齐云端标准时间；
  3. **离线确认降级**：若网络请求超时或确认失败，`netTimeCached = false`，Free 用户平滑转为受限传输模式。

---

## 6. CLI 入口物理阻断与 GUI 专属防护

### 6.1 威胁模型
攻击者试图编写 Python/Shell 自动化脚本，在无头服务器（Headless）或通过终端直接调用 `eqt chat`，绕过桌面图形界面的交互与限制逻辑。

### 6.2 实现细节
- **源码文件**：[`cmd/chat.go`](file:///home/yelon/develop/me/eqrcp/cmd/chat.go) 与 [`cmd/desktop.go`](file:///home/yelon/develop/me/eqrcp/cmd/desktop.go)
- **实现方式**：
  彻底移除命令行启动 Chat HTTP 服务、终端打印二维码及键盘监听等逻辑。任何在终端直接调用 `eqt chat` 或 `eqt c` 的操作均被直接拦截：
  ```go
  func chatCmdFunc(command *cobra.Command, args []string) error {
      return errors.New("chat mode is an exclusive feature of the EQT Desktop GUI application and cannot be started from command-line interface. Please launch EQT Desktop to use Chat.")
  }
  ```
- **受控边界**：
  Chat 服务仅能在由 Wails 驱动的完整桌面 GUI 应用程序内部被启动和调度。

---

## 7. 防逆向攻击面与代码对照索引

| 攻击面 | 防护层级 | 核心代码函数 | 防护效果 |
| :--- | :--- | :--- | :--- |
| **本地文件篡改** | 数据层 HMAC 签名 | `computeUsageMAC()`, `loadUsageLocked()` | 篡改即锁定为超额 |
| **伪造授权证书** | 密码学非对称数字签名 | `VerifyLicenseSignature()`, `VerifySyncSignature()` | 无私钥无法生成合法签名 |
| **硬件克隆迁移** | 硬件特征多维匹配 | `GetDeviceFingerprintHashes()`, `VerifyFingerprint()` | 3 选 2 模糊匹配，防跨设备盗用 |
| **脱机时间倒拨** | 离线租约 + 时钟回退检查 | `VerifyLocalLicense()`, `getNetworkTimeOrStartFetch()` | 偏差 >10 分钟直接锁定 |
| **CLI 无头绕过** | 接口层物理阻断 | `cmd/chat.go:chatCmdFunc()` | 终端直接阻断，强制 GUI 运行 |
