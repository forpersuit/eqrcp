import { connect } from 'cloudflare:sockets';

export interface Env {
  DB: D1Database;
  ED25519_PRIVATE_KEY: string; // 64-char hex string (32 bytes raw private key)
  ADMIN_SECRET?: string;       // Secret header to allow manually generating licenses
  GITHUB_TOKEN?: string;       // Optional token to prevent GitHub Rate Limit
  GITHUB_REPO?: string;        // Optional repository path, default 'forpersuit/eqrcp'
  R2_PUBLIC_URL?: string;      // Optional public CDN url for R2 assets download redirection
  PADDLE_WEBHOOK_SECRET?: string; // Webhook secret key from Paddle notifications dashboard
  MAIL_SENDER?: string;
  MAIL_SENDER_PASSWORD?: string;
  MAIL_SEND_SERVER?: string;
  MAIL_SEND_SAFE_PORT?: string;
  TEST_MAIL_RECEIVER?: string;
  PADDLE_API_KEY?: string;
}

const PRICE_LIFETIME_ID = "pri_01kxymyma34hgmndccwswheta3";
const PRICE_YEARLY_ID = "pri_01kxymxqngex49tg65wb0701pc";

// Helper to verify Paddle Billing webhook signatures
async function verifyPaddleSignature(
  rawBody: string,
  signatureHeader: string | null,
  secretKey: string
): Promise<boolean> {
  if (!signatureHeader || !secretKey) return false;

  const parts = signatureHeader.split(";");
  if (parts.length !== 2) return false;

  const timestampPart = parts.find(p => p.startsWith("ts="));
  const signaturePart = parts.find(p => p.startsWith("h1="));

  if (!timestampPart || !signaturePart) return false;

  const ts = timestampPart.split("=")[1];
  const h1 = signaturePart.split("=")[1];

  if (!ts || !h1) return false;

  // Validate timestamp drift (5 minutes / 300 seconds limit)
  const timestampInt = parseInt(ts) * 1000;
  if (isNaN(timestampInt)) return false;
  const currentTime = Date.now();
  if (Math.abs(currentTime - timestampInt) > 300 * 1000) {
    return false;
  }

  const encoder = new TextEncoder();
  const keyData = encoder.encode(secretKey);
  const messageData = encoder.encode(`${ts}:${rawBody}`);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuf = await crypto.subtle.sign("HMAC", key, messageData);
  const signatureHex = Array.prototype.map.call(
    new Uint8Array(signatureBuf),
    (x: number) => ('00' + x.toString(16)).slice(-2)
  ).join('');

  return signatureHex === h1;
}

// Helper to convert hex string to Uint8Array
function hexToUint8Array(hex: string): Uint8Array {
  hex = hex.trim();
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }
  const array = new Uint8Array(hex.length / 2);
  for (let i = 0; i < array.length; i++) {
    array[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return array;
}

// Helper to convert array buffer to hex string
function bufToHex(buffer: ArrayBuffer): string {
  return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
}

interface MailOptions {
  sender: string;
  senderPass: string;
  host: string;
  port: number;
  to: string;
  subject: string;
  html: string;
}

// SMTP over TLS client implementing SMTP protocol over secure connect() socket
async function sendMailViaSmtp(options: MailOptions): Promise<void> {
  const socket = connect({ hostname: options.host, port: options.port }, { secureTransport: "on" });
  
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  let buffer = "";

  async function readLine(): Promise<string> {
    while (true) {
      const idx = buffer.indexOf("\r\n");
      if (idx !== -1) {
        const line = buffer.substring(0, idx);
        buffer = buffer.substring(idx + 2);
        return line;
      }
      const { value, done } = await reader.read();
      if (done) {
        if (buffer.length > 0) {
          const line = buffer;
          buffer = "";
          return line;
        }
        throw new Error("SMTP server closed connection unexpectedly");
      }
      buffer += decoder.decode(value, { stream: true });
    }
  }

  async function readResponse(): Promise<{ code: number; lines: string[] }> {
    const lines: string[] = [];
    while (true) {
      const line = await readLine();
      lines.push(line);
      if (line.match(/^\d{3} /)) {
        const code = parseInt(line.substring(0, 3));
        return { code, lines };
      }
    }
  }

  async function sendCmd(cmd: string, expectedCode: number): Promise<void> {
    await writer.write(encoder.encode(cmd + "\r\n"));
    const resp = await readResponse();
    if (resp.code !== expectedCode) {
      throw new Error(`SMTP command '${cmd.split(' ')[0]}' failed. Expected ${expectedCode}, got ${resp.code}: ${resp.lines.join("; ")}`);
    }
  }

  try {
    const greet = await readResponse();
    if (greet.code !== 220) {
      throw new Error(`SMTP connection greeting failed: ${greet.lines.join("; ")}`);
    }

    await sendCmd("EHLO eqt-drm-api", 250);
    await sendCmd("AUTH LOGIN", 334);
    
    const userBase64 = btoa(options.sender);
    await sendCmd(userBase64, 334);

    const passBase64 = btoa(options.senderPass);
    await sendCmd(passBase64, 235);

    await sendCmd(`MAIL FROM:<${options.sender}>`, 250);
    await sendCmd(`RCPT TO:<${options.to}>`, 250);
    await sendCmd("DATA", 354);

    const bodyLines = [
      `From: "EQT" <${options.sender}>`,
      `To: <${options.to}>`,
      `Subject: ${options.subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset="utf-8"`,
      ``,
      options.html,
      `.`
    ];
    await sendCmd(bodyLines.join("\r\n"), 250);
    await sendCmd("QUIT", 221);
  } finally {
    writer.releaseLock();
    reader.releaseLock();
    await socket.close();
  }
}

async function sendDRMEmail(env: Env, to: string, subject: string, html: string): Promise<void> {
  const host = env.MAIL_SEND_SERVER;
  const pass = env.MAIL_SENDER_PASSWORD;
  const sender = env.MAIL_SENDER;
  const portStr = env.MAIL_SEND_SAFE_PORT;

  if (!host || !pass || !sender || !portStr) {
    console.warn("DRM SMTP Send Warning: SMTP credentials are not fully configured in env, skipping email delivery.");
    return;
  }

  const port = parseInt(portStr) || 465;
  try {
    await sendMailViaSmtp({
      sender,
      senderPass: pass,
      host,
      port,
      to,
      subject,
      html
    });
    console.log(`DRM SMTP Send Success: Email successfully sent to ${to} with subject "${subject}"`);
  } catch (err: any) {
    console.error(`DRM SMTP Send Error to ${to}:`, err.message || err);
  }
}


// Perform 3-of-2 matching check between client hashes and a stored activation record
function matchFingerprint(
  clientUuid: string, clientCpu: string, clientDisk: string,
  storedUuid: string, storedCpu: string, storedDisk: string
): boolean {
  let matches = 0;
  if (clientUuid && storedUuid && clientUuid === storedUuid) matches++;
  if (clientCpu && storedCpu && clientCpu === storedCpu) matches++;
  if (clientDisk && storedDisk && clientDisk === storedDisk) matches++;
  return matches >= 2;
}

// Check if the buyer's email or the current device fingerprint is blacklisted due to repetitive refund behavior (>= 2 times)
async function checkAbusiveRefundBlacklist(
  env: Env,
  buyerEmailHash: string | null,
  uuidHash: string,
  cpuHash: string,
  diskHash: string
): Promise<{ isAbusive: boolean; reason: string }> {
  // 1. Email-based blacklist check
  if (buyerEmailHash) {
    const res = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM licenses WHERE buyer_email_hash = ? AND status = 'revoked'"
    ).bind(buyerEmailHash).first<any>();
    if (res && res.count >= 2) {
      return {
        isAbusive: true,
        reason: "This email address is blacklisted due to multiple refund/revocation activities."
      };
    }
  }

  // 2. Device fingerprint-based blacklist check
  if (uuidHash || cpuHash || diskHash) {
    // Fetch activations associated with revoked licenses
    const { results: revokedActivations } = await env.DB.prepare(`
      SELECT a.uuid_hash, a.cpu_hash, a.disk_hash 
      FROM activations a
      JOIN licenses l ON a.license_code = l.license_code
      WHERE l.status = 'revoked'
    `).all<any>();

    let refundMatchCount = 0;
    for (const act of revokedActivations) {
      if (matchFingerprint(
        uuidHash || "", cpuHash || "", diskHash || "",
        act.uuid_hash || "", act.cpu_hash || "", act.disk_hash || ""
      )) {
        refundMatchCount++;
        if (refundMatchCount >= 2) {
          return {
            isAbusive: true,
            reason: "This device is blacklisted due to multiple refund/revocation activities."
          };
        }
      }
    }
  }

  return { isAbusive: false, reason: "" };
}

