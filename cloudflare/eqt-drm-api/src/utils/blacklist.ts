import { Env, ONE_YEAR_MS, MAX_YEARLY_ABUSIVE_REFUNDS } from '../types';
import { isPurchaseLikeRevocation } from './license-source';

// Perform 3-of-2 matching check between client hashes and a stored activation record
export function matchFingerprint(
  clientUuid: string, clientCpu: string, clientDisk: string,
  storedUuid: string, storedCpu: string, storedDisk: string
): boolean {
  let matches = 0;
  // Empty-string fields must not count as a match (AGENTS fingerprint rule)
  if (clientUuid && storedUuid && clientUuid === storedUuid) matches++;
  if (clientCpu && storedCpu && clientCpu === storedCpu) matches++;
  if (clientDisk && storedDisk && clientDisk === storedDisk) matches++;
  return matches >= 2;
}

function withinRollingYear(iso: string | null | undefined, oneYearAgoMs: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t >= oneYearAgoMs;
}

/**
 * Abusive refund / chargeback blacklist (rolling 365 days).
 * Counts only purchase-like revocations (source=purchase or legacy real Paddle txn).
 * Threshold: MAX_YEARLY_ABUSIVE_REFUNDS (2) on email hash OR device fingerprint.
 * Disclosed in Terms + Refund Policy.
 */
export async function checkAbusiveRefundBlacklist(
  env: Env,
  buyerEmailHash: string | null,
  uuidHash: string,
  cpuHash: string,
  diskHash: string
): Promise<{ isAbusive: boolean; reason: string }> {
  const oneYearAgoMs = Date.now() - ONE_YEAR_MS;

  // 1. Email-based (purchase-like revokes in rolling year)
  if (buyerEmailHash) {
    const { results: revokedByEmail } = await env.DB.prepare(
      `SELECT source, paddle_transaction_id, revoke_reason, revoked_at, created_at
       FROM licenses
       WHERE buyer_email_hash = ? AND status = 'revoked'`
    ).bind(buyerEmailHash).all<any>();

    let emailHits = 0;
    for (const row of revokedByEmail || []) {
      if (!isPurchaseLikeRevocation(row)) continue;
      const when = row.revoked_at || row.created_at;
      if (withinRollingYear(when, oneYearAgoMs)) {
        emailHits++;
        if (emailHits >= MAX_YEARLY_ABUSIVE_REFUNDS) {
          return {
            isAbusive: true,
            reason:
              "This email address is restricted due to multiple refund or chargeback revocations within the past 365 days."
          };
        }
      }
    }
  }

  // 2. Device fingerprint (purchase-like revokes only)
  if (uuidHash || cpuHash || diskHash) {
    const { results: revokedActivations } = await env.DB.prepare(`
      SELECT a.uuid_hash, a.cpu_hash, a.disk_hash,
             l.source, l.paddle_transaction_id, l.revoke_reason, l.revoked_at, l.created_at
      FROM activations a
      JOIN licenses l ON a.license_code = l.license_code
      WHERE l.status = 'revoked'
    `).all<any>();

    let deviceHits = 0;
    for (const act of revokedActivations || []) {
      if (!isPurchaseLikeRevocation(act)) continue;
      const when = act.revoked_at || act.created_at;
      if (!withinRollingYear(when, oneYearAgoMs)) continue;
      if (matchFingerprint(
        uuidHash || "", cpuHash || "", diskHash || "",
        act.uuid_hash || "", act.cpu_hash || "", act.disk_hash || ""
      )) {
        deviceHits++;
        if (deviceHits >= MAX_YEARLY_ABUSIVE_REFUNDS) {
          return {
            isAbusive: true,
            reason:
              "This device is restricted due to multiple refund or chargeback revocations within the past 365 days."
          };
        }
      }
    }
  }

  return { isAbusive: false, reason: "" };
}
