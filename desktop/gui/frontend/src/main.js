import './style.css';
import './app.css';
import faviconURL from './assets/images/favicon.png';
import horizontalLogoURL from './assets/images/logo-horizontal.png';
import logoMarkURL from './assets/images/logo-mark.png';

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
    SelectReceiveDirectory,
    SelectShareDirectory,
    RightClickIntegrationStatus,
    Share,
    SetRightClickIntegrationEnabled,
    SetStartupEnabled,
    SetPaidStatus,
    ActivateLicense,
    ResetLicense,
    StartupStatus,
    StopChat,
    StopCurrent,
} from '../wailsjs/go/main/App';

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

const state = {
    mode: 'share',
    sharePaths: [],
    receiveDir: '',
    chatSaveDir: '',
    status: null,
    settings: null,
    rightClickIntegration: null,
    startupIntegration: null,
    appInfo: null,
    activePanel: '',
    error: '',
    notice: '',
    busy: false,
    browserFallback: false,
    chatAutoSave: true,
    closeBehavior: 'tray',
    chatQROpen: false,
    chatQRPulseUntil: 0,
    chatQRPromptDismissed: false,
    lastChatDeviceCount: 0,
    activeChatTaskId: 0,
    activeChatSessionKey: '',
    chatQRPulseArmed: false,
    chatUsageDate: '',
    chatUsageMs: 0,
    chatUsageStartedAt: 0,
    chatQuotaNoticeShown: false,
    updateStatusText: 'Click button to manually check.',
    updateBtnText: 'Check',
    updateBtnDisabled: false,
    updateCheckRes: null,
    updateStage: 'idle',
    license: null,
    redeemMessage: '',
    redeemError: '',
};

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
let agentEventsRetry = null;
let chatQRPulseTimer = null;
let chatUsageTimer = null;
const autoSavedAttachments = new Set();
const app = document.querySelector('#app');
const portHelpText = 'Port 0 chooses an available port automatically. Use a fixed port only when firewall rules, bookmarks, or device workflows need a stable address.';

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

    // 记录旧 modal 的滚动位置，防止全局重绘时弹窗回退到顶部
    let savedScrollTop = 0;
    const existingModal = document.querySelector('.overlay .modal');
    if (existingModal) {
        savedScrollTop = existingModal.scrollTop;
    }

    app.innerHTML = `
        <main class="shell">
            <header class="topbar">
                <nav class="mode-switch" aria-label="Transfer modes">
                    <button class="${state.mode === 'share' ? 'active' : ''}" data-mode="share">Share</button>
                    <button class="${state.mode === 'receive' ? 'active' : ''}" data-mode="receive">Receive</button>
                    <button class="${state.mode === 'chat' ? 'active' : ''}" data-mode="chat">Chat</button>
                </nav>
                <div class="top-actions" role="menubar" aria-label="Application menu">
                    <button class="menu-button" id="open-settings" title="Settings" aria-label="Settings">
                        <span class="menu-icon">${settingsIcon()}</span>
                        <span class="menu-label">Settings</span>
                    </button>
                    <button class="menu-button" id="open-about" title="About EQT" aria-label="About EQT">
                        <span class="menu-icon">${aboutIcon()}</span>
                        <span class="menu-label">About</span>
                    </button>
                    <button class="menu-button" id="open-feedback" title="Send feedback" aria-label="Send feedback">
                        <span class="menu-icon">${feedbackIcon()}</span>
                        <span class="menu-label">Feedback</span>
                    </button>
                </div>
            </header>

            <section class="layout ${state.mode === 'chat' ? 'chat-layout' : ''}">
                <div class="workspace">
                    ${renderWorkspace()}
                    ${state.notice ? `<div class="notice success">${escapeHTML(state.notice)}</div>` : ''}
                    ${state.error ? `<div class="notice error">${escapeHTML(state.error)}</div>` : ''}
                </div>
                ${renderSide()}
            </section>
            ${renderPanel()}
        </main>
    `;
    bindEvents();

    // 还原滚动位置到新的 modal 上
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
    const items = state.sharePaths.map((path, index) => `
        <li>
            <div>
                <strong>${escapeHTML(shortName(path))}</strong>
                <span>${escapeHTML(path)}</span>
            </div>
            <button class="icon-button remove-path" data-path-index="${index}" title="Remove">x</button>
        </li>
    `).join('');
    const hasItems = state.sharePaths.length > 0;
    return `
        <div class="dropzone">
            <div class="drop-target" style="--wails-drop-target: drop">
                <div class="drop-title">Drop files or folders here</div>
                <div class="drop-subtitle">${hasItems ? `${state.sharePaths.length} item(s) ready` : 'Drop more items here, or choose files manually.'}</div>
            </div>
            <div class="actions">
                <button type="button" id="choose-files">Choose files</button>
                <button type="button" id="choose-folder" class="secondary">Choose folder</button>
            </div>
        </div>
        ${hasItems ? `
            <ul class="path-list">${items}</ul>
            <div class="primary-row">
                <button class="primary" id="start-share" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Working...' : 'Start transfer'}</button>
                <button class="ghost" id="clear-share">Clear</button>
            </div>
        ` : ''}
    `;
}

function renderSide() {
    if (state.mode === 'chat') {
        return '';
    }
    const current = state.status?.current;
    const history = state.status?.history || [];
    return `
        <aside class="side">
            <div class="panel">
                <div class="panel-head">
                    <h2>Current task</h2>
                    <button class="ghost" id="refresh">Refresh</button>
                </div>
                ${renderCurrent(current)}
            </div>
            <div class="panel">
                <div class="panel-head">
                    <h2>Recent history</h2>
                    <button class="ghost" id="clear-history" ${history.length ? '' : 'disabled'}>Clear</button>
                </div>
                ${renderHistory(history)}
            </div>
        </aside>
    `;
}

