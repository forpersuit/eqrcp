import { state, AppState } from './state';
import { t, getSystemLocale } from './i18n';
import { shouldProtectActiveInput, updateSettingsBadgeUI } from './utils/domHelpers';
import { escapeHTML, escapeAttr, formatBytes, cleanChatProfileName, cleanChatAvatar } from './utils/domUtils';
import { compressImageToWebP } from './utils/imageUtils';

import {
    recalculateUpdateTexts,
    syncManualUpdateCheckUI,
    cleanLocalAddressError,
    triggerDownloadUpdate,
    runAutoUpdateCheck,
    runManualUpdateCheck,
    scheduleAutoUpdateCheck,
} from './controllers/updateController';

import { buildDiagnostics, collectFeedback, feedbackMailto } from './controllers/feedbackController';
import { saveLicense, validateRedeemCode, licenseStorageKey } from './controllers/licenseController';

import { renderSettingsView } from './views/settingsView';
import {
    syncSettingsFromDOM,
    saveSettingsData,
    syncViewportDebugToChatFrame,
    toggleRightClickIntegration,
    toggleStartupIntegration,
    bindSettingsControls,
} from './controllers/settingsController';

import { renderAboutView } from './views/aboutView';
import { renderPlanComparisonView } from './views/planComparisonView';
import { renderFeedbackView } from './views/feedbackView';

import { renderRedeemView } from './views/redeemView';
import {
    hasPaidLicense,
    loadLicense,
    confirmRedeem,
    resetLicense,
    triggerManualRefresh,
    getLicenseDisplayName,
    licenseTiers,
} from './controllers/redeemController';

import { renderSide, renderHistory } from './views/historyView';
import {
    searchQuery,
    showSearchInput,
    showSearchDropdown,
    toggleSearchInput,
    toggleSearchDropdown,
    updateSearchQuery,
    getMatchResults,
    refreshHistoryListInDOM,
    clearHistory,
    restoreSharePaths,
} from './controllers/historyController';

import { renderShareView, renderShareTransfer, renderDeviceProgressHtml, renderShareLockedPathsHtml } from './views/shareView';
import { updateShareTransferActiveUI } from './controllers/shareController';

import { renderReceiveView, renderReceiveTransfer, renderReceiveDeviceProgressHtml } from './views/receiveView';
import { updateReceiveTransferActiveUI } from './controllers/receiveController';

import {
    openFileIcon,
    openFolderIcon,
    refreshIcon,
    stopIcon,
    copyIcon,
    browserIcon,
    settingsIcon,
    aboutIcon,
    feedbackIcon,
    giftIcon,
    diamondIcon,
    computerIcon,
    qrIcon,
    folderIcon,
    chevronIcon,
    linkIcon,
    phoneIcon,
    signalIcon,
    checkIcon,
    closeIcon,
    editIcon,
    shortName,
    renderAvatarMarkup,
    qrImageURL,
} from './views/icons';

import { allEmojis, culturalEmojis, getCategoryLocalizedName } from './emojis.js';
import './style.css';
import './app.css';
import faviconURL from './assets/images/favicon.png';
import horizontalLogoURL from './assets/images/logo-horizontal.png';
import logoMarkURL from './assets/images/logo-mark.png';
import shareIllustrationURL from './assets/images/share.png';
import receiveIllustrationURL from './assets/images/receive.png';
import chatIllustrationURL from './assets/images/chat.png';
import morphdom from './vendor/morphdom.js';
import { initDragDrop, sendDebugMessageToChat } from './dragdrop';

import { ClipboardGetText, ClipboardSetText, EventsOn, LogInfo, LogError } from '../wailsjs/runtime/runtime';
import {
    AgentStatus,
    AppInfo,
    Chat,
    ChatSaveDirectory,
    ClearHistory,
    DownloadChatAttachment,
    OpenExternal,
    OpenFile,
    OpenPath,
    OpenURL,
    ReadSettings,
    Receive,
    RepeatTask,
    SaveChatAttachmentAs,
    SaveSettings,
    SelectFiles,
    GetFileInfos,
    ValidateFreeTier,
    SelectReceiveDirectory,
    SelectShareDirectory,
    SelectLogDirectory,
    RightClickIntegrationStatus,
    Share,
    SetRightClickIntegrationEnabled,
    SetStartupEnabled,
    SetPaidStatus,
    ActivateLicense,
    ResetLicense,
    RefreshLicenseStatus,
    StartupStatus,
    StopChat,
    StopCurrent,
    SetAutoStop,
    SubmitFeedback,
    DevSetUsedSeconds,
} from '../wailsjs/go/main/App';

