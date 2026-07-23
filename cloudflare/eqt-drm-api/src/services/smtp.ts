import { connect } from 'cloudflare:sockets';
import { Env } from '../types';
import { AUTH_CODE_EMAIL_I18N, CHECKOUT_EMAIL_I18N } from '../i18n';
import { logSystemError } from '../utils/error-logger';

export interface MailOptions {

  sender: string;
  senderPass: string;
  host: string;
  port: number;
  to: string;
  subject: string;
  html: string;
}

// SMTP over TLS client implementing SMTP protocol over secure connect() socket
export async function sendMailViaSmtp(options: MailOptions): Promise<void> {
  const socket = connect({ hostname: options.host, port: options.port }, { secureTransport: "on", allowHalfOpen: false });
  
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  let buffer = "";

  async function readLine(): Promise<string> {
    while (true) {
      const idx = buffer.indexOf("\r\n");
      if (idx !== -1) {
        const line = buffer.substring(0, idx);
        buffer = buffer.substring(idx + 2);
        return line;
      }
      const { value, done } = await reader.read();
      if (done) {
        if (buffer.length > 0) {
          const line = buffer;
          buffer = "";
          return line;
        }
        throw new Error("SMTP server closed connection unexpectedly");
      }
      buffer += decoder.decode(value, { stream: true });
    }
  }

  async function readResponse(): Promise<{ code: number; lines: string[] }> {
    const lines: string[] = [];
    while (true) {
      const line = await readLine();
      lines.push(line);
      if (line.match(/^\d{3} /)) {
        const code = parseInt(line.substring(0, 3));
        return { code, lines };
      }
    }
  }

  async function sendCmd(cmd: string, expectedCode: number): Promise<void> {
    await writer.write(encoder.encode(cmd + "\r\n"));
    const resp = await readResponse();
    if (resp.code !== expectedCode) {
      throw new Error(`SMTP command '${cmd.split(' ')[0]}' failed. Expected ${expectedCode}, got ${resp.code}: ${resp.lines.join("; ")}`);
    }
  }

  try {
    const greet = await readResponse();
    if (greet.code !== 220) {
      throw new Error(`SMTP connection greeting failed: ${greet.lines.join("; ")}`);
    }

    await sendCmd("EHLO eqt-drm-api", 250);
    await sendCmd("AUTH LOGIN", 334);
    
    const userBase64 = btoa(options.sender);
    await sendCmd(userBase64, 334);

    const passBase64 = btoa(options.senderPass);
    await sendCmd(passBase64, 235);

    await sendCmd(`MAIL FROM:<${options.sender}>`, 250);
    await sendCmd(`RCPT TO:<${options.to}>`, 250);
    await sendCmd("DATA", 354);

    function encodeRFC2047(str: string): string {
      if (/^[\x00-\x7F]*$/.test(str)) {
        return str;
      }
      const bytes = new TextEncoder().encode(str);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return `=?UTF-8?B?${btoa(binary)}?=`;
    }

    const encodedSubject = encodeRFC2047(options.subject);

    const bodyLines = [
      `From: "EQT" <${options.sender}>`,
      `To: <${options.to}>`,
      `Subject: ${encodedSubject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset="utf-8"`,
      ``,
      options.html,
      `.`
    ];
    await sendCmd(bodyLines.join("\r\n"), 250);
    await sendCmd("QUIT", 221);
  } finally {
    writer.releaseLock();
    reader.releaseLock();
    await socket.close();
  }
}

export interface SmtpProbeResult {
  ok: boolean;
  latency_ms: number;
  error: string | null;
  skipped: boolean;
}

/**
 * Live SMTP probe: TLS connect + EHLO + AUTH LOGIN + QUIT (no mail delivery).
 * Bounded by timeoutMs so admin health never hangs the isolate.
 */
