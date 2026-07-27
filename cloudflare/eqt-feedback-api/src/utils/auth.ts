import { verifyCloudflareAccessJwt } from './cf-access-jwt';

export interface AdminAuthEnv {
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  CF_ACCESS_ALLOWED_EMAILS?: string;
}

function accessConfigured(env: AdminAuthEnv): boolean {
  return !!(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD);
}

function parseAllowedEmails(env: AdminAuthEnv): string[] {
  const raw = (env.CF_ACCESS_ALLOWED_EMAILS || 'admin@eqt.net.im').trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * Local wrangler / e2e only: TEAM_DOMAIN=local.dev + AUD=local-dev
 * accepts header Cf-Access-Jwt-Assertion: local.<email>
 */
function tryLocalDevJwt(
  jwt: string,
  env: AdminAuthEnv
): { ok: true; email: string } | { ok: false } {
  const team = (env.CF_ACCESS_TEAM_DOMAIN || '').toLowerCase();
  const aud = env.CF_ACCESS_AUD || '';
  if (team !== 'local.dev' || aud !== 'local-dev') return { ok: false };
  if (!jwt.startsWith('local.')) return { ok: false };
  const email = jwt.slice('local.'.length).trim().toLowerCase();
  if (!email.includes('@')) return { ok: false };
  const allowed = parseAllowedEmails(env);
  if (allowed.length && !allowed.includes(email)) return { ok: false };
  return { ok: true, email };
}

/**
 * Admin route guard for Feedback API Worker — Cloudflare Access JWT.
 * Header: Cf-Access-Jwt-Assertion
 */
export async function requireAdminAuth(
  request: Request,
  env: AdminAuthEnv,
  corsHeaders: Record<string, string> = {}
): Promise<Response | null> {
  if (!accessConfigured(env)) {
    return new Response(
      JSON.stringify({
        error: 'Admin API not configured on Feedback Worker (CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD missing)',
        code: 'ACCESS_NOT_CONFIGURED'
      }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const jwt =
    request.headers.get('Cf-Access-Jwt-Assertion') ||
    request.headers.get('cf-access-jwt-assertion');

  if (!jwt) {
    return new Response(
      JSON.stringify({
        error: 'Cloudflare Access JWT required for Admin Feedback API',
        code: 'ACCESS_JWT_REQUIRED'
      }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const local = tryLocalDevJwt(jwt, env);
  if (local.ok) {
    (request as any).__adminEmail = local.email;
    return null;
  }

  const result = await verifyCloudflareAccessJwt(
    jwt,
    env.CF_ACCESS_TEAM_DOMAIN!,
    env.CF_ACCESS_AUD!,
    parseAllowedEmails(env)
  );
  if (result.ok) {
    (request as any).__adminEmail = result.email;
    return null;
  }

  return new Response(
    JSON.stringify({
      error: result.error || 'Invalid Cloudflare Access JWT',
      code: 'ACCESS_JWT_INVALID'
    }),
    { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