window.addEventListener('error', (e) => {
    const errorMsg = `[Uncaught JS Error] Message: ${e.message} | Source: ${e.filename} | Line: ${e.lineno} | Col: ${e.colno} | Error: ${e.error?.stack || e.error}`;
    console.error(errorMsg);
    if (typeof LogError === 'function') {
        LogError(errorMsg);
    }
});

window.addEventListener('unhandledrejection', (e) => {
    const errorMsg = `[Unhandled Promise Rejection] Reason: ${e.reason?.stack || e.reason}`;
    console.error(errorMsg);
    if (typeof LogError === 'function') {
        LogError(errorMsg);
    }
});

// Prevent duplicate event listener registration on reused DOM elements due to morphdom patching
(function () {
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    const originalRemoveEventListener = EventTarget.prototype.removeEventListener;

    EventTarget.prototype.addEventListener = function (type, listener, options) {
        (this as any)._listeners = (this as any)._listeners || [];
        const listenerStr = listener.toString();
        const existingIdx = (this as any)._listeners.findIndex((l: any) => l.type === type && l.listenerStr === listenerStr);

        if (existingIdx !== -1) {
            const old = (this as any)._listeners[existingIdx];
            originalRemoveEventListener.call(this, type, old.listener, options);
            (this as any)._listeners.splice(existingIdx, 1);
        }

        (this as any)._listeners.push({ type, listener, listenerStr });
        originalAddEventListener.call(this, type, listener, options);
    };
})();

function reportRuntimeErrorToBot(message: string, stack?: string): void {
    const frame = document.querySelector<HTMLIFrameElement>('#chat-iframe');
    if (!frame) return;
    try {
        frame.contentWindow?.postMessage(
            {
                type: 'report-runtime-error',
                message,
                stack: stack || '',
            },
            activeChatFrameOrigin() || '*'
        );
    } catch {
        // Ignored
    }
}

const chatUsageStorageKey = 'eqt.chat.dailyFreeUsage';
const redeemSecret = 'EQT-LOCAL-2026-V1';

let agentEvents: any = null;
let confirmSwitchResolve: ((val: boolean) => void) | null = null;
let qrExpandedManual: boolean | null = null;
let _staticDelegationBound = false;

function showConfirmSwitchDialog(): Promise<boolean> {
    return new Promise((resolve) => {
        confirmSwitchResolve = resolve;
        state.pendingSwitchMode = state.mode;
        render();
    });
}

function triggerChatQRPulse(): void {
    state.chatQRPulseUntil = Date.now() + 3000;
    state.chatQRPulseArmed = false;
    updateChatQRPulseButton();
    window.setTimeout(() => {
        updateChatQRPulseButton();
    }, 3200);
}

function updateChatQRPulseButton(): void {
    const btn = document.querySelector('.btn-chat-qr-icon');
    if (!btn) return;
    if (Date.now() < state.chatQRPulseUntil) {
        btn.classList.add('pulse-active');
    } else {
        btn.classList.remove('pulse-active');
    }
}

function pulseChatFrameQR(): void {
    triggerChatQRPulse();
    const frame = document.querySelector<HTMLIFrameElement>('#chat-iframe');
    if (!frame) return;
    try {
        frame.contentWindow?.postMessage(
            {
                type: 'pulse-qr-hero',
            },
            activeChatFrameOrigin() || '*'
        );
    } catch {
        // Ignored
    }
}

function stopChatQRPulse(): void {
    state.chatQRPulseUntil = 0;
    updateChatQRPulseButton();
}

window.addEventListener('message', async (e: MessageEvent) => {
    if (!isTrustedChatFrameMessage(e)) return;
    if (e.data && e.data.type === 'select-files') {
        const requestId = e.data.requestId;
        try {
            const paths = await SelectFiles();
            (e.source as WindowProxy | null)?.postMessage(
                { type: 'selected-files', requestId, paths: paths || [] },
                '*'
            );
        } catch (err: unknown) {
            (e.source as WindowProxy | null)?.postMessage(
                { type: 'selected-files', requestId, paths: [], error: String((err as { message?: string })?.message || err || 'Failed to select files') },
                '*'
            );
        }
    }
});

function activeChatFrameOrigin(): string {
    const frame = document.querySelector<HTMLIFrameElement>('#chat-iframe');
    if (!frame || !frame.src) return '';
    try {
        return new URL(frame.src).origin;
    } catch {
        return '';
    }
}

