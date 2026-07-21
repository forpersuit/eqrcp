import { state } from './state';
import { t, getSystemLocale } from './i18n';
import { shouldProtectActiveInput, updateSettingsBadgeUI } from './utils/domHelpers';
import { recalculateUpdateTexts, syncManualUpdateCheckUI, cleanLocalAddressError, triggerDownloadUpdate, runAutoUpdateCheck, runManualUpdateCheck, scheduleAutoUpdateCheck } from './controllers/updateController';
import { buildDiagnostics, collectFeedback, feedbackMailto } from './controllers/feedbackController';
import { saveLicense, validateRedeemCode, licenseStorageKey } from './controllers/licenseController';
import { renderSettingsView } from './views/settingsView';
import { renderAboutView } from './views/aboutView';
import { renderPlanComparisonView } from './views/planComparisonView';
import { renderFeedbackView } from './views/feedbackView';
import { allEmojis, culturalEmojis, getCategoryLocalizedName } from './emojis.js';
import './style.css';
import './app.css';
import faviconURL from './assets/images/favicon.png';
import horizontalLogoURL from './assets/images/logo-horizontal.png';
import logoMarkURL from './assets/images/logo-mark.png';
import shareIllustrationURL from './assets/images/share.png';
import receiveIllustrationURL from './assets/images/receive.png';
import chatIllustrationURL from './assets/images/chat.png';
import morphdom from './vendor/morphdom.js';
import { renderSide, toggleSearchInput, updateSearchQuery, searchQuery, showSearchInput, renderHistory, showSearchDropdown, toggleSearchDropdown, activeFocusTaskId, updateActiveFocus, getMatchResults, highlightText } from './components/history.js';
import { initDragDrop, sendDebugMessageToChat } from './dragdrop';

import {ClipboardGetText, ClipboardSetText, EventsOn, LogInfo, LogError} from '../wailsjs/runtime/runtime';
import {
    AgentStatus,
    AppInfo,
    Chat,
    ChatSaveDirectory,
    ClearHistory,
    DownloadChatAttachment,
    OpenExternal,
    OpenFile,
    OpenPath,
    OpenURL,
    ReadSettings,
    Receive,
    RepeatTask,
    SaveChatAttachmentAs,
    SaveSettings,
    SelectFiles,
    GetFileInfos,
    ValidateFreeTier,
    SelectReceiveDirectory,
    SelectShareDirectory,
    SelectLogDirectory,
    RightClickIntegrationStatus,
    Share,
    SetRightClickIntegrationEnabled,
    SetStartupEnabled,
    SetPaidStatus,
    ActivateLicense,
    ResetLicense,
    RefreshLicenseStatus,
    StartupStatus,
    StopChat,
    StopCurrent,
    SetAutoStop,
    SubmitFeedback,
    DevSetUsedSeconds,
} from '../wailsjs/go/main/App';

window.addEventListener('error', (e) => {
    const errorMsg = `[Uncaught JS Error] Message: ${e.message} | Source: ${e.filename} | Line: ${e.lineno} | Col: ${e.colno} | Error: ${e.error?.stack || e.error}`;
    console.error(errorMsg);
    if (typeof LogError === 'function') {
        LogError(errorMsg);
    }
});

window.addEventListener('unhandledrejection', (e) => {
    const errorMsg = `[Unhandled Promise Rejection] Reason: ${e.reason?.stack || e.reason}`;
    console.error(errorMsg);
    if (typeof LogError === 'function') {
        LogError(errorMsg);
    }
});

// Prevent duplicate event listener registration on reused DOM elements due to morphdom patching
(function() {
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    const originalRemoveEventListener = EventTarget.prototype.removeEventListener;

    EventTarget.prototype.addEventListener = function(type, listener, options) {
        this._listeners = this._listeners || [];
        const listenerStr = listener.toString();
        const existingIdx = this._listeners.findIndex(l => l.type === type && l.listenerStr === listenerStr);

        if (existingIdx !== -1) {
            const old = this._listeners[existingIdx];
            originalRemoveEventListener.call(this, type, old.listener, options);
            this._listeners.splice(existingIdx, 1);
        }

        this._listeners.push({ type, listener, listenerStr });
        originalAddEventListener.call(this, type, listener, options);
    };

    EventTarget.prototype.removeEventListener = function(type, listener, options) {
        if (this._listeners) {
            const idx = this._listeners.findIndex(l => l.type === type && l.listener === listener);
            if (idx !== -1) {
                this._listeners.splice(idx, 1);
            }
        }
        originalRemoveEventListener.call(this, type, listener, options);
    };
})();

window.onerror = function(message, source, lineno, colno, error) {
    const errText = `[JS Error] ${message} at ${source}:${lineno}:${colno}`;
    console.error(errText, error);
    if (window.runtime && window.runtime.LogError) {
        window.runtime.LogError(errText);
    }
};

window.onunhandledrejection = function(event) {
    const errText = `[JS Promise Error] ${event.reason}`;
    console.error(errText);
    if (window.runtime && window.runtime.LogError) {
        window.runtime.LogError(errText);
    }
};

let reportedErrorsCount = 0;
const reportedErrorsSet = new Set();
let lastFocusedTaskId = null;

function reportRuntimeErrorToBot(message, stack) {
    if (reportedErrorsCount >= 5) {
        return; // Limit error report count per session to avoid flood
    }
    const errKey = `${message}:${stack}`;
    if (reportedErrorsSet.has(errKey)) {
        return; // Prevent duplicate reports
    }
    reportedErrorsSet.add(errKey);
    reportedErrorsCount++;

    const diagnostics = typeof buildDiagnostics === 'function' ? buildDiagnostics() : '';
    const fullMessage = `[Runtime Error]\n\nMessage: ${message}\n\nStack: ${stack || 'no-stack'}\n\n[Diagnostics]\n${diagnostics}`;

    try {
        if (typeof SubmitFeedback === 'function') {
            SubmitFeedback(
                'runtime_error',
                'telemetry',
                fullMessage,
                '', // No image
                ''
            ).catch(err => console.error('Silent error reporting failed:', err));
        }
    } catch (e) {
        console.error('Failed to trigger SubmitFeedback for telemetry:', e);
    }
}

window.addEventListener('error', (event) => {
    const errorMsg = event.message || event.error?.message || 'Unknown Error';
    const errorStack = event.error?.stack || '';
    reportRuntimeErrorToBot(errorMsg, errorStack);
});

window.addEventListener('unhandledrejection', (event) => {
    const errorMsg = event.reason?.message || String(event.reason || 'Unhandled Promise Rejection');
    const errorStack = event.reason?.stack || '';
    reportRuntimeErrorToBot(errorMsg, errorStack);
});



initDragDrop(state, handleFileDrop);

const agentEventsURL = 'http://127.0.0.1:48176/events';
const chatDailyFreeMs = 5 * 60 * 1000;
const chatUsageStorageKey = 'eqt.chat.dailyFreeUsage';

const redeemSecret = 'EQT-LOCAL-2026-V1';
const licenseTiers = {
    PLUS: 'EQT Plus',
    PRO: 'EQT Pro',
};
function getLicenseDisplayName(license) {
    if (!license || !license.tier) return 'No paid plan active';
    if (license.tier === 'PLUS' && license.codeDate === 'LIFETIME') {
        return 'EQT Plus U';
    }
    return licenseTiers[license.tier] || license.tier;
}
let agentEvents = null;
let confirmSwitchResolve = null;
let qrExpandedManual = null;
let _staticDelegationBound = false;

function showConfirmSwitchDialog() {
    return new Promise((resolve) => {
        confirmSwitchResolve = resolve;
        state.activePanel = 'confirm-switch';
        render();
    });
}

let agentEventsRetry = null;
let chatQRPulseTimer = null;
let chatUsageTimer = null;
const autoSavedAttachments = new Set();
const app = document.querySelector('#app');
const getPortHelpText = () => t('port_help_text');

function triggerChatQRPulse() {
    if (state.chatQRPromptDismissed) {
        return;
    }
    const now = Date.now();
    if (state.chatQRPulseUntil > now) {
        return;
    }
    const pulseDuration = 10000;
    state.chatQRPulseUntil = now + pulseDuration;
    if (chatQRPulseTimer) {
        window.clearTimeout(chatQRPulseTimer);
    }
    updateChatQRPulseButton();
    chatQRPulseTimer = window.setTimeout(() => {
        chatQRPulseTimer = null;
        state.chatQRPulseUntil = 0;
        updateChatQRPulseButton();
    }, pulseDuration);
}

function updateChatQRPulseButton() {
    const button = document.querySelector('.chat-qr-toggle-action');
    if (button) {
        const shouldPulse = !state.chatQRPromptDismissed && state.chatQRPulseUntil > Date.now();
        if (shouldPulse) {
            button.classList.add('qr-breathe');
        } else {
            button.classList.remove('qr-breathe');
        }
    }
}

function pulseChatFrameQR() {
    if (state.chatQRPromptDismissed || state.chatQRPulseUntil <= Date.now()) {
        return;
    }
    const frame = document.querySelector<HTMLIFrameElement>('#chat-iframe');
    if (!frame) { return; }
    const payload = {type: 'pulse-session-qr', until: state.chatQRPulseUntil};
    const post = () => {
        try {
            frame.contentWindow?.postMessage(payload, activeChatFrameOrigin() || '*');
        } catch {
            // The iframe can still be navigating; the load handler is the reliable path.
        }
    };
    frame.addEventListener('load', post, {once: true});
    window.setTimeout(post, 0);
}

function stopChatQRPulse() {
    state.chatQRPulseArmed = false;
    state.chatQRPromptDismissed = true;
    state.chatQRPulseUntil = 0;
    if (chatQRPulseTimer) {
        window.clearTimeout(chatQRPulseTimer);
        chatQRPulseTimer = null;
    }
    updateChatQRPulseButton();
}

window.addEventListener('resize', () => {
    if (state.settings?.viewportDebug) {
        syncViewportDebugToChatFrame();
    }
});

// postMessage bridge: handle native operations requested by the chat iframe.
window.addEventListener('message', (e: MessageEvent) => {
    console.log('[Antigravity Debug] Wails parent received message:', e.data?.type, 'origin:', e.origin, 'data:', e.data);
    if (!isTrustedChatFrameMessage(e)) {
        console.warn('[Antigravity Debug] isTrustedChatFrameMessage validation failed for origin:', e.origin);
        return;
    }
    const targetOrigin = activeChatFrameOrigin() || '*';
    if (e.data.type === 'iframe-drag-active') {
        sendDebugMessageToChat('[Host] Received iframe-drag-active, showing drag overlay');
        return;
    }
    if (e.data.type === 'request-host-metrics') {
        syncViewportDebugToChatFrame();
        return;
    }
    if (e.data.type === 'save-file') {
        const url = String(e.data.url || '');
        if (!isTrustedChatURL(url, activeChatFrameOrigin())) { return; }
        (window as any).go?.main.App.SaveChatAttachmentAs(url, String(e.data.name || 'attachment')).catch(() => {});
    } else if (e.data.type === 'auto-save-file') {
        const url = String(e.data.url || '');
        const id = String(e.data.id || url);
        if (!state.chatAutoSave || autoSavedAttachments.has(id) || !isTrustedChatURL(url, activeChatFrameOrigin())) { return; }
        autoSavedAttachments.add(id);
        (window as any).go?.main.App.DownloadChatAttachment(url, String(e.data.name || 'attachment'))
            .then((path: string) => {
                if (path) {
                    state.chatSaveDir = path.replace(/[\\/][^\\/]*$/, '');
                }
            })
            .catch(() => {
                autoSavedAttachments.delete(id);
            });
    } else if (e.data.type === 'download-file') {
        const url = String(e.data.url || '');
        const messageId = String(e.data.messageId || '');
        console.log('[Antigravity Debug] download-file bridge invoked. URL:', url, 'messageId:', messageId);
        if (!isTrustedChatURL(url, activeChatFrameOrigin())) {
            console.warn('[Antigravity Debug] download-file: URL trust check failed');
            return;
        }
        console.log('[Antigravity Debug] Triggering SaveChatAttachmentAs API...');
        (window as any).go?.main.App.SaveChatAttachmentAs(url, String(e.data.name || 'attachment'))
            .then((path: string) => {
                console.log('[Antigravity Debug] SaveChatAttachmentAs success. Save path:', path);
                if (path) {
                    state.chatSaveDir = path.replace(/[\\/][^\\/]*$/, '');
                    (e.source as Window)?.postMessage({
                        type: 'download-success',
                        messageId: messageId,
                        path: path
                    }, targetOrigin as any);
                }
            })
            .catch((err: any) => {
                console.error('[Antigravity Debug] DownloadChatAttachment backend error:', err);
                (e.source as Window)?.postMessage({
                    type: 'download-failed',
                    messageId: messageId,
                    error: String(err?.message || err || 'download failed')
                }, targetOrigin as any);
            });
    } else if (e.data.type === 'cancel-download') {
        const messageId = String(e.data.messageId || '');
        if (messageId) {
            (window as any).go?.main.App.CancelChatDownload(messageId).catch(() => {});
        }
    } else if (e.data.type === 'open-file') {
        (window as any).go?.main.App.OpenFile(String(e.data.path || '')).catch(() => {});
    } else if (e.data.type === 'open-path') {
        (window as any).go?.main.App.OpenPath(String(e.data.path || '')).catch(() => {});
    } else if (e.data.type === 'open-chat-file') {
        const filename = String(e.data.filename || '');
        (window as any).go?.main.App.ChatSaveDirectory()
            .then((dir: string) => {
                if (dir) {
                    const fullPath = dir + '/' + filename;
                    (window as any).go?.main.App.OpenPath(fullPath).catch(() => {});
                }
            })
            .catch(() => {});
    } else if (e.data.type === 'read-clipboard-text') {
        const requestId = String(e.data.requestId || '');
        if (!requestId) { return; }
        (window as any).go?.main.App.ClipboardGetText()
            .then((text: string) => {
                (e.source as Window)?.postMessage({type: 'clipboard-text', requestId, text: String(text || '')}, targetOrigin as any);
            })
            .catch(() => {
                (e.source as Window)?.postMessage({type: 'clipboard-text', requestId, text: '', error: 'clipboard unavailable'}, targetOrigin as any);
            });
    } else if (e.data.type === 'select-files') {
        const requestId = String(e.data.requestId || '');
        if (!requestId) { return; }
        (window as any).go?.main.App.SelectFiles()
            .then((paths: string[]) => {
                (e.source as Window)?.postMessage({type: 'selected-files', requestId, paths: paths || []}, targetOrigin as any);
            })
            .catch((err: any) => {
                (e.source as Window)?.postMessage({type: 'selected-files', requestId, paths: [], error: String(err?.message || err || 'select failed')}, targetOrigin as any);
            });
    } else if (e.data.type === 'stop-chat' || e.data.type === 'close-page') {
        stopChat();
    } else if (e.data.type === 'rename-chat-sender') {
        const newName = String(e.data.name || '').trim();
        if (newName && state.settings) {
            state.settings.chatSender = newName;
            handleAutoSaveSettings().catch(() => {});
        }
    } else if (e.data.type === 'iframe-log-error') {
        const errorMsg = String(e.data.message || '');
        if (errorMsg) {
            (window as any).go?.main.App.LogError(errorMsg);
        }
    } else if (e.data.type === 'iframe-log-info') {
        const msg = String(e.data.message || '');
        if (msg) {
            (window as any).go?.main.App.LogInfo(msg);
        }
    }
});

function activeChatFrameOrigin(): string {
    const frame = document.querySelector<HTMLIFrameElement>('#chat-iframe');
    if (!frame?.src) { return ''; }
    try { return new URL(frame.src).origin; } catch { return ''; }
}

function isTrustedChatFrameMessage(event: MessageEvent): boolean {
    const frame = document.querySelector<HTMLIFrameElement>('#chat-iframe');
    if (!frame) {
        console.warn('[Antigravity Debug] isTrustedChatFrameMessage: iframe #chat-iframe not found');
        return false;
    }
    const origin = activeChatFrameOrigin();
    const normalizeOrigin = (orig: string) => {
        if (!orig) return '';
        return orig.replace('://localhost', '://127.0.0.1');
    };
    const evOriginNorm = normalizeOrigin(event.origin);
    const frameOriginNorm = normalizeOrigin(origin);
    
    // Accept origin match, or WebView2 cross-protocol null/empty origins
    const isSourceMatch = (event.source === frame.contentWindow);
    const originMatched = (evOriginNorm === frameOriginNorm) || evOriginNorm === '' || evOriginNorm === 'null';
    
    console.log('[Antigravity Debug] isTrustedChatFrameMessage validation:', {
        eventOrigin: event.origin,
        frameOrigin: origin,
        eventOriginNormalized: evOriginNorm,
        frameOriginNormalized: frameOriginNorm,
        isSourceMatch: isSourceMatch,
        originMatched: originMatched,
        data: event.data
    });
    
    if (!originMatched) {
        console.warn('[Antigravity Debug] isTrustedChatFrameMessage: origin mismatch. event.origin:', event.origin, 'expected:', origin);
        return false;
    }
    return true;
}

function isTrustedChatURL(rawURL, origin) {
    try {
        const parsed = new URL(rawURL);
        const normalizeOrigin = (orig) => {
            if (!orig) return '';
            return orig.replace('://localhost', '://127.0.0.1');
        };
        const parsedNormalized = normalizeOrigin(parsed.origin);
        const originNormalized = normalizeOrigin(origin);
        
        // Accept matching loopback origin or null/empty target origin from WebView2 cross-protocol messages
        const originOk = (parsedNormalized === originNormalized) || originNormalized === '' || originNormalized === 'null';
        const protocolOk = (parsed.protocol === 'http:' || parsed.protocol === 'https:');
        const matched = originOk && protocolOk;
        
        console.log('[Antigravity Debug] isTrustedChatURL validation:', {
            rawURL: rawURL,
            origin: origin,
            parsedOriginNormalized: parsedNormalized,
            originNormalized: originNormalized,
            originOk: originOk,
            protocolOk: protocolOk,
            matched: matched
        });
        
        if (!matched) {
            console.warn('[Antigravity Debug] isTrustedChatURL check failed. parsed.origin:', parsed.origin, 'event.origin:', origin);
        }
        return matched;
    } catch (err) {
        console.error('[Antigravity Debug] isTrustedChatURL: error parsing rawURL:', rawURL, err);
        return false;
    }
}

function render() {
    console.log('[Antigravity Debug] render() called, activePanel:', state.activePanel, 'stack:', new Error().stack);
    LogInfo('[Antigravity Debug] render() called, activePanel: ' + state.activePanel + ', stack: ' + new Error().stack);
    ensureFavicon();

    // 记录旧各滚动区域的滚动位置，防止全局重绘时回退到顶部
    const scrollPositions = {};
    const scrollableSelectors = [
        '.overlay .modal',
        '.workspace',
        '.path-list',
        '.side',
        '.locked-list',
        '.file-list-view',
        '.transfer-stage',
        '.devices-scroll-container'
    ];
    scrollableSelectors.forEach(selector => {
        const el = document.querySelector(selector);
        if (el) {
            scrollPositions[selector] = el.scrollTop;
        }
    });

    const activeShare = activeShareTask();
    const activeRecv = state.status?.current && state.status.current.action === 'receive' && !isTaskClosed(state.status.current) ? state.status.current : null;
    const activeChat = activeChatTask();
    let runningMode = null;
    if (activeShare) {
        runningMode = 'share';
    } else if (activeRecv) {
        runningMode = 'receive';
    } else if (activeChat) {
        runningMode = 'chat';
    }

    const newHTML = `
        <main class="shell">
            <header class="topbar">
                <nav class="mode-switch" aria-label="Transfer modes">
                    <button class="${state.mode === 'share' ? 'active' : (runningMode && runningMode !== 'share' ? 'disabled-mode' : '')}" data-mode="share">${t('share')}</button>
                    <button class="${state.mode === 'receive' ? 'active' : (runningMode && runningMode !== 'receive' ? 'disabled-mode' : '')}" data-mode="receive">${t('receive')}</button>
                    <button class="${state.mode === 'chat' ? 'active' : (runningMode && runningMode !== 'chat' ? 'disabled-mode' : '')}" data-mode="chat">${t('chat')}</button>
                </nav>
                <div class="top-actions" role="menubar" aria-label="Application menu">
                    ${!hasPaidLicense() ? `
                        <button class="menu-button" id="open-redeem" title="${t('redeem_title')}" aria-label="${t('redeem_title')}">
                            <span class="menu-icon">${giftIcon()}</span>
                        </button>
                    ` : ''}
                    ${(() => {
                        const isPaid = hasPaidLicense();
                        const tier = (isPaid && state.license?.tier) ? state.license.tier : 'FREE';
                        const tierText = (tier === 'PLUS' && state.license?.codeDate === 'LIFETIME') ? 'PLUS U' : tier;
                        return `<span class="topbar-tier-badge">${escapeHTML(tierText)}</span>`;
                    })()}
                    <button class="menu-button" id="open-settings" title="${t('settings')}" aria-label="${t('settings')}" style="position: relative;">
                        <span class="menu-icon">${settingsIcon()}</span>
                        ${state.settings?.autoUpdateMode !== 'off' && (
                            (state.settings?.autoUpdateMode === 'notify' && (state.updateStage === 'available' || state.updateStage === 'ready')) ||
                            ((state.settings?.autoUpdateMode === 'download' || state.settings?.autoUpdateMode === 'silent') && state.updateStage === 'ready')
                        ) ? `<span class="badge-dot" style="position: absolute; top: 6px; right: 6px; width: 8px; height: 8px; background-color: var(--danger, #fc0035); border-radius: 50%; border: 1.5px solid var(--bg, #ffffff); pointer-events: none;"></span>` : ''}
                    </button>
                    <button class="menu-button" id="open-about" title="${t('about')}" aria-label="${t('about')}">
                        <span class="menu-icon">${aboutIcon()}</span>
                    </button>
                    <button class="menu-button" id="open-feedback" title="${t('feedback')}" aria-label="${t('feedback')}">
                        <span class="menu-icon">${feedbackIcon()}</span>
                    </button>
                </div>
            </header>

            <section class="layout ${state.mode === 'chat' ? 'chat-layout' : ''} ${state.settings?.showHistory === false ? 'no-history-layout' : ''}">
                <div class="workspace">
                    ${renderWorkspace()}
                    ${state.notice ? `<div class="notice success">${escapeHTML(state.notice)}</div>` : ''}
                    ${state.error ? `<div class="notice error">${escapeHTML(state.error)}</div>` : ''}
                </div>
                ${renderSide()}
            </section>
            ${renderPanel()}
        </main>
    `.trim();

    if (!app.firstElementChild) {
        app.innerHTML = newHTML;
        bindEvents();
    } else {
        morphdom(app.firstElementChild, newHTML);
        bindEvents();
    }

    // 恢复各滚动区域的滚动位置
    scrollableSelectors.forEach(selector => {
        const pos = scrollPositions[selector];
        if (pos !== undefined && pos > 0) {
            const el = document.querySelector(selector);
            if (el) {
                el.scrollTop = pos;
            }
        }
    });

    // 额外防抖还原滚动位置到新的 modal 上
    let savedScrollTop = scrollPositions['.overlay .modal'] || 0;
    if (savedScrollTop > 0) {
        const newModalEl = document.querySelector('.overlay .modal');
        if (newModalEl) {
            newModalEl.scrollTop = savedScrollTop;
            setTimeout(() => {
                newModalEl.scrollTop = savedScrollTop;
            }, 0);
            setTimeout(() => {
                newModalEl.scrollTop = savedScrollTop;
            }, 50);
        }
    }

    updateChatQRPulseButton();
    pulseChatFrameQR();
    syncIdentityToChatFrame();
}

