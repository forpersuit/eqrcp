import { state } from '../state';
import { t } from '../i18n';
import { shouldProtectActiveInput, updateSettingsBadgeUI } from '../utils/domHelpers';

let autoUpdateTimer: number | null = null;

export function recalculateUpdateTexts(): void {
    if (!state.updateStage || state.updateStage === 'idle') {
        state.updateStatusText = '';
        state.updateBtnText = '';
        return;
    }
    const checkRes = state.updateCheckRes as Record<string, unknown> | null;
    const version = String(checkRes?.version || '');
    if (state.updateStage === 'checking') {
        state.updateStatusText = t('checking_updates');
        state.updateBtnText = t('btn_checking');
    } else if (state.updateStage === 'available') {
        state.updateStatusText = t('version_available', { version });
        state.updateBtnText = t('btn_download_now');
    } else if (state.updateStage === 'ready') {
        state.updateStatusText = t('update_ready_restart', { version });
        state.updateBtnText = t('btn_install_restart');
    } else if (state.updateStage === 'downloading') {
        state.updateStatusText = t('btn_downloading');
        state.updateBtnText = t('btn_downloading');
    } else if (state.updateStage === 'installing') {
        state.updateStatusText = t('installing_updates');
        state.updateBtnText = t('btn_installing');
    }
}

export function syncManualUpdateCheckUI(syncPanelSurfaceFn?: () => void): void {
    updateSettingsBadgeUI();
    const statusEl = document.querySelector<HTMLElement>('#update-check-status');
    const btnEl = document.querySelector<HTMLButtonElement>('#btn-manual-update-check');
    if (statusEl && btnEl) {
        statusEl.textContent = state.updateStatusText || t('manual_check_tips');
        btnEl.textContent = state.updateBtnText || t('manual_check_btn');
        btnEl.disabled = Boolean(state.updateBtnDisabled);
    } else if (state.activePanel === 'settings' && !shouldProtectActiveInput() && typeof syncPanelSurfaceFn === 'function') {
        syncPanelSurfaceFn();
    }
}

export function cleanLocalAddressError(err: unknown): string {
    const rawMsg = String((err as { message?: string })?.message || err || '');
    if (rawMsg.includes('127.0.0.1') || rawMsg.includes('localhost') || rawMsg.includes('connection refused') || rawMsg.includes('connectex')) {
        return 'Local service connection failed.';
    }
    return rawMsg;
}

export async function triggerDownloadUpdate(updateMessagesSurfaceFn?: () => void): Promise<void> {
    const checkRes = state.updateCheckRes;
    if (!checkRes) return;

    state.updateStage = 'downloading';
    state.updateStatusText = t('btn_downloading');
    state.updateBtnText = t('btn_downloading');
    state.updateBtnDisabled = true;
    syncManualUpdateCheckUI();

    try {
        await (window as unknown as { go: { main: { App: { DownloadUpdate: (res: unknown) => Promise<void> } } } }).go?.main.App.DownloadUpdate(checkRes);
        state.updateStage = 'ready';
        const version = String(checkRes.version || '');
        state.updateStatusText = t('update_ready_restart', { version });
        state.updateBtnText = t('btn_install_restart');
        state.updateBtnDisabled = false;
        syncManualUpdateCheckUI();
        if (typeof updateMessagesSurfaceFn === 'function') {
            updateMessagesSurfaceFn();
        }
    } catch (err) {
        state.updateStage = 'available';
        const cleanedErr = cleanLocalAddressError(err);
        state.updateStatusText = t('download_failed', { err: cleanedErr });
        if (cleanedErr === 'Local service connection failed.') {
            state.updateBtnText = t('btn_retry');
        } else {
            state.updateBtnText = t('btn_download_now');
        }
        state.updateBtnDisabled = false;
        syncManualUpdateCheckUI();
    }
}

export async function runAutoUpdateCheck(force = false, updateMessagesSurfaceFn?: () => void): Promise<void> {
    const mode = state.settings?.autoUpdateMode || 'download';
    const reschedule = () => {
        if (mode !== 'off') {
            scheduleAutoUpdateCheck(updateMessagesSurfaceFn);
        }
    };

    if (mode === 'off') {
        reschedule();
        return;
    }

    if (state.updateStage !== 'idle') {
        reschedule();
        return;
    }

    const lastCheck = Number(state.settings?.lastUpdateCheckTime || 0);
    const intervalHours = Number(state.settings?.updateCheckIntervalHours || 24);
    const nowSec = Math.floor(Date.now() / 1000);

    let currentIntervalSec = intervalHours * 3600;
    if (state.updateBackoffCount > 0) {
        const backoffHours = Math.min(24, Math.pow(2, state.updateBackoffCount - 1));
        currentIntervalSec = backoffHours * 3600;
    }

    const elapsed = nowSec - lastCheck;
    if (!force && elapsed < currentIntervalSec) {
        reschedule();
        return;
    }

    state.updateStage = 'checking';
    state.updateStatusText = (t as any)('check_updates_auto') || t('checking_updates');
    syncManualUpdateCheckUI();

    try {
        const app = (window as unknown as { go: { main: { App: { CheckForUpdates: () => Promise<Record<string, unknown>> } } } }).go?.main.App;
        if (!app) return;
        const checkRes = await app.CheckForUpdates();
        state.updateCheckRes = checkRes;
        state.updateBackoffCount = 0;

        if (state.settings) {
            state.settings.lastUpdateCheckTime = nowSec;
        }

        if (!checkRes || !checkRes.new_version_available) {
            state.updateStage = 'idle';
            state.updateStatusText = t('up_to_date');
            syncManualUpdateCheckUI();
            reschedule();
            return;
        }

        const version = String(checkRes.version || '');
        if (mode === 'notify') {
            state.updateStage = 'available';
            state.updateStatusText = t('version_available', { version });
            state.updateBtnText = t('btn_download_now');
            state.updateBtnDisabled = false;
            syncManualUpdateCheckUI();

            state.notice = t('new_version_go_settings', { version });
            if (typeof updateMessagesSurfaceFn === 'function') {
                updateMessagesSurfaceFn();
            }
        } else {
            if (state.status?.state === 'busy') {
                state.updateStage = 'available';
                state.updateStatusText = (t as any)('postponed_transfer', { version }) || t('version_available', { version });
                syncManualUpdateCheckUI();
                reschedule();
                return;
            }
            await triggerDownloadUpdate(updateMessagesSurfaceFn);
            if ((state.updateStage as string) === 'ready') {
                if (mode === 'download') {
                    state.notice = t('update_ready_restart', { version });
                    if (typeof updateMessagesSurfaceFn === 'function') {
                        updateMessagesSurfaceFn();
                    }
                }
            }
            reschedule();
        }
    } catch (err) {
        state.updateBackoffCount = Math.min(5, (state.updateBackoffCount || 0) + 1);
        state.updateStage = 'idle';
        const cleanedErr = cleanLocalAddressError(err);
        state.updateStatusText = t('auto_check_failed', { err: cleanedErr });
        syncManualUpdateCheckUI();
        reschedule();
    }
}