function isTrustedChatFrameMessage(event: MessageEvent): boolean {
    const iframeOrigin = activeChatFrameOrigin();
    if (iframeOrigin && event.origin === iframeOrigin) {
        return true;
    }
    const currentTask = activeChatTask();
    if (currentTask && currentTask.pageUrl) {
        return isTrustedChatURL(event.origin, currentTask.pageUrl);
    }
    return false;
}

function isTrustedChatURL(rawURL: string, origin: string): boolean {
    try {
        const u = new URL(rawURL);
        const o = new URL(origin);
        return u.hostname === o.hostname && u.port === o.port;
    } catch {
        return false;
    }
}

function activeShareTask(): any {
    const task = state.status?.current;
    if (!task || (task.action !== 'share' && task.action !== 'send') || isTaskClosed(task)) {
        return null;
    }
    return task;
}

function activeReceiveTask(): any {
    const task = state.status?.current;
    if (!task || task.action !== 'receive' || isTaskClosed(task)) {
        return null;
    }
    return task;
}

function activeChatTask(): any {
    const task = state.status?.chat;
    if (!task || task.action !== 'chat' || isTaskClosed(task)) {
        return null;
    }
    return task;
}

function isTerminal(task: any): boolean {
    const s = (task?.state || '').toLowerCase();
    return s === 'completed' || s === 'done' || s === 'stopped' || s === 'cancelled' || s === 'failed' || s === 'error';
}

function isTaskClosed(task: any): boolean {
    if (!task) return true;
    if (task.userClosed) return true;
    return isTerminal(task);
}

function getTranslatedState(s?: string): string {
    if (!s) return '';
    const key = `state_${s.toLowerCase()}`;
    return t(key) || s;
}

function shareItemStatus(task: any, path: string): string {
    const clients = task?.clientStates ? (Object.values(task.clientStates) as any[]) : [];
    if (!clients.length) {
        return getTranslatedState(task?.transferState || task?.state || 'waiting');
    }
    const downloading = clients.some((c) => c.current === path || (c.state === 'transferring' && c.current === path));
    if (downloading) return t('state_transferring') || 'Transferring...';
    const completed = clients.some((c) => Array.isArray(c.completedPaths) && c.completedPaths.includes(path));
    if (completed) return t('completed') || 'Completed';
    return t('state_waiting') || 'Waiting...';
}

function renderSwitch(id: string, checked?: boolean, disabled = false): string {
    return `
        <label class="switch-toggle" for="${id}">
            <input type="checkbox" id="${id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
            <span class="switch-slider"></span>
        </label>
    `;
}

function renderStatusBadge(status: any): string {
    if (!status) return `<span class="badge offline">${t('status_checking')}</span>`;
    if (status.needsRepair) return `<span class="badge error">${t('status_repair_needed')}</span>`;
    if (status.enabled) return `<span class="badge active">${t('status_enabled')}</span>`;
    if (status.supported) return `<span class="badge inactive">${t('status_disabled')}</span>`;
    return `<span class="badge unsupported">${t('status_unsupported')}</span>`;
}

function integrationStatusText(status: any, fallback: string): string {
    if (!status) return fallback;
    if (status.needsRepair) return t('integration_needs_repair');
    if (status.enabled) return t('integration_enabled');
    if (status.supported) return t('integration_disabled');
    return t('integration_unsupported');
}

function renderShare(): string {
    const helpers = {
        activeShareTask,
        shareIllustrationURL,
        qrImageURL,
        qrIcon,
        renderSwitch,
        shareItemStatus,
        qrExpandedManual,
    };
    return renderShareView(state, helpers);
}

function renderReceive(): string {
    const helpers = {
        activeReceiveTask,
        receiveIllustrationURL,
        qrImageURL,
        qrIcon,
        openFolderIcon,
        openFileIcon,
        renderSwitch,
        qrExpandedManual,
    };
    return renderReceiveView(state, helpers);
}

function activeChatPageURL(): string {
    const task = activeChatTask();
    return task?.pageUrl || '';
}

function canKeepChatFrame(previousChatURL: string): boolean {
    const currentURL = activeChatPageURL();
    if (!previousChatURL || !currentURL) return false;
    try {
        const prev = new URL(previousChatURL);
        const curr = new URL(currentURL);
        return prev.origin === curr.origin && prev.searchParams.get('session') === curr.searchParams.get('session');
    } catch {
        return false;
    }
}

