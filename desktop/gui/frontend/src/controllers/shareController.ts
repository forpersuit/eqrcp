import { state } from '../state';
import { t } from '../i18n';
import { renderDeviceProgressHtml, renderShareLockedPathsHtml } from '../views/shareView';

function getTranslatedState(s?: string): string {
    if (!s) return '';
    const key = `state_${s.toLowerCase()}`;
    return t(key) || s;
}

export interface ShareControllerHelpers {
    shareItemStatus: (task: any, path: string) => string;
    qrImageURL: (pageUrl: string) => string;
    qrExpandedManual: boolean | null;
}

export function updateShareTransferActiveUI(task: any, helpers: ShareControllerHelpers): void {
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
        switchEl.checked = !!task.transferAutoStop;
    }

    const devicesWrapper = document.getElementById('devices-progress-wrapper');
    if (devicesWrapper) {
        const scrollContainer = devicesWrapper.querySelector('.devices-scroll-container');
        const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
        devicesWrapper.innerHTML = renderDeviceProgressHtml(task);
        const newScrollContainer = devicesWrapper.querySelector('.devices-scroll-container');
        if (newScrollContainer) {
            newScrollContainer.scrollTop = scrollTop;
        }
    }

    const pathList = document.getElementById('share-locked-path-list');
    if (pathList) {
        pathList.innerHTML = renderShareLockedPathsHtml(task, helpers.shareItemStatus);
    }

    const quotaCountdown = document.querySelector('.transfer-stage .quota-countdown');
    const isPaid = state.status?.isPaid;
    const usedTransfers = state.status?.usedTransfers || 0;
    const remaining = Math.max(0, 5 - usedTransfers);
    const shouldShowCountdown = !isPaid && remaining > 0;

    if (shouldShowCountdown) {
        const text = remaining > 0 ? `free ulimited: ${remaining}` : `free limit exceeded (restricted)`;
        if (quotaCountdown) {
            quotaCountdown.textContent = text;
        } else {
            const headerDiv = document.querySelector('.transfer-stage .transfer-head > div');
            if (headerDiv) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = `
                    <div class="quota-countdown" style="font-size: 11px; color: var(--danger); font-weight: 800; border: 1px solid var(--danger); padding: 4px 8px; border-radius: 6px; background: rgba(180, 35, 24, 0.05); text-transform: uppercase; letter-spacing: 0.05em; display: inline-block; white-space: nowrap; margin-top: 6px;">
                        ${text}
                    </div>
                `;
                if (tempDiv.firstElementChild) {
                    headerDiv.appendChild(tempDiv.firstElementChild);
                }
            }
        }
    } else if (quotaCountdown) {
        quotaCountdown.remove();
    }

    const qrWrapper = document.getElementById('share-qr-wrapper');
    if (qrWrapper) {
        const qrImage = helpers.qrImageURL(task.pageUrl);
        const isSharedOrReceived = task.transferState !== 'waiting' && (task.transferState === 'transferring' || task.transferTarget || task.bytesDone > 0);
        const shouldCollapse = isSharedOrReceived;
        const isQRExpanded = helpers.qrExpandedManual !== null ? helpers.qrExpandedManual : !shouldCollapse;

        const newQrHtml = isQRExpanded && qrImage ? `
            <div class="qr-hero">
                <img src="${qrImage}" alt="Transfer QR code" />
                <button class="ghost open-qr" data-open-url="${task.pageUrl}">${t('open_in_browser')}</button>
            </div>
        ` : (isQRExpanded ? `<div class="empty-state transfer-empty" style="margin-top: 12px;">${t('waiting_qr')}</div>` : '');

        if (qrWrapper.innerHTML.trim() !== newQrHtml.trim()) {
            qrWrapper.innerHTML = newQrHtml;
        }
    }
}
