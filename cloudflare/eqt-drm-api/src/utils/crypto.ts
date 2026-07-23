/** Storage purpose for verification_codes PK isolation (portal vs checkout). */
export type VerificationPurpose = "portal" | "checkout";

/**
 * Composite storage key for verification_codes.email column.
 * Prevents portal login codes from overwriting checkout codes (and vice versa).
 */
export function verificationStorageKey(purpose: VerificationPurpose, email: string): string {
  const norm = (email || "").trim().toLowerCase();
  return `${purpose}:${norm}`;
}

/** SHA-256 hex digest of a UTF-8 string (buyer email hashing). */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return bufToHex(buf);
}

/**
 * Portal ownership: match buyer_email_hash or plaintext buyer_email.
 * Fail closed when neither field is set (Admin-only licenses).
 */
export function licenseOwnedByEmail(
  license: { buyer_email_hash?: string | null; buyer_email?: string | null },
  email: string,
  emailHash: string
): boolean {
  const norm = (email || "").trim().toLowerCase();
  if (license.buyer_email_hash && license.buyer_email_hash === emailHash) return true;
  if (license.buyer_email && String(license.buyer_email).trim().toLowerCase() === norm) return true;
  return false;
}

// Helper to convert hex string to Uint8Array
export function hexToUint8Array(hex: string): Uint8Array {
  hex = hex.trim();
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }
  const array = new Uint8Array(hex.length / 2);
  for (let i = 0; i < array.length; i++) {
    array[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return array;
}

// Helper to convert array buffer to hex string
export function bufToHex(buffer: ArrayBuffer): string {
  return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
}

// Helper to verify Paddle Billing webhook signatures
export async function verifyPaddleSignature(
  rawBody: string,
  signatureHeader: string | null,
  secretKey: string
): Promise<boolean> {
  if (!signatureHeader || !secretKey) return false;

  const parts = signatureHeader.split(";");
  if (parts.length !== 2) return false;

  const timestampPart = parts.find(p => p.startsWith("ts="));
  const signaturePart = parts.find(p => p.startsWith("h1="));

  if (!timestampPart || !signaturePart) return false;

  const ts = timestampPart.split("=")[1];
  const h1 = signaturePart.split("=")[1];

  if (!ts || !h1) return false;

  // Validate timestamp drift (5 minutes / 300 seconds limit)
  const timestampInt = parseInt(ts) * 1000;
  if (isNaN(timestampInt)) return false;
  const currentTime = Date.now();
  if (Math.abs(currentTime - timestampInt) > 300 * 1000) {
    return false;
  }

  const encoder = new TextEncoder();
  const keyData = encoder.encode(secretKey);
  const messageData = encoder.encode(`${ts}:${rawBody}`);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuf = await crypto.subtle.sign("HMAC", key, messageData);
  const signatureHex = Array.prototype.map.call(
    new Uint8Array(signatureBuf),
    (x: number) => ('00' + x.toString(16)).slice(-2)
  ).join('');

  return signatureHex === h1;
}