function reconcileChatQRState(status: any): void {
    const chatTask = status?.chat && chatSessionKey(status.chat) ? status.chat : null;
    const deviceCount = chatDeviceCount(chatTask);
    const hasDevices = deviceCount > 0;

    if (!chatTask) {
        state.chatQROpen = false;
        state.chatQRPromptDismissed = false;
        state.chatQRPulseArmed = false;
        state.lastChatDeviceCount = 0;
        return;
    }

    if (hasDevices && state.lastChatDeviceCount === 0 && !state.chatQRPromptDismissed) {
        triggerChatQRPulse();
    }
    state.lastChatDeviceCount = deviceCount;
}

function chatSessionKey(task: any): string {
    if (!task) return '';
    return task.sessionKey || task.session || String(task.id || '');
}

function chatDeviceCount(task: any): number {
    return task?.clientStates ? Object.keys(task.clientStates).length : 0;
}

function chatStateLabel(chatState: string): string {
    const s = String(chatState || '').toLowerCase();
    if (s === 'ready' || s === 'running') return t('chat_state_running') || 'Active';
    if (s === 'stopped') return t('chat_state_stopped') || 'Stopped';
    return t('chat_state_starting') || 'Starting...';
}

function renderChatQuotaPill(): string {
    const isPaid = hasPaidLicense();
    if (isPaid) {
        return `<div class="chat-quota-pill paid" title="${escapeAttr(t('paid_unlimited_desc'))}">PRO Unlimited</div>`;
    }
    const remSec = Math.max(0, Math.floor(chatRemainingMs() / 1000));
    return `<div class="chat-quota-pill free" title="${escapeAttr(t('free_daily_limit_desc'))}">${formatDuration(remSec * 1000)} left</div>`;
}

function renderChat(): string {
    const activeTask = activeChatTask();
    const isPaid = hasPaidLicense();

    if (activeTask) {
        return `
            <div class="chat-stage">
                <div class="chat-head">
                    <div>
                        <div class="eyebrow">${t('chat_mode_title')}</div>
                        <h2>${escapeHTML(chatStateLabel(activeTask.state))}</h2>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        ${renderChatQuotaPill()}
                        <button class="danger inline stop-chat-action">${t('stop')}</button>
                    </div>
                </div>
                <div class="chat-frame-container" style="flex: 1; min-height: 0; width: 100%; position: relative;">
                    <iframe id="chat-iframe" src="${escapeAttr(activeTask.pageUrl)}" style="width: 100%; height: 100%; border: none; border-radius: 8px;" allow="clipboard-read; clipboard-write"></iframe>
                </div>
            </div>
        `;
    }

    return `
        <div class="chat-illustration-wrapper">
            <img src="${chatIllustrationURL}" alt="Chat Onboarding" style="pointer-events: none; user-select: none; opacity: 0.85;" />
        </div>
        <div class="chat-welcome-box">
            <h2>${t('chat_welcome_title')}</h2>
            <p>${t('chat_welcome_desc')}</p>
        </div>
        <div class="primary-row" style="width: 100%; display: flex; justify-content: center; gap: 12px; margin-top: 18px;">
            <button class="primary" id="start-chat" ${state.busy ? 'disabled' : ''} style="width: 180px; flex: none;">${chatStartButtonText()}</button>
        </div>
    `;
}

function chatStartButtonText(): string {
    if (state.busy) return t('working');
    return t('start_chat');
}

function renderPanel(): string {
    if (state.pendingSwitchMode) return renderConfirmSwitchPanel();
    if (state.activePanel === 'settings') return renderSettingsPanel();
    if (state.activePanel === 'about') return renderAboutPanel();
    if (state.activePanel === 'plans') return renderPlanComparisonPanel();
    if (state.activePanel === 'redeem') return renderRedeemPanel();
    if (state.activePanel === 'feedback') return renderFeedbackPanel();
    return '';
}

function renderConfirmSwitchPanel(): string {
    return `
        <div class="modal-overlay">
            <div class="modal-card">
                <h3>${t('confirm_switch_title')}</h3>
                <p>${t('confirm_switch_desc')}</p>
                <div class="modal-actions">
                    <button class="secondary" id="cancel-switch">${t('btn_cancel')}</button>
                    <button class="danger" id="confirm-switch">${t('btn_confirm')}</button>
                </div>
            </div>
        </div>
    `;
}

function renderSettingsPanel(): string {
    return renderSettingsView({
        escapeHTML,
        escapeAttr,
        renderStatusBadge,
        renderSwitch,
        renderAvatarMarkup,
        cleanChatAvatar,
        cleanChatProfileName,
        integrationStatusText,
        checkIcon,
        closeIcon,
        editIcon,
        openFolderIcon,
    });
}

