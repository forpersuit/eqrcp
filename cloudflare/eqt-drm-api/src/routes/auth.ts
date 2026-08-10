import { Env } from '../types';
import { extractRequestLang, getApiTranslation } from '../i18n';
import { sendDRMEmail, buildAuthCodeEmailHtml, buildCheckoutEmailHtml, sendMailViaSmtp } from '../services/smtp';
import { logSystemError } from '../utils/error-logger';
import { sha256Hex, verificationStorageKey, VerificationPurpose } from '../utils/crypto';
import { ensureVerificationCodesCreatedAt } from '../utils/auth';
import { clientIpFromRequest } from '../utils/rate-limit';
import { checkEmailBlacklist } from '../utils/blacklist';

const SEND_CODE_COOLDOWN_MS = 60_000;
const OTP_VERIFY_WINDOW_MS = 15 * 60 * 1000;
const OTP_VERIFY_MAX_FAILS = 8;

async function isSendCodeRateLimited(env: Env, storageKey: string): Promise<boolean> {
  await ensureVerificationCodesCreatedAt(env);
  const recentCode = await env.DB.prepare(
    "SELECT created_at FROM verification_codes WHERE email = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1"
  ).bind(storageKey, new Date().toISOString()).first<any>();

  if (!recentCode || !recentCode.created_at) return false;
  const createdAt = new Date(recentCode.created_at).getTime();
  if (isNaN(createdAt)) return false;
  return Date.now() - createdAt < SEND_CODE_COOLDOWN_MS;
}

/** D1-backed fail counter (multi-isolate safe). Key: fail:{purpose}:{ip}:{email} */
function otpFailStorageKey(request: Request, purpose: VerificationPurpose, email: string): string {
  return `fail:${purpose}:${clientIpFromRequest(request)}:${email}`;
}

async function isOtpVerifyBlocked(env: Env, failKey: string): Promise<boolean> {
  await ensureVerificationCodesCreatedAt(env);
  const row = await env.DB.prepare(
    "SELECT code, created_at FROM verification_codes WHERE email = ?"
  ).bind(failKey).first<any>();
  if (!row || !row.created_at) return false;
  const windowStart = new Date(row.created_at).getTime();
  if (isNaN(windowStart) || Date.now() - windowStart > OTP_VERIFY_WINDOW_MS) return false;
  return (parseInt(row.code, 10) || 0) >= OTP_VERIFY_MAX_FAILS;
}

async function recordOtpVerifyFail(env: Env, failKey: string): Promise<void> {
  await ensureVerificationCodesCreatedAt(env);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const expIso = new Date(now + OTP_VERIFY_WINDOW_MS).toISOString();
  const row = await env.DB.prepare(
    "SELECT code, created_at FROM verification_codes WHERE email = ?"
  ).bind(failKey).first<any>();

  let fails = 1;
  let createdAt = nowIso;
  if (row && row.created_at) {
    const windowStart = new Date(row.created_at).getTime();
    if (!isNaN(windowStart) && now - windowStart <= OTP_VERIFY_WINDOW_MS) {
      fails = (parseInt(row.code, 10) || 0) + 1;
      createdAt = row.created_at;
    }
  }

  await env.DB.prepare(
    "INSERT OR REPLACE INTO verification_codes (email, code, expires_at, created_at) VALUES (?, ?, ?, ?)"
  ).bind(failKey, String(fails), expIso, createdAt).run();
}

async function clearOtpVerifyFails(env: Env, failKey: string): Promise<void> {
  await env.DB.prepare("DELETE FROM verification_codes WHERE email = ?").bind(failKey).run();
}

