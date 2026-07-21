import { state } from '../state';
import { t } from '../i18n';

export function activeChatPageURL(): string | null {
    if (state.mode === 'chat' && state.status?.current?.action === 'chat' && state.status.current.pageUrl) {
        return state.status.current.pageUrl;
    }
    return null;
}

export function canKeepChatFrame(prevUrl: string | null): boolean {
    const currentUrl = activeChatPageURL();
    return Boolean(prevUrl && currentUrl && prevUrl === currentUrl);
}

export function loadChatUsage(): void {
    try {
        const dateKey = new Date().toISOString().slice(0, 10);
        const storedDate = localStorage.getItem('eqt_chat_usage_date');
        if (storedDate !== dateKey) {
            localStorage.setItem('eqt_chat_usage_date', dateKey);
            localStorage.setItem('eqt_chat_usage_seconds', '0');
            state.chatUsedSecondsToday = 0;
        } else {
            const secs = parseInt(localStorage.getItem('eqt_chat_usage_seconds') || '0', 10);
            state.chatUsedSecondsToday = isNaN(secs) ? 0 : secs;
        }
    } catch (e) {
        console.warn('localStorage not available for chat usage tracking:', e);
    }
}

export function addChatUsageSeconds(secs: number): void {
    state.chatUsedSecondsToday = (state.chatUsedSecondsToday || 0) + secs;
    try {
        const dateKey = new Date().toISOString().slice(0, 10);
        localStorage.setItem('eqt_chat_usage_date', dateKey);
        localStorage.setItem('eqt_chat_usage_seconds', String(state.chatUsedSecondsToday));
    } catch (e) {
        console.warn('Failed to save chat usage:', e);
    }
}

export function hasPaidLicense(): boolean {
    const lic = state.license;
    if (!lic || !lic.tier) return false;
    const tier = lic.tier.toUpperCase();
    return tier === 'PLUS' || tier === 'PRO' || tier === 'ENTERPRISE';
}

export function chatQuotaText(): string {
    if (hasPaidLicense()) {
        return (t as any)('chat_quota_unlimited') || 'Unlimited Chat Access';
    }
    const maxSecs = 30 * 60; // 30 minutes free daily quota
    const used = state.chatUsedSecondsToday || 0;
    const remainSecs = Math.max(0, maxSecs - used);
    const remainMins = Math.ceil(remainSecs / 60);
    return (t as any)('chat_quota_remaining', { mins: remainMins }) || `Remaining: ${remainMins} mins`;
}

export function postMessageToChatIframe(payload: Record<string, unknown>): void {
    const frame = document.querySelector<HTMLIFrameElement>('#chat-iframe');
    if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage(payload, '*');
    }
}