function renderShareTransfer(task) {
    const percent = task.transferPercent || 0;
    const qrImage = qrImageURL(task.pageUrl);
    const paths = task.paths || [];
    return `
        <div class="transfer-stage">
            <div class="transfer-head">
                <div>
                    <div class="eyebrow">Share active</div>
                    <h2>${escapeHTML(task.transferState || task.state || 'Waiting')}</h2>
                </div>
                <button class="danger inline stop-current-action">Stop</button>
            </div>
            ${qrImage ? `
                <div class="qr-hero">
                    <img src="${escapeAttr(qrImage)}" alt="Transfer QR code" />
                    <button class="ghost open-qr" data-open-url="${escapeAttr(task.pageUrl)}">Open in browser</button>
                </div>
            ` : '<div class="empty-state transfer-empty">Waiting for QR page.</div>'}
            <div class="progress transfer-progress"><span style="width:${Math.max(0, Math.min(100, percent))}%"></span></div>
            <dl class="transfer-details">
                <dt>Target</dt><dd>${escapeHTML(task.transferTarget || task.transferCurrent || 'Waiting')}</dd>
                <dt>Bytes</dt><dd>${formatBytes(task.bytesDone)}${task.bytesTotal ? ` / ${formatBytes(task.bytesTotal)}` : ''}</dd>
                <dt>QR page</dt><dd>${task.pageUrl ? escapeHTML(task.pageUrl) : 'Waiting'}</dd>
            </dl>
            <div class="locked-list">
                <strong>Locked transfer list</strong>
                <ul class="path-list locked">${paths.map((path) => `
                    <li>
                        <div>
                            <strong>${escapeHTML(shortName(path))}</strong>
                            <span>${escapeHTML(path)}</span>
                        </div>
                        <span class="item-status">${escapeHTML(shareItemStatus(task, path))}</span>
                    </li>
                `).join('')}</ul>
            </div>
            ${task.error ? `<div class="notice error compact">${escapeHTML(task.error)}</div>` : ''}
        </div>
    `;
}

function renderReceive() {
    const output = state.receiveDir || state.settings?.output || '';
    return `
        <div class="receive-box">
            <label>Receive directory</label>
            <div class="directory-row">
                <input id="receive-dir" value="${escapeAttr(output)}" placeholder="Choose a folder" />
                <button id="choose-receive">Choose</button>
            </div>
        </div>
        <div class="primary-row">
            <button class="primary" id="start-receive" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Working...' : 'Start receive'}</button>
            <button class="ghost" id="save-receive-dir">Save directory</button>
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
                    <div class="eyebrow">Session mode</div>
                    <h2>Local chat with phones and nearby devices</h2>
                    <p id="chat-quota-text">${chatQuotaText()}</p>
                </div>
                <button class="primary" id="start-chat" ${state.busy || exhausted ? 'disabled' : ''}>${chatStartButtonText()}</button>
            </div>
        `;
    }
    const chatUrl = task.pageUrl || '';
    if (!chatUrl) {
        return `
            <div class="chat-panel">
                <div class="chat-start">
                    <div>
                        <div class="eyebrow">Session mode</div>
                        <h2>Starting chat session...</h2>
                        <p>Waiting for agent to prepare the network URL.</p>
                    </div>
                </div>
            </div>
        `;
    }
    let src = chatUrl;
    if (state.settings?.viewportDebug) {
        try {
            const urlObj = new URL(src);
            urlObj.searchParams.set('viewportDebug', '1');
            src = urlObj.toString();
        } catch (e) {
            // Ignored
        }
    } else {
        try {
            const urlObj = new URL(src);
            urlObj.searchParams.delete('viewportDebug');
            src = urlObj.toString();
        } catch (e) {
            // Ignored
        }
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
                        <h2>Chat session</h2>
                        <button type="button" class="side-icon-button refresh-action" title="Refresh" aria-label="Refresh">${refreshIcon()}</button>
                    </div>
                    <div class="empty-state">No active chat.</div>
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
    const qrToggleLabel = state.chatQROpen ? 'Hide chat QR' : 'Show chat QR';
    const qrPulse = !state.chatQRPromptDismissed && state.chatQRPulseUntil > Date.now();
    const remoteDeviceCount = Math.max(0, deviceCount - 1);
    return `
        <aside class="side">
            <div class="panel chat-session-panel">
                <div class="panel-head">
                    <div>
                        <div class="panel-title-inline">
                            ${hasPaidLicense() ? `<span class="license-badge sidebar-badge">${escapeHTML(state.license.tier)}</span>` : ''}
                            <h2>Chat Status</h2>
                        </div>
                        <p class="side-note tight">${escapeHTML(chatStateLabel(chatState))}</p>
                    </div>
                    <div class="side-head-actions">
                        <button type="button" class="side-icon-button refresh-action" title="Refresh" aria-label="Refresh">${refreshIcon()}</button>
                        <button type="button" class="side-icon-button open-qr" data-open-url="${escapeAttr(chatUrl)}" title="Open chat in browser" aria-label="Open chat in browser" ${chatUrl ? '' : 'disabled'}>${browserIcon()}</button>
                        <button type="button" class="side-icon-button danger-icon stop-chat-action" title="Stop chat" aria-label="Stop chat">${stopIcon()}</button>
                    </div>
                </div>
                <div class="chat-count">${escapeHTML(String(messageCount))} message${messageCount === 1 ? '' : 's'}</div>
                ${lastActivity ? `<p class="side-note">Last activity: ${escapeHTML(lastActivity)}</p>` : ''}
            </div>
            <div class="panel chat-session-panel chat-qr-panel ${state.chatQROpen ? 'expanded' : ''}">
                <div class="panel-head">
                    <h2>Scan to Join Chat</h2>
                    <button type="button" class="side-icon-button chat-qr-toggle-action ${qrPulse ? 'qr-breathe' : ''}" title="${qrToggleLabel}" aria-label="${qrToggleLabel}">${qrIcon()}</button>
                </div>
                ${state.chatQROpen ? `
                    <div class="chat-qr-content">
                        <div class="chat-qr-card chat-qr-card-large">
                            ${qrImage ? `<img src="${escapeAttr(qrImage)}" alt="Chat QR code">` : '<div class="empty-state">Waiting for QR</div>'}
                        </div>
                        <div class="chat-url-row">
                            <span>${escapeHTML(chatUrl || 'Waiting for chat URL')}</span>
                            <button type="button" class="copy-chat-url-action" title="Copy chat URL" aria-label="Copy chat URL" ${chatUrl ? '' : 'disabled'}>${copyIcon()}</button>
                        </div>
                    </div>
                ` : '<p class="side-note">Expand when you need to invite another device.</p>'}
            </div>
            <div class="panel chat-session-panel">
                <div class="panel-head">
                    <h2>Devices</h2>
                    <span class="side-count">${deviceCount}</span>
                </div>
                <div class="device-list compact">
                    <div class="device-row">
                        <span class="device-icon">${computerIcon()}</span>
                        <strong>Desktop</strong>
                        <span>Connected</span>
                    </div>
                    <div class="device-row">
                        <span class="device-icon">${phoneIcon()}</span>
                        <strong>Remote</strong>
                        <span>${remoteDeviceCount} connected</span>
                    </div>
                </div>
            </div>
        </aside>
    `;
}

