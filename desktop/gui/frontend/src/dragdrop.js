import { LogInfo, OnFileDrop } from '../wailsjs/runtime/runtime';

let stateRef = null;

export function initDragDrop(appState, onFileDropped) {
    stateRef = appState;

    // Listen to physical file drops forwarded by Wails Win32 handles
    if (typeof OnFileDrop === 'function') {
        try {
            OnFileDrop((_x, _y, paths) => {
                sendDebugMessageToChat('[Wails Drag] OnFileDrop triggered: ' + JSON.stringify(paths));
                if (typeof onFileDropped === 'function') {
                    onFileDropped(paths);
                }
            }, true);
        } catch (err) {
            console.warn('[DragDrop] Wails OnFileDrop not supported in standard browser preview');
        }
    }

    // Message bridge listener for child iframe events
    window.addEventListener('message', (e) => {
        if (e.data?.type === 'iframe-drag-active') {
            sendDebugMessageToChat('[Host] Received iframe-drag-active, showing drag overlay');
            showChatDragOverlay();
        }
    });

    // Global desktop fallback preventDefaults
    window.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    window.addEventListener('drop', (e) => {
        e.preventDefault();
    });
}

export function showChatDragOverlay() {
    const el = document.getElementById('chat-drag-overlay');
    if (el) {
        el.classList.add('active');
    }
}

export function hideChatDragOverlay() {
    const el = document.getElementById('chat-drag-overlay');
    if (el) {
        el.classList.remove('active');
    }
}

// Export to window object for inline HTML event attribute handlers
window.showChatDragOverlay = showChatDragOverlay;
window.hideChatDragOverlay = hideChatDragOverlay;

export function sendDebugMessageToChat(msg) {
    if (typeof LogInfo === 'function') {
        LogInfo(msg);
    }
    const frame = document.querySelector('#chat-iframe');
    if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage({
            type: 'chat-debug-notice',
            message: msg
        }, '*');
    }
}
