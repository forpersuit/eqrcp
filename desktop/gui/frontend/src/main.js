import './style.css';
import './app.css';

import {EventsOn} from '../wailsjs/runtime/runtime';
import {
    AgentStatus,
    ReadSettings,
    Receive,
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
};

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
                        <h2>Recent history</h2>
                        ${renderHistory(history)}
                    </div>
                </aside>
            </section>
        </main>
    `;
    bindEvents();
}

function renderShare() {
    const items = state.sharePaths.map((path) => `<li>${escapeHTML(shortName(path))}<span>${escapeHTML(path)}</span></li>`).join('');
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
            <button class="primary" id="start-share" ${state.sharePaths.length ? '' : 'disabled'}>Start transfer</button>
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
                <input id="browser-open" type="checkbox" ${state.settings?.browser ? 'checked' : ''} />
                Open browser QR page as a fallback
            </label>
        </div>
        <div class="primary-row">
            <button class="primary" id="start-receive">Start receive</button>
            <button class="ghost" id="save-settings">Save settings</button>
        </div>
    `;
}

function renderCurrent(task) {
    if (!task) {
        return `<div class="empty-state">Agent is idle.</div>`;
    }
    const percent = task.transferPercent || 0;
    return `
        <div class="task-card">
            <div class="task-title">${escapeHTML(task.action)} #${task.id}</div>
            <div class="task-state">${escapeHTML(task.transferState || task.state)}</div>
            <div class="progress"><span style="width:${Math.max(0, Math.min(100, percent))}%"></span></div>
            <dl>
                <dt>Target</dt><dd>${escapeHTML(task.transferTarget || task.transferCurrent || shortName(task.paths?.[0] || ''))}</dd>
                <dt>QR page</dt><dd>${task.pageUrl ? escapeHTML(task.pageUrl) : 'Waiting'}</dd>
            </dl>
            <button class="danger" id="stop-current">Stop current</button>
        </div>
    `;
}

function renderHistory(history) {
    if (!history.length) {
        return `<div class="empty-state">No completed tasks yet.</div>`;
    }
    return `<ol class="history">${history.slice(0, 6).map((task) => `
        <li>
            <strong>${escapeHTML(task.action)} #${task.id}</strong>
            <span>${escapeHTML(task.state)}${task.transferState ? ` / ${escapeHTML(task.transferState)}` : ''}</span>
        </li>
    `).join('')}</ol>`;
}

function bindEvents() {
    document.querySelectorAll('[data-mode]').forEach((button) => {
        button.addEventListener('click', () => {
            state.mode = button.dataset.mode;
            render();
        });
    });
    document.querySelector('#refresh')?.addEventListener('click', refreshStatus);
    document.querySelector('#choose-files')?.addEventListener('click', chooseFiles);
    document.querySelector('#choose-folder')?.addEventListener('click', chooseFolder);
    document.querySelector('#clear-share')?.addEventListener('click', () => {
        state.sharePaths = [];
        render();
    });
    document.querySelector('#start-share')?.addEventListener('click', startShare);
    document.querySelector('#choose-receive')?.addEventListener('click', chooseReceiveDirectory);
    document.querySelector('#start-receive')?.addEventListener('click', startReceive);
    document.querySelector('#save-settings')?.addEventListener('click', saveSettings);
    document.querySelector('#stop-current')?.addEventListener('click', stopCurrent);
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
        state.status = await Share(state.sharePaths);
        render();
    });
}

async function startReceive() {
    await run(async () => {
        const input = document.querySelector('#receive-dir');
        state.receiveDir = input?.value || state.receiveDir;
        state.status = await Receive(state.receiveDir);
        render();
    });
}

async function saveSettings() {
    await run(async () => {
        const input = document.querySelector('#receive-dir');
        const browser = document.querySelector('#browser-open');
        const settings = {
            ...(state.settings || {}),
            output: input?.value || '',
            browser: Boolean(browser?.checked),
        };
        state.settings = await SaveSettings(settings);
        state.receiveDir = state.settings.output;
        render();
    });
}

async function stopCurrent() {
    await run(async () => {
        await StopCurrent();
        await refreshStatus();
    });
}

async function refreshStatus() {
    await run(async () => {
        state.status = await AgentStatus();
        render();
    });
}

async function loadSettings() {
    await run(async () => {
        state.settings = await ReadSettings();
        state.receiveDir = state.settings.output || '';
        state.status = await AgentStatus();
        render();
    });
}

async function run(fn) {
    state.error = '';
    try {
        await fn();
    } catch (error) {
        state.error = error?.message || String(error);
        render();
    }
}

function addSharePaths(paths) {
    const next = new Set(state.sharePaths);
    paths.filter(Boolean).forEach((path) => next.add(path));
    state.sharePaths = [...next];
    render();
}

function shortName(path) {
    return String(path || '').split(/[\\/]/).filter(Boolean).pop() || path || '';
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

render();
loadSettings();
setInterval(refreshStatus, 4000);