function syncIdentityToChatFrame() {
    const frame = document.querySelector<HTMLIFrameElement>('#chat-iframe');
    if (!frame) { return; }
    const src = frame.getAttribute('src') || '';
    if (!src || src === 'about:blank' || (!src.startsWith('http://') && !src.startsWith('https://'))) {
        return;
    }
    const name = (state.settings && state.settings.chatSender) ? state.settings.chatSender : 'Desktop';
    const avatar = (state.settings && state.settings.chatAvatar) ? state.settings.chatAvatar : '';
    const payload = {
        type: 'update-identity',
        name: name,
        avatar: avatar
    };
    const post = () => {
        try {
            const origin = activeChatFrameOrigin();
            frame.contentWindow?.postMessage(payload, origin || '*');
        } catch (e) {
            // Ignored
        }
    };
    frame.addEventListener('load', post, {once: true});
    window.setTimeout(post, 0);
}

function renderWorkspace() {
    if (state.mode === 'share') {
        return renderShare();
    }
    if (state.mode === 'receive') {
        return renderReceive();
    }
    return renderChat();
}

function renderShare() {
    const activeTask = activeShareTask();
    if (activeTask) {
        return renderShareTransfer(activeTask);
    }
    const items = state.sharePaths.map((item, index) => {
        const path = typeof item === 'string' ? item : item.path;
        const name = typeof item === 'string' ? shortName(item) : item.name;
        const size = typeof item === 'string' ? '' : item.size;
        return `
            <li>
                <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; padding-right: 12px; overflow: hidden;">
                    <strong style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: var(--text-primary); font-size: 13px; max-width: 280px;" title="${escapeHTML(name)}">${escapeHTML(name)}</strong>
                    <span class="file-size-badge" style="font-size: 12px; color: var(--text-secondary); margin-left: auto; margin-right: 8px; flex-shrink: 0; font-weight: 500;">${escapeHTML(size)}</span>
                </div>
                <button class="icon-button remove-path" data-path-index="${index}" title="${t('remove')}">x</button>
            </li>
        `;
    }).join('');
    const isPaid = state.status?.isPaid;
    const usedTransfers = state.status?.usedTransfers || 0;
    const remaining = Math.max(0, 5 - usedTransfers);

    const hasItems = state.sharePaths.length > 0;
    const isStartShareEnabled = !state.busy && hasItems && !state.shareLimitNotice;
    return `
        <div class="share-illustration-wrapper">
            <img src="${shareIllustrationURL}" alt="Share Onboarding" style="pointer-events: none; user-select: none; opacity: 0.85;" />
        </div>
        <div class="dropzone" style="--wails-drop-target: drop">
            <div class="drop-target" style="pointer-events: none;">
                <div class="drop-title" style="pointer-events: none;">${t('drag_drop_tips')}</div>
                <div class="drop-subtitle" style="pointer-events: none;">${hasItems ? `${state.sharePaths.length} ${t('items_ready')}` : t('or_click_to')}</div>
            </div>
            <div class="actions">
                <button type="button" id="choose-files">${t('select_files')}</button>
                <button type="button" id="choose-folder" class="secondary">${t('select_folder')}</button>
            </div>
        </div>
        ${state.shareLimitNotice ? `
            <div class="share-limit-notice" style="color: var(--danger); font-size: 12px; font-weight: 700; text-align: left; margin: 12px 0; background: rgba(180, 35, 24, 0.05); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--danger); line-height: 1.4; display: flex; align-items: flex-start; gap: 6px;">
                <span>⚠️</span>
                <span>${escapeHTML(state.shareLimitNotice)}</span>
            </div>
        ` : ''}
        ${hasItems ? `<ul class="path-list">${items}</ul>` : ''}
        <div class="primary-row" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 18px;">
            <div style="display: flex; align-items: center; gap: 8px;">
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
                <button class="primary" id="start-share" ${state.busy || !hasItems || state.shareLimitNotice ? 'disabled' : ''}>${state.busy ? t('working') : t('start_transfer')}</button>
                <button class="ghost" id="clear-share" ${!hasItems ? 'disabled' : ''}>${t('clear')}</button>
            </div>
        </div>
    `;
}



function renderShareTransfer(task) {
    const qrImage = qrImageURL(task.pageUrl);

    const isSharedOrReceived = task.transferState !== 'waiting' && (task.transferState === 'transferring' || task.transferTarget || task.bytesDone > 0);
    const shouldCollapse = isSharedOrReceived;
    const isQRExpanded = qrExpandedManual !== null ? qrExpandedManual : !shouldCollapse;
    const collapseText = isQRExpanded ? t('hide_chat_qr') || '折叠二维码' : t('show_chat_qr') || '显示二维码';

    const isPaid = state.status?.isPaid;
    const usedTransfers = state.status?.usedTransfers || 0;
    const remaining = Math.max(0, 5 - usedTransfers);

    const countdownHtml = (!isPaid && remaining > 0) ? `
        <div class="quota-countdown" style="font-size: 11px; color: var(--danger); font-weight: 800; border: 1px solid var(--danger); padding: 4px 8px; border-radius: 6px; background: rgba(180, 35, 24, 0.05); text-transform: uppercase; letter-spacing: 0.05em; display: inline-block; white-space: nowrap; margin-top: 6px;">
            free ulimited: ${remaining}
        </div>
    ` : '';

    return `
        <div class="transfer-stage">
            <div class="transfer-head">
                <div>
                    <div class="eyebrow">${t('share_active')}</div>
                    <h2>${escapeHTML(getTranslatedState(task.transferState || task.state || 'waiting'))}</h2>
                    ${countdownHtml}
                </div>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <button class="danger inline stop-current-action">${t('stop')}</button>
                    <button class="side-icon-button toggle-qr-expand-action" title="${escapeAttr(collapseText)}" aria-label="${escapeAttr(collapseText)}">
                        ${qrIcon()}
                    </button>
                </div>
            </div>
            
            <div class="transfer-meta-row" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: -6px; padding-bottom: 8px; border-bottom: 1.2px solid var(--line); box-sizing: border-box; width: 100%;">
                <div class="transfer-devices-badge" style="font-size: 13px; font-weight: 700; color: var(--text-secondary); display: flex; align-items: center; gap: 4px;">
                    👥 ${t('devices_count') || '设备数'}: <span id="current-devices-count" style="color: var(--accent-strong); font-weight: 800;">${task.clientStates ? Object.keys(task.clientStates).length : 0}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px; position: relative;">
                    <span class="has-tooltip has-tooltip-bottom-left" data-tooltip="${escapeAttr(t('auto_stop_tooltip'))}" style="font-size: 12px; font-weight: 600; color: var(--text-secondary); border-bottom: 1px dashed var(--text-muted); padding-bottom: 1px; cursor: help;">
                        ${t('auto_stop_label')}
                    </span>
                    ${renderSwitch('auto-stop-switch', task.transferAutoStop)}
                </div>
            </div>
            
            <div id="share-qr-wrapper">
                ${isQRExpanded && qrImage ? `
                    <div class="qr-hero">
                        <img src="${escapeAttr(qrImage)}" alt="Transfer QR code" />
                        <button class="ghost open-qr" data-open-url="${escapeAttr(task.pageUrl)}">${t('open_in_browser')}</button>
                    </div>
                ` : (isQRExpanded ? `<div class="empty-state transfer-empty" style="margin-top: 12px;">${t('waiting_qr')}</div>` : '')}
            </div>
            
            <div id="devices-progress-wrapper">${renderDeviceProgressHtml(task)}</div>

            <div class="locked-list">
                <strong>${t('locked_list')}</strong>
                <ul class="path-list locked" id="share-locked-path-list">${renderShareLockedPathsHtml(task)}</ul>
            </div>
            ${task.error ? `<div class="notice error compact">${escapeHTML(task.error)}</div>` : ''}
        </div>
    `;
}

function renderDeviceProgressHtml(task) {
    let deviceProgressHtml = '';
    const clients = task.clientStates ? Object.values(task.clientStates) : [];
    if (clients.length > 0) {
        const listItems = clients.map((clientObj: any) => {
            const client = clientObj;
            const devName = client.deviceName || t('device') || 'Device';
            const clientID = client.clientID || '';
            let displayName = devName;
            if (!displayName.includes('(') && clientID) {
                const shortId = clientID.length > 4 ? clientID.substring(clientID.length - 4) : clientID;
                displayName = `${displayName} (${shortId})`;
            }
            const stateText = getTranslatedState(client.state || 'waiting');
            const percent = client.percent || 0;

            const formatSize = (bytes) => {
                if (!bytes) return '0 B';
                const k = 1024;
                const sizes = ['B', 'KB', 'MB', 'GB'];
                const i = Math.floor(Math.log(bytes) / Math.log(k));
                return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
            };

            const bytesDone = formatSize(client.bytesDone);
            const bytesTotal = formatSize(client.bytesTotal);
            const sizeProgressText = client.bytesTotal > 0 ? `(${bytesDone}/${bytesTotal})` : '';

            const showProgress = (((client.state === 'transferring' || client.state === 'waiting') && (client.bytesDone || 0) > 0) || client.state === 'completed') && client.bytesTotal > 0;
            const progressSectionHtml = showProgress ? `
                <div style="flex: 1; height: 6px; background: rgba(0,0,0,0.06); border-radius: 3px; overflow: hidden; position: relative; margin: 0 12px 0 0; min-width: 60px;">
                    <div style="width: ${percent}%; height: 100%; background: var(--accent); border-radius: 3px;"></div>
                </div>
            ` : `
                <div style="flex: 1; margin: 0 12px 0 0; border-bottom: 1.2px dashed var(--line); min-width: 60px;"></div>
            `;

            let stateBadgeHtml = '';
            if (client.state === 'completed') {
                stateBadgeHtml = `<span style="display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 50%; background: var(--accent-light); border: 1px solid var(--accent-border); color: var(--accent); font-size: 9px; font-weight: 900;" title="${escapeAttr(t('completed') || 'Completed')}">✓</span>`;
            } else if (client.state === 'failed') {
                stateBadgeHtml = `<span style="display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 50%; background: rgba(180,35,24,0.08); border: 1px solid rgba(180,35,24,0.2); color: var(--danger); font-size: 9px; font-weight: 900;" title="${escapeAttr(client.message || t('failed') || 'Failed')}">✕</span>`;
            } else if (client.state === 'waiting') {
                stateBadgeHtml = `<span style="display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 50%; background: rgba(0,0,0,0.04); border: 1px solid var(--line); color: var(--text-secondary); font-size: 8px; font-weight: 900;" title="${escapeAttr(t('waiting') || 'Waiting')}">⌛</span>`;
            } else {
                stateBadgeHtml = `<span style="color: var(--accent-strong); font-size: 11px; font-weight: 800;">${percent}%</span>`;
            }

            return `
                <li style="display: flex; flex-direction: column; padding: 8px 10px; background: var(--bg-hover); border-radius: 6px; margin-bottom: 4px; box-sizing: border-box; width: 100%; overflow: hidden; border: 1.2px solid var(--line); list-style: none; gap: 6px;">
                    <!-- 第一行: 设备名 与 传输文件名同一行 -->
                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                        <span style="color: var(--text-primary); font-size: 11px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left; flex: 1; min-width: 0;" title="${escapeHTML(devName)}${clientID ? ' (ID: ' + escapeHTML(clientID) + ')' : ''}">
                            ${escapeHTML(displayName)}${client.current ? ` <span style="color: var(--text-secondary); font-weight: 500; font-size: 11px; margin-left: 4px;">- ${escapeHTML(client.current)}</span>` : ''}
                        </span>
                    </div>
                    <!-- 第二行: 进度条, 大小和状态 -->
                    <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                        ${progressSectionHtml}
                        <div style="display: flex; align-items: center; gap: 6px; white-space: nowrap; flex-shrink: 0;">
                            ${showProgress ? `<span style="font-size: 9px; color: var(--text-secondary); font-weight: 500;">${escapeHTML(sizeProgressText)}</span>` : ''}
                            ${stateBadgeHtml}
                        </div>
                    </div>
                </li>
            `;
        }).join('');

        const scrollStyle = 'max-height: 220px; overflow-y: auto; overflow-x: hidden; border: 1.2px solid var(--line); padding: 8px; border-radius: 8px; box-sizing: border-box;';

        deviceProgressHtml = `
            <div class="devices-progress-section" style="margin: 6px 0 14px 0; text-align: left; box-sizing: border-box; width: 100%;">
                <strong style="display: block; font-size: 12px; font-weight: 700; color: var(--text-secondary); margin-bottom: 8px;">${t('devices_progress') || '设备传输进度'}</strong>
                <div class="devices-scroll-container" style="${scrollStyle}">
                    <ul style="list-style: none; padding: 0; margin: 0; width: 100%; overflow: hidden;">${listItems}</ul>
                </div>
            </div>
        `;
    } else {
        deviceProgressHtml = `
            <div class="devices-progress-section" style="margin: 6px 0 14px 0; text-align: left; box-sizing: border-box; width: 100%;">
                <strong style="display: block; font-size: 12px; font-weight: 700; color: var(--text-secondary); margin-bottom: 8px;">${t('devices_progress') || '设备传输进度'}</strong>
                <div style="border: 1px dashed var(--line); border-radius: 6px; padding: 12px; text-align: center; color: var(--text-muted); font-size: 12px; font-weight: 500; box-sizing: border-box; width: 100%;">
                    ${t('no_devices_download')}
                </div>
            </div>
        `;
    }
    return deviceProgressHtml;
}

function renderShareLockedPathsHtml(task) {
    const paths = task.paths || [];
    return paths.map((path, index) => {
        return `
        <li>
            <div style="width: 100%; box-sizing: border-box; min-width: 0;">
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; width: 100%; min-width: 0;">
                    <div style="flex: 1; text-align: left; overflow: hidden; min-width: 0;">
                        <div class="filename-scroll-container">
                            <strong title="${escapeAttr(shortName(path))}">${escapeHTML(shortName(path))}</strong>
                        </div>
                        <span style="display: block; font-size: 11px; color: var(--text-secondary); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(path)}</span>
                    </div>
                    <div style="flex: 0 0 auto; text-align: right; min-width: 0; margin-left: 8px;">
                        <span class="item-status" style="font-size: 12px; font-weight: 600; color: var(--accent-strong); white-space: nowrap;">
                            ${escapeHTML(shareItemStatus(task, path))}
                        </span>
                    </div>
                </div>
            </div>
        </li>
        `;
    }).join('');
}

function updateShareTransferActiveUI(task) {
    // 1. 传输状态文字
    const statusH2 = document.querySelector('.transfer-stage .transfer-head h2');
    if (statusH2) {
        statusH2.textContent = getTranslatedState(task.transferState || task.state || 'waiting');
    }

    // 2. 设备数
    const countEl = document.getElementById('current-devices-count');
    if (countEl) {
        countEl.textContent = String(task.clientStates ? Object.keys(task.clientStates).length : 0);
    }

    // 3. 自动结束开关
    const switchEl = document.getElementById('auto-stop-switch') as HTMLInputElement | null;
    if (switchEl) {
        switchEl.checked = !!task.transferAutoStop;
    }

    // 4. 设备进度列表局部更新
    const devicesWrapper = document.getElementById('devices-progress-wrapper');
    if (devicesWrapper) {
        const scrollContainer = devicesWrapper.querySelector('.devices-scroll-container');
        const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
        devicesWrapper.innerHTML = renderDeviceProgressHtml(task);
        const newScrollContainer = devicesWrapper.querySelector('.devices-scroll-container');
        if (newScrollContainer) {
            newScrollContainer.scrollTop = scrollTop;
        }
    }

    // 5. 锁定文件状态局部更新
    const pathList = document.getElementById('share-locked-path-list');
    if (pathList) {
        pathList.innerHTML = renderShareLockedPathsHtml(task);
    }

    // 6. 更新 quota 倒计时 (如果有的话)
    const quotaCountdown = document.querySelector('.transfer-stage .quota-countdown');
    const isPaid = state.status?.isPaid;
    const usedTransfers = state.status?.usedTransfers || 0;
    const remaining = Math.max(0, 5 - usedTransfers);
    const shouldShowCountdown = (!isPaid && remaining > 0);
    
    if (shouldShowCountdown) {
        const text = remaining > 0 ? `free ulimited: ${remaining}` : `free limit exceeded (restricted)`;
        if (quotaCountdown) {
            quotaCountdown.textContent = text;
        } else {
            // 如果本来没有但现在有了，在 H2 后插入
            const headerDiv = document.querySelector('.transfer-stage .transfer-head > div');
            if (headerDiv) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = `
                    <div class="quota-countdown" style="font-size: 11px; color: var(--danger); font-weight: 800; border: 1px solid var(--danger); padding: 4px 8px; border-radius: 6px; background: rgba(180, 35, 24, 0.05); text-transform: uppercase; letter-spacing: 0.05em; display: inline-block; white-space: nowrap; margin-top: 6px;">
                        ${text}
                    </div>
                `;
                headerDiv.appendChild(tempDiv.firstElementChild);
            }
        }
    } else {
        if (quotaCountdown) {
            quotaCountdown.remove();
        }
    }

    // 7. 更新二维码区域，避免局部刷新时丢失二维码
    const qrWrapper = document.getElementById('share-qr-wrapper');
    if (qrWrapper) {
        const qrImage = qrImageURL(task.pageUrl);
        const isSharedOrReceived = task.transferState !== 'waiting' && (task.transferState === 'transferring' || task.transferTarget || task.bytesDone > 0);
        const shouldCollapse = isSharedOrReceived;
        const isQRExpanded = qrExpandedManual !== null ? qrExpandedManual : !shouldCollapse;
        
        const newQrHtml = isQRExpanded && qrImage ? `
            <div class="qr-hero">
                <img src="${escapeAttr(qrImage)}" alt="Transfer QR code" />
                <button class="ghost open-qr" data-open-url="${escapeAttr(task.pageUrl)}">${t('open_in_browser')}</button>
            </div>
        ` : (isQRExpanded ? `<div class="empty-state transfer-empty" style="margin-top: 12px;">${t('waiting_qr')}</div>` : '');
        
        if (qrWrapper.innerHTML.trim() !== newQrHtml.trim()) {
            qrWrapper.innerHTML = newQrHtml;
        }
    }
}

function activeReceiveTask() {
    const task = state.status?.current;
    if (!task || task.action !== 'receive' || isTaskClosed(task)) {
        return null;
    }
    return task;
}

function renderReceive() {
    const activeTask = activeReceiveTask();
    if (activeTask) {
        return renderReceiveTransfer(activeTask);
    }
    const output = state.receiveDir || state.settings?.output || '';
    return `
        <div class="receive-illustration-wrapper">
            <img src="${receiveIllustrationURL}" alt="Receive Onboarding" style="pointer-events: none; user-select: none; opacity: 0.85;" />
        </div>
        <div class="receive-box">
            <label>${t('receive_dir')}</label>
            <div class="directory-row">
                <input id="receive-dir" value="${escapeAttr(output)}" placeholder="Choose a folder" />
                <button id="choose-receive">${t('choose')}</button>
            </div>
        </div>
        <div class="primary-row" style="width: 100%; display: flex; justify-content: center; gap: 12px; margin-top: 18px;">
            <button class="primary" id="start-receive" ${state.busy || !output.trim() ? 'disabled' : ''} style="width: 180px; flex: none;">${state.busy ? t('working') : t('start_receive')}</button>
            <button class="ghost" id="save-receive-dir" ${!output.trim() ? 'disabled' : ''} style="width: 180px; flex: none;">${t('save_dir')}</button>
        </div>
    `;
}

function renderReceiveTransfer(task) {
    const qrImage = qrImageURL(task.pageUrl);
    const files = task.savedFiles || [];

    const isSharedOrReceived = task.transferState !== 'waiting' && (task.transferState === 'transferring' || task.transferTarget || task.bytesDone > 0 || files.length > 0);
    const shouldCollapse = isSharedOrReceived;
    const isQRExpanded = qrExpandedManual !== null ? qrExpandedManual : !shouldCollapse;
    const collapseText = isQRExpanded ? t('hide_chat_qr') || '折叠二维码' : t('show_chat_qr') || '显示二维码';

    const isPaid = state.status?.isPaid;
    const usedReceiveTransfers = state.status?.usedReceiveTransfers || 0;
    const remaining = Math.max(0, 5 - usedReceiveTransfers);

    const countdownHtml = (!isPaid && remaining > 0) ? `
        <div class="quota-countdown" style="font-size: 11px; color: var(--danger); font-weight: 800; border: 1px solid var(--danger); padding: 4px 8px; border-radius: 6px; background: rgba(180, 35, 24, 0.05); text-transform: uppercase; letter-spacing: 0.05em; display: inline-block; white-space: nowrap; margin-top: 6px;">
            free ulimited: ${remaining}
        </div>
    ` : '';

    return `
        <div class="transfer-stage">
            <div class="transfer-head">
                <div>
                    <div class="eyebrow">${t('receive_active')}</div>
                    <h2>${escapeHTML(getTranslatedState(task.transferState || task.state || 'waiting'))}</h2>
                    ${countdownHtml}
                </div>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <button class="danger inline stop-current-action">${t('stop')}</button>
                    <button class="side-icon-button toggle-qr-expand-action" title="${escapeAttr(collapseText)}" aria-label="${escapeAttr(collapseText)}">
                        ${qrIcon()}
                    </button>
                </div>
            </div>

            <div class="transfer-meta-row" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: -6px; padding-bottom: 8px; border-bottom: 1.2px solid var(--line); box-sizing: border-box; width: 100%;">
                <div class="transfer-devices-badge" style="font-size: 13px; font-weight: 700; color: var(--text-secondary); display: flex; align-items: center; gap: 4px;">
                    👥 ${t('devices_count') || '设备数'}: <span id="current-devices-count" style="color: var(--accent-strong); font-weight: 800;">${task.clientStates ? Object.keys(task.clientStates).length : 0}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px; position: relative;">
                    <span class="has-tooltip has-tooltip-bottom-left" data-tooltip="${escapeAttr(t('auto_stop_tooltip'))}" style="font-size: 12px; font-weight: 600; color: var(--text-secondary); border-bottom: 1px dashed var(--text-muted); padding-bottom: 1px; cursor: help;">
                        ${t('auto_stop_label')}
                    </span>
                    ${renderSwitch('auto-stop-switch', task.transferAutoStop)}
                </div>
            </div>
            
            ${isQRExpanded && qrImage ? `
                <div class="qr-hero">
                    <img src="${escapeAttr(qrImage)}" alt="Transfer QR code" />
                    <button class="ghost open-qr" data-open-url="${escapeAttr(task.pageUrl)}">${t('open_in_browser')}</button>
                </div>
            ` : (isQRExpanded ? `<div class="empty-state transfer-empty" style="margin-top: 12px;">${t('waiting_qr')}</div>` : '')}
            
            <div id="receive-devices-progress-wrapper">${renderReceiveDeviceProgressHtml(task)}</div>

            ${task.error ? `<div class="notice error compact">${escapeHTML(task.error)}</div>` : ''}
        </div>
    `;
}

