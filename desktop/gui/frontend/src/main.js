import { state } from './state.js';
import { t, getSystemLocale } from './i18n.js';
import { allEmojis, culturalEmojis, getCategoryLocalizedName } from './emojis.js';
import './style.css';
import './app.css';
import faviconURL from './assets/images/favicon.png';
import horizontalLogoURL from './assets/images/logo-horizontal.png';
import logoMarkURL from './assets/images/logo-mark.png';
import morphdom from './vendor/morphdom.js';

import {ClipboardGetText, ClipboardSetText, EventsOn, OnFileDrop, LogInfo, LogError} from '../wailsjs/runtime/runtime';
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
} from '../wailsjs/go/main/App';

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

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

const agentEventsURL = 'http://127.0.0.1:48176/events';
const chatDailyFreeMs = 5 * 60 * 1000;
const chatUsageStorageKey = 'eqt.chat.dailyFreeUsage';
const licenseStorageKey = 'eqt.license.activation';
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
    const frame = document.querySelector('#chat-iframe');
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

// postMessage bridge: handle native operations requested by the chat iframe.
window.addEventListener('message', (e) => {
    if (!isTrustedChatFrameMessage(e)) { return; }
    if (!e.data || typeof e.data !== 'object') { return; }
    if (e.data.type === 'save-file') {
        const url = String(e.data.url || '');
        if (!isTrustedChatURL(url, e.origin)) { return; }
        SaveChatAttachmentAs(url, String(e.data.name || 'attachment')).catch(() => {});
    } else if (e.data.type === 'auto-save-file') {
        const url = String(e.data.url || '');
        const id = String(e.data.id || url);
        if (!state.chatAutoSave || autoSavedAttachments.has(id) || !isTrustedChatURL(url, e.origin)) { return; }
        autoSavedAttachments.add(id);
        DownloadChatAttachment(url, String(e.data.name || 'attachment'))
            .then((path) => {
                if (path) {
                    state.chatSaveDir = path.replace(/[\\/][^\\/]*$/, '');
                }
            })
            .catch(() => {
                autoSavedAttachments.delete(id);
            });
    } else if (e.data.type === 'open-file') {
        OpenFile(String(e.data.path || '')).catch(() => {});
    } else if (e.data.type === 'read-clipboard-text') {
        const requestId = String(e.data.requestId || '');
        if (!requestId) { return; }
        ClipboardGetText()
            .then((text) => {
                e.source?.postMessage({type: 'clipboard-text', requestId, text: String(text || '')}, e.origin);
            })
            .catch(() => {
                e.source?.postMessage({type: 'clipboard-text', requestId, text: '', error: 'clipboard unavailable'}, e.origin);
            });
    }
});

function activeChatFrameOrigin() {
    const frame = document.querySelector('#chat-iframe');
    if (!frame?.src) { return ''; }
    try { return new URL(frame.src).origin; } catch { return ''; }
}

function isTrustedChatFrameMessage(event) {
    const frame = document.querySelector('#chat-iframe');
    if (!frame || event.source !== frame.contentWindow) { return false; }
    const origin = activeChatFrameOrigin();
    return Boolean(origin && event.origin === origin);
}

