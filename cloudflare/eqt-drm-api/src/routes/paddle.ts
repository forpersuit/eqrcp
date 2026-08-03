import { Env, PRICE_LIFETIME_ID, PRICE_YEARLY_ID } from '../types';
import { verifyPaddleSignature } from '../utils/crypto';
import { sendDRMEmail, renderEmailWrapper } from '../services/smtp';
import { logSystemError } from '../utils/error-logger';
import { ensureLicenseSourceColumns } from '../utils/auth';
import { revokeByPaddleSubSql, revokeByPaddleTxnSql, revokeLicenseSql } from '../utils/license-source';
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
      const nowMs = Date.now();
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
          `SELECT license_code, expires_at, status, tier, buyer_email, buyer_email_hash, duration_days, created_at, last_purchased_at, paddle_subscription_id, paddle_transaction_id
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

        // Strictly check ownership, active status, tier match, and reject if target is already LIFETIME (§6.6/6.7)
        if (targetLic && isOwner && targetLic.tier === tier && targetLic.status === "active" && targetLic.expires_at !== "LIFETIME") {
          // Check refund window based on last_purchased_at (fallback to created_at) (§6.7 Item 6 / Issue 4)
          const REFUND_WINDOW_MS = 14 * 86400 * 1000;
          const lastPurchaseTime = (targetLic.last_purchased_at || targetLic.created_at) ? new Date(targetLic.last_purchased_at || targetLic.created_at).getTime() : 0;
          const isInRefundWindow = lastPurchaseTime > 0 && (nowMs - lastPurchaseTime < REFUND_WINDOW_MS);

          if (matchedPriceId === PRICE_LIFETIME_ID) {
            if (isInRefundWindow) {
              return new Response(JSON.stringify({
                error: "Target license is within the 14-day refund window of its latest payment. Please request a refund first before purchasing lifetime.",
                code: "UPGRADE_BLOCKED_REFUND_WINDOW"
              }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }

            // Prevent duplicate pending upgrade for the same license (V1 & V2 & N1)
            const existingPending = await env.DB.prepare(
              "SELECT id, lifetime_txn_id, effective_at FROM license_upgrades WHERE target_license_code = ? AND status = 'pending' LIMIT 1"
            ).bind(targetLic.license_code).first<any>();

            if (existingPending) {
              // Same transaction re-delivered (Paddle webhook retry) → idempotent 200, no error log
              if (existingPending.lifetime_txn_id === transactionId) {
                return new Response(JSON.stringify({
                  message: "Upgrade already processed",
                  status: "pending_upgrade",
                  license_code: targetLic.license_code,
                  effective_at: existingPending.effective_at
                }), {
                  status: 200,
                  headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
              }

              // A genuinely different transaction → reject + audit for manual review
              ctx.waitUntil(logSystemError(env, 'DUPLICATE_UPGRADE_ATTEMPT', 'WARN',
                new Error(`Duplicate lifetime upgrade attempted for license ${targetLic.license_code}`),
                { target_license_code: targetLic.license_code, duplicate_txn_id: transactionId, existing_effective_at: existingPending.effective_at }));

              return new Response(JSON.stringify({
                error: "Target license already has a pending lifetime upgrade scheduled",
                code: "UPGRADE_ALREADY_PENDING",
                license_code: targetLic.license_code,
                effective_at: existingPending.effective_at
              }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }

            // §6.7 Pending Lifetime Upgrade (State Isolation)
            // Effective time is the snapshot of the current yearly expires_at
            let effectiveAt = targetLic.expires_at;
            if (!effectiveAt || isNaN(new Date(effectiveAt).getTime()) || new Date(effectiveAt).getTime() < nowMs) {
              effectiveAt = new Date(nowMs).toISOString();
            }

            const nowIso = new Date(nowMs).toISOString();
            await env.DB.prepare(`
              INSERT OR IGNORE INTO license_upgrades (
                user_email, target_license_code, lifetime_txn_id, purchased_at, effective_at, status, created_at
              ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
            `).bind(
              buyerEmail || targetLic.buyer_email || "",
              targetLic.license_code,
              transactionId,
              nowIso,
              effectiveAt,
              nowIso
            ).run();

            // Cancel auto-renewal ONLY; DO NOT OVERWRITE paddle_transaction_id to protect yearly refund checks! (Issue 5)
            await env.DB.prepare(`
              UPDATE licenses SET
                auto_renew = 0,
                buyer_email = COALESCE(NULLIF(buyer_email, ''), ?),
                buyer_email_hash = COALESCE(NULLIF(buyer_email_hash, ''), ?)
              WHERE license_code = ?
            `).bind(
              buyerEmail || null,
              emailHash || null,
              targetLic.license_code
            ).run();

            // Turn off Paddle auto-renew with proper error logging (Issue 8)
            const subId = targetLic.paddle_subscription_id;
            if (subId && env.PADDLE_API_KEY) {
              const isSandbox = env.PADDLE_API_KEY.startsWith("pdl_sdbx_");
              const paddleBaseUrl = isSandbox ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
              ctx.waitUntil((async () => {
                try {
                  const res = await fetch(`${paddleBaseUrl}/subscriptions/${subId}/cancel`, {
                    method: "POST",
                    headers: {
                      "Authorization": `Bearer ${env.PADDLE_API_KEY}`,
                      "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ effective_from: "next_billing_period" })
                  });
                  if (!res.ok) {
                    const errText = await res.text().catch(() => '');
                    await logSystemError(env, 'PADDLE_API_ERROR', 'WARN',
                      new Error(`Paddle cancel subscription HTTP ${res.status}`),
                      { subscription_id: subId, license_code: targetLic.license_code, response: errText.slice(0, 300) });
                  }
                } catch (e) {
                  await logSystemError(env, 'PADDLE_API_ERROR', 'WARN', e,
                    { subscription_id: subId, license_code: targetLic.license_code, action: 'cancel_subscription' });
                }
              })());
            }

            if (buyerEmail) {
              const buyerLang = detectBuyerLang(data);
              const expiresStr = new Date(effectiveAt).toLocaleDateString();
              const tmpl = getRenewalEmailTemplate(buyerLang);
              const emailHtml = renderEmailWrapper(tmpl.title, tmpl.body(targetLic.license_code, `Pending Lifetime (Effective ${expiresStr})`));
              ctx.waitUntil(sendDRMEmail(env, buyerEmail, tmpl.subject, emailHtml));
            }

            return new Response(JSON.stringify({
              message: "Lifetime upgrade purchased and scheduled (pending effective date)",
              license_code: targetLic.license_code,
              effective_at: effectiveAt,
              status: "pending_upgrade"
            }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          } else if (matchedPriceId === PRICE_YEARLY_ID) {
            let newExpires = expiresAt;
            if (targetLic.expires_at) {
              const prev = new Date(targetLic.expires_at).getTime();
              const base = Number.isFinite(prev) ? Math.max(nowMs, prev) : nowMs;
              newExpires = new Date(base + YEARLY_MS).toISOString();
            }

            await env.DB.prepare(`
              UPDATE licenses SET
                status = 'active',
                expires_at = ?,
                duration_days = ?,
                paddle_transaction_id = ?,
                last_purchased_at = ?,
                revoked_at = NULL,
                revoke_reason = NULL,
                buyer_email = COALESCE(NULLIF(buyer_email, ''), ?),
                buyer_email_hash = COALESCE(NULLIF(buyer_email_hash, ''), ?)
              WHERE license_code = ?
            `).bind(
              newExpires,
              targetLic.duration_days ?? null,
              transactionId,
              new Date(nowMs).toISOString(),
              buyerEmail || null,
              emailHash || null,
              targetLic.license_code
            ).run();

            if (buyerEmail) {
              const buyerLang = detectBuyerLang(data);
              const expiresStr = new Date(newExpires).toLocaleDateString();
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
              last_purchased_at = ?,
              revoked_at = NULL,
              revoke_reason = NULL,
              buyer_email = COALESCE(NULLIF(buyer_email, ''), ?),
              buyer_email_hash = COALESCE(NULLIF(buyer_email_hash, ''), ?)
            WHERE license_code = ?
          `).bind(
            newExpires,
            durationDays,
            transactionId,
            new Date().toISOString(),
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
      const nowIso = new Date().toISOString();

      // Write to DB (paid fulfillment is always source=purchase)
      await env.DB.prepare(`
        INSERT INTO licenses (
          license_code, tier, status, max_devices, expires_at, duration_days,
          buyer_email_hash, buyer_email, paddle_transaction_id, paddle_subscription_id,
          source, created_at, last_purchased_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        nowIso,
        nowIso
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

    // Revoke license or cancel pending upgrade on refund
    if (eventType === "transaction.refunded") {
      const transactionId = data.id;

      // §6.7 Refund lifetime upgrade: if pending, cancel upgrade and keep yearly license active; if applied, revoke code
      const upgradeRow = await env.DB.prepare(
        "SELECT id, target_license_code, status FROM license_upgrades WHERE lifetime_txn_id = ?"
      ).bind(transactionId).first<any>();

      if (upgradeRow) {
        if (upgradeRow.status === 'pending') {
          await env.DB.prepare(
            "UPDATE license_upgrades SET status = 'cancelled' WHERE id = ?"
          ).bind(upgradeRow.id).run();
          return new Response(JSON.stringify({ message: "Pending lifetime upgrade cancelled due to refund", status: "cancelled" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        } else if (upgradeRow.status === 'applied') {
          await env.DB.prepare(
            "UPDATE license_upgrades SET status = 'cancelled' WHERE id = ?"
          ).bind(upgradeRow.id).run();
          await env.DB.prepare(revokeLicenseSql()).bind(new Date().toISOString(), "refund", upgradeRow.target_license_code).run();

          const targetLic = await env.DB.prepare(
            "SELECT license_code, buyer_email, tier FROM licenses WHERE license_code = ?"
          ).bind(upgradeRow.target_license_code).first<any>();

          if (targetLic && targetLic.buyer_email) {
            const buyerLang = detectBuyerLang(data);
            const planName = targetLic.tier === "PLUS" ? "EQT Plus" : (targetLic.tier === "PRO" ? "EQT Pro" : targetLic.tier);
            const t = getLicenseRevokeEmailTemplate(buyerLang, "refund");
            const emailHtml = renderEmailWrapper(t.title, t.body(targetLic.license_code, planName));
            ctx.waitUntil(sendDRMEmail(env, targetLic.buyer_email, t.subject, emailHtml));
          }

          return new Response(JSON.stringify({ message: "Applied lifetime upgrade revoked due to refund", status: "revoked" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

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
        const upgradeRow = await env.DB.prepare(
          "SELECT id, target_license_code, status FROM license_upgrades WHERE lifetime_txn_id = ?"
        ).bind(transactionId).first<any>();

        if (upgradeRow) {
          if (upgradeRow.status === 'pending') {
            await env.DB.prepare(
              "UPDATE license_upgrades SET status = 'cancelled' WHERE id = ?"
            ).bind(upgradeRow.id).run();
            return new Response(JSON.stringify({ message: "Pending lifetime upgrade cancelled due to adjustment refund", status: "cancelled" }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          } else if (upgradeRow.status === 'applied') {
            await env.DB.prepare(
              "UPDATE license_upgrades SET status = 'cancelled' WHERE id = ?"
            ).bind(upgradeRow.id).run();
            await env.DB.prepare(revokeLicenseSql()).bind(new Date().toISOString(), action, upgradeRow.target_license_code).run();
            return new Response(JSON.stringify({ message: "Applied lifetime upgrade revoked due to adjustment refund", status: "revoked" }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
        }

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

    // Process subscription status updates (Section 6.6: cancel != revoke)
    if (eventType === "subscription.canceled" || eventType === "subscription.updated") {
      const subscriptionId = data.id;
      const status = data.status;

      // 1. Just turning off auto-renewal: DO NOT revoke active period, set auto_renew = 0
      if (eventType === "subscription.canceled" || status === "canceled") {
        await env.DB.prepare(
          "UPDATE licenses SET auto_renew = 0 WHERE paddle_subscription_id = ?"
        ).bind(subscriptionId).run();

        return new Response(JSON.stringify({ message: "Subscription auto-renewal canceled, license remains active until expires_at" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 2. Non-payment / Past due / Paused: Revoke license immediately
      if (status === "past_due" || status === "paused") {
        const license = await env.DB.prepare(
          "SELECT license_code, buyer_email, tier FROM licenses WHERE paddle_subscription_id = ?"
        ).bind(subscriptionId).first<any>();

        await env.DB.prepare(revokeByPaddleSubSql()).bind(
          new Date().toISOString(),
          status,
          subscriptionId
        ).run();

        if (license && license.buyer_email) {
          const buyerLang = detectBuyerLang(data);
          const planName = license.tier === "PLUS" ? "EQT Plus" : (license.tier === "PRO" ? "EQT Pro" : license.tier);
          const t = getLicenseRevokeEmailTemplate(buyerLang, "subscription");
          const emailHtml = renderEmailWrapper(t.title, t.body(license.license_code, planName));
          ctx.waitUntil(sendDRMEmail(env, license.buyer_email, t.subject, emailHtml));
        }

        return new Response(JSON.stringify({ message: "License revoked due to subscription non-payment/paused" }), {
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