function chatStateLabel(chatState) {
    if (chatState === 'active') {
        return 'Connected';
    }
    if (chatState === 'waiting' || chatState === 'running') {
        return 'Waiting for connection';
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
        settings: 'Settings',
        redeem: 'Redeem code',
        about: 'About EQT',
        feedback: 'Send feedback',
    }[state.activePanel] || '';
    return `
        <div class="overlay" role="presentation">
            <section class="modal" role="dialog" aria-modal="true" aria-label="${escapeAttr(title)}">
                <div class="modal-head">
                    <h2>${escapeHTML(title)}</h2>
                    <div class="modal-actions">
                        ${state.activePanel === 'settings' ? `<button class="tool-button" id="open-redeem-inline" title="Redeem code" aria-label="Redeem code">${giftIcon()}</button>` : ''}
                        <button class="tool-button" id="close-panel" title="Close" aria-label="Close">x</button>
                    </div>
                </div>
                ${state.activePanel === 'settings' ? renderSettingsPanel() : ''}
                ${state.activePanel === 'redeem' ? renderRedeemPanel() : ''}
                ${state.activePanel === 'about' ? renderAboutPanel() : ''}
                ${state.activePanel === 'feedback' ? renderFeedbackPanel() : ''}
            </section>
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
                    <h3>System Integration</h3>
                    <span>Native entry points for daily desktop use.</span>
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>Windows right-click share and receive</strong>
                        <span id="right-click-status-text">${escapeHTML(integrationStatusText(state.rightClickIntegration, 'Adds Explorer actions for sharing selected files and receiving into a folder.'))}</span>
                    </div>
                    <div class="setting-control-stack" id="right-click-control">
                        ${renderStatusBadge(state.rightClickIntegration)}
                        ${renderSwitch('settings-right-click', state.rightClickIntegration?.enabled, state.rightClickIntegration?.supported === false)}
                    </div>
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>Start EQT at login</strong>
                        <span id="startup-status-text">${escapeHTML(integrationStatusText(state.startupIntegration, 'Starts the background transfer service when you sign in.'))}</span>
                    </div>
                    <div class="setting-control-stack" id="startup-control">
                        ${renderStatusBadge(state.startupIntegration)}
                        ${renderSwitch('settings-startup', state.startupIntegration?.enabled, state.startupIntegration?.supported === false)}
                    </div>
                </div>
            </section>

            <section class="settings-section">
                <div class="settings-section-head">
                    <h3>Chat</h3>
                    <span>Identity and attachment handling for desktop chat sessions.</span>
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>Chat profile name</strong>
                        <span>Your nickname in chat sessions.</span>
                    </div>
                    <input id="settings-chat-sender" type="text" maxlength="20" value="${escapeAttr(chatSender)}" placeholder="Desktop" />
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>Chat avatar badge</strong>
                        <span>Use an emoji or 1-4 initials.</span>
                        <div class="avatar-presets">
                            <button type="button" class="avatar-preset-btn" data-avatar="🚀" title="Rocket">🚀</button>
                            <button type="button" class="avatar-preset-btn" data-avatar="😎" title="Cool">😎</button>
                            <button type="button" class="avatar-preset-btn" data-avatar="💻" title="Computer">💻</button>
                            <button type="button" class="avatar-preset-btn" data-avatar="👍" title="Like">👍</button>
                            <button type="button" class="avatar-preset-btn" data-avatar="🌟" title="Star">🌟</button>
                            <button type="button" class="avatar-preset-btn" data-avatar="🎨" title="Art">🎨</button>
                        </div>
                    </div>
                    <div class="avatar-setting-row">
                        <span class="avatar-preview">${escapeHTML(chatAvatarPreview)}</span>
                        <input id="settings-chat-avatar" maxlength="8" value="${escapeAttr(chatAvatar)}" placeholder="Emoji or initials" />
                    </div>
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>Auto-save chat attachments</strong>
                        <span>Save received attachments by day and clean folders older than 7 days.</span>
                    </div>
                    <div class="setting-control-stack">
                        ${renderSwitch('settings-chat-autosave', state.chatAutoSave)}
                        <button type="button" class="ghost inline" id="open-chat-save">Open folder</button>
                    </div>
                </div>
            </section>

            <section class="settings-section">
                <div class="settings-section-head">
                    <h3>Window</h3>
                    <span>What happens when the EQT window is closed.</span>
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>Close action</strong>
                        <span>Keeping EQT in the tray leaves the app ready for fast access.</span>
                    </div>
                    <select id="settings-close-behavior">
                        <option value="tray" ${state.closeBehavior !== 'quit' ? 'selected' : ''}>Keep EQT in taskbar tray</option>
                        <option value="quit" ${state.closeBehavior === 'quit' ? 'selected' : ''}>Quit EQT app</option>
                    </select>
                </div>
            </section>

            <section class="settings-section">
                <div class="settings-section-head">
                    <h3>Software Updates</h3>
                    <span>Manage app update checking.</span>
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>Auto-update mode</strong>
                        <span>Control update checks and download behavior.</span>
                    </div>
                    <select id="settings-auto-update-mode">
                        <option value="off" ${state.settings?.autoUpdateMode === 'off' ? 'selected' : ''}>Off</option>
                        <option value="notify" ${state.settings?.autoUpdateMode === 'notify' ? 'selected' : ''}>Notify</option>
                        <option value="download" ${state.settings?.autoUpdateMode === 'download' ? 'selected' : ''}>Download (Default)</option>
                        <option value="silent" ${state.settings?.autoUpdateMode === 'silent' ? 'selected' : ''}>Silent</option>
                    </select>
                </div>

                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>Check for updates</strong>
                        <span id="update-check-status">${escapeHTML(state.updateStatusText || 'Click button to manually check.')}</span>
                    </div>
                    <button type="button" class="secondary" id="btn-manual-update-check" ${state.updateBtnDisabled ? 'disabled' : ''}>${escapeHTML(state.updateBtnText || 'Check')}</button>
                </div>
            </section>

            <details class="settings-advanced-details" ${state.settingsAdvancedOpen ? 'open' : ''}>
                <summary class="settings-advanced-summary">Advanced Settings</summary>
                <div class="settings-advanced-content">
                    <div class="setting-row">
                        <div class="setting-copy">
                            <strong>Network interface</strong>
                            <span>Use the adapter your phone can reach on the local network.</span>
                        </div>
                        <select id="settings-interface">${options}</select>
                    </div>
                    <div class="setting-row">
                        <div class="setting-copy">
                            <strong class="setting-label-with-help" data-help="${escapeAttr(portHelpText)}" tabindex="0">Port <span aria-hidden="true">?</span></strong>
                            <span>Keep 0 unless you need a fixed local port.</span>
                        </div>
                        <input id="settings-port" type="number" min="0" max="65535" value="${Number(state.settings.port || 0)}" data-help="${escapeAttr(portHelpText)}" />
                    </div>
                    <div class="setting-row">
                        <div class="setting-copy">
                            <strong>Browser fallback</strong>
                            <span>Open browser control pages for QR tasks when useful.</span>
                        </div>
                        ${renderSwitch('settings-browser', state.browserFallback)}
                    </div>
                    <div class="setting-row">
                        <div class="setting-copy">
                            <strong>Update check interval</strong>
                            <span>Choose how often to check for updates automatically.</span>
                        </div>
                        <select id="settings-update-interval">
                            <option value="12" ${state.settings?.updateCheckIntervalHours === 12 ? 'selected' : ''}>12 Hours</option>
                            <option value="24" ${state.settings?.updateCheckIntervalHours === 24 || !state.settings?.updateCheckIntervalHours ? 'selected' : ''}>24 Hours (Default)</option>
                            <option value="48" ${state.settings?.updateCheckIntervalHours === 48 ? 'selected' : ''}>48 Hours</option>
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
        return '<span class="setting-status muted">checking</span>';
    }
    if (status.supported === false) {
        return '<span class="setting-status muted">unsupported</span>';
    }
    if (status.needsRepair) {
        return '<span class="setting-status warning">repair</span>';
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
    let plan = license?.tier ? `${getLicenseDisplayName(license)} active` : 'Free daily quota';
    let planDetail = license?.redeemedAt ? `Redeemed ${new Date(license.redeemedAt).toLocaleString()}` : chatQuotaText();
    
    let warningBox = '';
    const isPaid = state.status?.isPaid !== undefined ? state.status.isPaid : (license?.tier ? true : false);
    if (state.status?.clockTampered) {
        plan = 'PAID Locked (时钟异常)';
        planDetail = '检测到系统时钟回退锁定';
        warningBox = `
            <div class="notice error compact" style="margin-bottom: 16px; font-size: 13px; line-height: 1.4;">
                <strong>⚠️ 时钟回退锁定：</strong>
                检测到系统时钟回退（当前时间落后于上次运行时间），已锁定付费功能。请将系统时间恢复同步，然后在下方的 Settings 里重新激活。
            </div>
        `;
    } else if (license?.tier && !isPaid) {
        plan = `${getLicenseDisplayName(license)} Locked (已受限)`;
        planDetail = '服务端付费判定未激活 (不一致)';
        warningBox = `
            <div class="notice error compact" style="margin-bottom: 16px; font-size: 13px; line-height: 1.4;">
                <strong>⚠️ 授权校验未通过：</strong>
                虽然本地有激活的 ${getLicenseDisplayName(license)}，但服务端付费判定未激活。请确保核心服务已开启并连接；若仍异常，请在下方的 Settings 里“Reset”重置授权并重新输入兑换码激活。
            </div>
        `;
    }
    
    let devSection = '';
    if (state.settings?.devMode) {
        devSection = `
            <div class="dev-section" style="margin-top: 16px; padding-top: 16px; border-top: 1px dashed var(--line);">
                <h3 style="font-size: 14px; margin-bottom: 8px; color: var(--accent-strong);">Developer Options</h3>
                <div style="display: flex; flex-direction: column; gap: 8px; font-size: 13px;">
                    <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
                        <span>Enable Debug Logs</span>
                        <input type="checkbox" id="dev-debug-log" ${state.settings?.debugLog ? 'checked' : ''} />
                    </label>
                    <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
                        <span>Enable Viewport Debug Box</span>
                        <input type="checkbox" id="dev-viewport-debug" ${state.settings?.viewportDebug ? 'checked' : ''} />
                    </label>
                    <div style="color: var(--muted); font-size: 11px; margin-top: -4px; line-height: 1.4;">
                        调试日志会将 Chat Viewport 交互信息和网络日志保存。
                        <br>日志保存在: <strong style="word-break: break-all;">${escapeHTML(info.logPath || 'Temp directory')}</strong>
                    </div>
                    <div style="display: flex; gap: 8px; margin-top: 6px;">
                        <button class="ghost" id="dev-open-log" style="flex: 1; padding: 4px 8px; font-size: 11px;">Open Log File</button>
                        <button class="ghost" id="dev-open-dir" style="flex: 1; padding: 4px 8px; font-size: 11px;">Open Log Dir</button>
                    </div>
                    <button class="danger inline" id="dev-disable-mode" style="margin-top: 6px; font-size: 11px; padding: 4px 8px; width: 100%;">
                        Exit Developer Mode
                    </button>
                </div>
            </div>
        `;
    }

    let planPopover = `
        <div class="popover-backdrop" id="close-plan-popover-bg"></div>
        <div class="plan-popover">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid var(--line); padding-bottom: 8px;">
                <strong style="color: var(--accent-strong); font-size: 14px; display: flex; align-items: center; gap: 4px;">
                    💡 套餐版本说明
                </strong>
                <button class="tool-button" id="close-plan-popover" title="Close" aria-label="Close" style="border: none; background: transparent; cursor: pointer; font-size: 18px; color: var(--muted); padding: 4px; line-height: 1; display: flex; align-items: center; justify-content: center;">&times;</button>
            </div>
            <div style="font-size: 13px; line-height: 1.6; display: flex; flex-direction: column; gap: 10px; text-align: left;">
                <div>
                    <strong style="color: var(--ink);">• Plus - $11.99 / 年：</strong>
                    支持最大 <strong>2 台</strong> 设备同时激活。解锁无限局域网 Chat 聊天通话与大文件传输，高速稳定。
                </div>
                <div>
                    <strong style="color: var(--ink);">• Plus 终身 - $29.99：</strong>
                    一次买断，终身可用，同样支持最大 <strong>2 台</strong> 设备同时激活，解锁所有 PLUS 高级付费权益。
                </div>
                <div style="margin-top: 4px; padding-top: 8px; border-top: 1px dashed var(--border); font-size: 12px; color: var(--muted); line-height: 1.5;">
                    💡 <strong>激活绑定说明</strong>：激活采用“3选2”加权硬件指纹绑定模型。重装系统不更换硬件的情况下，在同一设备上重新激活<strong>不会消耗额外设备额度</strong>，可放心进行系统重装。在离线环境下，你亦可通过恢复备份的 <code>license.lic</code> 文件实现离线自动验证。
                </div>
            </div>
        </div>
    `;

    return `
        <div class="about-panel">
            ${warningBox}
            <div class="about-hero">
                <img class="about-logo" src="${horizontalLogoURL}" alt="EQT Easy QR Transfer" style="cursor: pointer;">
                <div class="about-plan">
                    <div class="about-plan-left">
                        <span>Plan</span>
                        <strong>${escapeHTML(plan)}</strong>
                        <small>${escapeHTML(planDetail)}</small>
                    </div>
                    <button class="tool-button" id="toggle-plan-info" aria-label="查看套餐说明" style="padding: 0; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border: none; background: transparent; cursor: pointer; color: var(--accent-strong); flex-shrink: 0;">
                        <span class="plan-info-icon-wrapper" data-tooltip="点击查看 Plus 与 Plus 终身版套餐对比">
                            <span style="width: 18px; height: 18px; display: flex; align-items: center; justify-content: center;">${diamondIcon()}</span>
                        </span>
                    </button>
                </div>
            </div>
            <dl>
                <dt>Product</dt><dd>${escapeHTML(info.product || 'EQT')} / ${escapeHTML(info.name || 'Easy QR Transfer')}</dd>
                <dt>Version</dt><dd>${escapeHTML(info.version || 'Unknown')}</dd>
                <dt>Platform</dt><dd>${escapeHTML([info.os, info.arch].filter(Boolean).join(' / ') || 'Unknown')}</dd>
                <dt>CLI</dt><dd>${escapeHTML(info.cliPath || 'Not found yet')}</dd>
                <dt>Legal</dt><dd>MIT license. Forked from qrcp.</dd>
            </dl>
            ${devSection}
            ${planPopover}
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
    let active = license?.tier ? `${getLicenseDisplayName(license)} active` : 'No paid plan active';
    
    let warningBox = '';
    const isPaid = state.status?.isPaid !== undefined ? state.status.isPaid : (license?.tier ? true : false);
    if (state.status?.clockTampered) {
        active = 'PAID Locked (时钟异常)';
        warningBox = `
            <div class="notice error compact" style="margin-bottom: 16px; font-size: 13px; line-height: 1.4;">
                <strong>⚠️ 时钟回退锁定：</strong>
                检测到系统时钟回退，已锁定付费功能。请恢复同步系统时钟后再重新输入兑换码激活。
            </div>
        `;
    } else if (license?.tier && !isPaid) {
        active = `${getLicenseDisplayName(license)} Locked (已受限)`;
        warningBox = `
            <div class="notice error compact" style="margin-bottom: 16px; font-size: 13px; line-height: 1.4;">
                <strong>⚠️ 授权校验未通过：</strong>
                服务端付费判定未激活 (不一致)。请确保核心服务正常运行并已连接。若仍异常，请点击下方的 “Reset” 重置激活，并重新兑换激活码。
            </div>
        `;
    }

    return `
        <div class="redeem-panel">
            ${warningBox}
            <div class="license-card">
                <strong>${escapeHTML(active)}</strong>
                <span>${license?.redeemedAt ? `Redeemed ${escapeHTML(new Date(license.redeemedAt).toLocaleString())}` : 'Enter a valid EQT code to unlock a paid tier on this device.'}</span>
                ${state.status?.maxDevices ? `<span style="font-size: 11px; margin-top: 4px; opacity: 0.85;">Device Limit: ${state.status.activatedDevices || 0} / ${state.status.maxDevices}</span>` : ''}
            </div>
            <label>
                Redeem code
                <input id="redeem-code" autocomplete="off" spellcheck="false" placeholder="EQT-PLUS-20260523-XXXX-CHECK" ${state.isActivating ? 'disabled' : ''} value="${escapeHTML(state.tempRedeemCode || '')}" />
            </label>
            <div class="redeem-actions">
                <button class="primary" id="confirm-redeem" ${state.isActivating ? 'disabled' : ''}>${state.isActivating ? '激活中...' : 'Confirm'}</button>
                <button class="ghost" id="reset-license" ${state.isActivating ? 'disabled' : ''}>Reset</button>
            </div>
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
            <label>Category</label>
            <select id="feedback-category">
                <option>Bug report</option>
                <option>Transfer failure</option>
                <option>GUI issue</option>
                <option>Feature request</option>
                <option>Purchase or license issue</option>
                <option>Other</option>
            </select>
            <label>Contact email</label>
            <input id="feedback-contact" type="email" placeholder="Optional" />
            <label>Message</label>
            <textarea id="feedback-message" rows="5" placeholder="What happened?"></textarea>
            <label class="check">
                <input id="feedback-diagnostics" type="checkbox" checked />
                Include diagnostics
            </label>
            <div class="feedback-note">Diagnostics are shown below before sending. EQT never attaches files being transferred.</div>
            <pre class="diagnostics">${escapeHTML(diagnostics)}</pre>
            <div class="feedback-actions">
                <button class="primary" id="send-feedback" data-mailto="${escapeAttr(mailto)}">Open email draft</button>
                <button class="ghost" id="copy-feedback">Copy feedback</button>
            </div>
        </div>
    `;
}

