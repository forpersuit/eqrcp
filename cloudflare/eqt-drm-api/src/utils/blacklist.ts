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
  /** manual | auto — source of the hit */
  source?: 'manual' | 'auto';
}

export type ManualBlacklistKind = 'email' | 'device';

export interface ManualBlacklistRow {
  id: number;
  kind: ManualBlacklistKind;
  email: string | null;
  email_hash: string | null;
  device_id: string | null;
  uuid_hash: string | null;
  cpu_hash: string | null;
  disk_hash: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: string;
  active: number;
}

export async function ensureManualBlacklistTable(env: Env): Promise<void> {
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS manual_blacklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        email TEXT DEFAULT NULL,
        email_hash TEXT DEFAULT NULL,
        device_id TEXT DEFAULT NULL,
        uuid_hash TEXT DEFAULT NULL,
        cpu_hash TEXT DEFAULT NULL,
        disk_hash TEXT DEFAULT NULL,
        reason TEXT DEFAULT NULL,
        created_by TEXT DEFAULT NULL,
        created_at TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      )
    `).run();
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_manual_bl_email_hash ON manual_blacklist(email_hash)`
    ).run();
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_manual_bl_device_id ON manual_blacklist(device_id)`
    ).run();
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_manual_bl_active ON manual_blacklist(active)`
    ).run();
  } catch (err) {
    console.error('Failed to ensure manual_blacklist table:', err);
  }
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

const emptyResult = (): BlacklistCheckResult => ({
  isAbusive: false,
  kind: '',
  reason: '',
  reasonKey: '',
  hits: 0
});

/** Admin-managed bans (email and/or device). Checked before auto abuse window. */
export async function checkManualBlacklist(
  env: Env,
  buyerEmailHash: string | null,
  uuidHash: string,
  cpuHash: string,
  diskHash: string,
  opts?: { checkEmail?: boolean; checkDevice?: boolean; deviceId?: string | null }
): Promise<BlacklistCheckResult> {
  const checkEmail = opts?.checkEmail !== false;
  const checkDevice = opts?.checkDevice !== false;
  const deviceId = (opts?.deviceId || '').trim();

  await ensureManualBlacklistTable(env);

  if (checkEmail && buyerEmailHash) {
    const hit = await env.DB.prepare(
      `SELECT id, reason FROM manual_blacklist
       WHERE active = 1 AND kind = 'email' AND email_hash = ?
       LIMIT 1`
    ).bind(buyerEmailHash).first<{ id: number; reason: string | null }>();
    if (hit) {
      return {
        isAbusive: true,
        kind: 'email',
        hits: 1,
        source: 'manual',
        reasonKey: 'blacklist_email',
        reason:
          hit.reason ||
          'This email address has been restricted by the operator.'
      };
    }
  }

  if (checkDevice && (deviceId || uuidHash || cpuHash || diskHash)) {
    if (deviceId) {
      const byId = await env.DB.prepare(
        `SELECT id, reason FROM manual_blacklist
         WHERE active = 1 AND kind = 'device' AND device_id = ?
         LIMIT 1`
      ).bind(deviceId).first<{ id: number; reason: string | null }>();
      if (byId) {
        return {
          isAbusive: true,
          kind: 'device',
          hits: 1,
          source: 'manual',
          reasonKey: 'blacklist_device',
          reason:
            byId.reason ||
            'This device has been restricted by the operator.'
        };
      }
    }

    if (uuidHash || cpuHash || diskHash) {
      const { results } = await env.DB.prepare(
        `SELECT id, reason, uuid_hash, cpu_hash, disk_hash FROM manual_blacklist
         WHERE active = 1 AND kind = 'device'
           AND (uuid_hash IS NOT NULL OR cpu_hash IS NOT NULL OR disk_hash IS NOT NULL)`
      ).all<{
        id: number;
        reason: string | null;
        uuid_hash: string | null;
        cpu_hash: string | null;
        disk_hash: string | null;
      }>();

      for (const row of results || []) {
        if (
          matchFingerprint(
            uuidHash || '',
            cpuHash || '',
            diskHash || '',
            row.uuid_hash || '',
            row.cpu_hash || '',
            row.disk_hash || ''
          )
        ) {
          return {
            isAbusive: true,
            kind: 'device',
            hits: 1,
            source: 'manual',
            reasonKey: 'blacklist_device',
            reason:
              row.reason ||
              'This device has been restricted by the operator.'
          };
        }
      }
    }
  }

  return emptyResult();
}