function isTrustedChatURL(rawURL, origin) {
    try {
        const parsed = new URL(rawURL);
        return parsed.origin === origin && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
    } catch {
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
        '.sidebar-history',
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
    const activeRecv = state.status?.current && state.status.current.action === 'receive' && !isTerminal(state.status.current) ? state.status.current : null;
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
                    <button class="menu-button" id="open-settings" title="${t('settings')}" aria-label="${t('settings')}">
                        <span class="menu-icon">${settingsIcon()}</span>
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
    return `
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
                ${(!isPaid) ? `
                    <div class="quota-countdown" style="font-size: 11px; color: var(--danger); font-weight: 800; border: 1px solid var(--danger); padding: 4px 8px; border-radius: 6px; background: rgba(180, 35, 24, 0.05); text-transform: uppercase; letter-spacing: 0.05em; display: inline-block; white-space: nowrap;">
                        ${remaining > 0 ? `free ulimited: ${remaining}` : `free limit exceeded (restricted)`}
                    </div>
                ` : ''}
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
                <button class="primary" id="start-share" ${state.busy || !hasItems || state.shareLimitNotice ? 'disabled' : ''}>${state.busy ? t('working') : t('start_transfer')}</button>
                <button class="ghost" id="clear-share" ${!hasItems ? 'disabled' : ''}>${t('clear')}</button>
            </div>
        </div>
    `;
}

function renderSide() {
    if (state.mode === 'chat' || state.settings?.showHistory === false) {
        return '';
    }
    const history = state.status?.history || [];
    return `
        <aside class="side">
            <div class="panel">
                <div class="panel-head">
                    <h2>${t('recent_history')}</h2>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <button class="ghost" id="refresh" style="min-height: 28px; padding: 4px 10px; font-size: 12px;">${t('refresh')}</button>
                        <button class="ghost" id="clear-history" ${history.length ? '' : 'disabled'} style="min-height: 28px; padding: 4px 10px; font-size: 12px;">${t('clear')}</button>
                    </div>
                </div>
                ${renderHistory(history)}
            </div>
        </aside>
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

    const countdownHtml = (!isPaid && task.transferState !== 'waiting') ? `
        <div class="quota-countdown" style="font-size: 11px; color: var(--danger); font-weight: 800; border: 1px solid var(--danger); padding: 4px 8px; border-radius: 6px; background: rgba(180, 35, 24, 0.05); text-transform: uppercase; letter-spacing: 0.05em; display: inline-block; white-space: nowrap; margin-top: 6px;">
            ${remaining > 0 ? `free ulimited: ${remaining}` : `free limit exceeded (restricted)`}
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
                    👥 ${t('devices_count') || '设备数'}: <span id="current-devices-count" style="color: var(--accent-strong); font-weight: 800;">${task.transferDeviceCount || 0}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px; position: relative;">
                    <span class="has-tooltip has-tooltip-bottom-left" data-tooltip="${escapeAttr(state.settings?.lang === 'zh' ? '所有设备都传输完成后，自动停止本次传输任务' : 'Automatically stop the transfer task when all devices finish downloading')}" style="font-size: 12px; font-weight: 600; color: var(--text-secondary); border-bottom: 1px dashed var(--text-muted); padding-bottom: 1px; cursor: help;">
                        ${state.settings?.lang === 'zh' ? '自动结束' : 'Auto Stop'}
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
        const showLimit = 3;
        const isExpanded = !!state.devicesExpanded;
        const displayClients = isExpanded ? clients : clients.slice(0, showLimit);

        const listItems = displayClients.map(client => {
            const devName = client.deviceName || 'Device';
            const stateText = getTranslatedState(client.state || 'waiting');
            return `
                <li style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: var(--bg-hover); border-radius: 6px; margin-bottom: 6px; box-sizing: border-box; width: 100%; gap: 12px;">
                    <span style="color: var(--text-primary); font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60%;">${escapeHTML(devName)}</span>
                    <span style="color: var(--accent-strong); font-size: 12px; font-weight: 800; white-space: nowrap;">${escapeHTML(stateText)}</span>
                </li>
            `;
        }).join('');

        const expandButton = (clients.length > showLimit) ? `
            <button class="ghost compact toggle-devices-expand" style="margin-top: 4px; font-size: 12px; font-weight: 700; width: 100%; text-align: center; border: 1px dashed var(--line); border-radius: 6px; padding: 4px;">
                ${isExpanded ? t('hide_more_devices') || '折叠部分设备' : `${t('show_more_devices') || '查看更多设备'} (${clients.length - showLimit})`}
            </button>
        ` : '';

        const scrollStyle = (isExpanded && clients.length > showLimit) ? 'max-height: 150px; overflow-y: auto; border: 1.2px solid var(--line); padding: 8px; border-radius: 8px; box-sizing: border-box;' : '';

        deviceProgressHtml = `
            <div class="devices-progress-section" style="margin: 6px 0 14px 0; text-align: left; box-sizing: border-box; width: 100%;">
                <strong style="display: block; font-size: 12px; font-weight: 700; color: var(--text-secondary); margin-bottom: 8px;">📱 ${t('devices_progress') || '设备传输进度'}</strong>
                <div class="devices-scroll-container" style="${scrollStyle}">
                    <ul style="list-style: none; padding: 0; margin: 0; width: 100%;">${listItems}</ul>
                </div>
                ${expandButton}
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
        countEl.textContent = task.transferDeviceCount || 0;
    }

    // 3. 自动结束开关
    const switchEl = document.getElementById('auto-stop-switch');
    if (switchEl) {
        switchEl.checked = !!task.transferAutoStop;
    }

    // 4. 设备进度列表局部更新
    const devicesWrapper = document.getElementById('devices-progress-wrapper');
    if (devicesWrapper) {
        devicesWrapper.innerHTML = renderDeviceProgressHtml(task);
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
    const shouldShowCountdown = (!isPaid && task.transferState !== 'waiting');
    
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
    if (!task || task.action !== 'receive' || isTerminal(task)) {
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
        <div class="receive-box">
            <label>${t('receive_dir')}</label>
            <div class="directory-row">
                <input id="receive-dir" value="${escapeAttr(output)}" placeholder="Choose a folder" />
                <button id="choose-receive">${t('choose')}</button>
            </div>
        </div>
        <div class="primary-row">
            <button class="primary" id="start-receive" ${state.busy || !output.trim() ? 'disabled' : ''}>${state.busy ? t('working') : t('start_receive')}</button>
            <button class="ghost" id="save-receive-dir">${t('save_dir')}</button>
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

    const countdownHtml = (!isPaid && task.transferState !== 'waiting') ? `
        <div class="quota-countdown" style="font-size: 11px; color: var(--danger); font-weight: 800; border: 1px solid var(--danger); padding: 4px 8px; border-radius: 6px; background: rgba(180, 35, 24, 0.05); text-transform: uppercase; letter-spacing: 0.05em; display: inline-block; white-space: nowrap; margin-top: 6px;">
            ${remaining > 0 ? `free ulimited: ${remaining}` : `free limit exceeded (restricted)`}
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
            
            ${isQRExpanded && qrImage ? `
                <div class="qr-hero">
                    <img src="${escapeAttr(qrImage)}" alt="Transfer QR code" />
                    <button class="ghost open-qr" data-open-url="${escapeAttr(task.pageUrl)}">${t('open_in_browser')}</button>
                </div>
            ` : (isQRExpanded ? `<div class="empty-state transfer-empty" style="margin-top: 12px;">${t('waiting_qr')}</div>` : '')}
            
            ${files.length > 0 ? `
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
                                    ${dir ? `
                                        <button class="icon-button-mini open-dir-action path-link" data-open-path="${escapeAttr(dir)}" title="${escapeAttr(t('open_folder_title'))}">
                                            ${openFolderIcon()}
                                        </button>
                                    ` : ''}
                                </div>
                            </li>
                        `;
                    }).join('')}</ul>
                </div>
            ` : ''}
            ${task.error ? `<div class="notice error compact">${escapeHTML(task.error)}</div>` : ''}
        </div>
    `;
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
        if (state.settings?.lang) {
            urlObj.searchParams.set('lang', state.settings.lang);
        }
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
    if (!state.settings) {
        return '';
    }
    const options = (state.settings.interfaceOptions || []).map((option) => `
        <option value="${escapeAttr(option.name)}" ${option.name === state.settings.interface ? 'selected' : ''}>${escapeHTML(option.label || option.name)}</option>
    `).join('');
    const chatSender = state.settings.chatSender || '';
    const chatAvatar = state.settings.chatAvatar || '';
    const chatAvatarPreview = cleanChatAvatar(chatAvatar) || (cleanChatProfileName(chatSender).charAt(0) || 'D').toUpperCase();
    return `
        <div class="settings-panel">

            <section class="settings-section">
                <div class="settings-section-head">
                    <h3>${t('lang_title')}</h3>
                    <span>${t('lang_desc')}</span>
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>${t('lang_pref')}</strong>
                        <span>${t('lang_desc')}</span>
                    </div>
                    <select id="settings-lang">
                        <option value="zh" ${state.settings?.lang === 'zh' ? 'selected' : ''}>${t('lang_zh')}</option>
                        <option value="en" ${state.settings?.lang === 'en' ? 'selected' : ''}>${t('lang_en')}</option>
                        <option value="ja" ${state.settings?.lang === 'ja' ? 'selected' : ''}>${t('lang_ja')}</option>
                        <option value="ko" ${state.settings?.lang === 'ko' ? 'selected' : ''}>${t('lang_ko')}</option>
                        <option value="es" ${state.settings?.lang === 'es' ? 'selected' : ''}>${t('lang_es')}</option>
                        <option value="de" ${state.settings?.lang === 'de' ? 'selected' : ''}>${t('lang_de')}</option>
                        <option value="fr" ${state.settings?.lang === 'fr' ? 'selected' : ''}>${t('lang_fr')}</option>
                    </select>
                </div>
            </section>

            <section class="settings-section">
                <div class="settings-section-head">
                    <h3>${t('sys_integration')}</h3>
                    <span>${t('sys_integration_desc')}</span>
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>${t('right_click_menu')}</strong>
                        <span id="right-click-status-text">${escapeHTML(integrationStatusText(state.rightClickIntegration, t('right_click_desc')))}</span>
                    </div>
                    <div class="setting-control-stack" id="right-click-control">
                        ${renderStatusBadge(state.rightClickIntegration)}
                        ${renderSwitch('settings-right-click', state.rightClickIntegration?.enabled, state.rightClickIntegration?.supported === false)}
                    </div>
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>${t('startup_title')}</strong>
                        <span id="startup-status-text">${escapeHTML(integrationStatusText(state.startupIntegration, t('startup_desc')))}</span>
                    </div>
                    <div class="setting-control-stack" id="startup-control">
                        ${renderStatusBadge(state.startupIntegration)}
                        ${renderSwitch('settings-startup', state.startupIntegration?.enabled, state.startupIntegration?.supported === false)}
                    </div>
                </div>
            </section>

            <section class="settings-section">
                <div class="settings-section-head">
                    <h3>${t('chat')}</h3>
                    <span>${t('chat_identity_desc')}</span>
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>${t('chat_sender')}</strong>
                        <span>${t('chat_sender_desc')}</span>
                    </div>
                    ${state.isEditingChatSender ? `
                        <div class="chat-sender-edit-wrapper">
                            <input id="settings-chat-sender" type="text" maxlength="20" value="${escapeAttr(chatSender)}" placeholder="Desktop" />
                            <button type="button" class="icon-button save-chat-sender" title="${t('btn_confirm')}">${checkIcon()}</button>
                            <button type="button" class="icon-button cancel-chat-sender" title="${t('btn_reset')}">${closeIcon()}</button>
                        </div>
                    ` : `
                        <div class="chat-sender-static-wrapper">
                            <span class="chat-sender-static-text">${escapeHTML(chatSender || 'Desktop')}</span>
                            <button type="button" class="icon-button edit-chat-sender" title="${t('rename')}">${editIcon()}</button>
                        </div>
                    `}
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>${t('chat_avatar')}</strong>
                        <span>${t('chat_avatar_desc')}</span>
                    </div>
                    <div class="avatar-setting-row">
                        <div class="avatar-preview-wrapper">
                            <span class="avatar-preview">${renderAvatarMarkup(chatAvatar, (cleanChatProfileName(chatSender).charAt(0) || 'D').toUpperCase())}</span>
                        </div>
                        <div class="avatar-inputs-stack" style="position: relative; z-index: 9;">
                            <div class="avatar-actions">
                                <button type="button" id="btn-avatar-upload" class="avatar-action-btn">${t('btn_upload_image')}</button>
                                <button type="button" id="btn-emoji-more" class="avatar-action-btn">${t('btn_emoji') || 'Emoji'}</button>
                                <input type="file" id="settings-avatar-file" accept="image/*" style="display:none;" />
                                ${chatAvatar.startsWith('data:image/') ? `
                                    <button type="button" id="btn-avatar-reset" class="avatar-action-btn reset-btn">${t('btn_reset')}</button>
                                ` : ''}
                            </div>
                            ${state.showEmojiPicker ? (() => {
                                const allCulturalEmojis = Object.values(culturalEmojis).flatMap(g => g.emojis);
                                const combined = [...allCulturalEmojis, ...allEmojis];
                                const uniqueEmojis = Array.from(new Set(combined));
                                return `
                                    <div class="emoji-picker-popover" id="emoji-picker-popover">
                                        <div class="emoji-picker-custom-row">
                                            <input type="text" id="emoji-picker-custom-input" placeholder="${escapeAttr(t('emoji_picker_custom_placeholder') || '自定义...')}" maxlength="8" />
                                            <button type="button" id="btn-emoji-picker-custom-submit" class="avatar-action-btn">${t('btn_confirm') || '确定'}</button>
                                        </div>
                                        <div class="emoji-picker-divider"></div>
                                        <div class="emoji-picker-scroll-area">
                                            <div class="emoji-picker-grid">
                                                ${uniqueEmojis.map(emoji => `
                                                    <button type="button" class="emoji-picker-item" data-emoji="${escapeAttr(emoji)}">${escapeHTML(emoji)}</button>
                                                `).join('')}
                                            </div>
                                        </div>
                                    </div>
                                `;
                            })() : ''}
                        </div>
                    </div>
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>${t('chat_autosave')}</strong>
                        <span>${t('chat_autosave_desc')}</span>
                    </div>
                    <div class="setting-control-stack">
                        ${renderSwitch('settings-chat-autosave', state.chatAutoSave)}
                        <button type="button" class="icon-button-mini path-link" id="open-chat-save" data-open-path="${escapeAttr(state.chatSaveDir || '')}" title="${t('open_folder')}" aria-label="${t('open_folder')}" style="padding: 4px; display: inline-flex; align-items: center; justify-content: center;">${openFolderIcon()}</button>
                    </div>
                </div>
            </section>

            <section class="settings-section">
                <div class="settings-section-head">
                    <h3>${t('window_settings')}</h3>
                    <span>${t('window_settings_desc')}</span>
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>${t('close_action')}</strong>
                        <span>${t('close_action_desc')}</span>
                    </div>
                    <select id="settings-close-behavior">
                        <option value="tray" ${state.closeBehavior !== 'quit' ? 'selected' : ''}>${t('keep_tray')}</option>
                        <option value="quit" ${state.closeBehavior === 'quit' ? 'selected' : ''}>${t('quit_app')}</option>
                    </select>
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>${t('show_history_title')}</strong>
                        <span>${t('show_history_desc')}</span>
                    </div>
                    <div class="setting-control-stack">
                        ${renderSwitch('settings-show-history', state.settings?.showHistory !== false)}
                    </div>
                </div>
            </section>

            <section class="settings-section">
                <div class="settings-section-head">
                    <h3>${t('update_settings')}</h3>
                    <span>${t('update_settings_desc')}</span>
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>${t('update_mode')}</strong>
                        <span>${t('update_mode_desc')}</span>
                    </div>
                    <select id="settings-auto-update-mode">
                        <option value="off" ${state.settings?.autoUpdateMode === 'off' ? 'selected' : ''}>${t('update_off')}</option>
                        <option value="notify" ${state.settings?.autoUpdateMode === 'notify' ? 'selected' : ''}>${t('update_notify')}</option>
                        <option value="download" ${state.settings?.autoUpdateMode === 'download' ? 'selected' : ''}>${t('update_download')}</option>
                        <option value="silent" ${state.settings?.autoUpdateMode === 'silent' ? 'selected' : ''}>${t('update_silent')}</option>
                    </select>
                </div>

                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>${t('check_update')}</strong>
                        <span id="update-check-status">${escapeHTML(state.updateStatusText || t('manual_check_tips'))}</span>
                    </div>
                    <button type="button" class="secondary" id="btn-manual-update-check" ${state.updateBtnDisabled ? 'disabled' : ''}>${escapeHTML(state.updateBtnText || t('manual_check_btn'))}</button>
                </div>
            </section>

            <details class="settings-advanced-details" ${state.settingsAdvancedOpen ? 'open' : ''}>
                <summary class="settings-advanced-summary">${t('adv_settings')}</summary>
                <div class="settings-advanced-content">
                    <div class="setting-row">
                        <div class="setting-copy">
                            <strong>${t('net_interface')}</strong>
                            <span>${t('net_interface_desc')}</span>
                        </div>
                        <select id="settings-interface">${options}</select>
                    </div>
                    <div class="setting-row">
                        <div class="setting-copy">
                            <strong class="setting-label-with-help" data-help="${escapeAttr(getPortHelpText())}" tabindex="0">${t('port_title')} <span aria-hidden="true">?</span></strong>
                            <span>${t('port_desc')}</span>
                        </div>
                        <input id="settings-port" type="number" min="0" max="65535" value="${Number(state.settings.port || 0)}" data-help="${escapeAttr(getPortHelpText())}" />
                    </div>
                    <div class="setting-row">
                        <div class="setting-copy">
                            <strong>${t('browser_fallback')}</strong>
                            <span>${t('browser_fallback_desc')}</span>
                        </div>
                        ${renderSwitch('settings-browser', state.browserFallback)}
                    </div>
                    <div class="setting-row">
                        <div class="setting-copy">
                            <strong>${t('update_check_interval')}</strong>
                            <span>${t('update_check_interval_desc')}</span>
                        </div>
                        <select id="settings-update-interval">
                            <option value="12" ${state.settings?.updateCheckIntervalHours === 12 ? 'selected' : ''}>${t('hours_12')}</option>
                            <option value="24" ${state.settings?.updateCheckIntervalHours === 24 || !state.settings?.updateCheckIntervalHours ? 'selected' : ''}>${t('hours_24')}</option>
                            <option value="48" ${state.settings?.updateCheckIntervalHours === 48 ? 'selected' : ''}>${t('hours_48')}</option>
                        </select>
                    </div>
                </div>
            </details>
        </div>
    `;
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
    const info = state.appInfo || {};
    const license = state.license || loadLicense();
    let plan = '';
    if (license?.tier) {
        if (license.tier === 'PLUS' && (license.codeDate === 'LIFETIME' || state.status?.licenseExpiresAt === 'LIFETIME')) {
            plan = 'PLUS U';
        } else {
            plan = license.tier.toUpperCase();
        }
    } else {
        plan = t('free_quota');
    }
    const expiresAt = state.status?.licenseExpiresAt || license?.codeDate;
    let expiryText = '';
    if (expiresAt && expiresAt !== 'LIFETIME' && expiresAt !== 'n/a') {
        const expiryDate = new Date(expiresAt);
        const now = new Date();
        const diffMs = expiryDate - now;
        if (diffMs <= 0) {
            expiryText = t('license_expired');
        } else {
            const diffSecs = Math.floor(diffMs / 1000);
            if (diffSecs < 60) {
                expiryText = t('license_expires_in_secs', { secs: diffSecs });
            } else if (diffSecs < 3600) {
                const mins = Math.floor(diffSecs / 60);
                const secs = diffSecs % 60;
                expiryText = t('license_expires_in_mins', { mins: mins, secs: secs });
            } else if (diffSecs < 86400) {
                const hrs = Math.floor(diffSecs / 3600);
                expiryText = t('license_expires_in_hours', { hours: hrs });
            } else {
                const days = Math.ceil(diffSecs / 86400);
                expiryText = t('license_expires_in_days', { days: days });
            }
        }
    }

    let redeemDetail = '';
    let expiryDetail = '';
    if (license?.redeemedAt) {
        redeemDetail = `${t('redeemed_at', { date: new Date(license.redeemedAt).toLocaleDateString() })}`;
        let expVal = '';
        if (expiresAt === 'LIFETIME') {
            expVal = t('lifetime') || '永久';
        } else if (expiresAt) {
            try {
                expVal = new Date(expiresAt).toLocaleDateString();
            } catch {
                expVal = expiresAt;
            }
        }
        if (expVal) {
            expiryDetail = `${t('expiry_label') || '有效期'}：${expVal}`;
            if (expiryText) {
                expiryDetail += ` (${expiryText})`;
            }
        }
    } else {
        redeemDetail = chatQuotaText();
    }
    
    let warningBox = '';
    const isPaid = hasPaidLicense();
    if (state.status) {
        if (state.status.clockTampered) {
            plan = t('paid_locked_clock');
            redeemDetail = t('locked_rollback');
            expiryDetail = '';
            warningBox = `
                <div class="notice error compact" style="margin-bottom: 16px; font-size: 13px; line-height: 1.4;">
                    <strong>⚠️ ${t('locked_rollback')}：</strong>
                    ${t('locked_rollback_desc')}
                </div>
            `;
        } else if (license?.tier && !isPaid) {
            plan = `${license.tier.toUpperCase()} ${t('license_locked_limit')}`;
            redeemDetail = t('license_locked_server');
            expiryDetail = '';
            warningBox = `
                <div class="notice error compact" style="margin-bottom: 16px; font-size: 13px; line-height: 1.4;">
                    <strong>⚠️ ${t('license_verify_failed')}</strong>
                    ${t('license_verify_failed_desc', { tier: license.tier.toUpperCase() })}
                </div>
            `;
        }
    }
    
    let devSection = '';
    if (state.settings?.devMode) {
        devSection = `
            <div class="dev-section" style="margin-top: 16px; padding-top: 16px; border-top: 1px dashed var(--line);">
                <h3 style="font-size: 14px; margin-bottom: 8px; color: var(--accent-strong);">${t('dev_options')}</h3>
                <div style="display: flex; flex-direction: column; gap: 8px; font-size: 13px;">
                    <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
                        <span>${t('enable_debug_logs')}</span>
                        <input type="checkbox" id="dev-debug-log" ${state.settings?.debugLog ? 'checked' : ''} />
                    </label>
                    <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
                        <span>${t('enable_viewport_debug')}</span>
                        <input type="checkbox" id="dev-viewport-debug" ${state.settings?.viewportDebug ? 'checked' : ''} />
                    </label>
                    <div style="color: var(--muted); font-size: 11px; margin-top: -4px; line-height: 1.4;">
                        ${t('dev_logs_desc')}
                        <br>${t('dev_logs_path')} <strong style="word-break: break-all;">${escapeHTML(info.logPath || 'Temp directory')}</strong>
                    </div>
                    <div style="display: flex; gap: 8px; margin-top: 6px;">
                        <button class="ghost" id="dev-open-log" style="flex: 1; padding: 4px 8px; font-size: 11px;">${t('btn_open_log_file')}</button>
                        <button class="ghost" id="dev-open-dir" style="flex: 1; padding: 4px 8px; font-size: 11px;">${t('btn_open_log_dir')}</button>
                    </div>
                    <div style="display: flex; gap: 8px; margin-top: 6px;">
                        <button class="ghost" id="dev-reset-quota" style="flex: 1; padding: 4px 8px; font-size: 11px; color: var(--accent); border-color: var(--accent);">${t('dev_reset_quota') || '重置每日计时'}</button>
                        <button class="ghost" id="dev-max-quota" style="flex: 1; padding: 4px 8px; font-size: 11px; color: var(--danger); border-color: var(--danger);">${t('dev_max_quota') || '快速达到10分钟'}</button>
                    </div>
                    <button class="danger inline" id="dev-disable-mode" style="margin-top: 6px; font-size: 11px; padding: 4px 8px; width: 100%;">
                        ${t('btn_exit_dev_mode')}
                    </button>
                </div>
            </div>
        `;
    }

    return `
        <div class="about-panel">
            ${warningBox}
            <div class="about-hero">
                <img class="about-logo" src="${horizontalLogoURL}" alt="EQT Easy QR Transfer" style="cursor: pointer;">
                <div class="about-plan">
                    <div class="about-plan-left">
                        <span style="display: inline-flex; align-items: center; gap: 6px;">
                            ${t('plan_label')}
                            <button class="tool-button ${state.isRefreshingLicense ? 'spinning' : ''}" id="refresh-license-btn" aria-label="Refresh license" style="padding: 0; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; border: none; background: transparent; cursor: pointer; color: var(--accent-strong); line-height: 1;" ${state.isRefreshingLicense ? 'disabled' : ''}>
                                <span style="width: 12px; height: 12px; display: flex; align-items: center; justify-content: center;">${refreshIcon()}</span>
                            </button>
                        </span>
                        <strong>${escapeHTML(plan)}</strong>
                        <small>${escapeHTML(redeemDetail)}</small>
                        ${expiryDetail ? `<small>${escapeHTML(expiryDetail)}</small>` : ''}
                    </div>
                    <button class="tool-button" id="toggle-plan-info" aria-label="${t('plan_desc_title')}" style="padding: 0; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border: none; background: transparent; cursor: pointer; color: var(--accent-strong); flex-shrink: 0;">
                        <span class="plan-info-icon-wrapper" data-tooltip="${escapeAttr(t('tooltip_popover_comparsion'))}">
                            <span style="width: 18px; height: 18px; display: flex; align-items: center; justify-content: center;">${diamondIcon()}</span>
                        </span>
                    </button>
                </div>
            </div>
            <dl>
                <dt>${t('product') || 'Product'}</dt><dd>${escapeHTML(info.product || 'EQT')} / ${escapeHTML(info.name || 'Easy QR Transfer')}</dd>
                <dt>${t('version') || 'Version'}</dt><dd>${escapeHTML(info.version || 'Unknown')}</dd>
                <dt>${t('platform') || 'Platform'}</dt><dd>${escapeHTML([info.os, info.arch].filter(Boolean).join(' / ') || 'Unknown')}</dd>
                <dt>${t('legal') || 'Legal'}</dt><dd>MIT license. Forked from qrcp.</dd>
            </dl>
            ${devSection}
        </div>
    `;
}

