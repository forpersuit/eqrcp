import { state } from '../state';
import { t } from '../i18n';
import { escapeAttr, escapeHTML } from '../utils/domUtils';
import { renderReceiveDeviceProgressHtml } from '../views/receiveView';

function getTranslatedState(s?: string): string {
    if (!s) return '';
    const key = `state_${s.toLowerCase()}`;
    return t(key) || s;
}

export function updateReceiveTransferActiveUI(task: any, helpers: { openFolderIcon: () => string; openFileIcon: () => string }): void {
    const statusH2 = document.querySelector('.transfer-stage .transfer-head h2');
    if (statusH2) {
        statusH2.textContent = getTranslatedState(task.transferState || task.state || 'waiting');
    }

    const countEl = document.getElementById('current-devices-count');
    if (countEl) {
        countEl.textContent = String(task.clientStates ? Object.keys(task.clientStates).length : 0);
    }

    const switchEl = document.getElementById('auto-stop-switch') as HTMLInputElement | null;
    if (switchEl) {
        switchEl.checked = !task.transferAutoStop;
    }

    const devicesWrapper = document.getElementById('receive-devices-progress-wrapper');
    if (devicesWrapper) {
        const clients = task.clientStates ? (Object.values(task.clientStates) as any[]) : [];
        const hasSkeleton = !!devicesWrapper.querySelector('.devices-scroll-container');

        const needsRebuild = () => {
            if (!hasSkeleton) return true;
            const renderedLis = devicesWrapper.querySelectorAll('li[id^="receive-client-li-"]');
            if (renderedLis.length !== clients.length) return true;
            for (let i = 0; i < clients.length; i++) {
                const client = clients[i];
                const li = devicesWrapper.querySelector(`#receive-client-li-${escapeAttr(client.clientID)}`);
                if (!li) return true;

                const isExpandedInDom = li.getAttribute('data-expanded') === 'true';
                const isExpandedInState = !!state.deviceFilesExpanded?.[client.clientID];
                if (isExpandedInDom !== isExpandedInState) return true;

                const files = client.files || [];
                const renderedFileRows = li.querySelectorAll('div[id^="receive-file-row-"]');
                let expectedFileCount = files.length;
                if (files.length === 0) {
                    const fallbackListLen = (client.state === 'transferring' && client.current ? 1 : 0) + (client.savedFiles || []).length;
                    expectedFileCount = fallbackListLen;
                }
                if (isExpandedInState && renderedFileRows.length !== expectedFileCount) return true;
            }
            return false;
        };

        if (needsRebuild()) {
            const scrollContainer = devicesWrapper.querySelector('.devices-scroll-container');
            const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
            devicesWrapper.innerHTML = renderReceiveDeviceProgressHtml(task, state, helpers);
            const newScrollContainer = devicesWrapper.querySelector('.devices-scroll-container');
            if (newScrollContainer) {
                newScrollContainer.scrollTop = scrollTop;
            }
        } else {
            clients.forEach((clientObj: any) => {
                const client = clientObj;
                const clientID = client.clientID;
                const devName = client.deviceName || 'Device';
                let displayName = devName;
                if (!displayName.includes('(') && clientID) {
                    const shortId = clientID.length > 4 ? clientID.substring(clientID.length - 4) : clientID;
                    displayName = `${displayName} (${shortId})`;
                }
                const stateText = getTranslatedState(client.state || 'waiting');
                const currentFile = client.current || '';

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

                const nameTextEl = document.getElementById(`receive-client-name-text-${escapeAttr(clientID)}`);
                if (nameTextEl) {
                    nameTextEl.textContent = displayName;
                }

                const badgeContainer = document.getElementById(`receive-client-status-badge-${escapeAttr(clientID)}`);
                if (badgeContainer) {
                    let stateBadgeHtml = '';
                    if (client.state === 'completed') {
                        stateBadgeHtml = `<span style="display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 50%; background: var(--accent-light); border: 1px solid var(--accent-border); color: var(--accent); font-size: 9px; font-weight: 900;" title="${escapeAttr(t('completed') || 'Completed')}">✓</span>`;
                    } else if (client.state === 'failed') {
                        stateBadgeHtml = `<span style="display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 50%; background: rgba(180,35,24,0.08); border: 1px solid rgba(180,35,24,0.2); color: var(--danger); font-size: 9px; font-weight: 900;" title="${escapeAttr(client.message || t('failed') || 'Failed')}">✕</span>`;
                    } else if (client.state === 'waiting') {
                        stateBadgeHtml = `<span style="display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 50%; background: rgba(0,0,0,0.04); border: 1px solid var(--line); color: var(--text-secondary); font-size: 8px; font-weight: 900;" title="${escapeAttr(t('waiting') || 'Waiting')}">⌛</span>`;
                    } else {
                        stateBadgeHtml = `<span style="color: var(--accent-strong); font-size: 11px; font-weight: 800;">${client.percent || 0}%</span>`;
                    }
                    badgeContainer.innerHTML = `<span style="font-size: 10px; color: var(--text-secondary); font-weight: 600;">${stateText}</span>${stateBadgeHtml}`;
                }
            });
        }
    }
}
