import { Env, ONE_YEAR_MS, MAX_YEARLY_UNBINDS } from '../types';
import { extractRequestLang, getApiTranslation, getDeviceNoticeTemplate, getLicenseRevokeEmailTemplate } from '../i18n';
import { sendDRMEmail, renderEmailWrapper } from '../services/smtp';
import { logSystemError } from '../utils/error-logger';
import { sha256Hex, licenseOwnedByEmail } from '../utils/crypto';
import {
  isLicenseRefundable,
  isRealPaddleTransactionId,
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

export async function handlePortalRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
  // 0.3 Get user licenses history and status
  if (url.pathname === "/api/v1/user/licenses" && request.method === "GET") {
    await ensureLicenseSourceColumns(env);
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
    const emailHash = await sha256Hex(email);

    const { results: licenses } = await env.DB.prepare(
      "SELECT * FROM licenses WHERE buyer_email_hash = ? OR buyer_email = ? ORDER BY created_at DESC"
    ).bind(emailHash, email).all<any>();

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
      const source = normalizeLicenseSource(lic.source, lic.paddle_transaction_id);

      list.push({
        ...lic,
        source,
        refundable: isLicenseRefundable({ ...lic, source }),
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

  return null;
}
