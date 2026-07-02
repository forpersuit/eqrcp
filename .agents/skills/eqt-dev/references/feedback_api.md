# EQT 反馈接收与云端存储参考 (EQT Feedback API & Storage Reference)

本指南详述基于 Cloudflare Serverless D1/R2 构建的反馈接收系统及卡片推送技术规格。

---

## 1. 架构与通讯协议
反馈系统基于**第一性原理**实现轻量化的零成本数据上云与多渠道通知：
- **数据流向**：客户端 HTML5 Canvas 压缩 WebP图片（0.75质量，最大1200px宽度/高度）并转为 Base64 ➜ POST 提交至 `https://feedback.eqt.net.im/goal` ➜ Worker 写入 D1 关系型数据库并将二进制图片存入 R2 桶 ➜ 异步发送卡片至 Telegram Bot。
- **降级后备机制**：若网络请求失败，用户依然可以使用已有的 `copy-feedback` 复制反馈内容并通过系统邮件草稿（mailto）进行手动发送。

## 2. 存储模型与图片服务
- **D1 数据库**：建表 `feedbacks`，字段包含 `category`, `contact`, `message`, `image_url`, `timestamp`, `client_version`, `client_os`，实现反馈元数据持久化。
- **R2 对象存储**：存储 WebP 二进制数据，避免依赖任何高昂的外部存储。
- **公网图片读取端点**：提供 `GET /image/:key` 的端点。由 Worker 自动读取 R2 中的对应 key，添加 CORS 头，并将 Content-Type 设为 `image/webp` 加上公网高速缓存头，使得 Telegram 机器人等公网服务可以直接根据 `https://feedback.eqt.net.im/image/{filename}` 获取到图片缩略图。
- **双重路由限制 (wrangler.toml)**：
  ```toml
  routes = [
    { pattern = "feedback.eqt.net.im/goal", custom_domain = true },
    { pattern = "feedback.eqt.net.im/image/*", custom_domain = true }
  ]
  ```

## 3. Telegram Bot 异步推送
- 在 Worker 中接收到 POST 请求并成功写入 D1 与 R2 后，使用 `ctx.waitUntil()` 将推送操作异步推入后台。
- 调用 Telegram Bot API：
  - **有图片**：`https://api.telegram.org/bot<TOKEN>/sendPhoto`，将 `photo` 设为生成的 `https://feedback.eqt.net.im/image/{filename}` 链接，Telegram 服务器将自动调取该链接完成卡片推送。
  - **无图片**：`https://api.telegram.org/bot<TOKEN>/sendMessage` 发送 HTML 格式化反馈信息。
  - **容错防呆**：对于未配置 `TELEGRAM_CHAT_ID` 或 `TELEGRAM_BOT_TOKEN` 的环境，应进行静默跳过或在控制台打印警告，不允许中断 D1 写入的核心成功流程。

## 4. 集成测试与验证方法
- 在 `cloudflare/eqt-feedback-api` 下编写 `test-feedback.js`，启动本地 wrangler `npx wrangler dev --port 8787`。
- 运行 `node test-feedback.js`，该脚本会向本地 Worker POST 虚拟反馈包（带 WebP 图片 of Base64 编码），验证返回的 `imageUrl` 并在本地 GET 该 URL 下载验证图片数据大小，确保存储 and 路由的完美跑通。