export async function runManualUpdateCheck(syncSettingsFromDOMFn?: () => void): Promise<void> {
    if (state.updateStage === 'checking' || state.updateStage === 'downloading' || (state.updateStage as string) === 'installing') {
        return;
    }

    if (typeof syncSettingsFromDOMFn === 'function') {
        syncSettingsFromDOMFn();
    }

    if (state.updateBtnText === t('btn_retry')) {
        state.updateStage = 'idle';
        state.updateStatusText = t('click_manual_check');
        state.updateBtnText = t('btn_check');
        state.updateBtnDisabled = false;
        syncManualUpdateCheckUI();
    }

    if (state.updateStage === 'idle') {
        state.updateStage = 'checking';
        state.updateStatusText = t('checking_updates');
        state.updateBtnText = t('btn_checking');
        state.updateBtnDisabled = true;
        syncManualUpdateCheckUI();

        try {
            const app = (window as unknown as { go: { main: { App: { CheckForUpdates: () => Promise<Record<string, unknown>> } } } }).go?.main.App;
            if (!app) return;
            const checkRes = await app.CheckForUpdates();
            state.updateCheckRes = checkRes;

            if (!checkRes || !checkRes.new_version_available) {
                state.updateStage = 'idle';
                state.updateStatusText = t('up_to_date');
                state.updateBtnText = t('btn_check');
                state.updateBtnDisabled = false;
                syncManualUpdateCheckUI();
                return;
            }

            const mode = state.settings?.autoUpdateMode || 'download';
            if (mode === 'off' || mode === 'notify') {
                state.updateStage = 'available';
                const version = String(checkRes.version || '');
                state.updateStatusText = t('version_available', { version });
                state.updateBtnText = t('btn_download_now');
                state.updateBtnDisabled = false;
                syncManualUpdateCheckUI();
            } else {
                await triggerDownloadUpdate();
            }
        } catch (err) {
            state.updateStage = 'idle';
            const cleanedErr = cleanLocalAddressError(err);
            state.updateStatusText = t('download_failed', { err: cleanedErr });
            if (cleanedErr === 'Local service connection failed.') {
                state.updateBtnText = t('btn_retry');
            } else {
                state.updateBtnText = t('btn_check');
            }
            state.updateBtnDisabled = false;
            syncManualUpdateCheckUI();
        }
        return;
    }

    if (state.updateStage === 'available') {
        await triggerDownloadUpdate();
        return;
    }

    if (state.updateStage === 'ready') {
        state.updateStage = 'installing';
        state.updateStatusText = t('installing_updates');
        state.updateBtnText = t('btn_installing');
        state.updateBtnDisabled = true;
        syncManualUpdateCheckUI();

        try {
            const assetName = String(state.updateCheckRes?.asset_name || '');
            await (window as unknown as { go: { main: { App: { InstallUpdate: (asset: string) => Promise<void> } } } }).go?.main.App.InstallUpdate(assetName);
        } catch (err) {
            state.updateStage = 'ready';
            const cleanedErr = cleanLocalAddressError(err);
            state.updateStatusText = t('install_failed', { err: cleanedErr });
            if (cleanedErr === 'Local service connection failed.') {
                state.updateBtnText = t('btn_retry');
            } else {
                state.updateBtnText = t('btn_install_restart');
            }
            state.updateBtnDisabled = false;
            syncManualUpdateCheckUI();
        }
        return;
    }
}

export function scheduleAutoUpdateCheck(updateMessagesSurfaceFn?: () => void): void {
    if (autoUpdateTimer) {
        clearTimeout(autoUpdateTimer);
        autoUpdateTimer = null;
    }
    const mode = state.settings?.autoUpdateMode || 'download';
    if (mode === 'off') return;

    let delayMs = 60 * 60 * 1000;
    if (state.updateBackoffCount > 0) {
        const backoffHours = Math.min(24, Math.pow(2, state.updateBackoffCount - 1));
        delayMs = backoffHours * 60 * 60 * 1000;
    }

    autoUpdateTimer = window.setTimeout(() => {
        runAutoUpdateCheck(false, updateMessagesSurfaceFn).catch((e) => {
            console.error('[AutoUpdate] Background check execution failed:', e);
        });
    }, delayMs);
}
