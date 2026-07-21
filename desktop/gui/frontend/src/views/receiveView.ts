import { AppState } from '../state';
import { t } from '../i18n';
import { escapeHTML, escapeAttr } from '../utils/domUtils';

function shortName(path?: string): string {
    return String(path || '').split(/[\\/]/).filter(Boolean).pop() || path || '';
}

function getTranslatedState(s?: string): string {
    if (!s) return '';
    const key = `state_${s.toLowerCase()}`;
    return t(key) || s;
}

export interface ReceiveViewHelpers {
    activeReceiveTask: () => any;
    receiveIllustrationURL: string;
    qrImageURL: (pageUrl: string) => string;
    qrIcon: () => string;
    openFolderIcon: () => string;
    openFileIcon: () => string;
    renderSwitch: (id: string, checked?: boolean, disabled?: boolean) => string;
    qrExpandedManual: boolean | null;
}

export function renderReceiveDeviceProgressHtml(task: any, state: AppState, helpers: { openFolderIcon: () => string; openFileIcon: () => string }): string {
    let deviceProgressHtml = '';
    const clients = task.clientStates ? Object.values(task.clientStates) : [];
    const recvDir = state.receiveDir || state.settings?.output || '';
    const headerHtml = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <strong style="font-size: 12px; font-weight: 700; color: var(--text-secondary); margin: 0;">${t('devices_progress') || '设备传输进度'}</strong>
            ${recvDir ? `
                <button class="icon-button-mini path-link" data-open-path="${escapeAttr(recvDir)}" title="${escapeAttr(t('open_folder_title') || '打开接收文件夹')}" style="padding: 4px; display: inline-flex; align-items: center; justify-content: center; height: 22px; width: 22px; min-height: unset; margin: 0;">
                    ${helpers.openFolderIcon()}
                </button>
            ` : ''}
        </div>
    `;
    if (clients.length > 0) {
        state.deviceFilesExpanded = state.deviceFilesExpanded || {};

        const listItems = clients.map((clientObj: any) => {
            const client = clientObj;
            const devName = client.deviceName || t('device') || 'Device';
            const clientID = client.clientID || '';
            let displayName = devName;
            if (!displayName.includes('(') && clientID) {
                const shortId = clientID.length > 4 ? clientID.substring(clientID.length - 4) : clientID;
                displayName = `${displayName} (${shortId})`;
            }
            const percent = client.percent || 0;
            const currentFile = client.current || '';
            const formatSize = (bytes: number) => {
                if (!bytes) return '0 B';
                const k = 1024;
                const sizes = ['B', 'KB', 'MB', 'GB'];
                const i = Math.floor(Math.log(bytes) / Math.log(k));
                return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
            };

            const totalFilesCount = client.files ? client.files.length : 0;
            const completedFilesCount = client.files ? client.files.filter((f: any) => f.state === 'completed').length : 0;
            let statusCountText = '';
            if (totalFilesCount > 0) {
                statusCountText = ` (${completedFilesCount}/${totalFilesCount})`;
            } else {
                const savedLen = (client.savedFiles || []).length;
                if (client.state === 'transferring' && currentFile) {
                    statusCountText = ` (${savedLen}/${savedLen + 1})`;
                } else if (savedLen > 0) {
                    statusCountText = ` (${savedLen}/${savedLen})`;
                }
            }
            displayName = `${displayName}${statusCountText}`;

            let filesHtml = '';
            const files = client.files || [];
            if (files.length > 0) {
                const mappedFiles = files.map((file: any, idx: number) => {
                    file._naturalIndex = idx;
                    return file;
                });
                const sortedFiles = [...mappedFiles].sort((a: any, b: any) => {
                    const statePriority: Record<string, number> = { transferring: 1, waiting: 2, completed: 3, failed: 4 };
                    const pA = statePriority[a.state] || 5;
                    const pB = statePriority[b.state] || 5;
                    if (pA !== pB) return pA - pB;
                    return b._naturalIndex - a._naturalIndex;
                });
                filesHtml = sortedFiles.map((file: any, idx: number) => {
                    const name = file.name || 'File';
                    const percent = file.percent || 0;
                    const stateText = file.state || 'waiting';
                    const path = file.path || '';
                    const bytesDone = formatSize(file.bytesDone);
                    const bytesTotal = formatSize(file.bytesTotal);
                    const sizeProgressText = file.bytesTotal > 0 ? `${bytesDone} / ${bytesTotal}` : '';

                    let progressRightStr = sizeProgressText;
                    let bgStyle = 'background: rgba(0,0,0,0.02); border: 1px solid var(--line);';
                    let namePrefix = '📄';

                    if (stateText === 'completed') {
                        namePrefix = '✓';
                        progressRightStr = sizeProgressText || t('completed') || 'Completed';
                        bgStyle = 'background: rgba(15, 118, 110, 0.02); border: 1px solid rgba(15, 118, 110, 0.1);';
                    } else if (stateText === 'transferring') {
                        namePrefix = '⟳';
                        progressRightStr = sizeProgressText || `${percent}%`;
                        bgStyle = 'background: rgba(15, 118, 110, 0.06); border: 1px solid rgba(15, 118, 110, 0.2);';
                    } else if (stateText === 'failed') {
                        namePrefix = '✕';
                        progressRightStr = t('failed') || 'Failed';
                        bgStyle = 'background: rgba(180,35,24,0.03); border: 1px solid rgba(180,35,24,0.15);';
                    } else {
                        namePrefix = '⌛';
                        progressRightStr = sizeProgressText || t('waiting') || 'Waiting';
                        bgStyle = 'background: rgba(0,0,0,0.01); border: 1px solid var(--line); opacity: 0.7;';
                    }

                    const openFileTooltip = t('open_file_title', { file: name });

                    return `
                        <div id="receive-file-row-${escapeAttr(clientID)}-${idx}" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; border-radius: 6px; margin-top: 4px; width: 100%; min-width: 0; box-sizing: border-box; gap: 8px; ${bgStyle}">
                            <span id="receive-file-name-${escapeAttr(clientID)}-${idx}" style="font-size: 11px; font-weight: 700; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; text-align: left; min-width: 0;" title="${escapeAttr(path || name)}">${namePrefix} ${escapeHTML(name)}</span>
                            <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0; white-space: nowrap;">
                                <span id="receive-file-progress-${escapeAttr(clientID)}-${idx}" style="font-size: 10px; color: var(--text-secondary); font-weight: 600;">${escapeHTML(progressRightStr)}</span>
                                <div id="receive-file-action-container-${escapeAttr(clientID)}-${idx}" style="display: flex; gap: 4px; align-items: center; margin-left: 2px;">
                                    ${stateText === 'completed' && path ? `
                                        <button class="icon-button-mini open-file-action" data-open-file="${escapeAttr(path)}" title="${escapeAttr(openFileTooltip)}" style="padding: 2px; min-height: unset; height: 18px; width: 18px;">
                                            ${helpers.openFileIcon()}
                                        </button>
                                    ` : ''}
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            } else {
                const fallbackList: any[] = [];
                if (client.state === 'transferring' && currentFile) {
                    fallbackList.push({
                        name: shortName(currentFile),
                        path: currentFile,
                        state: 'transferring',
                        percent,
                        bytesDone: client.bytesDone,
                        bytesTotal: client.bytesTotal,
                    });
                }
                const oldSaved = client.savedFiles || [];
                const revSaved = [...oldSaved].reverse();
                revSaved.forEach((file: string) => {
                    fallbackList.push({
                        name: shortName(file),
                        path: file,
                        state: 'completed',
                        percent: 100,
                    });
                });

                const mappedFallback = fallbackList.map((item: any, idx: number) => {
                    item._naturalIndex = idx;
                    return item;
                });
                const sortedFallback = [...mappedFallback].sort((a: any, b: any) => {
                    const statePriority: Record<string, number> = { transferring: 1, waiting: 2, completed: 3, failed: 4 };
                    const pA = statePriority[a.state] || 5;
                    const pB = statePriority[b.state] || 5;
                    if (pA !== pB) return pA - pB;
                    return b._naturalIndex - a._naturalIndex;
                });
                filesHtml = sortedFallback.map((file: any, idx: number) => {
                    const name = file.name || 'File';
                    const percent = file.percent || 0;
                    const stateText = file.state || 'waiting';
                    const path = file.path || '';
                    const bytesDone = formatSize(file.bytesDone);
                    const bytesTotal = formatSize(file.bytesTotal);
                    const sizeProgressText = file.bytesTotal > 0 ? `${bytesDone} / ${bytesTotal}` : '';

                    let progressRightStr = sizeProgressText;
                    let bgStyle = 'background: rgba(0,0,0,0.02); border: 1px solid var(--line);';
                    let namePrefix = '📄';

                    if (stateText === 'completed') {
                        namePrefix = '✓';
                        progressRightStr = sizeProgressText || t('completed') || 'Completed';
                        bgStyle = 'background: rgba(15, 118, 110, 0.02); border: 1px solid rgba(15, 118, 110, 0.1);';
                    } else if (stateText === 'transferring') {
                        namePrefix = '⟳';
                        progressRightStr = sizeProgressText || `${percent}%`;
                        bgStyle = 'background: rgba(15, 118, 110, 0.06); border: 1px solid rgba(15, 118, 110, 0.2);';
                    } else if (stateText === 'failed') {
                        namePrefix = '✕';
                        progressRightStr = t('failed') || 'Failed';
                        bgStyle = 'background: rgba(180,35,24,0.03); border: 1px solid rgba(180,35,24,0.15);';
                    } else {
                        namePrefix = '⌛';
                        progressRightStr = sizeProgressText || t('waiting') || 'Waiting';
                        bgStyle = 'background: rgba(0,0,0,0.01); border: 1px solid var(--line); opacity: 0.7;';
                    }

                    const openFileTooltip = t('open_file_title', { file: name });

                    return `
                        <div id="receive-file-row-${escapeAttr(clientID)}-${idx}" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; border-radius: 6px; margin-top: 4px; width: 100%; min-width: 0; box-sizing: border-box; gap: 8px; ${bgStyle}">
                            <span id="receive-file-name-${escapeAttr(clientID)}-${idx}" style="font-size: 11px; font-weight: 700; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; text-align: left; min-width: 0;" title="${escapeAttr(path || name)}">${namePrefix} ${escapeHTML(name)}</span>
                            <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0; white-space: nowrap;">
                                <span id="receive-file-progress-${escapeAttr(clientID)}-${idx}" style="font-size: 10px; color: var(--text-secondary); font-weight: 600;">${escapeHTML(progressRightStr)}</span>
                                <div id="receive-file-action-container-${escapeAttr(clientID)}-${idx}" style="display: flex; gap: 4px; align-items: center; margin-left: 2px;">
                                    ${stateText === 'completed' && path ? `
                                        <button class="icon-button-mini open-file-action" data-open-file="${escapeAttr(path)}" title="${escapeAttr(openFileTooltip)}" style="padding: 2px; min-height: unset; height: 18px; width: 18px;">
                                            ${helpers.openFileIcon()}
                                        </button>
                                    ` : ''}
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            }

            let stateBadgeHtml = '';
            if (client.state === 'completed') {
                stateBadgeHtml = `<span style="display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 50%; background: var(--accent-light); border: 1px solid var(--accent-border); color: var(--accent); font-size: 9px; font-weight: 900;" title="${escapeAttr(t('completed') || 'Completed')}">✓</span>`;
            } else if (client.state === 'failed') {
                stateBadgeHtml = `<span style="display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 50%; background: rgba(180,35,24,0.08); border: 1px solid rgba(180,35,24,0.2); color: var(--danger); font-size: 9px; font-weight: 900;" title="${escapeAttr(client.message || t('failed') || 'Failed')}">✕</span>`;
            } else if (client.state === 'waiting') {
                stateBadgeHtml = `<span style="display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 50%; background: rgba(0,0,0,0.04); border: 1px solid var(--line); color: var(--text-secondary); font-size: 8px; font-weight: 900;" title="${escapeAttr(t('waiting') || 'Waiting')}">⌛</span>`;
            } else {
                stateBadgeHtml = `<span style="color: var(--accent-strong); font-size: 11px; font-weight: 800;">${percent}%</span>`;
            }

            const isFilesExpanded = Boolean(state.deviceFilesExpanded?.[clientID]);
            const arrowSvg = `
                <svg id="receive-client-arrow-${escapeAttr(clientID)}" class="chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="width: 10px; height: 10px; color: var(--text-secondary); margin-right: 6px; transition: transform 0.2s ease-in-out; transform: rotate(${isFilesExpanded ? '90deg' : '0deg'}); display: inline-block;">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            `;

            return `
                <li id="receive-client-li-${escapeAttr(clientID)}" data-expanded="${isFilesExpanded}" style="padding: 8px 10px; background: var(--bg-hover); border-radius: 6px; margin-bottom: 6px; box-sizing: border-box; width: 100%; overflow: hidden; border: 1.2px solid var(--line); list-style: none;">
                    <div class="device-header-toggle" data-client-id="${escapeAttr(clientID)}" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none; min-width: 0;">
                        <span id="receive-client-name-${escapeAttr(clientID)}" style="color: var(--text-primary); font-size: 12px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left; flex: 1; display: flex; align-items: center; min-width: 0;" title="${escapeHTML(devName)}${clientID ? ' (ID: ' + escapeHTML(clientID) + ')' : ''}">
                            ${arrowSvg}<span id="receive-client-name-text-${escapeAttr(clientID)}" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;">${escapeHTML(displayName)}</span>
                        </span>
                        <div id="receive-client-status-badge-${escapeAttr(clientID)}" style="display: flex; align-items: center; gap: 6px; white-space: nowrap; flex-shrink: 0;">
                            <span style="font-size: 10px; color: var(--text-secondary); font-weight: 600;">${getTranslatedState(client.state || 'waiting')}</span>
                            ${stateBadgeHtml}
                        </div>
                    </div>
                    ${isFilesExpanded ? `
                    <div style="margin-top: 6px; display: flex; flex-direction: column; gap: 2px; box-sizing: border-box; width: 100%; min-width: 0; overflow: hidden;">
                        ${filesHtml}
                    </div>
                    ` : ''}
                </li>
            `;
        }).join('');

        const scrollStyle = 'max-height: 320px; overflow-y: auto; overflow-x: hidden; border: 1.2px solid var(--line); padding: 8px; border-radius: 8px; box-sizing: border-box;';

        deviceProgressHtml = `
            <div class="devices-progress-section" style="margin: 6px 0 14px 0; text-align: left; box-sizing: border-box; width: 100%;">
                ${headerHtml}
                <div class="devices-scroll-container" style="${scrollStyle}">
                    <ul style="list-style: none; padding: 0; margin: 0; width: 100%; overflow: hidden;">${listItems}</ul>
                </div>
            </div>
        `;
    } else {
        deviceProgressHtml = `
            <div class="devices-progress-section" style="margin: 6px 0 14px 0; text-align: left; box-sizing: border-box; width: 100%;">
                ${headerHtml}
                <div style="border: 1px dashed var(--line); border-radius: 6px; padding: 12px; text-align: center; color: var(--text-muted); font-size: 12px; font-weight: 500; box-sizing: border-box; width: 100%;">
                    ${t('no_devices_upload')}
                </div>
            </div>
        `;
    }
    return deviceProgressHtml;
}

