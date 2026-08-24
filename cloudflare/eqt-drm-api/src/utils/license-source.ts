/** License origin + refund eligibility (SSOT: docs/payment/license-source-and-refund-policy.md). */

export type LicenseSource = 'purchase' | 'promo' | 'admin' | 'test';

const REAL_PADDLE_TXN = /^txn_01[a-z0-9]{16,}$/i;
const SYNTHETIC_TXN = /^(txn_test_|txn_chrome_|txn_mock_|txn_e2e_|txn_yearly_)/i;
/** Live/sandbox subscription ids look like sub_01…; test fixtures use sub_test_ / sub_e2e_ */
const REAL_PADDLE_SUB = /^sub_01[a-z0-9]{16,}$/i;
const SYNTHETIC_SUB = /^(sub_test_|sub_chrome_|sub_mock_|sub_e2e_|sub_yearly_)/i;

export function isRealPaddleTransactionId(transactionId: string | null | undefined): boolean {
  if (!transactionId) return false;
  if (isSyntheticTestTransactionId(transactionId)) return false;
  return REAL_PADDLE_TXN.test(transactionId);
}

export function isSyntheticTestTransactionId(transactionId: string | null | undefined): boolean {
  return !!transactionId && SYNTHETIC_TXN.test(transactionId);
}

export function isRealPaddleSubscriptionId(subscriptionId: string | null | undefined): boolean {
  return !!subscriptionId && REAL_PADDLE_SUB.test(subscriptionId);
}

export function isSyntheticTestSubscriptionId(subscriptionId: string | null | undefined): boolean {
  return !!subscriptionId && SYNTHETIC_SUB.test(subscriptionId);
}

/**
 * Whether a Paddle API key is a sandbox key. Sandbox keys start with `pdl_sdbx_`.
 * This indicates whether Paddle API calls should target sandbox-api.paddle.com or api.paddle.com.
 */
export function isPaddleSandbox(apiKey: string | null | undefined): boolean {
  return !!apiKey && apiKey.startsWith('pdl_sdbx_');
}

/** Portal self-service cancel (yearlies with a subscription id). Not a refund. */
export function isLicenseCancellable(license: {
  status?: string | null;
  paddle_subscription_id?: string | null;
  source?: string | null;
  paddle_transaction_id?: string | null;
}): boolean {
  if ((license.status || '') !== 'active') return false;
  const sub = license.paddle_subscription_id || '';
  if (!sub) return false;
  // Promo/admin without real sub: no cancel. Test synthetic sub: allow local cancel path.
  if (isSyntheticTestSubscriptionId(sub)) return true;
  if (!isRealPaddleSubscriptionId(sub)) return false;
  const source = normalizeLicenseSource(license.source, license.paddle_transaction_id);
  return source === 'purchase' || source === 'test';
}

/**
 * Normalize stored or missing source.
 * Real Paddle transactions (live or sandbox) always belong to 'purchase'.
 * Fixtures with synthetic test txn IDs belong to 'test'.
 * Admin/promo generated codes keep their respective sources.
 */
export function normalizeLicenseSource(
  raw: string | null | undefined,
  paddleTransactionId?: string | null
): LicenseSource {
  const s = (raw || '').trim().toLowerCase();
  if (isRealPaddleTransactionId(paddleTransactionId || null)) {
    return 'purchase';
  }
  if (s === 'purchase' || s === 'promo' || s === 'admin') {
    return s;
  }
  if (s === 'test' || isSyntheticTestTransactionId(paddleTransactionId || null)) {
    return 'test';
  }
  return 'admin';
}

/** Portal self-service refund + Paddle Adjustments path (14-day cooling-off window).
 *  Refund window is measured from last_purchased_at (latest renewal) with fallback to created_at (original purchase),
 *  matching the portal's is_in_refund_window display (B2 audit). */
export function isLicenseRefundable(license: {
  status?: string | null;
  source?: string | null;
  paddle_transaction_id?: string | null;
  created_at?: string | null;
  last_purchased_at?: string | null;
  paid_amount?: number | null;
}): boolean {
  if ((license.status || '') !== 'active') return false;
  const source = normalizeLicenseSource(license.source, license.paddle_transaction_id);
  if (source !== 'purchase') {
    return false;
  }
  // Zero-payment ($0 / 100% coupon / trial) transactions have no captured payment to refund
  if (license.paid_amount !== undefined && license.paid_amount !== null && Number(license.paid_amount) <= 0) {
    return false;
  }
  // Enforce 14-day refund window from last_purchased_at (renewal) or created_at (original)
  const windowStart = license.last_purchased_at || license.created_at;
  if (windowStart) {
    const startTime = new Date(windowStart).getTime();
    if (!isNaN(startTime) && Date.now() - startTime > 14 * 86400 * 1000) {
      return false;
    }
  }
  return isRealPaddleTransactionId(license.paddle_transaction_id || null);
}

/** Whether this revoked row should count toward the abusive-refund blacklist. */
export function isPurchaseLikeRevocation(license: {
  source?: string | null;
  paddle_transaction_id?: string | null;
  revoke_reason?: string | null;
}): boolean {
  const source = normalizeLicenseSource(license.source, license.paddle_transaction_id);
  if (source !== 'purchase') return false;
  const reason = (license.revoke_reason || '').toLowerCase();
  // Explicit money-movement reasons only. Legacy null is treated as refund-like
  // unless tagged admin/test/subscription (ops archive).
  if (!reason) return true;
  if (reason === 'admin' || reason === 'test' || reason === 'subscription' || reason === 'expired') {
    return false;
  }
  return reason === 'refund' || reason === 'chargeback';
}

/** Shared SQL helper: mark license revoked with timestamp + reason (idempotent on reason if already set). */
export function revokeLicenseSql(): string {
  return `UPDATE licenses
    SET status = 'revoked',
        revoked_at = COALESCE(revoked_at, ?),
        revoke_reason = COALESCE(revoke_reason, ?)
    WHERE license_code = ?`;
}

export function revokeByPaddleTxnSql(): string {
  return `UPDATE licenses
    SET status = 'revoked',
        revoked_at = COALESCE(revoked_at, ?),
        revoke_reason = COALESCE(revoke_reason, ?)
    WHERE paddle_transaction_id = ?`;
}

export function revokeByPaddleSubSql(): string {
  return `UPDATE licenses
    SET status = 'revoked',
        revoked_at = COALESCE(revoked_at, ?),
        revoke_reason = COALESCE(revoke_reason, ?),
        auto_renew = 0
    WHERE paddle_subscription_id = ?`;
}
