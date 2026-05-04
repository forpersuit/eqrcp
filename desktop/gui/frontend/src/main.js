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
    chatText: '',
    chatMessages: [],
    chatSaved: {},
    chatSaveDir: '',
    chatToken: currentChatToken(),
    chatQRExpanded: true,
    chatQRCollapsedAfterJoin: false,
    status: null,
    settings: null,
    appInfo: null,
    activePanel: '',
    error: '',
    notice: '',
    busy: false,
    browserFallback: false,
};

const agentEventsURL = 'http://127.0.0.1:48176/events';
let agentEvents = null;
let agentEventsRetry = null;
let chatEvents = null;
let chatEventsURL = '';
let chatReconnectTimer = null;
let chatReconnectDelay = 1000;
let chatLastMessageTimestamp = Date.now();
let chatIsPageVisible = !document.hidden;
const app = document.querySelector('#app');

function render() {
    app.innerHTML = `
        <main class="shell">
            <header class="topbar">
                <div>
                    <div class="eyebrow">Easy QR Transfer</div>
                    <h1>${state.mode === 'share' ? 'Share files' : state.mode === 'receive' ? 'Receive files' : 'Chat'}</h1>
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
                    <p>Messages stay in this local session. Attachments received by the desktop app are saved automatically.</p>
                </div>
                <button class="primary" id="start-chat" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Working...' : 'Start chat'}</button>
            </div>
        `;
    }
    const chatUrl = task.pageUrl || '';
    return `
        <div class="chat-panel">
            <div class="chat-thread" id="chat-thread">
                ${renderChatMessages()}
            </div>
            <form class="chat-compose" id="chat-compose">
                <input id="chat-file-input" type="file" multiple hidden />
                <button type="button" class="compose-icon attach-icon" id="attach-chat-file" title="Attach files" aria-label="Attach files">${attachIcon()}</button>
                <textarea id="chat-text" rows="1" placeholder="Message or paste an image">${escapeHTML(state.chatText)}</textarea>
                <button class="compose-send" type="submit" title="Send message" aria-label="Send message">${sendIcon()}</button>
            </form>
        </div>
    `;
}

function renderChatSide() {
    const task = activeChatTask();
    if (!task) {
        return `
            <aside class="side">
                <div class="panel">
                    <div class="panel-head">
                        <h2>Chat session</h2>
                        <button type="button" class="side-icon-button" id="refresh" title="Refresh" aria-label="Refresh">${refreshIcon()}</button>
                    </div>
                    <div class="empty-state">No active chat.</div>
                </div>
            </aside>
        `;
    }
    const chatUrl = task.pageUrl || '';
    const qrImage = qrImageURL(chatUrl);
    const senders = chatSenders();
    const chatState = task.chatState || task.state || 'running';
    const messageCount = task.chatMessageCount || state.chatMessages.length;
    const lastActivity = task.chatLastActivity ? messageTime(task.chatLastActivity) : '';
    syncChatQRVisibility(senders);
    return `
        <aside class="side">
            <div class="panel chat-session-panel">
                <div class="panel-head">
                    <div>
                        <div class="eyebrow">Chat ${escapeHTML(chatState)}</div>
                        <h2>${escapeHTML(messageCount)} message${messageCount === 1 ? '' : 's'}</h2>
                    </div>
                    <div class="side-head-actions">
                        <button type="button" class="side-icon-button" id="refresh" title="Refresh" aria-label="Refresh">${refreshIcon()}</button>
                        <button type="button" class="side-icon-button danger-icon stop-current-action" title="Stop chat" aria-label="Stop chat">${stopIcon()}</button>
                    </div>
                </div>
                ${lastActivity ? `<p class="side-note">Last activity: ${escapeHTML(lastActivity)}</p>` : ''}
                <div class="chat-side-actions" aria-label="Chat sharing actions">
                    <button type="button" class="side-icon-button" id="toggle-chat-qr" title="${state.chatQRExpanded ? 'Hide QR code' : 'Show QR code'}" aria-label="${state.chatQRExpanded ? 'Hide QR code' : 'Show QR code'}" ${qrImage ? '' : 'disabled'}>${qrIcon()}</button>
                    <button type="button" class="side-icon-button" id="copy-chat-url" title="Copy chat URL" aria-label="Copy chat URL" ${chatUrl ? '' : 'disabled'}>${copyIcon()}</button>
                    <button type="button" class="side-icon-button open-qr" data-open-url="${escapeAttr(chatUrl)}" title="Open chat in browser" aria-label="Open chat in browser" ${chatUrl ? '' : 'disabled'}>${browserIcon()}</button>
                    <button type="button" class="side-icon-button" id="open-chat-save" title="Open default save path" aria-label="Open default save path" ${state.chatSaveDir ? '' : 'disabled'}>${folderIcon()}</button>
                </div>
                ${qrImage && state.chatQRExpanded ? `
                    <button type="button" class="qr-card open-qr" data-open-url="${escapeAttr(chatUrl)}" title="Open chat page">
                        <img src="${escapeAttr(qrImage)}" alt="Chat QR code" />
                        <span>Scan to join</span>
                    </button>
                ` : ''}
            </div>
            <div class="panel devices-panel">
                <div class="panel-head">
                    <div>
                        <h2>Devices</h2>
                        <p class="side-note tight">${senders.length > 1 ? 'Nearby participants seen in this session.' : 'Share the QR to invite another device.'}</p>
                    </div>
                    <span class="side-count">${senders.length}</span>
                </div>
                ${senders.length ? `<div class="device-chips">${senders.map((sender) => renderDeviceItem(sender)).join('')}</div>` : '<div class="empty-state">Waiting for devices.</div>'}
            </div>
        </aside>
    `;
}

