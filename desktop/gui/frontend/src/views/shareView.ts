import { AppState, SharePathItem } from '../state';
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

export interface ShareViewHelpers {
    activeShareTask: () => any;
    shareIllustrationURL: string;
    qrImageURL: (pageUrl: string) => string;
    qrIcon: () => string;
    renderSwitch: (id: string, checked?: boolean, disabled?: boolean) => string;
    shareItemStatus: (task: any, path: string) => string;
    qrExpandedManual: boolean | null;
}

export function renderDeviceProgressHtml(task: any): string {
    let deviceProgressHtml = '';
    const clients = task.clientStates ? Object.values(task.clientStates) : [];
    if (clients.length > 0) {
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

            const formatSize = (bytes: number) => {
                if (!bytes) return '0 B';
                const k = 1024;
                const sizes = ['B', 'KB', 'MB', 'GB'];
                const i = Math.floor(Math.log(bytes) / Math.log(k));
                return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
            };

            const bytesDone = formatSize(client.bytesDone);
            const bytesTotal = formatSize(client.bytesTotal);
            const sizeProgressText = client.bytesTotal > 0 ? `(${bytesDone}/${bytesTotal})` : '';

            const showProgress = (((client.state === 'transferring' || client.state === 'waiting') && (client.bytesDone || 0) > 0) || client.state === 'completed') && client.bytesTotal > 0;
            const progressSectionHtml = showProgress ? `
                <div style="flex: 1; height: 6px; background: rgba(0,0,0,0.06); border-radius: 3px; overflow: hidden; position: relative; margin: 0 12px 0 0; min-width: 60px;">
                    <div style="width: ${percent}%; height: 100%; background: var(--accent); border-radius: 3px;"></div>
                </div>
            ` : `
                <div style="flex: 1; margin: 0 12px 0 0; border-bottom: 1.2px dashed var(--line); min-width: 60px;"></div>
            `;

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

            return `
                <li style="display: flex; flex-direction: column; padding: 8px 10px; background: var(--bg-hover); border-radius: 6px; margin-bottom: 4px; box-sizing: border-box; width: 100%; overflow: hidden; border: 1.2px solid var(--line); list-style: none; gap: 6px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                        <span style="color: var(--text-primary); font-size: 11px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left; flex: 1; min-width: 0;" title="${escapeHTML(devName)}${clientID ? ' (ID: ' + escapeHTML(clientID) + ')' : ''}">
                            ${escapeHTML(displayName)}${client.current ? ` <span style="color: var(--text-secondary); font-weight: 500; font-size: 11px; margin-left: 4px;">- ${escapeHTML(client.current)}</span>` : ''}
                        </span>
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                        ${progressSectionHtml}
                        <div style="display: flex; align-items: center; gap: 6px; white-space: nowrap; flex-shrink: 0;">
                            ${showProgress ? `<span style="font-size: 9px; color: var(--text-secondary); font-weight: 500;">${escapeHTML(sizeProgressText)}</span>` : ''}
                            ${stateBadgeHtml}
                        </div>
                    </div>
                </li>
            `;
        }).join('');

        const scrollStyle = 'max-height: 220px; overflow-y: auto; overflow-x: hidden; border: 1.2px solid var(--line); padding: 8px; border-radius: 8px; box-sizing: border-box;';

        deviceProgressHtml = `
            <div class="devices-progress-section" style="margin: 6px 0 14px 0; text-align: left; box-sizing: border-box; width: 100%;">
                <strong style="display: block; font-size: 12px; font-weight: 700; color: var(--text-secondary); margin-bottom: 8px;">${t('devices_progress') || '设备传输进度'}</strong>
                <div class="devices-scroll-container" style="${scrollStyle}">
                    <ul style="list-style: none; padding: 0; margin: 0; width: 100%; overflow: hidden;">${listItems}</ul>
                </div>
            </div>
        `;
    } else {
        deviceProgressHtml = `
            <div class="devices-progress-section" style="margin: 6px 0 14px 0; text-align: left; box-sizing: border-box; width: 100%;">
                <strong style="display: block; font-size: 12px; font-weight: 700; color: var(--text-secondary); margin-bottom: 8px;">${t('devices_progress') || '设备传输进度'}</strong>
                <div style="border: 1px dashed var(--line); border-radius: 6px; padding: 12px; text-align: center; color: var(--text-muted); font-size: 12px; font-weight: 500; box-sizing: border-box; width: 100%;">
                    ${t('no_devices_download')}
                </div>
            </div>
        `;
    }
    return deviceProgressHtml;
}

export function renderShareLockedPathsHtml(task: any, shareItemStatus: (task: any, path: string) => string): string {
    const paths: string[] = task.paths || [];
    return paths.map((path) => {
        return `
        <li>
            <div style="width: 100%; box-sizing: border-box; min-width: 0;">
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; width: 100%; min-width: 0;">
                    <div style="flex: 1; text-align: left; overflow: hidden; min-width: 0;">
                        <div class="filename-scroll-container">
                            <strong title="${escapeAttr(shortName(path))}">${escapeHTML(shortName(path))}</strong>
                        </div>
                        <span style="display: block; font-size: 11px; color: var(--text-secondary); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(path)}</span>
                    </div>
                    <div style="flex: 0 0 auto; text-align: right; min-width: 0; margin-left: 8px;">
                        <span class="item-status" style="font-size: 12px; font-weight: 600; color: var(--accent-strong); white-space: nowrap;">
                            ${escapeHTML(shareItemStatus(task, path))}
                        </span>
                    </div>
                </div>
            </div>
        </li>
        `;
    }).join('');
}

