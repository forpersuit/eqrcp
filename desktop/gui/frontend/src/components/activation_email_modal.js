// Unified License Activation & Email Ownership Binding Component
// 统一授权激活所有权邮箱确权组件

import { t } from '../i18n.js';
import { SendActivationCode, ActivateLicenseWithEmail } from '../../wailsjs/go/main/App.js';

let cooldownInterval = null;

function escapeHTML(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
    return escapeHTML(str);
}

/**
 * 纯模板渲染函数：渲染所有权邮箱确权与激活模态面板
 * @param {object} state 全局响应式状态
 * @returns {string} 模板 HTML 字符串
 */
export function renderActivationEmailModal(state) {
    const modal = state.activationEmailModal || {};
    const code = modal.licenseCode || '';
    const desc = modal.message || t('bind_email_desc');
    const email = modal.email || '';
    const otp = modal.otpCode || '';
    const cooldown = modal.cooldownSeconds || 0;
    const isSendingOtp = Boolean(modal.sendingOtp);
    const isSubmitting = Boolean(modal.submitting);
    const errorMsg = modal.error || '';
    const noticeMsg = modal.notice || '';

    const sendBtnText = cooldown > 0
        ? `${cooldown}s`
        : (isSendingOtp ? '...' : (t('send_code') || 'Send Code'));

    return `
        <div class="activation-email-panel" style="padding: 16px 20px 20px 20px;">
            <p style="margin: 0 0 14px 0; font-size: 13px; line-height: 1.5; color: var(--text-secondary, #64748b);">
                ${escapeHTML(desc)}
            </p>

            <div style="background: var(--bg-secondary, #f1f5f9); border: 1px solid var(--border-color, #e2e8f0); border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between;">
                <span style="font-size: 12px; font-weight: 600; color: var(--text-muted, #64748b);">${escapeHTML(t('redeem_title') || 'License')}:</span>
                <code style="font-family: monospace; font-size: 13px; font-weight: 700; color: var(--accent, #156f5a);">${escapeHTML(code)}</code>
            </div>

            <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px;">
                <div>
                    <label for="activation-email-input" style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px; color: var(--text-primary, #1e293b);">
                        ${escapeHTML(t('email_address') || 'Email Address')} <span style="color: #ef4444;">*</span>
                    </label>
                    <div style="display: flex; gap: 8px;">
                        <input
                            type="email"
                            id="activation-email-input"
                            class="text-input"
                            style="flex: 1; padding: 8px 12px; border: 1px solid var(--border-color, #cbd5e1); border-radius: 6px; font-size: 13px; background: var(--bg-card, #ffffff); color: var(--text-primary, #0f172a);"
                            placeholder="user@example.com"
                            value="${escapeAttr(email)}"
                            ${isSubmitting || isSendingOtp ? 'disabled' : ''}
                        />
                        <button
                            type="button"
                            id="activation-email-send-btn"
                            class="button secondary"
                            style="min-width: 90px; padding: 8px 12px; font-size: 12px; font-weight: 600; cursor: pointer;"
                            ${cooldown > 0 || isSendingOtp || isSubmitting ? 'disabled' : ''}
                        >
                            ${escapeHTML(sendBtnText)}
                        </button>
                    </div>
                </div>

                <div>
                    <label for="activation-otp-input" style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px; color: var(--text-primary, #1e293b);">
                        ${escapeHTML(t('verification_code') || 'Verification Code')} <span style="color: #ef4444;">*</span>
                    </label>
                    <input
                        type="text"
                        id="activation-otp-input"
                        class="text-input monospace"
                        maxlength="6"
                        style="width: 100%; box-sizing: border-box; padding: 8px 12px; border: 1px solid var(--border-color, #cbd5e1); border-radius: 6px; font-size: 15px; font-family: monospace; letter-spacing: 4px; font-weight: 700; background: var(--bg-card, #ffffff); color: var(--text-primary, #0f172a);"
                        placeholder="123456"
                        value="${escapeAttr(otp)}"
                        ${isSubmitting ? 'disabled' : ''}
                    />
                </div>
            </div>

            ${noticeMsg ? `
                <div class="in-app-notice success" style="margin-bottom: 14px; padding: 10px 12px; border-radius: 6px; font-size: 12px; background: rgba(21, 111, 90, 0.1); color: var(--accent, #156f5a); border: 1px solid rgba(21, 111, 90, 0.3);">
                    ${escapeHTML(noticeMsg)}
                </div>
            ` : ''}

            ${errorMsg ? `
                <div class="in-app-notice error" style="margin-bottom: 14px; padding: 10px 12px; border-radius: 6px; font-size: 12px; background: rgba(239, 68, 68, 0.1); color: #dc2626; border: 1px solid rgba(239, 68, 68, 0.3);">
                    ${escapeHTML(errorMsg)}
                </div>
            ` : ''}

            <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px;">
                <button
                    type="button"
                    id="activation-email-cancel-btn"
                    class="button secondary"
                    style="padding: 8px 16px; font-size: 13px; font-weight: 500; cursor: pointer;"
                >
                    ${escapeHTML(t('cancel') || 'Cancel')}
                </button>
                <button
                    type="button"
                    id="activation-email-submit-btn"
                    class="button primary"
                    style="padding: 8px 18px; font-size: 13px; font-weight: 600; cursor: pointer; background: var(--accent, #156f5a); color: #ffffff; border: none; border-radius: 6px;"
                    ${isSubmitting ? 'disabled' : ''}
                >
                    ${isSubmitting ? '...' : escapeHTML(t('verify_and_activate') || 'Verify & Activate')}
                </button>
            </div>
        </div>
    `;
}

