import './style.css';
import './app.css';

import {EventsOn, OnFileDrop} from '../wailsjs/runtime/runtime';
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
    Share,
    StopCurrent,
} from '../wailsjs/go/main/App';

const state = {
    mode: 'share',
    sharePaths: [],
    receiveDir: '',
    chatSaveDir: '',
    status: null,
    settings: null,
    appInfo: null,
    activePanel: '',
    error: '',
    notice: '',
    busy: false,
    browserFallback: false,
    chatAutoSave: true,
    closeBehavior: 'tray',
    chatQROpen: false,
    lastChatDeviceCount: 0,
    activeChatTaskId: 0,
};

const agentEventsURL = 'http://127.0.0.1:48176/events';
let agentEvents = null;
let agentEventsRetry = null;
const autoSavedAttachments = new Set();
const app = document.querySelector('#app');

// postMessage bridge: handle native file operations requested by the chat iframe.
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
    app.innerHTML = `
        <main class="shell">
            <header class="topbar">
                <div>
                    ${renderTopIntro()}
                    <h1>${renderTopTitle()}</h1>
                </div>
                <div class="top-actions">
                    <nav class="mode-switch" aria-label="Mode">
                        <button class="${state.mode === 'share' ? 'active' : ''}" data-mode="share">Share</button>
                        <button class="${state.mode === 'receive' ? 'active' : ''}" data-mode="receive">Receive</button>
                        <button class="${state.mode === 'chat' ? 'active' : ''}" data-mode="chat">Chat</button>
                    </nav>
                    <button class="tool-button" id="open-settings" title="Settings" aria-label="Settings">&#9881;</button>
                    <button class="tool-button" id="open-about" title="About EQT" aria-label="About EQT">i</button>
                    <button class="tool-button" id="open-feedback" title="Send feedback" aria-label="Send feedback">?</button>
                </div>
            </header>

            <section class="layout">
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

function renderTopIntro() {
    if (state.mode !== 'chat') {
        return '<div class="eyebrow">Easy QR Transfer</div>';
    }
    const task = activeChatTask();
    const online = task ? 'Online' : 'Ready';
    const deviceCount = chatDeviceCount(task);
    return `
        <div class="chat-top-meta">
            <span class="status-dot ${task ? '' : 'muted'}"></span>
            <span>${online}</span>
            <span class="meta-separator">.</span>
            <span>${deviceCount} device${deviceCount === 1 ? '' : 's'} connected</span>
        </div>
    `;
}

function renderTopTitle() {
    if (state.mode === 'share') {
        return 'Share files';
    }
    if (state.mode === 'receive') {
        return 'Receive files';
    }
    return 'EQT Chat';
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
        return renderChatSide();
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
    if (!task) {
        return `
            <div class="chat-start">
                <div>
                    <div class="eyebrow">Session mode</div>
                    <h2>Local chat with phones and nearby devices</h2>
                    <p>Messages stay in this local session. Chat attachment auto-save is managed in Settings.</p>
                </div>
                <button class="primary" id="start-chat" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Working...' : 'Start chat'}</button>
            </div>
        `;
    }
    const chatUrl = task.pageUrl || '';
    const src = chatUrl;
    return `
        <div class="chat-panel">
            <iframe class="chat-iframe" id="chat-iframe" src="${escapeAttr(src)}" allow="clipboard-write" title="Chat"></iframe>
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
    const chatUrl = task.pageUrl || '';
    const chatState = task.chatState || task.state || 'running';
    const messageCount = task.chatMessageCount || 0;
    const lastActivity = task.chatLastActivity ? messageTime(task.chatLastActivity) : '';
    const deviceCount = chatDeviceCount(task);
    const qrImage = qrImageURL(chatUrl);
    const qrToggleLabel = state.chatQROpen ? 'Hide chat QR' : 'Show chat QR';
    const remoteDeviceCount = Math.max(0, deviceCount - 1);
    return `
        <aside class="side">
            <div class="panel chat-session-panel">
                <div class="panel-head">
                    <div>
                        <div class="panel-title-inline"><span class="status-dot"></span><h2>Chat Status</h2></div>
                        <p class="side-note tight">${escapeHTML(chatStateLabel(chatState))}</p>
                    </div>
                    <div class="side-head-actions">
                        <button type="button" class="side-icon-button refresh-action" title="Refresh" aria-label="Refresh">${refreshIcon()}</button>
                        <button type="button" class="side-icon-button open-qr" data-open-url="${escapeAttr(chatUrl)}" title="Open chat in browser" aria-label="Open chat in browser" ${chatUrl ? '' : 'disabled'}>${browserIcon()}</button>
                        <button type="button" class="side-icon-button danger-icon stop-current-action" title="Stop chat" aria-label="Stop chat">${stopIcon()}</button>
                    </div>
                </div>
                <div class="chat-count">${escapeHTML(String(messageCount))} message${messageCount === 1 ? '' : 's'}</div>
                ${lastActivity ? `<p class="side-note">Last activity: ${escapeHTML(lastActivity)}</p>` : ''}
            </div>
            <div class="panel chat-session-panel chat-qr-panel ${state.chatQROpen ? 'expanded' : ''}">
                <div class="panel-head">
                    <h2>Scan to Join Chat</h2>
                    <button type="button" class="side-icon-button chat-qr-toggle-action" title="${qrToggleLabel}" aria-label="${qrToggleLabel}">${qrIcon()}</button>
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
        about: 'About EQT',
        feedback: 'Send feedback',
    }[state.activePanel] || '';
    return `
        <div class="overlay" role="presentation">
            <section class="modal" role="dialog" aria-modal="true" aria-label="${escapeAttr(title)}">
                <div class="modal-head">
                    <h2>${escapeHTML(title)}</h2>
                    <button class="tool-button" id="close-panel" title="Close" aria-label="Close">x</button>
                </div>
                ${state.activePanel === 'settings' ? renderSettingsPanel() : ''}
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
    return `
        <div class="settings-panel">
            <label>Network interface</label>
            <select id="settings-interface">${options}</select>
            <label>Port</label>
            <input id="settings-port" type="number" min="0" max="65535" value="${Number(state.settings.port || 0)}" />
            <label class="check">
                <input id="settings-browser" type="checkbox" ${state.browserFallback ? 'checked' : ''} />
                Browser fallback
            </label>
            <label>Window close action</label>
            <select id="settings-close-behavior">
                <option value="tray" ${state.closeBehavior !== 'quit' ? 'selected' : ''}>Keep EQT in taskbar tray</option>
                <option value="quit" ${state.closeBehavior === 'quit' ? 'selected' : ''}>Quit EQT completely</option>
            </select>
            <div class="settings-note">
                <label class="check">
                    <input id="settings-chat-autosave" type="checkbox" ${state.chatAutoSave ? 'checked' : ''} />
                    <strong>Auto-save chat attachments</strong>
                </label>
                <span>When enabled, attachments received in the desktop chat are saved automatically by day. Folders older than 7 days are cleaned automatically.</span>
                <button type="button" class="ghost inline" id="open-chat-save">Open chat save folder</button>
            </div>
            <button class="primary full" id="save-side-settings">Save settings</button>
        </div>
    `;
}

