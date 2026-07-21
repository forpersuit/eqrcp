/**
 * EQT Checkout Email Verification Module
 * State-driven modular component with dynamic DOM binding, full i18n adaptation,
 * and auto-verification on 6-digit input completion.
 */

(function (window) {
    'use strict';

    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    class CheckoutVerifyComponent {
        constructor() {
            this.cooldownTimer = null;
            this.cooldownRemaining = 0;
            this.pendingPriceId = '';
            this.verifiedEmail = '';
            this.isInitialized = false;
            this.autoVerifyDebounce = null;
            this.isSending = false;
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
            if (!email || !EMAIL_REGEX.test(email)) {
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
            const isValid = EMAIL_REGEX.test(email);

            if (this.isSending) return;

            if (this.cooldownRemaining > 0) {
                if (dom.sendBtn) {
                    dom.sendBtn.disabled = true;
                    dom.sendBtn.className = 'px-4 py-2.5 bg-white/5 text-on-surface-variant text-xs font-mono font-bold rounded-lg transition-all whitespace-nowrap min-w-[110px] cursor-not-allowed opacity-60';
                    dom.sendBtn.textContent = `${this.cooldownRemaining}s`;
                }
                return;
            }

            if (!isValid) {
                // Allow button click to trigger validate email warning if email is entered
                if (dom.sendBtn) {
                    dom.sendBtn.disabled = false;
                    dom.sendBtn.className = 'px-4 py-2.5 bg-white/10 hover:bg-white/20 active:scale-95 text-primary text-xs font-bold rounded-lg transition-all whitespace-nowrap min-w-[110px] cursor-pointer';
                    dom.sendBtn.innerHTML = `<span>${this.getTranslation('send_code_btn', 'Send Code')}</span>`;
                }
                if (email.length > 0) {
                    this.showEmailFieldError(this.getTranslation('invalid_email_err', 'Please enter a valid email address'));
                } else {
                    this.hideEmailFieldError();
                }
            } else {
                // Valid email format: enable button with high-contrast primary glow
                this.hideEmailFieldError();
                if (dom.sendBtn) {
                    dom.sendBtn.disabled = false;
                    dom.sendBtn.className = 'px-4 py-2.5 bg-primary hover:bg-primary/90 active:scale-95 text-surface-dim text-xs font-bold rounded-lg transition-all whitespace-nowrap min-w-[110px] shadow-lg shadow-primary/25 cursor-pointer';
                    dom.sendBtn.innerHTML = `<span>${this.getTranslation('send_code_btn', 'Send Code')}</span>`;
                }
            }
        }

        showStatusCard(msg, isError) {
            const dom = this.getDom();
            if (!dom.statusCard) return;
            dom.statusCard.style.display = 'block';
            dom.statusCard.classList.remove('hidden');
            const iconName = isError ? 'gpp_bad' : 'mark_email_read';
            const colorClasses = isError
                ? 'bg-red-500/15 border-red-500/40 text-red-300 shadow-[0_0_15px_rgba(239,68,68,0.2)]'
                : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.2)]';

            dom.statusCard.innerHTML = `<div class="p-3 rounded-xl border ${colorClasses} text-xs font-medium flex items-center gap-2.5 transition-all duration-300 animate-fadeIn">
                <span class="material-symbols-outlined text-lg shrink-0">${iconName}</span>
                <span class="leading-relaxed text-left flex-1">${msg}</span>
            </div>`;
        }

        triggerShake(targetEl) {
            if (!targetEl) return;
            targetEl.classList.remove('animate-shake');
            void targetEl.offsetWidth; // Force reflow
            targetEl.classList.add('animate-shake');
            setTimeout(() => {
                targetEl.classList.remove('animate-shake');
            }, 450);
        }

        filterFriendlyMsg(rawMsg, defaultKey, defaultVal) {
            if (!rawMsg) return this.getTranslation(defaultKey, defaultVal);
            if (/D1_ERROR|SQLITE|UNIQUE constraint|FOREIGN KEY|syntax error|PRIMARYKEY|fatal|exception|stack|trace|TypeError|ReferenceError/i.test(rawMsg)) {
                return this.getTranslation(defaultKey, defaultVal);
            }
            return rawMsg;
        }

        async sendCode() {
            const dom = this.getDom();
            if (this.isSending) return;
            if (!this.validateEmail()) {
                this.triggerShake(dom.emailInput);
                return;
            }

            const email = dom.emailInput.value.trim();
            this.isSending = true;

            if (dom.sendBtn) {
                dom.sendBtn.disabled = true;
                dom.sendBtn.className = 'px-4 py-2.5 bg-primary/20 text-primary text-xs font-bold rounded-lg transition-all whitespace-nowrap min-w-[110px] cursor-wait opacity-80 flex items-center justify-center';
                dom.sendBtn.innerHTML = `<span class="inline-block w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin mr-1.5"></span> <span>${this.getTranslation('sending_code', 'Sending...')}</span>`;
            }

            try {
                const res = await fetch('https://lic.eqt.net.im/api/v1/checkout/send-code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, lang: this.getLang() })
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.error || this.getTranslation('send_code_failed', 'Failed to send verification code'));
                }

                this.showStatusCard(this.getTranslation('code_sent_success', 'Verification code sent to your email! Please check your inbox.'), false);
                this.startCooldown(60);
                dom.codeInput?.focus();
            } catch (err) {
                this.triggerShake(dom.emailInput);
                const safeMsg = this.filterFriendlyMsg(err.message, 'send_code_failed', 'Failed to send verification code. Please try again later.');
                this.showStatusCard(safeMsg, true);
                this.cooldownRemaining = 0;
                this.isSending = false;
                this.updateButtonState();
            } finally {
                this.isSending = false;
            }
        }

        startCooldown(seconds) {
            this.cooldownRemaining = seconds;
            this.updateButtonState();

            if (this.cooldownTimer) clearInterval(this.cooldownTimer);

            this.cooldownTimer = setInterval(() => {
                this.cooldownRemaining--;
                if (this.cooldownRemaining <= 0) {
                    clearInterval(this.cooldownTimer);
                    this.cooldownRemaining = 0;
                }
                this.updateButtonState();
            }, 1000);
        }

        async verifyAndPay() {
            const dom = this.getDom();
            if (!this.validateEmail()) {
                this.triggerShake(dom.emailInput);
                return;
            }

            const email = dom.emailInput.value.trim();
            const code = dom.codeInput ? dom.codeInput.value.trim() : '';

            if (!code || code.length !== 6) {
                this.showCodeFieldError(this.getTranslation('invalid_code_err', 'Please enter 6-digit code'));
                this.triggerShake(dom.codeInput);
                this.showStatusCard(this.getTranslation('invalid_code_err', 'Please enter 6-digit code'), true);
                return;
            }

            if (dom.payBtn) {
                dom.payBtn.disabled = true;
                dom.payBtn.innerHTML = `<span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></span> <span>${this.getTranslation('verifying_btn', 'Verifying...')}</span>`;
            }

            try {
                const res = await fetch('https://lic.eqt.net.im/api/v1/checkout/verify-code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, code })
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.error || this.getTranslation('verify_failed', 'Verification failed. Please check your code.'));
                }

                this.verifiedEmail = email;
                this.close();

                // Open Paddle Checkout with pre-filled verified customer email & customData fallback
                setTimeout(() => {
                    if (typeof Paddle !== 'undefined') {
                        if (typeof window.initPaddle === 'function') {
                            window.initPaddle();
                        }
                        try {
                            Paddle.Checkout.open({
                                items: [{ priceId: this.pendingPriceId, quantity: 1 }],
                                customer: { email: this.verifiedEmail },
                                customData: { buyer_email: this.verifiedEmail }
                            });
                        } catch (pErr) {
                            console.error("Paddle Open Error:", pErr);
                            this.open(this.pendingPriceId);
                            this.showStatusCard(this.getTranslation('paddle_loading_err', 'Billing component is loading or blocked by network.'), true);
                        }
                    } else {
                        this.open(this.pendingPriceId);
                        this.showStatusCard(this.getTranslation('paddle_loading_err', 'Billing component is loading or blocked by network.'), true);
                    }
                }, 350);

            } catch (err) {
                const safeMsg = this.filterFriendlyMsg(err.message, 'verify_failed', 'Verification failed. Please check your code.');
                this.showCodeFieldError(safeMsg);
                this.triggerShake(dom.codeInput);
                this.showStatusCard(safeMsg, true);
            } finally {
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