function renderAboutPanel(): string {
    return renderAboutView({
        loadLicense,
        getLicenseDisplayName,
        chatQuotaText: () => `${formatDuration(chatRemainingMs())} free daily quota`,
        escapeHTML,
        horizontalLogoURL,
        sparklesIcon: diamondIcon,
    });
}

function renderPlanComparisonPanel(): string {
    return renderPlanComparisonView({
        hasPaidLicense,
    });
}

function renderRedeemPanel(): string {
    return renderRedeemView({
        state,
        hasPaidLicense,
        getLicenseDisplayName,
        giftIcon,
    });
}

function renderFeedbackPanel(): string {
    return renderFeedbackView({
        buildDiagnostics,
        feedbackMailto,
        escapeHTML,
        escapeAttr,
    });
}

function renderWorkspace(): string {
    if (state.mode === 'share') return renderShare();
    if (state.mode === 'receive') return renderReceive();
    if (state.mode === 'chat') return renderChat();
    return '';
}

function renderCurrent(task: any): string {
    if (!task) return '';
    return `
        <div class="current-task-bar">
            <span>${t('current_task')}: #${task.id} (${escapeHTML(task.action)})</span>
            <button class="danger inline stop-current-action">${t('stop')}</button>
        </div>
    `;
}

function render(): void {
    recalculateUpdateTexts();
    ensureFavicon();
    const appEl = document.querySelector<HTMLElement>('#app');
    if (!appEl) return;

    const previousChatURL = activeChatPageURL();

    const activeTask = state.status?.current;
    const history = state.status?.history || [];
    const matchResults = getMatchResults(history, searchQuery);

    const activeShare = activeShareTask();
    const activeRecv = activeReceiveTask();
    const activeChat = activeChatTask();
    let runningMode: string | null = null;
    if (activeShare) {
        runningMode = 'share';
    } else if (activeRecv) {
        runningMode = 'receive';
    } else if (activeChat) {
        runningMode = 'chat';
    }

    const html = `
        <main class="shell">
            <header class="topbar">
                <nav class="mode-switch" aria-label="Transfer modes">
                    <button class="${state.mode === 'share' ? 'active' : (runningMode && runningMode !== 'share' ? 'disabled-mode' : '')}" data-mode="share" id="tab-share">${t('share')}</button>
                    <button class="${state.mode === 'receive' ? 'active' : (runningMode && runningMode !== 'receive' ? 'disabled-mode' : '')}" data-mode="receive" id="tab-receive">${t('receive')}</button>
                    <button class="${state.mode === 'chat' ? 'active' : (runningMode && runningMode !== 'chat' ? 'disabled-mode' : '')}" data-mode="chat" id="tab-chat">${t('chat')}</button>
                </nav>
                <div class="top-actions" role="menubar" aria-label="Application menu">
                    ${!hasPaidLicense() ? `
                        <button class="menu-button" id="open-redeem" title="${t('redeem_title')}" aria-label="${t('redeem_title')}">
                            <span class="menu-icon">${giftIcon()}</span>
                        </button>
                    ` : ''}
                    ${(() => {
                        const isPaid = hasPaidLicense();
                        const tier = (isPaid && state.license?.tier) ? state.license.tier : 'FREE';
                        const tierText = (tier === 'PLUS' && state.license?.codeDate === 'LIFETIME') ? 'PLUS U' : tier;
                        return `<span class="topbar-tier-badge">${escapeHTML(tierText)}</span>`;
                    })()}
                    <button class="menu-button" id="open-settings" title="${t('settings')}" aria-label="${t('settings')}" style="position: relative;">
                        <span class="menu-icon">${settingsIcon()}</span>
                        ${state.settings?.autoUpdateMode !== 'off' && (
                            (state.settings?.autoUpdateMode === 'notify' && (state.updateStage === 'available' || state.updateStage === 'ready')) ||
                            ((state.settings?.autoUpdateMode === 'download' || state.settings?.autoUpdateMode === 'silent') && state.updateStage === 'ready')
                        ) ? `<span class="badge-dot" style="position: absolute; top: 6px; right: 6px; width: 8px; height: 8px; background-color: var(--danger, #fc0035); border-radius: 50%; border: 1.5px solid var(--bg, #ffffff); pointer-events: none;"></span>` : ''}
                    </button>
                    <button class="menu-button" id="open-about" title="${t('about')}" aria-label="${t('about')}">
                        <span class="menu-icon">${aboutIcon()}</span>
                    </button>
                    <button class="menu-button" id="open-feedback" title="${t('feedback')}" aria-label="${t('feedback')}">
                        <span class="menu-icon">${feedbackIcon()}</span>
                    </button>
                </div>
            </header>

            <section class="layout ${state.mode === 'chat' ? 'chat-layout' : ''} ${state.settings?.showHistory === false ? 'no-history-layout' : ''}">
                <div class="workspace">
                    ${renderWorkspace()}
                    ${state.notice ? `<div class="notice success">${escapeHTML(state.notice)}</div>` : ''}
                    ${state.error ? `<div class="notice error">${escapeHTML(state.error)}</div>` : ''}
                </div>
                ${renderSide({ state, showSearchInput, showSearchDropdown, searchQuery, matchResults })}
            </section>
            ${renderPanel()}
        </main>
    `;

    if (!appEl.firstElementChild) {
        appEl.innerHTML = html;
    } else {
        morphdom(appEl.firstElementChild, html, {
            onBeforeElUpdated(fromEl: HTMLElement, toEl: HTMLElement) {
                if (fromEl.id === 'chat-iframe' && toEl.id === 'chat-iframe') {
                    if (canKeepChatFrame(previousChatURL)) {
                        return false;
                    }
                }
                if (fromEl.tagName === 'INPUT' || fromEl.tagName === 'TEXTAREA' || fromEl.tagName === 'SELECT') {
                    if (document.activeElement === fromEl) {
                        return false;
                    }
                }
                return true;
            },
        });
    }

    bindEvents();
    syncManualUpdateCheckUI();
}

