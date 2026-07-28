// Share Mode Controller (Modular UI & Transport)
window.initShareModule = function(token) {
    const mainEl = document.querySelector('main');
    if (!mainEl) return;

    mainEl.innerHTML = `
        <div class="brand-header">
            <span class="brand-title">EQT</span>
            <span class="pro-badge">PRO WAN</span>
        </div>
        <div class="status-card">
            <div id="share-file-icon" class="file-icon-wrapper">🖼️</div>
            <div id="share-file-name" class="file-title">准备接收文件</div>
            <div id="share-file-meta" class="file-meta">模式: 公网 Share 直管传送</div>
            <div class="status-pill">
                <span style="width: 6px; height: 6px; background: currentColor; border-radius: 50%;"></span>
                <span id="p2p-status-text">📡 正在连接公网信令...</span>
            </div>
            <button id="p2p-main-btn" class="btn-primary" disabled>
                ⏳ 等待电脑端 P2P 物理连接...
            </button>
        </div>
        <div class="footer-note">与局域网物理界面 100% 保持一致<br>Powered by EQT Easy QR Transfer</div>
    `;

    const transport = new window.EQTTransport(token);
    const statusText = document.getElementById('p2p-status-text');
    const fileNameEl = document.getElementById('share-file-name');
    const fileMetaEl = document.getElementById('share-file-meta');
    const mainBtn = document.getElementById('p2p-main-btn');

    transport.onStatus = (msg, color) => {
        if (statusText) {
            statusText.innerText = msg;
            statusText.parentElement.style.color = color;
        }
    };

    transport.onMeta = (name, size) => {
        if (fileNameEl) fileNameEl.innerText = name;
        if (fileMetaEl) fileMetaEl.innerText = `文件大小: ${Math.round(size / 1024)} KB`;
    };

    transport.onProgress = (done, total) => {
        if (statusText) {
            statusText.innerText = `📥 已接收: ${Math.round(done / 1024)} KB / ${Math.round(total / 1024)} KB`;
        }
    };

    transport.onComplete = (blob, name) => {
        if (statusText) {
            statusText.innerText = '✅ 接收完成！';
            statusText.parentElement.style.color = '#059669';
        }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();

        if (mainBtn) {
            mainBtn.innerText = '🎉 重新保存';
            mainBtn.onclick = () => a.click();
        }
    };

    transport.initReceiver();
};
