import { GetLogTail, ExportDiagnosticsZip } from '../../wailsjs/go/main/App.js';
import { t } from '../i18n.js';
import { state } from '../state.js';

// ---- 日志查看器内部状态管理 (State-Template Separation) ----
export const logViewerState = {
    isOpen: false,
    lines: [],
    filter: 'ALL',        // 'ALL' | 'INFO' | 'WARN' | 'ERROR' | 'CLIENT' | 'SRV' | 'CHAT'
    searchKeyword: '',
    autoRefresh: false,
    autoRefreshTimer: null,
    isLoading: false,
};

// ---- 图标与辅助函数 ----
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeAttr(str) {
    return escapeHTML(str);
}

function refreshIconSvg() {
    return `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M23 4v6h-6"></path>
        <path d="M1 20v-6h6"></path>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
    </svg>`;
}

function copyIconSvg() {
    return `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>`;
}

function packageIconSvg() {
    return `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M16.5 9.4 7.55 4.24M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
        <polyline points="3.29 7 12 12 20.71 7"></polyline>
        <line x1="12" y1="22" x2="12" y2="12"></line>
    </svg>`;
}

function searchIconSvg() {
    return `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    </svg>`;
}

// ---- 控制器方法 (Controller Methods) ----

export async function openLogViewer(renderCallback) {
    logViewerState.isOpen = true;
    logViewerState.searchKeyword = '';
    logViewerState.filter = 'ALL';
    if (renderCallback) renderCallback();
    await refreshLogTail(renderCallback, true);
}

export function closeLogViewer(renderCallback) {
    if (logViewerState.autoRefreshTimer) {
        clearInterval(logViewerState.autoRefreshTimer);
        logViewerState.autoRefreshTimer = null;
    }
    logViewerState.autoRefresh = false;
    logViewerState.isOpen = false;
    if (renderCallback) renderCallback();
}

export async function refreshLogTail(renderCallback, forceScroll = false) {
    // 检查刷新前终端是否处于或接近底部（40px 容差）
    const terminalEl = document.getElementById('log-viewer-terminal');
    const wasNearBottom = terminalEl
        ? (terminalEl.scrollHeight - terminalEl.scrollTop - terminalEl.clientHeight <= 40)
        : true;

    try {
        logViewerState.isLoading = true;
        if (renderCallback) renderCallback();
        const lines = await GetLogTail(200);
        logViewerState.lines = Array.isArray(lines) ? lines : [];
    } catch (err) {
        console.error('Failed to get log tail:', err);
    } finally {
        logViewerState.isLoading = false;
        if (renderCallback) renderCallback();

        // 仅在显式强制（初次打开/手动刷新）或原先就在底部附近时，才自动吸附到底部
        // 若用户正在上翻查阅历史日志，则保持阅读位置，不强制拽回底部
        if (forceScroll || wasNearBottom) {
            setTimeout(() => {
                const terminal = document.getElementById('log-viewer-terminal');
                if (terminal) {
                    terminal.scrollTop = terminal.scrollHeight;
                }
            }, 50);
        }
    }
}

export function setLogFilter(filter, renderCallback) {
    logViewerState.filter = filter;
    if (renderCallback) renderCallback();
}

export function setLogSearch(keyword, renderCallback) {
    logViewerState.searchKeyword = keyword || '';
    if (renderCallback) renderCallback();
}

export function toggleAutoRefresh(enabled, renderCallback) {
    logViewerState.autoRefresh = Boolean(enabled);
    if (logViewerState.autoRefreshTimer) {
        clearInterval(logViewerState.autoRefreshTimer);
        logViewerState.autoRefreshTimer = null;
    }
    if (logViewerState.autoRefresh) {
        logViewerState.autoRefreshTimer = setInterval(() => {
            if (logViewerState.isOpen) {
                refreshLogTail(renderCallback, false);
            } else {
                clearInterval(logViewerState.autoRefreshTimer);
                logViewerState.autoRefreshTimer = null;
            }
        }, 3000);
    }
    if (renderCallback) renderCallback();
}