/**
 * Controller: 发送验证码
 */
export async function handleSendActivationCode(state, render) {
    const modal = state.activationEmailModal;
    if (!modal) return;
    const email = (modal.email || '').trim();
    if (!email || !email.includes('@')) {
        modal.error = t('invalid_email') || 'Please enter a valid email address.';
        render();
        return;
    }

    modal.sendingOtp = true;
    modal.error = '';
    modal.notice = '';
    render();

    try {
        await SendActivationCode(modal.licenseCode, email);
        modal.sendingOtp = false;
        modal.notice = t('code_sent_notice') || 'Verification code sent to your email, valid for 5 minutes.';
        modal.cooldownSeconds = 60;
        clearInterval(cooldownInterval);
        cooldownInterval = setInterval(() => {
            if (modal.cooldownSeconds > 0) {
                modal.cooldownSeconds--;
                render();
            } else {
                clearInterval(cooldownInterval);
                render();
            }
        }, 1000);
    } catch (err) {
        modal.sendingOtp = false;
        const msg = String(err?.message || err || '');
        if (msg.includes('RATE_LIMITED') || msg.includes('429')) {
            modal.error = t('refresh_too_fast', { sec: '60' }) || 'Request rate limited. Please wait 60s.';
        } else {
            modal.error = msg || (t('network_unreachable') || 'Failed to send verification code.');
        }
    }
    render();
}

/**
 * Controller: 提交邮箱及验证码完成验证激活
 */
export async function handleSubmitActivationEmail(state, render, onActivated, formatActivationError) {
    const modal = state.activationEmailModal;
    if (!modal) return;
    const email = (modal.email || '').trim();
    const code = (modal.otpCode || '').trim();

    if (!email || !email.includes('@')) {
        modal.error = t('invalid_email') || 'Please enter a valid email address.';
        render();
        return;
    }
    if (!code || code.length < 4) {
        modal.error = t('invalid_code_format') || 'Invalid verification code.';
        render();
        return;
    }

    modal.submitting = true;
    modal.error = '';
    render();

    try {
        const result = await ActivateLicenseWithEmail(modal.licenseCode, email, code);
        cleanupActivationEmailModal(state);
        if (onActivated) {
            await onActivated(result);
        }
    } catch (err) {
        modal.submitting = false;
        if (formatActivationError) {
            modal.error = formatActivationError(err);
        } else {
            modal.error = String(err?.message || err);
        }
        render();
    }
}

/**
 * 清理模态框相关的定时器及状态，防止后台泄漏
 * @param {object} state 全局响应式状态
 */
export function cleanupActivationEmailModal(state) {
    if (cooldownInterval) {
        clearInterval(cooldownInterval);
        cooldownInterval = null;
    }
    if (state && state.activationEmailModal) {
        state.activationEmailModal.sendingOtp = false;
        state.activationEmailModal.submitting = false;
    }
}


