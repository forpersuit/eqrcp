// Share Mode Controller (Modular UI & Transport Adapter)

function renderShareView(container) {
    if (!container) return;
    container.innerHTML = `
        <div class="brand-header">
            <span class="brand-title">EQT</span>
            <span class="license-badge" style="position: static;">PRO WAN</span>
        </div>

        <div class="status-card">
            <div id="status-icon-pending" class="status-badge ready">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </div>
            <div id="status-icon-success" class="status-badge success" style="display: none;">✓</div>

            <h1 id="header-text" data-i18n="header">File Ready for Download</h1>
            <p id="summary-text" class="summary" data-i18n="wait_tips">📡 正在打通公网信令与加密 P2P 通道...</p>

            <!-- Download Progress Bar Section -->
            <div id="download-progress-container" style="display: none; width: 100%; margin: 15px 0 10px 0; box-sizing: border-box; background: var(--bg-hover); padding: 12px; border-radius: 8px; border: 1px solid var(--line);">
                <div style="display: flex; justify-content: space-between; font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; font-weight: 600;">
                    <span id="download-progress-status">Downloading...</span>
                    <span id="download-progress-percent">0%</span>
                </div>
                <div style="width: 100%; height: 6px; background: rgba(0,0,0,0.06); border-radius: 4px; overflow: hidden; position: relative;">
                    <div id="download-progress-fill" style="width: 0%; height: 100%; background: var(--accent); border-radius: 4px; transition: width 0.2s ease;"></div>
                </div>
                <div id="download-progress-bytes" style="font-size: 11px; color: var(--text-secondary); margin-top: 5px; text-align: left; font-weight: 500;">0 B / 0 B</div>
            </div>

            <div class="wifi-warning-box">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span data-i18n="wan_tips">已启用端到端加密公网传输通道，无需处于同一个局域网。</span>
            </div>

            <!-- 接收包名卡片 -->
            <div class="package-name-card" style="margin: 14px 0 16px 0; padding: 10px 14px; background: var(--surface-soft); border: 1px solid var(--line); border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 8px; word-break: break-all;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                <span id="package-name-text" class="package-name-text" style="font-size: 14px; font-weight: 700; color: var(--text-primary);">准备接收文件</span>
            </div>

            <!-- 待接收文件标题与统计信息横向排列 -->
            <div class="section-title-row" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; width: 100%; box-sizing: border-box;">
                <span class="section-title" style="margin-bottom: 0; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" data-i18n="saved_file">File to Receive</span>
                <span id="transfer-stats-meta" class="transfer-stats-meta" style="font-size: 13px; color: var(--text-secondary); font-weight: 600; flex-shrink: 0; white-space: nowrap; text-align: right;" data-count="1" data-size="0 KB">
                    1 · -- KB
                </span>
            </div>
            
            <div id="files-list-container" style="text-align: left; margin-bottom: 20px;">
                <div class="file-fallback">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <span id="file-name-text" class="file-name">正在等待电脑端发送元数据...</span>
                    <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                        <span id="file-size-text" style="font-size: 12px; color: var(--text-secondary);">-- KB</span>
                    </div>
                </div>
            </div>

            <div id="action-btn-row" style="display: flex; flex-direction: column; gap: 8px;">
                <button type="button" class="btn" id="btn-action-download" disabled data-i18n="btn_download">⏳ 等待 P2P 物理连接...</button>
            </div>
        </div>

        <p class="hint" data-i18n="close_hint">Once successfully completed, you can close this page.</p>

        <div class="lang-switch-container">
            <select id="page-lang-select" aria-label="Switch Language">
                <option value="zh">简体中文</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
                <option value="es">Español</option>
                <option value="de">Deutsch</option>
                <option value="fr">Français</option>
            </select>
        </div>
    `;
}

window.initShareModule = function(token) {
    if (!token) return;

    const mainEl = document.querySelector('main');
    if (mainEl) renderShareView(mainEl);

    // Element References (Identical to LAN download.tmpl.html)
    const headerText = document.getElementById('header-text');
    const summaryText = document.getElementById('summary-text');
    const packageNameText = document.getElementById('package-name-text');
    const transferStatsMeta = document.getElementById('transfer-stats-meta');
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