export async function handleAuthRoutes(

  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
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
    const storageKey = verificationStorageKey("checkout", email);
    const reqLang = (lang || "en").toString().substring(0, 2);

    // Gate A: purchase-time email blacklist (before OTP / Paddle)
    const emailBl = await checkEmailBlacklist(env, email);
    if (emailBl.isAbusive) {
      return new Response(JSON.stringify({
        error: getApiTranslation("blacklist_email", reqLang) || emailBl.reason,
        reason_key: "blacklist_email"
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Rate limit: check if a code was sent in the last 60 seconds
    if (await isSendCodeRateLimited(env, storageKey)) {
      return new Response(JSON.stringify({ error: "Please wait 60 seconds before requesting another code" }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Generate 6-digit random code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes
    const createdAt = new Date().toISOString();

    await env.DB.prepare(
      "INSERT OR REPLACE INTO verification_codes (email, code, expires_at, created_at) VALUES (?, ?, ?, ?)"
    ).bind(storageKey, code, expiresAt, createdAt).run();

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
    const reqLang = extractRequestLang(request, body);

    if (!email || !code) {
      return new Response(JSON.stringify({ error: "Missing email or verification code" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    email = email.trim().toLowerCase();
    code = code.trim();
    const storageKey = verificationStorageKey("checkout", email);
    const failKey = otpFailStorageKey(request, "checkout", email);

    if (await isOtpVerifyBlocked(env, failKey)) {
      return new Response(JSON.stringify({ error: getApiTranslation("too_many_verify_attempts", reqLang) }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Gate A again at verify (defense in depth if status changed after send-code)
    const emailBlVerify = await checkEmailBlacklist(env, email);
    if (emailBlVerify.isAbusive) {
      return new Response(JSON.stringify({
        error: getApiTranslation("blacklist_email", reqLang) || emailBlVerify.reason,
        reason_key: "blacklist_email"
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const record = await env.DB.prepare(
      "SELECT * FROM verification_codes WHERE email = ? AND code = ? ORDER BY expires_at DESC LIMIT 1"
    ).bind(storageKey, code).first<any>();

    if (!record) {
      await recordOtpVerifyFail(env, failKey);
      return new Response(JSON.stringify({ error: "Invalid verification code. Please check and try again." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const now = new Date().getTime();
    const exp = new Date(record.expires_at).getTime();
    if (isNaN(exp) || exp < now) {
      await recordOtpVerifyFail(env, failKey);
      return new Response(JSON.stringify({ error: "Verification code has expired. Please send a new code." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    await clearOtpVerifyFails(env, failKey);
    // Clean up verified code to prevent re-use
    ctx.waitUntil(env.DB.prepare("DELETE FROM verification_codes WHERE email = ?").bind(storageKey).run());

    return new Response(JSON.stringify({ success: true, message: "Email verified successfully" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 0.1 Send portal login email verification code
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
    const storageKey = verificationStorageKey("portal", email);

    // 1. Check if email has purchase history in licenses table
    const emailHash = await sha256Hex(email);

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

    // 2. 60s rate limit (aligned with checkout)
    if (await isSendCodeRateLimited(env, storageKey)) {
      return new Response(JSON.stringify({
        error: getApiTranslation("rate_limited", reqLang)
      }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Generate 6 digit verification code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // Valid for 5 minutes
    const createdAt = new Date().toISOString();

    // Insert code into DB (portal: purpose-prefixed key)
    await env.DB.prepare(
      "INSERT OR REPLACE INTO verification_codes (email, code, expires_at, created_at) VALUES (?, ?, ?, ?)"
    ).bind(storageKey, code, expiresAt, createdAt).run();

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
      ctx.waitUntil(logSystemError(env, 'SMTP_EMAIL_FAIL', 'WARN', mailErr, { to: targetEmail, subject: mailObj.subject }));
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
    const reqLang = extractRequestLang(request, body);
    let { email, code } = body;
    if (!email || !code) {
      return new Response(JSON.stringify({ error: "Missing email or code" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    email = email.trim().toLowerCase();
    code = code.trim();
    const storageKey = verificationStorageKey("portal", email);
    const failKey = otpFailStorageKey(request, "portal", email);

    if (await isOtpVerifyBlocked(env, failKey)) {
      return new Response(JSON.stringify({ error: getApiTranslation("too_many_verify_attempts", reqLang) }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const record = await env.DB.prepare(
      "SELECT * FROM verification_codes WHERE email = ?"
    ).bind(storageKey).first<any>();

    if (!record || record.code !== code) {
      await recordOtpVerifyFail(env, failKey);
      return new Response(JSON.stringify({ error: "Invalid verification code" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const expiresAt = new Date(record.expires_at).getTime();
    if (expiresAt < Date.now()) {
      await recordOtpVerifyFail(env, failKey);
      return new Response(JSON.stringify({ error: "Verification code expired" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    await clearOtpVerifyFails(env, failKey);

    // Delete verification code
    await env.DB.prepare("DELETE FROM verification_codes WHERE email = ?").bind(storageKey).run();

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

  // 0.25 Logout — invalidate portal session (idempotent)
  if (url.pathname === "/api/v1/auth/logout" && request.method === "POST") {
    const authHeader = request.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      if (token) {
        await env.DB.prepare(
          "DELETE FROM user_sessions WHERE session_token = ?"
        ).bind(token).run();
      }
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  return null;
}
