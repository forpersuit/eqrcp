const SECRET_KEY = 'eqt_admin_secret';
const ACCESS_OK_KEY = 'eqt_admin_access_ok';

/** secret = local/break-glass; access = Cloudflare Access (same-origin proxy + JWT) */
export type AdminAuthMode = 'secret' | 'access';

export function getAdminAuthMode(): AdminAuthMode {
  const m = (import.meta.env.VITE_ADMIN_AUTH_MODE || '').toLowerCase();
  if (m === 'access') return 'access';
  // Production default on admin host: prefer access when not explicitly secret
  if (typeof window !== 'undefined' && window.location.hostname === 'admin.eqt.net.im') {
    return m === 'secret' ? 'secret' : 'access';
  }
  return 'secret';
}

export function getAdminSecret(): string | null {
  return sessionStorage.getItem(SECRET_KEY);
}

export function setAdminSecret(secret: string): void {
  sessionStorage.setItem(SECRET_KEY, secret.trim());
  sessionStorage.removeItem(ACCESS_OK_KEY);
}

export function clearAdminSecret(): void {
  sessionStorage.removeItem(SECRET_KEY);
  sessionStorage.removeItem(ACCESS_OK_KEY);
}

export function markAccessAuthenticated(): void {
  sessionStorage.setItem(ACCESS_OK_KEY, '1');
  sessionStorage.removeItem(SECRET_KEY);
}

export function isAuthenticated(): boolean {
  if (getAdminAuthMode() === 'access') {
    return sessionStorage.getItem(ACCESS_OK_KEY) === '1' || !!getAdminSecret();
  }
  return !!getAdminSecret();
}

/** Access logout: send user to CF Access logout URL if team domain configured. */
export function accessLogoutUrl(): string | null {
  const team = (import.meta.env.VITE_CF_ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!team) return null;
  const returnTo = encodeURIComponent(window.location.origin + '/');
  return `https://${team}/cdn-cgi/access/logout?returnTo=${returnTo}`;
}
