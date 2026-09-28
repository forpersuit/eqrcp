// desktop/gui/frontend/tests/tls_status.test.js
// 针对局域网 TLS 状态指示器的单元测试
// 断言规则：
// 1. 顶栏 topbar 指示器（tier badge 左侧）：不显示处理中（preparing）或异常状态，要么有（ready 锁），要么没有（空字符串）；
// 2. 设置项 settings 开关旁边：完整呈现 preparing、ready、mismatch、failed 的图标及 tooltip。

import assert from 'node:assert/strict';
import {
    getTLSState,
    renderTopbarTLSIndicator,
    renderTLSSettingIcon,
    renderTLSDiagnosticControl
} from '../src/components/tls_status.js';

const mockT = (key) => key;
const mockEscapeAttr = (str) => String(str || '').replace(/"/g, '&quot;');

console.log('=== Running TLS Status Indicator Unit Tests ===');

// Test 1: 用户初次启动，开启 TLS 但证书尚在准备（preparing）
{
    const state = {
        settings: { enableTLS: true },
        appInfo: { hasValidTLSCert: false },
        tlsProvisioning: true,
        tlsProvisionFailed: false
    };

    assert.equal(getTLSState(state), 'preparing', 'State should be preparing');
    const topbar = renderTopbarTLSIndicator(state, mockT, mockEscapeAttr);
    assert.equal(topbar, '', 'Topbar MUST NOT show preparing / loading indicator to avoid confusing first-time users');

    const settingIcon = renderTLSSettingIcon(state, mockT, mockEscapeAttr);
    assert.ok(settingIcon.includes('tls-status-icon preparing'), 'Settings switch MUST show preparing spinner icon');
    assert.ok(settingIcon.includes('tls-spinner-icon'), 'Settings switch MUST include spinner SVG');
    console.log('✓ Test 1: preparing state returns empty on topbar and spinner in settings');
}

// Test 2: TLS 证书就绪（ready）
{
    const state = {
        settings: { enableTLS: true },
        appInfo: { hasValidTLSCert: true },
        tlsProvisioning: false,
        tlsProvisionFailed: false
    };

    assert.equal(getTLSState(state), 'ready', 'State should be ready');
    const topbar = renderTopbarTLSIndicator(state, mockT, mockEscapeAttr);
    assert.ok(topbar.includes('topbar-tls-indicator'), 'Topbar MUST display indicator when ready');
    assert.ok(topbar.includes('tls-lock-icon'), 'Topbar MUST display lock icon when ready');

    const settingIcon = renderTLSSettingIcon(state, mockT, mockEscapeAttr);
    assert.ok(settingIcon.includes('tls-status-icon ready'), 'Settings switch MUST show ready status icon');
    assert.ok(settingIcon.includes('tls-lock-icon'), 'Settings switch MUST include lock SVG when ready');
    console.log('✓ Test 2: ready state displays lock icon on both topbar and settings');
}

// Test 3: TLS 关闭（disabled）
{
    const state = {
        settings: { enableTLS: false },
        appInfo: { hasValidTLSCert: false }
    };

    assert.equal(getTLSState(state), 'disabled', 'State should be disabled');
    const topbar = renderTopbarTLSIndicator(state, mockT, mockEscapeAttr);
    assert.equal(topbar, '', 'Topbar MUST be empty when disabled');

    const settingIcon = renderTLSSettingIcon(state, mockT, mockEscapeAttr);
    assert.equal(settingIcon, '', 'Settings icon MUST be empty when disabled');
    console.log('✓ Test 3: disabled state returns empty on topbar and settings');
}

// Test 4: 证书置备失败（failed）
{
    const state = {
        settings: { enableTLS: true },
        appInfo: { hasValidTLSCert: false, tlsError: 'DNS challenge timeout' },
        tlsProvisioning: false,
        tlsProvisionFailed: true,
        tlsProvisionError: 'DNS challenge timeout'
    };

    assert.equal(getTLSState(state), 'failed', 'State should be failed');
    const topbar = renderTopbarTLSIndicator(state, mockT, mockEscapeAttr);
    assert.equal(topbar, '', 'Topbar MUST NOT show noise/alert on failed state (either ready or empty)');

    const settingIcon = renderTLSSettingIcon(state, mockT, mockEscapeAttr);
    assert.ok(settingIcon.includes('tls-status-icon failed'), 'Settings switch MUST show failed alert icon');
    assert.ok(settingIcon.includes('tls-alert-icon'), 'Settings switch MUST include alert SVG');
    console.log('✓ Test 4: failed state returns empty on topbar and alert in settings');
}

// Test 5: 密钥不匹配（mismatch）
{
    const state = {
        settings: { enableTLS: true },
        appInfo: { hasValidTLSCert: false },
        tlsKeyMismatch: true,
        tlsKeyMismatchMsg: 'Key mismatch'
    };

    assert.equal(getTLSState(state), 'mismatch', 'State should be mismatch');
    const topbar = renderTopbarTLSIndicator(state, mockT, mockEscapeAttr);
    assert.equal(topbar, '', 'Topbar MUST NOT show mismatch on topbar');

    const settingIcon = renderTLSSettingIcon(state, mockT, mockEscapeAttr);
    assert.ok(settingIcon.includes('tls-status-icon mismatch'), 'Settings switch MUST show mismatch alert icon');
    console.log('✓ Test 5: mismatch state returns empty on topbar and alert in settings');
}

// Test 6: 诊断控件在 TLS 关闭时返回空字符串
{
    const state = { settings: { enableTLS: false } };
    const diag = renderTLSDiagnosticControl(state, mockT, mockEscapeAttr);
    assert.equal(diag, '', 'Diagnostic control MUST return empty string when TLS is disabled');
    console.log('✓ Test 6: diagnostic control returns empty when TLS disabled');
}

// Test 7: 诊断控件在空闲（idle）状态显示脉冲测试按钮且具备国际化 aria-label
{
    const state = { settings: { enableTLS: true } };
    const diag = renderTLSDiagnosticControl(state, mockT, mockEscapeAttr);
    assert.ok(diag.includes('id="btn-test-tls"'), 'Must include button with id btn-test-tls');
    assert.ok(diag.includes('tls-pulse-icon'), 'Must include pulse icon');
    assert.ok(diag.includes('aria-label="tls_diag_aria_test"'), 'Must include localized aria-label for test');
    console.log('✓ Test 7: diagnostic control in idle state renders pulse button with localized aria-label');
}

// Test 8: 诊断控件在执行中（diagnosing）显示加载状态
{
    const state = { settings: { enableTLS: true }, tlsDiagnosing: true };
    const diag = renderTLSDiagnosticControl(state, mockT, mockEscapeAttr);
    assert.ok(diag.includes('tls-diag-status diagnosing'), 'Must show diagnosing status container');
    assert.ok(diag.includes('tls-spinner-icon'), 'Must show spinner icon while diagnosing');
    console.log('✓ Test 8: diagnostic control while diagnosing renders spinner');
}

// Test 9: 诊断控件在通过（success）状态呈现盾牌图标与通过 aria-label
{
    const state = {
        settings: { enableTLS: true },
        tlsDiagResult: { ok: true, status: 'success', message: 'All checks passed' }
    };
    const diag = renderTLSDiagnosticControl(state, mockT, mockEscapeAttr);
    assert.ok(diag.includes('tls-diag-btn success'), 'Must show success button');
    assert.ok(diag.includes('tls-shield-check-icon'), 'Must include shield check icon');
    assert.ok(diag.includes('aria-label="tls_diag_aria_passed"'), 'Must include localized aria-label for passed');
    console.log('✓ Test 9: diagnostic control in success state renders shield icon with localized aria-label');
}

// Test 10: 诊断控件在警告（warning）与异常（error）状态呈现警示图标与对应 aria-label
{
    const stateWarn = {
        settings: { enableTLS: true },
        tlsDiagResult: { ok: true, status: 'warning', message: 'DNS rebinding' }
    };
    const diagWarn = renderTLSDiagnosticControl(stateWarn, mockT, mockEscapeAttr);
    assert.ok(diagWarn.includes('tls-diag-btn warning'), 'Must show warning button');
    assert.ok(diagWarn.includes('aria-label="tls_diag_aria_warning"'), 'Must include localized aria-label for warning');

    const stateErr = {
        settings: { enableTLS: true },
        tlsDiagResult: { ok: false, status: 'error', message: 'Handshake failed' }
    };
    const diagErr = renderTLSDiagnosticControl(stateErr, mockT, mockEscapeAttr);
    assert.ok(diagErr.includes('tls-diag-btn error'), 'Must show error button');
    assert.ok(diagErr.includes('aria-label="tls_diag_aria_error"'), 'Must include localized aria-label for error');
    console.log('✓ Test 10: diagnostic control in warning/error state renders alert button with localized aria-label');
}

console.log('✅ All 10 TLS status & diagnostic unit tests passed successfully!\n');
