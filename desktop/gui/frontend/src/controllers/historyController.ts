import { state } from '../state';
import { t } from '../i18n';
import { ClearHistory, RepeatTask } from '../../wailsjs/go/main/App';
import { HistoryTaskItem, MatchResultItem, renderHistory } from '../views/historyView';

export let searchQuery = '';
export let showSearchInput = false;
export let showSearchDropdown = false;
export let activeFocusTaskId: number | string | null = null;
export let activeFocusFilePath: string | null = null;
export let activeFocusDeviceName: string | null = null;

export function updateActiveFocus(id: number | string | null, filePath: string | null = null, deviceName: string | null = null): void {
    activeFocusTaskId = id;
    activeFocusFilePath = filePath;
    activeFocusDeviceName = deviceName;
}

export function toggleSearchDropdown(show: boolean): void {
    showSearchDropdown = show;
}

export function toggleSearchInput(): void {
    showSearchInput = !showSearchInput;
    if (!showSearchInput) {
        searchQuery = '';
        showSearchDropdown = false;
    }
}

export function updateSearchQuery(val: string): void {
    searchQuery = val;
}

function shortName(path?: string): string {
    return String(path || '').split(/[\\/]/).filter(Boolean).pop() || path || '';
}

export function getMatchResults(history: HistoryTaskItem[], query: string): MatchResultItem[] {
    if (!query || !query.trim()) return [];
    const q = query.trim().toLowerCase();
    const results: MatchResultItem[] = [];

    history.forEach((task) => {
        const actionText = (task.action === 'share' || task.action === 'send')
            ? t('share')
            : (task.action === 'receive' ? t('receive') : (task.action === 'chat' ? t('chat') : String(task.action)));
        const title = `${actionText} #${task.id}`;

        if (title.toLowerCase().includes(q)) {
            results.push({
                type: 'task',
                text: title,
                taskId: task.id,
                detail: `Task #${task.id}`,
            });
        }

        if (task.clientStates) {
            Object.values(task.clientStates).forEach((client) => {
                const rawName = client.deviceName || client.clientID || '';
                const clientName = rawName.replace(/\s*\([a-f0-9]{4}\)/i, '');
                if (clientName.toLowerCase().includes(q)) {
                    results.push({
                        type: 'device',
                        text: clientName,
                        taskId: task.id,
                        deviceName: clientName,
                        detail: `${t('device') || 'Device'} - ${title}`,
                    });
                }
            });
        }

        const files = task.action === 'receive' ? (task.savedFiles || []) : (task.paths || []);
        files.forEach((file) => {
            const name = shortName(file);
            if (name.toLowerCase().includes(q) || file.toLowerCase().includes(q)) {
                results.push({
                    type: 'file',
                    text: name,
                    taskId: task.id,
                    filePath: file,
                    detail: file,
                });
            }
        });
    });

    return results.slice(0, 15);
}

export function refreshHistoryListInDOM(lastFocusedTaskId?: number | string | null): void {
    const historyListWrapper = document.querySelector<HTMLElement>('.history-list-wrapper');
    const historyEl = document.querySelector<HTMLElement>('.history');
    if (historyListWrapper) {
        const savedScrollTop = historyEl ? historyEl.scrollTop : 0;
        const history: HistoryTaskItem[] = state.status?.history || [];
        historyListWrapper.innerHTML = renderHistory(history, searchQuery);

        const newHistoryEl = document.querySelector<HTMLElement>('.history');
        if (newHistoryEl) {
            if (lastFocusedTaskId) {
                const targetLi = newHistoryEl.querySelector(`#history-item-${lastFocusedTaskId}`);
                if (targetLi) {
                    targetLi.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                } else {
                    newHistoryEl.scrollTop = savedScrollTop;
                }
            } else {
                newHistoryEl.scrollTop = savedScrollTop;
            }
        }
    }
}

export async function clearHistory(renderCallback?: () => void): Promise<void> {
    try {
        await ClearHistory();
        state.notice = t('history_cleared');
        if (state.status) {
            state.status.history = [];
        }
        renderCallback?.();
    } catch (err: unknown) {
        state.error = String((err as { message?: string })?.message || err || 'Failed to clear history');
        renderCallback?.();
    }
}

export async function restoreSharePaths(taskId: number | string, renderCallback?: () => void): Promise<void> {
    const history: HistoryTaskItem[] = state.status?.history || [];
    const task = history.find((t) => String(t.id) === String(taskId));
    if (task && task.paths && task.paths.length > 0) {
        state.sharePaths = [...task.paths];
        state.mode = 'share';
        try {
            await RepeatTask(Number(taskId));
        } catch {
            // RepeatTask may be optional or best effort
        }
        renderCallback?.();
    }
}
