/** License origin + refund eligibility (SSOT: docs/payment/license-source-and-refund-policy.md). */

export type LicenseSource = 'purchase' | 'promo' | 'admin' | 'test';

const REAL_PADDLE_TXN = /^txn_01[a-z0-9]{16,}$/i;
const SYNTHETIC_TXN = /^(txn_test_|txn_chrome_|txn_mock_|txn_e2e_)/i;

export function isRealPaddleTransactionId(transactionId: string | null | undefined): boolean {
  return !!transactionId && REAL_PADDLE_TXN.test(transactionId);
}

export function isSyntheticTestTransactionId(transactionId: string | null | undefined): boolean {
  return !!transactionId && SYNTHETIC_TXN.test(transactionId);
}

/**
 * Normalize stored or missing source. Legacy rows without `source` are inferred
 * from paddle_transaction_id so production data keeps working without a backfill job.
 */
export function normalizeLicenseSource(
  raw: string | null | undefined,
  paddleTransactionId?: string | null
): LicenseSource {
  const s = (raw || '').trim().toLowerCase();
  if (s === 'purchase' || s === 'promo' || s === 'admin' || s === 'test') {
    return s;
  }
  if (isRealPaddleTransactionId(paddleTransactionId || null)) return 'purchase';
  if (isSyntheticTestTransactionId(paddleTransactionId || null)) return 'test';
  return 'admin';
}

/** Portal self-service refund + Paddle Adjustments path. */
export function isLicenseRefundable(license: {
  status?: string | null;
  source?: string | null;
  paddle_transaction_id?: string | null;
}): boolean {
  if ((license.status || '') !== 'active') return false;
  if (normalizeLicenseSource(license.source, license.paddle_transaction_id) !== 'purchase') {
    return false;
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
        revoke_reason = COALESCE(revoke_reason, ?)
    WHERE paddle_subscription_id = ?`;
}