function renderPlanComparisonPanel() {
    const checkGreen = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#28a948" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0; margin-top:2px;"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    const xRed = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fc0035" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0; margin-top:2px;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

    return `
        <div class="plan-comparison-panel" style="max-height: calc(100vh - 150px); overflow-y: auto; padding: 4px; box-sizing: border-box;">
            <div class="plan-cards-container" style="display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); margin-bottom: 20px;">
                <!-- 体验卡片 -->
                <div class="plan-card" style="border: 1px solid var(--line); border-radius: 12px; padding: 22px; background: var(--bg); display: flex; flex-direction: column; text-align: left; transition: all 0.2s ease;">
                    <div style="margin-bottom: 12px;">
                        <span style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: var(--muted); letter-spacing: 0.05em;">Free</span>
                        <h3 style="font-size: 20px; margin: 4px 0; font-weight: 700; color: var(--ink);">${t('free_quota') || '体验版'}</h3>
                        <p style="font-size: 12px; color: var(--muted); margin: 6px 0 12px; min-height: 32px;">${t('free_tier_desc') || '局域网极速协作与传输体验版。'}</p>
                        <div style="font-size: 24px; font-weight: 800; color: var(--ink); margin-bottom: 16px;">¥0 <span style="font-size: 13px; font-weight: 400; color: var(--muted);">${t('lifetime') || '永久'}</span></div>
                    </div>
                    <ul style="list-style: none; padding: 0; margin: 0 0 20px; font-size: 13px; display: flex; flex-direction: column; gap: 10px; flex-grow: 1;">
                        <li style="display: flex; gap: 8px; align-items: flex-start; color: var(--ink);">
                            ${checkGreen} <span>${t('plan_feature_chat_free') || 'Chat 模式限制：每日 5 分钟满速。超额后限速 100 KB/s，且单文件限 2MB'}</span>
                        </li>
                        <li style="display: flex; gap: 8px; align-items: flex-start; color: var(--ink);">
                            ${checkGreen} <span>${t('plan_feature_share_free') || 'Share 电脑发送限制：每日免费 5 次。超额后单次限发 5 文件，总大小限 50MB'}</span>
                        </li>
                        <li style="display: flex; gap: 8px; align-items: flex-start; color: var(--ink);">
                            ${checkGreen} <span>${t('plan_feature_receive_free') || 'Receive 移动端上传限制：每日免费 5 次。超额后仅允许 1 台设备连接，且移动端限选 5 文件、单文件限 50MB'}</span>
                        </li>
                        <li style="display: flex; gap: 8px; align-items: flex-start; color: var(--ink);">
                            ${checkGreen} <span>${t('plan_feature_drag_and_drop') || '支持拖拽发送、历史保存、文件夹选择'}</span>
                        </li>
                    </ul>
                </div>

                <!-- PLUS / PLUS U 付费卡片 -->
                <div class="plan-card featured" style="border: 2px solid var(--accent); border-radius: 12px; padding: 22px; background: var(--bg); display: flex; flex-direction: column; text-align: left; position: relative; box-shadow: 0 8px 30px rgba(47, 158, 115, 0.06); transition: all 0.2s ease;">
                    <div style="position: absolute; top: -11px; right: 16px; background: var(--accent); color: #fff; font-size: 10px; font-weight: 800; padding: 3px 8px; border-radius: 12px; text-transform: uppercase; letter-spacing: 0.05em;">Recommended</div>
                    <div style="margin-bottom: 12px;">
                        <span style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: var(--accent); letter-spacing: 0.05em;">Pro Upgrade</span>
                        <h3 style="font-size: 20px; margin: 4px 0; font-weight: 700; color: var(--ink);">PLUS / PLUS U</h3>
                        <p style="font-size: 12px; color: var(--muted); margin: 6px 0 12px; min-height: 32px;">${t('plan_plus_desc_short') || '解除局域网 Chat 及文件传输的全部大小与频率限制。'}</p>
                        
                        <!-- 价格区分 -->
                        <div style="display: flex; gap: 16px; margin: 8px 0 16px; border-bottom: 1px dashed var(--line); padding-bottom: 12px;">
                            <div style="flex: 1;">
                                <div style="font-size: 11px; color: var(--muted); font-weight: 600;">PLUS (年度版)</div>
                                <div style="font-size: 18px; font-weight: 800; color: var(--accent);">$11.99 <span style="font-size: 11px; font-weight: 400; color: var(--muted);">/ 年</span></div>
                            </div>
                            <div style="flex: 1; border-left: 1px solid var(--line); padding-left: 16px;">
                                <div style="font-size: 11px; color: var(--muted); font-weight: 600;">PLUS U (永久版)</div>
                                <div style="font-size: 18px; font-weight: 800; color: var(--ink);">$29.99 <span style="font-size: 11px; font-weight: 400; color: var(--muted);">/ 买断</span></div>
                            </div>
                        </div>
                    </div>
                    <ul style="list-style: none; padding: 0; margin: 0 0 20px; font-size: 13px; display: flex; flex-direction: column; gap: 10px; flex-grow: 1;">
                        <li style="display: flex; gap: 8px; align-items: flex-start; color: var(--ink);">
                            ${checkGreen} <strong>${t('plan_feature_chat_unlimit') || '无限量 Chat 时间（绝不限额）'}</strong>
                        </li>
                        <li style="display: flex; gap: 8px; align-items: flex-start; color: var(--ink);">
                            ${checkGreen} <strong>${t('plan_feature_unlimit_transfer') || '高并发无限度极速发送与接收文件'}</strong>
                        </li>
                        <li style="display: flex; gap: 8px; align-items: flex-start; color: var(--ink);">
                            ${checkGreen} <span>${t('plan_feature_device_bind') || '绑定当前主板与系统指纹，稳定可靠'}</span>
                        </li>
                        <li style="display: flex; gap: 8px; align-items: flex-start; color: var(--ink);">
                            ${checkGreen} <span>${t('plan_feature_clock_check') || '本地密码学独立验签，支持离线脱机校验'}</span>
                        </li>
                        <li style="display: flex; gap: 8px; align-items: flex-start; color: var(--ink);">
                            ${checkGreen} <span>${t('plan_feature_future_upgrade') || '终身免费主板授权升级与迁移支持'}</span>
                        </li>
                        <li style="display: flex; gap: 8px; align-items: flex-start; color: var(--ink);">
                            ${checkGreen} <span>${t('plan_feature_support') || '尊享专属技术支持通道'}</span>
                        </li>
                    </ul>
                </div>
            </div>

            <!-- 说明与跳转部分 -->
            <div style="background: var(--wash); border-radius: 8px; padding: 12px 16px; font-size: 12px; color: var(--muted); line-height: 1.6; text-align: left; border: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px;">
                <div>💡 <strong>${t('plan_binding_note') || '设备绑定规则'}</strong>：${t('plan_binding_note_desc')}</div>
                <div>🎁 <strong>${t('free_tier_rules') || '额度与刷新'}</strong>：${t('free_tier_rules_desc')}</div>
            </div>
            
            <div style="margin-top: 18px; display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                <button class="ghost" id="plan-back-to-about" style="padding: 10px 18px; font-weight: 600;">${t('btn_back_about') || '返回关于'}</button>
                <button class="primary" id="plan-go-redeem" style="padding: 10px 18px; font-weight: 600;">${t('redeem_title') || '兑换激活码'}</button>
            </div>
        </div>
    `;
}

