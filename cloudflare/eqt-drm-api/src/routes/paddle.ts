import { Env, PRICE_LIFETIME_ID, PRICE_YEARLY_ID } from '../types';
import { verifyPaddleSignature } from '../utils/crypto';
import { sendDRMEmail, renderEmailWrapper } from '../services/smtp';
import { logSystemError } from '../utils/error-logger';
import { ensureLicenseSourceColumns } from '../utils/auth';
import { revokeByPaddleSubSql, revokeByPaddleTxnSql } from '../utils/license-source';
import { getLicenseRevokeEmailTemplate, getPurchaseEmailTemplate, getRenewalEmailTemplate } from '../i18n';

function detectBuyerLang(data: any): string {
  const country = String(
    data.customer?.address?.country_code ||
    data.customer_address?.country_code ||
    data.country_code ||
    ''
  ).toUpperCase();
  if (['CN', 'TW', 'HK', 'MO'].includes(country)) return 'zh';
  if (country === 'JP') return 'ja';
  if (country === 'KR') return 'ko';
  if (['ES', 'MX', 'AR', 'CO', 'CL'].includes(country)) return 'es';
  if (['DE', 'AT', 'CH'].includes(country)) return 'de';
  if (['FR', 'BE', 'CA'].includes(country)) return 'fr';
  return 'en'; // Baseline is English for all other countries and missing country data
}