export function renderReceiveTransfer(task: any, state: AppState, helpers: ReceiveViewHelpers): string {
    const qrImage = helpers.qrImageURL(task.pageUrl);
    const files = task.savedFiles || [];

    const isSharedOrReceived = task.transferState !== 'waiting' && (task.transferState === 'transferring' || task.transferTarget || task.bytesDone > 0 || files.length > 0);
    const shouldCollapse = isSharedOrReceived;
    const isQRExpanded = helpers.qrExpandedManual !== null ? helpers.qrExpandedManual : !shouldCollapse;
    const collapseText = isQRExpanded ? t('hide_chat_qr') || '折叠二维码' : t('show_chat_qr') || '显示二维码';

    const isPaid = state.status?.isPaid;
    const usedReceiveTransfers = state.status?.usedReceiveTransfers || 0;
    const remaining = Math.max(0, 5 - usedReceiveTransfers);

    const countdownHtml = (!isPaid && remaining > 0) ? `
        <div class="quota-countdown" style="font-size: 11px; color: var(--danger); font-weight: 800; border: 1px solid var(--danger); padding: 4px 8px; border-radius: 6px; background: rgba(180, 35, 24, 0.05); text-transform: uppercase; letter-spacing: 0.05em; display: inline-block; white-space: nowrap; margin-top: 6px;">
            free ulimited: ${remaining}
        </div>
    ` : '';

    return `
        <div class="transfer-stage">
            <div class="transfer-head">
                <div>
                    <div class="eyebrow">${t('receive_active')}</div>
                    <h2>${escapeHTML(getTranslatedState(task.transferState || task.state || 'waiting'))}</h2>
                    ${countdownHtml}
                </div>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <button class="danger inline stop-current-action">${t('stop')}</button>
                    <button class="side-icon-button toggle-qr-expand-action" title="${escapeAttr(collapseText)}" aria-label="${escapeAttr(collapseText)}">
                        ${helpers.qrIcon()}
                    </button>
                </div>
            </div>

            <div class="transfer-meta-row" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: -6px; padding-bottom: 8px; border-bottom: 1.2px solid var(--line); box-sizing: border-box; width: 100%;">
                <div class="transfer-devices-badge" style="font-size: 13px; font-weight: 700; color: var(--text-secondary); display: flex; align-items: center; gap: 4px;">
                    👥 ${t('devices_count') || '设备数'}: <span id="current-devices-count" style="color: var(--accent-strong); font-weight: 800;">${task.clientStates ? Object.keys(task.clientStates).length : 0}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px; position: relative;">
                    <span class="has-tooltip has-tooltip-bottom-left" data-tooltip="${escapeAttr(t('auto_stop_tooltip'))}" style="font-size: 12px; font-weight: 600; color: var(--text-secondary); border-bottom: 1px dashed var(--text-muted); padding-bottom: 1px; cursor: help;">
                        ${t('auto_stop_label')}
                    </span>
                    ${helpers.renderSwitch('auto-stop-switch', task.transferAutoStop)}
                </div>
            </div>
            
            ${isQRExpanded && qrImage ? `
                <div class="qr-hero">
                    <img src="${escapeAttr(qrImage)}" alt="Transfer QR code" />
                    <button class="ghost open-qr" data-open-url="${escapeAttr(task.pageUrl)}">${t('open_in_browser')}</button>
                </div>
            ` : (isQRExpanded ? `<div class="empty-state transfer-empty" style="margin-top: 12px;">${t('waiting_qr')}</div>` : '')}
            
            <div id="receive-devices-progress-wrapper">${renderReceiveDeviceProgressHtml(task, state, helpers)}</div>

            ${task.error ? `<div class="notice error compact">${escapeHTML(task.error)}</div>` : ''}
        </div>
    `;
}