function renderReceiveDeviceProgressHtml(task) {
    let deviceProgressHtml = '';
    const clients = task.clientStates ? Object.values(task.clientStates) : [];
    const recvDir = state.receiveDir || state.settings?.output || '';
    const headerHtml = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <strong style="font-size: 12px; font-weight: 700; color: var(--text-secondary); margin: 0;">${t('devices_progress') || '设备传输进度'}</strong>
            ${recvDir ? `
                <button class="icon-button-mini path-link" data-open-path="${escapeAttr(recvDir)}" title="${escapeAttr(t('open_folder_title') || '打开接收文件夹')}" style="padding: 4px; display: inline-flex; align-items: center; justify-content: center; height: 22px; width: 22px; min-height: unset; margin: 0;">
                    ${openFolderIcon()}
                </button>
            ` : ''}
        </div>
    `;
    if (clients.length > 0) {
        state.deviceFilesExpanded = state.deviceFilesExpanded || {};

        const listItems = clients.map((clientObj: any) => {
            const client = clientObj;
            const devName = client.deviceName || t('device') || 'Device';
            const clientID = client.clientID || '';
            let displayName = devName;
            if (!displayName.includes('(') && clientID) {
                const shortId = clientID.length > 4 ? clientID.substring(clientID.length - 4) : clientID;
                displayName = `${displayName} (${shortId})`;
            }
            const stateText = getTranslatedState(client.state || 'waiting');
            const percent = client.percent || 0;
            const currentFile = client.current || '';
            const formatSize = (bytes) => {
                if (!bytes) return '0 B';
                const k = 1024;
                const sizes = ['B', 'KB', 'MB', 'GB'];
                const i = Math.floor(Math.log(bytes) / Math.log(k));
                return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
            };

            const totalFilesCount = client.files ? client.files.length : 0;
            const completedFilesCount = client.files ? client.files.filter(f => f.state === 'completed').length : 0;
            let statusCountText = '';
            if (totalFilesCount > 0) {
                statusCountText = ` (${completedFilesCount}/${totalFilesCount})`;
            } else {
                const savedLen = (client.savedFiles || []).length;
                if (client.state === 'transferring' && currentFile) {
                    statusCountText = ` (${savedLen}/${savedLen + 1})`;
                } else if (savedLen > 0) {
                    statusCountText = ` (${savedLen}/${savedLen})`;
                }
            }
            displayName = `${displayName}${statusCountText}`;

            let filesHtml = '';
            const files = client.files || [];
            if (files.length > 0) {
                const mappedFiles = files.map((file, idx) => {
                    file._naturalIndex = idx;
                    return file;
                });
                const sortedFiles = [...mappedFiles].sort((a, b) => {
                    const statePriority = { 'transferring': 1, 'waiting': 2, 'completed': 3, 'failed': 4 };
                    const pA = statePriority[a.state] || 5;
                    const pB = statePriority[b.state] || 5;
                    if (pA !== pB) return pA - pB;
                    return b._naturalIndex - a._naturalIndex;
                });
                filesHtml = sortedFiles.map((file, idx) => {
                    const name = file.name || 'File';
                    const percent = file.percent || 0;
                    const stateText = file.state || 'waiting';
                    const path = file.path || '';
                    const bytesDone = formatSize(file.bytesDone);
                    const bytesTotal = formatSize(file.bytesTotal);
                    const sizeProgressText = file.bytesTotal > 0 ? `${bytesDone} / ${bytesTotal}` : '';

                    let progressRightStr = sizeProgressText;
                    let bgStyle = 'background: rgba(0,0,0,0.02); border: 1px solid var(--line);';
                    let namePrefix = '📄';

                    if (stateText === 'completed') {
                        namePrefix = '✓';
                        progressRightStr = sizeProgressText || t('completed') || 'Completed';
                        bgStyle = 'background: rgba(15, 118, 110, 0.02); border: 1px solid rgba(15, 118, 110, 0.1);';
                    } else if (stateText === 'transferring') {
                        namePrefix = '⟳';
                        progressRightStr = sizeProgressText || `${percent}%`;
                        bgStyle = 'background: rgba(15, 118, 110, 0.06); border: 1px solid rgba(15, 118, 110, 0.2);';
                    } else if (stateText === 'failed') {
                        namePrefix = '✕';
                        progressRightStr = t('failed') || 'Failed';
                        bgStyle = 'background: rgba(180,35,24,0.03); border: 1px solid rgba(180,35,24,0.15);';
                    } else {
                        namePrefix = '⌛';
                        progressRightStr = sizeProgressText || t('waiting') || 'Waiting';
                        bgStyle = 'background: rgba(0,0,0,0.01); border: 1px solid var(--line); opacity: 0.7;';
                    }

                    const openFileTooltip = t('open_file_title', { file: name });

                    return `
                        <div id="receive-file-row-${escapeAttr(clientID)}-${idx}" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; border-radius: 6px; margin-top: 4px; width: 100%; min-width: 0; box-sizing: border-box; gap: 8px; ${bgStyle}">
                            <span id="receive-file-name-${escapeAttr(clientID)}-${idx}" style="font-size: 11px; font-weight: 700; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; text-align: left; min-width: 0;" title="${escapeAttr(path || name)}">${namePrefix} ${escapeHTML(name)}</span>
                            <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0; white-space: nowrap;">
                                <span id="receive-file-progress-${escapeAttr(clientID)}-${idx}" style="font-size: 10px; color: var(--text-secondary); font-weight: 600;">${escapeHTML(progressRightStr)}</span>
                                <div id="receive-file-action-container-${escapeAttr(clientID)}-${idx}" style="display: flex; gap: 4px; align-items: center; margin-left: 2px;">
                                    ${stateText === 'completed' && path ? `
                                        <button class="icon-button-mini open-file-action" data-open-file="${escapeAttr(path)}" title="${escapeAttr(openFileTooltip)}" style="padding: 2px; min-height: unset; height: 18px; width: 18px;">
                                            ${openFileIcon()}
                                        </button>
                                    ` : ''}
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            } else {
                const fallbackList = [];
                if (client.state === 'transferring' && currentFile) {
                    fallbackList.push({
                        name: shortName(currentFile),
                        path: currentFile,
                        state: 'transferring',
                        percent: percent,
                        bytesDone: client.bytesDone,
                        bytesTotal: client.bytesTotal
                    });
                }
                const oldSaved = client.savedFiles || [];
                const revSaved = [...oldSaved].reverse();
                revSaved.forEach(file => {
                    fallbackList.push({
                        name: shortName(file),
                        path: file,
                        state: 'completed',
                        percent: 100
                    });
                });

                const mappedFallback = fallbackList.map((item, idx) => {
                    item._naturalIndex = idx;
                    return item;
                });
                const sortedFallback = [...mappedFallback].sort((a, b) => {
                    const statePriority = { 'transferring': 1, 'waiting': 2, 'completed': 3, 'failed': 4 };
                    const pA = statePriority[a.state] || 5;
                    const pB = statePriority[b.state] || 5;
                    if (pA !== pB) return pA - pB;
                    return b._naturalIndex - a._naturalIndex;
                });
                filesHtml = sortedFallback.map((file, idx) => {
                    const name = file.name || 'File';
                    const percent = file.percent || 0;
                    const stateText = file.state || 'waiting';
                    const path = file.path || '';
                    const bytesDone = formatSize(file.bytesDone);
                    const bytesTotal = formatSize(file.bytesTotal);
                    const sizeProgressText = file.bytesTotal > 0 ? `${bytesDone} / ${bytesTotal}` : '';

                    let progressRightStr = sizeProgressText;
                    let bgStyle = 'background: rgba(0,0,0,0.02); border: 1px solid var(--line);';
                    let namePrefix = '📄';

                    if (stateText === 'completed') {
                        namePrefix = '✓';
                        progressRightStr = sizeProgressText || t('completed') || 'Completed';
                        bgStyle = 'background: rgba(15, 118, 110, 0.02); border: 1px solid rgba(15, 118, 110, 0.1);';
                    } else if (stateText === 'transferring') {
                        namePrefix = '⟳';
                        progressRightStr = sizeProgressText || `${percent}%`;
                        bgStyle = 'background: rgba(15, 118, 110, 0.06); border: 1px solid rgba(15, 118, 110, 0.2);';
                    } else if (stateText === 'failed') {
                        namePrefix = '✕';
                        progressRightStr = t('failed') || 'Failed';
                        bgStyle = 'background: rgba(180,35,24,0.03); border: 1px solid rgba(180,35,24,0.15);';
                    } else {
                        namePrefix = '⌛';
                        progressRightStr = sizeProgressText || t('waiting') || 'Waiting';
                        bgStyle = 'background: rgba(0,0,0,0.01); border: 1px solid var(--line); opacity: 0.7;';
                    }

                    const openFileTooltip = t('open_file_title', { file: name });

                    return `
                        <div id="receive-file-row-${escapeAttr(clientID)}-${idx}" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; border-radius: 6px; margin-top: 4px; width: 100%; min-width: 0; box-sizing: border-box; gap: 8px; ${bgStyle}">
                            <span id="receive-file-name-${escapeAttr(clientID)}-${idx}" style="font-size: 11px; font-weight: 700; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; text-align: left; min-width: 0;" title="${escapeAttr(path || name)}">${namePrefix} ${escapeHTML(name)}</span>
                            <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0; white-space: nowrap;">
                                <span id="receive-file-progress-${escapeAttr(clientID)}-${idx}" style="font-size: 10px; color: var(--text-secondary); font-weight: 600;">${escapeHTML(progressRightStr)}</span>
                                <div id="receive-file-action-container-${escapeAttr(clientID)}-${idx}" style="display: flex; gap: 4px; align-items: center; margin-left: 2px;">
                                    ${stateText === 'completed' && path ? `
                                        <button class="icon-button-mini open-file-action" data-open-file="${escapeAttr(path)}" title="${escapeAttr(openFileTooltip)}" style="padding: 2px; min-height: unset; height: 18px; width: 18px;">
                                            ${openFileIcon()}
                                        </button>
                                    ` : ''}
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            }

            let stateBadgeHtml = '';
            if (client.state === 'completed') {
                stateBadgeHtml = `<span style="display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 50%; background: var(--accent-light); border: 1px solid var(--accent-border); color: var(--accent); font-size: 9px; font-weight: 900;" title="${escapeAttr(t('completed') || 'Completed')}">✓</span>`;
            } else if (client.state === 'failed') {
                stateBadgeHtml = `<span style="display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 50%; background: rgba(180,35,24,0.08); border: 1px solid rgba(180,35,24,0.2); color: var(--danger); font-size: 9px; font-weight: 900;" title="${escapeAttr(client.message || t('failed') || 'Failed')}">✕</span>`;
            } else if (client.state === 'waiting') {
                stateBadgeHtml = `<span style="display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 50%; background: rgba(0,0,0,0.04); border: 1px solid var(--line); color: var(--text-secondary); font-size: 8px; font-weight: 900;" title="${escapeAttr(t('waiting') || 'Waiting')}">⌛</span>`;
            } else {
                stateBadgeHtml = `<span style="color: var(--accent-strong); font-size: 11px; font-weight: 800;">${percent}%</span>`;
            }

            const isFilesExpanded = !!state.deviceFilesExpanded[clientID];
            const arrowSvg = `
                <svg id="receive-client-arrow-${escapeAttr(clientID)}" class="chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="width: 10px; height: 10px; color: var(--text-secondary); margin-right: 6px; transition: transform 0.2s ease-in-out; transform: rotate(${isFilesExpanded ? '90deg' : '0deg'}); display: inline-block;">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            `;

            return `
                <li id="receive-client-li-${escapeAttr(clientID)}" data-expanded="${isFilesExpanded}" style="padding: 8px 10px; background: var(--bg-hover); border-radius: 6px; margin-bottom: 6px; box-sizing: border-box; width: 100%; overflow: hidden; border: 1.2px solid var(--line); list-style: none;">
                    <div class="device-header-toggle" data-client-id="${escapeAttr(clientID)}" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none; min-width: 0;">
                        <span id="receive-client-name-${escapeAttr(clientID)}" style="color: var(--text-primary); font-size: 12px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left; flex: 1; display: flex; align-items: center; min-width: 0;" title="${escapeHTML(devName)}${clientID ? ' (ID: ' + escapeHTML(clientID) + ')' : ''}">
                            ${arrowSvg}<span id="receive-client-name-text-${escapeAttr(clientID)}" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;">${escapeHTML(displayName)}</span>
                        </span>
                        <div id="receive-client-status-badge-${escapeAttr(clientID)}" style="display: flex; align-items: center; gap: 6px; white-space: nowrap; flex-shrink: 0;">
                            <span style="font-size: 10px; color: var(--text-secondary); font-weight: 600;">${stateText}</span>
                            ${stateBadgeHtml}
                        </div>
                    </div>
                    ${isFilesExpanded ? `
                    <div style="margin-top: 6px; display: flex; flex-direction: column; gap: 2px; box-sizing: border-box; width: 100%; min-width: 0; overflow: hidden;">
                        ${filesHtml}
                    </div>
                    ` : ''}
                </li>
            `;
        }).join('');

        const scrollStyle = 'max-height: 320px; overflow-y: auto; overflow-x: hidden; border: 1.2px solid var(--line); padding: 8px; border-radius: 8px; box-sizing: border-box;';

        deviceProgressHtml = `
            <div class="devices-progress-section" style="margin: 6px 0 14px 0; text-align: left; box-sizing: border-box; width: 100%;">
                ${headerHtml}
                <div class="devices-scroll-container" style="${scrollStyle}">
                    <ul style="list-style: none; padding: 0; margin: 0; width: 100%; overflow: hidden;">${listItems}</ul>
                </div>
            </div>
        `;
    } else {
        deviceProgressHtml = `
            <div class="devices-progress-section" style="margin: 6px 0 14px 0; text-align: left; box-sizing: border-box; width: 100%;">
                ${headerHtml}
                <div style="border: 1px dashed var(--line); border-radius: 6px; padding: 12px; text-align: center; color: var(--text-muted); font-size: 12px; font-weight: 500; box-sizing: border-box; width: 100%;">
                    ${t('no_devices_upload')}
                </div>
            </div>
        `;
    }
    return deviceProgressHtml;
}

function updateReceiveTransferActiveUI(task) {
    const statusH2 = document.querySelector('.transfer-stage .transfer-head h2');
    if (statusH2) {
        statusH2.textContent = getTranslatedState(task.transferState || task.state || 'waiting');
    }

    const countEl = document.getElementById('current-devices-count');
    if (countEl) {
        countEl.textContent = String(task.clientStates ? Object.keys(task.clientStates).length : 0);
    }

    const switchEl = document.getElementById('auto-stop-switch') as HTMLInputElement | null;
    if (switchEl) {
        switchEl.checked = !!task.transferAutoStop;
    }

    const devicesWrapper = document.getElementById('receive-devices-progress-wrapper');
    if (devicesWrapper) {
        const clients = task.clientStates ? Object.values(task.clientStates) as any[] : [];
        const hasSkeleton = !!devicesWrapper.querySelector('.devices-scroll-container');
        
        const needsRebuild = () => {
            if (!hasSkeleton) return true;
            const renderedLis = devicesWrapper.querySelectorAll('li[id^="receive-client-li-"]');
            if (renderedLis.length !== clients.length) return true;
            for (let i = 0; i < clients.length; i++) {
                const client = clients[i];
                const li = devicesWrapper.querySelector(`#receive-client-li-${escapeAttr(client.clientID)}`);
                if (!li) return true;
                
                const isExpandedInDom = li.getAttribute('data-expanded') === 'true';
                const isExpandedInState = !!state.deviceFilesExpanded[client.clientID];
                if (isExpandedInDom !== isExpandedInState) return true;
                
                const files = client.files || [];
                const renderedFileRows = li.querySelectorAll('div[id^="receive-file-row-"]');
                let expectedFileCount = files.length;
                if (files.length === 0) {
                    const fallbackListLen = (client.state === 'transferring' && client.current ? 1 : 0) + (client.savedFiles || []).length;
                    expectedFileCount = fallbackListLen;
                }
                if (isExpandedInState && renderedFileRows.length !== expectedFileCount) return true;
            }
            return false;
        };

        if (needsRebuild()) {
            const scrollContainer = devicesWrapper.querySelector('.devices-scroll-container');
            const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
            devicesWrapper.innerHTML = renderReceiveDeviceProgressHtml(task);
            const newScrollContainer = devicesWrapper.querySelector('.devices-scroll-container');
            if (newScrollContainer) {
                newScrollContainer.scrollTop = scrollTop;
            }
        } else {
            clients.forEach((clientObj: any) => {
                const client = clientObj;
                const clientID = client.clientID;
                const devName = client.deviceName || 'Device';
                let displayName = devName;
                if (!displayName.includes('(') && clientID) {
                    const shortId = clientID.length > 4 ? clientID.substring(clientID.length - 4) : clientID;
                    displayName = `${displayName} (${shortId})`;
                }
                const stateText = getTranslatedState(client.state || 'waiting');
                const percent = client.percent || 0;
                const currentFile = client.current || '';

                const totalFilesCount = client.files ? client.files.length : 0;
                const completedFilesCount = client.files ? client.files.filter(f => f.state === 'completed').length : 0;
                let statusCountText = '';
                if (totalFilesCount > 0) {
                    statusCountText = ` (${completedFilesCount}/${totalFilesCount})`;
                } else {
                    const savedLen = (client.savedFiles || []).length;
                    if (client.state === 'transferring' && currentFile) {
                        statusCountText = ` (${savedLen}/${savedLen + 1})`;
                    } else if (savedLen > 0) {
                        statusCountText = ` (${savedLen}/${savedLen})`;
                    }
                }
                displayName = `${displayName}${statusCountText}`;

                const clientNameTextEl = document.getElementById(`receive-client-name-text-${clientID}`);
                if (clientNameTextEl) {
                    clientNameTextEl.textContent = displayName;
                }

                const arrowEl = document.getElementById(`receive-client-arrow-${clientID}`);
                if (arrowEl) {
                    const isFilesExpanded = !!state.deviceFilesExpanded[clientID];
                    arrowEl.style.transform = isFilesExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
                }

                const statusBadgeEl = document.getElementById(`receive-client-status-badge-${clientID}`);
                if (statusBadgeEl) {
                    let stateBadgeHtml = '';
                    if (client.state === 'completed') {
                        stateBadgeHtml = `<span style="display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 50%; background: var(--accent-light); border: 1px solid var(--accent-border); color: var(--accent); font-size: 9px; font-weight: 900;" title="${escapeAttr(t('completed') || 'Completed')}">✓</span>`;
                    } else if (client.state === 'failed') {
                        stateBadgeHtml = `<span style="display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 50%; background: rgba(180,35,24,0.08); border: 1px solid rgba(180,35,24,0.2); color: var(--danger); font-size: 9px; font-weight: 900;" title="${escapeAttr(client.message || t('failed') || 'Failed')}">✕</span>`;
                    } else if (client.state === 'waiting') {
                        stateBadgeHtml = `<span style="display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 50%; background: rgba(0,0,0,0.04); border: 1px solid var(--line); color: var(--text-secondary); font-size: 8px; font-weight: 900;" title="${escapeAttr(t('waiting') || 'Waiting')}">⌛</span>`;
                    } else {
                        stateBadgeHtml = `<span style="color: var(--accent-strong); font-size: 11px; font-weight: 800;">${percent}%</span>`;
                    }
                    statusBadgeEl.innerHTML = `<span style="font-size: 10px; color: var(--text-secondary); font-weight: 600;">${stateText}</span>${stateBadgeHtml}`;
                }

                const formatSize = (bytes) => {
                    if (!bytes) return '0 B';
                    const k = 1024;
                    const sizes = ['B', 'KB', 'MB', 'GB'];
                    const i = Math.floor(Math.log(bytes) / Math.log(k));
                    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
                };

                const files = client.files || [];
                if (files.length > 0) {
                    const mappedFiles = files.map((file, idx) => {
                        file._naturalIndex = idx;
                        return file;
                    });
                    const sortedFiles = [...mappedFiles].sort((a, b) => {
                        const statePriority = { 'transferring': 1, 'waiting': 2, 'completed': 3, 'failed': 4 };
                        const pA = statePriority[a.state] || 5;
                        const pB = statePriority[b.state] || 5;
                        if (pA !== pB) return pA - pB;
                        return b._naturalIndex - a._naturalIndex;
                    });

                    sortedFiles.forEach((file, idx) => {
                        const fNameEl = document.getElementById(`receive-file-name-${clientID}-${idx}`);
                        const fProgressEl = document.getElementById(`receive-file-progress-${clientID}-${idx}`);
                        const fActionEl = document.getElementById(`receive-file-action-container-${clientID}-${idx}`);
                        const fRowEl = document.getElementById(`receive-file-row-${clientID}-${idx}`);

                        const bytesDone = formatSize(file.bytesDone);
                        const bytesTotal = formatSize(file.bytesTotal);
                        const sizeProgressText = file.bytesTotal > 0 ? `${bytesDone} / ${bytesTotal}` : '';

                        let progressRightStr = sizeProgressText;
                        let bgStyle = 'background: rgba(0,0,0,0.02); border: 1px solid var(--line);';
                        let namePrefix = '📄';

                        if (file.state === 'completed') {
                            namePrefix = '✓';
                            progressRightStr = sizeProgressText || t('completed') || 'Completed';
                            bgStyle = 'background: rgba(15, 118, 110, 0.02); border: 1px solid rgba(15, 118, 110, 0.1);';
                        } else if (file.state === 'transferring') {
                            namePrefix = '⟳';
                            progressRightStr = sizeProgressText || `${file.percent || 0}%`;
                            bgStyle = 'background: rgba(15, 118, 110, 0.06); border: 1px solid rgba(15, 118, 110, 0.2);';
                        } else if (file.state === 'failed') {
                            namePrefix = '✕';
                            progressRightStr = t('failed') || 'Failed';
                            bgStyle = 'background: rgba(180,35,24,0.03); border: 1px solid rgba(180,35,24,0.15);';
                        } else {
                            namePrefix = '⌛';
                            progressRightStr = sizeProgressText || t('waiting') || 'Waiting';
                            bgStyle = 'background: rgba(0,0,0,0.01); border: 1px solid var(--line); opacity: 0.7;';
                        }

                        if (fRowEl) {
                            fRowEl.style.cssText = `display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; border-radius: 6px; margin-top: 4px; width: 100%; min-width: 0; box-sizing: border-box; gap: 8px; ${bgStyle}`;
                        }
                        if (fNameEl) {
                            fNameEl.textContent = `${namePrefix} ${file.name || 'File'}`;
                            fNameEl.title = file.path || file.name || 'File';
                        }
                        if (fProgressEl) {
                            fProgressEl.textContent = progressRightStr;
                        }
                        if (fActionEl) {
                            const hasBtn = fActionEl.querySelector('button');
                            if (file.state === 'completed' && file.path) {
                                if (!hasBtn) {
                                    const openFileTooltip = t('open_file_title', { file: file.name });
                                    fActionEl.innerHTML = `
                                        <button class="icon-button-mini open-file-action" data-open-file="${escapeAttr(file.path)}" title="${escapeAttr(openFileTooltip)}" style="padding: 2px; min-height: unset; height: 18px; width: 18px;">
                                            ${openFileIcon()}
                                        </button>
                                    `;
                                }
                            } else {
                                fActionEl.innerHTML = '';
                            }
                        }
                    });
                } else {
                    const fallbackList = [];
                    if (client.state === 'transferring' && currentFile) {
                        fallbackList.push({
                            name: shortName(currentFile),
                            path: currentFile,
                            state: 'transferring',
                            percent: percent,
                            bytesDone: client.bytesDone,
                            bytesTotal: client.bytesTotal
                        });
                    }
                    const oldSaved = client.savedFiles || [];
                    const revSaved = [...oldSaved].reverse();
                    revSaved.forEach(file => {
                        fallbackList.push({
                            name: shortName(file),
                            path: file,
                            state: 'completed',
                            percent: 100
                        });
                    });

                    const mappedFallback = fallbackList.map((item, idx) => {
                        item._naturalIndex = idx;
                        return item;
                    });
                    const sortedFallback = [...mappedFallback].sort((a, b) => {
                        const statePriority = { 'transferring': 1, 'waiting': 2, 'completed': 3, 'failed': 4 };
                        const pA = statePriority[a.state] || 5;
                        const pB = statePriority[b.state] || 5;
                        if (pA !== pB) return pA - pB;
                        return b._naturalIndex - a._naturalIndex;
                    });

                    sortedFallback.forEach((file, idx) => {
                        const fNameEl = document.getElementById(`receive-file-name-${clientID}-${idx}`);
                        const fProgressEl = document.getElementById(`receive-file-progress-${clientID}-${idx}`);
                        const fActionEl = document.getElementById(`receive-file-action-container-${clientID}-${idx}`);
                        const fRowEl = document.getElementById(`receive-file-row-${clientID}-${idx}`);

                        const bytesDone = formatSize(file.bytesDone);
                        const bytesTotal = formatSize(file.bytesTotal);
                        const sizeProgressText = file.bytesTotal > 0 ? `${bytesDone} / ${bytesTotal}` : '';

                        let progressRightStr = sizeProgressText;
                        let bgStyle = 'background: rgba(0,0,0,0.02); border: 1px solid var(--line);';
                        let namePrefix = '📄';

                        if (file.state === 'completed') {
                            namePrefix = '✓';
                            progressRightStr = sizeProgressText || t('completed') || 'Completed';
                            bgStyle = 'background: rgba(15, 118, 110, 0.02); border: 1px solid rgba(15, 118, 110, 0.1);';
                        } else if (file.state === 'transferring') {
                            namePrefix = '⟳';
                            progressRightStr = sizeProgressText || `${file.percent || 0}%`;
                            bgStyle = 'background: rgba(15, 118, 110, 0.06); border: 1px solid rgba(15, 118, 110, 0.2);';
                        } else if (file.state === 'failed') {
                            namePrefix = '✕';
                            progressRightStr = t('failed') || 'Failed';
                            bgStyle = 'background: rgba(180,35,24,0.03); border: 1px solid rgba(180,35,24,0.15);';
                        } else {
                            namePrefix = '⌛';
                            progressRightStr = sizeProgressText || t('waiting') || 'Waiting';
                            bgStyle = 'background: rgba(0,0,0,0.01); border: 1px solid var(--line); opacity: 0.7;';
                        }

                        if (fRowEl) {
                            fRowEl.style.cssText = `display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; border-radius: 6px; margin-top: 4px; width: 100%; min-width: 0; box-sizing: border-box; gap: 8px; ${bgStyle}`;
                        }
                        if (fNameEl) {
                            fNameEl.textContent = `${namePrefix} ${file.name || 'File'}`;
                            fNameEl.title = file.path || file.name || 'File';
                        }
                        if (fProgressEl) {
                            fProgressEl.textContent = progressRightStr;
                        }
                        if (fActionEl) {
                            const hasBtn = fActionEl.querySelector('button');
                            if (file.state === 'completed' && file.path) {
                                if (!hasBtn) {
                                    const openFileTooltip = t('open_file_title', { file: file.name });
                                    fActionEl.innerHTML = `
                                        <button class="icon-button-mini open-file-action" data-open-file="${escapeAttr(file.path)}" title="${escapeAttr(openFileTooltip)}" style="padding: 2px; min-height: unset; height: 18px; width: 18px;">
                                            ${openFileIcon()}
                                        </button>
                                    `;
                                }
                            } else {
                                fActionEl.innerHTML = '';
                            }
                        }
                    });
                }
            });
        }
    }



    const quotaCountdown = document.querySelector('.transfer-stage .quota-countdown');
    const isPaid = state.status?.isPaid;
    const usedReceiveTransfers = state.status?.usedReceiveTransfers || 0;
    const remaining = Math.max(0, 5 - usedReceiveTransfers);
    const shouldShowCountdown = (!isPaid && remaining > 0);
    
    if (shouldShowCountdown) {
        const text = remaining > 0 ? `free ulimited: ${remaining}` : `free limit exceeded (restricted)`;
        if (quotaCountdown) {
            quotaCountdown.textContent = text;
        } else {
            const headerDiv = document.querySelector('.transfer-stage .transfer-head > div');
            if (headerDiv) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = `
                    <div class="quota-countdown" style="font-size: 11px; color: var(--danger); font-weight: 800; border: 1px solid var(--danger); padding: 4px 8px; border-radius: 6px; background: rgba(180, 35, 24, 0.05); text-transform: uppercase; letter-spacing: 0.05em; display: inline-block; white-space: nowrap; margin-top: 6px;">
                        ${text}
                    </div>
                `;
                headerDiv.appendChild(tempDiv.firstElementChild);
            }
        }
    } else if (quotaCountdown) {
        quotaCountdown.remove();
    }

    const filesWrapper = document.getElementById('receive-saved-files-wrapper');
    if (filesWrapper) {
        const files = task.savedFiles || [];
        if (files.length > 0) {
            filesWrapper.innerHTML = `
                <div class="locked-list">
                    <strong>${t('saved_files')}</strong>
                    <ul class="path-list locked">${files.map((file) => {
                        const name = shortName(file);
                        const dir = getContainingFolder(file);
                        const openFileTooltip = t('open_file_title', { file: name });
                        return `
                            <li>
                                <div style="flex: 1; text-align: left; overflow: hidden; min-width: 0;">
                                    <strong style="display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(name)}</strong>
                                    <span style="display: block; font-size: 11px; color: var(--text-secondary); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(file)}</span>
                                </div>
                                <div style="display: flex; gap: 8px; align-items: center; flex-shrink: 0;">
                                    <button class="icon-button-mini open-file-action" data-open-file="${escapeAttr(file)}" title="${escapeAttr(openFileTooltip)}">
                                        ${openFileIcon()}
                                    </button>
                                    
                                </div>
                            </li>
                        `;
                    }).join('')}</ul>
                </div>
            `;
        } else {
            filesWrapper.innerHTML = '';
        }
    }
}