function ensureFavicon(): void {
    let link = document.querySelector<HTMLLinkElement>("link[rel*='icon']");
    if (!link) {
        link = document.createElement('link');
        link.type = 'image/png';
        link.rel = 'shortcut icon';
        document.getElementsByTagName('head')[0].appendChild(link);
    }
    link.href = faviconURL;
}

function bindEvents(): void {
    if (_staticDelegationBound) return;
    _staticDelegationBound = true;

    document.addEventListener('click', async (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;

        if (target.closest('#tab-share, [data-mode="share"]')) setMode('share');
        if (target.closest('#tab-receive, [data-mode="receive"]')) setMode('receive');
        if (target.closest('#tab-chat, [data-mode="chat"]')) setMode('chat');

        if (target.closest('#open-settings')) openPanel('settings');
        if (target.closest('#open-about')) openPanel('about');
        if (target.closest('#open-plans')) openPanel('plans');
        if (target.closest('#open-redeem')) openPanel('redeem');
        if (target.closest('#open-feedback')) openPanel('feedback');
        if (target.closest('#close-panel, .close-button')) closePanel();

        if (target.closest('#cancel-switch')) {
            if (confirmSwitchResolve) {
                confirmSwitchResolve(false);
                confirmSwitchResolve = null;
            }
            state.pendingSwitchMode = null;
            render();
        }

        if (target.closest('#confirm-switch')) {
            if (confirmSwitchResolve) {
                confirmSwitchResolve(true);
                confirmSwitchResolve = null;
            }
            if (state.pendingSwitchMode) {
                state.mode = state.pendingSwitchMode;
                state.pendingSwitchMode = null;
            }
            render();
        }

        if (target.closest('#choose-files')) {
            try {
                const files = await SelectFiles();
                if (files && files.length > 0) {
                    const infos = await GetFileInfos(files);
                    const newItems = infos.map((info: any) => ({
                        path: info.path,
                        name: info.name,
                        size: formatBytes(info.size),
                    }));
                    state.sharePaths = [...state.sharePaths, ...newItems];
                    render();
                }
            } catch (err) {
                console.error('Failed to select files:', err);
            }
        }

        if (target.closest('#choose-folder')) {
            try {
                const dir = await SelectShareDirectory();
                if (dir) {
                    const infos = await GetFileInfos([dir]);
                    if (infos && infos.length > 0) {
                        state.sharePaths = [
                            ...state.sharePaths,
                            {
                                path: infos[0].path,
                                name: infos[0].name,
                                size: formatBytes(Number(infos[0].size)),
                            },
                        ];
                        render();
                    }
                }
            } catch (err) {
                console.error('Failed to select share directory:', err);
            }
        }

        if (target.closest('#choose-receive')) {
            try {
                const dir = await SelectReceiveDirectory();
                if (dir) {
                    state.receiveDir = dir;
                    render();
                }
            } catch (err) {
                console.error('Failed to select receive directory:', err);
            }
        }

        if (target.closest('#start-share')) {
            if (!state.sharePaths.length) return;
            state.busy = true;
            render();
            try {
                const paths = state.sharePaths.map((item) => (typeof item === 'string' ? item : item.path));
                await Share(paths);
            } catch (err: any) {
                state.error = err || 'Failed to start share';
            } finally {
                state.busy = false;
                render();
            }
        }

        if (target.closest('#clear-share')) {
            state.sharePaths = [];
            state.shareLimitNotice = '';
            render();
        }

        if (target.closest('#start-receive')) {
            if (!state.receiveDir) return;
            state.busy = true;
            render();
            try {
                await Receive(state.receiveDir);
            } catch (err: any) {
                state.error = err || 'Failed to start receive';
            } finally {
                state.busy = false;
                render();
            }
        }

        if (target.closest('#start-chat')) {
            state.busy = true;
            render();
            try {
                await Chat();
                startChatUsage();
            } catch (err: any) {
                state.error = err || 'Failed to start chat';
            } finally {
                state.busy = false;
                render();
            }
        }

        if (target.closest('.stop-current-action')) {
            try {
                await StopCurrent();
            } catch (err: any) {
                state.error = err || 'Failed to stop current task';
            }
        }

        if (target.closest('.stop-chat-action')) {
            try {
                await StopChat();
                stopChatUsage();
            } catch (err: any) {
                state.error = err || 'Failed to stop chat';
            }
        }

        if (target.closest('#confirm-redeem')) {
            confirmRedeem({ render, loadStatusData, stopChatUsage });
        }

        if (target.closest('#reset-license')) {
            state.confirmResetPending = true;
            render();
        }

        if (target.closest('#cancel-reset-license')) {
            state.confirmResetPending = false;
            render();
        }

        if (target.closest('#confirm-reset-license')) {
            state.confirmResetPending = false;
            resetLicense({ render, loadStatusData, startChatUsage });
        }

        if (target.closest('#clear-history')) {
            await clearHistory(render);
        }

        if (target.closest('.remove-path')) {
            const btn = target.closest('.remove-path') as HTMLElement;
            const idx = Number(btn.getAttribute('data-path-index'));
            if (!isNaN(idx)) {
                state.sharePaths.splice(idx, 1);
                render();
            }
        }

        if (target.closest('.open-file-action')) {
            const btn = target.closest('.open-file-action') as HTMLElement;
            const file = btn.getAttribute('data-open-file');
            if (file) {
                try {
                    await OpenFile(file);
                } catch (err: any) {
                    state.error = err || 'Failed to open file';
                }
            }
        }

        if (target.closest('.open-dir-action')) {
            const btn = target.closest('.open-dir-action') as HTMLElement;
            const path = btn.getAttribute('data-open-path');
            if (path) {
                try {
                    await OpenPath(path);
                } catch (err: any) {
                    state.error = err || 'Failed to open path';
                }
            }
        }

        if (target.closest('.restore-share-action')) {
            const btn = target.closest('.restore-share-action') as HTMLElement;
            const taskId = btn.getAttribute('data-task-id');
            if (taskId) {
                await restoreSharePaths(taskId, render);
            }
        }

        if (target.closest('#toggle-search')) {
            toggleSearchInput();
            render();
        }

        if (target.closest('#refresh')) {
            await loadStatusData();
        }
    });

    bindPanelEvents();
}

