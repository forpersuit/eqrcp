/**
 * EQT Checkout Email Verification Module
 * State-driven modular component for purchase pre-verification.
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
        }

        init() {
            this.dom = {
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

            if (!this.dom.modal) return;

            this.bindEvents();
            this.updateButtonState();
        }

        getLang() {
            return localStorage.getItem('eqt-lang') || 'en';
        }

        getTranslation(key, defaultVal) {
            const lang = this.getLang();
            if (window.translations && window.translations[lang] && window.translations[lang][key]) {
                return window.translations[lang][key];
            }
            return defaultVal;
        }

        bindEvents() {
            // Real-time email validation
            this.dom.emailInput?.addEventListener('input', () => this.onEmailInput());
            this.dom.emailInput?.addEventListener('blur', () => this.onEmailInput());

            // Real-time code validation
            this.dom.codeInput?.addEventListener('input', () => this.onCodeInput());

            // Send Code action
            this.dom.sendBtn?.addEventListener('click', () => this.sendCode());

            // Verify & Pay action
            this.dom.payBtn?.addEventListener('click', () => this.verifyAndPay());

            // Close Modal action
            this.dom.closeBtn?.addEventListener('click', () => this.close());
        }

        onEmailInput() {
            this.updateButtonState();
        }

        onCodeInput() {
            const code = this.dom.codeInput ? this.dom.codeInput.value.trim() : '';
            if (code.length > 0 && code.length < 6) {
                this.showCodeFieldError(this.getTranslation('invalid_code_err', 'Please enter 6-digit code'));
            } else {
                this.hideCodeFieldError();
            }
        }

        validateEmail() {
            const email = this.dom.emailInput ? this.dom.emailInput.value.trim() : '';
            if (!email || !EMAIL_REGEX.test(email)) {
                this.showEmailFieldError(this.getTranslation('invalid_email_err', 'Please enter a valid email address'));
                return false;
            }
            this.hideEmailFieldError();
            return true;
        }

        showEmailFieldError(msg) {
            if (this.dom.emailErrorMsg) {
                this.dom.emailErrorMsg.innerHTML = `<span class="material-symbols-outlined text-xs">error</span><span>${msg}</span>`;
                this.dom.emailErrorMsg.classList.remove('hidden');
            }
            if (this.dom.emailInput) {
                this.dom.emailInput.className = 'flex-grow bg-black/40 border border-red-500 ring-2 ring-red-500/20 text-white text-sm rounded-lg px-3 py-2.5 outline-none transition-all';
            }
        }

        hideEmailFieldError() {
            if (this.dom.emailErrorMsg) {
                this.dom.emailErrorMsg.classList.add('hidden');
            }
            if (this.dom.emailInput) {
                this.dom.emailInput.className = 'flex-grow bg-black/40 border border-emerald-500/60 focus:border-primary text-white text-sm rounded-lg px-3 py-2.5 outline-none transition-all';
            }
        }

        showCodeFieldError(msg) {
            if (this.dom.codeErrorMsg) {
                this.dom.codeErrorMsg.innerHTML = `<span class="material-symbols-outlined text-xs">error</span><span>${msg}</span>`;
                this.dom.codeErrorMsg.classList.remove('hidden');
            }
            if (this.dom.codeInput) {
                this.dom.codeInput.className = 'w-full bg-black/40 border border-red-500 ring-2 ring-red-500/20 text-white text-base font-mono font-bold tracking-widest text-center rounded-lg px-3 py-2.5 outline-none transition-all';
            }
        }

        hideCodeFieldError() {
            if (this.dom.codeErrorMsg) {
                this.dom.codeErrorMsg.classList.add('hidden');
            }
            if (this.dom.codeInput) {
                this.dom.codeInput.className = 'w-full bg-black/40 border border-white/15 focus:border-primary text-white text-base font-mono font-bold tracking-widest text-center rounded-lg px-3 py-2.5 outline-none transition-all';
            }
        }

        updateButtonState() {
            const email = this.dom.emailInput ? this.dom.emailInput.value.trim() : '';
            const isValid = EMAIL_REGEX.test(email);

            if (this.cooldownRemaining > 0) {
                // In cooldown
                if (this.dom.sendBtn) {
                    this.dom.sendBtn.disabled = true;
                    this.dom.sendBtn.className = 'px-4 py-2.5 bg-white/5 text-on-surface-variant text-xs font-mono font-bold rounded-lg transition-all whitespace-nowrap min-w-[110px] cursor-not-allowed opacity-60';
                    this.dom.sendBtn.textContent = `${this.cooldownRemaining}s`;
                }
                return;
            }

            if (!isValid) {
                // Invalid email - disable send button (置灰不可点击)
                if (this.dom.sendBtn) {
                    this.dom.sendBtn.disabled = true;
                    this.dom.sendBtn.className = 'px-4 py-2.5 bg-white/5 text-white/30 text-xs font-bold rounded-lg transition-all whitespace-nowrap min-w-[110px] cursor-not-allowed opacity-50 border border-white/5';
                    this.dom.sendBtn.innerHTML = `<span>${this.getTranslation('send_code_btn', 'Send Code')}</span>`;
                }
                if (email.length > 0) {
                    this.showEmailFieldError(this.getTranslation('invalid_email_err', 'Please enter a valid email address'));
                } else {
                    this.hideEmailFieldError();
                }
            } else {
                // Valid email - enable send button with high-contrast primary glow (高亮可用)
                this.hideEmailFieldError();
                if (this.dom.sendBtn) {
                    this.dom.sendBtn.disabled = false;
                    this.dom.sendBtn.className = 'px-4 py-2.5 bg-primary hover:bg-primary/90 active:scale-95 text-surface-dim text-xs font-bold rounded-lg transition-all whitespace-nowrap min-w-[110px] shadow-lg shadow-primary/25 cursor-pointer';
                    this.dom.sendBtn.innerHTML = `<span>${this.getTranslation('send_code_btn', 'Send Code')}</span>`;
                }
            }
        }

        showStatusCard(msg, isError) {
            if (!this.dom.statusCard) return;
            this.dom.statusCard.style.display = 'block';
            this.dom.statusCard.classList.remove('hidden');
            const iconName = isError ? 'gpp_bad' : 'mark_email_read';
            const colorClasses = isError
                ? 'bg-red-500/15 border-red-500/40 text-red-300 shadow-[0_0_15px_rgba(239,68,68,0.2)]'
                : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.2)]';

            this.dom.statusCard.innerHTML = `<div class="p-3 rounded-xl border ${colorClasses} text-xs font-medium flex items-center gap-2.5 transition-all duration-300 animate-fadeIn">
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

        async sendCode() {
            if (!this.validateEmail()) {
                this.triggerShake(this.dom.emailInput);
                return;
            }

            const email = this.dom.emailInput.value.trim();

            if (this.dom.sendBtn) {
                this.dom.sendBtn.disabled = true;
                this.dom.sendBtn.className = 'px-4 py-2.5 bg-primary/20 text-primary text-xs font-bold rounded-lg transition-all whitespace-nowrap min-w-[110px] cursor-wait opacity-80 flex items-center justify-center';
                this.dom.sendBtn.innerHTML = `<span class="inline-block w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin mr-1.5"></span> <span>${this.getTranslation('sending_code', 'Sending...')}</span>`;
            }

            try {
                const res = await fetch('https://lic.eqt.net.im/api/v1/checkout/send-code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, lang: this.getLang() })
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.error || 'Failed to send verification code');
                }

                this.showStatusCard(this.getTranslation('code_sent_success', 'Verification code sent to your email! Please check your inbox.'), false);
                this.startCooldown(60);
            } catch (err) {
                this.triggerShake(this.dom.emailInput);
                this.showStatusCard(err.message, true);
                this.cooldownRemaining = 0;
                this.updateButtonState();
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
            if (!this.validateEmail()) {
                this.triggerShake(this.dom.emailInput);
                return;
            }

            const email = this.dom.emailInput.value.trim();
            const code = this.dom.codeInput ? this.dom.codeInput.value.trim() : '';

            if (!code || code.length !== 6) {
                this.showCodeFieldError(this.getTranslation('invalid_code_err', 'Please enter 6-digit code'));
                this.triggerShake(this.dom.codeInput);
                this.showStatusCard(this.getTranslation('invalid_code_err', 'Please enter 6-digit code'), true);
                return;
            }

            if (this.dom.payBtn) {
                this.dom.payBtn.disabled = true;
                this.dom.payBtn.innerHTML = `<span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></span> <span>${this.getTranslation('verifying_btn', 'Verifying...')}</span>`;
            }

            try {
                const res = await fetch('https://lic.eqt.net.im/api/v1/checkout/verify-code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, code })
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.error || 'Verification failed. Please check your code.');
                }

                this.verifiedEmail = email;
                this.close();

                // Proceed to Paddle Checkout with pre-filled verified customer email
                setTimeout(() => {
                    if (typeof Paddle !== 'undefined') {
                        Paddle.Checkout.open({
                            items: [{ priceId: this.pendingPriceId, quantity: 1 }],
                            customer: { email: this.verifiedEmail }
                        });
                    } else {
                        this.showStatusCard('Billing component is loading or blocked by network.', true);
                    }
                }, 350);

            } catch (err) {
                this.showCodeFieldError(err.message);
                this.triggerShake(this.dom.codeInput);
                this.showStatusCard(err.message, true);
            } finally {
                if (this.dom.payBtn) {
                    this.dom.payBtn.disabled = false;
                    this.dom.payBtn.innerHTML = `<span>${this.getTranslation('verify_and_pay_btn', 'Verify & Proceed to Payment')}</span><span class="material-symbols-outlined text-sm">lock_open</span>`;
                }
            }
        }

        open(priceId) {
            this.pendingPriceId = priceId || '';
            if (!this.dom.modal) this.init();
            if (!this.dom.modal) return;

            if (this.dom.statusCard) {
                this.dom.statusCard.style.display = 'none';
                this.dom.statusCard.classList.add('hidden');
                this.dom.statusCard.innerHTML = '';
            }

            this.hideEmailFieldError();
            this.hideCodeFieldError();
            this.updateButtonState();

            this.dom.modal.classList.remove('hidden');
            setTimeout(() => {
                this.dom.modal.classList.remove('opacity-0');
                this.dom.modal.querySelector('.transform')?.classList.remove('scale-95');
                this.dom.emailInput?.focus();
            }, 50);
        }

        close() {
            if (!this.dom.modal) return;
            this.dom.modal.classList.add('opacity-0');
            this.dom.modal.querySelector('.transform')?.classList.add('scale-95');
            setTimeout(() => {
                this.dom.modal.classList.add('hidden');
            }, 300);
        }
    }

    // Export singleton instance
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
