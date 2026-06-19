# EQT 授权校验与反破解架构文档 (Licensing & DRM Architecture)

本文档阐述了 EQT 软件针对付费套餐（Plus/Pro）的授权流转、防破解对抗及 Cloudflare Workers + D1 数据库云端部署的系统设计。

---

## 1. 核心安全机制设计 (Security Core)

### 1.1 加权硬件指纹 (Weighted Fingerprint)
为了防止用户直接拷贝授权文件到多台机器，或在局域网内无限制共享，客户端采用 **3 选 2 加权指纹比对模型**。

1. **主板 UUID** (权重 40%)：重装系统时保持不变。
2. **CPU 序列号** (权重 30%)：硬件级唯一标示。
3. **系统盘物理 SerialNumber** (权重 30%)：磁盘物理固化序列号，非逻辑分区卷标。

在激活时，客户端计算这三者的 SHA-256 哈希值发送给服务端；服务端签名后的证书也会携带这三项哈希。客户端在离线状态下验签通过后，只要当前硬件与证书中的哈希**至少有 2 项一致**，即判定该客户端合法。

### 1.2 非对称 Ed25519 签名验证
- 拒绝在客户端内置对称秘钥或通过配置文件明文标记授权。
- **云端（私钥加密）**：授权服务器通过 Ed25519 算法私钥对包含 `license_code`, `tier`, `uuid_hash`, `cpu_hash`, `disk_hash`, `expires_at` 的报文进行签名。
- **本地（公钥验签）**：客户端内置公钥（十六进制：`08443678fe8bd16e3bc306db8a08b6ea1dcf3e8edeb413f655e106374bed43ac`），每次启动时进行离线密码学签名验证，阻断“破解注册机（Keygen）”。

### 1.3 双层数据同步与时钟抗回拨
- **时钟回拨锁定**：客户端会向本地 XOR 混淆数据中不断写入当前最新的运行时间戳 `LastTime`。只要检测到当前系统时间早于 `LastTime` 超过 10 分钟，立即将状态标记为 `ClockTampered` 并锁死付费权限。
- **双向数据同步**：程序状态（`chat_usage.json`）与本地数字证书（`license.lic`）形成互相约束。如果恶意修改 `chat_usage.json` 强行设为 `IsPaid=true`，由于没有匹配的 `.lic` 证书，会在启动时被强行改回免费状态。

---

## 2. 系统组件与代码流转

### 2.1 客户端（Go / Wails 前端）
- **[hardware.go](file:///home/yelon/develop/me/eqrcp/server/hardware.go)**：跨平台获取加权指纹，并处理无硬件读取权限或空数据哈希回避，防止空匹配安全漏洞。
- **[license.go](file:///home/yelon/develop/me/eqrcp/server/license.go)**：本地证书签名验证、3 选 2 匹配、在线激活网络请求（`/api/v1/activate`）与本地 `.lic` 存取。
- **[chat_limiter.go](file:///home/yelon/develop/me/eqrcp/server/chat_limiter.go)**：系统核心阻断和校验循环。每次加载使用状态时均自动进行证书与防作弊锁定状态检查。
- **[desktop_agent.go](file:///home/yelon/develop/me/eqrcp/cmd/desktop_agent.go)**：在本地暴露 `/activate` 和 `/reset-license` 服务接口供 UI 交互。
- **[app.go](file:///home/yelon/develop/me/eqrcp/desktop/gui/app.go)**：将 Wails API 接入本地 HTTP 服务。
- **[main.js](file:///home/yelon/develop/me/eqrcp/desktop/gui/frontend/src/main.js)**：Wails 前端异步激活交互及 localStorage 状态同步。

### 2.2 服务端（Cloudflare Workers + D1）
代码位于 `cloudflare/` 目录下：
- **[schema.sql](file:///home/yelon/develop/me/eqrcp/cloudflare/schema.sql)**：定义 `licenses` 与 `activations` 表，记录每张激活码对应的绑定设备状态。
- **[index.ts](file:///home/yelon/develop/me/eqrcp/cloudflare/src/index.ts)**：处理激活逻辑。若请求指纹已在 D1 中绑定，直接返回签名；若是新设备且未满最大设备数（买断版默认 2 台），在 D1 中添加记录并返回证书；若已满则返回 403。

---

## 3. Cloudflare 部署与故障排查经验总结

### 3.1 环境变量中失效 Token 干扰排查
在本地部署 Workers/D1 时，Wrangler CLI 会优先读取终端环境变量中的自定义 API 令牌（如 `CLOUDFLARE_API_TOKEN`）。
如果这个 Token 已经失效或权限被过度裁剪（比如缺乏 memberships 账户读取权限），Wrangler 在调用 Cloudflare 接口时会报鉴权错误 `Authentication error [code: 10000]`。

**解决办法**：
在运行 wrangler 命令前前缀置空 API 令牌变量，强制命令调用使用本地浏览器 OAuth 登录凭证（由 `wrangler login` 生成）：
```sh
CLOUDFLARE_API_TOKEN="" npx wrangler d1 create eqt-drm-db
CLOUDFLARE_API_TOKEN="" npx wrangler deploy
```

### 3.2 交互式命令的非交互脚本化
在进行 D1 schema 执行与 secrets 上传时，部分命令需要在交互式终端中输入确认。在编写自动部署脚本时，应采用如下技巧屏蔽交互：
- **对于 D1 执行**：`wrangler d1 execute` 即使是非交互，在必要时也可输入管道：`echo "Y" | npx wrangler d1 execute ...`。
- **对于 Secret 注入**：使用 `echo -n` 通过管道输送值，Wrangler 会自动创建 Worker 并上传秘钥：
  ```sh
  echo -n "fc0993ec4a68da7e6f10be87959d8ecd7f227ddd4b9e65a7b925287b9b2ed12e" | npx wrangler secret put ED25519_PRIVATE_KEY
  ```
