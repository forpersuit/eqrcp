# EQT 一键反馈系统升级设计方案 (零成本与零运维)

本文档旨在为 EQT (eqrcp) 设计一个轻量、好用、且**零服务器运维成本、极低流量带宽消耗**的应用内一键反馈系统，并适配国内团队的开发和接收生态。

---

## 1. 背景与痛点

目前 EQT 桌面客户端的反馈功能依靠 [mailto:](file:///home/yelon/develop/me/eqrcp/desktop/gui/frontend/src/main.js#L3776-L3780) 机制：
1. **唤起阻碍**：如果用户操作系统未配置默认邮件客户端，点击无响应。
2. **体验割裂**：用户必须离开当前应用到外部发送，无法一键无感提交。
3. **大图传输昂贵**：如果反馈带截图，4K 屏幕的高清 PNG 截图体积一般在 **5MB ~ 10MB** 左右。直接上传不仅严重消耗用户的上行宽带，也会给我们的 API 接口带来高昂的流量与 CPU 解码成本。

---

## 2. 核心架构设计：前端 WebP 压缩 + Cloudflare + 飞书多维表格

为解决上述痛点，本方案基于**第一性原理（First Principle）**进行优化，在**不租赁任何云服务器、不编写任何看板网页**的情况下，实现高性能数据处理与漂亮的仪表盘统计。

```
                    ┌─────────────────────────┐
                    │      客户端前端 (GUI)     │
                    └────────────┬────────────┘
                                 │ 1. Canvas 有损压缩至 WebP (Quality 0.75)
                                 ▼
                    ┌─────────────────────────┐
                    │    Cloudflare Workers   │
                    └─────┬─────────────┬─────┘
  2. 写入数据 (免费)      │             │  3. 推送卡片 (免费)
  (每天 500w 读/10w 写)   │             │  (飞书自定义群机器人 Webhook)
                          ▼             ▼
  ┌─────────────────────────┐     ┌─────────────────────────┐
  │ 飞书多维表格 (Bitable)  │     │ 飞书客户端/企业微信/Bot  │
  └───────────┬─────────────┘     └─────────────────────────┘
              │ 4. 原生看板功能
              ▼
  ┌─────────────────────────┐
  │   每日数据统计仪表盘    │
  └─────────────────────────┘
```

### 2.1 客户端前端图像压缩 (节省 95%+ 流量)
* 截图或大图片（如 PNG）在客户端提交前，在 JavaScript 中利用 `HTMLCanvasElement` 进行有损压缩，转换成 **WebP**（首选）或 **JPEG** 格式，压缩率设为 `0.75 - 0.8`。
* 压缩后图片体积可从 **5MB 降至 100KB ~ 200KB**，仅需传输极小的 Base64 或 Binary 数据，使服务器网络处理零压力。

### 2.2 Cloudflare Workers API 网关
* **定位**：纯 Serverless 路由与数据中转，免除了维护物理服务器的繁琐。
* **计费**：免费计划享有 **100,000 次请求/天**，对反馈场景绰绰有余。
* **职责**：解析客户端 JSON，分离文本与 Base64 图片，并格式化输出给持久化存储和即时 Bot。

### 2.3 飞书多维表格 (Bitable) 作为云端数据库
* **免开发看板**：使用多维表格作为后台数据库，云端永久免费。
* **数据仪表盘**：多维表格自带精美的可视化仪表盘（折线图、饼图等），可自动生成“每日反馈增长图”、“反馈分类汇总（Bug报告/建议/界面问题）”。开发者无需开发和运维任何数据后台网站，直接在飞书客户端中即可查看完整统计。

### 2.4 飞书群机器人 (消息推送与提醒)
* 飞书提供极其友好的自定义群机器人 Webhook，每分钟额度高达 **100 条**，完全免费。
* 接收到反馈后，Worker 组装富文本卡片（Feishu Card），直接在群里推送带压缩截图链接、诊断日志和反馈正文的消息。

---

## 3. 接口数据载荷规范 (API Payload)

客户端提交反馈时，向 `/api/feedback` 发送 `application/json` 请求：

```json
{
  "message": "在传输多文件时，进度条偶尔会卡在 99% 不动。",
  "imageFormat": "image/webp",
  "imageData": "data:image/webp;base64,UklGRq4AAABXRUJQVlA4T...",
  "timestamp": "2026-06-28T16:52:00Z",
  "clientInfo": {
    "version": "EQT v1.2.3",
    "os": "windows/amd64",
    "historyCount": 12
  }
}
```

---

## 4. Cloudflare Worker 中转实现代码

以下是直接部署在 Cloudflare Worker 的中转脚本示例：

```javascript
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        }
      });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    try {
      const payload = await request.json();
      const { message, imageFormat, imageData, timestamp, clientInfo } = payload;

      // 1. 将数据写入飞书多维表格 (通过飞书 API)
      // (具体逻辑：先获取 tenant_access_token，然后 POST 写入表格)
      await writeToBitable(payload, env);

      // 2. 将消息推送给飞书群机器人
      const botUrl = env.FEISHU_BOT_WEBHOOK_URL;
      const cardContent = {
        msg_type: "interactive",
        card: {
          header: {
            title: { tag: "plain_text", content: "🔴 收到 EQT 客户端新反馈" },
            template: "red"
          },
          elements: [
            {
              tag: "div",
              text: { tag: "lark_md", content: `**内容**: ${message}\n**版本**: ${clientInfo?.version || '未知'}` }
            }
          ]
        }
      };

      await fetch(botUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cardContent)
      });

      return new Response(JSON.stringify({ status: "success" }), {
        status: 200,
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }
      });
    }
  }
};
```

---

## 5. 本地无侵入测试套件说明

我们在本地创建了一套**不修改原有工程代码**的测试工具，以便开发者直接验证整个链路：

1. **测试服务端**：`go run feedback_receiver.go` (监听本地 `8089` 端口，将接收的数据存入内存并写入本地文件)。
2. **发送端测试页面**：[image_compress_test.html](file:///home/yelon/.gemini/antigravity-cli/brain/3f7399e9-5fb7-41fb-b1e5-b1119347edb3/scratch/image_compress_test.html) (测试前端 Canvas 压缩 WebP/JPEG 分辨率及提交)。
3. **数据看板页面**：[feedback_dashboard_test.html](file:///home/yelon/.gemini/antigravity-cli/brain/3f7399e9-5fb7-41fb-b1e5-b1119347edb3/scratch/feedback_dashboard_test.html) (向服务端发起 GET 请求，拉取列表并实时展示每日反馈统计数据)。