// Helper to fetch latest release from GitHub
async function fetchLatestRelease(env: Env): Promise<any> {
  const repo = env.GITHUB_REPO || "forpersuit/eqrcp";
  const ghUrl = `https://api.github.com/repos/${repo}/releases/latest`;
  
  const headers: Record<string, string> = {
    "User-Agent": "EQT-Update-Worker",
    "Accept": "application/vnd.github+json",
  };
  
  if (env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${env.GITHUB_TOKEN}`;
  }

  const ghRes = await fetch(ghUrl, { headers });
  if (!ghRes.ok) {
    return { error: `Failed to fetch latest release from GitHub: ${ghRes.statusText}` };
  }

  return await ghRes.json();
}

// Handler for requests targeted to download.eqt.net.im
async function handleDownloadDomain(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  corsHeaders: any
): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // 1. Root path -> Redirect to official homepage
  if (pathname === "/" || pathname === "") {
    return Response.redirect("https://www.eqt.net.im", 302);
  }

  // 2. GET /update-metadata.json
  if (pathname === "/update-metadata.json" && (request.method === "GET" || request.method === "HEAD")) {
    const cacheKey = new Request(url.toString(), request);
    const cache = caches.default;
    let response = await cache.match(cacheKey);
    if (response) {
      return response;
    }

    const latestRelease = await fetchLatestRelease(env);
    if (latestRelease.error) {
      return new Response(JSON.stringify({ error: latestRelease.error }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const version = latestRelease.tag_name;
    const result = {
      version: version,
      published_at: latestRelease.published_at,
      changelog: latestRelease.body || "",
      assets: (latestRelease.assets || []).map((asset: any) => {
        return {
          name: asset.name,
          download_url: `https://download.eqt.net.im/downloads/${version}/${asset.name}`,
          size: asset.size
        };
      })
    };

    response = new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=60" // Cache in edge for 1 minute
      }
    });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }

  // 3. GET /downloads/:version/:filename
  // Pattern: /downloads/([^/]+)/(.+)
  const downloadMatch = pathname.match(/^\/downloads\/([^/]+)\/(.+)$/);
  if (downloadMatch && (request.method === "GET" || request.method === "HEAD")) {
    let version = downloadMatch[1];
    const filename = downloadMatch[2];

    if (version === "latest") {
      const latestRelease = await fetchLatestRelease(env);
      if (latestRelease.error) {
        return new Response(JSON.stringify({ error: latestRelease.error }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      version = latestRelease.tag_name;
    }

    let redirectUrl = `https://github.com/forpersuit/eqrcp/releases/download/${version}/${filename}`;
    if (env.R2_PUBLIC_URL) {
      const base = env.R2_PUBLIC_URL.endsWith('/') ? env.R2_PUBLIC_URL.slice(0, -1) : env.R2_PUBLIC_URL;
      redirectUrl = `${base}/downloads/${version}/${filename}`;
    }
    return Response.redirect(redirectUrl, 302);
  }

  // Fallback: redirect any unmatched downloads domain requests to the main website
  return Response.redirect("https://www.eqt.net.im", 302);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS Headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Secret",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Route request to download handler if host matches download.eqt.net.im,
      // or if pathname matches download routes (to support dev/testing on workers.dev or localhost).
      if (
        (url.hostname === "download.eqt.net.im" ||
         url.hostname.endsWith(".workers.dev") ||
         url.hostname === "localhost" ||
         url.hostname === "127.0.0.1" ||
         url.pathname === "/update-metadata.json" ||
         url.pathname.startsWith("/downloads/")) &&
        !url.pathname.startsWith("/api/v1/")
      ) {
        return await handleDownloadDomain(request, env, ctx, corsHeaders);
      }

      // 0.1 Send email verification code
      if (url.pathname === "/api/v1/auth/send-code" && request.method === "POST") {
        const body: any = await request.json();
        let email = body.email;
        if (!email) {
          return new Response(JSON.stringify({ error: "Missing email" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        email = email.trim().toLowerCase();

        // Generate 6 digit verification code
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // Valid for 5 minutes

        // Insert code into DB
        await env.DB.prepare(
          "INSERT OR REPLACE INTO verification_codes (email, code, expires_at) VALUES (?, ?, ?)"
        ).bind(email, code, expiresAt).run();

        // Send mail via SMTPS
        const mailSender = env.MAIL_SENDER || "noreply@eqt.net.im";
        const mailSenderPassword = env.MAIL_SENDER_PASSWORD || "q4W62}bWtR";
        const mailSendServer = env.MAIL_SEND_SERVER || "smtpserver.301098.xyz";
        const mailSendPort = parseInt(env.MAIL_SEND_SAFE_PORT || "465");
        
        const targetEmail = env.TEST_MAIL_RECEIVER || email;

        try {
          await sendMailViaSmtp({
            sender: mailSender,
            senderPass: mailSenderPassword,
            host: mailSendServer,
            port: mailSendPort,
            to: targetEmail,
            subject: "[EQT] Login Verification Code",
            html: `<p>Your EQT login verification code is: <strong style="font-size: 18px; color: #6200ee;">${code}</strong></p><p>This code is valid for 5 minutes. If you did not request this, please ignore this email.</p>`
          });
        } catch (mailErr: any) {
          console.error("Mail Send Error:", mailErr);
          return new Response(JSON.stringify({ 
            error: "Failed to send verification email: " + mailErr.message,
            code: env.TEST_MAIL_RECEIVER ? code : undefined 
          }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        return new Response(JSON.stringify({ 
          success: true, 
          message: "Verification code sent successfully",
          code: env.TEST_MAIL_RECEIVER ? code : undefined 
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 0.2 Verify email verification code and issue session token
      if (url.pathname === "/api/v1/auth/verify-code" && request.method === "POST") {
        const body: any = await request.json();
        let { email, code } = body;
        if (!email || !code) {
          return new Response(JSON.stringify({ error: "Missing email or code" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        email = email.trim().toLowerCase();
        code = code.trim();

        const record = await env.DB.prepare(
          "SELECT * FROM verification_codes WHERE email = ?"
        ).bind(email).first<any>();

        if (!record || record.code !== code) {
          return new Response(JSON.stringify({ error: "Invalid verification code" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const expiresAt = new Date(record.expires_at).getTime();
        if (expiresAt < Date.now()) {
          return new Response(JSON.stringify({ error: "Verification code expired" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Delete verification code
        await env.DB.prepare("DELETE FROM verification_codes WHERE email = ?").bind(email).run();

        // Generate session token
        const sessionBytes = new Uint8Array(16);
        crypto.getRandomValues(sessionBytes);
        const sessionToken = Array.from(sessionBytes, b => ('00' + b.toString(16)).slice(-2)).join('');
        const sessionExpiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString(); // 24 hours validity

        // Insert user session
        await env.DB.prepare(
          "INSERT OR REPLACE INTO user_sessions (session_token, email, expires_at) VALUES (?, ?, ?)"
        ).bind(sessionToken, email, sessionExpiresAt).run();

        return new Response(JSON.stringify({
          success: true,
          session_token: sessionToken,
          email: email
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 0.3 Get user licenses history and status
      if (url.pathname === "/api/v1/user/licenses" && request.method === "GET") {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        const token = authHeader.substring(7);

        const session = await env.DB.prepare(
          "SELECT * FROM user_sessions WHERE session_token = ?"
        ).bind(token).first<any>();

        if (!session || new Date(session.expires_at).getTime() < Date.now()) {
          return new Response(JSON.stringify({ error: "Session expired or invalid" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const email = session.email;
        const encoder = new TextEncoder();
        const emailHashBuf = await crypto.subtle.digest("SHA-256", encoder.encode(email));
        const emailHash = Array.prototype.map.call(new Uint8Array(emailHashBuf), x => ('00' + x.toString(16)).slice(-2)).join('');

        const { results: licenses } = await env.DB.prepare(
          "SELECT * FROM licenses WHERE buyer_email_hash = ? ORDER BY created_at DESC"
        ).bind(emailHash).all<any>();

        const list: any[] = [];
        for (const lic of licenses) {
          const { results: activations } = await env.DB.prepare(
            "SELECT * FROM activations WHERE license_code = ?"
          ).bind(lic.license_code).all<any>();
          
          list.push({
            ...lic,
            activations: activations
          });
        }

        return new Response(JSON.stringify({
          success: true,
          email: email,
          licenses: list
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 0.4 Refund license
      if (url.pathname === "/api/v1/user/refund" && request.method === "POST") {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        const token = authHeader.substring(7);

        const session = await env.DB.prepare(
          "SELECT * FROM user_sessions WHERE session_token = ?"
        ).bind(token).first<any>();

        if (!session || new Date(session.expires_at).getTime() < Date.now()) {
          return new Response(JSON.stringify({ error: "Session expired or invalid" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const body: any = await request.json();
        const { license_code } = body;
        if (!license_code) {
          return new Response(JSON.stringify({ error: "Missing license_code" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const license = await env.DB.prepare(
          "SELECT * FROM licenses WHERE license_code = ?"
        ).bind(license_code).first<any>();

        if (!license) {
          return new Response(JSON.stringify({ error: "License not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const encoder = new TextEncoder();
        const emailHashBuf = await crypto.subtle.digest("SHA-256", encoder.encode(session.email));
        const emailHash = Array.prototype.map.call(new Uint8Array(emailHashBuf), x => ('00' + x.toString(16)).slice(-2)).join('');

        if (license.buyer_email_hash !== emailHash) {
          return new Response(JSON.stringify({ error: "You do not own this license" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        if (license.status === "revoked") {
          return new Response(JSON.stringify({ error: "License is already refunded or revoked" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const transactionId = license.paddle_transaction_id;
        if (!transactionId) {
          return new Response(JSON.stringify({ error: "No associated Paddle transaction found for this license" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const paddleApiKey = env.PADDLE_API_KEY;
        if (!paddleApiKey) {
          return new Response(JSON.stringify({ error: "Paddle API Key is not configured" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        const isSandbox = paddleApiKey.startsWith("pdl_sdbx_");
        const paddleBaseUrl = isSandbox ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";

        try {
          // Fetch transaction details
          const txRes = await fetch(`${paddleBaseUrl}/transactions/${transactionId}`, {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${paddleApiKey}`
            }
          });

          if (!txRes.ok) {
            const errBody = await txRes.text();
            throw new Error(`Failed to fetch transaction details from Paddle: ${errBody}`);
          }

          const txData: any = await txRes.json();
          const lineItems = txData.data.details?.line_items || [];
          if (lineItems.length === 0) {
            throw new Error("No line items found in transaction to refund");
          }

          const refundItems = lineItems.map((item: any) => ({
            item_id: item.id,
            type: "full"
          }));

          // Create adjustment refund
          const adjRes = await fetch(`${paddleBaseUrl}/adjustments`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${paddleApiKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              action: "refund",
              transaction_id: transactionId,
              reason: "requested_by_customer",
              items: refundItems
            })
          });

          if (!adjRes.ok) {
            const errBody = await adjRes.text();
            throw new Error(`Paddle refund creation failed: ${errBody}`);
          }

          const adjData = await adjRes.json();

          // Revoke local license immediately
          await env.DB.prepare(
            "UPDATE licenses SET status = 'revoked' WHERE license_code = ?"
          ).bind(license_code).run();

          // Send revocation email notification to the buyer asynchronously
          if (license.buyer_email) {
            const planName = license.tier === "PLUS" ? "EQT Plus" : (license.tier === "PRO" ? "EQT Pro" : license.tier);
            const emailHtml = `
              <div style="font-family: sans-serif; padding: 20px; line-height: 1.6; color: #333;">
                <h2 style="color: #ef4444;">您的 EQT 许可证授权已吊销</h2>
                <p>您的退款申请已处理完成，或授权订阅因中止而被注销。以下是受影响的许可证明细：</p>
                <table style="border-collapse: collapse; margin: 20px 0; width: 100%; max-width: 600px;">
                  <tr>
                    <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9; width: 180px;">授权级别 (Tier)</td>
                    <td style="padding: 10px; border: 1px solid #ddd;">${planName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">激活码 (License Code)</td>
                    <td style="padding: 10px; border: 1px solid #ddd; font-family: monospace; font-size: 14px; text-decoration: line-through; color: #888;">${license_code}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">当前状态 (Status)</td>
                    <td style="padding: 10px; border: 1px solid #ddd; color: #ef4444; font-weight: bold;">已吊销 (Revoked)</td>
                  </tr>
                </table>
                <p><strong>注意：</strong>该激活码下的所有已激活设备在下次联网同步（或最迟 7 天租约过期）时，软件将自动注销降级至免费体验版。</p>
                <p>感谢您曾经使用 EQT，如果您有任何其他问题或需要重新激活服务，欢迎随时前往我们的官网。</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
                <p style="font-size: 12px; color: #888;">此邮件由系统自动发送，请勿直接回复。</p>
              </div>
            `;
            ctx.waitUntil(sendDRMEmail(env, license.buyer_email, "【EQT】许可证授权吊销与退款通知", emailHtml));
          }

          return new Response(JSON.stringify({
            success: true,
            message: "Refund processed successfully",
            adjustment: adjData
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });

        } catch (paddleErr: any) {
          console.error("Paddle Refund Error:", paddleErr);
          return new Response(JSON.stringify({
            error: "Failed to process refund with Paddle: " + paddleErr.message
          }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

      // 1. Activating a device
      if (url.pathname === "/api/v1/activate" && request.method === "POST") {
        const body: any = await request.json();
        const { license_code, uuid_hash, cpu_hash, disk_hash } = body;

        if (!license_code) {
          return new Response(JSON.stringify({ error: "Missing license_code" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Query the license
        const license = await env.DB.prepare(
          "SELECT * FROM licenses WHERE license_code = ?"
        ).bind(license_code).first<any>();

        if (!license) {
          return new Response(JSON.stringify({ error: "Invalid license code" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        if (license.status !== "active") {
          return new Response(JSON.stringify({ error: "License is suspended or revoked" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Check for abusive refund blacklists (both email hash and device fingerprint)
        const blacklistCheck = await checkAbusiveRefundBlacklist(
          env,
          license.buyer_email_hash || null,
          uuid_hash || "",
          cpu_hash || "",
          disk_hash || ""
        );
        if (blacklistCheck.isAbusive) {
          return new Response(JSON.stringify({ error: blacklistCheck.reason }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        let baseExpiresAt = license.expires_at || "LIFETIME";
        if (license.duration_days !== null && license.duration_days !== undefined && Number(license.duration_days) >= 0) {
          baseExpiresAt = new Date(Date.now() + (Number(license.duration_days) * 86400 * 1000)).toISOString();
        } else if (license.expires_at && license.expires_at !== "LIFETIME") {
          const expires = new Date(license.expires_at);
          if (expires.getTime() < Date.now()) {
            return new Response(JSON.stringify({ error: "License has expired" }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
        }

        // Fetch existing activations
        const { results: activations } = await env.DB.prepare(
          "SELECT * FROM activations WHERE license_code = ?"
        ).bind(license_code).all<any>();

        let isAlreadyActivated = false;
        for (const act of activations) {
          if (matchFingerprint(
            uuid_hash || "", cpu_hash || "", disk_hash || "",
            act.uuid_hash || "", act.cpu_hash || "", act.disk_hash || ""
          )) {
            isAlreadyActivated = true;
            break;
          }
        }

        // If not already activated, check limit and insert new activation
        if (!isAlreadyActivated) {
          if (activations.length >= license.max_devices) {
            return new Response(JSON.stringify({ error: `Activation limit reached (max ${license.max_devices} devices)` }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          // Insert new activation record
          await env.DB.prepare(
            "INSERT INTO activations (license_code, uuid_hash, cpu_hash, disk_hash, activated_at) VALUES (?, ?, ?, ?, ?)"
          ).bind(
            license_code,
            uuid_hash || "",
            cpu_hash || "",
            disk_hash || "",
            new Date().toISOString()
          ).run();

          // Send activation notification email to the buyer asynchronously
          if (license.buyer_email) {
            const planName = license.tier === "PLUS" ? "EQT Plus" : (license.tier === "PRO" ? "EQT Pro" : license.tier);
            const currentDevicesCount = activations.length + 1;
            const actTimeStr = new Date().toLocaleString();
            
            // Mask hashes for user privacy, show only first 6 chars
            const shortUUID = uuid_hash ? uuid_hash.substring(0, 6) + "..." : "无";
            const shortCPU = cpu_hash ? cpu_hash.substring(0, 6) + "..." : "无";
            const shortDisk = disk_hash ? disk_hash.substring(0, 6) + "..." : "无";

            const emailHtml = `
              <div style="font-family: sans-serif; padding: 20px; line-height: 1.6; color: #333;">
                <h2 style="color: #3b82f6;">您的 EQT 激活码绑定了新设备</h2>
                <p>我们检测到您的激活码在新的客户端进行了设备激活绑定。以下是激活事件明细：</p>
                <table style="border-collapse: collapse; margin: 20px 0; width: 100%; max-width: 600px;">
                  <tr>
                    <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9; width: 180px;">激活码 (License Code)</td>
                    <td style="padding: 10px; border: 1px solid #ddd; font-family: monospace;">${license_code}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">授权级别 (Tier)</td>
                    <td style="padding: 10px; border: 1px solid #ddd;">${planName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">激活时间 (Time)</td>
                    <td style="padding: 10px; border: 1px solid #ddd;">${actTimeStr}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">激活设备特征 (Hashes)</td>
                    <td style="padding: 10px; border: 1px solid #ddd; font-size: 13px;">
                      UUID: ${shortUUID}<br/>
                      CPU: ${shortCPU}<br/>
                      Disk: ${shortDisk}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">设备占用状态</td>
                    <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; color: #3b82f6;">${currentDevicesCount} / ${license.max_devices} (台设备已使用)</td>
                  </tr>
                </table>
                <p><strong>注意：</strong>如果这并非由您本人操作，可能说明您的激活码已被他人盗用，请立即前往我们的 <a href="https://www.eqt.net.im/portal.html" target="_blank" style="color: #3b82f6; text-decoration: none; font-weight: bold;">许可证自服务门户</a> 申请退款或重置授权，以保护您的权益！</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
                <p style="font-size: 12px; color: #888;">此邮件由系统自动发送，请安全使用您的激活码。</p>
              </div>
            `;
            ctx.waitUntil(sendDRMEmail(env, license.buyer_email, "【EQT】新设备授权激活提醒通知", emailHtml));
          }
        }

        // Calculate dynamic expiration if the device has other active and unexpired license activations
        let remainingMs = 0;
        const nowMs = Date.now();
        
        // Find existing activations for this device fingerprint
        const activeDevices = await env.DB.prepare(`
          SELECT l.expires_at FROM activations a
          JOIN licenses l ON a.license_code = l.license_code
          WHERE (a.uuid_hash = ? OR a.cpu_hash = ? OR a.disk_hash = ?)
            AND l.license_code != ?
            AND l.status = 'active'
        `).bind(uuid_hash || "", cpu_hash || "", disk_hash || "", license_code).all<any>();

        if (activeDevices.results && activeDevices.results.length > 0) {
          for (const item of activeDevices.results) {
            if (item.expires_at === "LIFETIME") {
              remainingMs = -1; // Already has a lifetime license, no need to accumulate
              break;
            }
            if (item.expires_at) {
              const expTime = new Date(item.expires_at).getTime();
              if (expTime > nowMs) {
                const diff = expTime - nowMs;
                if (diff > remainingMs) {
                  remainingMs = diff;
                }
              }
            }
          }
        }

        let finalExpiresAt = baseExpiresAt;
        if (finalExpiresAt !== "LIFETIME" && remainingMs > 0) {
          const newExpDate = new Date(finalExpiresAt);
          // Accumulate the remaining time of the old license
          const finalDate = new Date(newExpDate.getTime() + remainingMs);
          finalExpiresAt = finalDate.toISOString();
        }

        // Generate license signature
        // Formulate the raw payload: license_code|tier|uuid_hash|cpu_hash|disk_hash|expires_at|max_devices
        const payloadStr = `${license_code}|${license.tier}|${uuid_hash || ""}|${cpu_hash || ""}|${disk_hash || ""}|${finalExpiresAt}|${license.max_devices}`;
        const encoder = new TextEncoder();
        const payloadData = encoder.encode(payloadStr);

        // Import the private key (Ed25519)
        const privateKeyHex = env.ED25519_PRIVATE_KEY;
        if (!privateKeyHex) {
          throw new Error("ED25519_PRIVATE_KEY is not configured in Workers Environment Variables");
        }
        const privateKeyBytes = hexToUint8Array(privateKeyHex);
        
        // Convert 32-byte raw private key (seed) to PKCS8 format for SubtleCrypto
        const pkcs8Bytes = new Uint8Array(16 + privateKeyBytes.length);
        pkcs8Bytes.set([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
        pkcs8Bytes.set(privateKeyBytes, 16);

        const key = await crypto.subtle.importKey(
          "pkcs8",
          pkcs8Bytes,
          { name: "Ed25519" },
          true,
          ["sign"]
        );

        // Sign the payload
        const signatureBuf = await crypto.subtle.sign("Ed25519", key, payloadData);
        const signatureHex = bufToHex(signatureBuf);

        // Generate verification signature for sync/lease check (unified with verify endpoint)
        const currentTime = new Date().toISOString();
        const verifyPayloadStr = `OK|${license_code}|${uuid_hash || ""}|${cpu_hash || ""}|${disk_hash || ""}|${currentTime}`;
        const verifyPayloadData = encoder.encode(verifyPayloadStr);
        const verifySignatureBuf = await crypto.subtle.sign("Ed25519", key, verifyPayloadData);
        const verifySignatureHex = bufToHex(verifySignatureBuf);

        // Calculate the actual activated devices count (including this one)
        let activatedCount = activations.length;
        if (!isAlreadyActivated) {
          activatedCount += 1;
        }

        // Return signed license
        return new Response(JSON.stringify({
          license_code: license_code,
          tier: license.tier,
          uuid_hash: uuid_hash || "",
          cpu_hash: cpu_hash || "",
          disk_hash: disk_hash || "",
          expires_at: finalExpiresAt,
          max_devices: license.max_devices,
          activated_devices: activatedCount,
          buyer_email: license.buyer_email || "",
          signature: signatureHex,
          // New verification fields for always-sync 7-day grace period
          last_online_sync_time: currentTime,
          verify_signature: verifySignatureHex
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 1.5. Verifying / Syncing license status (Always-Sync & 7-day grace period verification)
      if (url.pathname === "/api/v1/verify" && request.method === "POST") {
        const body: any = await request.json();
        const { license_code, uuid_hash, cpu_hash, disk_hash } = body;

        if (!license_code) {
          return new Response(JSON.stringify({ error: "Missing license_code" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Query the license status
        const license = await env.DB.prepare(
          "SELECT * FROM licenses WHERE license_code = ?"
        ).bind(license_code).first<any>();

        if (!license) {
          return new Response(JSON.stringify({ error: "Invalid license code" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        if (license.status !== "active") {
          return new Response(JSON.stringify({ error: "License is suspended or revoked" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Check for abusive refund blacklists (both email hash and device fingerprint)
        const blacklistCheck = await checkAbusiveRefundBlacklist(
          env,
          license.buyer_email_hash || null,
          uuid_hash || "",
          cpu_hash || "",
          disk_hash || ""
        );
        if (blacklistCheck.isAbusive) {
          return new Response(JSON.stringify({ error: blacklistCheck.reason }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Check if this device is registered/activated under this license (3-of-2 matching check)
        const { results: activations } = await env.DB.prepare(
          "SELECT * FROM activations WHERE license_code = ?"
        ).bind(license_code).all<any>();

        let isActivatedDevice = false;
        for (const act of activations) {
          if (matchFingerprint(
            uuid_hash || "", cpu_hash || "", disk_hash || "",
            act.uuid_hash || "", act.cpu_hash || "", act.disk_hash || ""
          )) {
            isActivatedDevice = true;
            break;
          }
        }

        if (!isActivatedDevice) {
          return new Response(JSON.stringify({ error: "This device is not activated under the provided license" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Generate verification signature containing server timestamp
        const currentTime = new Date().toISOString();
        // Formulate the raw verify payload: OK|license_code|uuid_hash|cpu_hash|disk_hash|current_time
        const verifyPayloadStr = `OK|${license_code}|${uuid_hash || ""}|${cpu_hash || ""}|${disk_hash || ""}|${currentTime}`;
        const encoder = new TextEncoder();
        const verifyPayloadData = encoder.encode(verifyPayloadStr);

        // Import the private key (Ed25519)
        const privateKeyHex = env.ED25519_PRIVATE_KEY;
        if (!privateKeyHex) {
          throw new Error("ED25519_PRIVATE_KEY is not configured in Workers Environment Variables");
        }
        const privateKeyBytes = hexToUint8Array(privateKeyHex);
        const pkcs8Bytes = new Uint8Array(16 + privateKeyBytes.length);
        pkcs8Bytes.set([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
        pkcs8Bytes.set(privateKeyBytes, 16);

        const key = await crypto.subtle.importKey(
          "pkcs8",
          pkcs8Bytes,
          { name: "Ed25519" },
          true,
          ["sign"]
        );

        const signatureBuf = await crypto.subtle.sign("Ed25519", key, verifyPayloadData);
        const signatureHex = bufToHex(signatureBuf);

        return new Response(JSON.stringify({
          status: "OK",
          license_code: license_code,
          current_time: currentTime,
          signature: signatureHex
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 2. Admin Endpoint: Manual license generation for test/issue
      if (url.pathname === "/api/v1/admin/generate" && request.method === "POST") {
        const adminSecret = request.headers.get("X-Admin-Secret");
        if (!env.ADMIN_SECRET || adminSecret !== env.ADMIN_SECRET) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const body: any = await request.json();
        const { tier, max_devices, expires_in_days, duration_days } = body;

        if (tier !== "PLUS" && tier !== "PRO") {
          return new Response(JSON.stringify({ error: "Invalid tier. Must be 'PLUS' or 'PRO'" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Generate high entropy random coupon code: EQT-{TIER}-{YYYYMMDD}-{12-random-chars}
        const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const randBytes = new Uint8Array(6);
        crypto.getRandomValues(randBytes);
        const randStr = Array.from(randBytes, b => ('00' + b.toString(16)).slice(-2)).join('').toUpperCase();
        const licenseCode = `EQT-${tier}-${todayStr}-${randStr}`;

        let expiresAt = "LIFETIME";
        if (expires_in_days) {
          const expDate = new Date();
          expDate.setDate(expDate.getDate() + Number(expires_in_days));
          expiresAt = expDate.toISOString();
        }

        const maxDev = max_devices ? Number(max_devices) : 2;
        const durDays = duration_days !== undefined ? Number(duration_days) : null;

        await env.DB.prepare(
          "INSERT INTO licenses (license_code, tier, status, max_devices, expires_at, duration_days, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(
          licenseCode,
          tier,
          "active",
          maxDev,
          expiresAt,
          durDays,
          new Date().toISOString()
        ).run();

        return new Response(JSON.stringify({
          license_code: licenseCode,
          tier: tier,
          max_devices: maxDev,
          expires_at: expiresAt,
          duration_days: durDays,
          status: "active"
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 3. Update checking endpoint (caches results for 1 hour to prevent Rate Limits)
      if (url.pathname === "/api/v1/update/check" && request.method === "GET") {
        const cacheUrl = new URL(request.url);
        const cacheKey = new Request(cacheUrl.toString(), request);
        const cache = caches.default;
        
        let response = await cache.match(cacheKey);
        if (response) {
          return response;
        }

        const repo = env.GITHUB_REPO || "forpersuit/eqrcp";
        const ghUrl = `https://api.github.com/repos/${repo}/releases/latest`;
        
        const headers: Record<string, string> = {
          "User-Agent": "EQT-Update-Worker",
          "Accept": "application/vnd.github+json",
        };
        
        if (env.GITHUB_TOKEN) {
          headers["Authorization"] = `Bearer ${env.GITHUB_TOKEN}`;
        }

        const ghRes = await fetch(ghUrl, { headers });
        if (!ghRes.ok) {
          return new Response(JSON.stringify({ error: `Failed to fetch latest release from GitHub: ${ghRes.statusText}` }), {
            status: ghRes.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const release: any = await ghRes.json();
        
        const r2PublicUrl = env.R2_PUBLIC_URL;
        const result = {
          version: release.tag_name,
          published_at: release.published_at,
          changelog: release.body || "",
          assets: (release.assets || []).map((asset: any) => {
            let downloadUrl = asset.browser_download_url;
            if (r2PublicUrl) {
              const base = r2PublicUrl.endsWith('/') ? r2PublicUrl.slice(0, -1) : r2PublicUrl;
              downloadUrl = `${base}/downloads/${release.tag_name}/${asset.name}`;
            }
            return {
              name: asset.name,
              download_url: downloadUrl,
              size: asset.size
            };
          })
        };

        response = new Response(JSON.stringify(result), {
          status: 200,
          headers: { 
            ...corsHeaders, 
            "Content-Type": "application/json",
            "Cache-Control": "public, s-maxage=3600"
          }
        });

        ctx.waitUntil(cache.put(cacheKey, response.clone()));
        return response;
      }

      // 3.5.1 Paddle Webhook: fulfillment and cancellation/refund
      if (url.pathname === "/api/v1/paddle/webhook" && request.method === "POST") {
        const rawBody = await request.text();
        const signature = request.headers.get("paddle-signature");
        const webhookSecret = env.PADDLE_WEBHOOK_SECRET;

        if (!webhookSecret) {
          return new Response(JSON.stringify({ error: "Paddle Webhook secret is not configured" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const isValid = await verifyPaddleSignature(rawBody, signature, webhookSecret);
        if (!isValid) {
          return new Response(JSON.stringify({ error: "Invalid signature" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const event = JSON.parse(rawBody);
        const eventType = event.event_type;
        const data = event.data;
        console.log("PADDLE_WEBHOOK_EVENT:", JSON.stringify(event));

        if (eventType === "transaction.completed") {
          const transactionId = data.id;
          const subscriptionId = data.subscription_id || null;
          const buyerEmail = data.customer?.email || data.billing_details?.email_address || "";

          // Check if already processed
          const existing = await env.DB.prepare(
            "SELECT license_code FROM licenses WHERE paddle_transaction_id = ?"
          ).bind(transactionId).first<any>();

          if (existing) {
            return new Response(JSON.stringify({ message: "Transaction already processed", license_code: existing.license_code }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          // Extract Price ID
          const items = data.items || [];
          let matchedPriceId = "";
          for (const item of items) {
            const priceId = item.price?.id || item.price_id;
            if (priceId === PRICE_LIFETIME_ID || priceId === PRICE_YEARLY_ID) {
              matchedPriceId = priceId;
              break;
            }
          }

          if (!matchedPriceId) {
            return new Response(JSON.stringify({ message: "No matching EQT pricing items in transaction" }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          // Set Tier and expiration based on price ID
          const tier = "PLUS";
          let expiresAt = "LIFETIME";
          let durationDays: number | null = null;

          if (matchedPriceId === PRICE_YEARLY_ID) {
            durationDays = 365;
            expiresAt = new Date(Date.now() + 365 * 86400 * 1000).toISOString();
          }

          // Generate license code
          const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
          const charSet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
          let randStr = "";
          const randBytes = new Uint8Array(6);
          crypto.getRandomValues(randBytes);
          for (let i = 0; i < 6; i++) {
            randStr += charSet[randBytes[i] % charSet.length];
          }

          const checkSumPayload = `${tier}-${todayStr}-${randStr}`;
          const encoder = new TextEncoder();
          const checkHashBuf = await crypto.subtle.digest("MD5", encoder.encode(checkSumPayload));
          const checkHex = Array.prototype.map.call(new Uint8Array(checkHashBuf), x => ('00' + x.toString(16)).slice(-2)).join('').slice(0, 4).toUpperCase();
          const licenseCode = `EQT-${tier}-${todayStr}-${randStr}-${checkHex}`;

          // Hash email for buyer_email_hash
          let emailHash = "";
          if (buyerEmail) {
            const emailHashBuf = await crypto.subtle.digest("SHA-256", encoder.encode(buyerEmail.trim().toLowerCase()));
            emailHash = Array.prototype.map.call(new Uint8Array(emailHashBuf), x => ('00' + x.toString(16)).slice(-2)).join('');
          }

          // Write to DB
          await env.DB.prepare(`
            INSERT INTO licenses (
              license_code, tier, status, max_devices, expires_at, duration_days,
              buyer_email_hash, buyer_email, paddle_transaction_id, paddle_subscription_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            licenseCode,
            tier,
            "active",
            2,
            expiresAt,
            durationDays,
            emailHash || null,
            buyerEmail || null,
            transactionId,
            subscriptionId,
            new Date().toISOString()
          ).run();

          // Send confirmation email to the buyer asynchronously
          if (buyerEmail) {
            const planName = tier === "PLUS" ? "EQT Plus" : (tier === "PRO" ? "EQT Pro" : tier);
            const expiresStr = expiresAt === "LIFETIME" ? "Lifetime (买断永久版)" : new Date(expiresAt).toLocaleDateString();
            const emailHtml = `
              <div style="font-family: sans-serif; padding: 20px; line-height: 1.6; color: #333;">
                <h2 style="color: #10b981;">感谢您购买 EQT Easy QR Transfer！</h2>
                <p>您的付费订单已处理完成。以下是您的付费授权激活码明细：</p>
                <table style="border-collapse: collapse; margin: 20px 0; width: 100%; max-width: 600px;">
                  <tr>
                    <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9; width: 180px;">授权级别 (Tier)</td>
                    <td style="padding: 10px; border: 1px solid #ddd;">${planName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">激活码 (License Code)</td>
                    <td style="padding: 10px; border: 1px solid #ddd; font-family: monospace; font-size: 16px; font-weight: bold; color: #10b981;">${licenseCode}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">有效期限 (Expires)</td>
                    <td style="padding: 10px; border: 1px solid #ddd;">${expiresStr}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">最大激活设备数</td>
                    <td style="padding: 10px; border: 1px solid #ddd;">2 台设备</td>
                  </tr>
                </table>
                <p><strong>如何激活：</strong></p>
                <ol>
                  <li>打开 EQT 客户端，前往设置或关于面板。</li>
                  <li>点击“输入激活码”并输入上述激活码，然后点击确认即可激活您的 EQT Plus/Pro 尊享功能！</li>
                </ol>
                <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
                <p style="font-size: 12px; color: #888;">此邮件由系统自动发送，请勿直接回复。如有疑问，请访问官网或联系技术支持。</p>
              </div>
            `;
            ctx.waitUntil(sendDRMEmail(env, buyerEmail, "【EQT】您的购买激活码与服务明细", emailHtml));
          }

          return new Response(JSON.stringify({ message: "License generated and fulfilled", license_code: licenseCode }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Revoke license on refund
        if (eventType === "transaction.refunded") {
          const transactionId = data.id;

          // Query the email of the license owner
          const license = await env.DB.prepare(
            "SELECT license_code, buyer_email, tier FROM licenses WHERE paddle_transaction_id = ?"
          ).bind(transactionId).first<any>();

          await env.DB.prepare(
            "UPDATE licenses SET status = 'revoked' WHERE paddle_transaction_id = ?"
          ).bind(transactionId).run();

          if (license && license.buyer_email) {
            const planName = license.tier === "PLUS" ? "EQT Plus" : (license.tier === "PRO" ? "EQT Pro" : license.tier);
            const emailHtml = `
              <div style="font-family: sans-serif; padding: 20px; line-height: 1.6; color: #333;">
                <h2 style="color: #ef4444;">您的 EQT 许可证授权已吊销</h2>
                <p>您的退款申请已处理完成，或授权订阅因中止而被注销。以下是受影响的许可证明细：</p>
                <table style="border-collapse: collapse; margin: 20px 0; width: 100%; max-width: 600px;">
                  <tr>
                    <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9; width: 180px;">授权级别 (Tier)</td>
                    <td style="padding: 10px; border: 1px solid #ddd;">${planName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">激活码 (License Code)</td>
                    <td style="padding: 10px; border: 1px solid #ddd; font-family: monospace; font-size: 14px; text-decoration: line-through; color: #888;">${license.license_code}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">当前状态 (Status)</td>
                    <td style="padding: 10px; border: 1px solid #ddd; color: #ef4444; font-weight: bold;">已吊销 (Revoked)</td>
                  </tr>
                </table>
                <p><strong>注意：</strong>该激活码下的所有已激活设备在下次联网同步（或最迟 7 天租约过期）时，软件将自动注销降级至免费体验版。</p>
                <p>感谢您曾经使用 EQT，如果您有任何其他问题或需要重新激活服务，欢迎随时前往我们的官网。</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
                <p style="font-size: 12px; color: #888;">此邮件由系统自动发送，请勿直接回复。</p>
              </div>
            `;
            ctx.waitUntil(sendDRMEmail(env, license.buyer_email, "【EQT】许可证授权吊销与退款通知", emailHtml));
          }

          return new Response(JSON.stringify({ message: "License revoked due to refund" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Revoke license on subscription cancel / suspend
        if (eventType === "subscription.canceled" || eventType === "subscription.updated") {
          const subscriptionId = data.id;
          const status = data.status;

          // If subscription is canceled, or updated to unpaid states
          if (eventType === "subscription.canceled" || status === "canceled" || status === "past_due" || status === "paused") {
            // Query the email of the license owner
            const license = await env.DB.prepare(
              "SELECT license_code, buyer_email, tier FROM licenses WHERE paddle_subscription_id = ?"
            ).bind(subscriptionId).first<any>();

            await env.DB.prepare(
              "UPDATE licenses SET status = 'revoked' WHERE paddle_subscription_id = ?"
            ).bind(subscriptionId).run();

            if (license && license.buyer_email) {
              const planName = license.tier === "PLUS" ? "EQT Plus" : (license.tier === "PRO" ? "EQT Pro" : license.tier);
              const emailHtml = `
                <div style="font-family: sans-serif; padding: 20px; line-height: 1.6; color: #333;">
                  <h2 style="color: #ef4444;">您的 EQT 订阅许可证已失效</h2>
                  <p>您的 EQT 尊享服务订阅已中止，授权已失效。以下是受影响的许可证明细：</p>
                  <table style="border-collapse: collapse; margin: 20px 0; width: 100%; max-width: 600px;">
                    <tr>
                      <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9; width: 180px;">授权级别 (Tier)</td>
                      <td style="padding: 10px; border: 1px solid #ddd;">${planName}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">激活码 (License Code)</td>
                      <td style="padding: 10px; border: 1px solid #ddd; font-family: monospace; font-size: 14px; text-decoration: line-through; color: #888;">${license.license_code}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">原因 (Reason)</td>
                      <td style="padding: 10px; border: 1px solid #ddd;">订阅已取消或扣款失败</td>
                    </tr>
                  </table>
                  <p><strong>注意：</strong>该激活码下的所有已激活设备在下一次联网同步时，软件将自动降级至免费体验版。</p>
                  <p>感谢您曾经使用 EQT，如果您有任何其他问题或需要重新激活服务，欢迎随时前往我们的官网进行续费。</p>
                  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
                  <p style="font-size: 12px; color: #888;">此邮件由系统自动发送，请勿直接回复。</p>
                </div>
              `;
              ctx.waitUntil(sendDRMEmail(env, license.buyer_email, "【EQT】许可证授权失效通知", emailHtml));
            }

            return new Response(JSON.stringify({ message: "License revoked due to subscription cancellation or non-payment" }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
        }

        return new Response(JSON.stringify({ message: `Webhook event '${eventType}' acknowledged` }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 3.5.2 Client License Query (polling to fetch license code instantly after web payment completion)
      if (url.pathname === "/api/v1/paddle/license-query" && request.method === "GET") {
        const transactionId = url.searchParams.get("transaction_id");
        if (!transactionId) {
          return new Response(JSON.stringify({ error: "Missing transaction_id" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const license = await env.DB.prepare(
          "SELECT license_code, tier, expires_at, status FROM licenses WHERE paddle_transaction_id = ?"
        ).bind(transactionId).first<any>();

        if (!license) {
          return new Response(JSON.stringify({ error: "License not generated yet, pending payment confirmation" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        return new Response(JSON.stringify({
          status: license.status,
          license_code: license.license_code,
          tier: license.tier,
          expires_at: license.expires_at
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 4. Health check or basic index
      return new Response(JSON.stringify({ status: "EQT DRM Serverless API Running" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message || String(e) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
