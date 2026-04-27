import './style.css';
import './app.css';

import {EventsOn} from '../wailsjs/runtime/runtime';
import {
    AgentStatus,
    ClearHistory,
    OpenURL,
    ReadSettings,
    Receive,
    RepeatTask,
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
    status: null,
    settings: null,
    error: '',
    notice: '',
    busy: false,
    browserFallback: false,
};

const agentEventsURL = 'http://127.0.0.1:48176/events';
let agentEvents = null;
let agentEventsRetry = null;
const app = document.querySelector('#app');

function render() {
    const current = state.status?.current;
    const history = state.status?.history || [];
    app.innerHTML = `
        <main class="shell">
            <header class="topbar">
                <div>
                    <div class="eyebrow">eqrcp desktop</div>
                    <h1>${state.mode === 'share' ? 'Share files' : 'Receive files'}</h1>
                </div>
                <nav class="mode-switch" aria-label="Mode">
                    <button class="${state.mode === 'share' ? 'active' : ''}" data-mode="share">Share</button>
                    <button class="${state.mode === 'receive' ? 'active' : ''}" data-mode="receive">Receive</button>
                </nav>
            </header>

            <section class="layout">
                <div class="workspace">
                    ${state.mode === 'share' ? renderShare() : renderReceive()}
                    ${state.notice ? `<div class="notice success">${escapeHTML(state.notice)}</div>` : ''}
                    ${state.error ? `<div class="notice error">${escapeHTML(state.error)}</div>` : ''}
                </div>
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
                    ${renderSettings()}
                </aside>
            </section>
        </main>
    `;
    bindEvents();
}

function renderShare() {
    const items = state.sharePaths.map((path, index) => `
        <li>
            <div>
                <strong>${escapeHTML(shortName(path))}</strong>
                <span>${escapeHTML(path)}</span>
            </div>
            <button class="icon-button remove-path" data-path-index="${index}" title="Remove">x</button>
        </li>
    `).join('');
    return `
        <div class="dropzone" style="--wails-drop-target: drop">
            <div class="drop-title">Drop files or folders here</div>
            <div class="drop-subtitle">${state.sharePaths.length ? `${state.sharePaths.length} item(s) ready` : 'Use drag and drop, or choose files manually.'}</div>
            <div class="actions">
                <button id="choose-files">Choose files</button>
                <button id="choose-folder" class="secondary">Choose folder</button>
            </div>
        </div>
        <ul class="path-list">${items || '<li class="empty">No selected items</li>'}</ul>
        <div class="primary-row">
            <button class="primary" id="start-share" ${state.sharePaths.length && !state.busy ? '' : 'disabled'}>${state.busy ? 'Working...' : 'Start transfer'}</button>
            <button class="ghost" id="clear-share" ${state.sharePaths.length ? '' : 'disabled'}>Clear</button>
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
            <label class="check">
                <input id="browser-open" type="checkbox" ${state.browserFallback ? 'checked' : ''} />
                Open browser QR page as a fallback
            </label>
        </div>
        <div class="primary-row">
            <button class="primary" id="start-receive" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Working...' : 'Start receive'}</button>
            <button class="ghost" id="save-settings">Save settings</button>
        </div>
    `;
}

function renderSettings() {
    if (!state.settings) {
        return '';
    }
    const options = (state.settings.interfaceOptions || []).map((option) => `
        <option value="${escapeAttr(option.name)}" ${option.name === state.settings.interface ? 'selected' : ''}>${escapeHTML(option.label || option.name)}</option>
    `).join('');
    return `
        <div class="panel settings-panel">
            <h2>Settings</h2>
            <label>Network interface</label>
            <select id="settings-interface">${options}</select>
            <label>Port</label>
            <input id="settings-port" type="number" min="0" max="65535" value="${Number(state.settings.port || 0)}" />
            <label class="check">
                <input id="settings-browser" type="checkbox" ${state.browserFallback ? 'checked' : ''} />
                Browser fallback
            </label>
            <button class="primary full" id="save-side-settings">Save settings</button>
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
            ${finished ? '' : '<button class="danger" id="stop-current">Stop current</button>'}
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
                <span>${escapeHTML(task.transferTarget || task.paths?.map(shortName).join(', ') || '')}</span>
            </div>
            <button class="ghost repeat-task" data-task-id="${task.id}">Repeat</button>
        </li>
    `).join('')}</ol>`;
}

function bindEvents() {
    document.querySelectorAll('[data-mode]').forEach((button) => {
        button.addEventListener('click', () => {
            state.mode = button.dataset.mode;
            clearMessages();
            render();
        });
    });
    document.querySelector('#refresh')?.addEventListener('click', refreshStatus);
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
    document.querySelector('#choose-receive')?.addEventListener('click', chooseReceiveDirectory);
    document.querySelector('#start-receive')?.addEventListener('click', startReceive);
    document.querySelector('#save-settings')?.addEventListener('click', saveSettings);
    document.querySelector('#save-side-settings')?.addEventListener('click', saveSettings);
    document.querySelector('#stop-current')?.addEventListener('click', stopCurrent);
    document.querySelector('.open-qr')?.addEventListener('click', openQRPage);
    document.querySelector('#clear-history')?.addEventListener('click', clearHistory);
    document.querySelectorAll('.repeat-task').forEach((button) => {
        button.addEventListener('click', repeatTask);
    });
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

async function refreshStatus(shouldRender = true) {
    await run(async () => {
        await loadStatusData();
        if (shouldRender) {
            render();
        }
    });
}

async function loadSettings() {
    await run(async () => {
        state.settings = await ReadSettings();
        state.receiveDir = state.settings.output || '';
        state.browserFallback = false;
        await loadStatusData();
        render();
    });
}

async function loadStatusData() {
    state.status = await AgentStatus();
}

async function run(fn) {
    state.error = '';
    state.busy = true;
    renderBusy();
    try {
        await fn();
    } catch (error) {
        state.error = error?.message || String(error);
        render();
    } finally {
        state.busy = false;
        render();
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

function preventFileNavigation(event) {
    if (event.dataTransfer?.types?.includes('Files')) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    }
}

function connectAgentEvents() {
    if (!window.EventSource || agentEvents) {
        return;
    }
    agentEvents = new EventSource(agentEventsURL);
    agentEvents.onmessage = (event) => {
        try {
            state.status = JSON.parse(event.data);
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

function clearMessages() {
    state.error = '';
    state.notice = '';
}

function isTerminal(task) {
    return ['completed', 'stopped', 'failed', 'replaced'].includes(task.transferState || task.state);
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
        url.pathname = cleanPath.endsWith('/qr') ? `${cleanPath}/image` : '/qr/image';
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

EventsOn('eqrcp:file-drop', (paths) => {
    state.mode = 'share';
    addSharePaths(paths || []);
});

document.addEventListener('dragenter', preventFileNavigation, true);
document.addEventListener('dragover', preventFileNavigation, true);
document.addEventListener('drop', preventFileNavigation, true);

render();
loadSettings().then(connectAgentEvents);
setInterval(refreshStatus, 1500);
