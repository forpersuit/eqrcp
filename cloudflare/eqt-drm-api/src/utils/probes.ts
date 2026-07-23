import { Env } from '../types';
import { probeSmtp, SmtpProbeResult } from '../services/smtp';

export interface ProbeResult {
  ok: boolean;
  latency_ms: number;
  error: string | null;
  skipped?: boolean;
  mode?: string;
}

export interface HealthProbes {
  smtp: SmtpProbeResult;
  paddle: ProbeResult;
  db: ProbeResult;
}

export async function probePaddle(env: Env, timeoutMs = 3500): Promise<ProbeResult> {
  const started = Date.now();
  if (!env.PADDLE_WEBHOOK_SECRET) {
    return {
      ok: false,
      latency_ms: 0,
      error: "PADDLE_WEBHOOK_SECRET missing",
      skipped: true,
      mode: "config"
    };
  }

  // Webhook secret alone cannot be live-verified without a signed payload.
  // If API key is present, try a lightweight authenticated GET against Paddle API.
  const apiKey = env.PADDLE_API_KEY;
  if (!apiKey) {
    return {
      ok: true,
      latency_ms: Date.now() - started,
      error: null,
      skipped: false,
      mode: "webhook_secret_present"
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch("https://api.paddle.com/event-types", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      signal: controller.signal
    });
    clearTimeout(timer);
    const latency = Date.now() - started;
    // Webhook secret is what fulfillment needs. Optional API key is a deeper check:
    // 200 = key valid; 401/403 = network/API reachable but key rejected — still OK for webhook path.
    if (res.status === 200) {
      return { ok: true, latency_ms: latency, error: null, mode: "api_reachable" };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        ok: true,
        latency_ms: latency,
        error: `Paddle API key rejected (HTTP ${res.status}); webhook secret still configured`,
        mode: "webhook_ok_api_key_invalid"
      };
    }
    return {
      ok: false,
      latency_ms: latency,
      error: `Paddle API HTTP ${res.status}`,
      mode: "api_unexpected"
    };
  } catch (err: any) {
    return {
      ok: false,
      latency_ms: Date.now() - started,
      error: err?.message || String(err),
      mode: "api_error"
    };
  }
}

export async function runHealthProbes(env: Env): Promise<HealthProbes> {
  const dbStarted = Date.now();
  let db: ProbeResult;
  try {
    await env.DB.prepare("SELECT 1 as ok").first();
    db = { ok: true, latency_ms: Date.now() - dbStarted, error: null, mode: "select_1" };
  } catch (err: any) {
    db = {
      ok: false,
      latency_ms: Date.now() - dbStarted,
      error: err?.message || String(err),
      mode: "select_1"
    };
  }

  const [smtp, paddle] = await Promise.all([probeSmtp(env), probePaddle(env)]);
  return { smtp, paddle, db };
}