export async function probeSmtp(env: Env, timeoutMs = 4000): Promise<SmtpProbeResult> {
  const host = env.MAIL_SEND_SERVER;
  const pass = env.MAIL_SENDER_PASSWORD;
  const sender = env.MAIL_SENDER;
  const portStr = env.MAIL_SEND_SAFE_PORT;
  if (!host || !pass || !sender || !portStr) {
    return { ok: false, latency_ms: 0, error: "SMTP env incomplete", skipped: true };
  }

  const port = parseInt(portStr, 10) || 465;
  const started = Date.now();

  const run = async (): Promise<SmtpProbeResult> => {
    const socket = connect({ hostname: host, port }, { secureTransport: "on", allowHalfOpen: false });
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";

    async function readLine(): Promise<string> {
      while (true) {
        const idx = buffer.indexOf("\r\n");
        if (idx !== -1) {
          const line = buffer.substring(0, idx);
          buffer = buffer.substring(idx + 2);
          return line;
        }
        const { value, done } = await reader.read();
        if (done) {
          if (buffer.length > 0) {
            const line = buffer;
            buffer = "";
            return line;
          }
          throw new Error("SMTP closed during probe");
        }
        buffer += decoder.decode(value, { stream: true });
      }
    }

    async function readResponse(): Promise<{ code: number }> {
      while (true) {
        const line = await readLine();
        if (line.match(/^\d{3} /)) {
          return { code: parseInt(line.substring(0, 3), 10) };
        }
      }
    }

    async function sendCmd(cmd: string, expected: number): Promise<void> {
      await writer.write(encoder.encode(cmd + "\r\n"));
      const resp = await readResponse();
      if (resp.code !== expected) {
        throw new Error(`SMTP ${cmd.split(" ")[0]} expected ${expected} got ${resp.code}`);
      }
    }

    try {
      const greet = await readResponse();
      if (greet.code !== 220) throw new Error(`SMTP greeting ${greet.code}`);
      await sendCmd("EHLO eqt-admin-probe", 250);
      await sendCmd("AUTH LOGIN", 334);
      await sendCmd(btoa(sender), 334);
      await sendCmd(btoa(pass), 235);
      await sendCmd("QUIT", 221);
      return { ok: true, latency_ms: Date.now() - started, error: null, skipped: false };
    } finally {
      try {
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();
      } catch {
        // ignore close errors after probe
      }
    }
  };

  try {
    const result = await Promise.race([
      run(),
      new Promise<SmtpProbeResult>((_, reject) =>
        setTimeout(() => reject(new Error(`SMTP probe timeout after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);
    return result;
  } catch (err: any) {
    return {
      ok: false,
      latency_ms: Date.now() - started,
      error: err?.message || String(err),
      skipped: false
    };
  }
}

export async function sendDRMEmail(env: Env, to: string, subject: string, html: string): Promise<void> {
  const host = env.MAIL_SEND_SERVER;
  const pass = env.MAIL_SENDER_PASSWORD;
  const sender = env.MAIL_SENDER;
  const portStr = env.MAIL_SEND_SAFE_PORT;

  if (!host || !pass || !sender || !portStr) {
    console.warn("DRM SMTP Send Warning: SMTP credentials are not fully configured in env, skipping email delivery.");
    return;
  }

  const port = parseInt(portStr) || 465;
  try {
    await sendMailViaSmtp({
      sender,
      senderPass: pass,
      host,
      port,
      to,
      subject,
      html
    });
    console.log(`DRM SMTP Send Success: Email successfully sent to ${to} with subject "${subject}"`);
  } catch (err: any) {
    console.error(`DRM SMTP Send Error to ${to}:`, err.message || err);
    await logSystemError(env, 'SMTP_EMAIL_FAIL', 'WARN', err, { to, subject });
  }
}


// Unified HTML Email Layout Wrapper for Consistent Style
export function renderEmailWrapper(title: string, contentHtml: string): string {
  return `
    <div style="font-family: Arial, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff; color: #334155; line-height: 1.6;">
      <div style="border-bottom: 2px solid #10b981; padding-bottom: 14px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between;">
        <span style="font-size: 20px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px;">EQT <span style="font-size: 13px; font-weight: 600; color: #10b981;">Easy QR Transfer</span></span>
        <span style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Official Notice</span>
      </div>
      <h2 style="color: #0f172a; margin-top: 0; font-size: 18px; font-weight: 700;">${title}</h2>
      ${contentHtml}
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 28px 0 16px 0;" />
      <p style="font-size: 12px; color: #94a3b8; margin: 0; text-align: center;">© 2026 EQT (Easy QR Transfer). All rights reserved.</p>
    </div>
  `;
}

export function buildAuthCodeEmailHtml(lang: string, code: string): { subject: string; html: string } {
  const norm = (lang || 'en').toLowerCase().substring(0, 2);
  const t = AUTH_CODE_EMAIL_I18N[norm] || AUTH_CODE_EMAIL_I18N['zh'] || AUTH_CODE_EMAIL_I18N['en'];
  const content = `
    <p style="color: #475569; font-size: 14px;">${t.bodyText}</p>
    <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; text-align: center; margin: 20px 0;">
      <span style="font-size: 28px; font-weight: 800; letter-spacing: 6px; color: #166534; font-family: monospace;">${code}</span>
    </div>
    <p style="font-size: 13px; color: #64748b;">${t.validityText}</p>
  `;
  return { subject: t.subject, html: renderEmailWrapper(t.title, content) };
}

export function buildCheckoutEmailHtml(lang: string, code: string): { subject: string; html: string } {
  const norm = (lang || 'en').toLowerCase().substring(0, 2);
  const t = CHECKOUT_EMAIL_I18N[norm] || CHECKOUT_EMAIL_I18N['zh'] || CHECKOUT_EMAIL_I18N['en'];
  const content = `
    <p style="color: #475569; font-size: 14px;">${t.bodyHtml}</p>
    <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; text-align: center; margin: 20px 0;">
      <span style="font-size: 28px; font-weight: 800; letter-spacing: 6px; color: #166534; font-family: monospace;">${code}</span>
    </div>
    <p style="font-size: 13px; color: #64748b;">${t.validityText}</p>
  `;
  return { subject: t.subject, html: renderEmailWrapper(t.title, content) };
}
