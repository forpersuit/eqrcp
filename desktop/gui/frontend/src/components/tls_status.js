// 局域网 TLS 状态指示与协议徽章独立模块 (LAN-TLS Status & Security Badges Component)

/**
 * 渲染精致矢量锁 SVG 图标
 * @param {object} options
 * @param {string} [options.color] 描边颜色（默认品牌主题色 var(--accent, #156f5a)）
 * @param {number} [options.size] 尺寸（像素）
 * @param {boolean} [options.open] 是否为开锁状态
 * @param {string} [options.className] 附加 CSS 类名
 * @returns {string} SVG HTML 片段
 */
export function renderLockSvg({ color = 'var(--accent, #156f5a)', size = 13, open = false, className = '' } = {}) {
    const strokeColor = color || 'currentColor';
    const shacklePath = open
        ? 'M7 11V7a5 5 0 0 1 9.9-1'
        : 'M7 11V7a5 5 0 0 1 10 0v4';
    return `<svg class="tls-svg-icon tls-lock-icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; display: inline-block;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="${shacklePath}"></path></svg>`;
}

/**
 * 渲染精致矢量警告 SVG 图标
 * @param {object} options
 * @param {string} [options.color] 描边颜色（默认 #d97706 或 var(--text-muted)）
 * @param {number} [options.size] 尺寸（像素）
 * @param {string} [options.className] 附加 CSS 类名
 * @returns {string} SVG HTML 片段
 */
