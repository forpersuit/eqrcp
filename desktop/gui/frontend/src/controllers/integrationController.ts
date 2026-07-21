import { state } from '../state';
import { t } from '../i18n';

export async function checkAutoStartStatus(): Promise<boolean> {
    try {
        const app = (window as unknown as { go: { main: { App: { IsAutoStartEnabled: () => Promise<boolean> } } } }).go?.main.App;
        if (!app) return false;
        return await app.IsAutoStartEnabled();
    } catch (err) {
        console.error('Failed to check autostart status:', err);
        return false;
    }
}

export async function toggleAutoStart(enabled: boolean): Promise<void> {
    try {
        const app = (window as unknown as { go: { main: { App: { SetAutoStartEnabled: (val: boolean) => Promise<void> } } } }).go?.main.App;
        if (!app) return;
        await app.SetAutoStartEnabled(enabled);
    } catch (err) {
        console.error('Failed to toggle autostart:', err);
    }
}

export async function checkContextMenuStatus(): Promise<boolean> {
    try {
        const app = (window as unknown as { go: { main: { App: { IsContextMenuEnabled: () => Promise<boolean> } } } }).go?.main.App;
        if (!app) return false;
        return await app.IsContextMenuEnabled();
    } catch (err) {
        console.error('Failed to check context menu status:', err);
        return false;
    }
}

export async function toggleContextMenu(enabled: boolean): Promise<void> {
    try {
        const app = (window as unknown as { go: { main: { App: { SetContextMenuEnabled: (val: boolean) => Promise<void> } } } }).go?.main.App;
        if (!app) return;
        await app.SetContextMenuEnabled(enabled);
    } catch (err) {
        console.error('Failed to toggle context menu:', err);
    }
}
