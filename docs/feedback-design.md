# EQT 一键反馈系统设计方案 (零成本与零运维)

本文档旨在为 EQT (eqrcp) 设计一个轻量、好用、且**零服务器运维成本、极低流量带宽消耗**应用内一键反馈系统，并结合当前工程中的实际架构演进进行记录。

---

## 1. 背景与痛点

目前 EQT 桌面客户端的反馈功能面临以下痛点：
1. **唤起阻碍**：如果用户操作系统未配置默认邮件客户端，传统的 `mailto:` 机制点击无响应。
2. **体验割裂**：用户必须离开当前应用到外部发送，无法一键无感提交。
3. **大图传输昂贵**：如果反馈带截图，4K 屏幕的高清 PNG 截图体积一般在 **5MB ~ 10MB** 左右。直接上传不仅严重消耗用户的上行宽带，也会给我们的 API 接口带来高昂的流量与 CPU 解码成本。

---

## 2. 核心架构设计：客户端 WebP 压缩 + Go 桥接 + Cloudflare Serverless (D1/R2/Telegram Bot)

为解决上述痛点，本系统基于**第一性原理（First Principle）**进行优化，在**不租赁任何云服务器、不编写任何看板网页**的情况下，实现高性能数据处理与即时推送。

```
                                 ┌─────────────────────────┐
                                 │      客户端前端 (GUI)     │
                                 └────────────┬────────────┘
                                              │ 1. Canvas 等比缩放 (最大 1200px)
                                              │    有损压缩至 WebP (Quality 0.75)
                                              ▼
                                 ┌─────────────────────────┐
                                 │   桌面端 Go 后端 (Wails)  │
                                 └────────────┬────────────┘
                                              │ 2. 规避 CORS 限制，记录本地 Trace 日志
                                              ▼
                                 ┌─────────────────────────┐
                                 │    Cloudflare Workers   │
                                 └─────┬─────────────┬─────┘
           3. 写入图片 (存入 R2)       │             │
        (WebP 图片 URL 公网可查)       │             │ 5. 异步推送通知
                                       ▼             │    (ctx.waitUntil 非阻塞)
                              ┌──────────────┐       ▼
                              │ Cloudflare R2│ ┌───────────────┐
                              └──────────────┘ │ Telegram Bot  │
           4. 写入结构化数据 (存入 D1)  │              └───────────────┘
                                       ▼
                              ┌──────────────┐
                              │ Cloudflare D1│
                              └──────────────┘
```

---

## 3. 核心设计特点与实现

### 3.1 客户端前端 (UI & 图像预处理)

