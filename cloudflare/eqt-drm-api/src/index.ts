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

// Business Logic Constants (Eliminating Magic Numbers)
const MAX_YEARLY_UNBINDS = 4;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// Dynamic API i18n Dictionary (Supporting 7 Languages with graceful Fallback)
const API_I18N: Record<string, Record<string, string>> = {
  unbind_limit_reached: {
    zh: "该授权码过去365天内已达到4次解绑设备上限，无法继续解绑。",
    en: "Unbind limit reached (maximum 4 device unbinds allowed per 365 days).",
    ja: "過去365日以内のデバイス解除上限（最大4回）に達しました。",
    ko: "지난 365일 동안 최대 4회의 기기 해제 한도에 도달했습니다.",
    es: "Se alcanzó el límite de desvinculación (máximo 4 desvinculaciones por año).",
    de: "Entkopplungslimit erreicht (maximal 4 Geräteentkopplungen pro 365 Tage).",
    fr: "Limite de dissociation atteinte (maximum 4 dissociations par 365 jours)."
  },
  unbind_success: {
    zh: "设备已成功解绑",
    en: "Device unbound successfully",
    ja: "デバイスの解除が完了しました",
    ko: "기기 해제가 완료되었습니다",
    es: "Dispositivo desvinculado con éxito",
    de: "Gerät erfolgreich entkoppelt",
    fr: "Appareil dissocié avec succès"
  },
  unauthorized: {
    zh: "身份验证失败，请重新登录",
    en: "Unauthorized, please sign in again.",
    ja: "認証に失敗しました。再ログインしてください。",
    ko: "인증에 실패했습니다. 다시 로그인해 주세요.",
    es: "No autorizado, por favor inicie sesión de nuevo.",
    de: "Nicht autorisiert, bitte melden Sie sich erneut an.",
    fr: "Non autorisé, veuillez vous reconnecter."
  },
  session_expired: {
    zh: "会话已过期，请重新获取验证码登录",
    en: "Session expired or invalid. Please sign in again.",
    ja: "セッションの期限が切れました。再度ログインしてください。",
    ko: "세션이 만료되었습니다. 다시 로그인해 주세요.",
    es: "Sesión expirada o inválida. Inicie sesión de nuevo.",
    de: "Sitzung abgelaufen oder ungültig. Bitte erneut anmelden.",
    fr: "Session expirée ou invalide. Veuillez vous reconnecter."
  },
  missing_params: {
    zh: "请求参数缺失",
    en: "Missing required parameters",
    ja: "必修パラメータが不足しています",
    ko: "필수 매개변수가 누락되었습니다",
    es: "Faltan parámetros requeridos",
    de: "Erforderliche Parameter fehlen",
    fr: "Paramètres requis manquants"
  },
  license_not_found: {
    zh: "未找到对应的授权码",
    en: "License code not found",
    ja: "ライセンスコードが見つかりません",
    ko: "라이선스 코드를 찾을 수 없습니다",
    es: "Código de licencia no encontrado",
    de: "Lizenzcode nicht gefunden",
    fr: "Code de licence introuvable"
  },
  no_purchase_history: {
    zh: "未找到该邮箱的购买记录，请确认邮箱或先购买授权套餐",
    en: "No purchase history found for this email. Please check your email or purchase a license plan first.",
    ja: "このメールアドレスの購入履歴が見つかりません。メールアドレスを確認するか、ライセンスをご購入ください。",
    ko: "이 이메일의 구매 내역을 찾을 수 없습니다. 이메일을 확인하거나 라이선스 플랜을 먼저 구매해 주세요.",
    es: "No se encontraron compras para este correo electrónico. Por favor, compruébelo o adquiera un plan primero.",
    de: "Keine Kaufhistorie für diese E-Mail-Adresse gefunden. Bitte überprüfen Sie Ihre E-Mail oder kaufen Sie zuerst ein Paket.",
    fr: "Aucun historique d'achat trouvé pour cet e-mail. Veuillez vérifier votre e-mail ou acheter un forfait."
  }
};

function extractRequestLang(request: Request, body?: any): string {
  if (body && typeof body.lang === 'string' && body.lang.trim()) {
    return body.lang.trim();
  }
  const acceptLang = request.headers.get("Accept-Language");
  if (acceptLang) {
    const primary = acceptLang.split(",")[0].trim().toLowerCase();
    if (primary.startsWith("zh")) return "zh";
    if (primary.startsWith("ja")) return "ja";
    if (primary.startsWith("ko")) return "ko";
    if (primary.startsWith("es")) return "es";
    if (primary.startsWith("de")) return "de";
    if (primary.startsWith("fr")) return "fr";
  }
  return "en";
}

function getApiTranslation(key: string, lang: string): string {
  const norm = (lang || 'en').toLowerCase().substring(0, 2);
  const dict = API_I18N[key];
  if (!dict) return key;
  return dict[norm] || dict['zh'] || dict['en'] || key;
}

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

// System error audit log helper (Stores full technical stacktrace into D1)
async function ensureAuditLogTable(env: Env): Promise<void> {
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS system_error_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL DEFAULT 'ERROR',
        category TEXT NOT NULL,
        error_message TEXT NOT NULL,
        context_json TEXT,
        created_at TEXT NOT NULL
      )
    `).run();
  } catch (err) {
    console.error("Failed to ensure audit log table:", err);
  }
}

async function ensureDeviceIdColumn(env: Env): Promise<void> {
  try {
    await env.DB.prepare("ALTER TABLE activations ADD COLUMN device_id TEXT DEFAULT NULL").run();
  } catch (err) {
    // Column already exists or table does not exist yet; ignore safely
  }
}

async function logSystemError(
  env: Env,
  category: string,
  level: 'ERROR' | 'WARN' | 'CRITICAL',
  error: any,
  context?: any
): Promise<void> {
  try {
    await ensureAuditLogTable(env);
    const errorMsg = error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error);
    const contextJson = context ? JSON.stringify(context) : null;
    await env.DB.prepare(
      "INSERT INTO system_error_logs (level, category, error_message, context_json, created_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(level, category, errorMsg, contextJson, new Date().toISOString()).run();
  } catch (err) {
    console.error("Failed to log system error to D1:", err);
  }
}

function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") || "";
  let allowOrigin = "*";
  if (origin && (
    origin.includes("eqt.net.im") ||
    origin.includes("localhost") ||
    origin.includes("127.0.0.1")
  )) {
    allowOrigin = origin;
  }
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Secret",
  };
}

async function ensureDrmTables(env: Env): Promise<void> {
  try {
    await env.DB.batch([
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS licenses (
            license_code TEXT PRIMARY KEY,
            tier TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            max_devices INTEGER DEFAULT 2,
            expires_at TEXT,
            duration_days INTEGER DEFAULT NULL,
            buyer_email_hash TEXT DEFAULT NULL,
            buyer_email TEXT DEFAULT NULL,
            paddle_transaction_id TEXT DEFAULT NULL,
            paddle_subscription_id TEXT DEFAULT NULL,
            created_at TEXT NOT NULL
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS activations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            license_code TEXT NOT NULL,
            uuid_hash TEXT,
            cpu_hash TEXT,
            disk_hash TEXT,
            device_id TEXT DEFAULT NULL,
            activated_at TEXT NOT NULL
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS system_error_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            level TEXT NOT NULL DEFAULT 'ERROR',
            category TEXT NOT NULL,
            error_message TEXT NOT NULL,
            context_json TEXT,
            created_at TEXT NOT NULL
        )
      `)
    ]);
  } catch (err) {
    console.error("Failed to ensure DRM D1 tables:", err);
  }
}

