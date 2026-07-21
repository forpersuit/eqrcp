import { state } from '../state';

export function shouldProtectActiveInput(): boolean {
    const activeEl = document.activeElement;
    if (!activeEl) return false;

    // 1. 如果用户正在 Settings 或弹窗面板的输入框/文本域/下拉框中打字编辑
    if (state.activePanel && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')) {
        return true;
    }

    // 2. 如果用户正在历史搜索框中打字
    if (activeEl.id === 'history-search-input' || activeEl.closest('.search-input-box')) {
        return true;
    }

    return false;
}

export function updateSettingsBadgeUI(): void {
    const btn = document.querySelector<HTMLButtonElement>('#open-settings');
    if (!btn) return;
    let badge = btn.querySelector<HTMLSpanElement>('.badge-dot');
    const shouldShow = state.settings?.autoUpdateMode !== 'off' && (
        (state.settings?.autoUpdateMode === 'notify' && (state.updateStage === 'available' || state.updateStage === 'ready')) ||
        ((state.settings?.autoUpdateMode === 'download' || state.settings?.autoUpdateMode === 'silent') && state.updateStage === 'ready')
    );
    if (shouldShow) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'badge-dot';
            badge.style.cssText = 'position: absolute; top: 6px; right: 6px; width: 8px; height: 8px; background-color: var(--danger, #fc0035); border-radius: 50%; border: 1.5px solid var(--bg, #ffffff); pointer-events: none;';
            btn.appendChild(badge);
        }
    } else {
        if (badge) {
            badge.remove();
        }
    }
}
