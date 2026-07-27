import { Env, ONE_YEAR_MS, MAX_YEARLY_UNBINDS } from '../types';
import { extractRequestLang, getApiTranslation, getDeviceNoticeTemplate, getLicenseRevokeEmailTemplate, AUTH_CODE_EMAIL_I18N } from '../i18n';
import { sendDRMEmail, renderEmailWrapper } from '../services/smtp';
import { logSystemError } from '../utils/error-logger';
import { sha256Hex, licenseOwnedByEmail } from '../utils/crypto';
import { checkEmailBlacklist as checkEmailRefundBlacklist } from '../utils/blacklist';
import {
  isLicenseCancellable,
  isLicenseRefundable,
  isRealPaddleSubscriptionId,
  isRealPaddleTransactionId,
  isSyntheticTestSubscriptionId,
  isSyntheticTestTransactionId,
  normalizeLicenseSource,
  revokeLicenseSql
} from '../utils/license-source';
import { ensureLicenseSourceColumns } from '../utils/auth';

/** Never leak raw Paddle JSON dumps to the browser toast. */
function sanitizeRefundPublicError(err: unknown, reqLang: string): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  // Known Paddle shapes we map to friendly copy
  if (/invalid_url|not[_ ]found|transaction.*not found/i.test(raw)) {
    return getApiTranslation('paddle_transaction_invalid', reqLang);
  }
  if (/already.?refund|adjustment/i.test(raw) && /conflict|invalid/i.test(raw)) {
    return getApiTranslation('license_already_revoked', reqLang);
  }
  // Strip embedded JSON / multi-line dumps
  const firstLine = raw.split('\n')[0] || '';
  const withoutJson = firstLine.replace(/\{[\s\S]*$/, '').trim();
  if (!withoutJson || withoutJson.length < 8 || /Failed to fetch transaction|Paddle refund/i.test(withoutJson)) {
    return getApiTranslation('refund_failed', reqLang);
  }
  return withoutJson.length > 160 ? withoutJson.slice(0, 160) + '…' : withoutJson;
}

async function revokeLicenseAndNotify(
  env: Env,
  ctx: ExecutionContext,
  license: any,
  license_code: string,
  sessionEmail: string,
  reqLang: string,
  reason: string = 'refund'
): Promise<void> {
  await env.DB.prepare(revokeLicenseSql()).bind(
    new Date().toISOString(),
    reason,
    license_code
  ).run();

  const notifyEmail = sessionEmail || license.buyer_email;
  if (notifyEmail) {
    const planName = license.tier === "PLUS" ? "EQT Plus" : (license.tier === "PRO" ? "EQT Pro" : (license.tier || "EQT"));
    const t = getLicenseRevokeEmailTemplate(reqLang, reason);
    const emailHtml = renderEmailWrapper(t.title, t.body(license_code, planName));
    ctx.waitUntil(sendDRMEmail(env, notifyEmail, t.subject, emailHtml));
  }
}

async function ensureAutoRenewColumn(env: Env) {
  try {
    await env.DB.prepare("ALTER TABLE licenses ADD COLUMN auto_renew INTEGER DEFAULT 1").run();
  } catch (_) {
    // Column already exists
  }
}