function ensureFavicon() {
    let icon = document.querySelector('link[rel="icon"]');
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
    const diagnostics = buildDiagnostics();
    const mailto = feedbackMailto(diagnostics);
    return `
        <div class="feedback-panel">
            ${state.feedbackNotice ? `<div class="notice success compact" style="margin-bottom: 16px;">${escapeHTML(state.feedbackNotice)}</div>` : ''}
            <label>${t('feedback_category')}</label>
            <select id="feedback-category">
                <option value="bug">${t('feedback_bug')}</option>
                <option value="transfer">${t('feedback_transfer_fail')}</option>
                <option value="gui">${t('feedback_gui_issue')}</option>
                <option value="feature">${t('feedback_feature_req')}</option>
                <option value="license">${t('feedback_license_issue')}</option>
                <option value="other">${t('feedback_other')}</option>
            </select>
            <label>${t('feedback_contact')}</label>
            <input id="feedback-contact" type="email" placeholder="${t('feedback_optional')}" />
            <label>${t('feedback_message')}</label>
            <textarea id="feedback-message" rows="5" placeholder="${t('feedback_placeholder')}"></textarea>
            <label class="check">
                <input id="feedback-diagnostics" type="checkbox" checked />
                ${t('feedback_include_diag')}
            </label>
            <div class="feedback-note">${t('feedback_diag_note')}</div>
            <pre class="diagnostics">${escapeHTML(diagnostics)}</pre>
            <div class="feedback-actions">
                <button class="primary" id="send-feedback" ${state.feedbackSent ? 'disabled' : ''} data-mailto="${escapeAttr(mailto)}">${state.feedbackSent ? t('btn_draft_opened') : t('btn_open_email_draft')}</button>
                <button class="ghost" id="copy-feedback">${t('btn_copy_feedback')}</button>
            </div>
        </div>
    `;
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
    const actionText = task.action === 'send' ? t('share') : (task.action === 'receive' ? t('receive') : titleCase(task.action));
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

function renderHistoryFiles(task) {
    let files = [];
    if (task.action === 'receive') {
        files = task.savedFiles || [];
        if (files.length === 0) {
            files = task.paths || [];
        }
    } else {
        files = task.paths || [];
    }

    if (files.length === 0) {
        return `<div class="history-empty-files">${t('no_files')}</div>`;
    }

    return `<div class="history-files-list">
        ${files.map((file) => {
            const name = shortName(file);
            const openFileTooltip = t('open_file_title', { file: name });
            return `
                <div class="history-file-row">
                    <div class="history-filename-wrapper">
                        <span class="file-icon-mini">📄</span>
                        <span class="history-filename" title="${escapeAttr(file)}">${escapeHTML(name)}</span>
                    </div>
                    <div class="history-file-actions">
                        <button class="icon-button-mini open-file-action" data-open-file="${escapeAttr(file)}" title="${escapeAttr(openFileTooltip)}">
                            ${openFileIcon()}
                        </button>
                    </div>
                </div>
            `;
        }).join('')}
    </div>`;
}

function renderHistory(history) {
    if (!history.length) {
        return `<div class="empty-state">${t('no_tasks')}</div>`;
    }
    return `<ol class="history">${history.slice(0, 8).map((task) => {
        const taskFolder = getTaskFolder(task);
        const actionText = task.action === 'send' ? t('share') : (task.action === 'receive' ? t('receive') : (task.action === 'chat' ? t('chat') : titleCase(task.action)));
        return `
        <li>
            <div class="history-item-left">
                <div class="history-title-row">
                    <strong class="history-title">${escapeHTML(actionText)} #${task.id}</strong>
                    <span class="history-status-icon" title="${escapeAttr(getTranslatedState(task.state))}${task.transferState ? ` / ${escapeAttr(getTranslatedState(task.transferState))}` : ''}">
                        ${getStatusIcon(task)}
                    </span>
                    ${taskFolder ? `
                        <button class="icon-button-mini open-dir-action path-link" data-open-path="${escapeAttr(taskFolder)}" title="${escapeAttr(t('open_folder_title'))}" style="margin-left: 8px;">
                            ${openFolderIcon()}
                        </button>
                    ` : ''}
                </div>
            </div>
            <div class="history-item-right">
                ${renderHistoryFiles(task)}
            </div>
        </li>
        `;
    }).join('')}</ol>`;
}

function bindEvents() {
    document.querySelector('.toggle-qr-expand-action')?.addEventListener('click', () => {
        qrExpandedManual = !qrExpandedManual;
        render();
    });
    document.querySelectorAll('.toggle-devices-expand').forEach(btn => {
        btn.addEventListener('click', () => {
            state.devicesExpanded = !state.devicesExpanded;
            render();
        });
    });
    document.querySelectorAll('[data-mode]').forEach((button) => {
        button.addEventListener('click', async () => {
            const targetMode = button.dataset.mode;
            if (state.mode === targetMode) {
                return;
            }

            const activeShare = activeShareTask();
            const activeRecv = state.status?.current && state.status.current.action === 'receive' && !isTerminal(state.status.current) ? state.status.current : null;
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
                    console.error('Failed to stop current active task on mode switch:', e);
                    return;
                }
            }

            setMode(targetMode);
            clearMessages();
            render();
        });
    });
    document.querySelector('#refresh')?.addEventListener('click', refreshStatus);
    document.querySelectorAll('.refresh-action').forEach((button) => {
        button.addEventListener('click', refreshStatus);
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
    document.querySelector('#receive-dir')?.addEventListener('input', (e) => {
        state.receiveDir = e.target.value;
        const startBtn = document.querySelector('#start-receive');
        if (startBtn) {
            startBtn.disabled = state.busy || !e.target.value.trim();
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

    const chatIframe = document.querySelector('#chat-iframe');
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
    document.querySelector('.overlay')?.addEventListener('click', (event) => {
        if (event.target.classList.contains('overlay')) {
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

    document.querySelector('#plan-back-to-about')?.addEventListener('click', () => {
        state.activePanel = 'about';
        render();
    });
    document.querySelector('#plan-go-redeem')?.addEventListener('click', () => {
        state.activePanel = 'redeem';
        render();
    });

    // About logo click helper for dev mode
    let clickCount = 0;
    let clickTimer = null;
    document.querySelector('.about-logo')?.addEventListener('click', async () => {
        clickCount++;
        if (clickCount >= 5) {
            clickCount = 0;
            if (clickTimer) clearTimeout(clickTimer);
            if (!state.settings) state.settings = {};
            state.settings.devMode = !state.settings.devMode;
            if (state.settings.devMode) {
                state.settings.debugLog = true;
                state.settings.viewportDebug = true;
            }
            await saveSettingsData();
            state.notice = state.settings.devMode ? t('dev_mode_enabled') : t('dev_mode_disabled');
            render();
            openPanel('about');
        } else {
            if (clickTimer) clearTimeout(clickTimer);
            clickTimer = setTimeout(() => {
                clickCount = 0;
            }, 1500);
        }
    });

    // Dev mode controls
    document.querySelector('#dev-debug-log')?.addEventListener('change', async (event) => {
        if (!state.settings) state.settings = {};
        state.settings.debugLog = Boolean(event.currentTarget.checked);
        await saveSettingsData();
        state.notice = state.settings.debugLog ? t('debug_logs_enabled') : t('debug_logs_disabled');
        render();
        openPanel('about');
    });

    document.querySelector('#dev-viewport-debug')?.addEventListener('change', async (event) => {
        if (!state.settings) state.settings = {};
        state.settings.viewportDebug = Boolean(event.currentTarget.checked);
        await saveSettingsData();
        state.notice = state.settings.viewportDebug ? t('viewport_debug_enabled') : t('viewport_debug_disabled');
        render();
        openPanel('about');
    });

    document.querySelector('#dev-open-log')?.addEventListener('click', async () => {
        const logPath = state.appInfo?.logPath;
        if (logPath) {
            try {
                await OpenPath(logPath);
            } catch (error) {
                state.error = 'Failed to open log: ' + error;
                render();
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
            }
        }
    });

    document.querySelector('#dev-reset-quota')?.addEventListener('click', async () => {
        try {
            state.status = await DevSetUsedSeconds(0);
            state.notice = t('dev_quota_reset_success') || '已重置每日计时为 0s';
            render();
            openPanel('about');
        } catch (error) {
            state.error = 'Failed to reset quota: ' + error;
            render();
        }
    });

    document.querySelector('#dev-max-quota')?.addEventListener('click', async () => {
        try {
            state.status = await DevSetUsedSeconds(600);
            state.notice = t('dev_quota_max_success') || '已将使用秒数设置为 10分钟(600s)';
            render();
            openPanel('about');
        } catch (error) {
            state.error = 'Failed to max quota: ' + error;
            render();
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
        openPanel('about');
    });
}

function bindChatQRPanelEvents() {
    document.querySelectorAll('.refresh-action').forEach((button) => {
        button.addEventListener('click', refreshStatus);
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

function openPanel(panel) {
    syncAndSaveSettingsInBackground();
    state.activePanel = panel;
    if (panel === 'settings') {
        ChatSaveDirectory().then((dir) => {
            state.chatSaveDir = dir;
            const btn = document.querySelector('#open-chat-save');
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
    if (state.activePanel === 'plan-comparison') {
        state.activePanel = 'about';
    } else {
        state.activePanel = '';
    }
    state.confirmResetPending = false;
    state.showEmojiPicker = false;
    render();
}

function syncManualUpdateCheckUI() {
    const statusEl = document.querySelector('#update-check-status');
    const btnEl = document.querySelector('#btn-manual-update-check');
    console.log('[Antigravity Debug] syncManualUpdateCheckUI called, statusEl:', statusEl, 'btnEl:', btnEl, 'updateStatusText:', state.updateStatusText, 'updateBtnText:', state.updateBtnText);
    LogInfo('[Antigravity Debug] syncManualUpdateCheckUI called, statusEl: ' + (statusEl ? 'found' : 'null') + ', btnEl: ' + (btnEl ? 'found' : 'null') + ', updateStatusText: ' + state.updateStatusText + ', updateBtnText: ' + state.updateBtnText);
    if (statusEl && btnEl) {
        statusEl.textContent = state.updateStatusText || t('manual_check_tips');
        btnEl.textContent = state.updateBtnText || t('manual_check_btn');
        btnEl.disabled = Boolean(state.updateBtnDisabled);
    } else {
        console.log('[Antigravity Debug] syncManualUpdateCheckUI fallback to syncPanelSurface');
        LogInfo('[Antigravity Debug] syncManualUpdateCheckUI fallback to syncPanelSurface');
        syncPanelSurface();
    }
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
        await saveSettingsData();
        state.chatQRPulseArmed = true;
        state.chatQRPromptDismissed = false;
        
        const finalStatus = await Chat();
        console.log('[Frontend] startChat: Chat task started. Status response:', finalStatus);
        
        state.status = finalStatus;
        reconcileChatQRState(finalStatus);
        if (!state.chatQRPulseUntil) {
            triggerChatQRPulse();
        }
        if (state.chatAutoSave) {
            state.chatSaveDir = await ChatSaveDirectory();
            console.log('[Frontend] startChat: Chat autosave path set to:', state.chatSaveDir);
        }
        render();
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

function recalculateUpdateTexts() {
    if (!state.updateStage || state.updateStage === 'idle') {
        state.updateStatusText = '';
        state.updateBtnText = '';
        return;
    }
    const checkRes = state.updateCheckRes;
    const version = checkRes?.version || '';
    if (state.updateStage === 'checking') {
        state.updateStatusText = t('checking_updates');
        state.updateBtnText = t('btn_checking');
    } else if (state.updateStage === 'available') {
        state.updateStatusText = t('version_available', { version });
        state.updateBtnText = t('btn_download_now');
    } else if (state.updateStage === 'ready') {
        state.updateStatusText = t('update_ready_restart', { version });
        state.updateBtnText = t('btn_install_restart');
    } else if (state.updateStage === 'downloading') {
        state.updateStatusText = t('btn_downloading');
        state.updateBtnText = t('btn_downloading');
    } else if (state.updateStage === 'installing') {
        state.updateStatusText = t('installing_updates');
        state.updateBtnText = t('btn_installing');
    }
}

function applyLanguageChange(newLang) {
    recalculateUpdateTexts();
    const frame = document.querySelector('#chat-iframe');
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
    const receiveInput = document.querySelector('#receive-dir');
    const receiveBrowser = document.querySelector('#browser-open');
    const sideBrowser = document.querySelector('#settings-browser');
    const chatAutoSave = document.querySelector('#settings-chat-autosave');
    const closeBehavior = document.querySelector('#settings-close-behavior');
    const iface = document.querySelector('#settings-interface');
    const port = document.querySelector('#settings-port');
    const chatSender = document.querySelector('#settings-chat-sender');
    const chatAvatar = document.querySelector('#settings-chat-avatar');
    const autoUpdateMode = document.querySelector('#settings-auto-update-mode');
    const updateInterval = document.querySelector('#settings-update-interval');
    const lang = document.querySelector('#settings-lang');
    const showHistory = document.querySelector('#settings-show-history');


    if (receiveInput) state.settings.output = receiveInput.value;
    if (receiveBrowser) state.settings.browser = receiveBrowser.checked;
    if (sideBrowser) state.settings.browser = sideBrowser.checked;
    if (chatAutoSave) state.settings.chatAutoSave = chatAutoSave.checked;
    if (closeBehavior) state.settings.closeBehavior = closeBehavior.value;
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
    state.closeBehavior = state.settings.closeBehavior === 'quit' ? 'quit' : 'tray';
    syncViewportDebugToChatFrame();
}

function syncViewportDebugToChatFrame() {
    const frame = document.querySelector('#chat-iframe');
    if (!frame) { return; }
    const enabled = Boolean(state.settings?.viewportDebug ?? false);
    const payload = {
        type: 'update-viewport-debug',
        enabled: enabled
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


async function toggleRightClickIntegration(event) {
    const enabled = Boolean(event.currentTarget?.checked);
    event.currentTarget.disabled = true;
    try {
        state.rightClickIntegration = await SetRightClickIntegrationEnabled(enabled);
        updateIntegrationRow('right-click');
    } catch (error) {
        state.error = error?.message || String(error);
        event.currentTarget.checked = !enabled;
        event.currentTarget.disabled = false;
        render();
    }
}

async function toggleStartupIntegration(event) {
    const enabled = Boolean(event.currentTarget?.checked);
    event.currentTarget.disabled = true;
    try {
        state.startupIntegration = await SetStartupEnabled(enabled);
        updateIntegrationRow('startup');
    } catch (error) {
        state.error = error?.message || String(error);
        event.currentTarget.checked = !enabled;
        event.currentTarget.disabled = false;
        render();
    }
}

function bindSettingsControls() {
    document.querySelector('#settings-right-click')?.addEventListener('change', toggleRightClickIntegration);
    document.querySelector('#settings-startup')?.addEventListener('change', toggleStartupIntegration);
    document.querySelectorAll('[data-help]').forEach(bindHelpTooltip);
    document.querySelector('#open-chat-save')?.addEventListener('click', openChatSaveDirectory);

    // Chat Sender Edit controls
    document.querySelector('.edit-chat-sender')?.addEventListener('click', () => {
        state.isEditingChatSender = true;
        syncPanelSurface();
        const inputEl = document.querySelector('#settings-chat-sender');
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
        const inputEl = document.querySelector('#settings-chat-sender');
        if (inputEl && state.settings) {
            const newName = cleanChatProfileName(inputEl.value);
            state.settings.chatSender = newName;
            state.isEditingChatSender = false;
            await handleAutoSaveSettings();
            syncPanelSurface();
        }
    });

    const chatSenderInput = document.querySelector('#settings-chat-sender');
    if (chatSenderInput) {
        chatSenderInput.addEventListener('keydown', async (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                document.querySelector('.save-chat-sender')?.click();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                document.querySelector('.cancel-chat-sender')?.click();
            }
        });
        chatSenderInput.addEventListener('input', (event) => {
            const previewEl = document.querySelector('.avatar-preview');
            if (previewEl) {
                const cleaned = cleanChatProfileName(event.target.value);
                const avatarVal = state.settings?.chatAvatar || '';
                previewEl.innerHTML = renderAvatarMarkup(avatarVal, (cleaned.charAt(0) || 'D').toUpperCase());
            }
        });
    }

    // Avatar upload/reset and presets
    document.querySelector('#btn-avatar-upload')?.addEventListener('click', () => {
        document.querySelector('#settings-avatar-file')?.click();
    });

    document.querySelector('#settings-avatar-file')?.addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        if (file && state.settings) {
            const reader = new FileReader();
            reader.onload = (e) => {
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
                    ctx.drawImage(img, 0, 0, w, h);
                    const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
                    
                    state.settings.chatAvatar = compressedBase64;
                    event.target.value = '';
                    await handleAutoSaveSettings();
                    syncPanelSurface();
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    });

    document.querySelector('#btn-avatar-reset')?.addEventListener('click', async () => {
        if (state.settings) {
            state.settings.chatAvatar = '';
            await handleAutoSaveSettings();
            syncPanelSurface();
        }
    });

    const avatarInput = document.querySelector('#settings-chat-avatar');
    if (avatarInput) {
        avatarInput.addEventListener('input', (event) => {
            const cleaned = cleanChatAvatar(event.target.value);
            const previewEl = document.querySelector('.avatar-preview');
            if (previewEl) {
                const sender = state.settings?.chatSender || '';
                previewEl.innerHTML = renderAvatarMarkup(cleaned, (cleanChatProfileName(sender).charAt(0) || 'D').toUpperCase());
            }
        });
        avatarInput.addEventListener('change', async (event) => {
            if (state.settings) {
                state.settings.chatAvatar = cleanChatAvatar(event.target.value);
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
        btn.addEventListener('click', async (event) => {
            event.stopPropagation();
            const emojiVal = event.currentTarget.dataset.emoji;
            if (state.settings && emojiVal) {
                state.settings.chatAvatar = emojiVal;
                state.showEmojiPicker = false;
                await handleAutoSaveSettings();
                syncPanelSurface();
            }
        });
    });

    const customEmojiInput = document.querySelector('#emoji-picker-custom-input');
    if (customEmojiInput) {
        customEmojiInput.addEventListener('click', (event) => {
            event.stopPropagation();
        });
        customEmojiInput.addEventListener('keydown', async (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                document.querySelector('#btn-emoji-picker-custom-submit')?.click();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                state.showEmojiPicker = false;
                syncPanelSurface();
            }
        });
    }

    document.querySelector('#btn-emoji-picker-custom-submit')?.addEventListener('click', async (event) => {
        event.stopPropagation();
        const inputEl = document.querySelector('#emoji-picker-custom-input');
        if (inputEl && state.settings) {
            const rawVal = inputEl.value.trim();
            const emojiVal = cleanChatAvatar(rawVal);
            if (emojiVal) {
                state.settings.chatAvatar = emojiVal;
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
        '#settings-close-behavior',
        '#settings-auto-update-mode',
        '#settings-update-interval',
        '#settings-lang',
        '#settings-show-history'
    ];
    inputs.forEach(selector => {
        const el = document.querySelector(selector);
        if (el) {
            el.addEventListener('change', async () => {
                syncSettingsFromDOM();
                await handleAutoSaveSettings();
            });
            el.addEventListener('input', syncSettingsFromDOM);
        }
    });

    const advDetails = document.querySelector('.settings-advanced-details');
    if (advDetails) {
        advDetails.addEventListener('toggle', (event) => {
            state.settingsAdvancedOpen = event.currentTarget.open;
        });
    }

    document.querySelector('#btn-manual-update-check')?.addEventListener('click', runManualUpdateCheck);
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
        items.push({label: 'Save as', action: () => saveAttachmentAs(target.dataset.saveUrl, target.dataset.saveName || 'attachment')});
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
    const left = Math.min(x, window.innerWidth - rect.width - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
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

function positionHelpTooltip(event) {
    const tip = document.querySelector('.help-tooltip');
    if (!tip) {
        return;
    }
    const anchor = event.currentTarget?.getBoundingClientRect?.() || {left: event.clientX || 0, bottom: event.clientY || 0};
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
    await run(async () => {
        const feedback = collectFeedback();
        const mailto = feedbackMailto(feedback.body, feedback.category);
        await OpenExternal(mailto || event.currentTarget.dataset.mailto);
        
        state.feedbackNotice = t('feedback_draft_opened_notice');
        state.feedbackSent = true;
        render();
        
        window.setTimeout(() => {
            state.feedbackSent = false;
            render();
        }, 3000);
    }, {busy: false});
}

async function copyFeedback(event) {
    await run(async () => {
        const feedback = collectFeedback();
        await ClipboardSetText(feedback.body);
        const button = event.currentTarget;
        const original = button.textContent;
        button.textContent = 'Copied';
        button.disabled = true;
        window.setTimeout(() => {
            button.textContent = original;
            button.disabled = false;
        }, 1600);
    }, {busy: false});
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
            if (state.activePanel === 'settings') {
                render();
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
        if (state.activePanel) {
            return;
        }
        render();
    }
}

async function run(fn, options = {}) {
    const showBusy = options.busy !== false;
    state.error = '';
    if (showBusy) {
        state.busy = true;
        renderBusy();
    }
    try {
        await fn();
    } catch (error) {
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
    const primary = document.querySelector('.primary');
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

function connectAgentEvents() {
    if (agentEventsSubscribed) {
        return;
    }
    agentEventsSubscribed = true;
    EventsOn('agent-status', (nextStatus) => {
        try {
            const previousChatURL = activeChatPageURL();
            applyStatusData(nextStatus);
            if (canKeepChatFrame(previousChatURL)) {
                updateChatQuotaSurface();
                updateChatQRPulseButton();
                return;
            }
            if (state.activePanel) {
                return;
            }
            // 如果处于 share 模式下的 activeTask 传输界面，直接进行局部渲染更新，从而避免全局 render 导致 tooltip 气泡闪烁
            const transferStage = document.querySelector('.transfer-stage');
            const activeTask = activeShareTask();
            if (transferStage && activeTask && state.mode === 'share') {
                updateShareTransferActiveUI(activeTask);
                return;
            }
            render();
        } catch (e) {
            console.error('[Frontend] Failed to process agent-status event:', e);
            refreshStatus(false);
        }
    });
}


async function handleFileDrop(paths) {
    if (state.mode !== 'share') {
        const activeShare = activeShareTask();
        const activeRecv = state.status?.current && state.status.current.action === 'receive' && !isTerminal(state.status.current) ? state.status.current : null;
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
    const button = document.querySelector('#start-chat');
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

function saveLicense(license) {
    state.license = license;
    window.localStorage.setItem(licenseStorageKey, JSON.stringify(license));
}

function confirmRedeem() {
    const input = document.querySelector('#redeem-code');
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
    const button = document.querySelector('#reset-license');
    if (button) button.disabled = true;
    ResetLicense().then(async function() {
        window.localStorage.removeItem(licenseStorageKey);
        state.license = null;
        state.redeemMessage = 'Activation reset on this device.';
        state.redeemError = '';
        if (state.mode === 'chat') {
            startChatUsage();
        }
        await loadStatusData();
        render();
    }).catch(function(e) {
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


function validateRedeemCode(code) {
    const parts = code.split('-');
    if (parts.length < 3 || parts[0] !== 'EQT') {
        return {ok: false, error: 'Invalid code format.'};
    }
    const tier = parts[1];
    if (tier !== 'PLUS' && tier !== 'PRO') {
        return {ok: false, error: 'Unknown paid tier.'};
    }
    const date = parts[2];
    return {ok: true, tier: tier, codeDate: date};
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

function activeShareTask() {
    const task = state.status?.current;
    if (!task || task.action !== 'share' || isTerminal(task)) {
        return null;
    }
    return task;
}

function activeChatTask() {
    const task = state.status?.chat || state.status?.current;
    if (!task || task.action !== 'chat' || isTerminal(task)) {
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
    if (!task || task.action !== 'chat' || isTerminal(task)) {
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

function buildDiagnostics() {
    const info = state.appInfo || {};
    const status = state.status || {};
    return [
        `product: ${info.product || 'EQT'} (${info.name || 'Easy QR Transfer'})`,
        `platform: ${[info.os, info.arch].filter(Boolean).join('/') || 'unknown'}`,
        `agent: embedded`,
        `cli: ${info.cliPath || 'not found'}`,
        `agent state: ${status.state || 'unknown'}`,
        `agent version: ${status.version || 'unknown'}`,
        `current task: ${status.current ? `${status.current.action} #${status.current.id} ${status.current.state}` : 'none'}`,
        `history count: ${(status.history || []).length}`,
        `config: ${state.settings?.configPath || 'unknown'}`,
    ].join('\n');
}

function collectFeedback() {
    const category = document.querySelector('#feedback-category')?.value || 'Feedback';
    const contact = document.querySelector('#feedback-contact')?.value.trim() || '';
    const message = document.querySelector('#feedback-message')?.value.trim() || '';
    const includeDiagnostics = Boolean(document.querySelector('#feedback-diagnostics')?.checked);
    const sections = [
        `Category: ${category}`,
        contact ? `Contact: ${contact}` : 'Contact: not provided',
        '',
        'Message:',
        message || '(No message provided)',
    ];
    if (includeDiagnostics) {
        sections.push('', 'Diagnostics:', buildDiagnostics());
    }
    return {
        category,
        body: sections.join('\n'),
    };
}

function feedbackMailto(body, category = 'Feedback') {
    const subject = encodeURIComponent(`EQT ${category}`);
    const encodedBody = encodeURIComponent(body || buildDiagnostics());
    return `mailto:jinxpeeter@outlook.com?subject=${subject}&body=${encodedBody}`;
}

function cleanLocalAddressError(err) {
    const msg = String(err?.message || err || '');
    if (msg.includes('127.0.0.1') || msg.includes('localhost')) {
        return 'Local service connection failed.';
    }
    return msg;
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

OnFileDrop((_x, _y, paths) => {
    handleFileDrop(paths);
}, true);

EventsOn('eqt:tray-command', handleTrayCommand);

window.addEventListener('beforeunload', stopChatUsage);

async function runAutoUpdateCheck() {
    const mode = state.settings?.autoUpdateMode || 'download';
    if (mode === 'off') {
        console.log('[AutoUpdate] Auto update mode is off, skipping check.');
        return;
    }

    if (state.updateStage !== 'idle') {
        console.log('[AutoUpdate] Update state is busy:', state.updateStage);
        return;
    }

    console.log('[AutoUpdate] Starting auto update check. Mode:', mode);
    state.updateStage = 'checking';
    state.updateStatusText = t('check_updates_auto');
    syncManualUpdateCheckUI();

    try {
        const checkRes = await window.go.main.App.CheckForUpdates();
        state.updateCheckRes = checkRes;

        if (!checkRes || !checkRes.new_version_available) {
            state.updateStage = 'idle';
            state.updateStatusText = t('up_to_date');
            syncManualUpdateCheckUI();
            return;
        }

        console.log('[AutoUpdate] New version available:', checkRes.version);
        if (mode === 'notify') {
            state.updateStage = 'available';
            state.updateStatusText = t('version_available', { version: checkRes.version });
            state.updateBtnText = t('btn_download_now');
            state.updateBtnDisabled = false;
            syncManualUpdateCheckUI();

            state.notice = t('new_version_go_settings', { version: checkRes.version });
            updateMessagesSurface();
        } else {
            if (state.status?.state === 'busy') {
                console.log('[AutoUpdate] Agent is busy transferring. Postponing download.');
                state.updateStage = 'available';
                state.updateStatusText = t('postponed_transfer', { version: checkRes.version });
                syncManualUpdateCheckUI();
                return;
            }
            await triggerDownloadUpdate();
            if (state.updateStage === 'ready') {
                if (mode === 'download') {
                    state.notice = t('update_ready_restart', { version: checkRes.version });
                    updateMessagesSurface();
                } else if (mode === 'silent') {
                    console.log('[AutoUpdate] Silent update downloaded and ready. It will apply on next restart.');
                }
            }
        }
    } catch (err) {
        state.updateStage = 'idle';
        state.updateStatusText = t('auto_check_failed', { err: cleanLocalAddressError(err) });
        syncManualUpdateCheckUI();
        console.error('[AutoUpdate] Auto update check failed:', err);
    }
}

async function runManualUpdateCheck() {
    if (state.updateStage === 'checking' || state.updateStage === 'downloading' || state.updateStage === 'installing') {
        return;
    }

    // 同步最新的 DOM 值到内存配置中
    syncSettingsFromDOM();

    // 如果当前按钮是 Retry 状态（说明发生了本地连接失败），直接重置回 idle 重新触发检测与拉起
    if (state.updateBtnText === t('btn_retry')) {
        state.updateStage = 'idle';
        state.updateStatusText = t('click_manual_check');
        state.updateBtnText = t('btn_check');
        state.updateBtnDisabled = false;
        syncManualUpdateCheckUI();
    }

    if (state.updateStage === 'idle') {
        state.updateStage = 'checking';
        state.updateStatusText = t('checking_updates');
        state.updateBtnText = t('btn_checking');
        state.updateBtnDisabled = true;
        syncManualUpdateCheckUI();

        try {
            const checkRes = await window.go.main.App.CheckForUpdates();
            state.updateCheckRes = checkRes;

            if (!checkRes || !checkRes.new_version_available) {
                state.updateStage = 'idle';
                state.updateStatusText = t('up_to_date');
                state.updateBtnText = t('btn_check');
                state.updateBtnDisabled = false;
                syncManualUpdateCheckUI();
                return;
            }

            const mode = state.settings?.autoUpdateMode || 'download';
            if (mode === 'off' || mode === 'notify') {
                state.updateStage = 'available';
                state.updateStatusText = t('version_available', { version: checkRes.version });
                state.updateBtnText = t('btn_download_now');
                state.updateBtnDisabled = false;
                syncManualUpdateCheckUI();
            } else {
                await triggerDownloadUpdate();
            }
        } catch (err) {
            state.updateStage = 'idle';
            const cleanedErr = cleanLocalAddressError(err);
            state.updateStatusText = t('download_failed', { err: cleanedErr });
            if (cleanedErr === 'Local service connection failed.') {
                state.updateBtnText = t('btn_retry');
            } else {
                state.updateBtnText = t('btn_check');
            }
            state.updateBtnDisabled = false;
            syncManualUpdateCheckUI();
        }
        return;
    }

    if (state.updateStage === 'available') {
        await triggerDownloadUpdate();
        return;
    }

    if (state.updateStage === 'ready') {
        state.updateStage = 'installing';
        state.updateStatusText = t('installing_updates');
        state.updateBtnText = t('btn_installing');
        state.updateBtnDisabled = true;
        syncManualUpdateCheckUI();

        try {
            await window.go.main.App.InstallUpdate(state.updateCheckRes.asset_name);
        } catch (err) {
            state.updateStage = 'ready';
            const cleanedErr = cleanLocalAddressError(err);
            state.updateStatusText = t('install_failed', { err: cleanedErr });
            if (cleanedErr === 'Local service connection failed.') {
                state.updateBtnText = t('btn_retry');
            } else {
                state.updateBtnText = t('btn_install_restart');
            }
            state.updateBtnDisabled = false;
            syncManualUpdateCheckUI();
        }
        return;
    }
}

async function triggerDownloadUpdate() {
    const checkRes = state.updateCheckRes;
    if (!checkRes) return;

    state.updateStage = 'downloading';
    state.updateStatusText = t('btn_downloading');
    state.updateBtnText = t('btn_downloading');
    state.updateBtnDisabled = true;
    syncManualUpdateCheckUI();

    try {
        await window.go.main.App.DownloadUpdate(checkRes);
        state.updateStage = 'ready';
        state.updateStatusText = t('update_ready_restart', { version: checkRes.version });
        state.updateBtnText = t('btn_install_restart');
        state.updateBtnDisabled = false;
        syncManualUpdateCheckUI();
    } catch (err) {
        state.updateStage = 'available';
        const cleanedErr = cleanLocalAddressError(err);
        state.updateStatusText = t('download_failed', { err: cleanedErr });
        if (cleanedErr === 'Local service connection failed.') {
            state.updateBtnText = t('btn_retry');
        } else {
            state.updateBtnText = t('btn_download_now');
        }
        state.updateBtnDisabled = false;
        syncManualUpdateCheckUI();
    }
}

loadChatUsage();
render();
loadSettings().then(() => {
    connectAgentEvents();
    window.setTimeout(runAutoUpdateCheck, 5000);
});

// Register one-time global event delegations for opening history files & folders
document.addEventListener('click', (event) => {
    if (state.showEmojiPicker) {
        const picker = document.getElementById('emoji-picker-popover');
        const trigger = document.getElementById('btn-emoji-more');
        if (picker && !picker.contains(event.target) && !trigger?.contains(event.target)) {
            state.showEmojiPicker = false;
            syncPanelSurface();
        }
    }

    const pathLink = event.target.closest('.path-link');
    if (pathLink && pathLink.id !== 'open-chat-save') {
        const path = pathLink.dataset.openPath;
        if (path) {
            run(async () => {
                await OpenPath(path);
            }, {busy: false});
        }
        return;
    }

    const fileLink = event.target.closest('[data-open-file]');
    if (fileLink) {
        const file = fileLink.dataset.openFile;
        if (file) {
            run(async () => {
                await OpenFile(file);
            }, {busy: false});
        }
        return;
    }
});

// Register a global event delegation for the auto-stop switch change
document.addEventListener('change', async (event) => {
    const autoStopSwitch = event.target.closest('#auto-stop-switch');
    if (autoStopSwitch) {
        const enabled = autoStopSwitch.checked;
        await run(async () => {
            const status = await SetAutoStop(enabled);
            state.status = status;
            syncPanelSurface();
        }, { busy: false });
    }
});