function fallbackCopyText(text, showToastCallback) {
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.top = '-9999px';
        textarea.style.left = '-9999px';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (successful) {
            if (showToastCallback) showToastCallback(t('logs_copied') || '日志已复制到剪贴板');
        } else {
            if (showToastCallback) showToastCallback((t('copy_failed_prefix') || '复制失败: ') + 'Clipboard unavailable');
        }
    } catch (err) {
        if (showToastCallback) showToastCallback((t('copy_failed_prefix') || '复制失败: ') + (err?.message || err));
    }
}

export function copyAllLogs(showToastCallback) {
    const lines = getFilteredLines();
    if (lines.length === 0) {
        if (showToastCallback) showToastCallback(t('logs_empty') || '暂无日志记录');
        return;
    }
    const content = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(content).then(() => {
            if (showToastCallback) showToastCallback(t('logs_copied') || '日志已复制到剪贴板');
        }).catch(() => {
            fallbackCopyText(content, showToastCallback);
        });
    } else {
        fallbackCopyText(content, showToastCallback);
    }
}

export async function exportDiagnostics(showToastCallback) {
    try {
        const exportedPath = await ExportDiagnosticsZip();
        if (exportedPath && showToastCallback) {
            showToastCallback((t('diagnostics_exported') || '诊断排查包已导出：') + exportedPath);
        }
    } catch (err) {
        if (showToastCallback) showToastCallback('Export failed: ' + (err?.message || err));
    }
}

// ---- 数据过滤逻辑 (Pure Function) ----
export function getFilteredLines() {
    const { lines, filter, searchKeyword } = logViewerState;
    if (!Array.isArray(lines)) return [];

    return lines.filter(line => {
        if (!line) return false;
        // 1. 级别与标签筛选
        if (filter !== 'ALL') {
            const tag = `[${filter}]`;
            // 若为级别筛选 (INFO/WARN/ERROR/DEBUG)，优先匹配行首结构化级别位，避免正文字面量误收
            if (['INFO', 'WARN', 'ERROR', 'DEBUG'].includes(filter)) {
                const levelMatch = line.match(/^\[?[^\]\n]+\]?\s*\[(INFO|WARN|ERROR|DEBUG)\]/);
                if (levelMatch) {
                    if (levelMatch[1] !== filter) {
                        return false;
                    }
                } else if (!line.includes(tag)) {
                    return false;
                }
            } else if (['CLIENT', 'SRV', 'CHAT'].includes(filter)) {
                // 来源标签匹配：紧随级别位
                const srcMatch = line.match(/^\[?[^\]\n]+\]?\s*\[[A-Z]+\]\s*\[(CLIENT|SRV|CHAT)\]/);
                if (srcMatch) {
                    if (srcMatch[1] !== filter) {
                        return false;
                    }
                } else if (!line.includes(tag)) {
                    return false;
                }
            } else if (!line.includes(tag)) {
                return false;
            }
        }
        // 2. 关键字搜索
        if (searchKeyword) {
            if (!line.toLowerCase().includes(searchKeyword.toLowerCase())) {
                return false;
            }
        }
        return true;
    });
}

// ---- 纯渲染模板函数 (Pure Render Functions: Data -> HTML) ----

function renderFormattedLogLine(line) {
    if (!line) return '';
    const safeLine = escapeHTML(line);

    // 标签正则替换为高亮色标
    const highlighted = safeLine
        .replace(/\[ERROR\]/g, '<span class="log-tag log-tag-error">[ERROR]</span>')
        .replace(/\[WARN\]/g, '<span class="log-tag log-tag-warn">[WARN]</span>')
        .replace(/\[INFO\]/g, '<span class="log-tag log-tag-info">[INFO]</span>')
        .replace(/\[DEBUG\]/g, '<span class="log-tag log-tag-debug">[DEBUG]</span>')
        .replace(/\[CLIENT\]/g, '<span class="log-tag log-tag-client">[CLIENT]</span>')
        .replace(/\[SRV\]/g, '<span class="log-tag log-tag-srv">[SRV]</span>')
        .replace(/\[CHAT\]/g, '<span class="log-tag log-tag-chat">[CHAT]</span>')
        .replace(/(\b\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}\b)/g, '<span class="log-time">$1</span>');

    return `<div class="log-line">${highlighted}</div>`;
}