function renderChat() {
    const task = activeChatTask();
    const remaining = chatRemainingMs();
    const exhausted = !hasPaidLicense() && remaining <= 0;
    if (!task) {
        return `
            <div class="chat-start">
                <div>
                    <div class="eyebrow">${t('session_mode')}</div>
                    <p id="chat-quota-text">${chatQuotaText()}</p>
                </div>
                <div class="chat-illustration-wrapper">
                    <img src="${chatIllustrationURL}" alt="Chat Onboarding" style="pointer-events: none; user-select: none; opacity: 0.85;" />
                </div>
                <button class="primary" id="start-chat" ${state.busy ? 'disabled' : ''}>${chatStartButtonText()}</button>
            </div>
        `;
    }
    const chatUrl = task.pageUrl || '';
    if (!chatUrl) {
        return `
            <div class="chat-panel">
                <div class="chat-start">
                    <div>
                        <div class="eyebrow">${t('session_mode')}</div>
                        <h2>${t('starting_chat')}</h2>
                        <p>${t('waiting_network_url')}</p>
                    </div>
                </div>
            </div>
        `;
    }
    let src = chatUrl;
    try {
        const urlObj = new URL(src);
        if (state.settings?.viewportDebug) {
            urlObj.searchParams.set('viewportDebug', '1');
        } else {
            urlObj.searchParams.delete('viewportDebug');
        }
        src = urlObj.toString();
    } catch (e) {
        // Ignored
    }
    return `
        <div class="chat-panel">
            <iframe class="chat-iframe" id="chat-iframe" src="${escapeAttr(src)}" allow="clipboard-read; clipboard-write" title="Chat"></iframe>
            <div class="chat-drag-overlay" id="chat-drag-overlay" ondragleave="hideChatDragOverlay()" ondrop="hideChatDragOverlay()">
                <div class="chat-drag-box">
                    <div class="chat-drag-title">${t('drag_drop_tips')}</div>
                </div>
            </div>
        </div>
    `;
}

function renderChatSide() {
    const task = activeChatTask();
    if (!task) {
        return `
            <aside class="side">
                <div class="panel chat-session-panel">
                    <div class="panel-head">
                        <h2>${t('chat_session')}</h2>
                        <button type="button" class="side-icon-button refresh-action" title="${t('refresh')}" aria-label="${t('refresh')}">${refreshIcon()}</button>
                    </div>
                    <div class="empty-state">${t('no_active_chat')}</div>
                </div>
            </aside>
        `;
    }
    return renderChatPanel(task);
}

function renderChatPanel(task) {
    const chatUrl = task.pageUrl || '';
    const chatState = task.chatState || task.state || 'running';
    const messageCount = task.chatMessageCount || 0;
    const lastActivity = task.chatLastActivity ? messageTime(task.chatLastActivity) : '';
    const deviceCount = chatDeviceCount(task);
    const qrImage = qrImageURL(chatUrl);
    const qrToggleLabel = state.chatQROpen ? t('hide_chat_qr') : t('show_chat_qr');
    const qrPulse = !state.chatQRPromptDismissed && state.chatQRPulseUntil > Date.now();
    const remoteDeviceCount = Math.max(0, deviceCount - 1);
    return `
        <aside class="side">
            <div class="panel chat-session-panel">
                <div class="panel-head">
                    <div>
                        <div class="panel-title-inline">
                            ${hasPaidLicense() ? `<span class="license-badge sidebar-badge">${escapeHTML(state.license.tier)}</span>` : ''}
                            <h2>${t('chat_status')}</h2>
                        </div>
                        <p class="side-note tight">${escapeHTML(chatStateLabel(chatState))}</p>
                    </div>
                    <div class="side-head-actions">
                        <button type="button" class="side-icon-button refresh-action" title="${t('refresh')}" aria-label="${t('refresh')}">${refreshIcon()}</button>
                        <button type="button" class="side-icon-button open-qr" data-open-url="${escapeAttr(chatUrl)}" title="${t('open_in_browser')}" aria-label="${t('open_in_browser')}" ${chatUrl ? '' : 'disabled'}>${browserIcon()}</button>
                        <button type="button" class="side-icon-button danger-icon stop-chat-action" title="${t('stop')}" aria-label="${t('stop')}">${stopIcon()}</button>
                    </div>
                </div>
                <div class="chat-count">${escapeHTML(t('chat_message_count', { count: messageCount }))}</div>
                ${lastActivity ? `<p class="side-note">${t('last_activity')}: ${escapeHTML(lastActivity)}</p>` : ''}
            </div>
            <div class="panel chat-session-panel chat-qr-panel ${state.chatQROpen ? 'expanded' : ''}">
                <div class="panel-head">
                    <h2>${t('scan_to_join')}</h2>
                    <button type="button" class="side-icon-button chat-qr-toggle-action ${qrPulse ? 'qr-breathe' : ''}" title="${qrToggleLabel}" aria-label="${qrToggleLabel}">${qrIcon()}</button>
                </div>
                ${state.chatQROpen ? `
                    <div class="chat-qr-content">
                        <div class="chat-qr-card chat-qr-card-large">
                            ${qrImage ? `<img src="${escapeAttr(qrImage)}" alt="Chat QR code">` : `<div class="empty-state">${t('waiting_qr')}</div>`}
                        </div>
                        <div class="chat-url-row">
                            <span>${escapeHTML(chatUrl || t('waiting_network_url'))}</span>
                            <button type="button" class="copy-chat-url-action" title="${t('copy_chat_url')}" aria-label="${t('copy_chat_url')}" ${chatUrl ? '' : 'disabled'}>${copyIcon()}</button>
                        </div>
                    </div>
                ` : `<p class="side-note">${t('chat_qr_expand_tips')}</p>`}
            </div>
            <div class="panel chat-session-panel">
                <div class="panel-head">
                    <h2>${t('devices')}</h2>
                    <span class="side-count">${deviceCount}</span>
                </div>
                <div class="device-list compact">
                    <div class="device-row">
                        <span class="device-icon">${computerIcon()}</span>
                        <strong>${t('desktop')}</strong>
                        <span>${t('connected')}</span>
                    </div>
                    <div class="device-row">
                        <span class="device-icon">${phoneIcon()}</span>
                        <strong>${t('remote')}</strong>
                        <span>${remoteDeviceCount} ${t('connected')}</span>
                    </div>
                </div>
            </div>
        </aside>
    `;
}

function chatStateLabel(chatState) {
    if (chatState === 'active') {
        return t('connected');
    }
    if (chatState === 'waiting' || chatState === 'running') {
        return t('waiting_connection');
    }
    return titleCase(chatState || 'waiting');
}

function chatDeviceCount(task) {
    return task ? Math.max(1, Number(task.chatDeviceCount || 0)) : 0;
}

function renderPanel() {
    if (!state.activePanel) {
        return '';
    }
    const title = {
        settings: t('settings'),
        redeem: t('redeem_title'),
        about: t('about_title'),
        feedback: t('feedback'),
        'confirm-switch': t('confirm_switch_title'),
        'plan-comparison': t('plan_desc_title'),
    }[state.activePanel] || '';
    const isConfirm = state.activePanel === 'confirm-switch';
    const isPlanComp = state.activePanel === 'plan-comparison';
    let modalStyle = '';
    if (isConfirm) {
        modalStyle = 'style="max-width: 420px; width: min(420px, 100%);"';
    } else if (isPlanComp) {
        modalStyle = 'style="max-width: 780px; width: min(780px, 100%);"';
    }
    return `
        <div class="overlay" role="presentation">
            <section class="modal" role="dialog" aria-modal="true" aria-label="${escapeAttr(title)}" ${modalStyle}>
                <div class="modal-head">
                    <h2>${escapeHTML(title)}</h2>
                    <div class="modal-actions">
                        ${state.activePanel === 'settings' ? `<button class="tool-button" id="open-redeem-inline" title="${t('redeem_title')}" aria-label="${t('redeem_title')}">${giftIcon()}</button>` : ''}
                        <button class="tool-button" id="close-panel" title="${t('close')}" aria-label="${t('close')}">x</button>
                    </div>
                </div>
                ${state.activePanel === 'settings' ? renderSettingsPanel() : ''}
                ${state.activePanel === 'redeem' ? renderRedeemPanel() : ''}
                ${state.activePanel === 'about' ? renderAboutPanel() : ''}
                ${state.activePanel === 'plan-comparison' ? renderPlanComparisonPanel() : ''}
                ${state.activePanel === 'feedback' ? renderFeedbackPanel() : ''}
                ${state.activePanel === 'confirm-switch' ? renderConfirmSwitchPanel() : ''}
            </section>
        </div>
    `;
}

function renderConfirmSwitchPanel() {
    return `
        <div class="confirm-switch-panel">
            <div style="font-size: 15px; margin-bottom: 24px; color: var(--ink); line-height: 1.5; text-align: left;">
                ${escapeHTML(t('confirm_switch_mode'))}
            </div>
            <div style="margin-top: 24px; display: flex; gap: 8px; justify-content: flex-end;">
                <button type="button" class="btn-mini secondary" id="confirm-switch-cancel">${t('btn_cancel')}</button>
                <button type="button" class="btn-mini primary" id="confirm-switch-ok">${t('btn_confirm')}</button>
            </div>
        </div>
    `;
}

function renderSettingsPanel() {
    return renderSettingsView({
        escapeHTML,
        escapeAttr,
        renderStatusBadge,
        renderSwitch,
        renderAvatarMarkup,
        cleanChatAvatar,
        cleanChatProfileName,
        integrationStatusText,
        checkIcon,
        closeIcon,
        editIcon,
        openFolderIcon,
        getPortHelpText,
    });
}

function renderSwitch(id, checked, disabled = false) {
    return `
        <label class="switch" title="${disabled ? 'Not available on this platform' : ''}">
            <input id="${id}" type="checkbox" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
            <span></span>
        </label>
    `;
}

function renderChatQuotaPill() {
    if (hasPaidLicense()) {
        return '';
    }
    return `<span class="chat-quota-pill" id="top-chat-quota" title="Daily free chat time">${escapeHTML(chatQuotaTopText())}</span>`;
}

function renderStatusBadge(status) {
    if (!status) {
        return `<span class="setting-status muted">${t('setting_checking')}</span>`;
    }
    if (status.supported === false) {
        return `<span class="setting-status muted">${t('setting_unsupported')}</span>`;
    }
    if (status.needsRepair) {
        return `<span class="setting-status warning">${t('setting_repair')}</span>`;
    }
    return '';
}

function integrationStatusText(status, fallback) {
    if (!status) {
        return 'Checking status...';
    }
    if (status.supported === false) {
        return 'Not available on this platform yet.';
    }
    if (status.needsRepair) {
        return 'Needs repair. Turn this off and on again to reinstall it.';
    }
    if (status.enabled) {
        return 'Enabled.';
    }
    return fallback;
}

function renderAboutPanel() {
    return renderAboutView({
        loadLicense,
        getLicenseDisplayName,
        chatQuotaText,
        escapeHTML,
        horizontalLogoURL,
        sparklesIcon: () => diamondIcon(),
    });
}

function renderPlanComparisonPanel() {
    return renderPlanComparisonView({
        hasPaidLicense,
    });
}

function ensureFavicon() {
    let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) {
        icon = document.createElement('link');
        icon.rel = 'icon';
        document.head.appendChild(icon);
    }
    icon.type = 'image/png';
    icon.href = faviconURL;
}

function renderRedeemPanel() {
    const license = state.license || loadLicense();
    let active = t('redeem_no_paid_plan');
    if (hasPaidLicense()) {
        active = t('redeem_active_tier', { tier: getLicenseDisplayName(license) });
    }
    
    let warningBox = '';
    const isPaid = hasPaidLicense();
    if (state.status) {
        if (state.status.clockTampered) {
            active = t('paid_locked_clock');
            warningBox = `
                <div class="notice error compact" style="margin-bottom: 16px; font-size: 13px; line-height: 1.4;">
                    <strong>⚠️ ${t('locked_rollback')}：</strong>
                    ${t('locked_rollback_desc')}
                </div>
            `;
        } else if (license?.tier && !isPaid) {
            active = t('license_locked_limit');
            warningBox = `
                <div class="notice error compact" style="margin-bottom: 16px; font-size: 13px; line-height: 1.4;">
                    <strong>⚠️ ${t('license_verify_failed')}</strong>
                    ${t('license_verify_failed_desc', { tier: getLicenseDisplayName(license) })}
                </div>
            `;
        }
    }

    let resetSection = '';
    if (license?.tier) {
        if (state.confirmResetPending) {
            resetSection = `
                <div class="reset-confirm-box">
                    <div class="reset-confirm-content">
                        <span class="reset-warning-icon">⚠️</span>
                        <div class="reset-confirm-text">
                            <strong>${escapeHTML(t('reset_confirm_title'))}</strong>
                            <span>${escapeHTML(t('reset_confirm_desc'))}</span>
                        </div>
                    </div>
                    <div class="reset-confirm-actions">
                        <button type="button" class="btn-mini primary" id="cancel-reset-license" ${state.isActivating ? 'disabled' : ''}>${escapeHTML(t('btn_cancel'))}</button>
                        <button type="button" class="btn-mini danger-light" id="confirm-reset-license" ${state.isActivating ? 'disabled' : ''}>${escapeHTML(t('btn_confirm_reset'))}</button>
                    </div>
                </div>
            `;
        } else {
            resetSection = `
                <div class="reset-entry-row">
                    <span>${escapeHTML(t('redeem_reset_hint'))}</span>
                    <button type="button" class="btn-link-mini" id="reset-license">${escapeHTML(t('btn_reset'))}</button>
                </div>
            `;
        }
    }

    return `
        <div class="redeem-panel">
            ${warningBox}
            <div class="license-card">
                <strong>${escapeHTML(active)}</strong>
                <span>${license?.redeemedAt ? t('redeemed_at', { date: escapeHTML(new Date(license.redeemedAt).toLocaleString()) }) : t('redeem_desc')}</span>
                ${state.status?.maxDevices ? `<span style="font-size: 11px; margin-top: 4px; opacity: 0.85;">${t('device_limit', { activated: state.status.activatedDevices || 0, max: state.status.maxDevices })}</span>` : ''}
            </div>
            <label>
                ${t('redeem_title')}
                <input id="redeem-code" autocomplete="off" spellcheck="false" placeholder="EQT-PLUS-20260523-XXXX-CHECK" ${state.isActivating ? 'disabled' : ''} value="${escapeHTML(state.tempRedeemCode || '')}" />
            </label>
            <div class="redeem-actions">
                <button class="primary" id="confirm-redeem" ${state.isActivating ? 'disabled' : ''}>
                    <span class="btn-gift-icon" style="margin-right: 6px; display: inline-flex; align-items: center;">${giftIcon()}</span>
                    ${state.isActivating ? t('btn_activating') : t('btn_confirm')}
                </button>
            </div>
            ${resetSection}
            ${!state.isActivating && state.redeemMessage ? `<div class="notice success compact">${escapeHTML(state.redeemMessage)}</div>` : ''}
            ${!state.isActivating && state.redeemError ? `<div class="notice error compact">${escapeHTML(state.redeemError)}</div>` : ''}
        </div>
    `;
}

function renderFeedbackPanel() {
    return renderFeedbackView({
        buildDiagnostics,
        feedbackMailto,
        escapeHTML,
        escapeAttr,
    });
}

function getTranslatedState(s) {
    if (!s) return '';
    const low = s.toLowerCase();
    if (low === 'waiting') return t('waiting');
    if (low === 'running') return t('running');
    if (low === 'completed' || low === 'done') return t('completed');
    if (low === 'failed' || low === 'error') return t('failed');
    if (low === 'stopped' || low === 'cancelled') return t('stopped');
    return s;
}

function renderCurrent(task) {
    if (!task) {
        return `<div class="empty-state">${t('agent_idle')}</div>`;
    }
    const percent = task.transferPercent || 0;
    const qrImage = qrImageURL(task.pageUrl);
    const finished = isTerminal(task);
    const actionText = (task.action === 'share' || task.action === 'send') ? t('share') : (task.action === 'receive' ? t('receive') : titleCase(task.action));
    return `
        <div class="task-card">
            <div class="task-title">${escapeHTML(actionText)} #${task.id}</div>
            <div class="task-state ${finished ? 'done' : ''}">${escapeHTML(getTranslatedState(task.transferState || task.state))}</div>
            ${qrImage && !finished ? `
                <div class="qr-preview">
                    <img src="${escapeAttr(qrImage)}" alt="Transfer QR code" />
                    <button class="ghost open-qr" data-open-url="${escapeAttr(task.pageUrl)}">${t('open_in_browser')}</button>
                </div>
            ` : ''}
            <div class="progress"><span style="width:${Math.max(0, Math.min(100, percent))}%"></span></div>
            <dl>
                <dt>${t('target')}</dt><dd>${escapeHTML(task.transferTarget || task.transferCurrent || shortName(task.paths?.[0] || ''))}</dd>
                <dt>${t('archive')}</dt><dd>${escapeHTML(task.transferArchiveName || t('none'))}</dd>
                <dt>${t('bytes')}</dt><dd>${formatBytes(task.bytesDone)}${task.bytesTotal ? ` / ${formatBytes(task.bytesTotal)}` : ''}</dd>
                <dt>${t('qr_page')}</dt><dd>${task.pageUrl ? escapeHTML(task.pageUrl) : t('waiting')}</dd>
            </dl>
            ${renderSavedFiles(task.savedFiles)}
            ${task.error ? `<div class="notice error compact">${escapeHTML(task.error)}</div>` : ''}
            ${finished ? '' : `<button class="danger stop-current-action">${t('stop_current')}</button>`}
        </div>
    `;
}

