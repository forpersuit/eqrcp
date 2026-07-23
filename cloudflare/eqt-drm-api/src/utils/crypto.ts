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
