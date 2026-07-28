// Chat Mode Controller (Modular Dual P2P Messaging)
window.initChatModule = function(token, join) {
    const mainEl = document.querySelector('main');
    if (!mainEl) return;

    mainEl.innerHTML = `
        <div style="width: min(100%, 480px); height: 85vh; display: flex; flex-direction: column;">
            <div class="brand-header" style="margin-bottom: 12px;">
                <span class="brand-title">EQT Chat</span>
                <span class="pro-badge">PRO WAN</span>
            </div>
            <div class="status-card" style="flex: 1; display: flex; flex-direction: column; padding: 16px; margin-bottom: 12px; overflow: hidden;">
                <div class="status-pill" style="align-self: center; margin-bottom: 12px;">
                    <span style="width: 6px; height: 6px; background: currentColor; border-radius: 50%;"></span>
                    <span id="p2p-status-text">💬 建立加密双向 P2P 聊天...</span>
                </div>
                <div id="chat-messages" style="flex: 1; overflow-y: auto; text-align: left; display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; padding: 8px; background: var(--bg); border-radius: 12px;">
                    <div style="align-self: flex-start; background: var(--surface); border: 1px solid var(--line); padding: 8px 12px; border-radius: 10px; font-size: 13px;">
                        系统: 欢迎进入 EQT 双向公网 P2P 加密聊天室！
                    </div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <input type="text" id="chat-input" placeholder="输入消息..." style="flex: 1; background: var(--bg); border: 1px solid var(--line); color: var(--text-primary); padding: 10px; border-radius: 8px; font-size: 14px;">
                    <button class="btn-primary" style="width: auto; padding: 10px 16px;">发送</button>
                </div>
            </div>
            <div class="footer-note">与局域网物理界面 100% 保持一致<br>Powered by EQT Easy QR Transfer</div>
        </div>
    `;
};