function renderSavedFiles(files) {
    if (!files || !files.length) {
        return '';
    }
    return `
        <div class="saved-files">
            <strong>${t('saved_files')}</strong>
            <ul>${files.map((file) => `<li>${escapeHTML(file)}</li>`).join('')}</ul>
        </div>
    `;
}

function getStatusIcon(task) {
    const s = (task.transferState || task.state || '').toLowerCase();
    if (s.includes('fail') || s.includes('error')) return '❌';
    if (s.includes('stop') || s.includes('cancel')) return '🛑';
    if (s.includes('replace')) return '🔄';
    if (s.includes('complete') || s.includes('done') || s === 'idle') return '✅';
    return 'ℹ️';
}

function getContainingFolder(path) {
    if (!path) return '';
    return path.replace(/[\\/][^\\/]*$/, '') || path;
}

function openFileIcon() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
        <polyline points="15 3 21 3 21 9"></polyline>
        <line x1="10" y1="14" x2="21" y2="3"></line>
    </svg>`;
}

function openFolderIcon() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
    </svg>`;
}

function getTaskFolder(task) {
    if (task.action === 'receive') {
        if (task.paths && task.paths.length > 0) {
            return task.paths[0];
        }
        if (task.savedFiles && task.savedFiles.length > 0) {
            return getContainingFolder(task.savedFiles[0]);
        }
    } else {
        if (task.paths && task.paths.length > 0) {
            return getContainingFolder(task.paths[0]);
        }
    }
    return '';
}



function bindEvents() {
    // 通过事件委托绑定动态按钮，只绑定一次，避免每次 render 后重复叠加监听器
    if (!_staticDelegationBound) {
        _staticDelegationBound = true;
        document.addEventListener('click', (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest('.toggle-qr-expand-action')) {
                qrExpandedManual = !qrExpandedManual;
                render();
                return;
            }
            if (target?.closest('.toggle-devices-expand')) {
                state.devicesExpanded = !state.devicesExpanded;
                render();
                return;
            }
            const restoreBtn = target?.closest<HTMLElement>('.restore-share-action');
            if (restoreBtn) {
                const taskId = parseInt(restoreBtn.dataset.taskId || '', 10);
                if (taskId) {
                    restoreSharePaths(taskId);
                }
                return;
            }
        });
        
function shrinkSearchBoxInDOM() {
    const title = document.querySelector<HTMLElement>('.panel-title');
    const refreshBtn = document.querySelector<HTMLElement>('#refresh');
    const clearBtn = document.querySelector<HTMLElement>('#clear-history');
    const searchBox = document.querySelector<HTMLElement>('.search-input-box');
    const searchInput = document.querySelector<HTMLInputElement>('#history-search-input');
    const toggleSearch = document.querySelector<HTMLElement>('#toggle-search');
    
    if (showSearchInput) {
        toggleSearchInput(); // 这会把 showSearchInput 设为 false，searchQuery 设为 ''
    }
    toggleSearchDropdown(false);
    
    const panel = document.querySelector<HTMLElement>('.side .panel');
    if (panel) {
        panel.classList.remove('search-active');
    }
    
    if (title) {
        title.style.opacity = '1';
        title.style.maxWidth = '150px';
        title.style.transform = 'translateX(0)';
        title.style.pointerEvents = 'auto';
    }
    if (refreshBtn) {
        refreshBtn.style.opacity = '1';
        refreshBtn.style.width = '28px';
        refreshBtn.style.pointerEvents = 'auto';
    }
    if (clearBtn) {
        clearBtn.style.opacity = '1';
        clearBtn.style.width = '28px';
        clearBtn.style.pointerEvents = 'auto';
    }
    if (searchBox) {
        searchBox.style.width = '28px';
        searchBox.style.background = 'transparent';
    }
    if (searchInput) {
        searchInput.value = '';
        searchInput.style.opacity = '0';
        searchInput.style.width = '0px';
        searchInput.style.pointerEvents = 'none';
    }
    if (toggleSearch) {
        toggleSearch.style.background = 'transparent';
        toggleSearch.style.color = 'inherit';
    }
    
    const zone = document.querySelector<HTMLElement>('#search-results-expand-zone');
    if (zone) {
        zone.style.display = 'none';
        zone.innerHTML = '';
    }

    refreshHistoryListInDOM();
}

function refreshHistoryListInDOM() {
    const historyListWrapper = document.querySelector('.history-list-wrapper');
    const historyEl = document.querySelector('.history');
    if (historyListWrapper) {
        const savedScrollTop = historyEl ? historyEl.scrollTop : 0;
        const history = state.status?.history || [];
        historyListWrapper.innerHTML = renderHistory(history);
        setTimeout(() => {
            const newHistoryEl = document.querySelector('.history');
            if (newHistoryEl) {
                let scrolled = false;
                if (lastFocusedTaskId) {
                    const targetLi = newHistoryEl.querySelector(`#history-item-${lastFocusedTaskId}`);
                    if (targetLi) {
                        targetLi.scrollIntoView({
                            behavior: 'auto',
                            block: 'nearest'
                        });
                        scrolled = true;
                    }
                }
                if (!scrolled) {
                    newHistoryEl.scrollTop = savedScrollTop;
                }
            }
        }, 0);
    }
}

        document.addEventListener('pointerdown', (e: PointerEvent) => {
            const target = e.target as HTMLElement | null;
            if (showSearchInput && target) {
                const inSearchBox = target.closest('.search-input-box') || 
                                    target.closest('#toggle-search') || 
                                    target.closest('#history-search-input') ||
                                    target.closest('.history-search-dropdown');
                if (!inSearchBox) {
                    shrinkSearchBoxInDOM();
                    return;
                }
            }

            const devHeader = target?.closest<HTMLElement>('.device-header-toggle');
            if (devHeader) {
                const clientID = devHeader.dataset.clientId;
                if (clientID) {
                    state.deviceFilesExpanded = state.deviceFilesExpanded || {};
                    state.deviceFilesExpanded[clientID] = !state.deviceFilesExpanded[clientID];
                    
                    // 局部更新 UI 替代全局 render()，以防打动或闪烁
                    const transferStage = document.querySelector('.transfer-stage');
                    if (transferStage) {
                        if (state.mode === 'share') {
                            const activeTask = activeShareTask();
                            if (activeTask) {
                                updateShareTransferActiveUI(activeTask);
                                return;
                            }
                        } else if (state.mode === 'receive') {
                            const activeTask = activeReceiveTask();
                            if (activeTask) {
                                updateReceiveTransferActiveUI(activeTask);
                                return;
                            }
                        }
                    }
                    render();
                }
            }
        });
    }
    document.querySelectorAll<HTMLElement>('[data-mode]').forEach((button) => {
        button.addEventListener('click', async () => {
            const targetMode = button.dataset.mode || 'share';
            if (state.mode === targetMode) {
                return;
            }

            const activeShare = activeShareTask();
            const activeRecv = state.status?.current && state.status.current.action === 'receive' && !isTaskClosed(state.status.current) ? state.status.current : null;
            const activeChat = activeChatTask();
            const activeTask = activeShare || activeRecv || activeChat;

            if (activeTask) {
                try {
                    const confirmed = await showConfirmSwitchDialog();
                    if (!confirmed) {
                        return;
                    }
                    if (activeChat) {
                        await (window as any).go?.main.App.StopChat();
                    } else {
                        await (window as any).go?.main.App.StopCurrent();
                    }
                    if (state.status) {
                        state.status.current = null;
                        state.status.chat = null;
                    }
                    state.busy = false;
                } catch (e) {
                    console.error('Failed to stop current active task on mode switch:', e);
                    return;
                }
            }

            setMode(targetMode);
            clearMessages();
            render();
        });
    });
    document.querySelector('#refresh')?.addEventListener('click', () => refreshStatus(false));
    document.querySelectorAll('.refresh-action').forEach((button) => {
        button.addEventListener('click', () => refreshStatus(false));
    });
    document.querySelector('#open-settings')?.addEventListener('click', () => openPanel('settings'));
    document.querySelector('#open-redeem')?.addEventListener('click', () => openPanel('redeem'));
    document.querySelector('#open-about')?.addEventListener('click', () => openPanel('about'));
    document.querySelector('#open-feedback')?.addEventListener('click', () => openPanel('feedback'));
    document.querySelector('#choose-files')?.addEventListener('click', chooseFiles);
    document.querySelector('#choose-folder')?.addEventListener('click', chooseFolder);
    document.querySelector('#clear-share')?.addEventListener('click', () => {
        state.sharePaths = [];
        state.shareLimitNotice = '';
        clearMessages();
        render();
    });
    document.querySelectorAll('.remove-path').forEach((button) => {
        button.addEventListener('click', removePath);
    });
    document.querySelector('#start-share')?.addEventListener('click', startShare);
    document.querySelector('#start-chat')?.addEventListener('click', startChat);
    document.querySelector('#choose-receive')?.addEventListener('click', chooseReceiveDirectory);
      // 悬浮匹配结果 Hover 滚动定位到对应大卡片项
    document.addEventListener('mouseover', (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        const dropdownItem = target?.closest<HTMLElement>('.search-dropdown-item');
        if (dropdownItem) {
            const taskId = parseInt(dropdownItem.dataset.targetId || '', 10);
            if (taskId) {
                const targetLi = document.getElementById(`history-item-${taskId}`);
                if (targetLi) {
                    targetLi.scrollIntoView({
                        behavior: 'smooth',
                        block: 'nearest'
                    });
                }
            }
        }
    });

    // 点击某条搜索记录，收起结果列表，滚动到对应项，但不关闭搜索框，保持关键字高亮
    document.addEventListener('click', (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        const dropdownItem = target?.closest<HTMLElement>('.search-dropdown-item');
        if (dropdownItem) {
            const taskId = parseInt(dropdownItem.dataset.targetId || '', 10);
            if (taskId) {
                lastFocusedTaskId = taskId;
                // 1. 关闭下拉面板
                toggleSearchDropdown(false);
                const zone = document.querySelector<HTMLElement>('#search-results-expand-zone');
                if (zone) {
                    zone.style.display = 'none';
                    zone.innerHTML = '';
                }
                
                // 2. 平滑滚动到历史记录中对应那项
                const targetLi = document.getElementById(`history-item-${taskId}`);
                if (targetLi) {
                    targetLi.scrollIntoView({
                        behavior: 'smooth',
                        block: 'nearest'
                    });
                }
            }
        }
    });

    document.querySelector('#history-search-input')?.addEventListener('input', (e: Event) => {
        const target = e.target as HTMLInputElement | null;
        const val = target?.value || '';
        updateSearchQuery(val);
        
        const historyListWrapper = document.querySelector('.history-list-wrapper');
        if (historyListWrapper) {
            const history = state.status?.history || [];
            historyListWrapper.innerHTML = renderHistory(history);
        }
        
        const zone = document.querySelector<HTMLElement>('#search-results-expand-zone');
        if (zone) {
            if (val.trim()) {
                toggleSearchDropdown(true);
                const history = state.status?.history || [];
                const matchResults = getMatchResults(history, val);
                
                if (matchResults.length > 0) {
                    zone.innerHTML = matchResults.map(item => `
                        <div class="search-dropdown-item" data-target-id="${item.taskId}" ${item.filePath ? `data-file-path="${escapeAttr(item.filePath)}"` : ''} ${item.deviceName ? `data-device-name="${escapeAttr(item.deviceName)}"` : ''}>
                            <span class="dropdown-item-icon">${item.type === 'file' ? '📄' : (item.type === 'device' ? '📱' : 'ℹ️')}</span>
                            <div class="dropdown-item-content">
                                <div class="dropdown-item-title">
                                    ${highlightText(item.text, val)}
                                </div>
                                <div class="dropdown-item-detail">
                                    ${escapeHTML(item.detail)}
                                </div>
                            </div>
                        </div>
                    `).join('');
                    zone.style.display = 'flex';
                } else {
                    zone.style.display = 'none';
                    zone.innerHTML = '';
                }
            } else {
                toggleSearchDropdown(false);
                zone.style.display = 'none';
                zone.innerHTML = '';
            }
        }
    });
    document.querySelector('#receive-dir')?.addEventListener('input', (e: Event) => {
        const target = e.target as HTMLInputElement | null;
        const val = target?.value || '';
        state.receiveDir = val;
        const startBtn = document.querySelector<HTMLButtonElement>('#start-receive');
        if (startBtn) {
            startBtn.disabled = state.busy || !val.trim();
        }
        const saveBtn = document.querySelector<HTMLButtonElement>('#save-receive-dir');
        if (saveBtn) {
            saveBtn.disabled = !val.trim();
        }
    });
    document.querySelector('#start-receive')?.addEventListener('click', startReceive);
    document.querySelector('#save-receive-dir')?.addEventListener('click', saveSettings);
    bindPanelEvents();
    document.querySelectorAll('.stop-current-action').forEach((button) => {
        button.addEventListener('click', stopCurrent);
    });
    document.querySelectorAll('.stop-chat-action').forEach((button) => {
        button.addEventListener('click', stopChat);
    });
    document.querySelectorAll('.open-qr, .preview-button[data-open-url]').forEach((button) => {
        button.addEventListener('click', openQRPage);
    });
    document.querySelector('#clear-history')?.addEventListener('click', clearHistory);
    document.querySelector('#toggle-search')?.addEventListener('click', () => {
        toggleSearchInput();
        render();
        if (showSearchInput) {
            const inputEl = document.querySelector<HTMLInputElement>('#history-search-input');
            if (inputEl) {
                inputEl.focus();
                const val = inputEl.value;
                inputEl.value = '';
                inputEl.value = val;
            }
        } else {
            lastFocusedTaskId = null;
        }
    });
    document.querySelector('#history-search-input')?.addEventListener('input', (e: Event) => {
        const target = e.target as HTMLInputElement | null;
        const val = target?.value || '';
        updateSearchQuery(val);
        
        const historyListWrapper = document.querySelector('.history-list-wrapper');
        if (historyListWrapper) {
            const history = state.status?.history || [];
            let filteredHistory = history;
            if (val.trim()) {
                const query = val.trim().toLowerCase();
                filteredHistory = history.filter(task => {
                    if (String(task.id).toLowerCase().includes(query)) return true;
                    
                    const actionText = ((task.action === 'share' || task.action === 'send') ? t('share') : (task.action === 'receive' ? t('receive') : (task.action === 'chat' ? t('chat') : task.action))).toLowerCase();
                    if (actionText.includes(query)) return true;

                    const files = task.action === 'receive' ? (task.savedFiles || []) : (task.paths || []);
                    for (const file of files) {
                        const shortName = String(file || '').split(/[\\/]/).filter(Boolean).pop() || file || '';
                        if (shortName.toLowerCase().includes(query) || file.toLowerCase().includes(query)) {
                            return true;
                        }
                    }

                    if (task.clientStates) {
                        for (const client of Object.values(task.clientStates) as any[]) {
                            const clientName = client.deviceName || client.clientID || '';
                            if (clientName.toLowerCase().includes(query)) {
                                return true;
                            }
                        }
                    }
                    return false;
                });
            }
            historyListWrapper.innerHTML = renderHistory(filteredHistory);
        }
    });
    document.querySelectorAll('.repeat-task').forEach((button) => {
        button.addEventListener('click', repeatTask);
    });
    document.querySelectorAll('[data-save-url]').forEach((element) => {
        element.addEventListener('contextmenu', openChatContextMenu);
        element.addEventListener('click', saveAttachmentAsFromButton);
    });
    document.querySelector('#copy-chat-url')?.addEventListener('click', copyChatURL);
    document.querySelectorAll('.copy-chat-url-action').forEach((button) => {
        button.addEventListener('click', copyChatURL);
    });
    document.querySelectorAll('.chat-qr-toggle-action').forEach((button) => {
        button.addEventListener('click', toggleChatQR);
    });
    document.removeEventListener('pointerdown', closeChatQROnOutside);
    if (state.chatQROpen) {
        document.addEventListener('pointerdown', closeChatQROnOutside);
    }

    const chatIframe = document.querySelector<HTMLIFrameElement>('#chat-iframe');
    if (chatIframe) {
        chatIframe.addEventListener('load', () => {
            const lang = state.settings?.lang;
            if (lang) {
                try {
                    chatIframe.contentWindow?.postMessage({
                        type: 'update-lang',
                        lang: lang
                    }, activeChatFrameOrigin() || '*');
                } catch (e) {
                    // Ignored
                }
            }
        });
    }
}

function bindPanelEvents() {
    document.querySelector('#open-redeem-inline')?.addEventListener('click', () => openPanel('redeem'));
    document.querySelector('#close-panel')?.addEventListener('click', closePanel);
    document.querySelector('.overlay')?.addEventListener('click', (event: MouseEvent) => {
        const target = event.target as HTMLElement | null;
        if (target?.classList.contains('overlay')) {
            closePanel();
        }
    });
    document.querySelector('#confirm-switch-ok')?.addEventListener('click', () => {
        if (confirmSwitchResolve) {
            confirmSwitchResolve(true);
            confirmSwitchResolve = null;
        }
        closePanel();
    });
    document.querySelector('#confirm-switch-cancel')?.addEventListener('click', () => {
        if (confirmSwitchResolve) {
            confirmSwitchResolve(false);
            confirmSwitchResolve = null;
        }
        closePanel();
    });
    bindSettingsControls();
    document.querySelector('.open-docs')?.addEventListener('click', openExternal);
    document.querySelector('#send-feedback')?.addEventListener('click', sendFeedback);
    document.querySelector('#copy-feedback')?.addEventListener('click', copyFeedback);

    // Feedback image uploader events
    const imageInput = document.querySelector<HTMLInputElement>('#feedback-image-input');
    const selectImageBtn = document.querySelector<HTMLButtonElement>('#btn-select-image');
    const clearImageBtn = document.querySelector<HTMLButtonElement>('#btn-clear-image');
    const previewContainer = document.querySelector<HTMLElement>('#feedback-image-preview-container');
    const previewImg = document.querySelector<HTMLImageElement>('#feedback-image-preview');

    selectImageBtn?.addEventListener('click', () => {
        imageInput?.click();
    });

    imageInput?.addEventListener('change', async (event: Event) => {
        const target = event.target as HTMLInputElement | null;
        const file = target?.files?.[0];
        if (!file) return;

        try {
            const result = await compressImageToWebP(file);
            state.feedbackImageBase64 = (result as any).dataUrl;
            state.feedbackImageFormat = (result as any).format;
            
            if (previewImg) previewImg.src = (result as any).dataUrl;
            if (previewContainer) previewContainer.style.display = 'block';
            state.feedbackError = '';
            // Render to update potential error displays without losing inputs since fields aren't data-bound to state
            const noticeEl = document.querySelector('.feedback-panel .notice.error');
            if (noticeEl) noticeEl.remove();
        } catch (err: any) {
            console.error('Failed to compress image:', err);
            state.feedbackError = t('feedback_compress_error') + err.message;
            render();
            openPanel('feedback');
        }
    });

    clearImageBtn?.addEventListener('click', () => {
        state.feedbackImageBase64 = null;
        state.feedbackImageFormat = null;
        state.feedbackSendResult = '';
        if (imageInput) imageInput.value = '';
        if (previewContainer) previewContainer.style.display = 'none';
        if (previewImg) previewImg.src = '';
    });

    const fbMessage = document.querySelector<HTMLTextAreaElement>('#feedback-message');
    fbMessage?.addEventListener('input', (e: Event) => {
        const target = e.target as HTMLTextAreaElement | null;
        if (target) state.feedbackMessage = target.value;
        state.feedbackSendResult = '';
        state.feedbackError = '';
        state.feedbackNotice = '';
    });

    const fbContact = document.querySelector<HTMLInputElement>('#feedback-contact');
    fbContact?.addEventListener('input', (e: Event) => {
        const target = e.target as HTMLInputElement | null;
        if (target) state.feedbackContact = target.value;
        state.feedbackSendResult = '';
        state.feedbackError = '';
        state.feedbackNotice = '';
    });

    const fbCategory = document.querySelector<HTMLSelectElement>('#feedback-category');
    fbCategory?.addEventListener('change', () => {
        state.feedbackSendResult = '';
        state.feedbackError = '';
        state.feedbackNotice = '';
    });
    document.querySelector('#confirm-redeem')?.addEventListener('click', confirmRedeem);
    document.querySelector('#reset-license')?.addEventListener('click', () => {
        state.confirmResetPending = true;
        syncPanelSurface();
    });
    document.querySelector('#cancel-reset-license')?.addEventListener('click', () => {
        state.confirmResetPending = false;
        syncPanelSurface();
    });
    document.querySelector('#confirm-reset-license')?.addEventListener('click', () => {
        state.confirmResetPending = false;
        resetLicense();
    });
    if (state.confirmResetPending) {
        document.getElementById('cancel-reset-license')?.focus();
    }
    document.querySelector('#toggle-plan-info')?.addEventListener('click', () => {
        state.activePanel = 'plan-comparison';
        render();
    });
    document.querySelector('#refresh-license-btn')?.addEventListener('click', triggerManualRefresh);
    document.querySelector('#manage-license-portal-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        window.runtime.BrowserOpenURL('https://www.eqt.net.im/portal.html');
    });
    document.querySelector('#buy-license-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        window.runtime.BrowserOpenURL('https://www.eqt.net.im/');
    });

    document.querySelector('#plan-back-to-about')?.addEventListener('click', () => {
        state.activePanel = 'about';
        render();
    });
    document.querySelector('#plan-go-redeem')?.addEventListener('click', () => {
        state.activePanel = 'redeem';
        render();
    });




}

function bindChatQRPanelEvents() {
    document.querySelectorAll('.refresh-action').forEach((button) => {
        button.addEventListener('click', () => refreshStatus(false));
    });
    document.querySelectorAll('.open-qr').forEach((button) => {
        button.addEventListener('click', openQRPage);
    });
    document.querySelectorAll('.stop-current-action').forEach((button) => {
        button.addEventListener('click', stopCurrent);
    });
    document.querySelectorAll('.chat-qr-toggle-action').forEach((button) => {
        button.addEventListener('click', toggleChatQR);
    });
    document.querySelectorAll('.copy-chat-url-action').forEach((button) => {
        button.addEventListener('click', copyChatURL);
    });
}

function syncAndSaveSettingsInBackground() {
    if (state.activePanel === 'settings') {
        syncSettingsFromDOM();
        saveSettingsData().catch(err => {
            console.error('Failed to auto-save settings in background:', err);
        });
    }
}

