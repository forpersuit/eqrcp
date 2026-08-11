import {
  Env,
  PROD_PRICE_LIFETIME_ID,
  PROD_PRICE_YEARLY_ID,
  SANDBOX_PRICE_LIFETIME_ID,
  SANDBOX_PRICE_YEARLY_ID
} from '../types';
import { verifyPaddleSignature } from '../utils/crypto';
import { sendDRMEmail, renderEmailWrapper } from '../services/smtp';
import { logSystemError } from '../utils/error-logger';
import { ensureLicensePaddleTxnIndex, ensureLicenseSourceColumns } from '../utils/auth';
import { isPaddleSandbox, revokeByPaddleSubSql, revokeByPaddleTxnSql, revokeLicenseSql } from '../utils/license-source';
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

/**
 * A1 amount validation (audit licensing-flow-audit.md). Ensures a transaction carrying an
 * EQT price id actually paid a positive amount before it fulfills. Rejection happens ONLY on
 * deterministic evidence of a bad amount (totals <= 0, explicit unit_price <= 0, or explicit
 * quantity === 0). Missing amount fields are "not determinable" and pass (HMAC already limits
 * the caller to genuine Paddle webhooks, which always carry these fields for real transactions).
 */
function validatePaidAmount(data: any, matchedPriceId: string): { ok: boolean; reason?: string } {
  const items = data.items || [];
  let matchedAny = false;
  let matchedQtyZero = false;
  let unitAmount: number | null = null;
  let hasUnitAmount = false;
  for (const item of items) {
    const priceId = item.price?.id || item.price_id;
    if (priceId !== matchedPriceId) continue;
    matchedAny = true;
    const q = item.quantity;
    if (q !== undefined && q !== null && Number(q) === 0) matchedQtyZero = true;
    const ua = item.price?.unit_price?.amount;
    if (ua !== undefined && ua !== null) {
      const n = Number(ua);
      if (Number.isFinite(n)) {
        unitAmount = n;
        hasUnitAmount = true;
      }
    }
  }

  if (!matchedAny) return { ok: false, reason: `no item matched price ${matchedPriceId}` };
  if (matchedQtyZero) {
    return { ok: false, reason: `explicit quantity 0 for price ${matchedPriceId}` };
  }

  const totals = data.totals || {};
  const totalRaw = totals.grand_total ?? totals.total;
  if (totalRaw !== undefined && totalRaw !== null && Number.isFinite(Number(totalRaw))) {
    if (Number(totalRaw) <= 0) {
      return { ok: false, reason: `transaction total is ${totalRaw} (<= 0) for price ${matchedPriceId}` };
    }
  } else if (hasUnitAmount && unitAmount !== null && unitAmount <= 0) {
    return { ok: false, reason: `unit_price amount is ${unitAmount} (<= 0) for price ${matchedPriceId}` };
  }

  return { ok: true };
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
    await ensureLicensePaddleTxnIndex(env);
    const rawBody = await request.text();
    let signature = request.headers.get("paddle-signature") || request.headers.get("Paddle-Signature");
    if (!signature) {
      for (const [k, v] of request.headers.entries()) {
        if (k.toLowerCase() === "paddle-signature") {
          signature = v;
          break;
        }
      }
    }
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
        {
          path: url.pathname,
          has_signature: Boolean(signature),
          sig_preview: signature ? signature.slice(0, 30) : null
        }));
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
      // 环境判据:本 Worker 绑定的 Paddle 密钥是沙箱(pdl_sdbx_) → 测试环境,
      // 铸造的激活码 source 标 'test';生产 Worker 配 live 密钥标 'purchase'。
      // 环境分离与 test 标记由密钥环境自动对齐,无需额外开关。
      const isSandbox = isPaddleSandbox(env.PADDLE_API_KEY);
      const transactionId = data.id;
      const subscriptionId = data.subscription_id || null;
      let buyerEmail = data.customer?.email || data.billing_details?.email_address || data.customer_email || data.user?.email || data.custom_data?.email || data.custom_data?.buyer_email || data.custom_data?.buyerEmail || "";

      const customerId = data.customer_id || (typeof data.customer === 'string' ? data.customer : null);
      if (!buyerEmail && customerId && env.PADDLE_API_KEY) {
        try {
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

      // Extract Price ID with environment-aware fallback (Live vs Sandbox)
      const items = data.items || data.details?.line_items || [];
      const defaultLifetimeId = isSandbox ? SANDBOX_PRICE_LIFETIME_ID : PROD_PRICE_LIFETIME_ID;
      const defaultYearlyId = isSandbox ? SANDBOX_PRICE_YEARLY_ID : PROD_PRICE_YEARLY_ID;
      const effectiveLifetimeId = env.PADDLE_PRICE_ID_PLUS_LIFETIME || env.PRICE_LIFETIME_ID || defaultLifetimeId;
      const effectiveYearlyId = env.PADDLE_PRICE_ID_PLUS_YEARLY || env.PRICE_YEARLY_ID || defaultYearlyId;

      // Critical Safety Assertion: Enforce bidirectional environment & price ID alignment
      if (!isSandbox) {
        if (effectiveLifetimeId === SANDBOX_PRICE_LIFETIME_ID || effectiveYearlyId === SANDBOX_PRICE_YEARLY_ID) {
          await logSystemError(env, 'PADDLE_PRICE_MISCONFIGURATION', 'CRITICAL',
            new Error("Production Worker is configured with Paddle Sandbox test price IDs!"),
            { transaction_id: transactionId, effectiveLifetimeId, effectiveYearlyId });
          return new Response(JSON.stringify({
            error: "CRITICAL_PRICE_MISCONFIGURATION",
            message: "Production Worker is misconfigured with Paddle Sandbox test prices. Fulfillment aborted."
          }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      } else {
        if (effectiveLifetimeId === PROD_PRICE_LIFETIME_ID || effectiveYearlyId === PROD_PRICE_YEARLY_ID) {
          await logSystemError(env, 'PADDLE_PRICE_MISCONFIGURATION', 'CRITICAL',
            new Error("Test/Sandbox Worker is configured with Paddle Live production price IDs!"),
            { transaction_id: transactionId, effectiveLifetimeId, effectiveYearlyId });
          return new Response(JSON.stringify({
            error: "CRITICAL_PRICE_MISCONFIGURATION",
            message: "Test Worker is misconfigured with Paddle Live production prices. Fulfillment aborted."
          }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

      let matchedPriceId = "";
      for (const item of items) {
        const priceId = item.price?.id || item.price_id || item.priceId;
        if (priceId === effectiveLifetimeId || priceId === effectiveYearlyId) {
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

      // A1: amount validation (audit licensing-flow-audit.md). Reject zero/negative-quantity
      // transactions before mint/renew/upgrade so a $0 invoice or quantity-0 line cannot
      // fulfill a full license. Only enforced when Paddle supplies the amount fields.
      const amountCheck = validatePaidAmount(data, matchedPriceId);
      if (!amountCheck.ok) {
        ctx.waitUntil(logSystemError(env, 'PADDLE_AMOUNT_MISMATCH', 'WARN',
          new Error(amountCheck.reason),
          { transaction_id: transactionId, matched_price_id: matchedPriceId, event_type: eventType }));
        return new Response(JSON.stringify({
          message: "Transaction rejected: amount validation failed",
          code: "AMOUNT_VALIDATION_FAILED",
          reason: amountCheck.reason
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Set Tier and expiration based on price ID
      const tier = "PLUS";
      let expiresAt = "LIFETIME";
      let durationDays: number | null = null;
      const YEARLY_MS = 365 * 86400 * 1000;

      if (matchedPriceId === effectiveYearlyId) {
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

          if (matchedPriceId === effectiveLifetimeId) {
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
            const insertResult = await env.DB.prepare(`
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

            // Concurrent duplicate swallowed by the partial unique index → audit for manual review (matches sequential-path WARN)
            if (insertResult && insertResult.meta && insertResult.meta.changes === 0) {
              ctx.waitUntil(logSystemError(env, 'DUPLICATE_UPGRADE_ATTEMPT', 'WARN',
                new Error(`Lifetime upgrade for license ${targetLic.license_code} swallowed by unique index (concurrent duplicate, txn ${transactionId})`),
                { target_license_code: targetLic.license_code, swallowed_txn_id: transactionId }));
            }

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
          } else if (matchedPriceId === effectiveYearlyId) {
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
      if (matchedPriceId === effectiveYearlyId && subscriptionId) {
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

      // Write to DB。测试 Worker(沙箱密钥)铸造的码标 source='test',生产标 'purchase'。
      const source = isSandbox ? "test" : "purchase";
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
        source,
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

    // Revoke license or cancel pending upgrade on refund / revocation (Paddle Billing: transaction.revoked; Classic: transaction.refunded)
    if (eventType === "transaction.revoked" || eventType === "transaction.refunded") {
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
          // B5: Downgrade device_registry to 'free' on revoke
          await env.DB.prepare(
            "UPDATE device_registry SET tier_label = 'free', license_code = NULL, email = NULL WHERE license_code = ?"
          ).bind(upgradeRow.target_license_code).run();

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

      // Query the license: exact txn match first, then subscription fallback (B1).
      // Yearly renewal overwrites paddle_transaction_id with the latest txn, so refunding an
      // OLDER billing period's txn would otherwise miss the license and silently revoke nothing.
      const subId = data.subscription_id || data.subscription?.id || null;
      let license = await env.DB.prepare(
        "SELECT license_code, buyer_email, tier FROM licenses WHERE paddle_transaction_id = ?"
      ).bind(transactionId).first<any>();

      if (!license && subId) {
        license = await env.DB.prepare(
          "SELECT license_code, buyer_email, tier FROM licenses WHERE paddle_subscription_id = ?"
        ).bind(subId).first<any>();
      }

      if (license) {
        await env.DB.prepare(revokeLicenseSql()).bind(
          new Date().toISOString(),
          "refund",
          license.license_code
        ).run();
        // B5: Downgrade device_registry to 'free' on revoke
        await env.DB.prepare(
          "UPDATE device_registry SET tier_label = 'free', license_code = NULL, email = NULL WHERE license_code = ?"
        ).bind(license.license_code).run();
      } else {
        // Legacy no-op path preserved (0-row update) + audit so a silent miss is visible.
        const res = await env.DB.prepare(revokeByPaddleTxnSql()).bind(
          new Date().toISOString(),
          "refund",
          transactionId
        ).run();
        if (res && res.meta && res.meta.changes === 0) {
          ctx.waitUntil(logSystemError(env, 'REFUND_MISS_TARGET', 'WARN',
            new Error(`Refund webhook matched no license (txn ${transactionId})`),
            { transaction_id: transactionId, subscription_id: subId || null }));
        }
      }

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
            // B5: Downgrade device_registry to 'free' on revoke
            await env.DB.prepare(
              "UPDATE device_registry SET tier_label = 'free', license_code = NULL, email = NULL WHERE license_code = ?"
            ).bind(upgradeRow.target_license_code).run();
            return new Response(JSON.stringify({ message: "Applied lifetime upgrade revoked due to adjustment refund", status: "revoked" }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
        }

        const reason = action === "chargeback" ? "chargeback" : "refund";
        // B1: exact txn match first, then subscription fallback (see transaction.refunded above)
        const adjSubId = data.subscription_id || data.subscription?.id || null;
        let license = await env.DB.prepare(
          "SELECT license_code, buyer_email, tier FROM licenses WHERE paddle_transaction_id = ?"
        ).bind(transactionId).first<any>();

        if (!license && adjSubId) {
          license = await env.DB.prepare(
            "SELECT license_code, buyer_email, tier FROM licenses WHERE paddle_subscription_id = ?"
          ).bind(adjSubId).first<any>();
        }

        if (license) {
          await env.DB.prepare(revokeLicenseSql()).bind(
            new Date().toISOString(),
            reason,
            license.license_code
          ).run();
          // B5: Downgrade device_registry to 'free' on revoke
          await env.DB.prepare(
            "UPDATE device_registry SET tier_label = 'free', license_code = NULL, email = NULL WHERE license_code = ?"
          ).bind(license.license_code).run();
        } else {
          const res = await env.DB.prepare(revokeByPaddleTxnSql()).bind(
            new Date().toISOString(),
            reason,
            transactionId
          ).run();
          if (res && res.meta && res.meta.changes === 0) {
            ctx.waitUntil(logSystemError(env, 'REFUND_MISS_TARGET', 'WARN',
              new Error(`Adjustment ${action} matched no license (txn ${transactionId})`),
              { transaction_id: transactionId, subscription_id: adjSubId || null, action }));
          }
        }

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

        // B5: Downgrade device_registry to 'free' on revoke
        // Rationale: Clearing license_code and email ensures device immediately reflects unlinked/free tier
        // during revocation period. When subscription resumes, activations table (SSOT) is used to restore bindings.
        if (license) {
          await env.DB.prepare(
            "UPDATE device_registry SET tier_label = 'free', license_code = NULL, email = NULL WHERE license_code = ?"
          ).bind(license.license_code).run();
        }

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

      // 3. Subscription resumed / payment recovered: Restore license if previously revoked due to past_due/paused
      if (status === "active") {
        const license = await env.DB.prepare(
          "SELECT license_code, buyer_email, tier, status, revoke_reason FROM licenses WHERE paddle_subscription_id = ?"
        ).bind(subscriptionId).first<any>();

        if (license && (license.status === "revoked" || license.status === "suspended")) {
          const nextExpiry = data.current_billing_period?.ends_at || data.next_billed_at;
          const updateSql = nextExpiry
            ? "UPDATE licenses SET status = 'active', revoked_at = NULL, revoke_reason = NULL, auto_renew = 1, expires_at = ? WHERE paddle_subscription_id = ?"
            : "UPDATE licenses SET status = 'active', revoked_at = NULL, revoke_reason = NULL, auto_renew = 1 WHERE paddle_subscription_id = ?";

          if (nextExpiry) {
            await env.DB.prepare(updateSql).bind(nextExpiry, subscriptionId).run();
          } else {
            await env.DB.prepare(updateSql).bind(subscriptionId).run();
          }

          // Restore associated devices in device_registry to paid using activations table (SSOT)
          // Rationale: While device_registry unlinked on revoke, activations preserves active hardware associations.
          if (license.buyer_email) {
            await env.DB.prepare(
              "UPDATE device_registry SET tier_label = 'paid', license_code = ?, email = ? WHERE device_id IN (SELECT device_id FROM activations WHERE license_code = ?)"
            ).bind(license.license_code, license.buyer_email, license.license_code).run();
          } else {
            await env.DB.prepare(
              "UPDATE device_registry SET tier_label = 'paid', license_code = ? WHERE device_id IN (SELECT device_id FROM activations WHERE license_code = ?)"
            ).bind(license.license_code, license.license_code).run();
          }

          return new Response(JSON.stringify({
            message: "Subscription resumed: license reactivated and auto-renewal restored",
            license_code: license.license_code,
            status: "active"
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }
    }

    // Process subscription creation / activation (Section 6.6: tracked and acknowledged)
    if (eventType === "subscription.created" || eventType === "subscription.activated") {
      const subscriptionId = data.id;
      const customerId = data.customer_id || data.customer?.id;
      return new Response(JSON.stringify({
        message: `Subscription ${eventType} acknowledged`,
        subscription_id: subscriptionId,
        customer_id: customerId
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Note: subscription.expired natural expiration is safely handled via expires_at checks
    // during online & offline DRM license validation without requiring immediate revocation.
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