function bindPanelEvents(): void {
    bindSettingsControls({
        syncIdentityToChatFrame,
        updateIntegrationRow: (kind) => {
            // Integration status update
        },
        render,
        syncPanelSurface: render,
        openChatSaveDirectory,
        handleAutoSaveSettings: saveSettingsData,
        activeChatFrameOrigin,
    });
}

async function openChatSaveDirectory(): Promise<void> {
    try {
        const dir = state.chatSaveDir || (await ChatSaveDirectory());
        if (dir) {
            await OpenPath(dir);
        }
    } catch (err: any) {
        state.error = err || 'Failed to open chat save directory';
    }
}

function syncIdentityToChatFrame(): void {
    const frame = document.querySelector<HTMLIFrameElement>('#chat-iframe');
    if (!frame) return;
    try {
        frame.contentWindow?.postMessage(
            {
                type: 'update-profile-identity',
                chatSender: state.settings?.chatSender || '',
                chatAvatar: state.settings?.chatAvatar || '',
            },
            activeChatFrameOrigin() || '*'
        );
    } catch {
        // Ignored
    }
}

function openPanel(panel: string): void {
    state.activePanel = panel;
    render();
}

function closePanel(): void {
    state.activePanel = '';
    render();
}

function setMode(mode: 'share' | 'receive' | 'chat'): void {
    if (state.mode === mode) return;
    const activeTask = state.status?.current;
    if (activeTask && !isTaskClosed(activeTask)) {
        showConfirmSwitchDialog().then((ok) => {
            if (ok) {
                state.mode = mode;
                render();
            }
        });
        return;
    }
    state.mode = mode;
    render();
}