export function renderAlertSvg({ color = '#d97706', size = 13, className = '' } = {}) {
    const strokeColor = color || 'currentColor';
    return `<svg class="tls-svg-icon tls-alert-icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; display: inline-block;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
}

/**
 * 渲染精致矢量旋转加载 SVG 图标
 * @param {object} options
 * @param {string} [options.color] 描边颜色
 * @param {number} [options.size] 尺寸（像素）
 * @param {string} [options.className] 附加 CSS 类名
 * @returns {string} SVG HTML 片段
 */
export function renderSpinnerSvg({ color = 'var(--accent, #156f5a)', size = 13, className = '' } = {}) {
    const strokeColor = color || 'currentColor';
    return `<svg class="tls-svg-icon tls-spinner-icon rotating-spin ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round" style="vertical-align: -2px; display: inline-block;"><circle cx="12" cy="12" r="9" stroke-opacity="0.25"></circle><path d="M12 3a9 9 0 0 1 9 9"></path></svg>`;
}

/**
 * 计算当前系统 TLS 状态
 * @param {object} state 全局状态对象
 * @returns {'disabled' | 'ready' | 'mismatch' | 'failed' | 'preparing'}
 */
export function getTLSState(state) {
    if (!Boolean(state?.settings?.enableTLS)) {
        return 'disabled';
    }
    if (state?.appInfo?.hasValidTLSCert) {
        return 'ready';
    }
    if (state?.tlsKeyMismatch) {
        return 'mismatch';
    }
    if (state?.tlsProvisionFailed || (state?.appInfo?.tlsError && !state?.tlsProvisioning)) {
        return 'failed';
    }
    return 'preparing';
}

/**
 * 渲染设置面板中启用 TLS 开关旁边的状态图标
 * 状态为 ready 时使用品牌主题色锁；未开启/关闭时使用灰色样式锁；告警/置备中使用对应状态图标
 * @param {object} state 全局状态对象
 * @param {Function} t 国际化翻译函数
 * @param {Function} escapeAttr 属性转义函数
 * @returns {string} 图标 HTML
 */
export function renderTLSSettingIcon(state, t, escapeAttr) {
    const status = getTLSState(state);
    switch (status) {
        case 'ready':
            return `<span class="tls-status-icon ready" role="img" aria-label="${escapeAttr(t('tls_cert_ready'))}" title="${escapeAttr(t('tls_cert_ready'))}" style="margin-left: 6px; display: inline-flex; align-items: center;">${renderLockSvg({ color: 'var(--accent, #156f5a)', size: 14 })}</span>`;
        case 'mismatch':
            return `<span class="tls-status-icon mismatch" role="img" aria-label="${escapeAttr(state?.tlsKeyMismatchMsg || t('tls_key_mismatch_msg'))}" title="${escapeAttr(state?.tlsKeyMismatchMsg || t('tls_key_mismatch_msg'))}" style="margin-left: 6px; display: inline-flex; align-items: center; cursor: help;">${renderAlertSvg({ color: '#d97706', size: 14 })}</span>`;
        case 'failed': {
            const err = state?.tlsProvisionError || state?.appInfo?.tlsError || '';
            const isRateLimit = err && (err.includes('rate limit') || err.includes('429') || err.includes('Too Many Requests'));
            const fallbackTooltip = isRateLimit ? t('tls_cert_rate_limited') : t('tls_cert_failed_tooltip');
            const tooltip = (fallbackTooltip || '证书置备遇到异常（已自动降级为明文传输保障传输），点击查看详情或重试') + (err ? ` [${err}]` : '');
            return `<span class="tls-status-icon failed" role="img" aria-label="${escapeAttr(tooltip)}" title="${escapeAttr(tooltip)}" style="margin-left: 6px; display: inline-flex; align-items: center; cursor: help;">${renderAlertSvg({ color: '#d97706', size: 14 })}</span>`;
        }
        case 'preparing':
            return `<span class="tls-status-icon preparing" role="img" aria-label="${escapeAttr(t('tls_cert_preparing'))}" title="${escapeAttr(t('tls_cert_preparing'))}" style="margin-left: 6px; display: inline-flex; align-items: center;">${renderSpinnerSvg({ color: 'var(--accent, #156f5a)', size: 14 })}</span>`;
        case 'disabled':
        default: {
            const lastErr = state?.tlsProvisionError || state?.appInfo?.tlsError;
            if (lastErr && state?.tlsProvisionFailed) {
                const tooltip = (t('tls_failed_auto_disabled') || '证书置备遇到异常，已自动关闭局域网 TLS 并保持标准明文传输') + ` [${lastErr}]`;
                return `<span class="tls-status-icon disabled" role="img" aria-label="${escapeAttr(tooltip)}" title="${escapeAttr(tooltip)}" style="margin-left: 6px; display: inline-flex; align-items: center; cursor: help;">${renderLockSvg({ color: 'var(--text-muted, #94a3b8)', size: 14, open: true })}</span>`;
            }
            return `<span class="tls-status-icon disabled" role="img" aria-label="${escapeAttr(t('tls_disabled_tooltip'))}" title="${escapeAttr(t('tls_disabled_tooltip'))}" style="margin-left: 6px; display: inline-flex; align-items: center; opacity: 0.75;">${renderLockSvg({ color: 'var(--text-muted, #94a3b8)', size: 14, open: true })}</span>`;
        }
    }
}

/**
 * 渲染开发者选项中 LAN-TLS Certificate Debug 状态文本
 * @param {object} state 全局状态对象
 * @param {Function} t 国际化翻译函数
 * @returns {string} 状态展示文本
 */
export function getDevTLSStatusText(state, t) {
    if (state?.appInfo?.hasValidTLSCert) {
        return '[Ready] ' + (t('tls_cert_ready') || 'Ready');
    }
    if (state?.tlsProvisioning || state?.devProvisioningTLS) {
        return '[Preparing] ' + (t('tls_cert_preparing') || 'Preparing...');
    }
    if (state?.tlsKeyMismatch) {
        return '[Mismatch] ' + (t('tls_key_mismatch_msg') || 'Key Mismatch');
    }
    const err = state?.tlsProvisionError || state?.appInfo?.tlsError || '';
    if (state?.tlsProvisionFailed || err) {
        return '[Failed] ' + (t('tls_cert_failed_status') || 'Provision Failed / HTTP Fallback') + (err ? ` (${err})` : '');
    }
    if (!Boolean(state?.settings?.enableTLS)) {
        return '[Disabled] ' + (t('tls_disabled_tooltip') || 'Disabled (HTTP)');
    }
    return '[Preparing] ' + (t('tls_cert_preparing') || 'Preparing...');
}

/**
 * 渲染任务卡片与二维码详情处的协议传输安全徽章
 * @param {string} pageUrl 任务页面 URL
 * @param {object} state 全局状态对象
 * @param {Function} t 国际化翻译函数
 * @param {Function} escapeAttr 属性转义函数
 * @returns {string} HTML 徽章片段
 */
export function renderTaskSecurityBadge(pageUrl, state, t, escapeAttr) {
    if (!pageUrl) return '';
    const isHttps = pageUrl.startsWith('https://');
    if (isHttps) {
        return `<span class="tls-security-badge secure" title="${escapeAttr(t('tls_active_https') || '局域网 TLS 加密传输')}">${renderLockSvg({ color: 'currentColor', size: 11 })} HTTPS</span>`;
    }
    if (Boolean(state?.settings?.enableTLS)) {
        return `<span class="tls-security-badge fallback" title="${escapeAttr(t('tls_fallback_http') || 'TLS 证书暂未就绪，已自动降级为 HTTP 明文传输保障可用')}">${renderAlertSvg({ color: 'currentColor', size: 11 })} HTTP (${t('tls_fallback_label') || '降级明文'})</span>`;
    }
    return `<span class="tls-security-badge plain" title="${escapeAttr(t('tls_standard_http') || '标准 HTTP 明文传输')}">${renderLockSvg({ color: 'currentColor', size: 11, open: true })} HTTP</span>`;
}

/**
 * 渲染顶栏 (Top Bar) 处的 TLS 安全状态交互徽章/图标
 * @param {object} state 全局状态对象
 * @param {Function} t 国际化翻译函数
 * @param {Function} escapeAttr 属性转义函数
 * @returns {string} 图标 HTML 片段
 */
export function renderTopbarTLSIndicator(state, t, escapeAttr) {
    const status = getTLSState(state);
    switch (status) {
        case 'ready':
            return `<button class="menu-button topbar-tls-btn" id="topbar-tls-status" role="button" aria-label="${escapeAttr(t('tls_cert_ready') || 'TLS Ready')}" title="${escapeAttr(t('tls_cert_ready') || 'TLS Ready')}" style="padding: 0 4px; display: inline-flex; align-items: center; justify-content: center;">${renderLockSvg({ color: 'var(--accent, #156f5a)', size: 14 })}</button>`;
        case 'preparing':
            return `<button class="menu-button topbar-tls-btn" id="topbar-tls-status" role="button" aria-label="${escapeAttr(t('tls_cert_preparing') || 'TLS Preparing')}" title="${escapeAttr(t('tls_cert_preparing') || 'TLS Preparing')}" style="padding: 0 4px; display: inline-flex; align-items: center; justify-content: center;">${renderSpinnerSvg({ color: 'var(--accent, #156f5a)', size: 14 })}</button>`;
        case 'mismatch':
        case 'failed': {
            const err = state?.tlsProvisionError || state?.appInfo?.tlsError || '';
            const tooltip = (t('tls_cert_failed_tooltip') || '证书置备遇到异常') + (err ? ` [${err}]` : '');
            return `<button class="menu-button topbar-tls-btn" id="topbar-tls-status" role="button" aria-label="${escapeAttr(tooltip)}" title="${escapeAttr(tooltip)}" style="padding: 0 4px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer;">${renderAlertSvg({ color: '#d97706', size: 14 })}</button>`;
        }
        case 'disabled':
        default: {
            const lastErr = state?.tlsProvisionError || state?.appInfo?.tlsError;
            if (lastErr && state?.tlsProvisionFailed) {
                const tooltip = (t('tls_failed_auto_disabled') || '证书置备遇到异常，已自动关闭局域网 TLS 并保持标准明文传输') + ` [${lastErr}]`;
                return `<button class="menu-button topbar-tls-btn" id="topbar-tls-status" role="button" aria-label="${escapeAttr(tooltip)}" title="${escapeAttr(tooltip)}" style="padding: 0 4px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer;">${renderAlertSvg({ color: 'var(--text-muted, #94a3b8)', size: 14 })}</button>`;
            }
            return '';
        }
    }
}
