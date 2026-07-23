const SECRET_KEY = 'eqt_admin_secret';

export function getAdminSecret(): string | null {
  return sessionStorage.getItem(SECRET_KEY);
}

export function setAdminSecret(secret: string): void {
  sessionStorage.setItem(SECRET_KEY, secret.trim());
}

export function clearAdminSecret(): void {
  sessionStorage.removeItem(SECRET_KEY);
}

export function isAuthenticated(): boolean {
  return !!getAdminSecret();
}
