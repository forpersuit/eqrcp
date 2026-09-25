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
 * 渲染精致矢量盾牌打勾 SVG 图标 (用于诊断成功状态)
 * @param {object} options
 * @param {string} [options.color] 描边颜色
 * @param {number} [options.size] 尺寸（像素）
 * @param {string} [options.className] 附加 CSS 类名
 * @returns {string} SVG HTML 片段
 */
export function renderShieldCheckSvg({ color = '#10b981', size = 14, className = '' } = {}) {
    const strokeColor = color || 'currentColor';
    return `<svg class="tls-svg-icon tls-shield-check-icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; display: inline-block;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="m9 12 2 2 4-4"></path></svg>`;
}

/**
 * 渲染精致矢量脉冲/诊断探针 SVG 图标 (用于诊断待测/就绪状态)
 * @param {object} options
 * @param {string} [options.color] 描边颜色
 * @param {number} [options.size] 尺寸（像素）
 * @param {string} [options.className] 附加 CSS 类名
 * @returns {string} SVG HTML 片段
 */
export function renderPulseSvg({ color = 'currentColor', size = 14, className = '' } = {}) {
    const strokeColor = color || 'currentColor';
    return `<svg class="tls-svg-icon tls-pulse-icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; display: inline-block;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>`;
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
 * 状态为 ready 或 disabled 时不显示图标（开关自身开启/关闭状态足以表征）；
 * 处于置备中(preparing)时显示旋转加载图标；失败(failed/mismatch)时显示警告图标。
 * @param {object} state 全局状态对象
 * @param {Function} t 国际化翻译函数
 * @param {Function} escapeAttr 属性转义函数
 * @returns {string} 图标 HTML 或空字符串
 */
export function renderTLSSettingIcon(state, t, escapeAttr) {
    const status = getTLSState(state);
    switch (status) {
        case 'mismatch':
            return `<span class="tls-status-icon mismatch" role="img" aria-label="${escapeAttr(state?.tlsKeyMismatchMsg || t('tls_key_mismatch_msg'))}" title="${escapeAttr(state?.tlsKeyMismatchMsg || t('tls_key_mismatch_msg'))}" style="display: inline-flex; align-items: center; cursor: help;">${renderAlertSvg({ color: '#d97706', size: 14 })}</span>`;
        case 'failed': {
            const err = state?.tlsProvisionError || state?.appInfo?.tlsError || '';
            const isRateLimit = err && (err.includes('rate limit') || err.includes('429') || err.includes('Too Many Requests'));
            const fallbackTooltip = isRateLimit ? t('tls_cert_rate_limited') : t('tls_cert_failed_tooltip');
            const tooltip = (fallbackTooltip || '证书置备遇到异常（已自动降级为明文传输保障传输），点击查看详情或重试') + (err ? ` [${err}]` : '');
            return `<span class="tls-status-icon failed" role="img" aria-label="${escapeAttr(tooltip)}" title="${escapeAttr(tooltip)}" style="display: inline-flex; align-items: center; cursor: help;">${renderAlertSvg({ color: '#d97706', size: 14 })}</span>`;
        }
        case 'preparing':
            return `<span class="tls-status-icon preparing" role="img" aria-label="${escapeAttr(t('tls_cert_preparing'))}" title="${escapeAttr(t('tls_cert_preparing'))}" style="display: inline-flex; align-items: center;">${renderSpinnerSvg({ color: 'var(--accent, #156f5a)', size: 14 })}</span>`;
        case 'ready':
        case 'disabled':
        default:
            return '';
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
            return `<span class="topbar-tls-indicator" id="topbar-tls-status" role="status" aria-label="${escapeAttr(t('tls_cert_ready') || 'TLS Ready')}" title="${escapeAttr(t('tls_cert_ready') || 'TLS Ready')}" style="padding: 0 4px; display: inline-flex; align-items: center; justify-content: center; cursor: default; user-select: none;">${renderLockSvg({ color: 'var(--accent, #156f5a)', size: 14 })}</span>`;
        case 'preparing':
            return `<span class="topbar-tls-indicator" id="topbar-tls-status" role="status" aria-label="${escapeAttr(t('tls_cert_preparing') || 'TLS Preparing')}" title="${escapeAttr(t('tls_cert_preparing') || 'TLS Preparing')}" style="padding: 0 4px; display: inline-flex; align-items: center; justify-content: center; cursor: default; user-select: none;">${renderSpinnerSvg({ color: 'var(--accent, #156f5a)', size: 14 })}</span>`;
        case 'mismatch':
        case 'failed': {
            const err = state?.tlsProvisionError || state?.appInfo?.tlsError || '';
            const tooltip = (t('tls_cert_failed_tooltip') || '证书置备遇到异常') + (err ? ` [${err}]` : '');
            return `<span class="topbar-tls-indicator" id="topbar-tls-status" role="status" aria-label="${escapeAttr(tooltip)}" title="${escapeAttr(tooltip)}" style="padding: 0 4px; display: inline-flex; align-items: center; justify-content: center; cursor: default; user-select: none;">${renderAlertSvg({ color: '#d97706', size: 14 })}</span>`;
        }
        case 'disabled':
        default: {
            const lastErr = state?.tlsProvisionError || state?.appInfo?.tlsError;
            if (lastErr && state?.tlsProvisionFailed) {
                const tooltip = (t('tls_failed_auto_disabled') || '证书置备遇到异常，已自动关闭局域网 TLS 并保持标准明文传输') + ` [${lastErr}]`;
                return `<span class="topbar-tls-indicator" id="topbar-tls-status" role="status" aria-label="${escapeAttr(tooltip)}" title="${escapeAttr(tooltip)}" style="padding: 0 4px; display: inline-flex; align-items: center; justify-content: center; cursor: default; user-select: none;">${renderAlertSvg({ color: 'var(--text-muted, #94a3b8)', size: 14 })}</span>`;
            }
            return '';
        }
    }
}

/**
 * 渲染设置面板中 TLS 诊断验证控制图标/按钮 (Question 3)
 * 界面反馈仅使用图标状态展示 (idle -> testing -> success/warning/error)，详细信息由后端写入运行日志。
 * @param {object} state 全局状态对象
 * @param {Function} t 国际化翻译函数
 * @param {Function} escapeAttr 属性转义函数
 * @returns {string} HTML 片段
 */
export function renderTLSDiagnosticControl(state, t, escapeAttr) {
    if (!Boolean(state?.settings?.enableTLS)) {
        return '';
    }

    if (state?.tlsDiagnosing) {
        return `<span class="tls-diag-status diagnosing" role="status" aria-label="${escapeAttr(t('tls_diag_testing') || '正在测试局域网 TLS（证书、DNS与握手探测）...')}" title="${escapeAttr(t('tls_diag_testing') || '正在测试局域网 TLS（证书、DNS与握手探测）...')}" style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px;">${renderSpinnerSvg({ color: 'var(--accent, #156f5a)', size: 14 })}</span>`;
    }

    if (state?.tlsDiagResult) {
        const res = state.tlsDiagResult;
        const retestTip = t('tls_diag_retest') || '点击重新验证';
        if (res.status === 'success') {
            const tooltip = `${res.message} (${retestTip}，详情见日志)`;
            return `<button type="button" class="tool-button tls-diag-btn success" id="btn-test-tls" aria-label="TLS 验证通过" title="${escapeAttr(tooltip)}" style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: none; background: transparent; cursor: pointer; border-radius: 4px; padding: 0;">${renderShieldCheckSvg({ color: '#10b981', size: 14 })}</button>`;
        }
        if (res.status === 'warning') {
            const tooltip = `${res.message} (${retestTip}，详情见日志)`;
            return `<button type="button" class="tool-button tls-diag-btn warning" id="btn-test-tls" aria-label="TLS 验证警告" title="${escapeAttr(tooltip)}" style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: none; background: transparent; cursor: pointer; border-radius: 4px; padding: 0;">${renderAlertSvg({ color: '#f59e0b', size: 14 })}</button>`;
        }
        // error
        const tooltip = `${res.message} (${retestTip}，详情见日志)`;
        return `<button type="button" class="tool-button tls-diag-btn error" id="btn-test-tls" aria-label="TLS 验证异常" title="${escapeAttr(tooltip)}" style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: none; background: transparent; cursor: pointer; border-radius: 4px; padding: 0;">${renderAlertSvg({ color: '#ef4444', size: 14 })}</button>`;
    }

    // Default / idle state
    const tooltip = t('tls_diag_btn_tooltip') || '诊断测试局域网 TLS 状态（证书有效性、DNS 回环解析与握手测试，详细信息记录于日志）';
    return `<button type="button" class="tool-button tls-diag-btn idle" id="btn-test-tls" aria-label="TLS 诊断测试" title="${escapeAttr(tooltip)}" style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: none; background: transparent; cursor: pointer; border-radius: 4px; padding: 0; color: var(--text-muted, #94a3b8);">${renderPulseSvg({ color: 'currentColor', size: 14 })}</button>`;
}

