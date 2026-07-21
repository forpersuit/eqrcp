import { LogInfo, OnFileDrop } from '../wailsjs/runtime/runtime';
import type { AppState } from './state';

declare global {
    interface Window {
        showChatDragOverlay: () => void;
        hideChatDragOverlay: () => void;
    }
}

let stateRef: AppState | null = null;

export function initDragDrop(appState: AppState, onFileDropped?: (paths: string[]) => void): void {
    stateRef = appState;

    // Listen to physical file drops forwarded by Wails Win32 handles
    if (typeof OnFileDrop === 'function') {
        try {
            OnFileDrop((_x: number, _y: number, paths: string[]) => {
                sendDebugMessageToChat('[Wails Drag] OnFileDrop triggered: ' + JSON.stringify(paths));
                if (typeof onFileDropped === 'function') {
                    onFileDropped(paths);
                }
            }, true);
        } catch (err) {
            console.warn('[DragDrop] Wails OnFileDrop not supported in standard browser preview:', err);
        }
    }

    // Message bridge listener for child iframe events
    window.addEventListener('message', (e: MessageEvent) => {
        if (e.data?.type === 'iframe-drag-active') {
            sendDebugMessageToChat('[Host] Received iframe-drag-active, showing drag overlay');
            showChatDragOverlay();
        }
    });

    // Global desktop fallback preventDefaults
    window.addEventListener('dragover', (e: DragEvent) => {
        e.preventDefault();
    });

    window.addEventListener('drop', (e: DragEvent) => {
        e.preventDefault();
    });
}

export function showChatDragOverlay(): void {
    const el = document.getElementById('chat-drag-overlay');
    if (el) {
        el.classList.add('active');
    }
}

export function hideChatDragOverlay(): void {
    const el = document.getElementById('chat-drag-overlay');
    if (el) {
        el.classList.remove('active');
    }
}

// Export to window object for inline HTML event attribute handlers
if (typeof window !== 'undefined') {
    window.showChatDragOverlay = showChatDragOverlay;
    window.hideChatDragOverlay = hideChatDragOverlay;
}

export function sendDebugMessageToChat(msg: string): void {
    if (typeof LogInfo === 'function') {
        LogInfo(msg);
    }
    const frame = document.querySelector<HTMLIFrameElement>('#chat-iframe');
    if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage({
            type: 'chat-debug-notice',
            message: msg
        }, '*');
    }
}