export async function handlePortalRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
  // 0.1 Send login verification code
  if (url.pathname === "/api/v1/user/send-code" && request.method === "POST") {
    await ensureLicenseSourceColumns(env);
    await ensureAutoRenewColumn(env);
    const body: any = await request.json().catch(() => ({}));
    const reqLang = extractRequestLang(request, body);
    const email = (body.email || "").trim().toLowerCase();

    if (!email || !email.includes("@")) {
      return new Response(JSON.stringify({ error: getApiTranslation("missing_params", reqLang) }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const emailHash = await sha256Hex(email);

    // Gate A: Check email-based refund blacklist gate
    const emailBlacklist = await checkEmailRefundBlacklist(env, emailHash);
    if (emailBlacklist.isAbusive) {
      return new Response(JSON.stringify({
        error: getApiTranslation("blacklist_email", reqLang) || emailBlacklist.reason,
        reason_key: "blacklist_email"
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Purchase check: Email must exist in licenses table as buyer_email OR buyer_email_hash
    const countRow = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM licenses WHERE buyer_email = ? OR buyer_email_hash = ?"
    ).bind(email, emailHash).first<any>();

    if (!countRow || Number(countRow.cnt) <= 0) {
      return new Response(JSON.stringify({ error: getApiTranslation("no_purchase_history", reqLang) }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { results: recent } = await env.DB.prepare(
      "SELECT created_at FROM auth_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1"
    ).bind(email).all<any>();

    if (recent && recent.length > 0) {
      const lastTime = new Date(recent[0].created_at).getTime();
      if (Date.now() - lastTime < 60 * 1000) {
        return new Response(JSON.stringify({ error: getApiTranslation("rate_limited", reqLang) }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await env.DB.prepare(
      "INSERT INTO auth_codes (email, code, expires_at, created_at) VALUES (?, ?, ?, ?)"
    ).bind(email, code, expiresAt, new Date().toISOString()).run();

    const template = AUTH_CODE_EMAIL_I18N[reqLang] || AUTH_CODE_EMAIL_I18N['zh'] || AUTH_CODE_EMAIL_I18N['en'];
    const emailHtml = renderEmailWrapper(template.title, `
      <p style="color: #475569; font-size: 14px;">${template.bodyText}</p>
      <div style="background: #f1f5f9; padding: 16px; border-radius: 8px; font-size: 28px; font-weight: bold; letter-spacing: 4px; text-align: center; color: #0f172a; margin: 16px 0;">
        ${code}
      </div>
      <p style="color: #64748b; font-size: 13px;">${template.validityText}</p>
    `);

    ctx.waitUntil(sendDRMEmail(env, email, template.subject, emailHtml));

    return new Response(JSON.stringify({ success: true, message: getApiTranslation("toast_code_sent", reqLang) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 0.2 Verify code & Login
  if (url.pathname === "/api/v1/user/verify-code" && request.method === "POST") {
    await ensureLicenseSourceColumns(env);
    await ensureAutoRenewColumn(env);
    const body: any = await request.json().catch(() => ({}));
    const reqLang = extractRequestLang(request, body);
    const email = (body.email || "").trim().toLowerCase();
    const code = (body.code || "").trim();

    if (!email || !code) {
      return new Response(JSON.stringify({ error: getApiTranslation("missing_params", reqLang) }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const record = await env.DB.prepare(
      "SELECT * FROM auth_codes WHERE email = ? AND code = ? ORDER BY created_at DESC LIMIT 1"
    ).bind(email, code).first<any>();

    if (!record || new Date(record.expires_at).getTime() < Date.now()) {
      return new Response(JSON.stringify({ error: getApiTranslation("session_expired", reqLang) }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    await env.DB.prepare("DELETE FROM auth_codes WHERE email = ?").bind(email).run();

    const token = crypto.randomUUID();
    const sessionExpires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

    await env.DB.prepare(
      "INSERT INTO user_sessions (email, session_token, expires_at, created_at) VALUES (?, ?, ?, ?)"
    ).bind(email, token, sessionExpires, new Date().toISOString()).run();

    return new Response(JSON.stringify({
      success: true,
      token,
      email,
      expires_at: sessionExpires
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 0.3 Fetch User Licenses & Activations
  if (url.pathname === "/api/v1/user/licenses" && request.method === "GET") {
    await ensureLicenseSourceColumns(env);
    await ensureAutoRenewColumn(env);
    const reqLang = extractRequestLang(request);
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

    const email = session.email;
    const emailHash = await sha256Hex(email);

    const { results: licenses } = await env.DB.prepare(
      "SELECT * FROM licenses WHERE buyer_email = ? OR buyer_email_hash = ? ORDER BY created_at DESC"
    ).bind(email, emailHash).all<any>();

    const oneYearAgoIso = new Date(Date.now() - 365 * 86400 * 1000).toISOString();

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
      const source = normalizeLicenseSource(lic.source, lic.paddle_transaction_id);

      list.push({
        ...lic,
        source,
        auto_renew: lic.auto_renew === 0 ? 0 : 1,
        auto_renew_toggleable: lic.status === 'active' && Boolean(lic.paddle_subscription_id),
        refundable: isLicenseRefundable({ ...lic, source }),
        cancellable: isLicenseCancellable({ ...lic, source }),
        // Real Paddle purchase txn → can open invoice/receipt via Paddle API
        invoiceable: isRealPaddleTransactionId(lic.paddle_transaction_id),
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

  // 0.3.5 Unbind device with ownership, yearly limit & full i18n
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

    const emailHash = await sha256Hex(session.email);
    if (!licenseOwnedByEmail(license, session.email, emailHash)) {
      return new Response(JSON.stringify({ error: getApiTranslation("not_license_owner", reqLang) }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (license.status !== "active") {
      return new Response(JSON.stringify({ error: getApiTranslation("license_not_active", reqLang) }), {
        status: 403,
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

    const activation = await env.DB.prepare(
      "SELECT id FROM activations WHERE id = ? AND license_code = ?"
    ).bind(activation_id, license_code).first<any>();

    if (!activation) {
      return new Response(JSON.stringify({ error: getApiTranslation("activation_not_found", reqLang) }), {
        status: 404,
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
    await ensureLicenseSourceColumns(env);
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

    const { license_code } = body;
    if (!license_code) {
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

    const emailHash = await sha256Hex(session.email);
    if (!licenseOwnedByEmail(license, session.email, emailHash)) {
      return new Response(JSON.stringify({ error: getApiTranslation("not_license_owner", reqLang) }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (license.status === "revoked") {
      return new Response(JSON.stringify({ error: getApiTranslation("license_already_revoked", reqLang) }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const source = normalizeLicenseSource(license.source, license.paddle_transaction_id);
    const transactionId = license.paddle_transaction_id;

    // Fixture / e2e: allow local revoke only for explicit test source or synthetic txn
    if (source === "test" || isSyntheticTestTransactionId(transactionId || "")) {
      try {
        await revokeLicenseAndNotify(env, ctx, license, license_code, session.email, reqLang, 'test');
        return new Response(JSON.stringify({
          success: true,
          message: getApiTranslation("refund_test_local_success", reqLang),
          local_only: true
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err: any) {
        console.error("Local test refund error:", err);
        return new Response(JSON.stringify({
          error: getApiTranslation("refund_failed", reqLang)
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // Promo / admin / non-purchase: never refundable via portal
    if (!isLicenseRefundable({ ...license, source })) {
      return new Response(JSON.stringify({ error: getApiTranslation("refund_not_allowed_for_source", reqLang) }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (!transactionId) {
      return new Response(JSON.stringify({ error: getApiTranslation("no_paddle_transaction", reqLang) }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (!isRealPaddleTransactionId(transactionId)) {
      return new Response(JSON.stringify({ error: getApiTranslation("paddle_transaction_invalid", reqLang) }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const paddleApiKey = env.PADDLE_API_KEY;
    if (!paddleApiKey) {
      return new Response(JSON.stringify({ error: getApiTranslation("paddle_not_configured", reqLang) }), {
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

      // Revoke local license immediately + async multi-language revoke notice
      await revokeLicenseAndNotify(env, ctx, license, license_code, session.email, reqLang);

      return new Response(JSON.stringify({
        success: true,
        message: getApiTranslation("refund_success", reqLang),
        adjustment: adjData
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } catch (err: any) {
      console.error("Refund processing error:", err);
      ctx.waitUntil(logSystemError(env, 'PADDLE_API_ERROR', 'ERROR', err, {
        path: url.pathname,
        action: 'portal_refund',
        transaction_id: transactionId || null
      }));
      return new Response(JSON.stringify({
        error: sanitizeRefundPublicError(err, reqLang)
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }

  // 0.4.5 Toggle Auto-Renew (Auto-Renew Off keeps license active until expires_at!)
  if (url.pathname === "/api/v1/user/toggle-auto-renew" && request.method === "POST") {
    await ensureLicenseSourceColumns(env);
    await ensureAutoRenewColumn(env);
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

    const { license_code, auto_renew } = body;
    if (!license_code) {
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

    const emailHash = await sha256Hex(session.email);
    if (!licenseOwnedByEmail(license, session.email, emailHash)) {
      return new Response(JSON.stringify({ error: getApiTranslation("not_license_owner", reqLang) }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const targetAutoRenew = auto_renew === false || auto_renew === 0 ? 0 : 1;
    const subscriptionId = license.paddle_subscription_id as string | null;

    // Next billing period cancel on Paddle if turning off auto-renew
    if (targetAutoRenew === 0 && subscriptionId && isRealPaddleSubscriptionId(subscriptionId)) {
      const paddleApiKey = env.PADDLE_API_KEY;
      if (paddleApiKey) {
        const isSandbox = paddleApiKey.startsWith("pdl_sdbx_");
        const paddleBaseUrl = isSandbox ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
        try {
          await fetch(`${paddleBaseUrl}/subscriptions/${subscriptionId}/cancel`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${paddleApiKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              effective_from: "next_billing_period"
            })
          });
        } catch (e) {
          console.error("Paddle next_billing_period cancel warning:", e);
        }
      }
    }

    // Update D1 database (KEEP license.status = 'active' so current paid period remains usable!)
    await env.DB.prepare(
      "UPDATE licenses SET auto_renew = ? WHERE license_code = ?"
    ).bind(targetAutoRenew, license_code).run();

    const msgKey = targetAutoRenew === 1 ? "auto_renew_on_success" : "auto_renew_off_success";
    return new Response(JSON.stringify({
      success: true,
      auto_renew: targetAutoRenew,
      message: getApiTranslation(msgKey, reqLang)
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 0.5 Cancel subscription (immediate revoke — not a refund)
  if (url.pathname === "/api/v1/user/cancel-subscription" && request.method === "POST") {
    await ensureLicenseSourceColumns(env);
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

    const { license_code } = body;
    if (!license_code) {
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

    const emailHash = await sha256Hex(session.email);
    if (!licenseOwnedByEmail(license, session.email, emailHash)) {
      return new Response(JSON.stringify({ error: getApiTranslation("not_license_owner", reqLang) }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (license.status === "revoked") {
      return new Response(JSON.stringify({ error: getApiTranslation("license_already_revoked", reqLang) }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const source = normalizeLicenseSource(license.source, license.paddle_transaction_id);
    const subscriptionId = license.paddle_subscription_id as string | null;

    if (!isLicenseCancellable({ ...license, source })) {
      return new Response(JSON.stringify({ error: getApiTranslation("cancel_not_allowed", reqLang) }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // E2E / fixture: synthetic sub id → local revoke only (no Paddle)
    if (
      source === "test" ||
      isSyntheticTestSubscriptionId(subscriptionId || "") ||
      isSyntheticTestTransactionId(license.paddle_transaction_id || "")
    ) {
      try {
        await revokeLicenseAndNotify(env, ctx, license, license_code, session.email, reqLang, "subscription");
        return new Response(JSON.stringify({
          success: true,
          message: getApiTranslation("cancel_test_local_success", reqLang),
          local_only: true
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err: any) {
        console.error("Local test cancel error:", err);
        return new Response(JSON.stringify({
          error: getApiTranslation("cancel_failed", reqLang)
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    if (!subscriptionId || !isRealPaddleSubscriptionId(subscriptionId)) {
      return new Response(JSON.stringify({ error: getApiTranslation("no_paddle_subscription", reqLang) }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const paddleApiKey = env.PADDLE_API_KEY;
    if (!paddleApiKey) {
      return new Response(JSON.stringify({ error: getApiTranslation("paddle_not_configured", reqLang) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const isSandbox = paddleApiKey.startsWith("pdl_sdbx_");
    const paddleBaseUrl = isSandbox ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";

    try {
      // Product decision (2026-07-25): cancel → effective immediately + local revoke now
      const cancelRes = await fetch(`${paddleBaseUrl}/subscriptions/${subscriptionId}/cancel`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${paddleApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          effective_from: "immediately"
        })
      });

      if (!cancelRes.ok) {
        const errBody = await cancelRes.text();
        // Already canceled on Paddle: still revoke local so Portal matches
        const already =
          /already.?cancel|subscription_?canceled|canceled|cancelled/i.test(errBody) ||
          cancelRes.status === 409;
        if (!already) {
          throw new Error(`Paddle subscription cancel failed: ${errBody}`);
        }
      }

      let paddleCancel: unknown = null;
      try {
        paddleCancel = await cancelRes.json();
      } catch {
        paddleCancel = null;
      }

      await revokeLicenseAndNotify(env, ctx, license, license_code, session.email, reqLang, "subscription");

      return new Response(JSON.stringify({
        success: true,
        message: getApiTranslation("cancel_success", reqLang),
        paddle: paddleCancel
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } catch (err: any) {
      console.error("Cancel subscription error:", err);
      ctx.waitUntil(logSystemError(env, 'PADDLE_API_ERROR', 'ERROR', err, {
        path: url.pathname,
        action: 'portal_cancel_subscription',
        subscription_id: subscriptionId || null
      }));
      return new Response(JSON.stringify({
        error: getApiTranslation("cancel_failed", reqLang)
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }

  // 0.6 Invoice / receipt link (Paddle MoR — temporary PDF or customer portal URL)
  if (url.pathname === "/api/v1/user/invoice-link" && request.method === "POST") {
    await ensureLicenseSourceColumns(env);
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

    const { license_code } = body;
    if (!license_code) {
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

    const emailHash = await sha256Hex(session.email);
    if (!licenseOwnedByEmail(license, session.email, emailHash)) {
      return new Response(JSON.stringify({ error: getApiTranslation("not_license_owner", reqLang) }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const transactionId = license.paddle_transaction_id as string | null;
    if (!transactionId || !isRealPaddleTransactionId(transactionId)) {
      return new Response(JSON.stringify({
        error: getApiTranslation("invoice_not_available", reqLang),
        support_email: "support@eqt.net.im"
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const paddleApiKey = env.PADDLE_API_KEY;
    if (!paddleApiKey) {
      return new Response(JSON.stringify({
        error: getApiTranslation("invoice_paddle_unavailable", reqLang),
        support_email: "support@eqt.net.im",
        transaction_id: transactionId
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const isSandbox = paddleApiKey.startsWith("pdl_sdbx_");
    const paddleBaseUrl = isSandbox ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
    const authHeaders = { Authorization: `Bearer ${paddleApiKey}` };

    try {
      // Prefer official invoice PDF URL for this transaction (Paddle Billing)
      const invRes = await fetch(`${paddleBaseUrl}/transactions/${transactionId}/invoice`, {
        method: "GET",
        headers: authHeaders
      });
      if (invRes.ok) {
        const invJson: any = await invRes.json().catch(() => ({}));
        const pdfUrl = invJson?.data?.url || invJson?.url || null;
        if (pdfUrl && typeof pdfUrl === "string") {
          return new Response(JSON.stringify({
            success: true,
            type: "invoice_pdf",
            url: pdfUrl,
            transaction_id: transactionId,
            sandbox: isSandbox
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

      // Fallback: open Paddle customer portal session (manage bills / receipts)
      const txRes = await fetch(`${paddleBaseUrl}/transactions/${transactionId}`, {
        method: "GET",
        headers: authHeaders
      });
      if (!txRes.ok) {
        const errBody = await txRes.text();
        throw new Error(`Paddle transaction fetch failed: ${errBody}`);
      }
      const txJson: any = await txRes.json();
      const customerId =
        txJson?.data?.customer_id ||
        (typeof txJson?.data?.customer === "string" ? txJson.data.customer : null) ||
        txJson?.data?.customer?.id ||
        null;

      if (customerId) {
        const portalBody: Record<string, unknown> = {};
        if (license.paddle_subscription_id) {
          portalBody.subscription_ids = [license.paddle_subscription_id];
        }
        const portalRes = await fetch(`${paddleBaseUrl}/customers/${customerId}/portal-sessions`, {
          method: "POST",
          headers: {
            ...authHeaders,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(portalBody)
        });
        if (portalRes.ok) {
          const portalJson: any = await portalRes.json().catch(() => ({}));
          const portalUrl =
            portalJson?.data?.urls?.general?.overview ||
            portalJson?.data?.urls?.overview ||
            portalJson?.data?.url ||
            null;
          if (portalUrl && typeof portalUrl === "string") {
            return new Response(JSON.stringify({
              success: true,
              type: "customer_portal",
              url: portalUrl,
              transaction_id: transactionId,
              sandbox: isSandbox
            }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
        }
      }

      // Soft fallback: user can still copy txn id and mail support
      return new Response(JSON.stringify({
        success: true,
        type: "manual",
        transaction_id: transactionId,
        support_email: "support@eqt.net.im",
        message: getApiTranslation("invoice_manual_help", reqLang),
        sandbox: isSandbox
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } catch (err: any) {
      console.error("Invoice link error:", err);
      ctx.waitUntil(logSystemError(env, "PADDLE_API_ERROR", "ERROR", err, {
        path: url.pathname,
        action: "portal_invoice_link",
        transaction_id: transactionId
      }));
      return new Response(JSON.stringify({
        error: getApiTranslation("invoice_failed", reqLang),
        support_email: "support@eqt.net.im",
        transaction_id: transactionId
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }

  return null;
}