export async function handlePaddleRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
  // 3.5.1 Paddle Webhook: fulfillment and cancellation/refund
  if (url.pathname === "/api/v1/paddle/webhook" && request.method === "POST") {
    await ensureLicenseSourceColumns(env);
    const rawBody = await request.text();
    const signature = request.headers.get("paddle-signature");
    const webhookSecret = env.PADDLE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      ctx.waitUntil(logSystemError(env, 'PADDLE_WEBHOOK', 'CRITICAL',
        new Error('PADDLE_WEBHOOK_SECRET is not configured'),
        { path: url.pathname }));
      return new Response(JSON.stringify({ error: "Paddle Webhook secret is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const isValid = await verifyPaddleSignature(rawBody, signature, webhookSecret);
    if (!isValid) {
      ctx.waitUntil(logSystemError(env, 'PADDLE_WEBHOOK', 'WARN',
        new Error('Invalid Paddle webhook signature'),
        { path: url.pathname, has_signature: Boolean(signature) }));
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    let event: any;
    try {
      event = JSON.parse(rawBody);
    } catch (parseErr) {
      ctx.waitUntil(logSystemError(env, 'PADDLE_WEBHOOK', 'ERROR', parseErr,
        { path: url.pathname, reason: 'invalid_json' }));
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const eventType = event.event_type;
    const data = event.data;
    console.log("PADDLE_WEBHOOK_EVENT:", JSON.stringify(event));

    try {
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
          } else {
            const errBody = await custRes.text().catch(() => '');
            ctx.waitUntil(logSystemError(env, 'PADDLE_API_ERROR', 'WARN',
              new Error(`Paddle customers API HTTP ${custRes.status}`),
              { customer_id: customerId, transaction_id: transactionId, body: errBody.slice(0, 500) }));
          }
        } catch (cErr) {
          console.error("Failed to fetch customer email from Paddle API:", cErr);
          ctx.waitUntil(logSystemError(env, 'PADDLE_API_ERROR', 'WARN', cErr,
            { customer_id: customerId, transaction_id: transactionId, action: 'fetch_customer_email' }));
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
      const YEARLY_MS = 365 * 86400 * 1000;

      if (matchedPriceId === PRICE_YEARLY_ID) {
        durationDays = 365;
        expiresAt = new Date(Date.now() + YEARLY_MS).toISOString();
      }

      // Hash email for buyer_email_hash
      let emailHash = "";
      if (buyerEmail) {
        const te = new TextEncoder();
        const emailHashBuf = await crypto.subtle.digest("SHA-256", te.encode(buyerEmail.trim().toLowerCase()));
        emailHash = Array.prototype.map.call(new Uint8Array(emailHashBuf), x => ('00' + x.toString(16)).slice(-2)).join('');
      }

      // --- Manual/Subscription Renewal via passthrough target_license_code (§6.6) ---
      let targetCode = "";
      try {
        const rawCustom = data.custom_data || data.passthrough;
        if (typeof rawCustom === "object" && rawCustom?.target_license_code) {
          targetCode = String(rawCustom.target_license_code).trim();
        } else if (typeof rawCustom === "string" && rawCustom.startsWith("{")) {
          const parsed = JSON.parse(rawCustom);
          if (parsed?.target_license_code) {
            targetCode = String(parsed.target_license_code).trim();
          }
        }
      } catch {
        targetCode = "";
      }

      if (targetCode) {
        const targetLic = await env.DB.prepare(
          `SELECT license_code, expires_at, status, tier, buyer_email, buyer_email_hash, duration_days
           FROM licenses WHERE license_code = ?`
        ).bind(targetCode).first<any>();

        // Verify buyer email ownership (§6.6 requirement: must match buyer_email)
        let isOwner = false;
        if (targetLic && buyerEmail) {
          const targetEmail = (targetLic.buyer_email || "").trim().toLowerCase();
          const currentEmail = buyerEmail.trim().toLowerCase();
          if (!targetEmail || targetEmail === currentEmail || (targetLic.buyer_email_hash && targetLic.buyer_email_hash === emailHash)) {
            isOwner = true;
          }
        }

        // Strictly check ownership, active status, tier match, and reject if already LIFETIME
        if (targetLic && isOwner && targetLic.tier === tier && targetLic.status === "active" && targetLic.expires_at !== "LIFETIME") {
          // §6.6 Policy: If user already owns another active LIFETIME license for same tier, reject lifetime upgrade to prevent duplicate purchase
          if (matchedPriceId === PRICE_LIFETIME_ID && buyerEmail) {
            const existingLifetime = await env.DB.prepare(
              `SELECT license_code FROM licenses
               WHERE status = 'active' AND tier = ? AND expires_at = 'LIFETIME'
                 AND (buyer_email = ? OR buyer_email_hash = ?)
               LIMIT 1`
            ).bind(tier, buyerEmail.trim().toLowerCase(), emailHash).first<any>();
            if (existingLifetime) {
              console.warn(`[DRM] Buyer ${buyerEmail} already owns lifetime license ${existingLifetime.license_code}, skipping target upgrade.`);
              return new Response(JSON.stringify({
                message: "Buyer already owns lifetime license",
                reason_key: "lifetime_already_owned",
                license_code: existingLifetime.license_code
              }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }
          }

          let newExpires = expiresAt;
          let durationDaysUpdate: number | null = targetLic.duration_days ?? null;
          if (matchedPriceId === PRICE_LIFETIME_ID) {
            newExpires = "LIFETIME";
            durationDaysUpdate = null; // Clear duration_days so verify won't override LIFETIME
          } else if (matchedPriceId === PRICE_YEARLY_ID) {
            if (targetLic.expires_at) {
              const prev = new Date(targetLic.expires_at).getTime();
              const base = Number.isFinite(prev) ? Math.max(Date.now(), prev) : Date.now();
              newExpires = new Date(base + YEARLY_MS).toISOString();
            }
          }

          await env.DB.prepare(`
            UPDATE licenses SET
              status = 'active',
              expires_at = ?,
              duration_days = ?,
              paddle_transaction_id = ?,
              revoked_at = NULL,
              revoke_reason = NULL,
              buyer_email = COALESCE(NULLIF(buyer_email, ''), ?),
              buyer_email_hash = COALESCE(NULLIF(buyer_email_hash, ''), ?)
            WHERE license_code = ?
          `).bind(
            newExpires,
            durationDaysUpdate,
            transactionId,
            buyerEmail || null,
            emailHash || null,
            targetLic.license_code
          ).run();

          if (buyerEmail) {
            const buyerLang = detectBuyerLang(data);
            const expiresStr = newExpires === "LIFETIME" ? "Lifetime" : new Date(newExpires).toLocaleDateString();
            const tmpl = getRenewalEmailTemplate(buyerLang);
            const emailHtml = renderEmailWrapper(tmpl.title, tmpl.body(targetLic.license_code, expiresStr));
            ctx.waitUntil(sendDRMEmail(env, buyerEmail, tmpl.subject, emailHtml));
          }

          return new Response(JSON.stringify({
            message: "Target license renewed via payment",
            license_code: targetLic.license_code,
            expires_at: newExpires
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

      // --- Yearly renewal: same subscription keeps ONE license code (Paddle auto-bills) ---
      // Product SSOT: do not mint a new code on each billing cycle; extend expires_at + keep status active.
      if (matchedPriceId === PRICE_YEARLY_ID && subscriptionId) {
        const subLicense = await env.DB.prepare(
          `SELECT license_code, expires_at, status, buyer_email, paddle_transaction_id
           FROM licenses WHERE paddle_subscription_id = ?
           ORDER BY created_at ASC LIMIT 1`
        ).bind(subscriptionId).first<any>();

        if (subLicense?.license_code) {
          let newExpires = expiresAt;
          if (subLicense.expires_at && subLicense.expires_at !== "LIFETIME") {
            const prev = new Date(subLicense.expires_at).getTime();
            const base = Number.isFinite(prev) ? Math.max(Date.now(), prev) : Date.now();
            newExpires = new Date(base + YEARLY_MS).toISOString();
          } else if (subLicense.expires_at === "LIFETIME") {
            newExpires = "LIFETIME";
          }

          // Point paddle_transaction_id at latest paid txn (idempotency + refund of current period)
          await env.DB.prepare(`
            UPDATE licenses SET
              status = 'active',
              expires_at = ?,
              duration_days = COALESCE(duration_days, ?),
              paddle_transaction_id = ?,
              revoked_at = NULL,
              revoke_reason = NULL,
              buyer_email = COALESCE(NULLIF(buyer_email, ''), ?),
              buyer_email_hash = COALESCE(NULLIF(buyer_email_hash, ''), ?)
            WHERE license_code = ?
          `).bind(
            newExpires,
            durationDays,
            transactionId,
            buyerEmail || null,
            emailHash || null,
            subLicense.license_code
          ).run();

          if (buyerEmail) {
            const buyerLang = detectBuyerLang(data);
            const expiresStr = newExpires === "LIFETIME" ? "Lifetime" : new Date(newExpires).toLocaleDateString();
            const tmpl = getRenewalEmailTemplate(buyerLang);
            const emailHtml = renderEmailWrapper(tmpl.title, tmpl.body(subLicense.license_code, expiresStr));
            ctx.waitUntil(sendDRMEmail(env, buyerEmail, tmpl.subject, emailHtml));
          }

          return new Response(JSON.stringify({
            message: "Subscription renewed; existing license extended",
            license_code: subLicense.license_code,
            renewed: true,
            expires_at: newExpires
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

      // --- First fulfillment: mint a new license code ---
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

      // Write to DB (paid fulfillment is always source=purchase)
      await env.DB.prepare(`
        INSERT INTO licenses (
          license_code, tier, status, max_devices, expires_at, duration_days,
          buyer_email_hash, buyer_email, paddle_transaction_id, paddle_subscription_id,
          source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        "purchase",
        new Date().toISOString()
      ).run();

      // Send confirmation email to the buyer asynchronously
      if (buyerEmail) {
        const buyerLang = detectBuyerLang(data);
        const planName = tier === "PLUS" ? "EQT Plus" : (tier === "PRO" ? "EQT Pro" : tier);
        const expiresStr = expiresAt === "LIFETIME" ? (buyerLang === "zh" ? "Lifetime (买断永久版)" : "Lifetime") : new Date(expiresAt).toLocaleDateString();
        const tmpl = getPurchaseEmailTemplate(buyerLang);
        const emailHtml = renderEmailWrapper(tmpl.title, tmpl.body(planName, licenseCode, expiresStr));
        ctx.waitUntil(sendDRMEmail(env, buyerEmail, tmpl.subject, emailHtml));
      }

      return new Response(JSON.stringify({ message: "License generated and fulfilled", license_code: licenseCode }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Revoke license on refund (status remains revoked; reason=refund — not a separate status)
    if (eventType === "transaction.refunded") {
      const transactionId = data.id;

      // Query the email of the license owner
      const license = await env.DB.prepare(
        "SELECT license_code, buyer_email, tier FROM licenses WHERE paddle_transaction_id = ?"
      ).bind(transactionId).first<any>();

      await env.DB.prepare(revokeByPaddleTxnSql()).bind(
        new Date().toISOString(),
        "refund",
        transactionId
      ).run();

      if (license && license.buyer_email) {
        const buyerLang = detectBuyerLang(data);
        const planName = license.tier === "PLUS" ? "EQT Plus" : (license.tier === "PRO" ? "EQT Pro" : license.tier);
        const t = getLicenseRevokeEmailTemplate(buyerLang, "refund");
        const emailHtml = renderEmailWrapper(t.title, t.body(license.license_code, planName));
        ctx.waitUntil(sendDRMEmail(env, license.buyer_email, t.subject, emailHtml));
      }

      return new Response(JSON.stringify({ message: "License revoked due to refund", revoke_reason: "refund" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Chargeback / adjustment-driven money movement (Paddle Billing)
    // action may be refund | chargeback | credit — we only revoke on refund/chargeback.
    if (eventType === "adjustment.created" || eventType === "adjustment.updated") {
      const action = String(data.action || data.type || "").toLowerCase();
      const transactionId = data.transaction_id || data.transactionId || null;
      if (transactionId && (action === "chargeback" || action === "refund")) {
        const reason = action === "chargeback" ? "chargeback" : "refund";
        const license = await env.DB.prepare(
          "SELECT license_code, buyer_email, tier FROM licenses WHERE paddle_transaction_id = ?"
        ).bind(transactionId).first<any>();

        await env.DB.prepare(revokeByPaddleTxnSql()).bind(
          new Date().toISOString(),
          reason,
          transactionId
        ).run();

        if (license && license.buyer_email) {
          const buyerLang = detectBuyerLang(data);
          const planName = license.tier === "PLUS" ? "EQT Plus" : (license.tier === "PRO" ? "EQT Pro" : license.tier);
          const t = getLicenseRevokeEmailTemplate(buyerLang, reason);
          const emailHtml = renderEmailWrapper(t.title, t.body(license.license_code, planName));
          ctx.waitUntil(sendDRMEmail(env, license.buyer_email, t.subject, emailHtml));
        }

        return new Response(JSON.stringify({
          message: `License revoked due to adjustment ${action}`,
          revoke_reason: reason
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // Revoke license on subscription cancel / suspend
    if (eventType === "subscription.canceled" || eventType === "subscription.updated") {
      const subscriptionId = data.id;
      const status = data.status;

      if (eventType === "subscription.canceled" || status === "canceled" || status === "past_due" || status === "paused") {
        const license = await env.DB.prepare(
          "SELECT license_code, buyer_email, tier FROM licenses WHERE paddle_subscription_id = ?"
        ).bind(subscriptionId).first<any>();

        await env.DB.prepare(revokeByPaddleSubSql()).bind(
          new Date().toISOString(),
          "subscription",
          subscriptionId
        ).run();

        if (license && license.buyer_email) {
          const buyerLang = detectBuyerLang(data);
          const planName = license.tier === "PLUS" ? "EQT Plus" : (license.tier === "PRO" ? "EQT Pro" : license.tier);
          const t = getLicenseRevokeEmailTemplate(buyerLang, "subscription");
          const emailHtml = renderEmailWrapper(t.title, t.body(license.license_code, planName));
          ctx.waitUntil(sendDRMEmail(env, license.buyer_email, t.subject, emailHtml));
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
    } catch (webhookErr: any) {
      console.error("Paddle webhook processing error:", webhookErr);
      ctx.waitUntil(logSystemError(env, 'PADDLE_WEBHOOK', 'ERROR', webhookErr, {
        path: url.pathname,
        event_type: eventType,
        transaction_id: data?.id || null,
        subscription_id: data?.subscription_id || data?.id || null
      }));
      return new Response(JSON.stringify({ error: "Webhook processing failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
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

  return null;
}
