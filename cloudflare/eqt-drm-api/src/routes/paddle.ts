import { Env, License, PaddleWebhookEvent, PaddleCustomerApiResponse, PRICE_LIFETIME_ID, PRICE_YEARLY_ID, PRICE_PRO_MONTHLY_ID } from '../types';
import { verifyPaddleSignature } from '../utils/crypto';
import { sendDRMEmail, renderEmailWrapper, buildPurchaseEmailHtml, buildRenewalEmailHtml } from '../services/smtp';
import { logSystemError } from '../utils/error-logger';
import { revokeByPaddleSubSql, revokeByPaddleTxnSql } from '../utils/license-source';
import { getLicenseRevokeEmailTemplate, extractRequestLang, getApiTranslation } from '../i18n';

type LicenseQueryRow = Pick<License, 'license_code' | 'expires_at' | 'status' | 'buyer_email' | 'paddle_transaction_id' | 'tier'>;

export async function handlePaddleRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
  // --- Route: /api/v1/paddle/webhook ---
  if (url.pathname === "/api/v1/paddle/webhook" && request.method === "POST") {
    const rawBody = await request.text();
    const signature = request.headers.get("Paddle-Signature");

    const webhookSecret = env.PADDLE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      ctx.waitUntil(logSystemError(env, 'PADDLE_WEBHOOK', 'CRITICAL',
        new Error('PADDLE_WEBHOOK_SECRET is not configured'),
        { path: url.pathname }));
      return new Response(JSON.stringify({ error: "PADDLE_WEBHOOK_SECRET is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (!signature) {
      ctx.waitUntil(logSystemError(env, 'PADDLE_WEBHOOK', 'WARN',
        new Error('Missing Paddle-Signature header'),
        { path: url.pathname }));
      return new Response(JSON.stringify({ error: "Missing Paddle-Signature header" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const isValid = await verifyPaddleSignature(rawBody, signature, webhookSecret);
    if (!isValid) {
      ctx.waitUntil(logSystemError(env, 'PADDLE_WEBHOOK', 'ERROR',
        new Error('Invalid Paddle webhook signature'),
        { path: url.pathname }));
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    let event: PaddleWebhookEvent;
    try {
      event = JSON.parse(rawBody);
    } catch (parseErr: unknown) {
      const err = parseErr instanceof Error ? parseErr : new Error(String(parseErr));
      ctx.waitUntil(logSystemError(env, 'PADDLE_WEBHOOK', 'ERROR', err,
        { path: url.pathname, rawBody: rawBody.slice(0, 500) }));
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    console.log("PADDLE_WEBHOOK_EVENT:", JSON.stringify(event));

    try {
      const eventType = event.event_type;
      const data = event.data || {};

      // Extract buyer checkout page language from custom_data, passthrough, DB verification history, or headers
      const customData = (data as Record<string, unknown>).custom_data as Record<string, unknown> | undefined;
      const passthroughStr = (data as Record<string, unknown>).passthrough as string | undefined;
      let buyerLang = String(customData?.lang || customData?.buyer_lang || "").trim();

      if (!buyerLang && passthroughStr) {
        try {
          const parsed = JSON.parse(passthroughStr);
          buyerLang = String(parsed.lang || parsed.buyer_lang || "").trim();
        } catch (_) {
          // ignore non-json passthrough
        }
      }

      let buyerEmail = data.customer?.email || data.user?.email || "";
      if (buyerEmail) buyerEmail = buyerEmail.trim().toLowerCase();

      // Fallback: Check D1 checkout_verifications table for recent verification language by buyerEmail
      if (!buyerLang && buyerEmail) {
        try {
          const lastVer = await env.DB.prepare(
            "SELECT lang FROM checkout_verifications WHERE email = ? ORDER BY created_at DESC LIMIT 1"
          ).bind(buyerEmail).first<any>();
          if (lastVer && lastVer.lang) {
            buyerLang = String(lastVer.lang).trim();
          }
        } catch (_) {}
      }

      if (!buyerLang) {
        buyerLang = extractRequestLang(request);
      }

      // 1. Event: transaction.completed -> Fullfill new license or extend subscription
      if (eventType === "transaction.completed") {
        const transactionId = data.id;
        const subscriptionId = data.subscription_id || null;
        const customerId = data.customer_id || null;

        // Fallback: If email missing, query Paddle API using API key
        if (!buyerEmail && customerId && env.PADDLE_API_KEY) {
          try {
            const isSandbox = env.PADDLE_API_KEY.startsWith("pdl_sdbx_");
            const paddleBaseUrl = isSandbox ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
            const custRes = await fetch(`${paddleBaseUrl}/customers/${customerId}`, {
              headers: { "Authorization": `Bearer ${env.PADDLE_API_KEY}` }
            });
            if (custRes.ok) {
              const custJson = await custRes.json() as PaddleCustomerApiResponse;
              buyerEmail = custJson.data?.email || "";
            } else {
              ctx.waitUntil(logSystemError(env, 'PADDLE_API_ERROR', 'WARN',
                new Error(`Failed to fetch customer ${customerId}: ${custRes.status}`),
                { transactionId, customerId }));
            }
          } catch (cErr: unknown) {
            const err = cErr instanceof Error ? cErr : new Error(String(cErr));
            ctx.waitUntil(logSystemError(env, 'PADDLE_API_ERROR', 'WARN', err,
              { transactionId, customerId }));
          }
        }

        // Check idempotency for non-subscription / initial transaction
        if (transactionId) {
          const existing = await env.DB.prepare(
            "SELECT license_code FROM licenses WHERE paddle_transaction_id = ?"
          ).bind(transactionId).first<LicenseQueryRow>();

          if (existing) {
            return new Response(JSON.stringify({
              message: "Transaction already fulfilled",
              license_code: existing.license_code
            }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
        }

        // Extract Price ID
        const items = data.items || [];
        let matchedPriceId = "";
        for (const item of items) {
          const priceId = item.price?.id || item.price_id;
          if (priceId === PRICE_LIFETIME_ID || priceId === PRICE_YEARLY_ID || priceId === PRICE_PRO_MONTHLY_ID) {
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
        let tier = "PLUS";
        let expiresAt = "LIFETIME";
        let durationDays: number | null = null;
        const YEARLY_MS = 365 * 86400 * 1000;
        const MONTHLY_MS = 30 * 86400 * 1000;

        if (matchedPriceId === PRICE_YEARLY_ID) {
          tier = "PLUS";
          durationDays = 365;
          expiresAt = new Date(Date.now() + YEARLY_MS).toISOString();
        } else if (matchedPriceId === PRICE_PRO_MONTHLY_ID) {
          tier = "PRO";
          durationDays = 30;
          expiresAt = new Date(Date.now() + MONTHLY_MS).toISOString();
        } else if (matchedPriceId === PRICE_LIFETIME_ID) {
          tier = "PLUS";
          expiresAt = "LIFETIME";
        }

        // Hash email for buyer_email_hash
        let emailHash = "";
        if (buyerEmail) {
          const te = new TextEncoder();
          const emailHashBuf = await crypto.subtle.digest("SHA-256", te.encode(buyerEmail.trim().toLowerCase()));
          emailHash = Array.prototype.map.call(new Uint8Array(emailHashBuf), (x: number) => ('00' + x.toString(16)).slice(-2)).join('');
        }

        // --- Subscription renewal: same subscription keeps ONE license code (Paddle auto-bills) ---
        // Product SSOT: do not mint a new code on each billing cycle; extend expires_at + keep status active.
        if ((matchedPriceId === PRICE_YEARLY_ID || matchedPriceId === PRICE_PRO_MONTHLY_ID) && subscriptionId) {
          const subLicense = await env.DB.prepare(
            `SELECT license_code, expires_at, status, buyer_email, paddle_transaction_id, tier
             FROM licenses WHERE paddle_subscription_id = ?
             ORDER BY created_at ASC LIMIT 1`
          ).bind(subscriptionId).first<LicenseQueryRow>();

          if (subLicense?.license_code) {
            let newExpires = expiresAt;
            const addMs = matchedPriceId === PRICE_PRO_MONTHLY_ID ? MONTHLY_MS : YEARLY_MS;
            if (subLicense.expires_at && subLicense.expires_at !== "LIFETIME") {
              const prev = new Date(subLicense.expires_at).getTime();
              const base = Number.isFinite(prev) ? Math.max(Date.now(), prev) : Date.now();
              newExpires = new Date(base + addMs).toISOString();
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
              const mailObj = buildRenewalEmailHtml(buyerLang, subLicense.license_code, subLicense.tier || tier, newExpires);
              ctx.waitUntil(sendDRMEmail(env, buyerEmail, mailObj.subject, mailObj.html));
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
        const checkHex = Array.prototype.map.call(new Uint8Array(checkHashBuf), (x: number) => ('00' + x.toString(16)).slice(-2)).join('').slice(0, 4).toUpperCase();
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

        // Send confirmation email to the buyer asynchronously with adapted buyer language
        if (buyerEmail) {
          const mailObj = buildPurchaseEmailHtml(buyerLang, licenseCode, tier, expiresAt, 2);
          ctx.waitUntil(sendDRMEmail(env, buyerEmail, mailObj.subject, mailObj.html));
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
        ).bind(transactionId).first<LicenseQueryRow>();

        await env.DB.prepare(revokeByPaddleTxnSql()).bind(
          new Date().toISOString(),
          "refund",
          transactionId
        ).run();

        if (license && license.buyer_email) {
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
        const action = String((data as Record<string, unknown>).action || (data as Record<string, unknown>).type || "").toLowerCase();
        const transactionId = (data as Record<string, unknown>).transaction_id || (data as Record<string, unknown>).transactionId || null;
        if (transactionId && (action === "chargeback" || action === "refund")) {
          const reason = action === "chargeback" ? "chargeback" : "refund";
          const license = await env.DB.prepare(
            "SELECT license_code, buyer_email, tier FROM licenses WHERE paddle_transaction_id = ?"
          ).bind(transactionId).first<LicenseQueryRow>();

          await env.DB.prepare(revokeByPaddleTxnSql()).bind(
            new Date().toISOString(),
            reason,
            transactionId
          ).run();

          if (license && license.buyer_email) {
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
          ).bind(subscriptionId).first<LicenseQueryRow>();

          await env.DB.prepare(revokeByPaddleSubSql()).bind(
            new Date().toISOString(),
            "subscription",
            subscriptionId
          ).run();

          if (license && license.buyer_email) {
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
    } catch (webhookErr: unknown) {
      const err = webhookErr instanceof Error ? webhookErr : new Error(String(webhookErr));
      console.error("Paddle webhook processing error:", err);
      ctx.waitUntil(logSystemError(env, 'PADDLE_WEBHOOK', 'ERROR', err, {
        path: url.pathname
      }));
      return new Response(JSON.stringify({ error: "Webhook processing failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }

  // 3.5.2 Client License Query (polling to fetch license code instantly after web payment completion)
  if (url.pathname === "/api/v1/paddle/license-query" && request.method === "GET") {
    const reqLang = extractRequestLang(request);
    const transactionId = url.searchParams.get("transaction_id");
    if (!transactionId) {
      return new Response(JSON.stringify({
        error: getApiTranslation("missing_transaction_id", reqLang) || "Missing transaction_id"
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const license = await env.DB.prepare(
      "SELECT license_code, tier, expires_at, status FROM licenses WHERE paddle_transaction_id = ?"
    ).bind(transactionId).first<LicenseQueryRow>();

    if (!license) {
      return new Response(JSON.stringify({
        error: getApiTranslation("license_pending_fulfillment", reqLang) || "License not generated yet, pending payment confirmation"
      }), {
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