export function renderReceiveView(state: AppState, helpers: ReceiveViewHelpers): string {
    const activeTask = helpers.activeReceiveTask();
    if (activeTask) {
        return renderReceiveTransfer(activeTask, state, helpers);
    }
    const output = state.receiveDir || state.settings?.output || '';
    return `
        <div class="receive-illustration-wrapper">
            <img src="${helpers.receiveIllustrationURL}" alt="Receive Onboarding" style="pointer-events: none; user-select: none; opacity: 0.85;" />
        </div>
        <div class="receive-box">
            <label>${t('receive_dir')}</label>
            <div class="directory-row">
                <input id="receive-dir" value="${escapeAttr(output)}" placeholder="Choose a folder" />
                <button id="choose-receive">${t('choose')}</button>
            </div>
        </div>
        <div class="primary-row" style="width: 100%; display: flex; justify-content: center; gap: 12px; margin-top: 18px;">
            <button class="primary" id="start-receive" ${state.busy || !output.trim() ? 'disabled' : ''} style="width: 180px; flex: none;">${state.busy ? t('working') : t('start_receive')}</button>
            <button class="ghost" id="save-receive-dir" ${!output.trim() ? 'disabled' : ''} style="width: 180px; flex: none;">${t('save_dir')}</button>
        </div>
    `;
}
