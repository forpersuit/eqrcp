export type AdminEnvironment = 'production' | 'test';

const STORAGE_KEY = 'eqt-admin-env';

let currentEnv: AdminEnvironment = (function () {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'test' || saved === 'production') {
      return saved;
    }
  } catch {}
  return 'production';
})();

const listeners = new Set<(env: AdminEnvironment) => void>();

export function getAdminEnvironment(): AdminEnvironment {
  return currentEnv;
}

export function setAdminEnvironment(env: AdminEnvironment): void {
  if (currentEnv === env) return;
  currentEnv = env;
  try {
    localStorage.setItem(STORAGE_KEY, env);
  } catch {}
  listeners.forEach((fn) => fn(env));
}

export function subscribeAdminEnvironment(fn: (env: AdminEnvironment) => void): () => void {
  listeners.add(fn);
  fn(currentEnv);
  return () => listeners.delete(fn);
}
