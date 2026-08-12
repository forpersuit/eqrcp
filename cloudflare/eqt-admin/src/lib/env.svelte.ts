export type AdminEnvironment = 'production' | 'test';

const STORAGE_KEY = 'eqt-admin-env';

function loadInitialEnv(): AdminEnvironment {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'test' || saved === 'production') {
      return saved;
    }
  } catch {}
  return 'production';
}

class AdminEnvState {
  current = $state<AdminEnvironment>(loadInitialEnv());

  set(target: AdminEnvironment) {
    if (this.current === target) return;
    this.current = target;
    try {
      localStorage.setItem(STORAGE_KEY, target);
    } catch {}
  }
}

export const adminEnv = new AdminEnvState();

export function getAdminEnvironment(): AdminEnvironment {
  return adminEnv.current;
}

export function setAdminEnvironment(env: AdminEnvironment): void {
  adminEnv.set(env);
}