function openPanel(panel: string) {
    syncAndSaveSettingsInBackground();
    state.activePanel = panel;
    if (panel === 'settings') {
        (window as any).go?.main.App.ChatSaveDirectory().then((dir: string) => {
            state.chatSaveDir = dir;
            const btn = document.querySelector<HTMLElement>('#open-chat-save');
            if (btn) {
                btn.dataset.openPath = dir;
            }
        }).catch(() => {});
    }
    if (panel === 'redeem') {
        state.redeemMessage = '';
        state.redeemError = '';
        state.confirmResetPending = false;
    }
    if (panel === 'feedback') {
        state.feedbackNotice = '';
        state.feedbackSent = false;
    }
    if (panel === 'about') {
        state.showPlanInfoDetails = false;
    }
    clearMessages();
    updateMessagesSurface();
    syncPanelSurface();
}

function closePanel() {
    syncAndSaveSettingsInBackground();
    if (confirmSwitchResolve) {
        confirmSwitchResolve(false);
        confirmSwitchResolve = null;
    }
    if (state.activePanel === 'feedback') {
        state.feedbackMessage = '';
        state.feedbackContact = '';
        state.feedbackImageBase64 = null;
        state.feedbackImageFormat = null;
        state.feedbackNotice = '';
        state.feedbackError = '';
        state.feedbackSendResult = '';
    }
    if (state.activePanel === 'plan-comparison') {
        state.activePanel = 'about';
    } else {
        state.activePanel = '';
    }
    state.confirmResetPending = false;
    state.showEmojiPicker = false;
    render();
}



function syncManualUpdateCheckUIWrapper() {
    syncManualUpdateCheckUI(syncPanelSurface);
}

function syncPanelSurface() {
    console.log('[Antigravity Debug] syncPanelSurface called, activePanel:', state.activePanel, 'stack:', new Error().stack);
    LogInfo('[Antigravity Debug] syncPanelSurface called, activePanel: ' + state.activePanel + ', stack: ' + new Error().stack);
    const existing = document.querySelector('.overlay');
    
    // 记录旧 modal 的滚动位置，防止重绘后面板回退到顶部
    let savedScrollTop = 0;
    if (existing) {
        const modalEl = existing.querySelector('.modal');
        if (modalEl) {
            savedScrollTop = modalEl.scrollTop;
        }
    }

    if (!state.activePanel) {
        existing?.remove();
        return;
    }
    const next = document.createElement('template');
    next.innerHTML = renderPanel().trim();
    const overlay = next.content.firstElementChild;
    if (!overlay) {
        return;
    }
    if (existing) {
        morphdom(existing, overlay);
        
        // 还原滚动位置到新的 modal 上
        const newModalEl = overlay.querySelector('.modal');
        if (newModalEl && savedScrollTop > 0) {
            newModalEl.scrollTop = savedScrollTop;
            setTimeout(() => {
                newModalEl.scrollTop = savedScrollTop;
            }, 0);
            setTimeout(() => {
                newModalEl.scrollTop = savedScrollTop;
            }, 50);
        }
    } else {
        document.querySelector('.shell')?.appendChild(overlay);
    }
    bindPanelEvents();
}

async function chooseFiles() {
    await run(async () => {
        const paths = await SelectFiles();
        addSharePaths(paths || []);
    });
}

async function chooseFolder() {
    await run(async () => {
        const path = await SelectShareDirectory();
        addSharePaths(path ? [path] : []);
    });
}

async function chooseReceiveDirectory() {
    await run(async () => {
        const path = await SelectReceiveDirectory();
        if (path) {
            state.receiveDir = path;
            render();
        }
    });
}

async function startShare() {
    await run(async () => {
        await saveSettingsData();
        const paths = state.sharePaths.map(item => typeof item === 'string' ? item : item.path);
        state.status = await Share(paths);
        state.sharePaths = [];
        state.shareLimitNotice = '';
        state.notice = '';
        render();
    });
}

async function startReceive() {
    await run(async () => {
        await saveSettingsData();
        state.status = await Receive(state.receiveDir);
        state.notice = '';
        render();
    });
}

async function startChat() {
    LogInfo('[Frontend] startChat: Requesting chat task start...');
    console.log('[Frontend] startChat: Requesting chat task start from Wails App.Chat()...');
    
    // 1. Transition immediately to the chat interface with a loading status for instant UI responsiveness
    setMode('chat');
    state.status = state.status || {};
    state.status.chat = {
        action: 'chat',
        state: 'running',
        pageUrl: ''
    };
    state.notice = '';
    render();

    // 2. Run settings saving and chat session startup asynchronously in the background
    run(async () => {
        LogInfo('[Frontend] startChat: Saving settings data before Chat()...');
        await saveSettingsData();
        state.chatQRPulseArmed = true;
        state.chatQRPromptDismissed = false;
        
        LogInfo('[Frontend] startChat: Invoking Wails App.Chat()...');
        try {
            const finalStatus = await Chat();
            LogInfo('[Frontend] startChat: Chat() resolved successfully. Status: ' + JSON.stringify(finalStatus));
            console.log('[Frontend] startChat: Chat task started. Status response:', finalStatus);
            
            state.status = finalStatus;
            reconcileChatQRState(finalStatus);
            if (!state.chatQRPulseUntil) {
                triggerChatQRPulse();
            }
            if (state.chatAutoSave) {
                state.chatSaveDir = await ChatSaveDirectory();
                LogInfo('[Frontend] startChat: Chat autosave path set to: ' + state.chatSaveDir);
                console.log('[Frontend] startChat: Chat autosave path set to:', state.chatSaveDir);
            }
            render();
        } catch (err) {
            const errStr = err?.stack || err;
            LogError('[Frontend] startChat: Chat() invocation failed: ' + errStr);
            console.error('[Frontend] startChat: Chat() invocation failed:', err);
            state.error = 'Failed to start chat session: ' + err;
            render();
        }
    }, {busy: false});
}

async function openChatSaveDirectory() {
    await run(async () => {
        const dir = state.chatSaveDir || await ChatSaveDirectory();
        state.chatSaveDir = dir;
        await OpenPath(dir);
        render();
    }, {busy: false});
}

function copyChatURL() {
    const task = activeChatTask();
    if (!task?.pageUrl) {
        return;
    }
    if (navigator.clipboard) {
        navigator.clipboard.writeText(task.pageUrl);
    }
}

function toggleChatQR() {
    stopChatQRPulse();
    state.chatQROpen = !state.chatQROpen;
    updateChatQRPanel();
}

function closeChatQROnOutside(event) {
    if (event.target.closest('.chat-qr-panel')) {
        return;
    }
    state.chatQROpen = false;
    updateChatQRPanel();
}

function updateChatQRPanel() {
    const task = activeChatTask();
    if (!task) {
        render();
        return;
    }
    const existing = document.querySelector('.chat-qr-panel');
    if (!existing) {
        render();
        return;
    }
    const next = document.createElement('template');
    next.innerHTML = renderChatPanel(task).trim();
    const nextSide = next.content.firstElementChild;
    if (!nextSide) {
        return;
    }
    existing.closest('.side')?.replaceWith(nextSide);
    bindChatQRPanelEvents();
    document.removeEventListener('pointerdown', closeChatQROnOutside);
    if (state.chatQROpen) {
        document.addEventListener('pointerdown', closeChatQROnOutside);
    }
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}



function applyLanguageChange(newLang: string) {
    recalculateUpdateTexts();
    const frame = document.querySelector<HTMLIFrameElement>('#chat-iframe');
    if (frame) {
        const payload = {
            type: 'update-lang',
            lang: newLang
        };
        try {
            frame.contentWindow?.postMessage(payload, activeChatFrameOrigin() || '*');
        } catch (e) {
            // Ignored
        }
    }
    render();
}

async function handleAutoSaveSettings() {
    try {
        await saveSettingsData();
        if (state.error) {
            state.error = '';
        }
        applyLanguageChange(state.settings?.lang || 'zh');
    } catch (e) {
        state.error = 'Failed to save settings: ' + (e.message || String(e));
        render();
    }
}

async function saveSettings() {
    await run(async () => {
        await saveSettingsData();
        if (state.mode === 'chat') {
            syncPanelSurface();
            showToast(t('settings_saved'));
        } else {
            state.notice = t('settings_saved');
        }
        applyLanguageChange(state.settings?.lang || 'zh');
    });
}

function syncSettingsFromDOM() {
    if (!state.settings) return;
    const receiveInput = document.querySelector<HTMLInputElement>('#receive-dir');
    const receiveBrowser = document.querySelector<HTMLInputElement>('#browser-open');
    const sideBrowser = document.querySelector<HTMLInputElement>('#settings-browser');
    const chatAutoSave = document.querySelector<HTMLInputElement>('#settings-chat-autosave');
    const chatDownloadDir = document.querySelector<HTMLInputElement>('#settings-chat-download-dir');
    const enableChatV2 = document.querySelector<HTMLInputElement>('#settings-chat-v2');
    const closeBehavior = document.querySelector<HTMLSelectElement>('#settings-close-behavior');
    const iface = document.querySelector<HTMLInputElement | HTMLSelectElement>('#settings-interface');
    const port = document.querySelector<HTMLInputElement>('#settings-port');
    const chatSender = document.querySelector<HTMLInputElement>('#settings-chat-sender');
    const chatAvatar = document.querySelector<HTMLInputElement>('#settings-chat-avatar');
    const autoUpdateMode = document.querySelector<HTMLSelectElement>('#settings-auto-update-mode');
    const updateInterval = document.querySelector<HTMLSelectElement>('#settings-update-interval');
    const lang = document.querySelector<HTMLSelectElement>('#settings-lang');
    const showHistory = document.querySelector<HTMLInputElement>('#settings-show-history');


    if (receiveInput) state.settings.output = receiveInput.value;
    if (receiveBrowser) state.settings.browser = receiveBrowser.checked;
    if (sideBrowser) state.settings.browser = sideBrowser.checked;
    if (chatAutoSave) state.settings.chatAutoSave = chatAutoSave.checked;
    if (chatDownloadDir) state.settings.chatDownloadDir = chatDownloadDir.value;
    if (enableChatV2) state.settings.enableChatV2 = enableChatV2.checked;
    if (closeBehavior) state.settings.closeBehavior = closeBehavior.value;
    const logDir = document.querySelector<HTMLInputElement>('#dev-log-dir');
    if (logDir) state.settings.logDir = logDir.value.trim();
    if (iface) state.settings.interface = iface.value;
    if (port) state.settings.port = Number(port.value);
    if (chatSender) state.settings.chatSender = cleanChatProfileName(chatSender.value);
    if (chatAvatar) state.settings.chatAvatar = cleanChatAvatar(chatAvatar.value);
    if (autoUpdateMode) state.settings.autoUpdateMode = autoUpdateMode.value;
    if (updateInterval) state.settings.updateCheckIntervalHours = Number(updateInterval.value);
    if (lang) state.settings.lang = lang.value;
    if (showHistory) state.settings.showHistory = showHistory.checked;


    state.receiveDir = state.settings.output || '';
    state.browserFallback = Boolean(state.settings.browser);
    state.chatAutoSave = state.settings.chatAutoSave !== false;
    state.closeBehavior = state.settings.closeBehavior === 'quit' ? 'quit' : 'tray';
}

async function saveSettingsData() {
    syncSettingsFromDOM();
    const settings = {
        ...(state.settings || {}),
        devMode: Boolean(state.settings?.devMode ?? false),
        debugLog: Boolean(state.settings?.debugLog ?? false),
        viewportDebug: Boolean(state.settings?.viewportDebug ?? false),
    };
    state.settings = await SaveSettings(settings);
    state.receiveDir = state.settings.output;
    state.browserFallback = state.settings.browser;
    state.chatAutoSave = state.settings.chatAutoSave !== false;
    state.chatSaveDir = state.settings.chatDownloadDir || await ChatSaveDirectory();
    state.closeBehavior = state.settings.closeBehavior === 'quit' ? 'quit' : 'tray';
    syncViewportDebugToChatFrame();
    syncIdentityToChatFrame();
}

function syncViewportDebugToChatFrame() {
    const frame = document.querySelector<HTMLIFrameElement>('#chat-iframe');
    if (!frame) { return; }
    const enabled = Boolean(state.settings?.viewportDebug ?? false);
    
    let hostMetrics = null;
    if (enabled) {
        const workspace = document.querySelector('.workspace');
        const shell = document.querySelector('.shell');
        hostMetrics = {
            inner: { width: window.innerWidth, height: window.innerHeight },
            workspace: workspace ? {
                x: Math.round(workspace.getBoundingClientRect().left),
                y: Math.round(workspace.getBoundingClientRect().top),
                width: Math.round(workspace.getBoundingClientRect().width),
                height: Math.round(workspace.getBoundingClientRect().height)
            } : null,
            shell: shell ? {
                x: Math.round(shell.getBoundingClientRect().left),
                y: Math.round(shell.getBoundingClientRect().top),
                width: Math.round(shell.getBoundingClientRect().width),
                height: Math.round(shell.getBoundingClientRect().height)
            } : null
        };
    }

    const payload = {
        type: 'update-viewport-debug',
        enabled: enabled,
        hostMetrics: hostMetrics
    };
    const post = () => {
        try {
            frame.contentWindow?.postMessage(payload, activeChatFrameOrigin() || '*');
        } catch (e) {
            // Ignored
        }
    };
    frame.addEventListener('load', post, {once: true});
    window.setTimeout(post, 0);
}


async function toggleRightClickIntegration(event: Event) {
    const target = event.currentTarget as HTMLInputElement | null;
    const enabled = Boolean(target?.checked);
    if (target) target.disabled = true;
    try {
        state.rightClickIntegration = await (window as any).go?.main.App.SetRightClickIntegrationEnabled(enabled);
        updateIntegrationRow('right-click');
    } catch (error: any) {
        state.error = error?.message || String(error);
        if (target) {
            target.checked = !enabled;
            target.disabled = false;
        }
        render();
    }
}

async function toggleStartupIntegration(event: Event) {
    const target = event.currentTarget as HTMLInputElement | null;
    const enabled = Boolean(target?.checked);
    if (target) target.disabled = true;
    try {
        state.startupIntegration = await (window as any).go?.main.App.SetStartupEnabled(enabled);
        updateIntegrationRow('startup');
    } catch (error: any) {
        state.error = error?.message || String(error);
        if (target) {
            target.checked = !enabled;
            target.disabled = false;
        }
        render();
    }
}

function bindSettingsControls() {
    document.querySelector('#settings-right-click')?.addEventListener('change', toggleRightClickIntegration);
    document.querySelector('#settings-startup')?.addEventListener('change', toggleStartupIntegration);
    document.querySelectorAll('[data-help]').forEach(bindHelpTooltip);
    document.querySelector('#open-chat-save')?.addEventListener('click', openChatSaveDirectory);
    document.querySelector('#btn-select-chat-download-dir')?.addEventListener('click', async () => {
        try {
            const dir = await (window as any).go?.main.App.SelectReceiveDirectory();
            if (dir) {
                const input = document.querySelector<HTMLInputElement>('#settings-chat-download-dir');
                if (input) {
                    input.value = dir;
                    syncSettingsFromDOM();
                    await handleAutoSaveSettings();
                    syncPanelSurface();
                }
            }
        } catch (err) {
            console.error('Failed to select chat download directory:', err);
        }
    });

    // Chat Sender Edit controls
    document.querySelector('.edit-chat-sender')?.addEventListener('click', () => {
        state.isEditingChatSender = true;
        syncPanelSurface();
        const inputEl = document.querySelector<HTMLInputElement>('#settings-chat-sender');
        if (inputEl) {
            inputEl.focus();
            inputEl.select();
        }
    });

    document.querySelector('.cancel-chat-sender')?.addEventListener('click', () => {
        state.isEditingChatSender = false;
        syncPanelSurface();
    });

    document.querySelector('.save-chat-sender')?.addEventListener('click', async () => {
        const inputEl = document.querySelector<HTMLInputElement>('#settings-chat-sender');
        if (inputEl && state.settings) {
            const newName = cleanChatProfileName(inputEl.value);
            state.settings.chatSender = newName;
            state.isEditingChatSender = false;
            await handleAutoSaveSettings();
            syncPanelSurface();
        }
    });

    const chatSenderInput = document.querySelector<HTMLInputElement>('#settings-chat-sender');
    if (chatSenderInput) {
        chatSenderInput.addEventListener('keydown', async (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                document.querySelector<HTMLButtonElement>('.save-chat-sender')?.click();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                document.querySelector<HTMLButtonElement>('.cancel-chat-sender')?.click();
            }
        });
        chatSenderInput.addEventListener('input', (event: Event) => {
            const target = event.target as HTMLInputElement | null;
            const previewEl = document.querySelector('.avatar-preview');
            if (previewEl && target) {
                const cleaned = cleanChatProfileName(target.value);
                const avatarVal = state.settings?.chatAvatar || '';
                previewEl.innerHTML = renderAvatarMarkup(avatarVal, (cleaned.charAt(0) || 'D').toUpperCase());
            }
        });
    }

    // Avatar upload/reset and presets
    document.querySelector('#btn-avatar-upload')?.addEventListener('click', () => {
        document.querySelector<HTMLInputElement>('#settings-avatar-file')?.click();
    });

    document.querySelector('#settings-avatar-file')?.addEventListener('change', (event: Event) => {
        const target = event.target as HTMLInputElement | null;
        const file = target?.files?.[0];
        if (file && state.settings && target) {
            const reader = new FileReader();
            reader.onload = (e: ProgressEvent<FileReader>) => {
                const img = new Image();
                img.onload = async () => {
                    const canvas = document.createElement('canvas');
                    const maxDim = 128;
                    let w = img.width;
                    let h = img.height;
                    if (w > maxDim || h > maxDim) {
                        if (w > h) {
                            h = Math.round((h * maxDim) / w);
                            w = maxDim;
                        } else {
                            w = Math.round((w * maxDim) / h);
                            h = maxDim;
                        }
                    }
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx?.drawImage(img, 0, 0, w, h);
                    const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
                    
                    state.settings.chatAvatar = compressedBase64;
                    const inputEl = document.querySelector<HTMLInputElement>('#settings-chat-avatar');
                    if (inputEl) inputEl.value = compressedBase64;
                    target.value = '';
                    await handleAutoSaveSettings();
                    syncPanelSurface();
                };
                img.src = String(e.target?.result || '');
            };
            reader.readAsDataURL(file);
        }
    });

    document.querySelector('#btn-avatar-reset')?.addEventListener('click', async () => {
        if (state.settings) {
            state.settings.chatAvatar = '';
            const inputEl = document.querySelector<HTMLInputElement>('#settings-chat-avatar');
            if (inputEl) inputEl.value = '';
            await handleAutoSaveSettings();
            syncPanelSurface();
        }
    });

    const avatarInput = document.querySelector<HTMLInputElement>('#settings-chat-avatar');
    if (avatarInput) {
        avatarInput.addEventListener('input', (event: Event) => {
            const target = event.target as HTMLInputElement | null;
            if (!target) return;
            const cleaned = cleanChatAvatar(target.value);
            const previewEl = document.querySelector('.avatar-preview');
            if (previewEl) {
                const sender = state.settings?.chatSender || '';
                previewEl.innerHTML = renderAvatarMarkup(cleaned, (cleanChatProfileName(sender).charAt(0) || 'D').toUpperCase());
            }
        });
        avatarInput.addEventListener('change', async (event: Event) => {
            const target = event.target as HTMLInputElement | null;
            if (state.settings && target) {
                state.settings.chatAvatar = cleanChatAvatar(target.value);
                await handleAutoSaveSettings();
                syncPanelSurface();
            }
        });
    }


    document.querySelector('#btn-emoji-more')?.addEventListener('click', (e) => {
        e.stopPropagation();
        state.showEmojiPicker = !state.showEmojiPicker;
        syncPanelSurface();
    });

    document.querySelectorAll('.emoji-picker-item').forEach(btn => {
        btn.addEventListener('click', async (event: Event) => {
            event.stopPropagation();
            const target = event.currentTarget as HTMLElement | null;
            const emojiVal = target?.dataset.emoji;
            if (state.settings && emojiVal) {
                state.settings.chatAvatar = emojiVal;
                const inputEl = document.querySelector<HTMLInputElement>('#settings-chat-avatar');
                if (inputEl) inputEl.value = emojiVal;
                state.showEmojiPicker = false;
                await handleAutoSaveSettings();
                syncPanelSurface();
            }
        });
    });

    const customEmojiInput = document.querySelector<HTMLInputElement>('#emoji-picker-custom-input');
    if (customEmojiInput) {
        customEmojiInput.addEventListener('click', (event) => {
            event.stopPropagation();
        });
        customEmojiInput.addEventListener('keydown', async (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                document.querySelector<HTMLButtonElement>('#btn-emoji-picker-custom-submit')?.click();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                state.showEmojiPicker = false;
                syncPanelSurface();
            }
        });
    }

    document.querySelector('#btn-emoji-picker-custom-submit')?.addEventListener('click', async (event) => {
        event.stopPropagation();
        const inputEl = document.querySelector<HTMLInputElement>('#emoji-picker-custom-input');
        if (inputEl && state.settings) {
            const rawVal = inputEl.value.trim();
            const emojiVal = cleanChatAvatar(rawVal);
            if (emojiVal) {
                state.settings.chatAvatar = emojiVal;
                const inputEl = document.querySelector<HTMLInputElement>('#settings-chat-avatar');
                if (inputEl) inputEl.value = emojiVal;
                state.showEmojiPicker = false;
                await handleAutoSaveSettings();
                syncPanelSurface();
            }
        }
    });

    const inputs = [
        '#settings-interface',
        '#settings-port',
        '#settings-browser',
        '#settings-chat-autosave',
        '#settings-chat-download-dir',
        '#settings-chat-v2',
        '#settings-close-behavior',
        '#settings-auto-update-mode',
        '#settings-update-interval',
        '#settings-lang',
        '#settings-show-history'
    ];
    inputs.forEach(selector => {
        const el = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
        if (el) {
            el.addEventListener('change', async () => {
                syncSettingsFromDOM();
                await handleAutoSaveSettings();
                if (selector === '#settings-auto-update-mode') {
                    const mode = el.value;
                    if (mode && mode !== 'off') {
                        state.settings.lastUpdateCheckTime = 0;
                        await handleAutoSaveSettings();
                        runAutoUpdateCheck(true);
                    }
                }
            });
            el.addEventListener('input', syncSettingsFromDOM);
        }
    });

    const advDetails = document.querySelector<HTMLDetailsElement>('.settings-advanced-details');
    if (advDetails) {
        advDetails.addEventListener('toggle', (event: Event) => {
            const target = event.currentTarget as HTMLDetailsElement | null;
            if (target) state.settingsAdvancedOpen = target.open;
        });
    }

    const devDetails = document.querySelector<HTMLDetailsElement>('.settings-advanced-details.dev-details');
    if (devDetails) {
        devDetails.addEventListener('toggle', (event: Event) => {
            const target = event.currentTarget as HTMLDetailsElement | null;
            if (target) state.settingsDevOpen = target.open;
        });
    }

    document.querySelector('#dev-debug-log')?.addEventListener('change', async (event: Event) => {
        const target = event.currentTarget as HTMLInputElement | null;
        if (!state.settings) state.settings = {};
        if (target) state.settings.debugLog = Boolean(target.checked);
        await saveSettingsData();
        state.notice = state.settings.debugLog ? t('debug_logs_enabled') : t('debug_logs_disabled');
        render();
        openPanel('settings');
    });

    document.querySelector('#dev-viewport-debug')?.addEventListener('change', async (event: Event) => {
        const target = event.currentTarget as HTMLInputElement | null;
        if (!state.settings) state.settings = {};
        if (target) state.settings.viewportDebug = Boolean(target.checked);
        await saveSettingsData();
        state.notice = state.settings.viewportDebug ? t('viewport_debug_enabled') : t('viewport_debug_disabled');
        render();
        openPanel('settings');
    });

    document.querySelector('#dev-select-log-dir')?.addEventListener('click', async () => {
        try {
            const selected = await SelectLogDirectory();
            if (selected) {
                if (!state.settings) state.settings = {};
                state.settings.logDir = selected;
                await saveSettingsData();
                state.notice = t('log_dir_updated') || '日志保存路径已更新';
                state.appInfo = await AppInfo();
                render();
                openPanel('settings');
            }
        } catch (error) {
            state.error = 'Failed to select log directory: ' + error;
            render();
            openPanel('settings');
        }
    });

    document.querySelector('#dev-open-log')?.addEventListener('click', async () => {
        const logPath = state.appInfo?.logPath;
        if (logPath) {
            try {
                await OpenPath(logPath);
            } catch (error) {
                state.error = 'Failed to open log: ' + error;
                render();
                openPanel('settings');
            }
        }
    });

    document.querySelector('#dev-open-dir')?.addEventListener('click', async () => {
        const logPath = state.appInfo?.logPath;
        if (logPath) {
            try {
                const separator = logPath.includes('\\') ? '\\' : '/';
                const parts = logPath.split(separator);
                parts.pop();
                const logDir = parts.join(separator);
                await OpenPath(logDir);
            } catch (error) {
                state.error = 'Failed to open log directory: ' + error;
                render();
                openPanel('settings');
            }
        }
    });

    document.querySelector('#dev-reset-quota')?.addEventListener('click', async () => {
        try {
            state.status = await DevSetUsedSeconds(0);
            const rawPaths = state.sharePaths.map(item => typeof item === 'string' ? item : item.path);
            try {
                state.shareLimitNotice = await ValidateFreeTier(rawPaths);
            } catch (e) {
                state.shareLimitNotice = '';
            }
            state.notice = t('dev_quota_reset_success') || '已重置每日计时为 0s';
            render();
            openPanel('settings');
        } catch (error) {
            state.error = 'Failed to reset quota: ' + error;
            render();
            openPanel('settings');
        }
    });

    document.querySelector('#dev-max-quota')?.addEventListener('click', async () => {
        try {
            state.status = await DevSetUsedSeconds(600);
            const rawPaths = state.sharePaths.map(item => typeof item === 'string' ? item : item.path);
            try {
                state.shareLimitNotice = await ValidateFreeTier(rawPaths);
            } catch (e) {
                state.shareLimitNotice = '';
            }
            state.notice = t('dev_quota_max_success') || '已将使用秒数设置为 10分钟(600s)';
            render();
            openPanel('settings');
        } catch (error) {
            state.error = 'Failed to max quota: ' + error;
            render();
            openPanel('settings');
        }
    });

    document.querySelector('#dev-disable-mode')?.addEventListener('click', async () => {
        if (!state.settings) state.settings = {};
        state.settings.devMode = false;
        state.settings.debugLog = false;
        state.settings.viewportDebug = false;
        await saveSettingsData();
        state.notice = t('dev_mode_disabled');
        render();
        openPanel('settings');
    });

    document.querySelector('#btn-manual-update-check')?.addEventListener('click', () => runManualUpdateCheck(syncSettingsFromDOM));
}