/**
 * Abusive refund / chargeback blacklist (rolling 365 days) + manual bans.
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
  opts?: { checkEmail?: boolean; checkDevice?: boolean; deviceId?: string | null }
): Promise<BlacklistCheckResult> {
  const checkEmail = opts?.checkEmail !== false;
  const checkDevice = opts?.checkDevice !== false;
  const oneYearAgoMs = Date.now() - ONE_YEAR_MS;

  const manual = await checkManualBlacklist(env, buyerEmailHash, uuidHash, cpuHash, diskHash, opts);
  if (manual.isAbusive) return manual;

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
            source: 'auto',
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
            source: 'auto',
            reasonKey: 'blacklist_device',
            reason:
              "This device is restricted due to multiple refund or chargeback revocations within the past 365 days. Please use another device, or request a refund if you just purchased with a different email."
          };
        }
      }
    }
  }

  return emptyResult();
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

export async function listManualBlacklist(
  env: Env,
  opts: { kind?: string; q?: string; activeOnly?: boolean; limit?: number; offset?: number }
): Promise<{ rows: ManualBlacklistRow[]; total: number }> {
  await ensureManualBlacklistTable(env);
  const limit = Math.min(opts.limit || 100, 200);
  const offset = Math.max(opts.offset || 0, 0);
  const conditions: string[] = [];
  const params: any[] = [];

  if (opts.activeOnly !== false) {
    conditions.push('active = 1');
  }
  if (opts.kind === 'email' || opts.kind === 'device') {
    conditions.push('kind = ?');
    params.push(opts.kind);
  }
  if (opts.q?.trim()) {
    const like = `%${opts.q.trim()}%`;
    conditions.push(
      '(email LIKE ? OR email_hash LIKE ? OR device_id LIKE ? OR uuid_hash LIKE ? OR cpu_hash LIKE ? OR disk_hash LIKE ? OR reason LIKE ? OR created_by LIKE ?)'
    );
    params.push(like, like, like, like, like, like, like, like);
  }

  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const countRes = await env.DB.prepare(
    `SELECT COUNT(*) as total FROM manual_blacklist${where}`
  ).bind(...params).first<{ total: number }>();
  const total = countRes?.total || 0;

  const { results } = await env.DB.prepare(
    `SELECT * FROM manual_blacklist${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all<ManualBlacklistRow>();

  return { rows: (results || []) as ManualBlacklistRow[], total };
}

export async function addManualBlacklist(
  env: Env,
  input: {
    kind: ManualBlacklistKind;
    email?: string;
    device_id?: string;
    uuid_hash?: string;
    cpu_hash?: string;
    disk_hash?: string;
    reason?: string;
    created_by?: string;
  }
): Promise<{ ok: true; row: ManualBlacklistRow } | { ok: false; error: string }> {
  await ensureManualBlacklistTable(env);
  const kind = input.kind;
  if (kind !== 'email' && kind !== 'device') {
    return { ok: false, error: 'kind must be email or device' };
  }

  const reason = (input.reason || '').trim() || null;
  const createdBy = (input.created_by || '').trim() || null;
  const createdAt = new Date().toISOString();

  if (kind === 'email') {
    const email = (input.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return { ok: false, error: 'Valid email required for kind=email' };
    }
    const emailHash = await sha256Hex(email);
    const existing = await env.DB.prepare(
      `SELECT id FROM manual_blacklist WHERE active = 1 AND kind = 'email' AND email_hash = ? LIMIT 1`
    ).bind(emailHash).first<{ id: number }>();
    if (existing) {
      return { ok: false, error: `Email already banned (id=${existing.id})` };
    }
    const ins = await env.DB.prepare(
      `INSERT INTO manual_blacklist (kind, email, email_hash, reason, created_by, created_at, active)
       VALUES ('email', ?, ?, ?, ?, ?, 1)`
    ).bind(email, emailHash, reason, createdBy, createdAt).run();
    const id = Number(ins.meta?.last_row_id || 0);
    const row = await env.DB.prepare(`SELECT * FROM manual_blacklist WHERE id = ?`).bind(id).first<ManualBlacklistRow>();
    return { ok: true, row: row! };
  }

  const deviceId = (input.device_id || '').trim() || null;
  const uuidHash = (input.uuid_hash || '').trim() || null;
  const cpuHash = (input.cpu_hash || '').trim() || null;
  const diskHash = (input.disk_hash || '').trim() || null;
  if (!deviceId && !uuidHash && !cpuHash && !diskHash) {
    return { ok: false, error: 'device requires device_id and/or at least one fingerprint hash' };
  }

  if (deviceId) {
    const existing = await env.DB.prepare(
      `SELECT id FROM manual_blacklist WHERE active = 1 AND kind = 'device' AND device_id = ? LIMIT 1`
    ).bind(deviceId).first<{ id: number }>();
    if (existing) {
      return { ok: false, error: `Device id already banned (id=${existing.id})` };
    }
  }

  const ins = await env.DB.prepare(
    `INSERT INTO manual_blacklist (kind, device_id, uuid_hash, cpu_hash, disk_hash, reason, created_by, created_at, active)
     VALUES ('device', ?, ?, ?, ?, ?, ?, ?, 1)`
  ).bind(deviceId, uuidHash, cpuHash, diskHash, reason, createdBy, createdAt).run();
  const id = Number(ins.meta?.last_row_id || 0);
  const row = await env.DB.prepare(`SELECT * FROM manual_blacklist WHERE id = ?`).bind(id).first<ManualBlacklistRow>();
  return { ok: true, row: row! };
}

/** Soft-unban (active=0). Returns false if not found. */
export async function deactivateManualBlacklist(
  env: Env,
  id: number
): Promise<ManualBlacklistRow | null> {
  await ensureManualBlacklistTable(env);
  const existing = await env.DB.prepare(
    `SELECT * FROM manual_blacklist WHERE id = ?`
  ).bind(id).first<ManualBlacklistRow>();
  if (!existing) return null;
  if (existing.active) {
    await env.DB.prepare(
      `UPDATE manual_blacklist SET active = 0 WHERE id = ?`
    ).bind(id).run();
    existing.active = 0;
  }
  return existing;
}
