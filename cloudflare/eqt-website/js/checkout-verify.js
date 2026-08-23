/**
 * EQT Checkout Email Verification Module
 * State-driven modular component with dynamic DOM binding, full i18n adaptation,
 * and auto-verification on 6-digit input completion.
 */

(function (window) {
    'use strict';

    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Map a site language value to a Paddle Checkout locale.
    // Adapted site languages keep their own locale; any other language falls
    // back to English so Paddle's partially-translated templates don't mix languages.
    function siteToPaddleLocale(lang) {
        const adapted = ['en', 'ja', 'ko', 'es', 'de', 'fr', 'zh'];
        if (!adapted.includes(lang)) return 'en';
        return lang === 'zh' ? 'zh-Hans' : lang;
    }
    window.siteToPaddleLocale = siteToPaddleLocale;

    const SEND_BTN_CLASSES = {
        default: 'px-4 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 active:scale-95 text-white/90 text-xs font-bold rounded-lg transition-all whitespace-nowrap min-w-[110px] cursor-pointer',
        active: 'px-4 py-2.5 bg-accent-bright hover:bg-accent-bright/90 active:scale-95 text-background text-xs font-bold rounded-lg transition-all whitespace-nowrap min-w-[110px] shadow-lg shadow-accent-bright/25 cursor-pointer',
        cooldown: 'px-4 py-2.5 bg-white/5 border border-white/10 text-on-surface-variant text-xs font-mono font-bold rounded-lg transition-all whitespace-nowrap min-w-[110px] cursor-not-allowed opacity-60',
        loading: 'px-4 py-2.5 bg-accent-bright/20 border border-accent-bright/40 text-accent-bright text-xs font-bold rounded-lg transition-all whitespace-nowrap min-w-[110px] cursor-wait opacity-90 flex items-center justify-center gap-1.5'
    };

    class CheckoutVerifyComponent {
        constructor() {
            if (!window.EmailOtp || !window.EmailOtp.Controller) {
                console.error('[EQT Checkout] Required EmailOtp module (js/email-otp.js) is missing.');
            }
            this.otp = (window.EmailOtp && window.EmailOtp.Controller) ? new window.EmailOtp.Controller({
                endpointSend: '/api/v1/checkout/send-code',
                endpointVerify: '/api/v1/checkout/verify-code',
                cooldownSeconds: 60,
                btnClasses: SEND_BTN_CLASSES,
                getLang: () => this.getLang(),
                getTranslation: (key, fallback) => this.getTranslation(key, fallback)
            }) : null;
            this.pendingPriceId = '';
            this.verifiedEmail = '';
            this.isInitialized = false;
            this.autoVerifyDebounce = null;
            this.lastClickTime = 0;
        }

        getDom() {
            return {
                modal: document.getElementById('verify-email-modal'),
                emailInput: document.getElementById('checkout-email-input'),
                emailErrorMsg: document.getElementById('email-field-error-msg'),
                codeInput: document.getElementById('checkout-code-input'),
                codeErrorMsg: document.getElementById('code-field-error-msg'),
                sendBtn: document.getElementById('send-checkout-code-btn'),
                payBtn: document.getElementById('verify-and-pay-btn'),
                statusCard: document.getElementById('verify-modal-status-msg'),
                closeBtn: document.getElementById('close-verify-modal-btn')
            };
        }

        init() {
            const dom = this.getDom();
            if (!dom.modal) return;
            if (this.isInitialized) return;

            this.bindEvents();
            this.isInitialized = true;
            this.updateButtonState();
        }

        getLang() {
            return window.currentLang || localStorage.getItem('eqt-lang') || 'en';
        }

        // Map the site language selector value to a Paddle Checkout locale.
        toPaddleLocale() {
            return siteToPaddleLocale(this.getLang());
        }

        getTranslation(key, defaultVal) {
            const lang = this.getLang();
            if (window.translations && window.translations[lang] && window.translations[lang][key]) {
                return window.translations[lang][key];
            }
            if (window.translations && window.translations['en'] && window.translations['en'][key]) {
                return window.translations['en'][key];
            }
            return defaultVal;
        }

        bindEvents() {
            const dom = this.getDom();

            // Real-time email input validation
            dom.emailInput?.addEventListener('input', () => this.onEmailInput());
            dom.emailInput?.addEventListener('blur', () => this.onEmailInput());

            // Real-time code validation & auto-verify on 6 digits
            dom.codeInput?.addEventListener('input', () => this.onCodeInput());

            // Send Code button click action with debounce & lock
            dom.sendBtn?.addEventListener('click', (e) => {
                e.preventDefault();
                const now = Date.now();
                if (now - this.lastClickTime < 300) return; // Debounce 300ms
                this.lastClickTime = now;
                this.sendCode();
            });

            // Press Enter to send code in email field
            dom.emailInput?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.sendCode();
                }
            });

            // Press Enter to verify & pay in code field
            dom.codeInput?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.verifyAndPay();
                }
            });

            // Verify & Pay action
            dom.payBtn?.addEventListener('click', (e) => {
                e.preventDefault();
                this.verifyAndPay();
            });

            // Close Modal action
            dom.closeBtn?.addEventListener('click', () => this.close());
        }

        onEmailInput() {
            this.updateButtonState();
        }

        onCodeInput() {
            const dom = this.getDom();
            const code = dom.codeInput ? dom.codeInput.value.trim() : '';

            if (/^\d{6}$/.test(code)) {
                this.hideCodeFieldError();
                // Auto verify on 6-digit complete
                if (this.autoVerifyDebounce) clearTimeout(this.autoVerifyDebounce);
                this.autoVerifyDebounce = setTimeout(() => {
                    this.verifyAndPay();
                }, 200);
            } else if (code.length > 0 && code.length < 6) {
                this.showCodeFieldError(this.getTranslation('invalid_code_err', 'Please enter 6-digit code'));
            } else {
                this.hideCodeFieldError();
            }
        }

        validateEmail() {
            const dom = this.getDom();
            const email = dom.emailInput ? dom.emailInput.value.trim() : '';
            const isValid = window.EmailOtp ? window.EmailOtp.isValidEmail(email) : EMAIL_REGEX.test(email);
            if (!email || !isValid) {
                this.showEmailFieldError(this.getTranslation('invalid_email_err', 'Please enter a valid email address'));
                return false;
            }
            this.hideEmailFieldError();
            return true;
        }

        showEmailFieldError(msg) {
            const dom = this.getDom();
            if (dom.emailErrorMsg) {
                dom.emailErrorMsg.innerHTML = `<span class="material-symbols-outlined text-xs">error</span><span>${msg}</span>`;
                dom.emailErrorMsg.classList.remove('hidden');
            }
            if (dom.emailInput) {
                dom.emailInput.className = 'flex-grow bg-black/40 border border-red-500 ring-2 ring-red-500/20 text-white text-sm rounded-lg px-3 py-2.5 outline-none transition-all';
            }
        }

        hideEmailFieldError() {
            const dom = this.getDom();
            if (dom.emailErrorMsg) {
                dom.emailErrorMsg.classList.add('hidden');
            }
            if (dom.emailInput) {
                dom.emailInput.className = 'flex-grow bg-black/40 border border-emerald-500/60 focus:border-primary text-white text-sm rounded-lg px-3 py-2.5 outline-none transition-all';
            }
        }

        showCodeFieldError(msg) {
            const dom = this.getDom();
            if (dom.codeErrorMsg) {
                dom.codeErrorMsg.innerHTML = `<span class="material-symbols-outlined text-xs">error</span><span>${msg}</span>`;
                dom.codeErrorMsg.classList.remove('hidden');
            }
            if (dom.codeInput) {
                dom.codeInput.className = 'w-full bg-black/40 border border-red-500 ring-2 ring-red-500/20 text-white text-base font-mono font-bold tracking-widest text-center rounded-lg px-3 py-2.5 outline-none transition-all';
            }
        }

        hideCodeFieldError() {
            const dom = this.getDom();
            if (dom.codeErrorMsg) {
                dom.codeErrorMsg.classList.add('hidden');
            }
            if (dom.codeInput) {
                dom.codeInput.className = 'w-full bg-black/40 border border-white/15 focus:border-primary text-white text-base font-mono font-bold tracking-widest text-center rounded-lg px-3 py-2.5 outline-none transition-all';
            }
        }

        updateButtonState() {
            const dom = this.getDom();
            const email = dom.emailInput ? dom.emailInput.value.trim() : '';
            const isValid = window.EmailOtp ? window.EmailOtp.isValidEmail(email) : EMAIL_REGEX.test(email);

            if (this.otp && this.otp.cooldownRemaining > 0) {
                this.otp.updateSendBtn(dom.sendBtn, 'cooldown', `${this.otp.cooldownRemaining}s`);
                return;
            }

            if (!isValid) {
                if (this.otp) this.otp.updateSendBtn(dom.sendBtn, 'default', this.getTranslation('send_code_btn', 'Send Code'));
                if (email.length > 0) {
                    this.showEmailFieldError(this.getTranslation('invalid_email_err', 'Please enter a valid email address'));
                } else {
                    this.hideEmailFieldError();
                }
            } else {
                this.hideEmailFieldError();
                if (this.otp) this.otp.updateSendBtn(dom.sendBtn, 'active', this.getTranslation('send_code_btn', 'Send Code'));
            }
        }

        showStatusCard(msg, isError, statusType) {
            const dom = this.getDom();
            if (!dom.statusCard) return;
            dom.statusCard.style.display = 'block';
            dom.statusCard.classList.remove('hidden');
            const type = statusType || (isError ? 'error' : 'success');
            const iconName = {
                success: 'mark_email_read',
                error: 'gpp_bad',
                warning: 'schedule',
                info: 'hourglass_top'
            }[type] || (isError ? 'gpp_bad' : 'mark_email_read');

            const colorClasses = {
                success: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.2)]',
                error: 'bg-red-500/15 border-red-500/40 text-red-300 shadow-[0_0_15px_rgba(239,68,68,0.2)]',
                warning: 'bg-amber-500/15 border-amber-500/40 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.2)]',
                info: 'bg-blue-500/15 border-blue-500/40 text-blue-300 shadow-[0_0_15px_rgba(59,130,246,0.2)]'
            }[type] || (isError ? 'bg-red-500/15 border-red-500/40 text-red-300' : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300');

            dom.statusCard.innerHTML = `<div class="p-3 rounded-xl border ${colorClasses} text-xs font-medium flex items-center gap-2.5 transition-all duration-300 animate-fadeIn">
                <span class="material-symbols-outlined text-lg shrink-0">${iconName}</span>
                <span class="leading-relaxed text-left flex-1">${msg}</span>
            </div>`;
        }

        triggerShake(targetEl) {
            if (window.EmailOtp && window.EmailOtp.triggerShake) {
                window.EmailOtp.triggerShake(targetEl);
            } else if (targetEl) {
                targetEl.classList.remove('animate-shake');
                void targetEl.offsetWidth;
                targetEl.classList.add('animate-shake');
                setTimeout(() => targetEl.classList.remove('animate-shake'), 450);
            }
        }

        async sendCode() {
            const dom = this.getDom();
            if (!this.otp) {
                this.showStatusCard(this.getTranslation('module_load_err', 'Verification service unavailable. Please refresh the page.'), true, 'error');
                return;
            }
            if (this.otp.isSending || this.otp.cooldownRemaining > 0) return;
            if (!this.validateEmail()) {
                this.triggerShake(dom.emailInput);
                return;
            }

            const email = dom.emailInput ? dom.emailInput.value.trim() : '';
            await this.otp.sendCode({
                email,
                sendBtn: dom.sendBtn,
                emailInput: dom.emailInput,
                codeInput: dom.codeInput,
                apiBase: window.EQT_API_BASE,
                onStatus: (msg, type) => {
                    this.showStatusCard(msg, type === 'error', type);
                }
            });
        }

        async verifyAndPay() {
            if (!this.otp) {
                this.showStatusCard(this.getTranslation('module_load_err', 'Verification service unavailable. Please refresh the page.'), true, 'error');
                return;
            }
            if (this.otp.isVerifying) return;
            if (this.autoVerifyDebounce) {
                clearTimeout(this.autoVerifyDebounce);
                this.autoVerifyDebounce = null;
            }

            const dom = this.getDom();
            if (!this.validateEmail()) {
                this.triggerShake(dom.emailInput);
                return;
            }

            const email = dom.emailInput.value.trim();
            const code = dom.codeInput ? dom.codeInput.value.trim() : '';

            if (!code || !/^\d{6}$/.test(code)) {
                const invalidCodeMsg = this.getTranslation('invalid_code_err', 'Please enter 6-digit code');
                this.showCodeFieldError(invalidCodeMsg);
                this.triggerShake(dom.codeInput);
                this.showStatusCard(invalidCodeMsg, true, 'error');
                return;
            }

            if (dom.payBtn) {
                dom.payBtn.disabled = true;
                dom.payBtn.innerHTML = `<span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></span> <span>${this.getTranslation('verifying_btn', 'Verifying...')}</span>`;
            }

            const res = await this.otp.verifyCode({
                email,
                code,
                verifyBtn: dom.payBtn,
                codeInput: dom.codeInput,
                emailInput: dom.emailInput,
                apiBase: window.EQT_API_BASE,
                onStatus: (msg, type) => {
                    this.showCodeFieldError(msg);
                    this.triggerShake(dom.codeInput);
                    this.showStatusCard(msg, true, 'error');
                },
                onSuccess: () => {
                    this.verifiedEmail = email;
                    this.close();

                    // Open Paddle Checkout with pre-filled verified customer email & customData fallback
                    setTimeout(() => {
                        if (typeof Paddle !== 'undefined') {
                            try {
                                Paddle.Checkout.open({
                                    items: [{ priceId: this.pendingPriceId, quantity: 1 }],
                                    customer: { email: this.verifiedEmail },
                                    customData: { buyer_email: this.verifiedEmail },
                                    settings: { allowLogout: false, locale: this.toPaddleLocale() }
                                });
                            } catch (pErr) {
                                console.error("Paddle Open Error:", pErr);
                                this.open(this.pendingPriceId);
                                this.showStatusCard(this.getTranslation('paddle_loading_err', 'Billing component is loading or blocked by network.'), true, 'error');
                            }
                        } else {
                            this.open(this.pendingPriceId);
                            this.showStatusCard(this.getTranslation('paddle_loading_err', 'Billing component is loading or blocked by network.'), true, 'error');
                        }
                    }, 350);
                }
            });

            if (!res.ok) {
                if (dom.payBtn) {
                    dom.payBtn.disabled = false;
                    dom.payBtn.innerHTML = `<span>${this.getTranslation('verify_and_pay_btn', 'Verify & Proceed to Payment')}</span><span class="material-symbols-outlined text-sm">lock_open</span>`;
                }
            }
        }

        updateI18n() {
            this.updateButtonState();
        }

        open(priceId) {
            this.pendingPriceId = priceId || '';
            const dom = this.getDom();
            this.init();
            if (!dom.modal) return;

            if (dom.statusCard) {
                dom.statusCard.style.display = 'none';
                dom.statusCard.classList.add('hidden');
                dom.statusCard.innerHTML = '';
            }

            this.hideEmailFieldError();
            this.hideCodeFieldError();
            this.updateButtonState();

            dom.modal.classList.remove('hidden');
            setTimeout(() => {
                dom.modal.classList.remove('opacity-0');
                dom.modal.querySelector('.transform')?.classList.remove('scale-95');
                dom.emailInput?.focus();
            }, 50);
        }

        close() {
            if (this.autoVerifyDebounce) {
                clearTimeout(this.autoVerifyDebounce);
                this.autoVerifyDebounce = null;
            }
            if (this.otp) this.otp.isVerifying = false;
            const dom = this.getDom();
            if (!dom.modal) return;
            dom.modal.classList.add('opacity-0');
            dom.modal.querySelector('.transform')?.classList.add('scale-95');
            setTimeout(() => {
                dom.modal.classList.add('hidden');
            }, 300);
        }
    }

    // Single instance export
    window.checkoutVerifyComp = new CheckoutVerifyComponent();

    window.openVerifyModal = function(priceId) {
        window.checkoutVerifyComp.open(priceId);
    };

    window.closeVerifyModal = function() {
        window.checkoutVerifyComp.close();
    };

    document.addEventListener('DOMContentLoaded', () => {
        window.checkoutVerifyComp.init();
    });

})(window);
