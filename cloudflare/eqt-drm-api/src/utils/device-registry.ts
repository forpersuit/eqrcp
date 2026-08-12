import { Env } from '../types';
import { ensureDeviceRegistryTable } from './auth';
import { logSystemError } from './error-logger';

export interface DeviceRegistryParams {
  uuidHash?: string | null;
  cpuHash?: string | null;
  diskHash?: string | null;
  appVersion?: string | null;
  tierLabel?: 'free' | 'paid';
  licenseCode?: string | null;
  email?: string | null;
}

export interface NetworkMeta {
  client_ip: string | null;
  ip_country: string | null;
  user_agent: string | null;
  city: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** Generate pure random device_id (32 hex chars, >= 16 hex required) */
export function generateRandomDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => ('00' + b.toString(16)).slice(-2)).join('');
}

/** Shared fingerprint component equality matcher */
export function matchRegistryFingerprint(
  reqUuid: string, reqCpu: string, reqDisk: string,
  dbUuid: string, dbCpu: string, dbDisk: string
): boolean {
  const reqU = (reqUuid || '').trim();
  const reqC = (reqCpu || '').trim();
  const reqD = (reqDisk || '').trim();
  const dbU = (dbUuid || '').trim();
  const dbC = (dbCpu || '').trim();
  const dbD = (dbDisk || '').trim();

  let compareCount = 0;
  if (reqU && dbU) {
    if (reqU !== dbU) return false;
    compareCount++;
  }
  if (reqC && dbC) {
    if (reqC !== dbC) return false;
    compareCount++;
  }
  if (reqD && dbD) {
    if (reqD !== dbD) return false;
    compareCount++;
  }
  return compareCount > 0;
}

const WRITE_DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Register or refresh a device entry in device_registry.
 * Performs fingerprint coarse filter -> fine filter -> 5-min write debounce.
 */
export async function registerOrRefreshDevice(
  env: Env,
  params: DeviceRegistryParams,
  net: NetworkMeta
): Promise<{ device_id: string; tier_label: string; skipped?: boolean }> {
  await ensureDeviceRegistryTable(env);

  const uuid = (params.uuidHash || '').trim();
  const cpu = (params.cpuHash || '').trim();
  const disk = (params.diskHash || '').trim();
  const tier = params.tierLabel || 'free';
  const nowIso = new Date().toISOString();

  // All 3 hashes empty check
  if (!uuid && !cpu && !disk) {
    if (tier === 'free') {
      return { device_id: '', tier_label: 'free', skipped: true };
    }
    // For paid tier, caller handles 0-component rejection
  }

  // 1. Coarse筛: match any non-empty component
  const clauses: string[] = [];
  const binds: string[] = [];
  if (uuid) { clauses.push("uuid_hash = ?"); binds.push(uuid); }
  if (cpu) { clauses.push("cpu_hash = ?"); binds.push(cpu); }
  if (disk) { clauses.push("disk_hash = ?"); binds.push(disk); }

  let matchedRow: any = null;
  if (clauses.length > 0) {
    const sql = `SELECT * FROM device_registry WHERE ${clauses.join(" OR ")}`;
    const candidates = await env.DB.prepare(sql).bind(...binds).all<any>();
    for (const cand of candidates.results || []) {
      if (matchRegistryFingerprint(uuid, cpu, disk, cand.uuid_hash || '', cand.cpu_hash || '', cand.disk_hash || '')) {
        matchedRow = cand;
        break;
      }
    }
  }

  if (matchedRow) {
    const deviceId = matchedRow.device_id;
    let newTier = matchedRow.tier_label;
    if (tier === 'paid' && matchedRow.tier_label !== 'paid') {
      newTier = 'paid';
    } else if (tier === 'free' && matchedRow.tier_label === 'paid') {
      // Tier protection: existing paid device gets free-tier request — keep paid
      logSystemError(env, 'DEVICE_REGISTRY', 'WARN', new Error('tier_protection'), {
        device_id: matchedRow.device_id,
        existing_tier: matchedRow.tier_label,
        incoming_tier: tier
      });
    }

    // 2. Write debouncing check (5 minutes)
    const lastSeen = matchedRow.last_seen_at ? new Date(matchedRow.last_seen_at).getTime() : 0;
    const shouldUpdate = !lastSeen || (Date.now() - lastSeen >= WRITE_DEBOUNCE_MS) || (newTier !== matchedRow.tier_label);

    if (shouldUpdate) {
      await env.DB.prepare(`
        UPDATE device_registry SET
          tier_label = ?,
          license_code = COALESCE(?, license_code),
          email = COALESCE(?, email),
          last_seen_at = ?,
          last_ip = ?,
          ip_country = ?,
          city = ?,
          region = ?,
          latitude = ?,
          longitude = ?,
          app_version = COALESCE(?, app_version)
        WHERE device_id = ?
      `).bind(
        newTier,
        params.licenseCode || null,
        params.email || null,
        nowIso,
        net.client_ip,
        net.ip_country,
        net.city,
        net.region,
        net.latitude,
        net.longitude,
        params.appVersion || null,
        deviceId
      ).run();
    }
    // Debounce skip: last_seen within 5 min and same tier — no DB write needed

    return { device_id: deviceId, tier_label: newTier };
  }

  // 3. No match found -> Assign pure random device_id
  const newDeviceId = generateRandomDeviceId();
  await env.DB.prepare(`
    INSERT INTO device_registry (
      device_id, uuid_hash, cpu_hash, disk_hash, tier_label, license_code, email,
      registered_at, last_seen_at, last_ip, ip_country, city, region, latitude, longitude, app_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    newDeviceId,
    uuid || null,
    cpu || null,
    disk || null,
    tier,
    params.licenseCode || null,
    params.email || null,
    nowIso,
    nowIso,
    net.client_ip,
    net.ip_country,
    net.city,
    net.region,
    net.latitude,
    net.longitude,
    params.appVersion || null
  ).run();

  // Audit: new device created (no fingerprint match found)
  logSystemError(env, 'DEVICE_REGISTRY', 'INFO', new Error('new_device'), {
    device_id_prefix: newDeviceId.substring(0, 8),
    has_cpu_hash: Boolean(cpu),
    has_disk_hash: Boolean(disk),
    tier
  });

  return { device_id: newDeviceId, tier_label: tier };
}