function updateIntegrationRow(kind) {
    const config = kind === 'startup'
        ? {
            status: state.startupIntegration,
            text: '#startup-status-text',
            control: '#startup-control',
            switchId: 'settings-startup',
            fallback: 'Starts the background transfer service when you sign in.',
            handler: toggleStartupIntegration,
        }
        : {
            status: state.rightClickIntegration,
            text: '#right-click-status-text',
            control: '#right-click-control',
            switchId: 'settings-right-click',
            fallback: 'Adds Explorer actions for sharing selected files and receiving into a folder.',
            handler: toggleRightClickIntegration,
        };
    const text = document.querySelector(config.text);
    if (text) {
        text.textContent = integrationStatusText(config.status, config.fallback);
    }
    const control = document.querySelector(config.control);
    if (control) {
        control.innerHTML = `${renderStatusBadge(config.status)}${renderSwitch(config.switchId, config.status?.enabled, config.status?.supported === false)}`;
        document.querySelector(`#${config.switchId}`)?.addEventListener('change', config.handler);
    }
}

async function stopCurrent() {
    await run(async () => {
        await StopCurrent();
        state.notice = t('task_stopped');
        await loadStatusData();
    });
}

async function stopChat() {
    await run(async () => {
        await StopChat();
        state.notice = t('chat_stopped');
        if (state.status) {
            state.status.chat = null;
            if (state.status.current && state.status.current.action === 'chat') {
                state.status.current = null;
            }
        }
        reconcileChatQRState(state.status);
        render();
        await loadStatusData();
    });
}

async function clearHistory() {
    await run(async () => {
        await ClearHistory();
        lastFocusedTaskId = null;
        state.notice = t('history_cleared');
        await loadStatusData();
    });
}

async function repeatTask(event) {
    await run(async () => {
        const id = Number(event.currentTarget.dataset.taskId);
        state.status = await RepeatTask(id);
        state.notice = t('task_repeated', { id });
        render();
    });
}

function restoreSharePaths(taskId) {
    const history = state.status?.history || [];
    const task = history.find(t => t.id === taskId);
    if (!task) return;
    
    const paths = task.paths || [];
    if (!paths.length) return;
    
    if (!state.sharePaths) {
        state.sharePaths = [];
    }
    
    let addedCount = 0;
    paths.forEach(p => {
        const pathStr = typeof p === 'string' ? p : p.path;
        if (!pathStr) return;
        
        const exists = state.sharePaths.some(item => {
            const itemPath = typeof item === 'string' ? item : item.path;
            return itemPath === pathStr;
        });
        
        if (!exists) {
            state.sharePaths.push(pathStr);
            addedCount++;
        }
    });
    
    setMode('share');
    state.shareLimitNotice = '';
    
    if (addedCount > 0) {
        state.notice = t('share_restored_success', { count: addedCount });
    } else {
        state.notice = t('share_restored_exists');
    }
    
    render();
}

async function openQRPage(event) {
    await run(async () => {
        const url = event.currentTarget.dataset.openUrl;
        if (url) {
            await OpenURL(url);
        }
    });
}

async function openPath(event) {
    await run(async () => {
        const path = event.currentTarget.dataset.openPath;
        if (path) {
            await OpenPath(path);
        }
    }, {busy: false});
}

async function openSavedFile(event) {
    await run(async () => {
        const path = event.currentTarget.dataset.openFile;
        if (path) {
            await OpenFile(path);
        }
    }, {busy: false});
}

function openChatContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    const items = [];
    if (target.dataset.saveUrl) {
        items.push({label: t('save_as') || 'Save as', action: () => saveAttachmentAs(target.dataset.saveUrl, target.dataset.saveName || 'attachment')});
    }
    if (items.length) {
        showContextMenu(items, event.clientX, event.clientY);
    }
}

async function saveAttachmentAs(url, name) {
    await run(async () => {
        await SaveChatAttachmentAs(url, name || 'attachment');
    }, {busy: false});
}

async function saveAttachmentAsFromButton(event) {
    event.stopPropagation();
    const target = event.currentTarget;
    await saveAttachmentAs(target.dataset.saveUrl, target.dataset.saveName || 'attachment');
}

function showContextMenu(items, x, y) {
    closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    items.forEach((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = item.label;
        button.addEventListener('click', () => {
            closeContextMenu();
            item.action();
        });
        menu.appendChild(button);
    });
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    
    // 默认在右上角弹出：
    // 水平方向默认向右展开 (left = x)
    // 垂直方向默认向上展开 (top = y - rect.height)
    let left = x;
    let top = y - rect.height;

    // 检查水平方向是否超出右边缘
    if (left + rect.width > window.innerWidth - 8) {
        // 超出则调整到水平对侧 (向左展开)
        left = x - rect.width;
        // 如果向左展开后又超出了左边缘，则限制在可见区域内
        if (left < 8) {
            left = Math.max(8, window.innerWidth - rect.width - 8);
        }
    } else {
        // 如果没有超出右边缘，但也需防范向右展开时 left 自身小于 8 的极端情况
        if (left < 8) {
            left = 8;
        }
    }

    // 检查垂直方向是否超出上边缘
    if (top < 8) {
        // 超出则调整到水平对侧 (向下展开)
        top = y;
        // 如果向下展开后又超出了下边缘，则限制在可见区域内
        if (top + rect.height > window.innerHeight - 8) {
            top = Math.max(8, window.innerHeight - rect.height - 8);
        }
    } else {
        // 如果没有超出上边缘，但也需防范向上展开时超出下边缘的极端情况
        if (top + rect.height > window.innerHeight - 8) {
            top = Math.max(8, window.innerHeight - rect.height - 8);
        }
    }

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    window.setTimeout(() => {
        document.addEventListener('pointerdown', closeContextMenuOnOutside);
        document.addEventListener('keydown', closeContextMenuOnEscape);
    }, 0);
}

function bindHelpTooltip(element) {
    element.addEventListener('mouseenter', showHelpTooltip);
    element.addEventListener('focus', showHelpTooltip);
    element.addEventListener('mousemove', positionHelpTooltip);
    element.addEventListener('mouseleave', closeHelpTooltip);
    element.addEventListener('blur', closeHelpTooltip);
}

function showHelpTooltip(event) {
    closeHelpTooltip();
    const target = event.currentTarget;
    const text = target.dataset.help || '';
    if (!text) {
        return;
    }
    const tip = document.createElement('div');
    tip.className = 'help-tooltip';
    tip.textContent = text;
    document.body.appendChild(tip);
    positionHelpTooltip(event);
}

function positionHelpTooltip(event: MouseEvent) {
    const tip = document.querySelector<HTMLElement>('.help-tooltip');
    if (!tip) {
        return;
    }
    const target = event.currentTarget as HTMLElement | null;
    const anchor = target?.getBoundingClientRect?.() || {left: event.clientX || 0, bottom: event.clientY || 0};
    const x = typeof event.clientX === 'number' && event.clientX > 0 ? event.clientX : anchor.left + 12;
    const y = typeof event.clientY === 'number' && event.clientY > 0 ? event.clientY : anchor.bottom;
    const margin = 8;
    tip.style.maxWidth = `${Math.max(180, Math.min(320, window.innerWidth - margin * 2))}px`;
    const rect = tip.getBoundingClientRect();
    const left = Math.min(Math.max(margin, x + 10), window.innerWidth - rect.width - margin);
    let top = y + 12;
    if (top + rect.height + margin > window.innerHeight) {
        top = Math.max(margin, y - rect.height - 12);
    }
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
}

function closeHelpTooltip() {
    document.querySelector('.help-tooltip')?.remove();
}

function closeContextMenuOnOutside(event) {
    if (!event.target.closest('.context-menu')) {
        closeContextMenu();
    }
}

function closeContextMenuOnEscape(event) {
    if (event.key === 'Escape') {
        closeContextMenu();
    }
}

function closeContextMenu() {
    document.querySelector('.context-menu')?.remove();
    document.removeEventListener('pointerdown', closeContextMenuOnOutside);
    document.removeEventListener('keydown', closeContextMenuOnEscape);
}

function bindLongPress(element) {
    let timer = null;
    let point = {x: 0, y: 0};
    element.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) {
            return;
        }
        point = {x: event.clientX, y: event.clientY};
        timer = window.setTimeout(() => {
            openChatContextMenu({
                preventDefault() {},
                stopPropagation() {},
                currentTarget: element,
                clientX: point.x,
                clientY: point.y,
            });
            timer = null;
        }, 560);
    });
    ['pointerup', 'pointerleave', 'pointercancel', 'pointermove'].forEach((name) => {
        element.addEventListener(name, () => {
            if (timer) {
                window.clearTimeout(timer);
                timer = null;
            }
        });
    });
}

async function openExternal(event) {
    await run(async () => {
        const target = event.currentTarget.dataset.openExternal;
        if (target) {
            await OpenExternal(target);
        }
    }, {busy: false});
}

async function sendFeedback(event) {
    const message = document.querySelector<HTMLTextAreaElement>('#feedback-message')?.value.trim() || '';
    const category = document.querySelector<HTMLSelectElement>('#feedback-category')?.value || 'other';
    const contact = document.querySelector<HTMLInputElement>('#feedback-contact')?.value.trim() || '';
    const includeDiagnostics = Boolean(document.querySelector<HTMLInputElement>('#feedback-diagnostics')?.checked);

    if (!message) {
        state.feedbackError = t('feedback_empty_error');
        state.feedbackSendResult = 'failed';
        render();
        openPanel('feedback');
        return;
    }

    state.isSendingFeedback = true;
    state.feedbackError = '';
    state.feedbackNotice = '';
    state.feedbackSendResult = '';
    render();
    openPanel('feedback');

    const diagnostics = includeDiagnostics ? buildDiagnostics() : '';
    const fullMessage = includeDiagnostics 
        ? `${message}\n\n[Diagnostics]\n${diagnostics}`
        : message;

    try {
        // Call the Go backend method exported via Wails bindings to avoid CORS issues and enable detailed logs.
        await (window as any).go?.main.App.SubmitFeedback(
            category,
            contact,
            fullMessage,
            state.feedbackImageBase64 || '',
            state.feedbackImageFormat || ''
        );

        // Success!
        state.feedbackNotice = t('feedback_success');
        state.feedbackSendResult = 'success';
        state.feedbackMessage = '';
        state.feedbackContact = '';
        state.feedbackImageBase64 = null;
        state.feedbackImageFormat = null;
        
        // Clear actual DOM values as well
        const msgEl = document.querySelector<HTMLTextAreaElement>('#feedback-message');
        if (msgEl) msgEl.value = '';
        const contactEl = document.querySelector<HTMLInputElement>('#feedback-contact');
        if (contactEl) contactEl.value = '';
    } catch (err: any) {
        console.error('Failed to submit feedback to Worker:', err);
        state.feedbackError = t('feedback_failed') + ` (${err?.message || err})`;
        state.feedbackSendResult = 'failed';
    } finally {
        state.isSendingFeedback = false;
        render();
        openPanel('feedback');
    }
}

async function copyFeedback(event: MouseEvent) {
    const button = event.currentTarget as HTMLButtonElement | null;
    if (!button) return;

    try {
        const feedback = collectFeedback();
        await (window as any).go?.main.App.ClipboardSetText(feedback.body);
        const original = button.textContent;
        button.textContent = (t as any)('copied') || 'Copied';
        button.disabled = true;
        window.setTimeout(() => {
            button.textContent = original;
            button.disabled = false;
        }, 1600);
    } catch (err: any) {
        console.error('Failed to copy feedback:', err);
        state.feedbackError = t('copy_failed_prefix') + (err.message || err);
        render();
        openPanel('feedback');
    }
}

async function refreshStatus(shouldRender = true) {
    await run(async () => {
        await loadStatusData();
        if (shouldRender) {
            if (state.activePanel) {
                return;
            }
            render();
        }
    }, {busy: false});
}

async function loadSettings() {
    await run(async () => {
        loadChatUsage();
        state.license = loadLicense();
        if (state.license) {
            SetPaidStatus(true, state.license.redeemedAt || '', state.license.codeDate || '', state.license.tier || '').catch(function(e) {
                console.error('Failed to sync paid status to backend during init:', e);
            });
        } else {
            SetPaidStatus(false, '', '', '').catch(function(e) {
                console.error('Failed to sync paid status to backend during init:', e);
            });
        }
        state.appInfo = await AppInfo();
        state.settings = await ReadSettings();
        if (!state.settings.lang) {
            state.settings.lang = getSystemLocale();
            saveSettingsData().catch(() => {});
        }
        state.receiveDir = state.settings.output || '';
        state.browserFallback = Boolean(state.settings.browser);
        state.chatAutoSave = state.settings.chatAutoSave !== false;
        state.closeBehavior = state.settings.closeBehavior === 'quit' ? 'quit' : 'tray';
        
        // Apply settings language immediately to trigger smooth update & postMessage to iframe if present
        applyLanguageChange(state.settings.lang);

        // Prioritize loading history and main state to render the home screen instantly
        await loadStatusData();
        render();

        // Query integration status asynchronously in the background so it doesn't block startup
        loadIntegrationStatusData().then(() => {
            if (state.activePanel === 'settings' && !shouldProtectActiveInput()) {
                syncPanelSurface();
            }
        }).catch((e) => {
            console.error('Failed to load integration status in background:', e);
        });
    }, {busy: false});
}

async function loadIntegrationStatusData() {
    const [rightClick, startup] = await Promise.all([
        RightClickIntegrationStatus().catch((error) => ({
            supported: false,
            enabled: false,
            needsRepair: false,
            detail: String(error?.message || error),
        })),
        StartupStatus().catch((error) => ({
            supported: false,
            enabled: false,
            needsRepair: false,
            detail: String(error?.message || error),
        })),
    ]);
    state.rightClickIntegration = rightClick;
    state.startupIntegration = startup;
}

async function loadStatusData() {
    applyStatusData(await AgentStatus());
}

function applyStatusData(nextStatus) {
    const prevChatUrl = activeChatPageURL();
    const prevCurrentUrl = String(state.status?.current?.pageUrl || '');
    const prevBusy = state.busy;
    const prevMode = state.mode;
    const prevStatusState = state.status?.state || 'idle';

    state.status = nextStatus;
    if (!nextStatus?.current && !nextStatus?.chat) {
        qrExpandedManual = null;
    }
    reconcileChatQRState(state.status);

    const nextChatUrl = activeChatPageURL();
    const nextCurrentUrl = String(nextStatus?.current?.pageUrl || '');
    const nextBusy = state.busy;
    const nextMode = state.mode;
    const nextStatusState = nextStatus?.state || 'idle';

    if (prevStatusState === 'busy' && nextStatusState !== 'busy') {
        const updateMode = state.settings?.autoUpdateMode || 'download';
        if (state.updateStage === 'available' && (updateMode === 'download' || updateMode === 'silent')) {
            console.log('[AutoUpdate] Transfer finished, agent returned to idle. Resuming update download.');
            triggerDownloadUpdate().catch((e) => {
                console.error('[AutoUpdate] Failed to resume download:', e);
            });
        }
    }

    if (prevChatUrl !== nextChatUrl || prevCurrentUrl !== nextCurrentUrl || prevBusy !== nextBusy || prevMode !== nextMode) {
        if (state.activePanel || shouldProtectActiveInput()) {
            return;
        }
        render();
    }
}

async function run(fn: () => Promise<any>, options: { busy?: boolean } = {}) {
    const showBusy = options.busy !== false;
    state.error = '';
    if (showBusy) {
        state.busy = true;
        renderBusy();
    }
    try {
        await fn();
    } catch (error: any) {
        console.error('[Frontend] run: execution failed:', error);
        state.error = error?.message || String(error);
        render();
    } finally {
        if (showBusy) {
            state.busy = false;
            render();
        }
    }
}

function renderBusy() {
    const primary = document.querySelector<HTMLButtonElement>('.primary');
    if (primary) {
        primary.disabled = true;
    }
}

async function removePath(event) {
    const index = Number(event.currentTarget.dataset.pathIndex);
    state.sharePaths = state.sharePaths.filter((_, itemIndex) => itemIndex !== index);
    clearMessages();
    
    const rawPaths = state.sharePaths.map(item => typeof item === 'string' ? item : item.path);
    try {
        state.shareLimitNotice = await ValidateFreeTier(rawPaths);
    } catch (e) {
        state.shareLimitNotice = '';
    }
    
    render();
}

async function addSharePaths(paths) {
    if (!paths || paths.length === 0) return;
    try {
        const infos = await GetFileInfos(paths.filter(Boolean));
        if (infos && infos.length > 0) {
            const currentMap = new Map();
            state.sharePaths.forEach(item => {
                const p = typeof item === 'string' ? item : item.path;
                currentMap.set(p, typeof item === 'string' ? { path: p, name: shortName(p), size: '' } : item);
            });
            infos.forEach(item => currentMap.set(item.path, item));
            state.sharePaths = Array.from(currentMap.values());
        }
    } catch (e) {
        console.error('[addSharePaths] Failed to get file infos:', e);
        const currentPaths = state.sharePaths.map(item => typeof item === 'string' ? item : item.path);
        const next = new Set(currentPaths);
        paths.filter(Boolean).forEach(p => next.add(p));
        state.sharePaths = Array.from(next).map(p => ({ path: p, name: shortName(p), size: '' }));
    }
    
    clearMessages();
    
    const rawPaths = state.sharePaths.map(item => typeof item === 'string' ? item : item.path);
    try {
        state.shareLimitNotice = await ValidateFreeTier(rawPaths);
    } catch (e) {
        state.shareLimitNotice = '';
    }
    
    render();
}

let agentEventsSubscribed = false;
let lastUIUpdateTime = 0;

function connectAgentEvents() {
    if (agentEventsSubscribed) {
        return;
    }
    agentEventsSubscribed = true;
    EventsOn('chat-download-progress', (eventData: any) => {
        try {
            const frame = document.querySelector<HTMLIFrameElement>('#chat-iframe');
            if (frame && frame.contentWindow) {
                frame.contentWindow.postMessage({
                    type: 'chat-download-progress',
                    messageId: eventData.messageId,
                    progress: eventData.progress
                }, '*');
            }
        } catch (e) {
            console.error('Failed to forward chat download progress:', e);
        }
    });
    EventsOn('agent-status', (nextStatus: any) => {
        try {
            const previousChatURL = activeChatPageURL();
            applyStatusData(nextStatus);
            if (canKeepChatFrame(previousChatURL)) {
                updateChatQuotaSurface();
                updateChatQRPulseButton();
                return;
            }
            if (state.activePanel || shouldProtectActiveInput()) {
                return;
            }
            // 如果处于 share 模式或 receive 模式下的 activeTask 传输界面，直接进行局部渲染更新，从而避免全局 render 导致 tooltip 气泡闪烁
            const transferStage = document.querySelector('.transfer-stage');
            if (transferStage) {
                const now = Date.now();
                const isTransferring = nextStatus?.current?.transferState === 'transferring' || nextStatus?.current?.state === 'transferring';
                const shouldThrottle = isTransferring && (now - lastUIUpdateTime < 250);
                
                if (!shouldThrottle) {
                    lastUIUpdateTime = now;
                    if (state.mode === 'share') {
                        const activeTask = activeShareTask();
                        if (activeTask) {
                            updateShareTransferActiveUI(activeTask);
                            return;
                        }
                    } else if (state.mode === 'receive') {
                        const activeTask = activeReceiveTask();
                        if (activeTask) {
                            updateReceiveTransferActiveUI(activeTask);
                            return;
                        }
                    }
                } else {
                    return; // Throttle update, avoid innerHTML replacement
                }
            }
            render();
        } catch (e) {
            console.error('[Frontend] Failed to process agent-status event:', e);
            refreshStatus(false);
        }
    });
}