let chatUsageTimer: number | null = null;

function loadChatUsage(): void {
    try {
        const raw = window.localStorage.getItem(chatUsageStorageKey);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data.date === todayKey()) {
            state.chatUsageMs = Number(data.ms) || 0;
        } else {
            rollChatUsageDay();
        }
    } catch {
        rollChatUsageDay();
    }
}

function saveChatUsage(): void {
    try {
        window.localStorage.setItem(
            chatUsageStorageKey,
            JSON.stringify({
                date: todayKey(),
                ms: state.chatUsageMs,
            })
        );
    } catch {
        // Ignored
    }
}

function startChatUsage(): void {
    if (hasPaidLicense()) return;
    state.chatUsageStartedAt = Date.now();
    scheduleChatUsageTimer();
}

function stopChatUsage(): void {
    if (state.chatUsageStartedAt > 0) {
        state.chatUsageMs += Date.now() - state.chatUsageStartedAt;
        state.chatUsageStartedAt = 0;
        saveChatUsage();
    }
    clearChatUsageTimer();
}

function scheduleChatUsageTimer(): void {
    clearChatUsageTimer();
    chatUsageTimer = window.setInterval(() => {
        saveChatUsageSnapshot();
    }, 1000);
}

function clearChatUsageTimer(): void {
    if (chatUsageTimer !== null) {
        window.clearInterval(chatUsageTimer);
        chatUsageTimer = null;
    }
}

function saveChatUsageSnapshot(): void {
    if (state.chatUsageStartedAt > 0) {
        const delta = Date.now() - state.chatUsageStartedAt;
        state.chatUsageStartedAt = Date.now();
        state.chatUsageMs += delta;
        saveChatUsage();
        if (chatRemainingMs() <= 0) {
            StopChat();
            stopChatUsage();
            render();
        }
    }
}

function chatRemainingMs(): number {
    const freeDailyMs = 30 * 60 * 1000;
    return Math.max(0, freeDailyMs - state.chatUsageMs);
}

function rollChatUsageDay(): void {
    state.chatUsageDate = todayKey();
    state.chatUsageMs = 0;
    saveChatUsage();
}

function todayKey(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDuration(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}m ${s}s`;
}

async function loadStatusData(): Promise<void> {
    try {
        const res = await AgentStatus();
        applyStatusData(res);
    } catch (err) {
        console.error('Failed to get status data:', err);
    }
}

function applyStatusData(nextStatus: any): void {
    state.status = nextStatus;
    reconcileChatQRState(nextStatus);
    if (state.mode === 'share' && activeShareTask()) {
        updateShareTransferActiveUI(activeShareTask(), {
            shareItemStatus,
            qrImageURL,
            qrExpandedManual,
        });
    } else if (state.mode === 'receive' && activeReceiveTask()) {
        updateReceiveTransferActiveUI(activeReceiveTask(), {
            openFolderIcon,
            openFileIcon,
        });
    } else {
        render();
    }
}

function connectAgentEvents(): void {
    try {
        EventsOn('status-update', (data: any) => {
            applyStatusData(data);
        });
    } catch (err) {
        console.error('Failed to bind Agent status events:', err);
    }
}

async function init(): Promise<void> {
    loadChatUsage();
    loadLicense();
    try {
        state.appInfo = await AppInfo();
        state.settings = await ReadSettings();
        state.receiveDir = state.settings?.output || '';
        state.browserFallback = Boolean(state.settings?.browser);
        state.chatAutoSave = state.settings?.chatAutoSave !== false;
        state.closeBehavior = state.settings?.closeBehavior === 'quit' ? 'quit' : 'tray';
    } catch (err) {
        console.error('Initialization error:', err);
    }
    await loadStatusData();
    connectAgentEvents();
    render();
    scheduleAutoUpdateCheck();
}

document.addEventListener('DOMContentLoaded', init);