function renderChatMessages() {
    if (!state.chatMessages.length) {
        return `
            <div class="chat-empty-state">
                <div class="chat-empty-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                </div>
                <div class="chat-empty-title">No messages yet.</div>
                <div class="chat-empty-sub">Scan the QR code with your mobile device to start chatting.</div>
            </div>
        `;
    }
    return state.chatMessages.map((message) => {
        const mine = message.sender === 'Desktop';
        const isSystem = message.type === 'system';
        const saved = state.chatSaved[message.id];
        const senderLine = isSystem ? '' : `<div class="chat-sender"><span>${escapeHTML(message.sender || 'Guest')}</span><time>${escapeHTML(messageTime(message.createdAt))}</time></div>`;
        let bubbleContent;
        if (message.recalled) {
            bubbleContent = `<div class="chat-text recalled">Message recalled.</div>${mine && message.type === 'text' && message.text ? `<button type="button" class="edit-recalled" data-edit-message="${escapeAttr(message.id)}">Edit again</button>` : ''}`;
        } else if (isSystem) {
            bubbleContent = `<div class="chat-text">${escapeHTML(message.text || '')}</div>`;
        } else if (message.type === 'text') {
            bubbleContent = `<div class="chat-text">${escapeHTML(message.text || '')}</div>`;
        } else {
            bubbleContent = renderChatAttachment(message, saved);
        }
        return `
            <div class="chat-message ${mine ? 'mine' : ''}${isSystem ? ' system-msg' : ''}" data-message-id="${escapeAttr(message.id)}">
                ${senderLine}
                <div class="chat-bubble">
                    ${bubbleContent}
                </div>
                ${renderChatBubbleActions(message)}
            </div>
        `;
    }).join('');
}

function syncChatQRVisibility(senders) {
    if (!state.chatQRCollapsedAfterJoin && senders.length > 1) {
        state.chatQRExpanded = false;
        state.chatQRCollapsedAfterJoin = true;
    }
}

function renderDeviceItem(sender) {
    const label = sender || 'Guest';
    const isDesktop = label === 'Desktop';
    return `
        <span class="device-chip" title="${escapeAttr(isDesktop ? 'Host desktop' : 'Joined by chat activity')}">
            <span class="device-avatar">${escapeHTML(deviceInitial(label))}</span>
            <span class="device-name">${escapeHTML(label)}</span>
        </span>
    `;
}

function deviceInitial(sender) {
    const text = String(sender || 'G').trim();
    return (text[0] || 'G').toUpperCase();
}