* **超大截图客户端等比缩放与有损 WebP 压缩**
  在 [main.js](file:///home/yelon/develop/me/eqrcp/desktop/gui/frontend/src/main.js) 中实现了 [compressImageToWebP](file:///home/yelon/develop/me/eqrcp/desktop/gui/frontend/src/main.js#L4467) 图像预处理：
  1. **等比缩放**：如果图片的宽或高超过了 `1200px`，自动等比例缩小至最大边为 `1200px`。
  2. **有损压缩**：通过 Canvas 生成 `quality = 0.75` 的 WebP 格式 Base64 数据。
  3. **优雅降级**：若当前运行环境不支持 WebP，则自动降级生成有损 `image/jpeg`。
  经过处理后，原本 **5MB+** 的大图可缩减至 **100KB ~ 200KB**（缩减 95% 以上），极大降低上传等待时长与服务端的带宽占用。

* **状态防呆与交互流优化**
  1. 当用户关闭反馈面板时，自动清理正在输入的文本、图片以及错误或通知提示状态，确保再次打开时界面是干净的。
  2. 当用户在反馈面板中编辑文本、联系方式或改变类别时，自动清除旧的发送错误或成功提示。
  3. 成功提交后，不仅重置 state，还会物理清理文本域 DOM 节点的值，防范用户不小心触发重复提交。

* **支持手动 Fallback 复制**
  如遇用户本地网络隔离或自动发送失败，前端提供“Copy feedback”一键复制按钮。程序会将当前表单正文、选中的反馈类型、以及详细的系统诊断日志（包含 CPU/OS/Arch/Version）合并格式化，拷贝至系统剪贴板。提示用户可通过手动发送邮件给开发者（`jinxpeeter@outlook.com`）。

### 3.2 桌面端 Go 后端中转 (Wails Bridge)

本地前端没有直接通过网络请求发送至 Cloudflare Worker 接口，而是调用了 Wails 桥接的 Go 导出方法 [SubmitFeedback](file:///home/yelon/develop/me/eqrcp/desktop/gui/app.go#L1227)：
* **规避 CORS 问题**：所有网络请求在本地进程的 Go 运行时中发起，从物理上杜绝了浏览器的跨域安全性（CORS Preflight）拦截问题。
* **本地 Trace 与诊断审计**：Go 后端在发送前，会在应用控制台和本地日志中打印提交审计（分类、联系邮箱、正文长度、是否有图），并使用具有超时机制的 `http.Client` 执行 POST，如果遇到异常状态码，会将服务端返回的具体错误详情捕获，并如实输出至桌面端 `.log` 日志中，极易定位传输链路故障。

### 3.3 云端 Serverless 架构 (Cloudflare + Telegram)

* **Cloudflare Workers**
  作为高并发的边缘计算网关，Worker 拥有超高的响应速度，并且免费额度充足（10w 请求/天）。
* **R2 静态图片存储与 GET CDN 路由**
  Worker 解析 Base64 图片后，在内存中将其解码为 ArrayBuffer 写入 Cloudflare R2 存储桶，分配唯一的 key。同时提供了 `GET /image/:key` 接口直接响应图片的 GET 请求，通过 R2 元数据设置 `Content-Type` 为 `image/webp`，并自带一年的长效 CDN 缓存头 `Cache-Control: public, max-age=31536000`。
* **D1 结构化 SQL 数据库**
  通过 Cloudflare D1，反馈的分类（bug, transfer, gui, feature, license, other）、邮箱、消息正文、图片的 R2 URL、时间戳以及客户端环境参数都会被写进结构化的 `feedbacks` 关系表中，省去搭建独立数据服务器的麻烦。
* **Telegram Bot 异步即时推送**
  在向客户端响应 `200 Success` 前，Worker 通过 `ctx.waitUntil` 异步在后台发起对 Telegram Bot API 的图文消息推送。
  1. 保证了客户端请求的极速返回（不需要等待 Telegram 接口响应）。
  2. 在管理员的 Telegram 频道/群组中，Bot 以格式化的 HTML 富文本展示详细的报错/意见内容，若有图片，则直接展示图片并将文本作为 Photo Caption 附带发送（最大 1024 字符限制处理），实现秒级通知。

---

## 4. 接口数据载荷规范 (API Payload)

### 4.1 客户端提交 (POST `/goal` 或 `/`)
```json
{
  "category": "bug",
  "contact": "user@example.com",
  "message": "用户反馈的正文信息以及诊断信息...",
  "timestamp": "2026-06-30T15:13:00Z",
  "imageData": "data:image/webp;base64,UklGRq4AAABXRUJQVlA4T...",
  "imageFormat": "image/webp",
  "clientInfo": {
    "version": "v1.7.98",
    "os": "windows/amd64"
  }
}
```

### 4.2 服务端响应 (200 OK)
```json
{
  "status": "success",
  "imageUrl": "https://feedback.eqt.net.im/image/feedback-1698765432-abcdef.webp"
}
```

---

## 5. 云端 Worker 核心实现代码

参考代码位置：[cloudflare/eqt-feedback-api/src/index.ts](file:///home/yelon/develop/me/eqrcp/cloudflare/eqt-feedback-api/src/index.ts)

以下是运行在 Cloudflare Workers 中的路由中转和 Telegram Bot 推送逻辑：

```typescript
export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. 跨域 OPTIONS 预检
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // 2. 路由：GET /image/:key (从 R2 获取 WebP 图片)
    if (request.method === "GET" && url.pathname.startsWith("/image/")) {
      const filename = url.pathname.substring(7);
      if (!filename) return new Response("Filename missing", { status: 400 });

      try {
        const object = await env.BUCKET.get(filename);
        if (!object) {
          return new Response("Image not found", {
            status: 404,
            headers: { "Access-Control-Allow-Origin": "*" }
          });
        }

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Content-Type", "image/webp");
        headers.set("Cache-Control", "public, max-age=31536000");

        return new Response(object.body, { headers });
      } catch (err: any) {
        return new Response(`Error retrieving image: ${err.message}`, {
          status: 500,
          headers: { "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // 3. 路由：POST / 或 POST /goal (提交反馈)
    if (request.method === "POST" && (url.pathname === "/goal" || url.pathname === "/")) {
      try {
        const payload: any = await request.json();
        const { message, category, contact, timestamp, clientInfo, imageData, imageFormat } = payload;

        if (!message || !category) {
          return new Response(JSON.stringify({ error: "Missing required fields (message, category)" }), {
            status: 400,
            headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }
          });
        }

        let imageUrl: string | null = null;

        // 4. 解码 Base64 并上传至 R2
        if (imageData && imageData.startsWith("data:image/")) {
          const base64Index = imageData.indexOf("base64,");
          if (base64Index !== -1) {
            const base64Data = imageData.substring(base64Index + 7);
            const binaryString = atob(base64Data);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }

            const format = imageFormat || "image/webp";
            const ext = format.split("/")[1] || "webp";
            const filename = `feedback-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`;

            await env.BUCKET.put(filename, bytes.buffer, {
              httpMetadata: { contentType: format }
            });

            imageUrl = `https://feedback.eqt.net.im/image/${filename}`;
          }
        }

        const clientVer = clientInfo?.version || null;
        const clientOs = clientInfo?.os || null;
        const submitTime = timestamp || new Date().toISOString();

        // 5. 写入 D1 SQL 数据库
        await env.DB.prepare(
          `INSERT INTO feedbacks (category, contact, message, image_url, timestamp, client_version, client_os)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(category, contact || null, message, imageUrl, submitTime, clientVer, clientOs)
        .run();

        // 6. 异步后台触发 Telegram Bot 通知，绝不拖慢客户端耗时
        if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
          ctx.waitUntil(
            sendTelegramNotification(
              env.TELEGRAM_BOT_TOKEN,
              env.TELEGRAM_CHAT_ID,
              {
                category,
                contact: contact || "未提供",
                message,
                clientVersion: clientVer || "未知",
                clientOs: clientOs || "未知",
                timestamp: submitTime,
                imageUrl
              }
            )
          );
        }

        return new Response(JSON.stringify({ status: "success", imageUrl }), {
          status: 200,
          headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }
        });

      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }
        });
      }
    }

    return new Response("Not Found", {
      status: 404,
      headers: { "Access-Control-Allow-Origin": "*" }
    });
  }
};
```
