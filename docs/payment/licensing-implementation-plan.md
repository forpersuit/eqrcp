# EQT 极简授权系统开发实施计划书 (Licensing Implementation Plan)

本计划书基于“默认联网校验，断网宽限 7 天”的极简安全设计，为云端 Workers 数据库及客户端 Go 后端的迁移重构制定了详细的阶段性任务。

---

## 📅 阶段一：服务端 (Cloudflare Workers & D1) API 改造

在云端，我们需要升级数据库 Schema，动态签发包含时长属性的数字证书，并增强发信和支付的安全防线。

### 1.1 数据库结构迁移 (Migration)
* [ ] 运行 D1 迁移脚本，在 `licenses` 表中追加 `duration_days` 字段（`INTEGER DEFAULT NULL`），用于识别相对有效时长。
* [ ] 在 `licenses` 表中引入 `buyer_email_hash`（存储小写邮箱的 Sha256 值），用于管理控制台匹配。

### 1.2 激活接口 (`/api/v1/activate`) 动态算时
* [ ] 改造激活端点，根据兑换码关联的 `duration_days` 在 Worker 内存中进行时效计算：
  $$\text{finalExpiresAt} = \text{Date.now()} + (\text{duration\_days} \times 86400 \times 1000)$$
* [ ] 将此绝对时间点写入 Ed25519 的明文 payload 中，并生成私钥 Signature 证书返回。

### 1.3 联网对账接口 (`/api/v1/verify`) 开发
* [ ] 客户端异步对账请求时，Worker 接收客户端上传 of 设备指纹与签名。
* [ ] 验证云端该 `license_code` 对应的设备是否被解绑或退款吊销。
* [ ] 验证通过后，下发包含当前最新云端时间戳、并由云端私钥重新签名的对账确认凭证（用于更新客户端本地 `LastOnlineSyncTime`）。

### 1.4 发信频率限制与 Checkout 强绑定
* [ ] 在发信前置端引入 Cloudflare Turnstile 校验。
* [ ] 接入 Cloudflare KV 计数器，实现单 IP/单邮箱的 60 秒滑动窗口 Rate Limiting 限制。
* [ ] 验证邮箱成功后，在 Stripe/Gumroad Checkout Session 创建时，将邮箱作为只读属性强制注入，杜绝收银台邮箱被恶意替换。

---

## 📅 阶段二：客户端 (Go 后端) 物理瘦身与授权重构

客户端需要实施文件精简，卸下复杂的本地高频写盘负担，并将校验机制单一收拢至 `license.lic`。

### 2.1 彻底废除多余落盘文件
* [ ] 删除 [chat_limiter.go](file:///home/yelon/develop/me/eqrcp/pkg/server/chat_limiter.go) 中涉及本地使用度限制文件 `chat_usage.json` 及 Home 目录隐藏防线文件 `.eqt_sys_state` 的全部读写、解密及对账逻辑。

### 2.2 证书结构体 [LicenseCertificate](file:///home/yelon/develop/me/eqrcp/pkg/server/license.go#L28-L38) 扩展
* [ ] 在 `LicenseCertificate` 结构中追加非签名本地元数据属性（这部分数据不计入 Ed25519 的签名 Payload，但在落盘保存时作为 JSON 字段一同写入 `.lic`）：
  * `LastOnlineSyncTime`: 上一次成功通过联网校验的绝对时间戳。
  * `LastSeenLocalTime`: 上一次程序运行时的本地系统时间（用于防止时间倒流）。

### 2.3 重构本地校验方法 `VerifyLocalLicense()`
* [ ] **读取与解密**：读取配置文件夹下的 [license.lic](file:///home/yelon/develop/me/eqrcp/pkg/server/license.go#L41) 证书实体。
* [ ] **密码学验签**：对证书签名、设备硬件指纹（3选2）进行常规校验。
* [ ] **防时间回拨**：
  * 读取未签名的 `LastSeenLocalTime` 元数据。
  * 校验：若 $time.Now() < LastSeenLocalTime$，说明本地系统时钟发生了篡改。
  * **惩罚机制**：判定失败，直接锁定并强制调用 `SetPaidStatus(false)`。
* [ ] **租约期限校验**：
  * 读取未签名的 `LastOnlineSyncTime` 元数据。
  * 校验：若距离上一次联网成功时间超过 7 天，租约到期。
  * **降级机制**：判定失败，安全退回到免费版。
* [ ] **写入防线**：若以上校验全部通过，在将 `license.lic` 关包落盘前，更新 `LastSeenLocalTime = time.Now()`。

### 2.4 后台静默联网对账协程开发
* [ ] 开发非阻塞异步 goroutine：客户端启动时在后台静默发起 `/api/v1/verify` 联网对账。
* [ ] 对账成功后，更新本地 `LastOnlineSyncTime = time.Now()` 并保存至本地证书。

---

## 📅 阶段三：用户界面与前端订阅更新

确保授权发生改变时，用户可以在 PC 桌面客户端和浏览器上传/下载页面上获得即时无缝的交互反馈。

### 3.1 Wails 级联广播
* [ ] 在 [SetPaidDetails](file:///home/yelon/develop/me/eqrcp/pkg/server/chat_limiter.go#L400) 调用发生状态切换时，确保通过 Wails Event 机制将授权降级/重置系统消息发布出去。

### 3.2 前端订阅热重载
* [ ] **Svelte 页面订阅**：Chat 页面监听 `activeSession`，在收到授权降级消息时调用 `setLanguage()` 及 DOM 重绘通知。
* [ ] **浏览器网页订阅**：`done.tmpl.html`、`upload.tmpl.html` 以及 `download.tmpl.html` 接收到降级通知时实时退回免费 Tier 限额约束，防呆提示框无缝响应。

---

## 📅 阶段四：QA 校验与边界测试 (Testing)

通过单元测试模拟断网与时钟回拨，确保没有功能退化 (Zero Tolerance for Regression)。

### 4.1 单元测试用例设计
* [ ] **断网宽限测试**：Mock 一个 `license.lic`，写入 `LastOnlineSyncTime` 为 3 天前，验证客户端静默启动通过并正常使用付费功能。
* [ ] **宽限超期降级测试**：Mock 一个 `license.lic`，写入 `LastOnlineSyncTime` 为 8 天前，且断网无法对账，验证启动时立即安全退回免费版。
* [ ] **时钟篡改测试**：Mock 证书的 `LastSeenLocalTime` 为明天，本地时间今天启动，验证判定为篡改并拒绝服务。
* [ ] **删除避险测试**：手动物理删除 `license.lic` 文件，验证系统正常启动且不发生 panic，干净回退至 Free tier。