function renderChatBubbleActions(message) {
    const actions = [];
    if (message.url) {
        actions.push(`<button type="button" class="bubble-action" data-save-url="${escapeAttr(absoluteChatURL(message.url))}" data-save-name="${escapeAttr(message.fileName || 'attachment')}" title="Download" aria-label="Download">${downloadIcon()}</button>`);
    }
    if (message.sender === 'Desktop' && message.type !== 'system' && !message.recalled) {
        actions.push(`<button type="button" class="bubble-action" data-recall-message="${escapeAttr(message.id)}" title="Recall" aria-label="Recall">${recallIcon()}</button>`);
    }
    if (!actions.length) {
        return '';
    }
    return `<div class="bubble-actions">${actions.join('')}</div>`;
}

function renderChatAttachment(message, saved) {
    const fullUrl = absoluteChatURL(message.url);
    const name = escapeHTML(message.fileName || 'attachment');
    const meta = escapeHTML(attachmentDescription(message));
    const preview = message.type === 'image'
        ? `<button class="preview-button media-frame" ${saved ? `data-open-file="${escapeAttr(saved)}"` : `data-open-url="${escapeAttr(fullUrl)}"`} title="Open image"><img class="chat-preview" src="${escapeAttr(fullUrl)}" alt="${escapeAttr(message.fileName || 'image')}" /></button><span class="media-meta">${name} · ${meta}</span>`
        : message.type === 'video'
            ? `<div class="media-frame"><video class="chat-preview" src="${escapeAttr(fullUrl)}" controls preload="metadata"></video></div><span class="media-meta">${name} · ${meta}</span>`
            : `<button class="chat-file file-open" ${saved ? `data-open-file="${escapeAttr(saved)}"` : ''}><strong>${name}</strong><span>${meta}</span></button>`;
    return `
        <div class="chat-attachment">
            ${preview}
        </div>
    `;
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
            <div class="settings-note">
                <strong>Chat auto-save</strong>
                <span>Attachments received by the desktop app are saved automatically by day. Folders older than 7 days are cleaned automatically.</span>
                <button type="button" class="ghost inline" id="open-chat-save" ${state.chatSaveDir ? '' : 'disabled'}>Open default path</button>
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
                disconnectChatEvents();
            } else {
                connectActiveChat();
            }
            render();
        });
    });
    document.querySelector('#refresh')?.addEventListener('click', refreshStatus);
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
    document.querySelectorAll('#chat-thread .chat-message').forEach((element) => {
        element.addEventListener('contextmenu', openChatContextMenu);
    });
    document.querySelectorAll('[data-recall-message]').forEach((button) => {
        button.addEventListener('click', (event) => recallChatMessageByID(event.currentTarget.dataset.recallMessage));
    });
    document.querySelectorAll('[data-edit-message]').forEach((button) => {
        button.addEventListener('click', (event) => continueChatEditMessage(messageByID(event.currentTarget.dataset.editMessage)));
    });
    document.querySelector('#open-chat-save')?.addEventListener('click', openChatSaveDirectory);
    document.querySelector('#copy-chat-url')?.addEventListener('click', copyChatURL);
    document.querySelector('#toggle-chat-qr')?.addEventListener('click', toggleChatQR);
    document.querySelector('#chat-compose')?.addEventListener('submit', sendChatText);
    document.querySelector('#attach-chat-file')?.addEventListener('click', () => document.querySelector('#chat-file-input')?.click());
    document.querySelector('#chat-file-input')?.addEventListener('change', uploadChatInputFiles);
    document.querySelector('#chat-text')?.addEventListener('input', (event) => {
        state.chatText = event.currentTarget.value;
        adjustChatTextarea(event.currentTarget);
    });
    document.querySelector('#chat-text')?.addEventListener('paste', pasteChatImage);
    adjustChatTextarea();
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
        state.chatSaveDir = await ChatSaveDirectory();
        state.chatQRExpanded = true;
        state.chatQRCollapsedAfterJoin = false;
        connectActiveChat();
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

