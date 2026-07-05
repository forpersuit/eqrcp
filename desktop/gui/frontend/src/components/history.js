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

export function refreshIcon() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
        <path d="M23 4v6h-6"></path>
        <path d="M1 20v-6h6"></path>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
    </svg>`;
}

export function searchIcon() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    </svg>`;
}

export function clearIcon() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        <line x1="10" y1="11" x2="10" y2="17"></line>
        <line x1="14" y1="11" x2="14" y2="17"></line>
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

export function highlightText(text, query) {
    if (!text || !query || !query.trim()) {
        return escapeHTML(text);
    }
    const escapedText = escapeHTML(text);
    const q = query.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(${q})`, 'gi');
    return escapedText.replace(regex, '<mark class="search-highlight" style="background: rgba(253, 224, 71, 0.35); color: var(--text-primary); padding: 0 2px; border-radius: 2px; font-weight: 700;">$1</mark>');
}

// ---- 主要渲染逻辑 ----
function renderSingleHistoryFileRow(file) {
    const name = shortName(file);
    const openFileTooltip = t('open_file_title', { file: name });
    return `
        <div class="history-file-row">
            <div class="history-filename-wrapper">
                <span class="file-icon-mini">📄</span>
                <span class="history-filename" title="${escapeAttr(file)}">${highlightText(name, searchQuery)}</span>
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
                            📱 ${highlightText(clientName, searchQuery)}
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
                        📱 ${highlightText(unclaimedLabel, searchQuery)}
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

export let searchQuery = '';
export let showSearchInput = false;
export let showSearchDropdown = false;
export let activeFocusTaskId = null;

export function updateActiveFocusTaskId(id) {
    activeFocusTaskId = id;
}

export function toggleSearchDropdown(show) {
    showSearchDropdown = show;
}

export function toggleSearchInput() {
    showSearchInput = !showSearchInput;
    if (!showSearchInput) {
        searchQuery = '';
        showSearchDropdown = false;
    }
}

export function updateSearchQuery(val) {
    searchQuery = val;
}

export function getMatchResults(history, query) {
    if (!query || !query.trim()) return [];
    const q = query.trim().toLowerCase();
    const results = [];
    
    history.forEach(task => {
        const actionText = task.action === 'send' ? t('share') : (task.action === 'receive' ? t('receive') : (task.action === 'chat' ? t('chat') : task.action));
        const title = `${actionText} #${task.id}`;
        
        // 1. 匹配任务 ID 或动作标题
        if (title.toLowerCase().includes(q)) {
            results.push({
                type: 'task',
                text: title,
                taskId: task.id,
                detail: `Task #${task.id}`
            });
        }
        
        // 2. 匹配设备名称
        if (task.clientStates) {
            Object.values(task.clientStates).forEach(client => {
                const clientName = client.deviceName || client.clientID || '';
                if (clientName.toLowerCase().includes(q)) {
                    results.push({
                        type: 'device',
                        text: clientName,
                        taskId: task.id,
                        detail: `${t('device') || 'Device'} - ${title}`
                    });
                }
            });
        }
        
        // 3. 匹配文件名
        const files = task.action === 'receive' ? (task.savedFiles || []) : (task.paths || []);
        files.forEach(file => {
            const name = shortName(file);
            if (name.toLowerCase().includes(q) || file.toLowerCase().includes(q)) {
                results.push({
                    type: 'file',
                    text: name,
                    taskId: task.id,
                    detail: file
                });
            }
        });
    });
    
    // 去重辅助逻辑：如果在同一个 task 下有多个同类型同标题的匹配结果，可以适当保留，但这里限制最多展示 15 条
    return results.slice(0, 15);
}

export function renderHistory(history) {
    if (!history.length) {
        return `<div class="empty-state">${t('no_tasks')}</div>`;
    }
    return `<ol class="history">${history.slice(0, 8).map((task) => {
        const taskFolder = getTaskFolder(task);
        const actionText = task.action === 'send' ? t('share') : (task.action === 'receive' ? t('receive') : (task.action === 'chat' ? t('chat') : titleCase(task.action)));
        const displayTitle = `${actionText} #${task.id}`;
        const isFocused = task.id === activeFocusTaskId;
        return `
        <li id="history-item-${task.id}" class="${isFocused ? 'visual-focus-highlight' : ''}" style="transition: all 0.22s ease-in-out;">
            <div class="history-item-left">
                <div class="history-title-row">
                    <strong class="history-title">${highlightText(displayTitle, searchQuery)}</strong>
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
    const searchActive = showSearchInput;
    const matchResults = getMatchResults(history, searchQuery);

    let dropdownHtml = '';
    if (showSearchDropdown && searchQuery.trim() && matchResults.length > 0) {
        dropdownHtml = `
            <div class="history-search-dropdown">
                ${matchResults.map(item => `
                    <div class="search-dropdown-item" data-target-id="${item.taskId}" style="display: flex; align-items: center; gap: 10px; padding: 8px 12px; cursor: pointer; text-align: left;">
                        <span class="dropdown-item-icon">${item.type === 'file' ? '📄' : (item.type === 'device' ? '📱' : 'ℹ️')}</span>
                        <div class="dropdown-item-content" style="display: flex; flex-direction: column; min-width: 0; flex: 1;">
                            <div class="dropdown-item-title" style="font-size: 13px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                ${highlightText(item.text, searchQuery)}
                            </div>
                            <div class="dropdown-item-detail" style="font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px;">
                                ${escapeHTML(item.detail)}
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    return `
        <aside class="side">
            <div class="panel" style="position: relative;">
                <div class="panel-head" style="position: relative; display: flex; align-items: center; justify-content: space-between; min-height: 32px; width: 100%; box-sizing: border-box;">
                    <h2 class="panel-title" style="transition: opacity 0.2s ease, transform 0.2s ease, max-width 0.2s ease; margin: 0; font-size: 15px; font-weight: 700; white-space: nowrap; ${searchActive ? 'opacity: 0; max-width: 0px; transform: translateX(-10px); pointer-events: none;' : 'opacity: 1; max-width: 150px; transform: translateX(0);'}">${t('recent_history')}</h2>
                    
                    <div class="panel-actions-wrapper" style="display: flex; gap: 6px; align-items: center; justify-content: flex-end; flex: 1; transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); min-width: 0; margin-left: 10px;">
                        <button class="ghost icon-btn" id="refresh" title="${escapeAttr(t('refresh'))}" style="min-height: 28px; width: ${searchActive ? '0px' : '28px'}; height: 28px; padding: 0; display: flex; align-items: center; justify-content: center; border-radius: 4px; border: none; background: transparent; transition: opacity 0.2s ease, width 0.2s ease; ${searchActive ? 'opacity: 0; pointer-events: none;' : 'opacity: 1;'}">
                            ${refreshIcon()}
                        </button>
                        
                        <div class="search-input-box" style="display: flex; align-items: center; justify-content: flex-end; transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); height: 28px; border-radius: 4px; overflow: hidden; position: relative; ${searchActive ? 'flex: 1; width: 100%; background: var(--bg);' : 'width: 28px; background: transparent;'}">
                            <input type="text" id="history-search-input" value="${escapeAttr(searchQuery)}" placeholder="${escapeAttr(t('search_history_placeholder'))}" style="width: 100%; height: 28px; padding: 4px 32px 4px 8px; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--text-primary); font-size: 12px; box-sizing: border-box; outline: none; transition: opacity 0.15s ease, width 0.2s ease; ${searchActive ? 'opacity: 1; pointer-events: auto; width: 100%;' : 'opacity: 0; pointer-events: none; width: 0px;'}" />
                            <button class="ghost icon-btn" id="toggle-search" title="${escapeAttr(t('search'))}" style="position: absolute; right: 0; top: 0; min-height: 28px; width: 28px; height: 28px; padding: 0; display: flex; align-items: center; justify-content: center; border-radius: 4px; border: none; z-index: 6; transition: background-color 0.2s ease, color 0.2s ease; ${searchActive ? 'background: var(--accent-hover); color: var(--accent-contrast);' : 'background: transparent; color: inherit;'}">
                                ${searchIcon()}
                            </button>
                        </div>
                        
                        <button class="ghost icon-btn" id="clear-history" ${history.length ? '' : 'disabled'} title="${escapeAttr(t('clear'))}" style="min-height: 28px; width: ${searchActive ? '0px' : '28px'}; height: 28px; padding: 0; display: flex; align-items: center; justify-content: center; border-radius: 4px; border: none; background: transparent; transition: opacity 0.2s ease, width 0.2s ease; ${searchActive ? 'opacity: 0; pointer-events: none;' : 'opacity: 1;'}">
                            ${clearIcon()}
                        </button>
                    </div>
                </div>
                
                ${dropdownHtml}
                
                <div class="history-list-wrapper" style="flex: 1; min-height: 0; display: flex; flex-direction: column; width: 100%; overflow: hidden;">
                    ${renderHistory(history)}
                </div>
            </div>
        </aside>
    `;
}
