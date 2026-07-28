// Share Mode Controller (Unified LAN/WAN UI Adapter)
window.initShareModule = function(token) {
    if (!token) return;

    // Element References (Identical to LAN download.tmpl.html)
    const headerText = document.getElementById('header-text');
    const summaryText = document.getElementById('summary-text');
    const packageNameText = document.getElementById('package-name-text');
    const transferStatsMeta = document.getElementById('transfer-stats-meta');
    const filesListContainer = document.getElementById('files-list-container');
    const fileNameText = document.getElementById('file-name-text');
    const fileSizeText = document.getElementById('file-size-text');
    const mainBtn = document.getElementById('btn-action-download');
    const langSelect = document.getElementById('page-lang-select');
    const statusIconPending = document.getElementById('status-icon-pending');
    const statusIconSuccess = document.getElementById('status-icon-success');

    // Progress Bar References
    const progressContainer = document.getElementById('download-progress-container');
    const progressPercent = document.getElementById('download-progress-percent');
    const progressFill = document.getElementById('download-progress-fill');
    const progressBytes = document.getElementById('download-progress-bytes');
    const progressStatus = document.getElementById('download-progress-status');

    function formatBytes(bytes) {
        if (bytes === 0 || !bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    // Language i18n Dictionary (Shared with LAN download.tmpl.html)
    const translations = {
        zh: {
            header: '文件已准备就绪',
            connecting: '📡 正在打通公网信令与加密 P2P 通道...',
            waiting_pc: '⏳ 等待 P2P 物理连接...',
            meta_received: '⚡ 公网 P2P 通道打通，文件已就绪！',
            btn_download: '开始下载',
            btn_resave: '🎉 重新保存',
            success_header: '✅ 传输成功',
            success_summary: '文件已成功接收并保存至您的设备！',
            saved_file: '待接收文件',
            wan_tips: '已启用端到端加密公网传输通道，无需处于同一个局域网。'
        },
        en: {
            header: 'File Ready for Download',
            connecting: '📡 Establishing WAN Signaling & Encrypted P2P Channel...',
            waiting_pc: '⏳ Waiting for P2P Connection...',
            meta_received: '⚡ P2P Channel Ready! File is ready to download.',
            btn_download: 'Start Download',
            btn_resave: '🎉 Save Again',
            success_header: '✅ Transfer Completed',
            success_summary: 'File received and saved successfully!',
            saved_file: 'File to Receive',
            wan_tips: 'End-to-End Encrypted WAN Transport. No LAN required.'
        }
    };

    let currentLang = 'zh';
    if (langSelect) {
        langSelect.addEventListener('change', (e) => {
            currentLang = e.target.value;
            applyTranslations();
        });
    }

    function applyTranslations() {
        const dict = translations[currentLang] || translations.zh;
        if (headerText && !headerText.dataset.custom) headerText.innerText = dict.header;
        if (summaryText && !summaryText.dataset.custom) summaryText.innerText = dict.connecting;
    }

    const transport = new window.EQTTransport(token);
    let downloadedBlob = null;
    let currentFileName = 'downloaded_file';

    transport.onStatus = (msg, color) => {
        if (summaryText) {
            summaryText.innerText = msg;
            summaryText.dataset.custom = "true";
            if (color) summaryText.style.color = color;
        }
    };

    transport.onMeta = (name, size) => {
        currentFileName = name || currentFileName;
        const formattedSize = formatBytes(size);

        if (packageNameText) packageNameText.innerText = currentFileName;
        if (fileNameText) fileNameText.innerText = currentFileName;
        if (fileSizeText) fileSizeText.innerText = formattedSize;
        if (transferStatsMeta) {
            transferStatsMeta.innerText = `1 · ${formattedSize}`;
            transferStatsMeta.setAttribute('data-size', formattedSize);
        }

        if (summaryText) {
            const dict = translations[currentLang] || translations.zh;
            summaryText.innerText = dict.meta_received;
            summaryText.style.color = 'var(--text-secondary)';
        }

        if (mainBtn) {
            const dict = translations[currentLang] || translations.zh;
            mainBtn.disabled = false;
            mainBtn.innerText = dict.btn_download;
            mainBtn.onclick = () => {
                mainBtn.disabled = true;
                mainBtn.innerText = '⏳ 正在传输...';
                if (progressContainer) progressContainer.style.display = 'block';
                transport.requestDownload();
            };
        }
    };

    transport.onProgress = (done, total) => {
        if (progressContainer) progressContainer.style.display = 'block';
        const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
        if (progressPercent) progressPercent.innerText = `${percent}%`;
        if (progressFill) progressFill.style.width = `${percent}%`;
        if (progressBytes) progressBytes.innerText = `${formatBytes(done)} / ${formatBytes(total)}`;
        if (progressStatus) progressStatus.innerText = `⚡ 正在接收 ${percent}%...`;
    };

    transport.onComplete = (blob, name) => {
        downloadedBlob = blob;
        currentFileName = name || currentFileName;

        if (statusIconPending) statusIconPending.style.display = 'none';
        if (statusIconSuccess) statusIconSuccess.style.display = 'inline-flex';

        const dict = translations[currentLang] || translations.zh;
        if (headerText) {
            headerText.innerText = dict.success_header;
            headerText.dataset.custom = "true";
        }
        if (summaryText) {
            summaryText.innerText = dict.success_summary;
            summaryText.dataset.custom = "true";
            summaryText.style.color = 'var(--accent-strong)';
        }

        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = currentFileName;
        a.click();

        if (mainBtn) {
            mainBtn.disabled = false;
            mainBtn.innerText = dict.btn_resave;
            mainBtn.onclick = () => a.click();
        }
    };

    transport.initReceiver();
};