function currentChatToken() {
    const key = 'eqrcp-desktop-chat-token';
    const saved = window.localStorage.getItem(key);
    if (saved) {
        return saved;
    }
    let token = '';
    if (window.crypto?.getRandomValues) {
        const data = new Uint8Array(16);
        window.crypto.getRandomValues(data);
        token = Array.from(data).map((value) => value.toString(16).padStart(2, '0')).join('');
    } else {
        token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    window.localStorage.setItem(key, token);
    return token;
}

function toggleChatQR() {
    state.chatQRExpanded = !state.chatQRExpanded;
    render();
}

async function sendChatText(event) {
    event.preventDefault();
    const task = activeChatTask();
    const text = state.chatText.trim();
    if (!task?.pageUrl || !text) {
        return;
    }
    state.chatText = '';
    const input = document.querySelector('#chat-text');
    if (input) {
        input.value = '';
        adjustChatTextarea(input);
    }
    await run(async () => {
        const response = await fetch(chatMessagesURL(task.pageUrl), {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({sender: 'Desktop', token: state.chatToken, text}),
        });
        if (!response.ok) {
            throw new Error('chat send failed');
        }
    }, {busy: false, chatError: 'Message send failed'});
}

async function recallChatMessageByID(id) {
    const task = activeChatTask();
    if (!task?.pageUrl || !id) {
        return;
    }
    await run(async () => {
        const response = await fetch(`${chatMessagesURL(task.pageUrl)}/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({sender: 'Desktop', token: state.chatToken}),
        });
        if (!response.ok) {
            throw new Error('message recall failed');
        }
    }, {busy: false, chatError: 'Message recall failed'});
}

function continueChatEditMessage(message) {
    if (!message) {
        return;
    }
    state.chatText = message.text || '';
    render();
    window.setTimeout(() => {
        const input = document.querySelector('#chat-text');
        if (input) {
            adjustChatTextarea(input);
            input.focus();
            input.selectionStart = input.value.length;
            input.selectionEnd = input.value.length;
        }
    }, 0);
}

async function uploadChatInputFiles(event) {
    const files = Array.from(event.currentTarget.files || []);
    event.currentTarget.value = '';
    await uploadChatFiles(files);
}

async function pasteChatImage(event) {
    const files = [];
    Array.from(event.clipboardData?.items || []).forEach((item) => {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
                files.push(file);
            }
        }
    });
    if (!files.length) {
        return;
    }
    event.preventDefault();
    await uploadChatFiles(files);
}

async function uploadChatFiles(files) {
    const task = activeChatTask();
    if (!task?.pageUrl || !files.length) {
        return;
    }
    await run(async () => {
        const data = new FormData();
        data.append('sender', 'Desktop');
        data.append('token', state.chatToken);
        files.forEach((file) => data.append('files', file, file.name || `pasted-image-${Date.now()}.png`));
        const response = await fetch(chatAttachmentsURL(task.pageUrl), {
            method: 'POST',
            body: data,
        });
        if (!response.ok) {
            throw new Error('chat upload failed');
        }
    }, {busy: false, chatError: 'Attachment upload failed'});
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
    const iface = document.querySelector('#settings-interface');
    const port = document.querySelector('#settings-port');
    const settings = {
        ...(state.settings || {}),
        output: receiveInput?.value || state.receiveDir || state.settings?.output || '',
        browser: Boolean(receiveBrowser?.checked ?? sideBrowser?.checked ?? state.browserFallback),
        interface: iface?.value || state.settings?.interface || '',
        port: Number(port?.value ?? state.settings?.port ?? 0),
    };
    state.settings = await SaveSettings(settings);
    state.receiveDir = state.settings.output;
    state.browserFallback = state.settings.browser;
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
    const message = messageFromElement(target);
    const items = [];
    if (target.dataset.saveUrl) {
        items.push({label: 'Save as', action: () => saveAttachmentAs(target.dataset.saveUrl, target.dataset.saveName || 'attachment')});
    }
    if (message?.sender === 'Desktop' && message.type === 'text') {
        if (message.recalled) {
            items.push({label: 'Continue editing', action: () => continueChatEditMessage(message)});
        } else {
            items.push({label: 'Recall', action: () => recallChatMessageByID(message.id)});
        }
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

function messageFromElement(element) {
    const id = element.dataset.messageId || element.closest('.chat-message')?.dataset.messageId;
    return messageByID(id);
}

function messageByID(id) {
    if (!id) {
        return null;
    }
    return state.chatMessages.find((message) => message.id === id) || null;
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
        await loadStatusData();
        render();
    });
}

async function loadStatusData() {
    state.status = await AgentStatus();
    if (state.mode === 'chat') {
        connectActiveChat();
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
        if (options.chatError && state.mode === 'chat') {
            addLocalChatSystemMessage(options.chatError);
        } else {
            state.error = error?.message || String(error);
        }
        render();
    } finally {
        if (showBusy) {
            state.busy = false;
            render();
        }
    }
}

function addLocalChatSystemMessage(text) {
    state.chatMessages = [
        ...state.chatMessages,
        {
            id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            sender: 'system',
            type: 'system',
            text,
            createdAt: new Date().toISOString(),
        },
    ];
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
            if (state.mode === 'chat' && activeChatTask()) {
                connectActiveChat();
                updateChatSide();
            } else {
                render();
            }
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

function connectActiveChat() {
    const task = activeChatTask();
    if (!task?.pageUrl) {
        disconnectChatEvents();
        return;
    }
    const nextURL = chatEventsRoute(task.pageUrl);
    if (chatEvents && chatEventsURL === nextURL) {
        return;
    }
    disconnectChatEvents();
    chatEventsURL = nextURL;
    if (!window.EventSource) {
        loadChatMessages(task.pageUrl);
        return;
    }
    connectChatSSE(task.pageUrl);
}

function connectChatSSE(pageUrl) {
    if (chatEvents) {
        chatEvents.close();
        chatEvents = null;
    }
    
    chatEvents = new EventSource(chatEventsRoute(pageUrl));
    
    chatEvents.onopen = () => {
        chatReconnectDelay = 1000;
        chatLastMessageTimestamp = Date.now();
    };
    
    chatEvents.onmessage = (event) => {
        try {
            const wasNearBottom = isChatNearBottom();
            const previousLastID = state.chatMessages.at(-1)?.id;
            // The chat stream sends a complete bounded snapshot. Replacing local state
            // keeps reconnect recovery idempotent after mobile browser suspension.
            state.chatMessages = JSON.parse(event.data) || [];
            const nextLast = state.chatMessages.at(-1);

            chatLastMessageTimestamp = Date.now();
            saveChatAttachments();
            if (state.mode === 'chat') {
                updateChatThread({forceBottom: wasNearBottom || (nextLast?.sender === 'Desktop' && nextLast.id !== previousLastID)});
                updateChatSide();
            }
        } catch {
            loadChatMessages(pageUrl);
        }
    };
    
    chatEvents.onerror = () => {
        if (chatEvents) {
            chatEvents.close();
            chatEvents = null;
        }
        
        // Only reconnect if page is visible
        if (chatIsPageVisible) {
            scheduleChatReconnect(pageUrl);
        }
    };
}

function scheduleChatReconnect(pageUrl) {
    if (chatReconnectTimer) {
        clearTimeout(chatReconnectTimer);
    }
    
    chatReconnectTimer = setTimeout(() => {
        if (chatIsPageVisible && state.mode === 'chat') {
            const task = activeChatTask();
            if (task?.pageUrl === pageUrl) {
                connectChatSSE(pageUrl);
                chatReconnectDelay = Math.min(chatReconnectDelay * 2, 30000);
            }
        }
    }, chatReconnectDelay);
}

async function verifyChatConnection(pageUrl) {
    try {
        const healthURL = pageUrl.replace(/\/$/, '') + '/health';
        const healthResponse = await fetch(healthURL, {cache: 'no-store'});
        if (!healthResponse.ok) {
            throw new Error('health check failed');
        }
        // Server is healthy: reset backoff and reconnect SSE (which delivers fresh snapshot)
        chatReconnectDelay = 1000;
        connectChatSSE(pageUrl);
    } catch {
        // Server unreachable: use exponential backoff instead of hammering immediately
        scheduleChatReconnect(pageUrl);
    }
}

function disconnectChatEvents() {
    if (chatEvents) {
        chatEvents.close();
        chatEvents = null;
    }
    if (chatReconnectTimer) {
        clearTimeout(chatReconnectTimer);
        chatReconnectTimer = null;
    }
    chatEventsURL = '';
    chatReconnectDelay = 1000;
}

async function loadChatMessages(pageUrl) {
    if (!pageUrl) {
        return;
    }
    try {
        const response = await fetch(chatMessagesURL(pageUrl), {cache: 'no-store'});
        if (!response.ok) {
            throw new Error('chat messages failed');
        }
        state.chatMessages = await response.json() || [];
        await saveChatAttachments();
        if (state.mode === 'chat') {
            updateChatThread({forceBottom: true});
            updateChatSide();
        }
    } catch (error) {
        state.error = error?.message || String(error);
    }
}

async function saveChatAttachments() {
    const task = activeChatTask();
    if (!task?.pageUrl) {
        return;
    }
    if (!state.chatSaveDir) {
        try {
            state.chatSaveDir = await ChatSaveDirectory();
        } catch {
            return;
        }
    }
    const pending = state.chatMessages.filter(
        (message) => message?.id && message.url && message.type !== 'text' && message.type !== 'system' && !state.chatSaved[message.id]
    );
    if (!pending.length) {
        return;
    }
    const results = await Promise.allSettled(
        pending.map((message) =>
            DownloadChatAttachment(absoluteChatURL(message.url), message.fileName || 'attachment')
                .then((saved) => ({id: message.id, saved}))
        )
    );
    let changed = false;
    for (const result of results) {
        if (result.status === 'fulfilled') {
            state.chatSaved = {...state.chatSaved, [result.value.id]: result.value.saved};
            changed = true;
        }
    }
    if (changed) {
        updateChatThread();
    }
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
        connectActiveChat();
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

function updateChatThread(options = {}) {
    const thread = document.querySelector('#chat-thread');
    if (!thread) {
        render();
        return;
    }
    const activeElement = document.activeElement;
    const composerFocused = activeElement?.id === 'chat-text';
    const selectionStart = composerFocused ? activeElement.selectionStart : 0;
    const selectionEnd = composerFocused ? activeElement.selectionEnd : 0;
    const shouldStick = options.forceBottom || isChatNearBottom(thread);
    thread.innerHTML = renderChatMessages();
    bindChatThreadEvents();
    if (shouldStick) {
        thread.scrollTop = thread.scrollHeight;
    }
    if (composerFocused) {
        const input = document.querySelector('#chat-text');
        input?.focus();
        if (input) {
            input.selectionStart = selectionStart;
            input.selectionEnd = selectionEnd;
        }
    }
}

function updateChatSide() {
    if (state.mode !== 'chat') {
        return;
    }
    const side = document.querySelector('.layout > .side');
    if (!side) {
        return;
    }
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderChatSide().trim();
    const next = wrapper.firstElementChild;
    if (next) {
        side.replaceWith(next);
        bindSideEvents();
    }
}

function bindSideEvents() {
    document.querySelector('#refresh')?.addEventListener('click', refreshStatus);
    document.querySelectorAll('.side .stop-current-action').forEach((button) => {
        button.addEventListener('click', stopCurrent);
    });
    document.querySelectorAll('.side .open-qr').forEach((button) => {
        button.addEventListener('click', openQRPage);
    });
    document.querySelector('#open-chat-save')?.addEventListener('click', openChatSaveDirectory);
    document.querySelector('#copy-chat-url')?.addEventListener('click', copyChatURL);
    document.querySelector('#toggle-chat-qr')?.addEventListener('click', toggleChatQR);
}

function bindChatThreadEvents() {
    document.querySelectorAll('#chat-thread .preview-button[data-open-url]').forEach((button) => {
        button.addEventListener('click', openQRPage);
    });
    document.querySelectorAll('#chat-thread [data-open-file]').forEach((button) => {
        button.addEventListener('click', openSavedFile);
    });
    document.querySelectorAll('#chat-thread [data-save-url]').forEach((element) => {
        element.addEventListener('contextmenu', openChatContextMenu);
        element.addEventListener('click', saveAttachmentAsFromButton);
    });
    document.querySelectorAll('#chat-thread .chat-message').forEach((element) => {
        element.addEventListener('contextmenu', openChatContextMenu);
    });
    document.querySelectorAll('#chat-thread [data-recall-message]').forEach((button) => {
        button.addEventListener('click', (event) => recallChatMessageByID(event.currentTarget.dataset.recallMessage));
    });
    document.querySelectorAll('#chat-thread [data-edit-message]').forEach((button) => {
        button.addEventListener('click', (event) => continueChatEditMessage(messageByID(event.currentTarget.dataset.editMessage)));
    });
}

function isChatNearBottom(thread = document.querySelector('#chat-thread')) {
    if (!thread) {
        return true;
    }
    return thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
}

function chatSenders() {
    const senders = new Set(['Desktop']);
    state.chatMessages.forEach((message) => {
        if (message.sender && message.type !== 'system') {
            senders.add(message.sender);
        }
    });
    return [...senders].slice(0, 8);
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

function attachmentDescription(message) {
    const parts = [];
    const extension = fileExtension(message.fileName);
    if (extension !== 'FILE') {
        parts.push(extension);
    }
    parts.push(formatBytes(message.size || 0));
    return parts.join(' - ');
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

function fileExtension(name) {
    const parts = String(name || '').split('.');
    if (parts.length < 2) {
        return 'FILE';
    }
    return parts.pop().slice(0, 4).toUpperCase();
}

function adjustChatTextarea(input = document.querySelector('#chat-text')) {
    if (!input) {
        return;
    }
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
}

function downloadIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>';
}

function recallIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M6 6l1 14h10l1-14"></path></svg>';
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

function qrIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4z"></path><path d="M14 4h6v6h-6z"></path><path d="M4 14h6v6H4z"></path><path d="M14 14h2v2h-2z"></path><path d="M18 14h2v6h-4v-2h2z"></path><path d="M14 18h2v2h-2z"></path></svg>';
}

function folderIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>';
}

function attachIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>';
}

function sendIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 16-8-5 16-3-7-8-1z"></path></svg>';
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

function chatMessagesURL(pageUrl) {
    const url = new URL(pageUrl);
    url.pathname = url.pathname.replace(/\/$/, '') + '/messages';
    url.search = '';
    url.hash = '';
    return url.toString();
}

function chatAttachmentsURL(pageUrl) {
    const url = new URL(pageUrl);
    url.pathname = url.pathname.replace(/\/$/, '') + '/attachments';
    url.search = '';
    url.hash = '';
    return url.toString();
}

function chatEventsRoute(pageUrl) {
    const url = new URL(pageUrl);
    url.pathname = url.pathname.replace(/\/$/, '') + '/events';
    url.search = '';
    url.hash = '';
    return url.toString();
}

function absoluteChatURL(path) {
    const task = activeChatTask();
    if (!task?.pageUrl || !path) {
        return '';
    }
    try {
        return new URL(path, task.pageUrl.replace(/\/?$/, '/')).toString();
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

// Monitor page visibility for chat reconnection
document.addEventListener('visibilitychange', () => {
    chatIsPageVisible = !document.hidden;
    
    if (chatIsPageVisible && state.mode === 'chat') {
        const task = activeChatTask();
        if (!task?.pageUrl) {
            return;
        }
        
        const timeSinceLastMessage = Date.now() - chatLastMessageTimestamp;
        
        if (!chatEvents || chatEvents.readyState === EventSource.CLOSED) {
            // Connection is closed, verify health before reconnecting
            verifyChatConnection(task.pageUrl);
        } else if (chatEvents.readyState === EventSource.CONNECTING) {
            // Already connecting, wait
        } else if (timeSinceLastMessage > 10000) {
            // Connection looks open but no messages for 10s (reduced from 30s), verify health
            verifyChatConnection(task.pageUrl);
        }
    } else {
        // Page became hidden, cancel reconnection attempts
        if (chatReconnectTimer) {
            clearTimeout(chatReconnectTimer);
            chatReconnectTimer = null;
        }
    }
});

render();
loadSettings().then(connectAgentEvents);
