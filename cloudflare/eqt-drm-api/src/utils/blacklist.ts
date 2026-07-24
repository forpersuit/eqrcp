import { Env, ONE_YEAR_MS, MAX_YEARLY_ABUSIVE_REFUNDS } from '../types';
import { isPurchaseLikeRevocation } from './license-source';
import { sha256Hex } from './crypto';

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

export type BlacklistHitKind = 'email' | 'device' | '';

export interface BlacklistCheckResult {
  isAbusive: boolean;
  kind: BlacklistHitKind;
  /** Machine-facing reason (English fallback; routes may map via i18n keys). */
  reason: string;
  /** i18n key for API clients: blacklist_email / blacklist_device */
  reasonKey: string;
  hits: number;
}

/**
 * A purchase-like revoke counts toward the abuse window only if the license
 * was ever activated (current activations OR unbind history).
 * Unactivated refunds do NOT count — customer never used the entitlement.
 */
function wasEverActivated(row: { act_n?: number | null; unbind_n?: number | null }): boolean {
  const acts = Number(row.act_n || 0);
  const unbinds = Number(row.unbind_n || 0);
  return acts > 0 || unbinds > 0;
}

/**
 * Abusive refund / chargeback blacklist (rolling 365 days).
 *
 * Gate A — email: purchase-time (checkout) + activate-time.
 * Gate B — device: activate-time only (fingerprint known).
 *
 * Counts only purchase-like revocations that were ever activated.
 * Threshold: MAX_YEARLY_ABUSIVE_REFUNDS (3, i.e. more than two).
 */
export async function checkAbusiveRefundBlacklist(
  env: Env,
  buyerEmailHash: string | null,
  uuidHash: string,
  cpuHash: string,
  diskHash: string,
  opts?: { checkEmail?: boolean; checkDevice?: boolean }
): Promise<BlacklistCheckResult> {
  const checkEmail = opts?.checkEmail !== false;
  const checkDevice = opts?.checkDevice !== false;
  const oneYearAgoMs = Date.now() - ONE_YEAR_MS;
  const empty: BlacklistCheckResult = {
    isAbusive: false,
    kind: '',
    reason: '',
    reasonKey: '',
    hits: 0
  };

  // 1. Email-based (purchase-like + ever activated)
  if (checkEmail && buyerEmailHash) {
    const { results: revokedByEmail } = await env.DB.prepare(
      `SELECT l.source, l.paddle_transaction_id, l.revoke_reason, l.revoked_at, l.created_at, l.license_code,
              (SELECT COUNT(*) FROM activations a WHERE a.license_code = l.license_code) AS act_n,
              (SELECT COUNT(*) FROM unbind_records u WHERE u.license_code = l.license_code) AS unbind_n
       FROM licenses l
       WHERE l.buyer_email_hash = ? AND l.status = 'revoked'`
    ).bind(buyerEmailHash).all<any>();

    let emailHits = 0;
    for (const row of revokedByEmail || []) {
      if (!isPurchaseLikeRevocation(row)) continue;
      if (!wasEverActivated(row)) continue;
      const when = row.revoked_at || row.created_at;
      if (withinRollingYear(when, oneYearAgoMs)) {
        emailHits++;
        if (emailHits >= MAX_YEARLY_ABUSIVE_REFUNDS) {
          return {
            isAbusive: true,
            kind: 'email',
            hits: emailHits,
            reasonKey: 'blacklist_email',
            reason:
              "This email address is restricted due to multiple refund or chargeback revocations (on activated licenses) within the past 365 days."
          };
        }
      }
    }
  }

  // 2. Device fingerprint (implies activation existed when recorded)
  if (checkDevice && (uuidHash || cpuHash || diskHash)) {
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
            kind: 'device',
            hits: deviceHits,
            reasonKey: 'blacklist_device',
            reason:
              "This device is restricted due to multiple refund or chargeback revocations within the past 365 days. Please use another device, or request a refund if you just purchased with a different email."
          };
        }
      }
    }
  }

  return empty;
}

/** Checkout gate: email-only (no device fingerprint yet). */
export async function checkEmailBlacklist(
  env: Env,
  email: string
): Promise<BlacklistCheckResult> {
  const hash = await sha256Hex(email.trim().toLowerCase());
  return checkAbusiveRefundBlacklist(env, hash, '', '', '', {
    checkEmail: true,
    checkDevice: false
  });
}