async function handleFileDrop(paths: string[]) {
    sendDebugMessageToChat('[Chat Drag] handleFileDrop called with: ' + JSON.stringify(paths) + ', state.mode: ' + state.mode);
    if (state.mode === 'chat') {
        const frame = document.querySelector<HTMLIFrameElement>('#chat-iframe');
        if (frame && frame.contentWindow) {
            sendDebugMessageToChat('[Chat Drag] Found chat-iframe, posting selected-files via postMessage');
            frame.contentWindow.postMessage({
                type: 'selected-files',
                paths: paths || []
            }, '*');
            return;
        } else {
            sendDebugMessageToChat('[Chat Drag] ERROR: chat-iframe or contentWindow not found in chat mode');
        }
    }
    if (state.mode !== 'share') {
        const activeShare = activeShareTask();
        const activeRecv = state.status?.current && state.status.current.action === 'receive' && !isTaskClosed(state.status.current) ? state.status.current : null;
        const activeChat = activeChatTask();
        const activeTask = activeShare || activeRecv || activeChat;

        if (activeTask) {
            try {
                const confirmed = await showConfirmSwitchDialog();
                if (!confirmed) {
                    return;
                }
                if (activeChat) {
                    await StopChat();
                } else {
                    await StopCurrent();
                }
                if (state.status) {
                    state.status.current = null;
                    state.status.chat = null;
                }
                state.busy = false;
            } catch (e) {
                console.error('Failed to stop current active task on file drop:', e);
                return;
            }
        }
    }
    setMode('share');
    addSharePaths(paths || []);
}

function handleTrayCommand(command) {
    clearMessages();
    if (command === 'share') {
        setMode('share');
        state.activePanel = '';
        state.notice = '';
        render();
        return;
    }
    if (command === 'receive') {
        setMode('receive');
        state.activePanel = '';
        state.notice = '';
        render();
        return;
    }
    if (command === 'chat') {
        setMode('chat');
        state.activePanel = '';
        state.notice = '';
        render();
        return;
    }
    if (command === 'settings' || command === 'about' || command === 'feedback') {
        state.activePanel = command;
        render();
        return;
    }
    if (command === 'refresh') {
        refreshStatus();
    }
}

function setMode(mode) {
    if (state.mode === mode) {
        if (mode === 'chat') {
            startChatUsage();
        }
        return;
    }
    if (state.mode === 'chat') {
        stopChatUsage();
    }
    state.mode = mode;
    if (mode === 'chat') {
        startChatUsage();
    }
}

function loadChatUsage() {
    const today = todayKey();
    state.chatUsageDate = today;
    state.chatUsageMs = 0;
    state.chatUsageStartedAt = 0;
    try {
        const saved = JSON.parse(window.localStorage.getItem(chatUsageStorageKey) || '{}');
        if (saved.date === today) {
            state.chatUsageMs = Math.max(0, Number(saved.usedMs || 0));
        }
    } catch {
        state.chatUsageMs = 0;
    }
}

function saveChatUsage() {
    window.localStorage.setItem(chatUsageStorageKey, JSON.stringify({
        date: todayKey(),
        usedMs: Math.min(chatDailyFreeMs, Math.max(0, Math.round(state.chatUsageMs))),
    }));
}

function startChatUsage() {
    rollChatUsageDay();
    if (hasPaidLicense() || state.chatUsageStartedAt || chatRemainingMs() <= 0) {
        return;
    }
    state.chatUsageStartedAt = Date.now();
    scheduleChatUsageTimer();
}

function stopChatUsage() {
    if (!state.chatUsageStartedAt) {
        return;
    }
    state.chatUsageMs = Math.min(chatDailyFreeMs, state.chatUsageMs + Date.now() - state.chatUsageStartedAt);
    state.chatUsageStartedAt = 0;
    saveChatUsage();
    clearChatUsageTimer();
}

function scheduleChatUsageTimer() {
    clearChatUsageTimer();
    chatUsageTimer = window.setInterval(async () => {
        saveChatUsageSnapshot();
        if (hasPaidLicense()) {
            clearChatUsageTimer();
            updateChatQuotaSurface();
            return;
        }
        if (state.mode === 'chat') {
            updateChatQuotaSurface();
        }
    }, 1000);
}

function updateChatQuotaSurface() {
    const top = document.querySelector('#top-chat-quota');
    if (top) {
        if (hasPaidLicense()) {
            top.remove();
        } else {
            top.textContent = chatQuotaTopText();
        }
    }
    const text = document.querySelector('#chat-quota-text');
    if (text) {
        text.textContent = chatQuotaText();
    }
    const button = document.querySelector<HTMLButtonElement>('#start-chat');
    if (button) {
        button.disabled = state.busy;
        button.textContent = chatStartButtonText();
    }
}

function updateMessagesSurface() {
    const workspace = document.querySelector('.workspace');
    if (!workspace) {
        return;
    }
    workspace.querySelectorAll(':scope > .notice.success, :scope > .notice.error').forEach((node) => node.remove());
    if (state.notice) {
        workspace.insertAdjacentHTML('beforeend', `<div class="notice success">${escapeHTML(state.notice)}</div>`);
    }
    if (state.error) {
        workspace.insertAdjacentHTML('beforeend', `<div class="notice error">${escapeHTML(state.error)}</div>`);
    }
}

function clearChatUsageTimer() {
    if (chatUsageTimer) {
        window.clearInterval(chatUsageTimer);
        chatUsageTimer = null;
    }
}

function saveChatUsageSnapshot() {
    rollChatUsageDay();
    if (!state.chatUsageStartedAt) {
        saveChatUsage();
        return;
    }
    const usedMs = Math.min(chatDailyFreeMs, state.chatUsageMs + Date.now() - state.chatUsageStartedAt);
    window.localStorage.setItem(chatUsageStorageKey, JSON.stringify({
        date: todayKey(),
        usedMs: Math.round(usedMs),
    }));
}

function chatRemainingMs() {
    rollChatUsageDay();
    const activeMs = state.chatUsageStartedAt ? Date.now() - state.chatUsageStartedAt : 0;
    return Math.max(0, chatDailyFreeMs - state.chatUsageMs - activeMs);
}

function rollChatUsageDay() {
    const today = todayKey();
    if (state.chatUsageDate === today) {
        return;
    }
    state.chatUsageDate = today;
    state.chatUsageMs = 0;
    state.chatUsageStartedAt = 0;
    state.chatQuotaNoticeShown = false;
    saveChatUsage();
}

function todayKey() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
}

function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
}

function chatQuotaText() {
    if (hasPaidLicense()) {
        return t('chat_unlocked', { tier: licenseTiers[state.license.tier] || state.license.tier });
    }
    const remaining = chatRemainingMs();
    if (remaining <= 0) {
        return t('chat_time_used_up');
    }
    return "";
}

function chatQuotaTopText() {
    if (hasPaidLicense()) {
        return `${licenseTiers[state.license.tier] || state.license.tier}`;
    }
    const remaining = chatRemainingMs();
    if (remaining <= 0) {
        return t('chat_top_used_up');
    }
    return t('chat_top_time', { time: formatDuration(remaining) });
}

function chatStartButtonText() {
    if (state.busy) {
        return t('working');
    }
    return t('start_chat');
}

function hasPaidLicense() {
    const license = state.license || loadLicense();
    if (!license || !license.tier || !licenseTiers[license.tier]) {
        return false;
    }
    if (state.status) {
        return Boolean(state.status.isPaid && !state.status.clockTampered);
    }
    return true;
}


function loadLicense() {
    try {
        const saved = JSON.parse(window.localStorage.getItem(licenseStorageKey) || '{}');
        if (saved && saved.tier && licenseTiers[saved.tier]) {
            state.license = saved;
            return saved;
        }
    } catch {
        // Ignore malformed local activation state.
    }
    state.license = null;
    return null;
}



function confirmRedeem() {
    const input = document.querySelector<HTMLInputElement>('#redeem-code');
    const code = String(input?.value || '').trim().toUpperCase();
    state.tempRedeemCode = code; // Save current input value so it's not cleared on re-render
    const result = validateRedeemCode(code);
    state.redeemMessage = '';
    state.redeemError = '';
    if (!result.ok) {
        state.redeemError = result.error;
        render();
        return;
    }
    
    state.isActivating = true;
    render();

    ActivateLicense(code).then(async function() {
        const redeemedAt = new Date().toISOString();
        saveLicense({
            tier: result.tier,
            codeHash: checksum(`${code}:stored`, 10),
            redeemedAt: redeemedAt,
            codeDate: result.codeDate,
        });
        state.redeemMessage = `${licenseTiers[result.tier]} activated successfully.`;
        state.tempRedeemCode = ''; // Clear on success
        stopChatUsage();
        await loadStatusData();
    }).catch(function(e) {
        state.redeemMessage = '';
        state.redeemError = e || 'Activation failed. Please check network and code validity.';
    }).finally(function() {
        state.isActivating = false;
        render();
    });
}

function resetLicense() {
    const button = document.querySelector<HTMLButtonElement>('#reset-license');
    if (button) button.disabled = true;
    (window as any).go?.main.App.ResetLicense().then(async function() {
        window.localStorage.removeItem(licenseStorageKey);
        state.license = null;
        state.redeemMessage = 'Activation reset on this device.';
        state.redeemError = '';
        if (state.mode === 'chat') {
            startChatUsage();
        }
        await loadStatusData();
        render();
    }).catch(function(e: any) {
        state.redeemError = e || 'Failed to reset activation.';
        render();
    }).finally(function() {
        if (button) button.disabled = false;
    });
}

let lastRefreshTime = 0;
function triggerManualRefresh() {
    const now = Date.now();
    const isOnline = navigator.onLine;
    const minInterval = isOnline ? 30000 : 3000;
    
    if (now - lastRefreshTime < minInterval) {
        const waitSec = Math.ceil((minInterval - (now - lastRefreshTime)) / 1000);
        showToast(t('refresh_too_fast', { sec: waitSec }) || `Refresh too frequent. Please wait ${waitSec}s.`);
        return;
    }
    
    state.isRefreshingLicense = true;
    render();
    
    RefreshLicenseStatus().then(async function(status) {
        lastRefreshTime = Date.now();
        state.status = status;
        showToast(t('refresh_success') || 'License status refreshed successfully.');
    }).catch(function(e) {
        lastRefreshTime = Date.now();
        showToast(e || 'Failed to refresh status.');
    }).finally(function() {
        state.isRefreshingLicense = false;
        render();
    });
}




function checksum(value, length) {
    let hash = 2166136261;
    for (const char of value) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(36).toUpperCase().padStart(length, '0').slice(-length);
}

function clearMessages() {
    state.error = '';
    state.notice = '';
}

function isTerminal(task) {
    return ['completed', 'stopped', 'failed', 'replaced'].includes(task.transferState || task.state);
}

function isTaskClosed(task) {
    return ['stopped', 'replaced'].includes(task.transferState || task.state);
}

function activeShareTask() {
    const task = state.status?.current;
    if (!task || task.action !== 'share' || isTaskClosed(task)) {
        return null;
    }
    return task;
}

function activeChatTask() {
    const task = state.status?.chat || state.status?.current;
    if (!task || task.action !== 'chat' || isTaskClosed(task)) {
        return null;
    }
    return task;
}

function activeChatPageURL() {
    return String(activeChatTask()?.pageUrl || '');
}

function canKeepChatFrame(previousChatURL) {
    const currentChatURL = activeChatPageURL();
    return Boolean(
        state.mode === 'chat'
        && previousChatURL
        && currentChatURL
        && previousChatURL === currentChatURL
        && document.querySelector('#chat-iframe')
    );
}

function reconcileChatQRState(status) {
    const task = status?.chat || status?.current;
    if (!task || task.action !== 'chat' || isTaskClosed(task)) {
        state.activeChatTaskId = 0;
        state.activeChatSessionKey = '';
        state.chatQRPulseArmed = false;
        state.lastChatDeviceCount = 0;
        state.chatQROpen = false;
        state.chatQRPromptDismissed = false;
        state.chatQRPulseUntil = 0;
        return;
    }
    const deviceCount = chatDeviceCount(task);
    const sessionKey = chatSessionKey(task);
    const samePendingSession = state.activeChatSessionKey === `id:${task.id || 0}` && sessionKey.startsWith('url:');
    if (samePendingSession) {
        state.activeChatSessionKey = sessionKey;
    } else if (state.activeChatSessionKey !== sessionKey) {
        const shouldPulse = state.chatQRPulseArmed;
        state.chatQRPulseArmed = false;
        state.activeChatTaskId = task.id;
        state.activeChatSessionKey = sessionKey;
        state.lastChatDeviceCount = deviceCount;
        state.chatQROpen = false;
        state.chatQRPromptDismissed = !shouldPulse;
        if (shouldPulse) {
            triggerChatQRPulse();
        } else {
            state.chatQRPulseUntil = 0;
        }
        return;
    }
    state.chatQRPulseArmed = false;
    state.activeChatTaskId = task.id;
    if (deviceCount > 1 && state.lastChatDeviceCount <= 1) {
        state.chatQROpen = false;
    }
    state.lastChatDeviceCount = deviceCount;
}

function chatSessionKey(task) {
    const pageUrl = String(task?.pageUrl || '').trim();
    if (pageUrl) {
        return `url:${pageUrl}`;
    }
    return `id:${task?.id || 0}`;
}

function shareItemStatus(task, path) {
    const current = shortName(task.transferCurrent || '');
    if (current && current === shortName(path)) {
        if (task.transferState === 'transferring') {
            return t('running') || '运行中';
        }
        return t('active') || '活跃';
    }
    if (task.transferState === 'waiting') {
        return t('waiting') || '等待中';
    }
    return t('locked') || '未开始';
}

function titleCase(value) {
    const text = String(value || '');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function formatBytes(value) {
    const size = Number(value || 0);
    if (!size) {
        return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    let next = size;
    let unit = 0;
    while (next >= 1024 && unit < units.length - 1) {
        next /= 1024;
        unit += 1;
    }
    return `${next >= 10 || unit === 0 ? next.toFixed(0) : next.toFixed(1)} ${units[unit]}`;
}

function messageTime(value) {
    if (!value) {
        return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

function refreshIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>';
}

function stopIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>';
}

function copyIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"></path></svg>';
}

function browserIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18"></path><path d="M12 3a13 13 0 0 1 0 18"></path><path d="M12 3a13 13 0 0 0 0 18"></path></svg>';
}

function settingsIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7z"></path><path d="M19.4 13.5a7.8 7.8 0 0 0 .1-1.5 7.8 7.8 0 0 0-.1-1.5l2-1.5-2-3.5-2.4 1a8 8 0 0 0-2.5-1.5L14 2h-4l-.5 2.5a8 8 0 0 0-2.5 1.5l-2.4-1-2 3.5 2 1.5a7.8 7.8 0 0 0-.1 1.5c0 .5 0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a8 8 0 0 0 2.5 1.5L10 22h4l.5-2.5a8 8 0 0 0 2.5-1.5l2.4 1 2-3.5z"></path></svg>';
}

function aboutIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 10v6"></path><path d="M12 7h.01"></path></svg>';
}

function feedbackIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4z"></path><path d="M8 9h8"></path><path d="M8 13h5"></path></svg>';
}

function giftIcon() {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 6H5a3 3 0 0 0-3 3v2a2 2 0 0 1 0 4v2a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3v-2a2 2 0 0 1 0-4V9a3 3 0 0 0-3-3z"></path><path d="M9 6v12" stroke-dasharray="3 3"></path><path d="M15 9l1 1.5 1.5.5-1.5.5-1 1.5-1-1.5-1.5-.5 1.5-.5z"></path></svg>';
}

function diamondIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12l4 6-10 12L2 9z"></path><path d="M11 3 8 9l4 12 4-12-3-6"></path><path d="M2 9h20"></path></svg>';
}

function computerIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="2"></rect><path d="M8 20h8"></path><path d="M12 16v4"></path></svg>';
}

function qrIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4z"></path><path d="M14 4h6v6h-6z"></path><path d="M4 14h6v6H4z"></path><path d="M14 14h2v2h-2z"></path><path d="M18 14h2v6h-4v-2h2z"></path><path d="M14 18h2v2h-2z"></path></svg>';
}

function folderIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>';
}

function chevronIcon(open) {
    return open
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 15-6-6-6 6"></path></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>';
}

function linkIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"></path><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1"></path></svg>';
}

function phoneIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2"></rect><path d="M11 18h2"></path></svg>';
}

function signalIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20v-3"></path><path d="M9 20v-6"></path><path d="M14 20v-9"></path><path d="M19 20V7"></path></svg>';
}

function checkIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
}

function closeIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
}

function editIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>';
}

function shortName(path) {
    return String(path || '').split(/[\\/]/).filter(Boolean).pop() || path || '';
}

function cleanChatProfileName(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function cleanChatAvatar(value) {
    const text = String(value || '').trim();
    if (text.startsWith('data:image/')) {
        return text;
    }
    return Array.from(text).slice(0, 4).join('');
}

function renderAvatarMarkup(avatarVal, fallbackText) {
    const val = cleanChatAvatar(avatarVal);
    if (val.startsWith('data:image/')) {
        return `<img src="${escapeAttr(val)}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" />`;
    }
    return escapeHTML(val || fallbackText);
}

function qrImageURL(pageUrl) {
    if (!pageUrl) {
        return '';
    }
    try {
        const url = new URL(pageUrl);
        const cleanPath = url.pathname.replace(/\/$/, '');
        if (cleanPath.endsWith('/qr')) {
            url.pathname = `${cleanPath}/image`;
        } else if (cleanPath.includes('/chat/')) {
            url.pathname = `${cleanPath}/qr/image`;
        } else {
            url.pathname = '/qr/image';
        }
        url.search = '';
        url.hash = '';
        return url.toString();
    } catch {
        return '';
    }
}





function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
    })[char]);
}

function escapeAttr(value) {
    return escapeHTML(value).replace(/`/g, '&#096;');
}



EventsOn('eqt:tray-command', handleTrayCommand);

window.addEventListener('beforeunload', stopChatUsage);



loadChatUsage();
render();
loadSettings().then(() => {
    connectAgentEvents();
    window.setTimeout(() => runAutoUpdateCheck(true, updateMessagesSurface), 5000);
});

// Register one-time global event delegations for opening history files & folders
document.addEventListener('click', (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (state.showEmojiPicker) {
        const picker = document.getElementById('emoji-picker-popover');
        const trigger = document.getElementById('btn-emoji-more');
        if (picker && target && !picker.contains(target) && !trigger?.contains(target)) {
            state.showEmojiPicker = false;
            syncPanelSurface();
        }
    }

    const pathLink = target?.closest<HTMLElement>('.path-link');
    if (pathLink && pathLink.id !== 'open-chat-save') {
        const path = pathLink.dataset.openPath;
        if (path) {
            run(async () => {
                await (window as any).go?.main.App.OpenPath(path);
            }, {busy: false});
        }
        return;
    }

    const fileLink = target?.closest<HTMLElement>('[data-open-file]');
    if (fileLink) {
        const file = fileLink.dataset.openFile;
        if (file) {
            run(async () => {
                await (window as any).go?.main.App.OpenFile(file);
            }, {busy: false});
        }
        return;
    }
});

// Register a global event delegation for the auto-stop switch change
document.addEventListener('change', async (event: Event) => {
    const target = event.target as HTMLElement | null;
    const autoStopSwitch = target?.closest<HTMLInputElement>('#auto-stop-switch');
    if (autoStopSwitch) {
        const enabled = autoStopSwitch.checked;
        await run(async () => {
            const status = await SetAutoStop(enabled);
            state.status = status;
            
            // 立即局部更新 UI，以保证开关状态的即时反馈，防止下一次轮询前的显示延迟
            if (state.mode === 'receive') {
                const activeTask = activeReceiveTask();
                if (activeTask) {
                    updateReceiveTransferActiveUI(activeTask);
                }
            } else if (state.mode === 'share') {
                const activeTask = activeShareTask();
                if (activeTask) {
                    updateShareTransferActiveUI(activeTask);
                }
            }
            
            syncPanelSurface();
        }, { busy: false });
    }
});

function compressImageToWebP(file, quality = 0.75, maxWidth = 1200, maxHeight = 1200) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e: ProgressEvent<FileReader>) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth || height > maxHeight) {
                    if (width > height) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    } else {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                let dataUrl = canvas.toDataURL('image/webp', quality);
                let format = 'image/webp';
                if (!dataUrl.startsWith('data:image/webp')) {
                    dataUrl = canvas.toDataURL('image/jpeg', quality);
                    format = 'image/jpeg';
                }
                resolve({ dataUrl, format });
            };
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = String(e.target?.result || '');
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

window.renderReceiveDeviceProgressHtml = renderReceiveDeviceProgressHtml;
window.render = render;
window.state = state;

// 全局 input/textarea 的右键菜单支持 (Context menu for text elements)
document.addEventListener('contextmenu', (e: MouseEvent) => {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        const isReadOnly = target.readOnly || target.disabled;
        const type = target.getAttribute('type') || 'text';
        if (type === 'checkbox' || type === 'radio' || type === 'file') {
            return;
        }

        e.preventDefault();
        const labels = getTextContextMenuLabels();
        const items = [];

        // 剪切
        if (!isReadOnly) {
            items.push({
                label: labels.cut,
                action: () => {
                    const start = target.selectionStart || 0;
                    const end = target.selectionEnd || 0;
                    const val = target.value;
                    if (start !== end) {
                        const selectedText = val.substring(start, end);
                        navigator.clipboard.writeText(selectedText).then(() => {
                            target.value = val.substring(0, start) + val.substring(end);
                            target.dispatchEvent(new Event('input', { bubbles: true }));
                            target.dispatchEvent(new Event('change', { bubbles: true }));
                        });
                    }
                }
            });
        }

        // 复制
        items.push({
            label: labels.copy,
            action: () => {
                const start = target.selectionStart || 0;
                const end = target.selectionEnd || 0;
                if (start !== end) {
                    const selectedText = target.value.substring(start, end);
                    navigator.clipboard.writeText(selectedText);
                }
            }
        });

        // 粘贴
        if (!isReadOnly) {
            items.push({
                label: labels.paste,
                action: () => {
                    navigator.clipboard.readText().then(text => {
                        const start = target.selectionStart || 0;
                        const end = target.selectionEnd || 0;
                        const val = target.value;
                        target.value = val.substring(0, start) + text + val.substring(end);
                        target.dispatchEvent(new Event('input', { bubbles: true }));
                        target.dispatchEvent(new Event('change', { bubbles: true }));
                        setTimeout(() => {
                            target.selectionStart = target.selectionEnd = start + text.length;
                        }, 0);
                    }).catch(() => {});
                }
            });
        }

        // 全选
        items.push({
            label: labels.selectAll,
            action: () => {
                target.select();
            }
        });

        showContextMenu(items, e.clientX, e.clientY);
    }
});

function getTextContextMenuLabels() {
    const lang = (state && state.settings && state.settings.lang) || 'zh';
    if (lang.startsWith('zh')) {
        return { cut: '剪切', copy: '复制', paste: '粘贴', selectAll: '全选' };
    } else if (lang.startsWith('ja')) {
        return { cut: '切り取り', copy: 'コピー', paste: '貼り付け', selectAll: 'すべて選択' };
    } else if (lang.startsWith('ko')) {
        return { cut: '잘라내기', copy: '복사', paste: '붙여넣기', selectAll: '모두 선택' };
    } else if (lang.startsWith('es')) {
        return { cut: 'Cortar', copy: 'Copiar', paste: 'Pegar', selectAll: 'Seleccionar todo' };
    } else if (lang.startsWith('de')) {
        return { cut: 'Ausschneiden', copy: 'Kopieren', paste: 'Einfügen', selectAll: 'Alles auswählen' };
    } else if (lang.startsWith('fr')) {
        return { cut: 'Couper', copy: 'Copier', paste: 'Coller', selectAll: 'Tout sélectionner' };
    }
    return { cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All' };
}