export function renderShareTransfer(task: any, helpers: ShareViewHelpers, state: AppState): string {
    const qrImage = helpers.qrImageURL(task.pageUrl);

    const isSharedOrReceived = task.transferState !== 'waiting' && (task.transferState === 'transferring' || task.transferTarget || task.bytesDone > 0);
    const shouldCollapse = isSharedOrReceived;
    const isQRExpanded = helpers.qrExpandedManual !== null ? helpers.qrExpandedManual : !shouldCollapse;
    const collapseText = isQRExpanded ? t('hide_chat_qr') || '折叠二维码' : t('show_chat_qr') || '显示二维码';

    const isPaid = state.status?.isPaid;
    const usedTransfers = state.status?.usedTransfers || 0;
    const remaining = Math.max(0, 5 - usedTransfers);

    const countdownHtml = (!isPaid && remaining > 0) ? `
        <div class="quota-countdown" style="font-size: 11px; color: var(--danger); font-weight: 800; border: 1px solid var(--danger); padding: 4px 8px; border-radius: 6px; background: rgba(180, 35, 24, 0.05); text-transform: uppercase; letter-spacing: 0.05em; display: inline-block; white-space: nowrap; margin-top: 6px;">
            free ulimited: ${remaining}
        </div>
    ` : '';

    return `
        <div class="transfer-stage">
            <div class="transfer-head">
                <div>
                    <div class="eyebrow">${t('share_active')}</div>
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
            
            <div id="share-qr-wrapper">
                ${isQRExpanded && qrImage ? `
                    <div class="qr-hero">
                        <img src="${escapeAttr(qrImage)}" alt="Transfer QR code" />
                        <button class="ghost open-qr" data-open-url="${escapeAttr(task.pageUrl)}">${t('open_in_browser')}</button>
                    </div>
                ` : (isQRExpanded ? `<div class="empty-state transfer-empty" style="margin-top: 12px;">${t('waiting_qr')}</div>` : '')}
            </div>
            
            <div id="devices-progress-wrapper">${renderDeviceProgressHtml(task)}</div>

            <div class="locked-list">
                <strong>${t('locked_list')}</strong>
                <ul class="path-list locked" id="share-locked-path-list">${renderShareLockedPathsHtml(task, helpers.shareItemStatus)}</ul>
            </div>
            ${task.error ? `<div class="notice error compact">${escapeHTML(task.error)}</div>` : ''}
        </div>
    `;
}

export function renderShareView(state: AppState, helpers: ShareViewHelpers): string {
    const activeTask = helpers.activeShareTask();
    if (activeTask) {
        return renderShareTransfer(activeTask, helpers, state);
    }
    const items = state.sharePaths.map((item: SharePathItem, index: number) => {
        const path = typeof item === 'string' ? item : item.path;
        const name = typeof item === 'string' ? shortName(item) : (item.name || shortName(item.path));
        const size = typeof item === 'string' ? '' : (item.size || '');
        return `
            <li>
                <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; padding-right: 12px; overflow: hidden;">
                    <strong style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: var(--text-primary); font-size: 13px; max-width: 280px;" title="${escapeHTML(name)}">${escapeHTML(name)}</strong>
                    <span class="file-size-badge" style="font-size: 12px; color: var(--text-secondary); margin-left: auto; margin-right: 8px; flex-shrink: 0; font-weight: 500;">${escapeHTML(size)}</span>
                </div>
                <button class="icon-button remove-path" data-path-index="${index}" title="${t('remove')}">x</button>
            </li>
        `;
    }).join('');

    const hasItems = state.sharePaths.length > 0;
    return `
        <div class="share-illustration-wrapper">
            <img src="${helpers.shareIllustrationURL}" alt="Share Onboarding" style="pointer-events: none; user-select: none; opacity: 0.85;" />
        </div>
        <div class="dropzone" style="--wails-drop-target: drop">
            <div class="drop-target" style="pointer-events: none;">
                <div class="drop-title" style="pointer-events: none;">${t('drag_drop_tips')}</div>
                <div class="drop-subtitle" style="pointer-events: none;">${hasItems ? `${state.sharePaths.length} ${t('items_ready')}` : t('or_click_to')}</div>
            </div>
            <div class="actions">
                <button type="button" id="choose-files">${t('select_files')}</button>
                <button type="button" id="choose-folder" class="secondary">${t('select_folder')}</button>
            </div>
        </div>
        ${state.shareLimitNotice ? `
            <div class="share-limit-notice" style="color: var(--danger); font-size: 12px; font-weight: 700; text-align: left; margin: 12px 0; background: rgba(180, 35, 24, 0.05); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--danger); line-height: 1.4; display: flex; align-items: flex-start; gap: 6px;">
                <span>⚠️</span>
                <span>${escapeHTML(state.shareLimitNotice)}</span>
            </div>
        ` : ''}
        ${hasItems ? `<ul class="path-list">${items}</ul>` : ''}
        <div class="primary-row" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 18px;">
            <div style="display: flex; align-items: center; gap: 8px;">
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
                <button class="primary" id="start-share" ${state.busy || !hasItems || state.shareLimitNotice ? 'disabled' : ''}>${state.busy ? t('working') : t('start_transfer')}</button>
                <button class="ghost" id="clear-share" ${!hasItems ? 'disabled' : ''}>${t('clear')}</button>
            </div>
        </div>
    `;
}