/**
 * Admin route guard (docs/admin/api-contract.md):
 * - ADMIN_SECRET unset → 503 fail-closed
 * - missing/wrong secret → 401 (strictly X-Admin-Secret header)
 */
async function requireAdminAuth(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
  if (!env.ADMIN_SECRET) {
    return new Response(
      JSON.stringify({ error: "Admin API not configured (ADMIN_SECRET missing)" }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  const adminSecret = request.headers.get("X-Admin-Secret");
  if (!adminSecret || adminSecret !== env.ADMIN_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  await ensureDrmTables(env);
  return null;
}

// Map internal DB/code errors to safe user-friendly messages for general public
function getSafeUserErrorMessage(rawMessage: string, defaultFriendlyMsg: string = "Service temporarily unavailable. Please try again later."): string {
  if (!rawMessage) return defaultFriendlyMsg;
  // If rawMessage contains internal DB/code exception details, swallow them completely!
  if (/D1_ERROR|SQLITE|UNIQUE constraint|FOREIGN KEY|syntax error|PRIMARYKEY|fatal|exception|stack|trace|TypeError|ReferenceError/i.test(rawMessage)) {
    return defaultFriendlyMsg;
  }
  return rawMessage;
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

    function encodeRFC2047(str: string): string {
      if (/^[\x00-\x7F]*$/.test(str)) {
        return str;
      }
      const bytes = new TextEncoder().encode(str);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return `=?UTF-8?B?${btoa(binary)}?=`;
    }

    const encodedSubject = encodeRFC2047(options.subject);

    const bodyLines = [
      `From: "EQT" <${options.sender}>`,
      `To: <${options.to}>`,
      `Subject: ${encodedSubject}`,
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

// Unified HTML Email Layout Wrapper for Consistent Style
function renderEmailWrapper(title: string, contentHtml: string): string {
  return `
    <div style="font-family: Arial, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff; color: #334155; line-height: 1.6;">
      <div style="border-bottom: 2px solid #10b981; padding-bottom: 14px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between;">
        <span style="font-size: 20px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px;">EQT <span style="font-size: 13px; font-weight: 600; color: #10b981;">Easy QR Transfer</span></span>
        <span style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Official Notice</span>
      </div>
      <h2 style="color: #0f172a; margin-top: 0; font-size: 18px; font-weight: 700;">${title}</h2>
      ${contentHtml}
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 28px 0 16px 0;" />
      <p style="font-size: 12px; color: #94a3b8; margin: 0; text-align: center;">© 2026 EQT (Easy QR Transfer). All rights reserved.</p>
    </div>
  `;
}

// Multi-language dictionary for Portal Auth Login Verification Code Email (7 Languages)
const AUTH_CODE_EMAIL_I18N: Record<string, { subject: string; title: string; bodyText: string; validityText: string }> = {
  zh: {
    subject: "【EQT 登录验证码】您的验证码",
    title: "登录验证码",
    bodyText: "尊敬的用户，您正在登录 EQT 客户管理门户。您的验证码为：",
    validityText: "验证码有效期为 5 分钟。请勿将验证码泄露给他人。若非您本人操作，请忽略此邮件。"
  },
  en: {
    subject: "[EQT Login] Verification Code",
    title: "Login Verification Code",
    bodyText: "Hello, you are signing in to the EQT Customer Portal. Your verification code is:",
    validityText: "This code is valid for 5 minutes. Do not share it with anyone. If you did not request this, please ignore this email."
  },
  ja: {
    subject: "【EQT ログイン】認証コード通知",
    title: "ログイン認証コード",
    bodyText: "EQT カスタマーポータルにログインするための認証コードは以下の通りです：",
    validityText: "このコードは5分間有効です。他人に共有しないでください。心当たりのない場合は無視してください。"
  },
  ko: {
    subject: "【EQT 로그인】인증 코드 안내",
    title: "로그인 인증 코드",
    bodyText: "EQT 고객 포털에 로그인하기 위한 인증 코드입니다:",
    validityText: "이 코드는 5분 동안 유효합니다. 타인에게 공유하지 마세요. 요청하지 않으셨다면 이 메일을 무시해 주세요."
  },
  es: {
    subject: "[EQT Inicio de Sesión] Código de verificación",
    title: "Código de verificación",
    bodyText: "Hola, estás iniciando sesión en el Portal del Cliente EQT. Tu código de verificación es:",
    validityText: "Este código es válido durante 5 minutos. No lo comparta con nadie. Si no lo solicitó, ignore este correo."
  },
  de: {
    subject: "[EQT Anmeldung] Bestätigungscode",
    title: "Anmelde-Bestätigungscode",
    bodyText: "Hallo, Sie melden sich im EQT Kundenportal an. Ihr Bestätigungscode lautet:",
    validityText: "Dieser Code ist 5 Minuten lang gültig. Bitte geben Sie ihn nicht weiter. Wenn Sie diesen Code nicht angefordert haben, ignorieren Sie diese E-Mail."
  },
  fr: {
    subject: "[EQT Connexion] Code de vérification",
    title: "Code de vérification",
    bodyText: "Bonjour, vous vous connectez au Portail Client EQT. Votre code de vérification est :",
    validityText: "Ce code est valable pendant 5 minutes. Ne le partagez avec personne. Si vous ne l'avez pas demandé, veuillez ignorer cet e-mail."
  }
};

function buildAuthCodeEmailHtml(lang: string, code: string): { subject: string; html: string } {
  const norm = (lang || 'en').toLowerCase().substring(0, 2);
  const t = AUTH_CODE_EMAIL_I18N[norm] || AUTH_CODE_EMAIL_I18N['zh'] || AUTH_CODE_EMAIL_I18N['en'];
  const content = `
    <p style="color: #475569; font-size: 14px;">${t.bodyText}</p>
    <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; text-align: center; margin: 20px 0;">
      <span style="font-size: 28px; font-weight: 800; letter-spacing: 6px; color: #166534; font-family: monospace;">${code}</span>
    </div>
    <p style="font-size: 13px; color: #64748b;">${t.validityText}</p>
  `;
  return { subject: t.subject, html: renderEmailWrapper(t.title, content) };
}

// Multi-language dictionary for purchase checkout email verification (7 Languages)
const CHECKOUT_EMAIL_I18N: Record<string, { subject: string; title: string; bodyHtml: string; validityText: string }> = {
  zh: {
    subject: "【EQT】您的购买邮箱验证码",
    title: "购买邮箱验证",
    bodyHtml: "感谢您选择 EQT 尊享服务。您当前正在验证购买邮箱，验证码为：",
    validityText: "验证码有效期为 10 分钟。请勿透露给他人。"
  },
  en: {
    subject: "[EQT] Your Purchase Email Verification Code",
    title: "Verify Your Purchase Email",
    bodyHtml: "Thank you for choosing EQT Premium. Your verification code for purchase is:",
    validityText: "Valid for 10 minutes. Do not share with anyone."
  },
  ja: {
    subject: "【EQT】ご購入用メールアドレス認証コード",
    title: "ご購入メールアドレスの確認",
    bodyHtml: "EQT プレミアムサービスをご選択いただきありがとうございます。認証コード：",
    validityText: "有効期限は10分間です。他人に共有しないでください。"
  },
  ko: {
    subject: "【EQT】구매 이메일 인증 코드",
    title: "구매 이메일 인증",
    bodyHtml: "EQT 프리미엄 서비스를 선택해 주셔서 감사합니다. 귀하의 인증 코드는 다음과 같습니다:",
    validityText: "이 코드는 10분 동안 유효합니다. 타인에게 공유하지 마세요."
  },
  es: {
    subject: "[EQT] Código de verificación para su compra",
    title: "Verificación de correo para la compra",
    bodyHtml: "Gracias por elegir EQT Premium. Su código de verificación para la compra es:",
    validityText: "Válido durante 10 minutos. No lo comparta con nadie."
  },
  de: {
    subject: "[EQT] Ihr Bestätigungscode für den Kauf",
    title: "Bestätigung der E-Mail-Adresse",
    bodyHtml: "Vielen Dank, dass Sie sich für EQT Premium entschieden haben. Ihr Bestätigungscode lautet:",
    validityText: "Gültig für 10 Minuten. Bitte nicht weitergeben."
  },
  fr: {
    subject: "[EQT] Votre code de vérification d'achat",
    title: "Vérification de l'e-mail d'achat",
    bodyHtml: "Merci d'avoir choisi EQT Premium. Votre code de vérification est :",
    validityText: "Valable pendant 10 minutes. Ne le partagez pas."
  }
};

function buildCheckoutEmailHtml(lang: string, code: string): { subject: string; html: string } {
  const norm = (lang || 'en').toLowerCase().substring(0, 2);
  const t = CHECKOUT_EMAIL_I18N[norm] || CHECKOUT_EMAIL_I18N['zh'] || CHECKOUT_EMAIL_I18N['en'];
  const content = `
    <p style="color: #475569; font-size: 14px;">${t.bodyHtml}</p>
    <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; text-align: center; margin: 20px 0;">
      <span style="font-size: 28px; font-weight: 800; letter-spacing: 6px; color: #166534; font-family: monospace;">${code}</span>
    </div>
    <p style="font-size: 13px; color: #64748b;">${t.validityText}</p>
  `;
  return { subject: t.subject, html: renderEmailWrapper(t.title, content) };
}

const DEVICE_NOTIFICATION_I18N: Record<string, {
  boundSubject: string;
  boundTitle: string;
  boundBody: (lic: string, time: string, devHash: string, current: number, max: number) => string;
  unboundSubject: string;
  unboundTitle: string;
  unboundBody: (lic: string, time: string, remainingUnbinds: number) => string;
}> = {
  zh: {
    boundSubject: "【EQT 授权安全提醒】您的授权码已绑定新设备",
    boundTitle: "新设备激活通知",
    boundBody: (lic, time, devHash, current, max) => `
      <p style="color: #475569; font-size: 14px;">尊敬的用户，您的 EQT 授权码已在新的硬件设备上完成绑定：</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>授权码：</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>绑定时间：</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>设备特征摘要：</strong> ${devHash}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>已用设备数：</strong> ${current} / ${max}</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">若非您本人操作，请及时前往用户自服务门户解绑非法设备。</p>`,
    unboundSubject: "【EQT 授权安全提醒】您的授权码已成功解绑一台设备",
    unboundTitle: "设备解绑成功通知",
    unboundBody: (lic, time, remainingUnbinds) => `
      <p style="color: #475569; font-size: 14px;">尊敬的用户，您的 EQT 授权码已成功解绑一台硬件设备：</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>授权码：</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>解绑时间：</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>过去 365 天剩余解绑额度：</strong> ${remainingUnbinds} / 4 次</p>
      </div>
      <p style="color: #64748b; font-size: 13px;"><strong>设备恢复与重新绑定说明：</strong><br/>
      1. 解绑后空出的设备额度现可用于绑定新的设备。<br/>
      2. 如需在原设备或新设备上恢复付费授权，只需在目标设备上打开 EQT 客户端并重新输入该授权码激活即可。<br/>
      3. 扣减的解绑额度将在该解绑操作发生 365 天后自动恢复。</p>`
  },
  en: {
    boundSubject: "[EQT Security Alert] New Device Bound to Your License",
    boundTitle: "New Device Activated",
    boundBody: (lic, time, devHash, current, max) => `
      <p style="color: #475569; font-size: 14px;">Hello, a new hardware device has been bound to your EQT license:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>License Code:</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Activated At:</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Device Hash:</strong> ${devHash}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Devices In Use:</strong> ${current} / ${max}</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">If you did not authorize this action, please visit the self-service portal to unbind unknown devices.</p>`,
    unboundSubject: "[EQT Security Alert] Device Unbound from Your License",
    unboundTitle: "Device Unbound Successfully",
    unboundBody: (lic, time, remainingUnbinds) => `
      <p style="color: #475569; font-size: 14px;">Hello, a device has been unbound from your EQT license:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>License Code:</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Unbound At:</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Remaining Yearly Unbind Quota:</strong> ${remainingUnbinds} / 4</p>
      </div>
      <p style="color: #64748b; font-size: 13px;"><strong>Device Slot & Restoration Guide:</strong><br/>
      1. The freed device slot is now available for new device activations.<br/>
      2. To restore authorization on a device, simply open EQT on that target device and re-enter this license code.<br/>
      3. Used unbind quota automatically recovers 365 days after the operation date.</p>`
  },
  ja: {
    boundSubject: "【EQT セキュリティ警告】新しいデバイスがライセンスに連携されました",
    boundTitle: "新規デバイスアクティベーション通知",
    boundBody: (lic, time, devHash, current, max) => `
      <p style="color: #475569; font-size: 14px;">EQT ライセンスに新しいハードウェアデバイスが連携されました：</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>ライセンスコード：</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>アクティベート日時：</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>デバイスハッシュ：</strong> ${devHash}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>使用中デバイス数：</strong> ${current} / ${max}</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">心当たりのない場合は、カスタマーポータルから解除を行ってください。</p>`,
    unboundSubject: "【EQT セキュリティ警告】デバイスの連携解除が完了しました",
    unboundTitle: "デバイス連携解除通知",
    unboundBody: (lic, time, remainingUnbinds) => `
      <p style="color: #475569; font-size: 14px;">EQT ライセンスからデバイスの連携が正常に解除されました：</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>ライセンスコード：</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>解除日時：</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>過去365日以内の残り解除枠：</strong> ${remainingUnbinds} / 4 回</p>
      </div>
      <p style="color: #64748b; font-size: 13px;"><strong>デバイス復元と再連携について：</strong><br/>
      1. 空いたデバイス枠は新しいデバイスのアクティベーションに使用できます。<br/>
      2. デバイスで有料機能を再有効化するには、EQT アプリを起動してこのライセンスコードを再入力してください。<br/>
      3. 消費された解除枠は、操作日から365日経過後に自動的に回復します。</p>`
  },
  ko: {
    boundSubject: "【EQT 보안 알림】새 기기가 라이선스에 연동되었습니다",
    boundTitle: "새 기기 인증 알림",
    boundBody: (lic, time, devHash, current, max) => `
      <p style="color: #475569; font-size: 14px;">EQT 라이선스에 새로운 하드웨어 기기가 연동되었습니다:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>라이선스 코드：</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>인증 시간：</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>기기 해시：</strong> ${devHash}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>사용 중 기기 수：</strong> ${current} / ${max}</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">본인의 요청이 아닌 경우 포털에서 임의 기기를 해제해 주세요.</p>`,
    unboundSubject: "【EQT 보안 알림】기기 연동이 해제되었습니다",
    unboundTitle: "기기 연동 해제 완료",
    unboundBody: (lic, time, remainingUnbinds) => `
      <p style="color: #475569; font-size: 14px;">EQT 라이선스에서 기기 연동 해제가 성공적으로 완료되었습니다:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>라이선스 코드：</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>해제 시간：</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>최근 365일 남은 해제 횟수：</strong> ${remainingUnbinds} / 4 회</p>
      </div>
      <p style="color: #64748b; font-size: 13px;"><strong>기기 복구 및 재연동 안내：</strong><br/>
      1. 확보된 슬롯은 새로운 기기 인증에 사용할 수 있습니다.<br/>
      2. 해제된 기기에서 인증을 다시 복구하려면 EQT 앱에서 라이선스 코드를 다시 입력해 주세요.<br/>
      3. 사용된 해제 횟수는 해당 작업일 기준 365일 후 자동으로 복구됩니다.</p>`
  },
  es: {
    boundSubject: "[EQT Alerta de Seguridad] Nuevo dispositivo vinculado a su licencia",
    boundTitle: "Nuevo dispositivo activado",
    boundBody: (lic, time, devHash, current, max) => `
      <p style="color: #475569; font-size: 14px;">Hola, se ha vinculado un nuevo dispositivo a su licencia EQT:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>Código de licencia:</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Fecha de activación:</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Hash de dispositivo:</strong> ${devHash}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Dispositivos en uso:</strong> ${current} / ${max}</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">Si no autorizó esta acción, desvincule los dispositivos en el portal de autoservicio.</p>`,
    unboundSubject: "[EQT Alerta de Seguridad] Dispositivo desvinculado con éxito",
    unboundTitle: "Dispositivo desvinculado",
    unboundBody: (lic, time, remainingUnbinds) => `
      <p style="color: #475569; font-size: 14px;">Un dispositivo se ha desvinculado correctamente de su licencia EQT:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>Código de licencia:</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Fecha de desvinculación:</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Cupo anual restante de desvinculaciones:</strong> ${remainingUnbinds} / 4</p>
      </div>
      <p style="color: #64748b; font-size: 13px;"><strong>Guía de restauración de dispositivos:</strong><br/>
      1. El espacio liberado está listo para activarse en un nuevo dispositivo.<br/>
      2. Para restaurar la licencia en un dispositivo, abra EQT en el dispositivo de destino y vuelva a ingresar este código.<br/>
      3. El cupo de desvinculación consumido se restaura automáticamente 365 días después de la operación.</p>`
  },
  de: {
    boundSubject: "[EQT Sicherheitsmeldung] Neues Gerät mit Ihrer Lizenz verknüpft",
    boundTitle: "Neues Gerät aktiviert",
    boundBody: (lic, time, devHash, current, max) => `
      <p style="color: #475569; font-size: 14px;">Hallo, ein neues Gerät wurde mit Ihrer EQT-Lizenz verknüpft:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>Lizenzschlüssel:</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Aktiviert am:</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Geräte-Hash:</strong> ${devHash}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Verwendete Geräte:</strong> ${current} / ${max}</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">Wenn Sie dies nicht autorisiert haben, trennen Sie unbekannte Geräte im Selbstbedienungsportal.</p>`,
    unboundSubject: "[EQT Sicherheitsmeldung] Gerät erfolgreich entkoppelt",
    unboundTitle: "Geräteentkopplung erfolgreich",
    unboundBody: (lic, time, remainingUnbinds) => `
      <p style="color: #475569; font-size: 14px;">Ein Gerät wurde erfolgreich von Ihrer EQT-Lizenz getrennt:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>Lizenzschlüssel:</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Entkoppelt am:</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Verbleibendes Jahreskontingent:</strong> ${remainingUnbinds} / 4</p>
      </div>
      <p style="color: #64748b; font-size: 13px;"><strong>Wiederherstellung & Neukopplung:</strong><br/>
      1. Der freigegebene Platz steht für eine neue Geräteaktivierung zur Verfügung.<br/>
      2. Um die Lizenz auf einem Gerät wiederherzustellen, geben Sie den Schlüssel in EQT erneut ein.<br/>
      3. Das verbrauchte Kontingent wird 365 Tage nach dem Entkopplungsdatum automatisch wiederhergestellt.</p>`
  },
  fr: {
    boundSubject: "[EQT Alerte de Sécurité] Nouveau périphérique lié à votre licence",
    boundTitle: "Nouveau périphérique activé",
    boundBody: (lic, time, devHash, current, max) => `
      <p style="color: #475569; font-size: 14px;">Bonjour, un nouveau périphérique a été lié à votre licence EQT :</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>Clé de licence :</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Activé le :</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Hash de l'appareil :</strong> ${devHash}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Périphériques utilisés :</strong> ${current} / ${max}</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">Si vous n'avez pas autorisé cette action, rendez-vous sur le portail client pour délier l'appareil.</p>`,
    unboundSubject: "[EQT Alerte de Sécurité] Périphérique dissocié avec succès",
    unboundTitle: "Dissociation du périphérique réussie",
    unboundBody: (lic, time, remainingUnbinds) => `
      <p style="color: #475569; font-size: 14px;">Un périphérique a été dissocié avec succès de votre licence EQT :</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>Clé de licence :</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Dissocié le :</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Quota annuel restant de dissociation :</strong> ${remainingUnbinds} / 4</p>
      </div>
      <p style="color: #64748b; font-size: 13px;"><strong>Restauration & Réassociation :</strong><br/>
      1. Emplacement libéré disponible pour l'activation d'un nouveau périphérique.<br/>
      2. Pour restaurer la licence sur un appareil cible, ouvrez EQT et ressaisissez cette clé de licence.<br/>
      3. Le quota de dissociation consommé se restaure automatiquement 365 jours après la date de l'opération.</p>`
  }
};

function getDeviceNoticeTemplate(lang: string) {
  const norm = (lang || 'en').toLowerCase().substring(0, 2);
  return DEVICE_NOTIFICATION_I18N[norm] || DEVICE_NOTIFICATION_I18N['zh'] || DEVICE_NOTIFICATION_I18N['en'];
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

    // Dynamic CORS Headers with Origin domain matching
    const corsHeaders = getCorsHeaders(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Admin Error Logs Query Endpoint (Server-Side Filtering & Pagination)
      if (url.pathname === "/api/v1/admin/error-logs" && request.method === "GET") {
        const denied = await requireAdminAuth(request, env, corsHeaders);
        if (denied) return denied;
        await ensureAuditLogTable(env);

        const level = (url.searchParams.get("level") || "").trim();
        const category = (url.searchParams.get("category") || "").trim();
        const queryStr = (url.searchParams.get("q") || url.searchParams.get("query") || "").trim();
        const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);
        const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

        const conditions: string[] = [];
        const params: any[] = [];

        if (level && level.toUpperCase() !== "ALL") {
          conditions.push("level = ?");
          params.push(level.toUpperCase());
        }
        if (category && category.toUpperCase() !== "ALL") {
          conditions.push("category = ?");
          params.push(category);
        }
        if (queryStr) {
          conditions.push("(error_message LIKE ? OR context_json LIKE ?)");
          params.push(`%${queryStr}%`, `%${queryStr}%`);
        }

        const whereClause = conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";

        // Query total count for pagination UI
        const countSql = "SELECT COUNT(*) as total FROM system_error_logs" + whereClause;
        const countRes = await env.DB.prepare(countSql).bind(...params).first<{ total: number }>();
        const total = countRes?.total || 0;

        // Query log items
        const logsSql = "SELECT * FROM system_error_logs" + whereClause + " ORDER BY id DESC LIMIT ? OFFSET ?";
        const logsRes = await env.DB.prepare(logsSql).bind(...params, limit, offset).all();

        return new Response(JSON.stringify({
          success: true,
          logs: logsRes.results || [],
          total,
          limit,
          offset
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Admin Error Logs Clear Endpoint
      if (
        (url.pathname === "/api/v1/admin/error-logs" && request.method === "DELETE") ||
        (url.pathname === "/api/v1/admin/error-logs/clear" && request.method === "POST")
      ) {
        const denied = await requireAdminAuth(request, env, corsHeaders);
        if (denied) return denied;
        await ensureAuditLogTable(env);
        await env.DB.prepare("DELETE FROM system_error_logs").run();
        return new Response(JSON.stringify({ success: true, message: "System error logs cleared successfully" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
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

      // 0.0 Send checkout email verification code (supports multi-language)
      if (url.pathname === "/api/v1/checkout/send-code" && request.method === "POST") {
        const body: any = await request.json();
        let email = body.email;
        const lang = body.lang || "en";

        if (!email || typeof email !== "string" || !email.includes("@")) {
          return new Response(JSON.stringify({ error: "Invalid email address" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        email = email.trim().toLowerCase();

        // Rate limit: check if a code was sent in the last 60 seconds
        const recentCode = await env.DB.prepare(
          "SELECT created_at FROM verification_codes WHERE email = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1"
        ).bind(email, new Date().toISOString()).first<any>();

        if (recentCode) {
          const createdAt = new Date(recentCode.created_at).getTime();
          if (Date.now() - createdAt < 60000) {
            return new Response(JSON.stringify({ error: "Please wait 60 seconds before requesting another code" }), {
              status: 429,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
        }

        // Generate 6-digit random code
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

        await env.DB.prepare(
          "INSERT OR REPLACE INTO verification_codes (email, code, expires_at, created_at) VALUES (?, ?, ?, ?)"
        ).bind(email, code, expiresAt, new Date().toISOString()).run();

        // Build localized email
        const { subject, html } = buildCheckoutEmailHtml(lang, code);
        ctx.waitUntil(sendDRMEmail(env, email, subject, html));

        return new Response(JSON.stringify({ success: true, message: "Verification code sent to your email" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 0.01 Verify checkout email code
      if (url.pathname === "/api/v1/checkout/verify-code" && request.method === "POST") {
        const body: any = await request.json();
        let email = body.email;
        let code = body.code;

        if (!email || !code) {
          return new Response(JSON.stringify({ error: "Missing email or verification code" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        email = email.trim().toLowerCase();
        code = code.trim();

        const record = await env.DB.prepare(
          "SELECT * FROM verification_codes WHERE email = ? AND code = ? ORDER BY expires_at DESC LIMIT 1"
        ).bind(email, code).first<any>();

        if (!record) {
          return new Response(JSON.stringify({ error: "Invalid verification code. Please check and try again." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const now = new Date().getTime();
        const exp = new Date(record.expires_at).getTime();
        if (isNaN(exp) || exp < now) {
          return new Response(JSON.stringify({ error: "Verification code has expired. Please send a new code." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Clean up verified code to prevent re-use
        ctx.waitUntil(env.DB.prepare("DELETE FROM verification_codes WHERE email = ?").bind(email).run());

        return new Response(JSON.stringify({ success: true, message: "Email verified successfully" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      // 0.1 Send email verification code
      if (url.pathname === "/api/v1/auth/send-code" && request.method === "POST") {
        const body: any = await request.json().catch(() => ({}));
        const reqLang = extractRequestLang(request, body);
        let email = body.email;
        if (!email) {
          return new Response(JSON.stringify({ error: getApiTranslation("missing_params", reqLang) }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        email = email.trim().toLowerCase();

        // 1. Check if email has purchase history in licenses table
        const encoder = new TextEncoder();
        const emailHashBuf = await crypto.subtle.digest("SHA-256", encoder.encode(email));
        const emailHash = Array.prototype.map.call(new Uint8Array(emailHashBuf), (x: number) => ('00' + x.toString(16)).slice(-2)).join('');

        const checkPurchase = await env.DB.prepare(
          "SELECT COUNT(*) as count FROM licenses WHERE buyer_email_hash = ? OR buyer_email = ?"
        ).bind(emailHash, email).first<any>();

        const hasPurchased = checkPurchase && Number(checkPurchase.count) > 0;
        if (!hasPurchased) {
          return new Response(JSON.stringify({ 
            error: getApiTranslation("no_purchase_history", reqLang) 
          }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Generate 6 digit verification code
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // Valid for 5 minutes

        // Insert code into DB
        await env.DB.prepare(
          "INSERT OR REPLACE INTO verification_codes (email, code, expires_at) VALUES (?, ?, ?)"
        ).bind(email, code, expiresAt).run();

        // Send mail via SMTPS with localized i18n template
        const mailSender = env.MAIL_SENDER || "noreply@eqt.net.im";
        const mailSenderPassword = env.MAIL_SENDER_PASSWORD || "q4W62}bWtR";
        const mailSendServer = env.MAIL_SEND_SERVER || "smtpserver.301098.xyz";
        const mailSendPort = parseInt(env.MAIL_SEND_SAFE_PORT || "465");
        
        const targetEmail = env.TEST_MAIL_RECEIVER || email;
        const mailObj = buildAuthCodeEmailHtml(reqLang, code);

        try {
          await sendMailViaSmtp({
            sender: mailSender,
            senderPass: mailSenderPassword,
            host: mailSendServer,
            port: mailSendPort,
            to: targetEmail,
            subject: mailObj.subject,
            html: mailObj.html
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

        const oneYearAgoIso = new Date(Date.now() - ONE_YEAR_MS).toISOString();

        const list: any[] = [];
        for (const lic of licenses) {
          const { results: activations } = await env.DB.prepare(
            "SELECT * FROM activations WHERE license_code = ?"
          ).bind(lic.license_code).all<any>();

          const unbindCheck = await env.DB.prepare(
            "SELECT COUNT(*) as count FROM unbind_records WHERE license_code = ? AND unbound_at >= ?"
          ).bind(lic.license_code, oneYearAgoIso).first<any>();
          const unbindCount = (unbindCheck && unbindCheck.count) ? Number(unbindCheck.count) : 0;
          const remainingUnbinds = Math.max(0, MAX_YEARLY_UNBINDS - unbindCount);

          list.push({
            ...lic,
            activations: activations,
            used_unbinds: unbindCount,
            remaining_unbinds: remainingUnbinds,
            max_yearly_unbinds: MAX_YEARLY_UNBINDS
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

      // 0.3.5 Unbind device with yearly limit & full i18n
      if (url.pathname === "/api/v1/user/unbind-device" && request.method === "POST") {
        const body: any = await request.json().catch(() => ({}));
        const reqLang = extractRequestLang(request, body);

        const authHeader = request.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return new Response(JSON.stringify({ error: getApiTranslation("unauthorized", reqLang) }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        const token = authHeader.substring(7);

        const session = await env.DB.prepare(
          "SELECT * FROM user_sessions WHERE session_token = ?"
        ).bind(token).first<any>();

        if (!session || new Date(session.expires_at).getTime() < Date.now()) {
          return new Response(JSON.stringify({ error: getApiTranslation("session_expired", reqLang) }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const { license_code, activation_id } = body;
        if (!license_code || !activation_id) {
          return new Response(JSON.stringify({ error: getApiTranslation("missing_params", reqLang) }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const license = await env.DB.prepare(
          "SELECT * FROM licenses WHERE license_code = ?"
        ).bind(license_code).first<any>();

        if (!license) {
          return new Response(JSON.stringify({ error: getApiTranslation("license_not_found", reqLang) }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Check 1-year rolling window unbind limit using constant
        const oneYearAgoISO = new Date(Date.now() - ONE_YEAR_MS).toISOString();
        const unbindCheck = await env.DB.prepare(
          "SELECT COUNT(*) as count FROM unbind_records WHERE license_code = ? AND unbound_at >= ?"
        ).bind(license_code, oneYearAgoISO).first<any>();

        const unbindCount = (unbindCheck && unbindCheck.count) ? Number(unbindCheck.count) : 0;
        if (unbindCount >= MAX_YEARLY_UNBINDS) {
          return new Response(JSON.stringify({
            error: getApiTranslation("unbind_limit_reached", reqLang)
          }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Delete activation record
        await env.DB.prepare(
          "DELETE FROM activations WHERE id = ? AND license_code = ?"
        ).bind(activation_id, license_code).run();

        // Record unbind history log
        const nowIso = new Date().toISOString();
        await env.DB.prepare(
          "INSERT INTO unbind_records (license_code, activation_id, unbound_at) VALUES (?, ?, ?)"
        ).bind(license_code, activation_id, nowIso).run();

        // Send unbind security email notification asynchronously
        const targetEmail = session.email || license.buyer_email;
        if (targetEmail) {
          const t = getDeviceNoticeTemplate(reqLang);
          const remainingUnbinds = MAX_YEARLY_UNBINDS - (unbindCount + 1);
          const emailHtml = renderEmailWrapper(t.unboundTitle, t.unboundBody(license_code, nowIso, remainingUnbinds));
          ctx.waitUntil(sendDRMEmail(
            env,
            targetEmail,
            t.unboundSubject,
            emailHtml
          ));
        }

        return new Response(JSON.stringify({
          success: true,
          message: getApiTranslation("unbind_success", reqLang),
          remaining_unbinds: MAX_YEARLY_UNBINDS - (unbindCount + 1)
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
        await ensureDeviceIdColumn(env);
        const body: any = await request.json();
        const reqLang = extractRequestLang(request, body);
        const { license_code, uuid_hash, cpu_hash, disk_hash, device_id } = body;

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
            "INSERT INTO activations (license_code, uuid_hash, cpu_hash, disk_hash, device_id, activated_at) VALUES (?, ?, ?, ?, ?, ?)"
          ).bind(
            license_code,
            uuid_hash || "",
            cpu_hash || "",
            disk_hash || "",
            device_id || "",
            new Date().toISOString()
          ).run();

          // Send activation notification email to the buyer asynchronously
          if (license.buyer_email) {
            const currentDevicesCount = activations.length + 1;
            const actTimeStr = new Date().toLocaleString();
            const devHashSummary = uuid_hash ? uuid_hash.substring(0, 8) + "..." : (cpu_hash ? cpu_hash.substring(0, 8) + "..." : "Default");
            
            const t = getDeviceNoticeTemplate(reqLang);
            const emailHtml = renderEmailWrapper(t.boundTitle, t.boundBody(license_code, actTimeStr, devHashSummary, currentDevicesCount, license.max_devices));
            ctx.waitUntil(sendDRMEmail(env, license.buyer_email, t.boundSubject, emailHtml));
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

        let baseExpiresAt = license.expires_at || "LIFETIME";
        if (license.duration_days !== null && license.duration_days !== undefined && Number(license.duration_days) >= 0) {
          baseExpiresAt = new Date(Date.now() + (Number(license.duration_days) * 86400 * 1000)).toISOString();
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

        const certificatePayloadStr = `${license_code}|${license.tier || "PLUS"}|${uuid_hash || ""}|${cpu_hash || ""}|${disk_hash || ""}|${baseExpiresAt}|${license.max_devices || 2}`;
        const certificateSignatureBuf = await crypto.subtle.sign("Ed25519", key, encoder.encode(certificatePayloadStr));
        const certificateSignatureHex = bufToHex(certificateSignatureBuf);

        return new Response(JSON.stringify({
          status: "OK",
          license_code: license_code,
          tier: license.tier || "PLUS",
          uuid_hash: uuid_hash || "",
          cpu_hash: cpu_hash || "",
          disk_hash: disk_hash || "",
          max_devices: license.max_devices || 2,
          activated_devices: activations.length,
          expires_at: baseExpiresAt,
          buyer_email: license.buyer_email || "",
          certificate_signature: certificateSignatureHex,
          current_time: currentTime,
          signature: signatureHex
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 2. Admin Endpoint: Manual license generation (supports /generate and /generate-license)
      if ((url.pathname === "/api/v1/admin/generate" || url.pathname === "/api/v1/admin/generate-license") && request.method === "POST") {
        const denied = await requireAdminAuth(request, env, corsHeaders);
        if (denied) return denied;

        const body: any = await request.json();
        const { tier, max_devices, expires_in_days, duration_days, buyer_email, send_email } = body;

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
        const cleanEmail = (buyer_email || "").trim();

        let emailHash: string | null = null;
        if (cleanEmail) {
          const encoder = new TextEncoder();
          const emailHashBuf = await crypto.subtle.digest("SHA-256", encoder.encode(cleanEmail.toLowerCase()));
          emailHash = Array.from(new Uint8Array(emailHashBuf), x => ('00' + x.toString(16)).slice(-2)).join('');
        }

        await env.DB.prepare(
          "INSERT INTO licenses (license_code, tier, status, max_devices, expires_at, duration_days, buyer_email_hash, buyer_email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(
          licenseCode,
          tier,
          "active",
          maxDev,
          expiresAt,
          durDays,
          emailHash,
          cleanEmail || null,
          new Date().toISOString()
        ).run();

        // Optional SMTP Email dispatch if requested and buyer_email provided
        let emailSent = false;
        if (send_email && cleanEmail) {
          const planName = tier === "PLUS" ? "EQT Plus" : (tier === "PRO" ? "EQT Pro" : tier);
          const expiresStr = expiresAt === "LIFETIME" ? "Lifetime (永久生效)" : new Date(expiresAt).toLocaleDateString();
          const emailHtml = `
            <div style="font-family: sans-serif; padding: 20px; line-height: 1.6; color: #333;">
              <h2 style="color: #10b981;">您的 EQT 专享授权激活码已发放！</h2>
              <p>管理员已成功为您创建 EQT 许可授权。以下是您的授权明细：</p>
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
                  <td style="padding: 10px; border: 1px solid #ddd;">${maxDev} 台设备</td>
                </tr>
              </table>
              <p><strong>如何激活：</strong></p>
              <ol>
                <li>打开 EQT 客户端，前往设置或关于面板。</li>
                <li>点击“输入激活码”并输入上述激活码，确认即可享受高级传输体验！</li>
              </ol>
            </div>
          `;
          ctx.waitUntil(sendDRMEmail(env, cleanEmail, "【EQT】您的专属授权激活码", emailHtml));
          emailSent = true;
        }

        return new Response(JSON.stringify({
          success: true,
          license_code: licenseCode,
          tier: tier,
          max_devices: maxDev,
          expires_at: expiresAt,
          duration_days: durDays,
          buyer_email: cleanEmail || null,
          email_sent: emailSent,
          status: "active"
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Admin Endpoint: Search all licenses (sort by created_at; real activations columns)
      if (url.pathname === "/api/v1/admin/licenses" && request.method === "GET") {
        const denied = await requireAdminAuth(request, env, corsHeaders);
        if (denied) return denied;

        const queryStr = (url.searchParams.get("q") || url.searchParams.get("query") || "").trim();
        const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);
        const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

        let sql = "SELECT * FROM licenses";
        let params: any[] = [];

        if (queryStr) {
          let emailHash = "";
          if (queryStr.includes("@")) {
            const encoder = new TextEncoder();
            const emailHashBuf = await crypto.subtle.digest("SHA-256", encoder.encode(queryStr.toLowerCase()));
            emailHash = Array.from(new Uint8Array(emailHashBuf), x => ('00' + x.toString(16)).slice(-2)).join('');
          }
          const likeQuery = `%${queryStr}%`;
          sql += " WHERE license_code LIKE ? OR buyer_email LIKE ? OR paddle_transaction_id LIKE ? OR buyer_email_hash = ?";
          params = [likeQuery, likeQuery, likeQuery, emailHash || queryStr];
        }

        sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
        params.push(limit, offset);

        const res = await env.DB.prepare(sql).bind(...params).all();

        const rawLicenses: any[] = res.results || [];
        let licensesWithDevices: any[] = [];

        if (rawLicenses.length > 0) {
          const licenseCodes = rawLicenses.map(lic => lic.license_code);
          const placeholders = licenseCodes.map(() => '?').join(',');
          const actSql = `SELECT id, license_code, uuid_hash, cpu_hash, disk_hash, device_id, activated_at FROM activations WHERE license_code IN (${placeholders}) ORDER BY id ASC`;
          const actRes = await env.DB.prepare(actSql).bind(...licenseCodes).all();
          const rawActivations: any[] = actRes.results || [];

          const activationsMap = new Map<string, any[]>();
          for (const act of rawActivations) {
            const list = activationsMap.get(act.license_code) || [];
            list.push(act);
            activationsMap.set(act.license_code, list);
          }

          licensesWithDevices = rawLicenses.map((lic) => {
            const acts = activationsMap.get(lic.license_code) || [];
            return {
              ...lic,
              active_devices_count: acts.length,
              activations: acts
            };
          });
        }

        return new Response(JSON.stringify({ success: true, licenses: licensesWithDevices }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Admin Endpoint: Revoke license (supports /revoke and /revoke-license)
      if ((url.pathname === "/api/v1/admin/revoke" || url.pathname === "/api/v1/admin/revoke-license") && request.method === "POST") {
        const denied = await requireAdminAuth(request, env, corsHeaders);
        if (denied) return denied;

        const body: any = await request.json();
        const { license_code } = body;
        if (!license_code) {
          return new Response(JSON.stringify({ error: "license_code is required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const existing = await env.DB.prepare(
          "SELECT license_code, status FROM licenses WHERE license_code = ?"
        ).bind(license_code).first<any>();

        if (!existing) {
          return new Response(JSON.stringify({ error: "License not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        await env.DB.prepare("UPDATE licenses SET status = 'revoked' WHERE license_code = ?").bind(license_code).run();
        return new Response(JSON.stringify({
          success: true,
          message: `License ${license_code} revoked successfully`,
          license_code,
          status: "revoked"
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Admin Endpoint: Unbind devices by activation_id (or clear all for license)
      if (url.pathname === "/api/v1/admin/unbind" && request.method === "POST") {
        const denied = await requireAdminAuth(request, env, corsHeaders);
        if (denied) return denied;

        const body: any = await request.json();
        const { license_code, activation_id } = body;
        if (!license_code) {
          return new Response(JSON.stringify({ error: "license_code is required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const lic = await env.DB.prepare(
          "SELECT license_code FROM licenses WHERE license_code = ?"
        ).bind(license_code).first<any>();
        if (!lic) {
          return new Response(JSON.stringify({ error: "License not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        let unboundActivationId: number | null = null;
        if (activation_id !== undefined && activation_id !== null && activation_id !== "") {
          const actId = Number(activation_id);
          if (!Number.isFinite(actId)) {
            return new Response(JSON.stringify({ error: "activation_id must be a number" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
          const act = await env.DB.prepare(
            "SELECT id FROM activations WHERE id = ? AND license_code = ?"
          ).bind(actId, license_code).first<any>();
          if (!act) {
            return new Response(JSON.stringify({ error: "Activation not found for this license" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
          await env.DB.prepare(
            "DELETE FROM activations WHERE id = ? AND license_code = ?"
          ).bind(actId, license_code).run();
          unboundActivationId = actId;
        } else {
          await env.DB.prepare("DELETE FROM activations WHERE license_code = ?").bind(license_code).run();
        }

        // Admin unbind does not write unbind_records (ops privilege; see api-contract)
        return new Response(JSON.stringify({
          success: true,
          message: `Devices for license ${license_code} unbound successfully`,
          license_code,
          unbound_activation_id: unboundActivationId
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Admin Endpoint: System Health Probe
      if (url.pathname === "/api/v1/admin/health" && request.method === "GET") {
        const denied = await requireAdminAuth(request, env, corsHeaders);
        if (denied) return denied;

        let dbStatus = "ok";
        let errorCount = 0;
        let licenseCount = 0;
        try {
          const licCountRes = await env.DB.prepare("SELECT count(*) as count FROM licenses").first<{ count: number }>();
          licenseCount = licCountRes?.count || 0;
          await ensureAuditLogTable(env);
          const errCountRes = await env.DB.prepare("SELECT count(*) as count FROM system_error_logs").first<{ count: number }>();
          errorCount = errCountRes?.count || 0;
        } catch (e: any) {
          dbStatus = e?.message || "error";
        }

        return new Response(JSON.stringify({
          success: true,
          status: "healthy",
          timestamp: new Date().toISOString(),
          metrics: {
            total_licenses: licenseCount,
            total_error_logs: errorCount
          },
          config: {
            smtp_configured: !!env.MAIL_SEND_SERVER,
            paddle_configured: !!env.PADDLE_WEBHOOK_SECRET,
            r2_configured: !!env.R2_PUBLIC_URL,
            db_status: dbStatus
          }
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
          let buyerEmail = data.customer?.email || data.billing_details?.email_address || data.customer_email || data.user?.email || data.custom_data?.email || data.custom_data?.buyer_email || data.custom_data?.buyerEmail || "";

          const customerId = data.customer_id || (typeof data.customer === 'string' ? data.customer : null);
          if (!buyerEmail && customerId && env.PADDLE_API_KEY) {
            try {
              const isSandbox = env.PADDLE_API_KEY.startsWith("pdl_sdbx_");
              const paddleBaseUrl = isSandbox ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
              const custRes = await fetch(`${paddleBaseUrl}/customers/${customerId}`, {
                headers: { "Authorization": `Bearer ${env.PADDLE_API_KEY}` }
              });
              if (custRes.ok) {
                const custData: any = await custRes.json();
                buyerEmail = custData.data?.email || "";
              }
            } catch (cErr) {
              console.error("Failed to fetch customer email from Paddle API:", cErr);
            }
          }

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
      ctx.waitUntil(logSystemError(env, 'SERVER_EXCEPTION', 'CRITICAL', e, { url: request.url, method: request.method }));
      const safeMsg = getSafeUserErrorMessage(e.message || String(e), "An unexpected server error occurred. Please try again later.");
      return new Response(JSON.stringify({ error: safeMsg }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