function renderCurrent(task) {
    if (!task) {
        return `<div class="empty-state">Agent is idle.</div>`;
    }
    const percent = task.transferPercent || 0;
    const qrImage = qrImageURL(task.pageUrl);
    const finished = isTerminal(task);
    return `
        <div class="task-card">
            <div class="task-title">${escapeHTML(titleCase(task.action))} #${task.id}</div>
            <div class="task-state ${finished ? 'done' : ''}">${escapeHTML(task.transferState || task.state)}</div>
            ${qrImage && !finished ? `
                <div class="qr-preview">
                    <img src="${escapeAttr(qrImage)}" alt="Transfer QR code" />
                    <button class="ghost open-qr" data-open-url="${escapeAttr(task.pageUrl)}">Open in browser</button>
                </div>
            ` : ''}
            <div class="progress"><span style="width:${Math.max(0, Math.min(100, percent))}%"></span></div>
            <dl>
                <dt>Target</dt><dd>${escapeHTML(task.transferTarget || task.transferCurrent || shortName(task.paths?.[0] || ''))}</dd>
                <dt>Archive</dt><dd>${escapeHTML(task.transferArchiveName || 'None')}</dd>
                <dt>Bytes</dt><dd>${formatBytes(task.bytesDone)}${task.bytesTotal ? ` / ${formatBytes(task.bytesTotal)}` : ''}</dd>
                <dt>QR page</dt><dd>${task.pageUrl ? escapeHTML(task.pageUrl) : 'Waiting'}</dd>
            </dl>
            ${renderSavedFiles(task.savedFiles)}
            ${task.error ? `<div class="notice error compact">${escapeHTML(task.error)}</div>` : ''}
            ${finished ? '' : '<button class="danger stop-current-action">Stop current</button>'}
        </div>
    `;
}

