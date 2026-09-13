// 局域网 TLS 状态指示与协议徽章独立模块 (LAN-TLS Status & Security Badges Component)

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
 * @param {object} state 全局状态对象
 * @param {Function} t 国际化翻译函数
 * @param {Function} escapeAttr 属性转义函数
 * @returns {string} 图标 HTML
 */
export function renderTLSSettingIcon(state, t, escapeAttr) {
    const status = getTLSState(state);
    switch (status) {
        case 'ready':
            return `<span class="tls-status-icon ready" role="img" aria-label="${escapeAttr(t('tls_cert_ready'))}" title="${escapeAttr(t('tls_cert_ready'))}" style="margin-left: 6px; font-size: 12px; vertical-align: baseline; display: inline-block;">🔒</span>`;
        case 'mismatch':
            return `<span class="tls-status-icon mismatch" role="img" aria-label="${escapeAttr(state?.tlsKeyMismatchMsg || t('tls_key_mismatch_msg'))}" title="${escapeAttr(state?.tlsKeyMismatchMsg || t('tls_key_mismatch_msg'))}" style="margin-left: 6px; font-size: 12px; vertical-align: baseline; display: inline-block; cursor: help;">⚠️</span>`;
        case 'failed': {
            const err = state?.tlsProvisionError || state?.appInfo?.tlsError || '';
            const tooltip = (t('tls_cert_failed_tooltip') || '证书置备遇到异常（已自动降级为明文传输保障传输），点击查看详情或重试') + (err ? ` [${err}]` : '');
            return `<span class="tls-status-icon failed" role="img" aria-label="${escapeAttr(tooltip)}" title="${escapeAttr(tooltip)}" style="margin-left: 6px; font-size: 12px; vertical-align: baseline; display: inline-block; cursor: help;">⚠️</span>`;
        }
        case 'preparing':
            return `<span class="tls-status-icon preparing" role="img" aria-label="${escapeAttr(t('tls_cert_preparing'))}" title="${escapeAttr(t('tls_cert_preparing'))}" style="margin-left: 6px; font-size: 12px; vertical-align: baseline; display: inline-block;">⏳</span>`;
        case 'disabled':
        default:
            return `<span class="tls-status-icon disabled" role="img" aria-label="${escapeAttr(t('tls_disabled_tooltip'))}" title="${escapeAttr(t('tls_disabled_tooltip'))}" style="margin-left: 6px; font-size: 12px; vertical-align: baseline; display: inline-block; opacity: 0.65;">🔓</span>`;
    }
}

/**
 * 渲染开发者选项中 LAN-TLS Certificate Debug 状态文本
 * @param {object} state 全局状态对象
 * @param {Function} t 国际化翻译函数
 * @returns {string} 状态展示文本
 */
export function getDevTLSStatusText(state, t) {
    const status = getTLSState(state);
    switch (status) {
        case 'ready':
            return '✅ ' + (t('tls_cert_ready') || 'Ready');
        case 'mismatch':
            return '⚠️ ' + (t('tls_key_mismatch_msg') || 'Key Mismatch');
        case 'failed': {
            const err = state?.tlsProvisionError || state?.appInfo?.tlsError || '';
            return '⚠️ ' + (t('tls_cert_failed_status') || 'Provision Failed / HTTP Fallback') + (err ? ` (${err})` : '');
        }
        case 'preparing':
            return '⏳ ' + (t('tls_cert_preparing') || 'Preparing...');
        case 'disabled':
        default:
            return '🔓 ' + (t('tls_disabled_tooltip') || 'Disabled (HTTP)');
    }
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
        return `<span class="tls-security-badge secure" title="${escapeAttr(t('tls_active_https') || '局域网 TLS 加密传输')}">🔒 HTTPS</span>`;
    }
    if (Boolean(state?.settings?.enableTLS)) {
        return `<span class="tls-security-badge fallback" title="${escapeAttr(t('tls_fallback_http') || 'TLS 证书暂未就绪，已自动降级为 HTTP 明文传输保障可用')}">⚠️ HTTP (${t('tls_fallback_label') || '降级明文'})</span>`;
    }
    return `<span class="tls-security-badge plain" title="${escapeAttr(t('tls_standard_http') || '标准 HTTP 明文传输')}">🔓 HTTP</span>`;
}
