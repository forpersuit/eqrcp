const ACCESS_OK_KEY = 'eqt_admin_access_ok';

/**
 * Admin is Cloudflare Access only (production + same-origin /api JWT).
 * Local SPA probes Access session after edge login.
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

/** Access logout: send user to CF Access logout URL */
export function accessLogoutUrl(): string {
  const team = (import.meta.env.VITE_CF_ACCESS_TEAM_DOMAIN || 'sageai.cloudflareaccess.com')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  const returnTo = encodeURIComponent(window.location.origin + '/');
  return `https://${team}/cdn-cgi/access/logout?returnTo=${returnTo}`;
}

/** Access login: send user directly to CF Access team portal */
export function accessLoginUrl(): string {
  const team = (import.meta.env.VITE_CF_ACCESS_TEAM_DOMAIN || 'sageai.cloudflareaccess.com')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  return `https://${team}/`;
}

