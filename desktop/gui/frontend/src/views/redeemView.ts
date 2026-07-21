import { t } from '../i18n';
import { escapeHTML } from '../utils/domUtils';
import { AppState, LicenseStatus } from '../state';

export interface RedeemViewParams {
    state: AppState;
    hasPaidLicense: () => boolean;
    getLicenseDisplayName: (license: LicenseStatus | null) => string;
    giftIcon: () => string;
}

export function renderRedeemView({
    state,
    hasPaidLicense,
    getLicenseDisplayName,
    giftIcon
}: RedeemViewParams): string {
    const license = state.license;
    let active = t('redeem_no_paid_plan');
    if (hasPaidLicense()) {
        active = t('redeem_active_tier', { tier: getLicenseDisplayName(license) });
    }
    
    let warningBox = '';
    const isPaid = hasPaidLicense();
    if (state.status) {
        if (state.status.clockTampered) {
            active = t('paid_locked_clock');
            warningBox = `
                <div class="notice error compact" style="margin-bottom: 16px; font-size: 13px; line-height: 1.4;">
                    <strong>⚠️ ${t('locked_rollback')}：</strong>
                    ${t('locked_rollback_desc')}
                </div>
            `;
        } else if (license?.tier && !isPaid) {
            active = t('license_locked_limit');
            warningBox = `
                <div class="notice error compact" style="margin-bottom: 16px; font-size: 13px; line-height: 1.4;">
                    <strong>⚠️ ${t('license_verify_failed')}</strong>
                    ${t('license_verify_failed_desc', { tier: getLicenseDisplayName(license) })}
                </div>
            `;
        }
    }

    let resetSection = '';
    if (license?.tier) {
        if (state.confirmResetPending) {
            resetSection = `
                <div class="reset-confirm-box">
                    <div class="reset-confirm-content">
                        <span class="reset-warning-icon">⚠️</span>
                        <div class="reset-confirm-text">
                            <strong>${escapeHTML(t('reset_confirm_title'))}</strong>
                            <span>${escapeHTML(t('reset_confirm_desc'))}</span>
                        </div>
                    </div>
                    <div class="reset-confirm-actions">
                        <button type="button" class="btn-mini primary" id="cancel-reset-license" ${state.isActivating ? 'disabled' : ''}>${escapeHTML(t('btn_cancel'))}</button>
                        <button type="button" class="btn-mini danger-light" id="confirm-reset-license" ${state.isActivating ? 'disabled' : ''}>${escapeHTML(t('btn_confirm_reset'))}</button>
                    </div>
                </div>
            `;
        } else {
            resetSection = `
                <div class="reset-entry-row">
                    <span>${escapeHTML(t('redeem_reset_hint'))}</span>
                    <button type="button" class="btn-link-mini" id="reset-license">${escapeHTML(t('btn_reset'))}</button>
                </div>
            `;
        }
    }

    return `
        <div class="redeem-panel">
            ${warningBox}
            <div class="license-card">
                <strong>${escapeHTML(active)}</strong>
                <span>${license?.redeemedAt ? t('redeemed_at', { date: escapeHTML(new Date(license.redeemedAt).toLocaleString()) }) : t('redeem_desc')}</span>
                ${state.status?.maxDevices ? `<span style="font-size: 11px; margin-top: 4px; opacity: 0.85;">${t('device_limit', { activated: state.status.activatedDevices || 0, max: state.status.maxDevices })}</span>` : ''}
            </div>
            <label>
                ${t('redeem_title')}
                <input id="redeem-code" autocomplete="off" spellcheck="false" placeholder="EQT-PLUS-20260523-XXXX-CHECK" ${state.isActivating ? 'disabled' : ''} value="${escapeHTML(state.tempRedeemCode || '')}" />
            </label>
            <div class="redeem-actions">
                <button class="primary" id="confirm-redeem" ${state.isActivating ? 'disabled' : ''}>
                    <span class="btn-gift-icon" style="margin-right: 6px; display: inline-flex; align-items: center;">${giftIcon()}</span>
                    ${state.isActivating ? t('btn_activating') : t('btn_confirm')}
                </button>
            </div>
            ${resetSection}
            ${!state.isActivating && state.redeemMessage ? `<div class="notice success compact">${escapeHTML(state.redeemMessage)}</div>` : ''}
            ${!state.isActivating && state.redeemError ? `<div class="notice error compact">${escapeHTML(state.redeemError)}</div>` : ''}
        </div>
    `;
}
