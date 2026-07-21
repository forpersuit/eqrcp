import { state, LicenseStatus } from '../state';
import { t } from '../i18n';
import { saveLicense, validateRedeemCode, licenseStorageKey } from './licenseController';
import { ActivateLicense, ResetLicense, RefreshLicenseStatus } from '../../wailsjs/go/main/App';

export const licenseTiers: Record<string, string> = {
    PLUS: 'EQT Plus',
    PRO: 'EQT Pro',
};

export function getLicenseDisplayName(license: LicenseStatus | null): string {
    if (!license || !license.tier) return 'No paid plan active';
    if (license.tier === 'PLUS' && license.codeDate === 'LIFETIME') {
        return 'EQT Plus U';
    }
    return licenseTiers[license.tier] || license.tier;
}

export function loadLicense(): LicenseStatus | null {
    try {
        const raw = window.localStorage.getItem(licenseStorageKey);
        const saved = JSON.parse(raw || '{}') as LicenseStatus;
        if (saved && saved.tier && licenseTiers[saved.tier]) {
            state.license = saved;
            return saved;
        }
    } catch {
        // Ignore malformed local activation state.
    }
    state.license = null;
    return null;
}

export function hasPaidLicense(): boolean {
    const license = state.license || loadLicense();
    if (!license || !license.tier || !licenseTiers[license.tier]) {
        return false;
    }
    if (state.status) {
        return Boolean(state.status.isPaid && !state.status.clockTampered);
    }
    return true;
}

export function checksum(value: string, length: number): string {
    let hash = 2166136261;
    for (const char of value) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(36).toUpperCase().padStart(length, '0').slice(-length);
}

export interface RedeemControllerCallbacks {
    render?: () => void;
    loadStatusData?: () => Promise<void>;
    startChatUsage?: () => void;
    stopChatUsage?: () => void;
    showToast?: (msg: string) => void;
}

export function confirmRedeem(callbacks?: RedeemControllerCallbacks): void {
    const input = document.querySelector<HTMLInputElement>('#redeem-code');
    const code = String(input?.value || '').trim().toUpperCase();
    state.tempRedeemCode = code;
    const result = validateRedeemCode(code);
    state.redeemMessage = '';
    state.redeemError = '';
    if (!result.ok) {
        state.redeemError = result.error || 'Invalid code';
        callbacks?.render?.();
        return;
    }

    state.isActivating = true;
    callbacks?.render?.();

    ActivateLicense(code)
        .then(async () => {
            const redeemedAt = new Date().toISOString();
            if (result.tier) {
                saveLicense({
                    tier: result.tier,
                    codeHash: checksum(`${code}:stored`, 10),
                    redeemedAt,
                    codeDate: result.codeDate,
                });
                state.redeemMessage = `${licenseTiers[result.tier]} activated successfully.`;
            }
            state.tempRedeemCode = '';
            callbacks?.stopChatUsage?.();
            if (callbacks?.loadStatusData) {
                await callbacks.loadStatusData();
            }
        })
        .catch((e: unknown) => {
            state.redeemMessage = '';
            state.redeemError = typeof e === 'string' ? e : 'Activation failed. Please check network and code validity.';
        })
        .finally(() => {
            state.isActivating = false;
            callbacks?.render?.();
        });
}

export function resetLicense(callbacks?: RedeemControllerCallbacks): void {
    const button = document.querySelector<HTMLButtonElement>('#reset-license');
    if (button) button.disabled = true;
    ResetLicense()
        .then(async () => {
            window.localStorage.removeItem(licenseStorageKey);
            state.license = null;
            state.redeemMessage = 'Activation reset on this device.';
            state.redeemError = '';
            if (state.mode === 'chat') {
                callbacks?.startChatUsage?.();
            }
            if (callbacks?.loadStatusData) {
                await callbacks.loadStatusData();
            }
            callbacks?.render?.();
        })
        .catch((e: unknown) => {
            state.redeemError = typeof e === 'string' ? e : 'Failed to reset activation.';
            callbacks?.render?.();
        })
        .finally(() => {
            if (button) button.disabled = false;
        });
}

let lastRefreshTime = 0;
export function triggerManualRefresh(callbacks?: RedeemControllerCallbacks): void {
    const now = Date.now();
    const isOnline = navigator.onLine;
    const minInterval = isOnline ? 30000 : 3000;

    if (now - lastRefreshTime < minInterval) {
        const waitSec = Math.ceil((minInterval - (now - lastRefreshTime)) / 1000);
        const msg = t('refresh_too_fast', { sec: waitSec }) || `Refresh too frequent. Please wait ${waitSec}s.`;
        callbacks?.showToast?.(msg);
        return;
    }

    state.isRefreshingLicense = true;
    callbacks?.render?.();

    RefreshLicenseStatus()
        .then(async (status) => {
            lastRefreshTime = Date.now();
            state.status = status;
            callbacks?.showToast?.(t('refresh_success') || 'License status refreshed successfully.');
        })
        .catch((e: unknown) => {
            lastRefreshTime = Date.now();
            const errMsg = typeof e === 'string' ? e : 'Failed to refresh status.';
            callbacks?.showToast?.(errMsg);
        })
        .finally(() => {
            state.isRefreshingLicense = false;
            callbacks?.render?.();
        });
}
