import { Env } from '../types';

// Perform 3-of-2 matching check between client hashes and a stored activation record
export function matchFingerprint(
  clientUuid: string, clientCpu: string, clientDisk: string,
  storedUuid: string, storedCpu: string, storedDisk: string
): boolean {
  let matches = 0;
  if (clientUuid && storedUuid && clientUuid === storedUuid) matches++;
  if (clientCpu && storedCpu && clientCpu === storedCpu) matches++;
  if (clientDisk && storedDisk && clientDisk === storedDisk) matches++;
  return matches >= 2;
}

// Check if the buyer's email or the current device fingerprint is blacklisted due to repetitive refund behavior (>= 2 times)
export async function checkAbusiveRefundBlacklist(
  env: Env,
  buyerEmailHash: string | null,
  uuidHash: string,
  cpuHash: string,
  diskHash: string
): Promise<{ isAbusive: boolean; reason: string }> {
  // 1. Email-based blacklist check
  if (buyerEmailHash) {
    const res = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM licenses WHERE buyer_email_hash = ? AND status = 'revoked'"
    ).bind(buyerEmailHash).first<any>();
    if (res && res.count >= 2) {
      return {
        isAbusive: true,
        reason: "This email address is blacklisted due to multiple refund/revocation activities."
      };
    }
  }

  // 2. Device fingerprint-based blacklist check
  if (uuidHash || cpuHash || diskHash) {
    // Fetch activations associated with revoked licenses
    const { results: revokedActivations } = await env.DB.prepare(`
      SELECT a.uuid_hash, a.cpu_hash, a.disk_hash 
      FROM activations a
      JOIN licenses l ON a.license_code = l.license_code
      WHERE l.status = 'revoked'
    `).all<any>();

    let refundMatchCount = 0;
    for (const act of revokedActivations) {
      if (matchFingerprint(
        uuidHash || "", cpuHash || "", diskHash || "",
        act.uuid_hash || "", act.cpu_hash || "", act.disk_hash || ""
      )) {
        refundMatchCount++;
        if (refundMatchCount >= 2) {
          return {
            isAbusive: true,
            reason: "This device is blacklisted due to multiple refund/revocation activities."
          };
        }
      }
    }
  }

  return { isAbusive: false, reason: "" };
}
