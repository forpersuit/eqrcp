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
            
            <!-- 单行极简连接阶段进度指示控件 -->
            <div id="phase-timeline-bar" class="phase-timeline" style="margin-bottom: 16px; padding: 6px 12px; background: var(--accent-light); border: 1px solid var(--accent-border); border-radius: 8px; display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 600; color: var(--accent-strong);">
                <span id="phase-badge" style="background: var(--accent); color: white; padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; flex-shrink: 0;">1/5</span>
                <span id="phase-text" style="flex: 1; text-align: left; margin-left: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">正在加入公网信令房间...</span>
                <span id="phase-spinner" style="display: inline-block; width: 12px; height: 12px; border: 2px solid var(--accent); border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; flex-shrink: 0;"></span>
            </div>

            <p id="summary-text" class="summary" data-i18n="wait_tips" style="display: none;">📡 正在打通公网信令与加密 P2P 通道...</p>

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

            <div class="wifi-warning-box" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; margin-bottom: 20px;">
                <span id="wan-tips-text" data-i18n="wan_tips" style="font-weight: 700; font-size: 14px;">公网</span>
                <span class="license-badge" style="position: static; font-size: 11px; padding: 2px 8px;">PRO WAN</span>
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
    if (typeof window.EQTTransport !== 'function') {
        setTimeout(() => window.initShareModule(token), 50);
        return;
    }

    const container = document.getElementById('app') || document.querySelector('main') || document.body;
    if (container) renderShareView(container);

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

    // Phase Timeline Control References
    const phaseTimelineBar = document.getElementById('phase-timeline-bar');
    const phaseBadge = document.getElementById('phase-badge');
    const phaseText = document.getElementById('phase-text');
    const phaseSpinner = document.getElementById('phase-spinner');

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
            wan_tips: '公网'
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
            wan_tips: 'WAN'
        },
        ja: {
            header: 'ダウンロードの受取準備完了',
            connecting: '📡 接続確立中...',
            waiting_pc: '⏳ 接続待機中...',
            meta_received: '⚡ 共有完了！ダウンロード可能です。',
            btn_download: 'ダウンロード開始',
            btn_resave: '🎉 再保存',
            success_header: '✅ 転送完了',
            success_summary: '正常に保存されました。',
            saved_file: '受信ファイル',
            wan_tips: '公衆網 (WAN)'
        },
        ko: {
            header: '다운로드 준비 완료',
            connecting: '📡 연결 중...',
            waiting_pc: '⏳ 대기 중...',
            meta_received: '⚡ 공유 완료! 다운로드 가능합니다.',
            btn_download: '다운로드 시작',
            btn_resave: '🎉 다시 저장',
            success_header: '✅ 전송 완료',
            success_summary: '성공적으로 저장되었습니다.',
            saved_file: '수신 파일',
            wan_tips: '공용망 (WAN)'
        },
        es: {
            header: 'Archivo listo para descargar',
            connecting: '📡 Conectando...',
            waiting_pc: '⏳ Esperando...',
            meta_received: '⚡ ¡Listo para descargar!',
            btn_download: 'Descargar',
            btn_resave: '🎉 Guardar de nuevo',
            success_header: '✅ Transferencia completada',
            success_summary: 'Guardado con éxito.',
            saved_file: 'Archivo a recibir',
            wan_tips: 'WAN'
        },
        de: {
            header: 'Datei bereit zum Download',
            connecting: '📡 Verbindung wird aufgebaut...',
            waiting_pc: '⏳ Warten...',
            meta_received: '⚡ Bereit zum Download!',
            btn_download: 'Herunterladen',
            btn_resave: '🎉 Erneut speichern',
            success_header: '✅ Übertragung abgeschlossen',
            success_summary: 'Erfolgreich gespeichert.',
            saved_file: 'Zu empfangende Datei',
            wan_tips: 'WAN'
        },
        fr: {
            header: 'Fichier prêt à télécharger',
            connecting: '📡 Connexion en cours...',
            waiting_pc: '⏳ En attente...',
            meta_received: '⚡ Prêt à télécharger !',
            btn_download: 'Télécharger',
            btn_resave: '🎉 Enregistrer à nouveau',
            success_header: '✅ Transfert terminé',
            success_summary: 'Enregistré avec succès.',
            saved_file: 'Fichier à recevoir',
            wan_tips: 'WAN'
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
    window.transport = transport;
    let downloadedBlob = null;
    let currentFileName = 'downloaded_file';

    transport.onPhase = (step, total, msg, isError) => {
        if (phaseBadge) phaseBadge.innerText = `${step}/${total}`;
        if (phaseText) phaseText.innerText = msg;
        const p2pStatusText = document.getElementById('p2p-status-text');
        if (p2pStatusText) p2pStatusText.innerText = `[${step}/${total}] ${msg}`;
        if (isError) {
            if (phaseBadge) {
                phaseBadge.innerText = '错误';
                phaseBadge.style.background = 'var(--danger)';
            }
            if (phaseTimelineBar) {
                phaseTimelineBar.style.background = 'var(--danger-light)';
                phaseTimelineBar.style.borderColor = 'var(--danger-border)';
                phaseTimelineBar.style.color = 'var(--danger)';
            }
            if (phaseSpinner) phaseSpinner.style.display = 'none';
        }
    };

    transport.onStatus = (msg, color) => {
        if (summaryText) {
            summaryText.innerText = msg;
            summaryText.dataset.custom = "true";
            if (color) summaryText.style.color = color;
        }
        const p2pStatusText = document.getElementById('p2p-status-text');
        if (p2pStatusText) {
            p2pStatusText.innerText = msg;
            if (color && p2pStatusText.parentElement) p2pStatusText.parentElement.style.color = color;
        }
    };

    transport.onMeta = (name, size) => {
        currentFileName = name || currentFileName;
        const formattedSize = formatBytes(size);

        const shareFileName = document.getElementById('share-file-name');
        if (shareFileName) shareFileName.innerText = currentFileName;
        if (packageNameText) packageNameText.innerText = currentFileName;
        if (fileNameText) fileNameText.innerText = currentFileName;

        const shareFileMeta = document.getElementById('share-file-meta');
        if (shareFileMeta) shareFileMeta.innerText = `大小: ${formattedSize} · 物理传输准备就绪`;
        if (fileSizeText) fileSizeText.innerText = formattedSize;
        if (transferStatsMeta) {
            transferStatsMeta.innerText = `1 · ${formattedSize}`;
            transferStatsMeta.setAttribute('data-size', formattedSize);
        }

        // Complete 5/5 Phase UI Updates
        if (phaseBadge) {
            phaseBadge.innerText = '5/5';
            phaseBadge.style.background = 'var(--accent)';
        }
        if (phaseText) phaseText.innerText = '✅ 物理打通，文件准备就绪！';
        if (summaryText) {
            summaryText.style.display = 'block';
            summaryText.innerText = '⚡ 物理通道: UDP P2P 反射直连已打通 (STUN Hole-Punch Complete)';
            summaryText.style.color = 'var(--accent-strong)';
        }
        if (phaseTimelineBar) {
            phaseTimelineBar.style.background = 'var(--accent-light)';
            phaseTimelineBar.style.borderColor = 'var(--accent-border)';
            phaseTimelineBar.style.color = 'var(--accent-strong)';
        }
        if (phaseSpinner) phaseSpinner.style.display = 'none';

        const p2pStatusText = document.getElementById('p2p-status-text');
        if (p2pStatusText) {
            p2pStatusText.innerText = '⚡ P2P 物理直连成功，点击开始下载！';
            if (p2pStatusText.parentElement) p2pStatusText.parentElement.style.color = '#059669';
        }

        const p2pMainBtn = document.getElementById('p2p-main-btn');
        if (p2pMainBtn) {
            p2pMainBtn.disabled = false;
            p2pMainBtn.className = 'btn-primary ready';
            p2pMainBtn.innerHTML = '⚡ 点击开始极速下载 (' + formattedSize + ')';
            p2pMainBtn.onclick = () => {
                p2pMainBtn.disabled = true;
                p2pMainBtn.innerHTML = '⏳ 正在物理传输中...';
                transport.requestDownload();
            };
        }

        if (mainBtn) {
            mainBtn.disabled = false;
            mainBtn.className = 'btn ready';
            mainBtn.innerHTML = '⚡ 点击开始极速下载 (' + formattedSize + ')';
            mainBtn.onclick = () => {
                mainBtn.disabled = true;
                mainBtn.innerHTML = '⏳ 正在物理传输中...';
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
        if (!window._lastProgressTime) {
            window._lastProgressTime = Date.now();
            window._lastProgressBytes = done;
        } else {
            const now = Date.now();
            const timeDiff = (now - window._lastProgressTime) / 1000;
            if (timeDiff >= 0.5) {
                const bytesDiff = done - window._lastProgressBytes;
                const speedMBs = ((bytesDiff / (1024 * 1024)) / timeDiff).toFixed(2);
                window._lastProgressTime = now;
                window._lastProgressBytes = done;
                if (summaryText) {
                    summaryText.innerText = `⚡ 物理直连实时速率: ${speedMBs} MB/s | 已接收 ${formatBytes(done)} / ${formatBytes(total)}`;
                }
            }
        }
    };

    transport.onComplete = (blob, name) => {
        downloadedBlob = blob;
        currentFileName = name || currentFileName;

        if (phaseBadge) {
            phaseBadge.innerText = '完成';
            phaseBadge.style.background = 'var(--accent)';
        }
        if (phaseText) phaseText.innerText = '🎉 物理传输已完成！';

        const p2pStatusText = document.getElementById('p2p-status-text');
        if (p2pStatusText) {
            p2pStatusText.innerText = '🎉 物理传输完成！';
            if (p2pStatusText.parentElement) p2pStatusText.parentElement.style.color = '#059669';
        }

        const p2pMainBtn = document.getElementById('p2p-main-btn');
        if (p2pMainBtn) {
            p2pMainBtn.disabled = false;
            p2pMainBtn.className = 'btn-primary success';
            p2pMainBtn.innerHTML = '🎉 重新保存文件';
            p2pMainBtn.onclick = () => {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(downloadedBlob);
                a.download = currentFileName;
                a.click();
            };
        }

        if (mainBtn) {
            mainBtn.disabled = false;
            mainBtn.className = 'btn success';
            mainBtn.innerHTML = '🎉 重新保存文件';
            mainBtn.onclick = () => {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(downloadedBlob);
                a.download = currentFileName;
                a.click();
            };
        }

        try {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(downloadedBlob);
            a.download = currentFileName;
            a.click();
        } catch(e) {}
    };

    window.eqtReceiver = transport;
    transport.initReceiver();
};

// Auto-initialize share module if token parameter is present in URL
(function() {
    try {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('token') || '';
        if (token && typeof window.initShareModule === 'function') {
            window.initShareModule(token);
        }
    } catch(e) {}
})();