export function renderLogViewerOverlay() {
    if (!logViewerState.isOpen) {
        return '';
    }

    const filteredLines = getFilteredLines();
    const totalLines = logViewerState.lines.length;
    const filter = logViewerState.filter;
    const logPath = state.appInfo?.logPath || 'desktop.log';

    const filters = [
        { key: 'ALL', label: t('log_filter_all') || '全部' },
        { key: 'INFO', label: 'INFO' },
        { key: 'WARN', label: 'WARN' },
        { key: 'ERROR', label: 'ERROR' },
        { key: 'CLIENT', label: 'CLIENT 📱' },
        { key: 'SRV', label: 'SRV 🌐' },
        { key: 'CHAT', label: 'CHAT 💬' },
    ];

    return `
        <div class="log-viewer-backdrop" id="log-viewer-backdrop" role="presentation">
            <section class="log-viewer-modal" role="dialog" aria-modal="true" aria-label="${escapeAttr(t('view_logs') || '运行日志')}">
                <!-- 头部栏 -->
                <div class="log-viewer-head">
                    <div class="log-viewer-title-group">
                        <span class="log-viewer-icon">📋</span>
                        <h2>${escapeHTML(t('view_logs') || '运行日志')}</h2>
                        <span class="log-viewer-badge">${filteredLines.length} / ${totalLines}</span>
                        ${logViewerState.autoRefresh ? '<span class="log-pulse-dot" title="3s 自动刷新中"></span>' : ''}
                    </div>
                    <button type="button" class="tool-button" id="close-log-viewer" title="${escapeAttr(t('close') || '关闭')}" aria-label="${escapeAttr(t('close') || '关闭')}">✕</button>
                </div>

                <!-- 工具栏：标签筛选 + 搜索框 + 操作按钮 -->
                <div class="log-viewer-toolbar">
                    <div class="log-filter-chips">
                        ${filters.map(f => `
                            <button type="button" class="log-filter-chip ${filter === f.key ? 'active' : ''}" data-filter="${escapeAttr(f.key)}">
                                ${escapeHTML(f.label)}
                            </button>
                        `).join('')}
                    </div>

                    <div class="log-search-box">
                        <span class="log-search-icon">${searchIconSvg()}</span>
                        <input type="text" id="log-viewer-search" placeholder="${escapeAttr(t('log_search_placeholder') || '搜索关键字...')}" value="${escapeAttr(logViewerState.searchKeyword)}" />
                    </div>

                    <div class="log-actions-cluster">
                        <label class="log-autorefresh-label" title="${escapeAttr(t('auto_refresh') || '自动刷新 (3s)')}">
                            <input type="checkbox" id="log-viewer-auto-refresh" ${logViewerState.autoRefresh ? 'checked' : ''} />
                            <span>${escapeHTML(t('auto_refresh') || '自动刷新')}</span>
                        </label>
                        <button type="button" class="ghost btn-log-action" id="btn-log-refresh" title="${escapeAttr(t('btn_retry') || '刷新')}">
                            ${refreshIconSvg()} <span>${escapeHTML(t('btn_retry') || '刷新')}</span>
                        </button>
                        <button type="button" class="secondary btn-log-action" id="btn-log-copy-all" title="${escapeAttr(t('btn_copy_logs') || '一键复制')}">
                            ${copyIconSvg()} <span>${escapeHTML(t('btn_copy_logs') || '复制')}</span>
                        </button>
                        <button type="button" class="primary btn-log-action" id="btn-log-export" title="${escapeAttr(t('btn_export_diagnostics') || '导出排查包')}">
                            ${packageIconSvg()} <span>${escapeHTML(t('btn_export_diagnostics') || '导出诊断包')}</span>
                        </button>
                    </div>
                </div>

                <!-- 终端日志区域 -->
                <div class="log-viewer-terminal" id="log-viewer-terminal">
                    ${filteredLines.length > 0 
                        ? filteredLines.map(renderFormattedLogLine).join('') 
                        : `<div class="log-empty-state">${escapeHTML(t('logs_empty') || '暂无日志记录')}</div>`
                    }
                </div>

                <!-- 底部状态栏 -->
                <div class="log-viewer-footer">
                    <span class="log-path-hint" title="${escapeAttr(logPath)}">📄 ${escapeHTML(logPath)}</span>
                    <span class="log-status-hint">${logViewerState.isLoading ? 'Loading...' : `${filteredLines.length} lines displayed`}</span>
                </div>
            </section>
        </div>
    `;
}
