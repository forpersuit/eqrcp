import { Env, ONE_YEAR_MS, MAX_YEARLY_UNBINDS } from '../types';
import { extractRequestLang, getApiTranslation, getDeviceNoticeTemplate } from '../i18n';
import { sendDRMEmail, renderEmailWrapper } from '../services/smtp';
import { logSystemError } from '../utils/error-logger';

export async function handlePortalRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
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

      return new Response(JSON.stringify({
        success: true,
        message: "Refund request initiated successfully. Your license has been revoked.",
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
      return new Response(JSON.stringify({ error: err.message || "Failed to process refund" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }

  return null;
}
