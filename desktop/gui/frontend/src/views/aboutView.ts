import { state } from '../state';
import { t } from '../i18n';

export function renderAboutView(helpers: {
    loadLicense: () => any;
    getLicenseDisplayName: (license: any) => string;
    chatQuotaText: () => string;
    escapeHTML: (val: unknown) => string;
    horizontalLogoURL: string;
    sparklesIcon: () => string;
}): string {
    const { loadLicense, getLicenseDisplayName, chatQuotaText, escapeHTML, horizontalLogoURL, sparklesIcon } = helpers;
    const info = state.appInfo || {};
    const license = state.license || loadLicense();
    let plan = '';
    if (license?.tier) {
        if (license.tier === 'PLUS' && (license.codeDate === 'LIFETIME' || state.status?.licenseExpiresAt === 'LIFETIME')) {
            plan = 'PLUS U';
        } else {
            plan = license.tier.toUpperCase();
        }
    } else {
        plan = t('free_quota');
    }
    const expiresAt = state.status?.licenseExpiresAt || license?.codeDate;
    let expiryText = '';
    if (expiresAt && expiresAt !== 'LIFETIME' && expiresAt !== 'n/a') {
        const expiryDate = new Date(expiresAt).getTime();
        const now = new Date().getTime();
        const diffMs = expiryDate - now;
        if (diffMs <= 0) {
            expiryText = t('license_expired');
        } else {
            const diffSecs = Math.floor(diffMs / 1000);
            if (diffSecs < 60) {
                expiryText = t('license_expires_in_secs', { secs: diffSecs });
            } else if (diffSecs < 3600) {
                const mins = Math.floor(diffSecs / 60);
                const secs = diffSecs % 60;
                expiryText = t('license_expires_in_mins', { mins, secs });
            } else if (diffSecs < 86400) {
                const hrs = Math.floor(diffSecs / 3600);
                expiryText = t('license_expires_in_hours', { hours: hrs });
            } else {
                const days = Math.ceil(diffSecs / 86400);
                expiryText = t('license_expires_in_days', { days });
            }
        }
    }

    let redeemDetail = '';
    let expiryDetail = '';
    if (license?.redeemedAt) {
        redeemDetail = `${t('redeemed_at', { date: new Date(license.redeemedAt).toLocaleDateString() })}`;
        let expVal = '';
        if (expiresAt === 'LIFETIME') {
            expVal = t('lifetime') || '永久';
        } else if (expiresAt) {
            try {
                expVal = new Date(expiresAt).toLocaleDateString();
            } catch {
                expVal = String(expiresAt);
            }
        }
        if (expVal) {
            expiryDetail = (t as any)('expires_at', { date: expVal }) || `Expires: ${expVal}`;
        }
    } else if (license?.tier) {
        redeemDetail = `${t('plan_label')}: ${getLicenseDisplayName(license)}`;
    } else {
        redeemDetail = chatQuotaText();
    }

    if (state.status?.isLicenseLocked) {
        const reason = state.status.licenseLockReason;
        if (reason === 'rollback') {
            redeemDetail = t('locked_rollback');
        } else if (reason === 'clock') {
            redeemDetail = (t as any)('locked_clock') || 'Clock tampering detected.';
        } else if (reason === 'hw_mismatch') {
            redeemDetail = (t as any)('locked_hw') || 'Hardware mismatch.';
        } else {
            redeemDetail = t('license_locked_server');
        }
        plan = (t as any)('license_locked_tag') || 'LOCKED';
        expiryText = '';
        expiryDetail = '';
    }

    return `
        <div class="about-panel">
            <div class="about-hero-card">
                <div class="about-brand">
                    <img src="${horizontalLogoURL}" alt="EQT Logo" class="about-logo" />
                </div>
                <div class="about-plan-badge">
                    <span class="badge-tag">${escapeHTML(plan)}</span>
                    ${expiryText ? `<span class="badge-sub">${escapeHTML(expiryText)}</span>` : ''}
                </div>
                <div class="about-license-meta">
                    ${redeemDetail ? `<small>${escapeHTML(redeemDetail)}</small>` : ''}
                    ${expiryDetail ? `<small style="margin-left: 8px;">${escapeHTML(expiryDetail)}</small>` : ''}
                </div>
            </div>

            <div class="about-actions-row">
                <button type="button" class="btn-mini primary" id="about-open-plans">${sparklesIcon()} ${(t as any)('compare_plans') || '方案对比'}</button>
            </div>
            
            <section class="about-section">
                <div class="about-row">
                    <span>${(t as any)('version_title') || 'Version'}</span>
                    <strong>${info.version || 'v1.0.0'}</strong>
                </div>
                <div class="about-row">
                    <span>${(t as any)('product_name') || 'Product'}</span>
                    <strong>${info.product || 'Easy QR Transfer'}</strong>
                </div>
                <div class="about-row">
                    <span>${(t as any)('copyright') || 'Copyright'}</span>
                    <strong>© 2026 EQT Team. All rights reserved.</strong>
                </div>
            </section>
        </div>
    `;
}
