import { AppState } from '../state';
import { t } from '../i18n';
import { escapeHTML, escapeAttr } from '../utils/domUtils';

export function openFileIcon(): string {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
        <polyline points="15 3 21 3 21 9"></polyline>
        <line x1="10" y1="14" x2="21" y2="3"></line>
    </svg>`;
}

export function openFolderIcon(): string {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
    </svg>`;
}

export function refreshIcon(): string {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
        <path d="M23 4v6h-6"></path>
        <path d="M1 20v-6h6"></path>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
    </svg>`;
}

export function searchIcon(): string {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    </svg>`;
}

export function clearIcon(): string {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        <line x1="10" y1="11" x2="10" y2="17"></line>
        <line x1="14" y1="11" x2="14" y2="17"></line>
    </svg>`;
}

export function restoreIcon(): string {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 13px; height: 13px;">
        <polyline points="23 4 23 10 17 10"></polyline>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
    </svg>`;
}

export function highlightText(text: string, query: string): string {
    if (!text || !query || !query.trim()) {
        return escapeHTML(text);
    }
    const escapedText = escapeHTML(text);
    const q = query.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(${q})`, 'gi');
    return escapedText.replace(regex, '<mark class="search-highlight" style="background: rgba(253, 224, 71, 0.35); color: var(--text-primary); padding: 0 2px; border-radius: 2px; font-weight: 700;">$1</mark>');
}

export interface HistoryTaskItem {
    id: number | string;
    action?: string;
    state?: string;
    transferState?: string;
    paths?: string[];
    savedFiles?: string[];
    clientStates?: Record<string, { deviceName?: string; clientID?: string; savedFiles?: string[] }>;
    [key: string]: unknown;
}

export interface MatchResultItem {
    type: 'task' | 'device' | 'file';
    text: string;
    taskId: number | string;
    filePath?: string;
    deviceName?: string;
    detail: string;
}

function getTranslatedState(s?: string): string {
    if (!s) return '';
    const key = `state_${s.toLowerCase()}`;
    return t(key) || s;
}

function getStatusIcon(task: HistoryTaskItem): string {
    const s = String(task.transferState || task.state || '').toLowerCase();
    if (s.includes('fail') || s.includes('error')) return '❌';
    if (s.includes('stop') || s.includes('cancel')) return '🛑';
    if (s.includes('replace')) return '🔄';
    if (s.includes('complete') || s.includes('done') || s === 'idle') return '✅';
    return 'ℹ️';
}

function getContainingFolder(path?: string): string {
    if (!path) return '';
    return path.replace(/[\\/][^\\/]*$/, '') || path;
}

function getTaskFolder(task: HistoryTaskItem): string {
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

function shortName(path?: string): string {
    return String(path || '').split(/[\\/]/).filter(Boolean).pop() || path || '';
}

function titleCase(str?: string): string {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function renderSingleHistoryFileRow(file: string, searchQuery: string): string {
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

export function renderHistoryFiles(task: HistoryTaskItem, searchQuery: string): string {
    let files: string[] = [];
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
        const claimedFiles = new Set<string>();
        clients.forEach((client) => {
            if (client.savedFiles) {
                client.savedFiles.forEach((file) => claimedFiles.add(file));
            }
        });
        const unclaimedFiles = files.filter((f) => !claimedFiles.has(f));

        let html = `<div class="history-device-groups" style="display: flex; flex-direction: column; gap: 8px; width: 100%;">`;

        clients.forEach((client) => {
            const rawName = client.deviceName || client.clientID || t('unknown_device') || 'Unknown Device';
            const clientName = rawName.replace(/\s*\([a-f0-9]{4}\)/i, '');
            const clientFiles = client.savedFiles || [];

            if (clientFiles.length > 0) {
                html += `
                    <div class="history-device-group" style="border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; background: var(--wash); display: flex; flex-direction: column; gap: 4px; box-sizing: border-box; width: 100%;">
                        <div class="history-device-header" style="font-size: 11px; font-weight: 700; color: var(--accent); display: flex; align-items: center; gap: 4px; border-bottom: 1px solid var(--line); padding-bottom: 4px; margin-bottom: 2px;">
                            📱 ${highlightText(clientName, searchQuery)}
                        </div>
                        <div class="history-files-list" style="display: flex; flex-direction: column; gap: 4px; width: 100%;">
                            ${clientFiles.map((file) => renderSingleHistoryFileRow(file, searchQuery)).join('')}
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
                        ${unclaimedFiles.map((file) => renderSingleHistoryFileRow(file, searchQuery)).join('')}
                    </div>
                </div>
            `;
        }

        html += `</div>`;
        return html;
    }

    return `<div class="history-files-list">
        ${files.map((file) => renderSingleHistoryFileRow(file, searchQuery)).join('')}
    </div>`;
}

export function renderHistory(history: HistoryTaskItem[], searchQuery: string): string {
    if (!history.length) {
        return `<div class="empty-state">${t('no_tasks')}</div>`;
    }
    return `<ol class="history">${history.slice(0, 8).map((task) => {
        const taskFolder = getTaskFolder(task);
        const actionText = (task.action === 'share' || task.action === 'send') ? t('share') : (task.action === 'receive' ? t('receive') : (task.action === 'chat' ? t('chat') : titleCase(task.action)));
        const displayTitle = `${actionText} #${task.id}`;
        return `
        <li id="history-item-${task.id}" style="transition: all 0.22s ease-in-out;">
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
                    ${(task.action === 'share' || task.action === 'send') ? `
                        <button class="icon-button-mini restore-share-action" data-task-id="${task.id}" title="${escapeAttr(t('restore_share'))}" style="margin-left: 8px;">
                            ${restoreIcon()}
                        </button>
                    ` : ''}
                </div>
            </div>
            <div class="history-item-right">
                ${renderHistoryFiles(task, searchQuery)}
            </div>
        </li>
        `;
    }).join('')}</ol>`;
}

export interface RenderSideParams {
    state: AppState;
    showSearchInput: boolean;
    showSearchDropdown: boolean;
    searchQuery: string;
    matchResults: MatchResultItem[];
}

export function renderSide({ state, showSearchInput, showSearchDropdown, searchQuery, matchResults }: RenderSideParams): string {
    if (state.mode === 'chat' || state.settings?.showHistory === false) {
        return '';
    }
    const history: HistoryTaskItem[] = state.status?.history || [];
    const searchActive = showSearchInput;
    const hasResults = showSearchDropdown && Boolean(searchQuery.trim()) && matchResults.length > 0;

    return `
        <aside class="side">
            <div class="panel ${searchActive ? 'search-active' : ''}" style="position: relative;">
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
                
                <div id="search-results-expand-zone" class="history-search-dropdown" style="${hasResults ? 'display: flex;' : 'display: none;'}">
                    ${hasResults ? matchResults.map((item) => `
                        <div class="search-dropdown-item" data-target-id="${item.taskId}" ${item.filePath ? `data-file-path="${escapeAttr(item.filePath)}"` : ''} ${item.deviceName ? `data-device-name="${escapeAttr(item.deviceName)}"` : ''}>
                            <span class="dropdown-item-icon">${item.type === 'file' ? '📄' : (item.type === 'device' ? '📱' : 'ℹ️')}</span>
                            <div class="dropdown-item-content">
                                <div class="dropdown-item-title">
                                    ${highlightText(item.text, searchQuery)}
                                </div>
                                <div class="dropdown-item-detail">
                                    ${escapeHTML(item.detail)}
                                </div>
                            </div>
                        </div>
                    `).join('') : ''}
                </div>
                
                <div class="history-list-wrapper" style="flex: 1; min-height: 0; display: flex; flex-direction: column; width: 100%; overflow: hidden;">
                    ${renderHistory(history, searchQuery)}
                </div>
            </div>
        </aside>
    `;
}
