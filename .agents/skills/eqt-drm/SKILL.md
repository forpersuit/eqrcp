---
name: eqt-drm
description: Guides EQT licensing architecture, offline cryptographic activation verification, and Cloudflare Serverless D1 database deployment.
---

# EQT 授权与反破解开发指南 (EQT Licensing DRM Skill)

本技能指南面向 AI 开发助手，指导如何维护和修改 EQT 的 DRM 授权、反破解方案，以及管理 Cloudflare 后端接口。

---

## 1. 客户端设备指纹比对规范 (Client Hardware Fingerprint)

- **第一性原理防线**：在进行 **3选2 加权设备指纹校验**（主板 UUID、CPU 序列号、系统盘物理 SerialNumber）时，必须注意空值的校验回避：
  - 如果由于运行权限原因导致某项硬件特征提取返回空字符串 `""`，此字段**绝对不能**在比对时判定为“相等”，必须直接跳过。
  - 只有两边非空且完全相等时，匹配项才能计入。
  - 至少有 2 项有效的非空指纹相匹配，才允许判定设备合法。
- **配置一致性**：一旦设备指纹修改，必须确保针对 Windows 和 Linux 的测试覆盖，并运行 [license_test.go](file:///home/yelon/develop/me/eqrcp/server/license_test.go) 中的加权模型边界案例。

---

## 2. 离线 `.lic` 数字证书流转与时钟防篡改

- **Ed25519 签名**：客户端内置 32 字节的公钥哈希，私钥应严格保存在 Cloudflare Workers 中。验签格式必须与 Workers 生成时严格对称（用 `|` 拼接 `license_code|tier|uuid_hash|cpu_hash|disk_hash|expires_at`），避免因 JSON 库序列化字段字典序不一致导致验签失败。
- **时钟篡改保护**：如果用户本地系统时间比上一次写入的混淆文件 `LastTime` 早，系统将置 `ClockTampered=true`。此时即使证书有效，也必须强制降级并锁死付费功能。
- **非阻塞网络时间校验（异步防挂起）**：
  - 如果 `.lic` 包含有限的过期时间（非 `LIFETIME`），必须对网络时间 `fetchNetworkTime` 实施非阻塞异步刷新机制。
  - **绝不允许**在处理前端 HTTP `/status` 等轮询请求的主线程中同步阻塞式进行网络 HTTP 请求。
  - 应使用内存缓存存储网络时间偏置（`offset = netTime - systemTime`），在无缓存或缓存过期（例如超过 1 小时）时，在后台异步启动 goroutine 进行拉取，当前请求应立刻使用系统时间（或上一次的 offset 缓存）先行返回，确保 `/status` 接口调用响应在微秒级，永远不会引发 `context deadline exceeded`。
  - 对于测试环境（`EQT_TESTING == "true"`）应直接跳过网络拉取。对网络时间请求失败的情况应建立退避机制（例如 1 分钟内不重复拉取），防止断网状态下高频产生僵尸 goroutine。
- **纯内存级限额缓存与原子性持久化**：
  - 由于类似 Wails GUI 的 `snapshotWithRevision` 状态查询会同时连续多次调用 `ChatLimiter.GetStatus()`，每次都执行磁盘 I/O 读写 `chat_usage.json` 及解密会造成严重性能瓶颈与文件并发读写损坏。
  - **内存缓存隔离**：在同一天内（`Date == today`），限额读取必须完全基于内存缓存（`l.cachedUsage`），避免产生任何主动的磁盘读取。
  - **原子性保存**：限额状态写入时，必须采用原子性临时文件写入机制（写入 `.tmp` 临时文件，而后通过 `os.Rename` 原子覆盖目标文件），防止并发状态读写导致文件数据不完整或损坏。
  - **鲁棒降级**：读取主配置文件 `chat_usage.json` 失败或解析 JSON 损坏时，程序必须自动尝试解密读取隐藏备份文件 `.eqt_sys_state`，最大限度保障计时的准确与防破解安全性。
  - 对 `.lic` 证书的读取和解析（`GetLocalLicenseInfo`）应在首次读取后进行持久内存缓存，在发生激活（Online Activation）或重置（Reset）时手动更新该缓存，避免常规状态轮询下不断解析文件并进行设备硬件指纹获取与验签运算。
- **测试兼容模式**：在单元测试或 mock 状态下（`os.Getenv("EQT_TESTING") == "true"`），若本地没有 `.lic` 文件，必须自动降级到传统模式，支持模拟付费判定，不可在测试环境中强求真实公私钥签名，以免破坏基础 CI。
- **Share/Receive 模式防规避与防呆拦截机制**：
  - **无物理时限中断**：为了保障用户体验连贯性，在 10 分钟（600秒）限额内，如果某次传输任务（如移动端上传 POST 或桌面端 Share）在启动那一刻 `usedSeconds < 600`，本次传输必须被允许无限制传输完毕，不得强行调用 `signalStop()` 在中途物理切断。
  - **下一次任务额度拦截**：下一次新任务启动时，若 `usedSeconds >= 600` 且未付费：
    - **桌面端 Share 启动拦截**：在 `Share()` API 启动时，递归检查待分享文件的总路径。若文件个数超过 5 个或单个文件大于 50MB，则直接返回 error 阻断服务启动。
    - **移动端上传拦截**：在 POST `/receive/...` 请求入口处锁死 `quotaExceededAtStart`。若其为 `true`：在 Multipart 循环中，若已写入文件达到 5 个时拒绝后续接收并报错 403 阻断；在 Chunk 级文件写入 IO 循环中，若单个文件写入累计超过 50MB（52,428,800字节），即刻强行关闭文件、报错 413 退出并触发 `signalStop()`。
    - **单元测试保障**：为该防规避设计编写单元测试（包括文件数超限、单文件超限、开始低额度中途超额无缝传输完），保护相关边界不被后续回归破坏。

---

## 3. Cloudflare D1 & Workers 运维避坑与调试

在通过 Wrangler 部署和修改云端 API 时，极易遇到凭证和部署管道的阻碍，必须采取以下开发经验：

### 3.1 环境变量 API Token 干扰
Wrangler CLI 会优先读取终端环境变量的 `CLOUDFLARE_API_TOKEN`，如其失效或权限（如读取 `memberships`）不足，会报 D1/Worker 拒绝访问。

- **规避手段**：在命令前手动强行清除此变量环境，强制让 Wrangler 回退去读取本机由浏览器生成的 `wrangler login` OAuth 授权：
  ```sh
  CLOUDFLARE_API_TOKEN="" npx wrangler d1 execute eqt-drm-db --remote --file=./schema.sql
  CLOUDFLARE_API_TOKEN="" npx wrangler deploy
  ```

### 3.2 交互式 Secret 注入
在 Cloudflare Worker 中通过管道无交互写入敏感凭据的语法：
```sh
echo -n "your_secret_value" | npx wrangler secret put KEY_NAME
```
若目标 Worker "eqt-drm-api" 尚未激活或创建，Wrangler 会自动在非交互上下文中选择同意 (`yes`) 并自动建立同名 Worker 挂载秘钥，无需额外干预。

### 3.3 Cloudflare R2 存储与 CI/CD 资产分发 (R2 Storage & Asset Sync)
为了确保私有仓库下的 EQT 客户端可以被公共下载与顺利执行自动更新：
- **GitHub Secrets 密钥依赖**：必须在 GitHub 仓库中配置以下凭据，以供 `.github/workflows/release.yml` 自动上传编译产物到 Cloudflare R2 存储桶：
  - `CF_ACCOUNT_ID`: Cloudflare 账户 ID。
  - `R2_BUCKET_NAME`: 用于分发安装包的 R2 存储桶名。
  - `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`: 用于 S3 兼容上传的 R2 访问密钥对。
- **自动更新链接重定向**：在云端 `eqt-drm-api` Worker 环境变量中配置 `R2_PUBLIC_URL`（例如 `https://pub.eqt.net.im`）。
  - 若配置了此变量，`/api/v1/update/check` 返回的 `download_url` 将被自动改写为 R2 的加速直链。
  - 若未配置，则回退使用私有 GitHub Releases 直链。
- **静态网页直链**：产品介绍页面（`cloudflare/eqt-website/index.html`）应始终使用指向 R2 存储桶的公共直链（如 `https://pub.eqt.net.im/downloads/latest/eqt-desktop-windows-amd64.exe`），从而免受 GitHub 私有库 404 限制及免去 Worker 的 CPU 超时影响。
- **分发下载域名接管模式**：为规避 Pages master 全量部署对 `downloads/` 目录的覆盖、以及 Pages 的 25MB 单文件上限，`download.eqt.net.im` 的解析已被合并路由到 `eqt-drm-api` Worker 下。
  - **R2 自动化上传**：大文件二进制与签名资产在 GitHub Actions `release.yml` 阶段会通过 `wrangler r2 object put` 自动化同步发布到 R2 存储桶中，供国内或非 GitHub 地区高速直连下载。
  - **动态官网版本显示**：官网页面 `index.html` 采用非阻塞异步 fetch 机制获取 `/update-metadata.json` 中的最新版本号并动态渲染到下载按钮中。此机制在 `applyLang` 底部绑定，确保用户切换多语言时版本号显示不会被重置覆盖。
  - **302 重定向**：Worker 拦截 `download.eqt.net.im` 流量并处理请求：
    - 将 `/update-metadata.json` 解析并生成带一分钟边缘缓存的动态 JSON（支持 CORS 供官网请求）。
    - 将 `/downloads/:version/:filename` 动态 302 重定向到配置的 R2 存储加速域名，若无 R2 环境变量则回退重定向到 GitHub Releases。
    这确保了发布新版本时大文件托管免受 Pages 单文件限制，并且任何时候推送代码至 master 均不会造成下载大文件丢失。

---

## 4. 兑换码生成与管理工具 (License Code Generation)

为了配合云端授权管理，我们提供了一个自动化脚本 [generate-license.sh](file:///home/yelon/develop/me/eqrcp/scripts/generate-license.sh) 用于快速生成兑换码，并自动屏蔽 `CLOUDFLARE_API_TOKEN` 的环境变量干扰以安全写入 Cloudflare D1 云端数据库。

### 使用方法：
在项目根目录或 `scripts/` 目录下运行：
```sh
# 生成默认的 PLUS 永久授权码并写入云端 D1
./scripts/generate-license.sh

# 生成 PRO 级别、限制绑定 1 台设备的临时兑换码并写入本地 D1 测试
./scripts/generate-license.sh -t PRO -m 1 -e "2027-06-25T12:00:00Z" --local
```

### 特征算法：
生成格式为 `EQT-TIER-YYYYMMDD-RANDOM-CHECK`：
1. `TIER`: PLUS 或 PRO。
2. `YYYYMMDD`: 8 位当前日期。
3. `RANDOM`: 6 位随机大写字符。
4. `CHECK`: 前 3 项拼接后取 MD5 前 4 位大写字符，用以校验防错漏。

