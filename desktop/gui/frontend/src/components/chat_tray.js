import { t } from '../i18n.js';

function escapeHTML(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
    return escapeHTML(str);
}

function formatSize(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

/**
 * Renders an unobtrusive, lightweight active transfers task tray for Chat mode.
 * Solves the desktop "silent black hole" issue during in-flight large file uploads.
 * 
 * @param {Object} task The active chat task record containing chatActiveTransfers.
 * @returns {string} Safe HTML string for the task tray or empty string if no transfers.
 */
export function renderChatTransfersTray(task) {
    if (!task) {
        return '';
    }
    const transfers = task.chatActiveTransfers || [];
    if (!transfers || transfers.length === 0) {
        return '';
    }

    return `
        <div class="chat-transfers-tray">
            <div class="chat-transfers-header">
                <span class="chat-transfers-title">
                    <span class="chat-transfers-indicator"></span>
                    ${t('active_transfers')}
                </span>
                <span class="chat-transfers-badge">${transfers.length}</span>
            </div>
            <div class="chat-transfers-list">
                ${transfers.map(tf => {
                    const pct = Math.min(100, Math.max(0, tf.percent || 0));
                    const fileName = tf.fileName || 'attachment';
                    const sender = tf.sender || t('anonymous');
                    const sizeStr = tf.size > 0 ? formatSize(tf.size) : '';
                    return `
                        <div class="chat-transfer-item" data-transfer-id="${escapeAttr(tf.id || '')}">
                            <div class="chat-transfer-row">
                                <span class="chat-transfer-name" title="${escapeAttr(fileName)}">${escapeHTML(fileName)}</span>
                                <span class="chat-transfer-percent">${pct}%</span>
                            </div>
                            <div class="chat-transfer-meta">
                                <span class="chat-transfer-sender">${escapeHTML(sender)}</span>
                                ${sizeStr ? `<span class="chat-transfer-size">${sizeStr}</span>` : ''}
                            </div>
                            <div class="chat-transfer-bar">
                                <div class="chat-transfer-bar-fill" style="width: ${pct}%;"></div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}
