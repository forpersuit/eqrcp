import { Env, PRICE_LIFETIME_ID, PRICE_YEARLY_ID } from '../types';
import { verifyPaddleSignature } from '../utils/crypto';
import { sendDRMEmail } from '../services/smtp';
import { logSystemError } from '../utils/error-logger';
import { ensureLicenseSourceColumns } from '../utils/auth';
import { revokeByPaddleSubSql, revokeByPaddleTxnSql } from '../utils/license-source';

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
                <td style="padding: 10px; border: 1px solid #ddd; color: #ef4444; font-weight: bold;">已吊销 (Revoked) · 原因: 退款</td>
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
          const planName = license.tier === "PLUS" ? "EQT Plus" : (license.tier === "PRO" ? "EQT Pro" : license.tier);
          const reasonLabel = reason === "chargeback" ? "银行拒付 / Chargeback" : "退款 / Refund";
          const emailHtml = `
            <div style="font-family: sans-serif; padding: 20px; line-height: 1.6; color: #333;">
              <h2 style="color: #ef4444;">您的 EQT 许可证授权已吊销</h2>
              <p>支付渠道通知：${reasonLabel}。对应授权已立即失效。</p>
              <p>激活码：<code>${license.license_code}</code> · 套餐：${planName}</p>
              <p>已激活设备将在下次联网对账时自动降级为免费版。</p>
            </div>
          `;
          ctx.waitUntil(sendDRMEmail(env, license.buyer_email, "【EQT】许可证授权吊销通知", emailHtml));
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