function renderSavedFiles(files) {
    if (!files || !files.length) {
        return '';
    }
    return `
        <div class="saved-files">
            <strong>Saved files</strong>
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
        return `<div class="history-empty-files">No files</div>`;
    }

    return `<div class="history-files-list">
        ${files.map((file) => {
            const name = shortName(file);
            const parentDir = getContainingFolder(file);
            return `
                <div class="history-file-row">
                    <div class="history-filename-wrapper">
                        <span class="file-icon-mini">📄</span>
                        <span class="history-filename" title="${escapeAttr(file)}">${escapeHTML(name)}</span>
                    </div>
                    <div class="history-file-actions">
                        <button class="icon-button-mini open-file-action" data-open-file="${escapeAttr(file)}" title="Open file: ${escapeAttr(file)}">
                            ${openFileIcon()}
                        </button>
                        <button class="icon-button-mini open-dir-action path-link" data-open-path="${escapeAttr(parentDir)}" title="Open containing folder: ${escapeAttr(parentDir)}">
                            ${openFolderIcon()}
                        </button>
                    </div>
                </div>
            `;
        }).join('')}
    </div>`;
}

function renderHistory(history) {
    if (!history.length) {
        return `<div class="empty-state">No completed tasks yet.</div>`;
    }
    return `<ol class="history">${history.slice(0, 8).map((task) => `
        <li>
            <div class="history-item-left">
                <div class="history-title-row">
                    <strong class="history-title">${escapeHTML(titleCase(task.action))} #${task.id}</strong>
                    <span class="history-status-icon" title="${escapeAttr(task.state)}${task.transferState ? ` / ${escapeAttr(task.transferState)}` : ''}">
                        ${getStatusIcon(task)}
                    </span>
                </div>
            </div>
            <div class="history-item-right">
                ${renderHistoryFiles(task)}
            </div>
        </li>
    `).join('')}</ol>`;
}

function bindEvents() {
    document.querySelectorAll('[data-mode]').forEach((button) => {
        button.addEventListener('click', () => {
            setMode(button.dataset.mode);
            clearMessages();
            render();
        });
    });
    document.querySelector('#refresh')?.addEventListener('click', refreshStatus);
    document.querySelectorAll('.refresh-action').forEach((button) => {
        button.addEventListener('click', refreshStatus);
    });
    document.querySelector('#open-settings')?.addEventListener('click', () => openPanel('settings'));
    document.querySelector('#open-about')?.addEventListener('click', () => openPanel('about'));
    document.querySelector('#open-feedback')?.addEventListener('click', () => openPanel('feedback'));
    document.querySelector('#choose-files')?.addEventListener('click', chooseFiles);
    document.querySelector('#choose-folder')?.addEventListener('click', chooseFolder);
    document.querySelector('#clear-share')?.addEventListener('click', () => {
        state.sharePaths = [];
        clearMessages();
        render();
    });
    document.querySelectorAll('.remove-path').forEach((button) => {
        button.addEventListener('click', removePath);
    });
    document.querySelector('#start-share')?.addEventListener('click', startShare);
    document.querySelector('#start-chat')?.addEventListener('click', startChat);
    document.querySelector('#choose-receive')?.addEventListener('click', chooseReceiveDirectory);
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
    document.querySelectorAll('.path-link').forEach((button) => {
        button.addEventListener('click', openPath);
    });
    document.querySelectorAll('[data-open-file]').forEach((button) => {
        button.addEventListener('click', openSavedFile);
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
}

function bindPanelEvents() {
    document.querySelector('#open-redeem-inline')?.addEventListener('click', () => openPanel('redeem'));
    document.querySelector('#close-panel')?.addEventListener('click', closePanel);
    document.querySelector('.overlay')?.addEventListener('click', (event) => {
        if (event.target.classList.contains('overlay')) {
            closePanel();
        }
    });
    bindSettingsControls();
    document.querySelector('.open-docs')?.addEventListener('click', openExternal);
    document.querySelector('#send-feedback')?.addEventListener('click', sendFeedback);
    document.querySelector('#copy-feedback')?.addEventListener('click', copyFeedback);
    document.querySelector('#confirm-redeem')?.addEventListener('click', confirmRedeem);
    document.querySelector('#reset-license')?.addEventListener('click', resetLicense);
    document.querySelector('#toggle-plan-info')?.addEventListener('click', () => {
        document.querySelector('.plan-popover')?.classList.toggle('visible');
        document.querySelector('.popover-backdrop')?.classList.toggle('visible');
    });
    document.querySelector('#close-plan-popover')?.addEventListener('click', () => {
        document.querySelector('.plan-popover')?.classList.remove('visible');
        document.querySelector('.popover-backdrop')?.classList.remove('visible');
    });
    document.querySelector('#close-plan-popover-bg')?.addEventListener('click', () => {
        document.querySelector('.plan-popover')?.classList.remove('visible');
        document.querySelector('.popover-backdrop')?.classList.remove('visible');
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
            state.notice = state.settings.devMode ? 'Developer Mode enabled!' : 'Developer Mode disabled.';
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
        state.notice = state.settings.debugLog ? 'Debug logs enabled.' : 'Debug logs disabled.';
        render();
        openPanel('about');
    });

    document.querySelector('#dev-viewport-debug')?.addEventListener('change', async (event) => {
        if (!state.settings) state.settings = {};
        state.settings.viewportDebug = Boolean(event.currentTarget.checked);
        await saveSettingsData();
        state.notice = state.settings.viewportDebug ? 'Viewport debug box enabled.' : 'Viewport debug box disabled.';
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

    document.querySelector('#dev-disable-mode')?.addEventListener('click', async () => {
        if (!state.settings) state.settings = {};
        state.settings.devMode = false;
        state.settings.debugLog = false;
        state.settings.viewportDebug = false;
        await saveSettingsData();
        state.notice = 'Developer Mode disabled.';
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
    if (panel === 'redeem') {
        state.redeemMessage = '';
        state.redeemError = '';
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
    state.activePanel = '';
    render();
}

function syncManualUpdateCheckUI() {
    const statusEl = document.querySelector('#update-check-status');
    const btnEl = document.querySelector('#btn-manual-update-check');
    console.log('[Antigravity Debug] syncManualUpdateCheckUI called, statusEl:', statusEl, 'btnEl:', btnEl, 'updateStatusText:', state.updateStatusText, 'updateBtnText:', state.updateBtnText);
    LogInfo('[Antigravity Debug] syncManualUpdateCheckUI called, statusEl: ' + (statusEl ? 'found' : 'null') + ', btnEl: ' + (btnEl ? 'found' : 'null') + ', updateStatusText: ' + state.updateStatusText + ', updateBtnText: ' + state.updateBtnText);
    if (statusEl && btnEl) {
        statusEl.textContent = state.updateStatusText || 'Click button to manually check.';
        btnEl.textContent = state.updateBtnText || 'Check';
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
        existing.replaceWith(overlay);
        
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
        state.status = await Share(state.sharePaths);
        state.sharePaths = [];
        state.notice = 'Share task started.';
        render();
    });
}

async function startReceive() {
    await run(async () => {
        await saveSettingsData();
        state.status = await Receive(state.receiveDir);
        state.notice = 'Receive task started.';
        render();
    });
}

async function startChat() {
    if (!hasPaidLicense() && chatRemainingMs() <= 0) {
        console.warn('[Frontend] startChat: Daily free chat limit reached.');
        state.error = 'Daily free chat time is used up. Upgrade to keep using chat today.';
        render();
        return;
    }
    console.log('[Frontend] startChat: Requesting chat task start from Wails App.Chat()...');
    await run(async () => {
        await saveSettingsData();
        state.chatQRPulseArmed = true;
        state.chatQRPromptDismissed = false;
        state.status = await Chat();
        console.log('[Frontend] startChat: Chat task started. Status response:', state.status);
        setMode('chat');
        state.notice = '';
        reconcileChatQRState(state.status);
        if (!state.chatQRPulseUntil) {
            triggerChatQRPulse();
        }
        if (state.chatAutoSave) {
            state.chatSaveDir = await ChatSaveDirectory();
            console.log('[Frontend] startChat: Chat autosave path set to:', state.chatSaveDir);
        }
    });
}

async function openChatSaveDirectory() {
    await run(async () => {
        const dir = state.chatSaveDir || await ChatSaveDirectory();
        state.chatSaveDir = dir;
        await OpenPath(dir);
        state.notice = `Opened ${dir}`;
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

async function handleAutoSaveSettings() {
    try {
        await saveSettingsData();
        if (state.error) {
            state.error = '';
            render();
        }
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
            showToast('Settings saved.');
        } else {
            state.notice = 'Settings saved.';
            render();
        }
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

    const avatarInput = document.querySelector('#settings-chat-avatar');
    if (avatarInput) {
        avatarInput.addEventListener('input', (event) => {
            const cleaned = cleanChatAvatar(event.target.value);
            if (event.target.value !== cleaned) {
                event.target.value = cleaned;
            }
            const previewEl = document.querySelector('.avatar-preview');
            if (previewEl) {
                previewEl.textContent = cleaned || (cleanChatProfileName(state.settings?.chatSender).charAt(0) || 'D').toUpperCase();
            }
            syncSettingsFromDOM();
        });
        avatarInput.addEventListener('change', async () => {
            syncSettingsFromDOM();
            await handleAutoSaveSettings();
        });
    }
    const chatSenderInput = document.querySelector('#settings-chat-sender');
    if (chatSenderInput) {
        chatSenderInput.addEventListener('input', (event) => {
            const cleaned = cleanChatProfileName(event.target.value);
            const previewEl = document.querySelector('.avatar-preview');
            if (previewEl) {
                const avatarVal = document.querySelector('#settings-chat-avatar')?.value || '';
                previewEl.textContent = cleanChatAvatar(avatarVal) || (cleaned.charAt(0) || 'D').toUpperCase();
            }
            syncSettingsFromDOM();
        });
    }

    document.querySelectorAll('.avatar-preset-btn').forEach(btn => {
        btn.addEventListener('click', (event) => {
            const presetVal = event.currentTarget.dataset.avatar;
            if (avatarInput && presetVal) {
                avatarInput.value = presetVal;
                avatarInput.dispatchEvent(new Event('input'));
                handleAutoSaveSettings();
            }
        });
    });

    const inputs = [
        '#settings-interface',
        '#settings-port',
        '#settings-browser',
        '#settings-chat-autosave',
        '#settings-close-behavior',
        '#settings-auto-update-mode',
        '#settings-update-interval',

        '#settings-chat-sender'
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
        state.notice = 'Current task stopped.';
        await loadStatusData();
    });
}

async function stopChat() {
    await run(async () => {
        await StopChat();
        state.notice = 'Chat stopped.';
        await loadStatusData();
    });
}

async function clearHistory() {
    await run(async () => {
        await ClearHistory();
        state.notice = 'History cleared.';
        await loadStatusData();
    });
}

async function repeatTask(event) {
    await run(async () => {
        const id = Number(event.currentTarget.dataset.taskId);
        state.status = await RepeatTask(id);
        state.notice = `Task #${id} repeated.`;
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
        state.receiveDir = state.settings.output || '';
        state.browserFallback = Boolean(state.settings.browser);
        state.chatAutoSave = state.settings.chatAutoSave !== false;
        state.closeBehavior = state.settings.closeBehavior === 'quit' ? 'quit' : 'tray';
        await loadIntegrationStatusData();
        await loadStatusData();
        render();
    });
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

