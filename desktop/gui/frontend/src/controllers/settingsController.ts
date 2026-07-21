import { state, DesktopSettings } from '../state';
import { cleanChatProfileName, cleanChatAvatar } from '../utils/domUtils';
import {
    SaveSettings,
    ChatSaveDirectory,
    SelectReceiveDirectory,
    SetRightClickIntegrationEnabled,
    SetStartupEnabled,
} from '../../wailsjs/go/main/App';

export function syncSettingsFromDOM(): void {
    if (!state.settings) return;
    const receiveInput = document.querySelector<HTMLInputElement>('#receive-dir');
    const receiveBrowser = document.querySelector<HTMLInputElement>('#browser-open');
    const sideBrowser = document.querySelector<HTMLInputElement>('#settings-browser');
    const chatAutoSave = document.querySelector<HTMLInputElement>('#settings-chat-autosave');
    const chatDownloadDir = document.querySelector<HTMLInputElement>('#settings-chat-download-dir');
    const enableChatV2 = document.querySelector<HTMLInputElement>('#settings-chat-v2');
    const closeBehavior = document.querySelector<HTMLSelectElement>('#settings-close-behavior');
    const iface = document.querySelector<HTMLInputElement | HTMLSelectElement>('#settings-interface');
    const port = document.querySelector<HTMLInputElement>('#settings-port');
    const chatSender = document.querySelector<HTMLInputElement>('#settings-chat-sender');
    const chatAvatar = document.querySelector<HTMLInputElement>('#settings-chat-avatar');
    const autoUpdateMode = document.querySelector<HTMLSelectElement>('#settings-auto-update-mode');
    const updateInterval = document.querySelector<HTMLSelectElement>('#settings-update-interval');
    const lang = document.querySelector<HTMLSelectElement>('#settings-lang');
    const showHistory = document.querySelector<HTMLInputElement>('#settings-show-history');

    if (receiveInput) state.settings.output = receiveInput.value;
    if (receiveBrowser) state.settings.browser = receiveBrowser.checked;
    if (sideBrowser) state.settings.browser = sideBrowser.checked;
    if (chatAutoSave) state.settings.chatAutoSave = chatAutoSave.checked;
    if (chatDownloadDir) state.settings.chatDownloadDir = chatDownloadDir.value;
    if (enableChatV2) state.settings.enableChatV2 = enableChatV2.checked;
    if (closeBehavior) state.settings.closeBehavior = closeBehavior.value;
    const logDir = document.querySelector<HTMLInputElement>('#dev-log-dir');
    if (logDir) state.settings.logDir = logDir.value.trim();
    if (iface) state.settings.interface = iface.value;
    if (port) state.settings.port = Number(port.value);
    if (chatSender) state.settings.chatSender = cleanChatProfileName(chatSender.value);
    if (chatAvatar) state.settings.chatAvatar = cleanChatAvatar(chatAvatar.value);
    if (autoUpdateMode) state.settings.autoUpdateMode = autoUpdateMode.value;
    if (updateInterval) state.settings.updateCheckIntervalHours = Number(updateInterval.value);
    if (lang) state.settings.lang = lang.value;
    if (showHistory) state.settings.showHistory = showHistory.checked;

    state.receiveDir = state.settings.output || '';
    state.browserFallback = Boolean(state.settings.browser);
    state.chatAutoSave = state.settings.chatAutoSave !== false;
    state.closeBehavior = state.settings.closeBehavior === 'quit' ? 'quit' : 'tray';
}

export interface SettingsCallbacks {
    syncIdentityToChatFrame?: () => void;
    updateIntegrationRow?: (kind: 'right-click' | 'startup') => void;
    render?: () => void;
    syncPanelSurface?: () => void;
    bindHelpTooltip?: (el: Element) => void;
    openChatSaveDirectory?: () => void;
    handleAutoSaveSettings?: () => Promise<void>;
    activeChatFrameOrigin?: () => string;
}

export async function saveSettingsData(callbacks?: SettingsCallbacks): Promise<void> {
    syncSettingsFromDOM();
    const settings: DesktopSettings = {
        ...(state.settings || {}),
        devMode: Boolean(state.settings?.devMode ?? false),
        debugLog: Boolean(state.settings?.debugLog ?? false),
        viewportDebug: Boolean(state.settings?.viewportDebug ?? false),
    };
    state.settings = await SaveSettings(settings as any);
    state.receiveDir = state.settings.output || '';
    state.browserFallback = Boolean(state.settings.browser);
    state.chatAutoSave = state.settings.chatAutoSave !== false;
    state.chatSaveDir = state.settings.chatDownloadDir || (await ChatSaveDirectory());
    state.closeBehavior = state.settings.closeBehavior === 'quit' ? 'quit' : 'tray';
    syncViewportDebugToChatFrame(callbacks?.activeChatFrameOrigin?.());
    callbacks?.syncIdentityToChatFrame?.();
}

