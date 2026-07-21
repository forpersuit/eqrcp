import { state } from '../state';
import { t } from '../i18n';

export const licenseStorageKey = 'eqt_license_v1';

export function saveLicense(license: Record<string, unknown> | null): void {
    state.license = license;
    if (license) {
        window.localStorage.setItem(licenseStorageKey, JSON.stringify(license));
    } else {
        window.localStorage.removeItem(licenseStorageKey);
    }
}

export function validateRedeemCode(code: string): { ok: boolean; tier?: string; codeDate?: string; error?: string } {
    const raw = String(code || '').trim().toUpperCase();
    if (!raw) {
        return { ok: false, error: t('redeem_empty') || 'Please enter activation code.' };
    }
    const match = raw.match(/^EQT-(PLUS|PRO)-(\d{8})-[A-Z0-9]{4}-CHECK$/);
    if (!match) {
        return { ok: false, error: t('redeem_invalid_format') || 'Invalid code format. Expected: EQT-PLUS-YYYYMMDD-XXXX-CHECK' };
    }
    return {
        ok: true,
        tier: match[1].toLowerCase(),
        codeDate: match[2],
    };
}
