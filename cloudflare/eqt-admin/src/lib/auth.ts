const ACCESS_OK_KEY = 'eqt_admin_access_ok';

/**
 * Admin is Cloudflare Access only (production + same-origin /api JWT).
 * Local SPA still probes Access-style session after edge login; no ADMIN_SECRET.
 */
export function markAccessAuthenticated(): void {
  sessionStorage.setItem(ACCESS_OK_KEY, '1');
}

export function clearAccessSession(): void {
  sessionStorage.removeItem(ACCESS_OK_KEY);
}

export function isAuthenticated(): boolean {
  return sessionStorage.getItem(ACCESS_OK_KEY) === '1';
}

/** Access logout: send user to CF Access logout URL if team domain configured. */
export function accessLogoutUrl(): string | null {
  const team = (import.meta.env.VITE_CF_ACCESS_TEAM_DOMAIN || 'persuit.cloudflareaccess.com')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  if (!team) return null;
  const returnTo = encodeURIComponent(window.location.origin + '/');
  return `https://${team}/cdn-cgi/access/logout?returnTo=${returnTo}`;
}