function renderAboutPanel() {
    const info = state.appInfo || {};
    return `
        <div class="about-panel">
            <div class="brand-mark">EQT</div>
            <p>${escapeHTML(info.description || 'Local QR-code file transfer for desktop and mobile devices.')}</p>
            <dl>
                <dt>Product</dt><dd>${escapeHTML(info.product || 'EQT')} / ${escapeHTML(info.name || 'Easy QR Transfer')}</dd>
                <dt>Agent</dt><dd>${escapeHTML(info.agentUrl || agentEventsURL.replace('/events', ''))}</dd>
                <dt>Platform</dt><dd>${escapeHTML([info.os, info.arch].filter(Boolean).join(' / ') || 'Unknown')}</dd>
                <dt>CLI</dt><dd>${escapeHTML(info.cliPath || 'Not found yet')}</dd>
                <dt>License</dt><dd>MIT, forked from qrcp</dd>
            </dl>
            <button class="ghost open-docs" data-open-external="https://github.com/forpersuit/eqrcp">Project page</button>
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
            <label>Message</label>
            <textarea id="feedback-message" rows="5" placeholder="What happened?"></textarea>
            <label class="check">
                <input id="feedback-diagnostics" type="checkbox" checked />
                Include diagnostics preview
            </label>
            <pre class="diagnostics">${escapeHTML(diagnostics)}</pre>
            <button class="primary full" id="send-feedback" data-mailto="${escapeAttr(mailto)}">Open email draft</button>
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

function renderHistory(history) {
    if (!history.length) {
        return `<div class="empty-state">No completed tasks yet.</div>`;
    }
    return `<ol class="history">${history.slice(0, 8).map((task) => `
        <li>
            <div>
                <strong>${escapeHTML(titleCase(task.action))} #${task.id}</strong>
                <span>${escapeHTML(task.state)}${task.transferState ? ` / ${escapeHTML(task.transferState)}` : ''}</span>
                ${renderHistoryTarget(task)}
            </div>
            <button class="ghost repeat-task" data-task-id="${task.id}">Repeat</button>
        </li>
    `).join('')}</ol>`;
}

function renderHistoryTarget(task) {
    const path = task.action === 'receive' ? task.paths?.[0] : '';
    const label = task.transferTarget || task.paths?.map(shortName).join(', ') || '';
    if (path) {
        return `<button class="path-link" data-open-path="${escapeAttr(path)}">${escapeHTML(label || path)}</button>`;
    }
    return `<span>${escapeHTML(label)}</span>`;
}

function bindEvents() {
    document.querySelectorAll('[data-mode]').forEach((button) => {
        button.addEventListener('click', () => {
            state.mode = button.dataset.mode;
            clearMessages();
            if (state.mode !== 'chat') {
                // nothing extra needed
            } else {
                render();
            }
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
    document.querySelector('#close-panel')?.addEventListener('click', closePanel);
    document.querySelector('.overlay')?.addEventListener('click', (event) => {
        if (event.target.classList.contains('overlay')) {
            closePanel();
        }
    });
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
    document.querySelector('#save-side-settings')?.addEventListener('click', saveSettings);
    document.querySelectorAll('.stop-current-action').forEach((button) => {
        button.addEventListener('click', stopCurrent);
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
    document.querySelector('#open-chat-save')?.addEventListener('click', openChatSaveDirectory);
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
    document.querySelector('.open-docs')?.addEventListener('click', openExternal);
    document.querySelector('#send-feedback')?.addEventListener('click', sendFeedback);
}

function openPanel(panel) {
    state.activePanel = panel;
    clearMessages();
    render();
}

function closePanel() {
    state.activePanel = '';
    render();
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
    await run(async () => {
        await saveSettingsData();
        state.status = await Chat();
        state.mode = 'chat';
        state.notice = 'Chat session started.';
        reconcileChatQRState(state.status);
        if (state.chatAutoSave) {
            state.chatSaveDir = await ChatSaveDirectory();
        }
        render();
    });
}

async function openChatSaveDirectory() {
    await run(async () => {
        const dir = state.chatSaveDir || await ChatSaveDirectory();
        state.chatSaveDir = dir;
        await OpenPath(dir);
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
    state.chatQROpen = !state.chatQROpen;
    render();
}

function closeChatQROnOutside(event) {
    if (event.target.closest('.chat-qr-panel')) {
        return;
    }
    state.chatQROpen = false;
    render();
}

async function saveSettings() {
    await run(async () => {
        await saveSettingsData();
        state.notice = 'Settings saved.';
        render();
    });
}

async function saveSettingsData() {
    const receiveInput = document.querySelector('#receive-dir');
    const receiveBrowser = document.querySelector('#browser-open');
    const sideBrowser = document.querySelector('#settings-browser');
    const chatAutoSave = document.querySelector('#settings-chat-autosave');
    const closeBehavior = document.querySelector('#settings-close-behavior');
    const iface = document.querySelector('#settings-interface');
    const port = document.querySelector('#settings-port');
    const settings = {
        ...(state.settings || {}),
        output: receiveInput?.value || state.receiveDir || state.settings?.output || '',
        browser: Boolean(receiveBrowser?.checked ?? sideBrowser?.checked ?? state.browserFallback),
        chatAutoSave: Boolean(chatAutoSave?.checked ?? state.chatAutoSave),
        closeBehavior: closeBehavior?.value || state.closeBehavior || 'tray',
        interface: iface?.value || state.settings?.interface || '',
        port: Number(port?.value ?? state.settings?.port ?? 0),
    };
    state.settings = await SaveSettings(settings);
    state.receiveDir = state.settings.output;
    state.browserFallback = state.settings.browser;
    state.chatAutoSave = state.settings.chatAutoSave !== false;
    state.closeBehavior = state.settings.closeBehavior === 'quit' ? 'quit' : 'tray';
}

async function stopCurrent() {
    await run(async () => {
        await StopCurrent();
        state.notice = 'Current task stopped.';
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
        const category = document.querySelector('#feedback-category')?.value || 'Feedback';
        const message = document.querySelector('#feedback-message')?.value || '';
        const includeDiagnostics = Boolean(document.querySelector('#feedback-diagnostics')?.checked);
        const body = [
            message,
            includeDiagnostics ? '\n\nDiagnostics:\n' + buildDiagnostics() : '',
        ].join('');
        const mailto = feedbackMailto(body, category);
        await OpenExternal(mailto || event.currentTarget.dataset.mailto);
    }, {busy: false});
}

async function refreshStatus(shouldRender = true) {
    await run(async () => {
        await loadStatusData();
        if (shouldRender) {
            render();
        }
    }, {busy: false});
}

async function loadSettings() {
    await run(async () => {
        state.appInfo = await AppInfo();
        state.settings = await ReadSettings();
        state.receiveDir = state.settings.output || '';
        state.browserFallback = Boolean(state.settings.browser);
        state.chatAutoSave = state.settings.chatAutoSave !== false;
        state.closeBehavior = state.settings.closeBehavior === 'quit' ? 'quit' : 'tray';
        await loadStatusData();
        render();
    });
}

async function loadStatusData() {
    state.status = await AgentStatus();
    reconcileChatQRState(state.status);
    render();
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

function connectAgentEvents() {
    if (!window.EventSource || agentEvents) {
        return;
    }
    agentEvents = new EventSource(agentEventsURL);
    agentEvents.onmessage = (event) => {
        try {
            state.status = JSON.parse(event.data);
            reconcileChatQRState(state.status);
            render();
        } catch {
            refreshStatus(false);
        }
    };
    agentEvents.onerror = () => {
        agentEvents.close();
        agentEvents = null;
        if (!agentEventsRetry) {
            agentEventsRetry = window.setTimeout(() => {
                agentEventsRetry = null;
                connectAgentEvents();
            }, 1500);
        }
    };
}

function handleFileDrop(paths) {
    state.mode = 'share';
    addSharePaths(paths || []);
}

function handleTrayCommand(command) {
    clearMessages();
    if (command === 'share') {
        state.mode = 'share';
        state.activePanel = '';
        state.notice = 'Ready to share.';
        render();
        return;
    }
    if (command === 'receive') {
        state.mode = 'receive';
        state.activePanel = '';
        state.notice = 'Ready to receive.';
        render();
        return;
    }
    if (command === 'chat') {
        state.mode = 'chat';
        state.activePanel = '';
        state.notice = 'Ready to chat.';
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
    const task = state.status?.current;
    if (!task || task.action !== 'chat' || isTerminal(task)) {
        return null;
    }
    return task;
}

function reconcileChatQRState(status) {
    const task = status?.current;
    if (!task || task.action !== 'chat' || isTerminal(task)) {
        state.activeChatTaskId = 0;
        state.lastChatDeviceCount = 0;
        state.chatQROpen = false;
        return;
    }
    const deviceCount = chatDeviceCount(task);
    if (state.activeChatTaskId !== task.id) {
        state.activeChatTaskId = task.id;
        state.lastChatDeviceCount = deviceCount;
        state.chatQROpen = deviceCount <= 1;
        return;
    }
    if (deviceCount > 1 && state.lastChatDeviceCount <= 1) {
        state.chatQROpen = false;
    }
    state.lastChatDeviceCount = deviceCount;
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
        `agent: ${info.agentUrl || agentEventsURL.replace('/events', '')}`,
        `cli: ${info.cliPath || 'not found'}`,
        `agent state: ${status.state || 'unknown'}`,
        `agent version: ${status.version || 'unknown'}`,
        `current task: ${status.current ? `${status.current.action} #${status.current.id} ${status.current.state}` : 'none'}`,
        `history count: ${(status.history || []).length}`,
        `config: ${state.settings?.configPath || 'unknown'}`,
    ].join('\n');
}

function feedbackMailto(body, category = 'Feedback') {
    const subject = encodeURIComponent(`EQT ${category}`);
    const encodedBody = encodeURIComponent(body || buildDiagnostics());
    return `mailto:jinxpeeter@outlook.com?subject=${subject}&body=${encodedBody}`;
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

render();
loadSettings().then(connectAgentEvents);
