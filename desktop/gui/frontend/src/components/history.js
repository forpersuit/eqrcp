import { state } from '../state.js';
import { t } from '../i18n.js';

// ---- 图标函数 ----
export function openFileIcon() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
        <polyline points="15 3 21 3 21 9"></polyline>
        <line x1="10" y1="14" x2="21" y2="3"></line>
    </svg>`;
}

export function openFolderIcon() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
    </svg>`;
}

// ---- 工具函数 ----
function escapeHTML(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeAttr(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getTranslatedState(s) {
    if (!s) return '';
    const key = `state_${s.toLowerCase()}`;
    return t(key) || s;
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

function shortName(path) {
    return String(path || '').split(/[\\/]/).filter(Boolean).pop() || path || '';
}

function titleCase(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// ---- 主要渲染逻辑 ----
function renderSingleHistoryFileRow(file) {
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
}

export function renderHistoryFiles(task) {
    let files = [];
    if (task.action === 'receive') {
        files = task.savedFiles || [];
    } else {
        files = task.paths || [];
    }

    if (files.length === 0) {
        return `<div class="history-empty-files">${t('no_files')}</div>`;
    }

    if (task.action === 'receive' && task.clientStates && Object.keys(task.clientStates).length > 0) {
        const clients = Object.values(task.clientStates);
        const claimedFiles = new Set();
        clients.forEach(client => {
            if (client.savedFiles) {
                client.savedFiles.forEach(file => claimedFiles.add(file));
            }
        });
        const unclaimedFiles = files.filter(f => !claimedFiles.has(f));

        let html = `<div class="history-device-groups" style="display: flex; flex-direction: column; gap: 8px; width: 100%;">`;

        clients.forEach(client => {
            const clientName = client.deviceName || client.clientID || t('unknown_device') || 'Unknown Device';
            const clientFiles = client.savedFiles || [];

            if (clientFiles.length > 0) {
                html += `
                    <div class="history-device-group" style="border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; background: var(--wash); display: flex; flex-direction: column; gap: 4px; box-sizing: border-box; width: 100%;">
                        <div class="history-device-header" style="font-size: 11px; font-weight: 700; color: var(--accent); display: flex; align-items: center; gap: 4px; border-bottom: 1px solid var(--line); padding-bottom: 4px; margin-bottom: 2px;">
                            📱 ${escapeHTML(clientName)}
                        </div>
                        <div class="history-files-list" style="display: flex; flex-direction: column; gap: 4px; width: 100%;">
                            ${clientFiles.map(file => renderSingleHistoryFileRow(file)).join('')}
                        </div>
                    </div>
                `;
            }
        });

        if (unclaimedFiles.length > 0) {
            const unclaimedLabel = t('unknown_device') || 'Unknown Device';
            html += `
                <div class="history-device-group" style="border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; background: var(--wash); display: flex; flex-direction: column; gap: 4px; box-sizing: border-box; width: 100%;">
                    <div class="history-device-header" style="font-size: 11px; font-weight: 700; color: var(--muted); display: flex; align-items: center; gap: 4px; border-bottom: 1px solid var(--line); padding-bottom: 4px; margin-bottom: 2px;">
                        📱 ${escapeHTML(unclaimedLabel)}
                    </div>
                    <div class="history-files-list" style="display: flex; flex-direction: column; gap: 4px; width: 100%;">
                        ${unclaimedFiles.map(file => renderSingleHistoryFileRow(file)).join('')}
                    </div>
                </div>
            `;
        }

        html += `</div>`;
        return html;
    }

    return `<div class="history-files-list">
        ${files.map((file) => renderSingleHistoryFileRow(file)).join('')}
    </div>`;
}

export function renderHistory(history) {
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

export function renderSide() {
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
