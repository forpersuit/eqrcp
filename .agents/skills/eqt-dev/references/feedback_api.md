# EQT 反馈接收与云端存储参考 (EQT Feedback API & Storage Reference)

本指南详述基于 Cloudflare Serverless D1/R2 构建的反馈接收系统及卡片推送技术规格。

---

## 1. 架构与通讯协议

- **数据流向**：客户端 HTML5 Canvas 压缩 WebP 图片（0.75 质量，最大 1200px 宽高）转 Base64 ➜ POST 提交至 Worker 接口 `https://feedback.eqt.net.im/goal` ➜ Worker 写入 D1 关系型数据库并将二进制图片存入 R2 桶 ➜ 异步发送卡片至 Telegram Bot。
- **降级后备机制**：网络请求失败时，用户可使用 `copy-feedback` 复制反馈内容并通过 mailto 邮件草稿手动发送。

## 2. 存储模型与图片服务

- **D1 数据库**：数据表 `feedbacks` 字段包括 `category`, `contact`, `message`, `image_url`, `timestamp`, `client_version`, `client_os`。
- **R2 对象存储**：存储 WebP 二进制图片数据。
- **公网图片读取端点**：提供 `GET /image/:key` 端点，Worker 从 R2 读取对应 key 添加 CORS 头和缓存头，供 Telegram 机器人获取缩略图。

## 3. Telegram Bot 异步推送

- 成功写入 D1 与 R2 后，使用 `ctx.waitUntil()` 异步推送 Telegram 消息。
- **有图片**：调用 `sendPhoto` 附带图片直链。
- **无图片**：调用 `sendMessage` 发送 HTML 格式反馈。
- **容错防呆**：未配置 `TELEGRAM_CHAT_ID` 或 `TELEGRAM_BOT_TOKEN` 时静默跳过。

## 4. 集成测试与验证方法

- 在 `cloudflare/eqt-feedback-api` 下启动 `npx wrangler dev --port 8787`。
- 运行 `node test-feedback.js` 发送虚拟包，验证返回的 `imageUrl` 及图片下载解构。