function removePath(event) {
    const index = Number(event.currentTarget.dataset.pathIndex);
    state.sharePaths = state.sharePaths.filter((_, itemIndex) => itemIndex !== index);
    clearMessages();
    render();
}

function addSharePaths(paths) {
    const next = new Set(state.sharePaths);
    paths.filter(Boolean).forEach((path) => next.add(path));
    state.sharePaths = [...next];
    clearMessages();
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
            render();
        } catch (e) {
            console.error('[Frontend] Failed to process agent-status event:', e);
            refreshStatus(false);
        }
    });
}


function handleFileDrop(paths) {
    setMode('share');
    addSharePaths(paths || []);
}

function handleTrayCommand(command) {
    clearMessages();
    if (command === 'share') {
        setMode('share');
        state.activePanel = '';
        state.notice = 'Ready to share.';
        render();
        return;
    }
    if (command === 'receive') {
        setMode('receive');
        state.activePanel = '';
        state.notice = 'Ready to receive.';
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
        if (state.mode === 'chat' && chatRemainingMs() <= 0) {
            clearChatUsageTimer();
            if (!state.chatQuotaNoticeShown) {
                state.chatQuotaNoticeShown = true;
                state.error = 'Daily free chat time is used up. Upgrade to keep using chat today.';
            }
            if (activeChatTask()) {
                try {
                    await StopChat();
                } catch {
                    // Quota state is local; a failed stop should not hide the upgrade prompt.
                }
            }
            render();
        } else if (state.mode === 'chat') {
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
        const exhausted = !hasPaidLicense() && chatRemainingMs() <= 0;
        button.disabled = state.busy || exhausted;
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
        return `${licenseTiers[state.license.tier] || state.license.tier} active. Chat is unlocked.`;
    }
    const remaining = chatRemainingMs();
    if (remaining <= 0) {
        return 'Daily free chat time is used up. Upgrade to keep using chat today.';
    }
    return `Daily free chat time left: ${formatDuration(remaining)}.`;
}

function chatQuotaTopText() {
    if (hasPaidLicense()) {
        return `${licenseTiers[state.license.tier] || state.license.tier}`;
    }
    const remaining = chatRemainingMs();
    if (remaining <= 0) {
        return 'Chat 0:00';
    }
    return `Chat ${formatDuration(remaining)}`;
}

function chatStartButtonText() {
    if (state.busy) {
        return 'Working...';
    }
    if (!hasPaidLicense() && chatRemainingMs() <= 0) {
        return 'Upgrade required';
    }
    return 'Start chat';
}

function hasPaidLicense() {
    return Boolean(state.license?.tier && licenseTiers[state.license.tier]);
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
        const percent = task.transferPercent || 0;
        return percent ? `${percent}%` : 'Active';
    }
    if (task.transferState === 'waiting') {
        return 'Waiting';
    }
    return 'Locked';
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
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.8-4.2L4 9"></path><path d="M4 4v5h5"></path><path d="M4 13a8 8 0 0 0 14.8 4.2L20 15"></path><path d="M20 20v-5h-5"></path></svg>';
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
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12v8H4v-8"></path><path d="M2 7h20v5H2z"></path><path d="M12 7v13"></path><path d="M12 7H8.5A2.5 2.5 0 1 1 11 4.5c0 1.4 1 2.5 1 2.5z"></path><path d="M12 7h3.5A2.5 2.5 0 1 0 13 4.5c0 1.4-1 2.5-1 2.5z"></path></svg>';
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

function shortName(path) {
    return String(path || '').split(/[\\/]/).filter(Boolean).pop() || path || '';
}

function cleanChatProfileName(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function cleanChatAvatar(value) {
    const text = String(value || '').trim();
    return Array.from(text).slice(0, 4).join('');
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
    state.updateStatusText = 'Checking updates automatically...';
    syncManualUpdateCheckUI();

    try {
        const checkRes = await window.go.main.App.CheckForUpdates();
        state.updateCheckRes = checkRes;

        if (!checkRes || !checkRes.new_version_available) {
            state.updateStage = 'idle';
            state.updateStatusText = 'Already up to date.';
            syncManualUpdateCheckUI();
            return;
        }

        console.log('[AutoUpdate] New version available:', checkRes.version);
        if (mode === 'notify') {
            state.updateStage = 'available';
            state.updateStatusText = `New version ${checkRes.version} is available.`;
            state.updateBtnText = 'Download now';
            state.updateBtnDisabled = false;
            syncManualUpdateCheckUI();

            state.notice = `New version ${checkRes.version} is available. Go to settings to update.`;
            updateMessagesSurface();
        } else {
            if (state.status?.state === 'busy') {
                console.log('[AutoUpdate] Agent is busy transferring. Postponing download.');
                state.updateStage = 'available';
                state.updateStatusText = `New version ${checkRes.version} is available. Download postponed until transfer finishes.`;
                syncManualUpdateCheckUI();
                return;
            }
            await triggerDownloadUpdate();
            if (state.updateStage === 'ready') {
                if (mode === 'download') {
                    state.notice = `Version ${checkRes.version} has been downloaded. Restart to apply the update.`;
                    updateMessagesSurface();
                } else if (mode === 'silent') {
                    console.log('[AutoUpdate] Silent update downloaded and ready. It will apply on next restart.');
                }
            }
        }
    } catch (err) {
        state.updateStage = 'idle';
        state.updateStatusText = `Auto update check failed: ${cleanLocalAddressError(err)}`;
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
    if (state.updateBtnText === 'Retry') {
        state.updateStage = 'idle';
        state.updateStatusText = 'Click button to manually check.';
        state.updateBtnText = 'Check';
        state.updateBtnDisabled = false;
        syncManualUpdateCheckUI();
    }

    if (state.updateStage === 'idle') {
        state.updateStage = 'checking';
        state.updateStatusText = 'Checking updates...';
        state.updateBtnText = 'Checking...';
        state.updateBtnDisabled = true;
        syncManualUpdateCheckUI();

        try {
            const checkRes = await window.go.main.App.CheckForUpdates();
            state.updateCheckRes = checkRes;

            if (!checkRes || !checkRes.new_version_available) {
                state.updateStage = 'idle';
                state.updateStatusText = 'Already up to date.';
                state.updateBtnText = 'Check';
                state.updateBtnDisabled = false;
                syncManualUpdateCheckUI();
                return;
            }

            const mode = state.settings?.autoUpdateMode || 'download';
            if (mode === 'off' || mode === 'notify') {
                state.updateStage = 'available';
                state.updateStatusText = `New version ${checkRes.version} is available.`;
                state.updateBtnText = 'Download now';
                state.updateBtnDisabled = false;
                syncManualUpdateCheckUI();
            } else {
                await triggerDownloadUpdate();
            }
        } catch (err) {
            state.updateStage = 'idle';
            const cleanedErr = cleanLocalAddressError(err);
            state.updateStatusText = `Failed: ${cleanedErr}`;
            if (cleanedErr === 'Local service connection failed.') {
                state.updateBtnText = 'Retry';
            } else {
                state.updateBtnText = 'Check';
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
        state.updateStatusText = 'Installing update and restarting...';
        state.updateBtnText = 'Installing...';
        state.updateBtnDisabled = true;
        syncManualUpdateCheckUI();

        try {
            await window.go.main.App.InstallUpdate(state.updateCheckRes.asset_name);
        } catch (err) {
            state.updateStage = 'ready';
            const cleanedErr = cleanLocalAddressError(err);
            state.updateStatusText = `Install failed: ${cleanedErr}`;
            if (cleanedErr === 'Local service connection failed.') {
                state.updateBtnText = 'Retry';
            } else {
                state.updateBtnText = 'Restart to update';
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
    state.updateStatusText = `Downloading version ${checkRes.version}...`;
    state.updateBtnText = 'Downloading...';
    state.updateBtnDisabled = true;
    syncManualUpdateCheckUI();

    try {
        await window.go.main.App.DownloadUpdate(checkRes);
        state.updateStage = 'ready';
        state.updateStatusText = `Version ${checkRes.version} is ready.`;
        state.updateBtnText = 'Restart to update';
        state.updateBtnDisabled = false;
        syncManualUpdateCheckUI();
    } catch (err) {
        state.updateStage = 'available';
        const cleanedErr = cleanLocalAddressError(err);
        state.updateStatusText = `Download failed: ${cleanedErr}`;
        if (cleanedErr === 'Local service connection failed.') {
            state.updateBtnText = 'Retry';
        } else {
            state.updateBtnText = 'Download now';
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
