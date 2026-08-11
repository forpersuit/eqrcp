import { logStructuredRequest } from './structured-logger';

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const startMs = Date.now();
    const url = new URL(request.url);

    // 1. Handle CORS Preflight
    if (request.method === "OPTIONS") {
      const resp = new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
      ctx.waitUntil(logStructuredRequest(request, resp, startMs));
      return resp;
    }

    let response: Response | null = null;

    // 2. Health check endpoint (for UptimeRobot external monitoring)
    if (request.method === "GET" && url.pathname === "/api/v1/health") {
      const dbStart = Date.now();
      let dbConnected = false;
      let dbLatencyMs = 0;
      try {
        await env.DB.prepare("SELECT 1 as ok").first();
        dbLatencyMs = Date.now() - dbStart;
        dbConnected = true;
      } catch {
        dbLatencyMs = Date.now() - dbStart;
      }

      let r2Connected = false;
      let r2LatencyMs = 0;
      const r2Start = Date.now();
      try {
        const obj = await env.BUCKET.head("health-probe");
        r2Connected = true;
        r2LatencyMs = Date.now() - r2Start;
      } catch {
        r2LatencyMs = Date.now() - r2Start;
        // head() returns null for non-existent keys (not an error),
        // so a thrown exception means the bucket is unreachable
        r2Connected = false;
      }

      const status = dbConnected ? "healthy" : "degraded";
      response = new Response(JSON.stringify({
        status,
        d1: { connected: dbConnected, queryLatencyMs: dbLatencyMs },
        r2: { connected: r2Connected, queryLatencyMs: r2LatencyMs },
        timestamp: new Date().toISOString()
      }), {
        status: dbConnected ? 200 : 503,
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }
      });
    }

    // 3. Routing: GET /image/:key
    if (request.method === "GET" && url.pathname.startsWith("/image/")) {
      const filename = url.pathname.substring(7);
      if (!filename) {
        response = new Response("Filename missing", { status: 400 });
      } else {
        try {
          const object = await env.BUCKET.get(filename);
          if (!object) {
            response = new Response("Image not found", {
              status: 404,
              headers: { "Access-Control-Allow-Origin": "*" }
            });
          } else {
            const headers = new Headers();
            object.writeHttpMetadata(headers);
            headers.set("Access-Control-Allow-Origin", "*");
            headers.set("Content-Type", "image/webp");
            headers.set("Cache-Control", "public, max-age=31536000");
            response = new Response(object.body, { headers });
          }
        } catch (err: any) {
          response = new Response(`Error retrieving image: ${err.message}`, {
            status: 500,
            headers: { "Access-Control-Allow-Origin": "*" }
          });
        }
      }
    }

    // 3. Routing: POST /goal or POST /
    if (!response && request.method === "POST" && (url.pathname === "/goal" || url.pathname === "/")) {
      try {
        const payload: any = await request.json();
        const {
          message,
          category,
          contact,
          timestamp,
          clientInfo,
          imageData,
          imageFormat
        } = payload;

        if (!message || !category) {
          response = new Response(JSON.stringify({ error: "Missing required fields (message, category)" }), {
            status: 400,
            headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }
          });
        } else {
          let imageUrl: string | null = null;

          // 4. Save image to R2 if exists
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

          await env.DB.prepare(
            `INSERT INTO feedbacks (category, contact, message, image_url, timestamp, client_version, client_os)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(category, contact || null, message, imageUrl, submitTime, clientVer, clientOs)
          .run();

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

          response = new Response(JSON.stringify({ status: "success", imageUrl }), {
            status: 200,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Content-Type": "application/json"
            }
          });
        }
      } catch (err: any) {
        response = new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json"
          }
        });
      }
    }

    // Default 404
    if (!response) {
      response = new Response("Not Found", {
        status: 404,
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }

    ctx.waitUntil(logStructuredRequest(request, response, startMs));
    return response;
  }
};

// Helper function to escape HTML characters for Telegram HTML parse mode
function escapeHTML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendTelegramNotification(
  token: string,
  chatId: string,
  data: {
    category: string;
    contact: string;
    message: string;
    clientVersion: string;
    clientOs: string;
    timestamp: string;
    imageUrl: string | null;
  }
) {
  const parseCategory = (cat: string) => {
    switch (cat) {
      case "bug": return "🐛 Bug报告";
      case "transfer": return "🚀 传输失败";
      case "gui": return "🎨 GUI界面问题";
      case "feature": return "💡 新功能建议";
      case "license": return "🔑 购买或授权";
      default: return "📝 其他反馈";
    }
  };

  const formattedTime = new Date(data.timestamp).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

  const text = `<b>📌 EQT 收到新反馈 [${parseCategory(data.category)}]</b>\n` +
    `--------------------------------------\n` +
    `<b>📬 联系邮箱:</b> ${escapeHTML(data.contact)}\n` +
    `<b>📱 客户端版本:</b> ${escapeHTML(data.clientVersion)}\n` +
    `<b>💻 运行系统:</b> ${escapeHTML(data.clientOs)}\n` +
    `<b>⏰ 提交时间:</b> ${formattedTime}\n\n` +
    `<b>💬 反馈内容:</b>\n` +
    `${escapeHTML(data.message)}`;

  try {
    let url = `https://api.telegram.org/bot${token}/sendMessage`;
    let body: any = {
      chat_id: chatId,
      parse_mode: "HTML",
    };

    if (data.imageUrl) {
      url = `https://api.telegram.org/bot${token}/sendPhoto`;
      body.photo = data.imageUrl;
      body.caption = text.substring(0, 1024); // Telegram photo caption length limit is 1024
    } else {
      body.text = text;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Telegram API error: ${response.status} - ${errText}`);
    }
  } catch (err: any) {
    console.error(`Failed to send Telegram notification: ${err.message}`);
  }
}