export function syncViewportDebugToChatFrame(activeOrigin = '*'): void {
    const frame = document.querySelector<HTMLIFrameElement>('#chat-iframe');
    if (!frame) return;
    const enabled = Boolean(state.settings?.viewportDebug ?? false);

    let hostMetrics: Record<string, unknown> | null = null;
    if (enabled) {
        const workspace = document.querySelector('.workspace');
        const shell = document.querySelector('.shell');
        hostMetrics = {
            inner: { width: window.innerWidth, height: window.innerHeight },
            workspace: workspace
                ? {
                      x: Math.round(workspace.getBoundingClientRect().left),
                      y: Math.round(workspace.getBoundingClientRect().top),
                      width: Math.round(workspace.getBoundingClientRect().width),
                      height: Math.round(workspace.getBoundingClientRect().height),
                  }
                : null,
            shell: shell
                ? {
                      x: Math.round(shell.getBoundingClientRect().left),
                      y: Math.round(shell.getBoundingClientRect().top),
                      width: Math.round(shell.getBoundingClientRect().width),
                      height: Math.round(shell.getBoundingClientRect().height),
                  }
                : null,
        };
    }

    const payload = {
        type: 'update-viewport-debug',
        enabled,
        hostMetrics,
    };
    const post = () => {
        try {
            frame.contentWindow?.postMessage(payload, activeOrigin || '*');
        } catch {
            // Ignored
        }
    };
    frame.addEventListener('load', post, { once: true });
    window.setTimeout(post, 0);
}

export async function toggleRightClickIntegration(event: Event, callbacks?: SettingsCallbacks): Promise<void> {
    const target = event.currentTarget as HTMLInputElement | null;
    const enabled = Boolean(target?.checked);
    if (target) target.disabled = true;
    try {
        state.rightClickIntegration = await SetRightClickIntegrationEnabled(enabled);
        callbacks?.updateIntegrationRow?.('right-click');
    } catch (error: unknown) {
        state.error = (error as { message?: string })?.message || String(error);
        if (target) {
            target.checked = !enabled;
            target.disabled = false;
        }
        callbacks?.render?.();
    }
}

export async function toggleStartupIntegration(event: Event, callbacks?: SettingsCallbacks): Promise<void> {
    const target = event.currentTarget as HTMLInputElement | null;
    const enabled = Boolean(target?.checked);
    if (target) target.disabled = true;
    try {
        state.startupIntegration = await SetStartupEnabled(enabled);
        callbacks?.updateIntegrationRow?.('startup');
    } catch (error: unknown) {
        state.error = (error as { message?: string })?.message || String(error);
        if (target) {
            target.checked = !enabled;
            target.disabled = false;
        }
        callbacks?.render?.();
    }
}

export function bindSettingsControls(callbacks?: SettingsCallbacks): void {
    document.querySelector('#settings-right-click')?.addEventListener('change', (e) => toggleRightClickIntegration(e, callbacks));
    document.querySelector('#settings-startup')?.addEventListener('change', (e) => toggleStartupIntegration(e, callbacks));
    if (callbacks?.bindHelpTooltip) {
        document.querySelectorAll('[data-help]').forEach(callbacks.bindHelpTooltip);
    }
    if (callbacks?.openChatSaveDirectory) {
        document.querySelector('#open-chat-save')?.addEventListener('click', callbacks.openChatSaveDirectory);
    }
    document.querySelector('#btn-select-chat-download-dir')?.addEventListener('click', async () => {
        try {
            const dir = await SelectReceiveDirectory();
            if (dir) {
                const input = document.querySelector<HTMLInputElement>('#settings-chat-download-dir');
                if (input) {
                    input.value = dir;
                    syncSettingsFromDOM();
                    if (callbacks?.handleAutoSaveSettings) {
                        await callbacks.handleAutoSaveSettings();
                    }
                    callbacks?.syncPanelSurface?.();
                }
            }
        } catch (err: unknown) {
            console.error('Failed to select chat download directory:', err);
        }
    });

    document.querySelector('.edit-chat-sender')?.addEventListener('click', () => {
        state.isEditingChatSender = true;
        callbacks?.syncPanelSurface?.();
        const inputEl = document.querySelector<HTMLInputElement>('#settings-chat-sender');
        if (inputEl) {
            inputEl.focus();
            inputEl.select();
        }
    });

    document.querySelector('.cancel-chat-sender')?.addEventListener('click', () => {
        state.isEditingChatSender = false;
        callbacks?.syncPanelSurface?.();
    });

    document.querySelector('.save-chat-sender')?.addEventListener('click', async () => {
        const inputEl = document.querySelector<HTMLInputElement>('#settings-chat-sender');
        if (inputEl && state.settings) {
            const newName = cleanChatProfileName(inputEl.value);
            state.settings.chatSender = newName;
            state.isEditingChatSender = false;
            if (callbacks?.handleAutoSaveSettings) {
                await callbacks.handleAutoSaveSettings();
            }
            callbacks?.syncPanelSurface?.();
        }
    });

    const chatSenderInput = document.querySelector<HTMLInputElement>('#settings-chat-sender');
    if (chatSenderInput) {
        chatSenderInput.addEventListener('keydown', async (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                document.querySelector<HTMLButtonElement>('.save-chat-sender')?.click();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                document.querySelector<HTMLButtonElement>('.cancel-chat-sender')?.click();
            }
        });
    }
}
