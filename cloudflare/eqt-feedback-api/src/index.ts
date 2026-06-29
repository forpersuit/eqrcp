export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. Handle CORS Preflight
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

    // 2. Routing: GET /image/:key
    if (request.method === "GET" && url.pathname.startsWith("/image/")) {
      const filename = url.pathname.substring(7); // remove "/image/"
      if (!filename) {
        return new Response("Filename missing", { status: 400 });
      }

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

        return new Response(object.body, {
          headers,
        });
      } catch (err: any) {
        return new Response(`Error retrieving image: ${err.message}`, {
          status: 500,
          headers: { "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // 3. Routing: POST /goal or POST /
    if (request.method === "POST" && (url.pathname === "/goal" || url.pathname === "/")) {
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
          return new Response(JSON.stringify({ error: "Missing required fields (message, category)" }), {
            status: 400,
            headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }
          });
        }

        let imageUrl: string | null = null;

        // 4. Save image to R2 if exists
        if (imageData && imageData.startsWith("data:image/")) {
          // Extract base64 content
          const base64Index = imageData.indexOf("base64,");
          if (base64Index !== -1) {
            const base64Data = imageData.substring(base64Index + 7);
            
            // Convert Base64 to ArrayBuffer
            const binaryString = atob(base64Data);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }

            const format = imageFormat || "image/webp";
            const ext = format.split("/")[1] || "webp";
            const filename = `feedback-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`;

            // Save to R2
            await env.BUCKET.put(filename, bytes.buffer, {
              httpMetadata: { contentType: format }
            });

            // Construct feedback.eqt.net.im/image/:key URL
            imageUrl = `https://feedback.eqt.net.im/image/${filename}`;
          }
        }

        const clientVer = clientInfo?.version || null;
        const clientOs = clientInfo?.os || null;
        const submitTime = timestamp || new Date().toISOString();

        // 5. Insert into D1 Database
        await env.DB.prepare(
          `INSERT INTO feedbacks (category, contact, message, image_url, timestamp, client_version, client_os)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(category, contact || null, message, imageUrl, submitTime, clientVer, clientOs)
        .run();

        // 6. Push Notification to Telegram Bot (Async Background)
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
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json"
          }
        });

      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json"
          }
        });
      }
    }

    // Default 404
    return new Response("Not Found", {
      status: 404,
      headers: { "Access-Control-Allow-Origin": "*" }
    });
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
