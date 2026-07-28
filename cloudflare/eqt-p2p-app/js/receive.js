// Receive Mode Controller (Modular UI & Tus/WebRTC Upload)
window.initReceiveModule = function(token) {
    const mainEl = document.querySelector('main');
    if (!mainEl) return;

    mainEl.innerHTML = `
        <div class="brand-header">
            <span class="brand-title">EQT</span>
            <span class="pro-badge">PRO WAN</span>
        </div>
        <div class="status-card">
            <div class="file-icon-wrapper">📤</div>
            <div class="file-title">选择或拖拽文件上传</div>
            <div class="file-meta">发送文件到电脑端保存目录</div>
            <div class="status-pill" style="margin-bottom: 16px;">
                <span style="width: 6px; height: 6px; background: currentColor; border-radius: 50%;"></span>
                <span id="p2p-status-text">📡 正在初始化上传打洞...</span>
            </div>
            <input type="file" id="recv-file-input" style="display: none;">
            <button id="p2p-main-btn" class="btn-primary" onclick="document.getElementById('recv-file-input').click()">
                📂 选择物理文件上传
            </button>
        </div>
        <div class="footer-note">与局域网物理界面 100% 保持一致<br>Powered by EQT Easy QR Transfer</div>
    `;
};
