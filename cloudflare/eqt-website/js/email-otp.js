/**
 * EQT Email OTP Shared Controller Module (js/email-otp.js)
 *
 * Provides unified, robust OTP lifecycle management across Portal Login and Checkout:
 * - Real-time email validation & dynamic button style upgrading
 * - Instant optimistic 60s cooldown feedback & error rollback
 * - Reusable status banner rendering with Material Symbols
 * - Safe friendly error filtering & input shake animations
 * - Verification code rate limiting & multi-language translation integration
 */

(function (window) {
    'use strict';

    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    function isValidEmail(email) {
        return Boolean(email && EMAIL_REGEX.test(String(email).trim()));
    }

    function filterFriendlyMsg(rawMsg, defaultKey, defaultVal, getTranslation) {
        const fallback = typeof getTranslation === 'function' ? getTranslation(defaultKey, defaultVal) : defaultVal;
        if (!rawMsg) return fallback;
        if (/D1_ERROR|SQLITE|UNIQUE constraint|FOREIGN KEY|syntax error|PRIMARYKEY|fatal|exception|stack|trace|TypeError|ReferenceError/i.test(rawMsg)) {
            return fallback;
        }
        return rawMsg;
    }

    function triggerShake(targetEl) {
        if (!targetEl) return;
        targetEl.classList.remove('animate-shake');
        void targetEl.offsetWidth; // Force reflow
        targetEl.classList.add('animate-shake');
        setTimeout(() => {
            targetEl.classList.remove('animate-shake');
        }, 450);
    }

    class EmailOtpController {
        constructor(options = {}) {
            this.endpointSend = options.endpointSend || '/api/v1/auth/send-code';
            this.endpointVerify = options.endpointVerify || '/api/v1/auth/verify-code';
            this.cooldownSeconds = Number(options.cooldownSeconds) || 60;
            this.cooldownRemaining = 0;
            this.cooldownTimer = null;
            this.isSending = false;
            this.isVerifying = false;
            this.btnClasses = options.btnClasses || {
                default: 'bg-white/10 hover:bg-white/20 border border-white/20 text-white/90 px-4 rounded-xl font-medium text-sm transition-all duration-300 active:scale-95 whitespace-nowrap cursor-pointer',
                active: 'bg-primary hover:bg-primary/90 text-background px-4 rounded-xl font-bold text-sm transition-all duration-300 active:scale-95 whitespace-nowrap shadow-md shadow-primary/20 cursor-pointer',
                cooldown: 'bg-white/5 border border-white/10 text-on-surface-variant px-4 rounded-xl font-mono font-bold text-sm transition-all duration-300 cursor-not-allowed opacity-60 whitespace-nowrap',
                loading: 'bg-primary/20 border border-primary/40 text-primary px-4 rounded-xl font-semibold text-sm transition-all duration-300 cursor-wait opacity-90 whitespace-nowrap flex items-center justify-center gap-1.5'
            };
            this.getLang = options.getLang || (() => window.currentLang || localStorage.getItem('eqt-lang') || 'en');
            this.getTranslation = options.getTranslation || ((key, fallback) => fallback);
        }

        translate(key, defaultVal) {
            return this.getTranslation(key, defaultVal);
        }

        updateSendBtn(btn, stateType, customText) {
            if (!btn) return;
            if (this.btnClasses[stateType]) {
                btn.className = this.btnClasses[stateType];
            }
            btn.disabled = (stateType === 'cooldown' || stateType === 'loading');
            if (customText !== undefined && customText !== null) {
                if (btn.textContent !== customText) {
                    btn.textContent = customText;
                }
            }
        }

        syncButtonWithEmail(email, sendBtn, customSendText) {
            if (!sendBtn) return;
            if (this.cooldownRemaining > 0) {
                this.updateSendBtn(sendBtn, 'cooldown', `${this.cooldownRemaining}s`);
                return;
            }
            const sendText = customSendText || this.translate('send_code_btn', 'Send Code');
            if (isValidEmail(email)) {
                this.updateSendBtn(sendBtn, 'active', sendText);
            } else {
                this.updateSendBtn(sendBtn, 'default', sendText);
            }
        }

        startCooldown(seconds, onTick, onComplete) {
            this.cooldownRemaining = Number(seconds) || this.cooldownSeconds;
            if (this.cooldownTimer) clearInterval(this.cooldownTimer);

            if (typeof onTick === 'function') onTick(this.cooldownRemaining);

            this.cooldownTimer = setInterval(() => {
                this.cooldownRemaining--;
                if (this.cooldownRemaining <= 0) {
                    clearInterval(this.cooldownTimer);
                    this.cooldownRemaining = 0;
                    if (typeof onComplete === 'function') onComplete();
                } else {
                    if (typeof onTick === 'function') onTick(this.cooldownRemaining);
                }
            }, 1000);
        }

        cancelCooldown(onCancel) {
            if (this.cooldownTimer) {
                clearInterval(this.cooldownTimer);
                this.cooldownTimer = null;
            }
            this.cooldownRemaining = 0;
            this.isSending = false;
            if (typeof onCancel === 'function') onCancel();
        }

        async sendCode(params = {}) {
            if (this.isSending || this.cooldownRemaining > 0) {
                return { ok: false, aborted: true, cooldown: this.cooldownRemaining > 0 };
            }

            const {
                email = '',
                sendBtn = null,
                emailInput = null,
                codeInput = null,
                apiBase = (window.EQT_API_BASE || window.API_BASE || ''),
                onStatus = null,
                onSuccess = null,
                onError = null
            } = params;

            const trimmedEmail = String(email || '').trim();

            if (!isValidEmail(trimmedEmail)) {
                if (emailInput) triggerShake(emailInput);
                const invalidMsg = this.translate('invalid_email_err', this.translate('toast_enter_valid_email', 'Please enter a valid email address'));
                if (typeof onStatus === 'function') onStatus(invalidMsg, 'error');
                if (emailInput) emailInput.focus();
                return { ok: false, error: invalidMsg };
            }

            this.isSending = true;

            // 1. Instant optimistic feedback: Start 60s cooldown immediately
            this.startCooldown(
                this.cooldownSeconds,
                (rem) => {
                    if (sendBtn) this.updateSendBtn(sendBtn, 'cooldown', `${rem}s`);
                },
                () => {
                    this.isSending = false;
                    const curEmail = emailInput ? emailInput.value : trimmedEmail;
                    this.syncButtonWithEmail(curEmail, sendBtn);
                }
            );

            const sendingMsg = this.translate('sending_code', 'Sending verification code, please wait...');
            if (typeof onStatus === 'function') onStatus(sendingMsg, 'info');

            try {
                const url = `${apiBase}${this.endpointSend}`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: trimmedEmail, lang: this.getLang() })
                });

                let data = {};
                try { data = await res.json(); } catch (_) { data = {}; }

                if (!res.ok) {
                    const err = new Error(data.error || this.translate('send_code_failed', 'Failed to send verification code'));
                    err.status = res.status;
                    err.error_code = data.error_code;
                    throw err;
                }

                const successMsg = `${this.translate('code_sent_success', this.translate('toast_code_sent', 'Verification code sent to your email!'))} (${trimmedEmail})`;
                if (typeof onStatus === 'function') onStatus(successMsg, 'success');

                if (codeInput) {
                    codeInput.disabled = false;
                    codeInput.focus();
                    if (data.code) {
                        codeInput.value = data.code;
                    }
                }

                if (typeof onSuccess === 'function') onSuccess(data);
                return { ok: true, data };

            } catch (err) {
                const errMsg = err.message || '';
                const isRateLimited = err.status === 429 || err.error_code === 'RATE_LIMITED' ||
                    errMsg.includes('60') || errMsg.includes('频繁') || errMsg.includes('frequent') || errMsg.includes('frecuente');
                const isServiceDegraded = err.status === 503 || err.error_code === 'EMAIL_SERVICE_DEGRADED' ||
                    errMsg.includes('temporarily unavailable') || errMsg.includes('暂时不可用');

                if (emailInput) triggerShake(emailInput);
                const defaultFallbackKey = isServiceDegraded ? 'email_service_degraded' : 'send_code_failed';
                const defaultFallbackMsg = isServiceDegraded
                    ? 'Email service is temporarily unavailable. Please try again shortly or contact support.'
                    : 'Failed to send verification code. Please try again later.';
                const safeMsg = filterFriendlyMsg(errMsg, defaultFallbackKey, defaultFallbackMsg, (k, f) => this.translate(k, f));

                if (!isRateLimited) {
                    // Cancel cooldown immediately on actual errors so user can correct and retry
                    this.cancelCooldown(() => {
                        const curEmail = emailInput ? emailInput.value : trimmedEmail;
                        this.syncButtonWithEmail(curEmail, sendBtn);
                    });
                    if (isServiceDegraded) {
                        if (typeof onStatus === 'function') onStatus(safeMsg, 'warning');
                    } else {
                        if (typeof onStatus === 'function') onStatus(safeMsg, 'error');
                    }
                } else {
                    if (typeof onStatus === 'function') onStatus(safeMsg, 'warning');
                }

                if (typeof onError === 'function') onError(err, safeMsg);
                return { ok: false, error: safeMsg, isRateLimited, isServiceDegraded };
            } finally {
                this.isSending = false;
            }
        }

        async verifyCode(params = {}) {
            if (this.isVerifying) return { ok: false, aborted: true };

            const {
                email = '',
                code = '',
                verifyBtn = null,
                codeInput = null,
                emailInput = null,
                apiBase = (window.EQT_API_BASE || window.API_BASE || ''),
                onStatus = null,
                onSuccess = null,
                onError = null
            } = params;

            const trimmedEmail = String(email || '').trim();
            const trimmedCode = String(code || '').trim();

            if (!trimmedCode || !/^\d{6}$/.test(trimmedCode)) {
                if (codeInput) triggerShake(codeInput);
                const invalidCodeMsg = this.translate('invalid_code_err', 'Please enter 6-digit code');
                if (typeof onStatus === 'function') onStatus(invalidCodeMsg, 'error');
                return { ok: false, error: invalidCodeMsg };
            }

            this.isVerifying = true;
            if (verifyBtn) {
                verifyBtn.disabled = true;
            }

            try {
                const url = `${apiBase}${this.endpointVerify}`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: trimmedEmail, code: trimmedCode, lang: this.getLang() })
                });

                let data = {};
                try { data = await res.json(); } catch (_) { data = {}; }

                if (!res.ok) {
                    const err = new Error(data.error || this.translate('verify_failed', 'Verification failed. Please check your code.'));
                    err.status = res.status;
                    err.error_code = data.error_code;
                    throw err;
                }

                if (typeof onSuccess === 'function') onSuccess(data);
                return { ok: true, data };

            } catch (err) {
                if (codeInput) triggerShake(codeInput);
                const safeMsg = filterFriendlyMsg(err.message, 'verify_failed', 'Verification failed. Please check your code.', (k, f) => this.translate(k, f));
                if (typeof onStatus === 'function') onStatus(safeMsg, 'error');
                if (typeof onError === 'function') onError(err, safeMsg);
                return { ok: false, error: safeMsg };
            } finally {
                this.isVerifying = false;
                if (verifyBtn) {
                    verifyBtn.disabled = false;
                }
            }
        }
    }

    // Export module to global namespace
    window.EmailOtp = {
        EMAIL_REGEX,
        isValidEmail,
        filterFriendlyMsg,
        triggerShake,
        Controller: EmailOtpController
    };

})(typeof window !== 'undefined' ? window : this);
