<script lang="ts">
    import { onMount } from 'svelte';
    import { EQTTransport } from './lib/transport';
    import { translations, formatBytes } from './lib/i18n';
    import type { LanguageCode } from './lib/types';

    import BrandHeader from './components/BrandHeader.svelte';
    import PhaseTimeline from './components/PhaseTimeline.svelte';
    import TransferProgressCard from './components/TransferProgressCard.svelte';

    let currentLang: LanguageCode = 'zh';
    let token: string = '';
    let transport: EQTTransport | null = null;

    let step: number = 1;
    let totalSteps: number = 5;
    let phaseMsg: string = '正在初始化...';
    let isError: boolean = false;
    let statusMsg: string = '📡 正在打通公网信令与加密 P2P 通道...';
    let statusColor: string = '#d97706';

    let fileName: string = 'downloaded_file';
    let expectedSize: number = 0;
    let receivedSize: number = 0;
    let speedMBs: string = '0.00';
    let isDownloading: boolean = false;
    let isCompleted: boolean = false;
    let modeType: 'UDP-DIRECT' | 'SIGNAL-FALLBACK' | 'UNKNOWN' = 'UNKNOWN';
    let wanTipsLabel: string = '公网 WAN P2P';

    let downloadedBlob: Blob | null = null;
    let lastProgressTime: number = 0;
    let lastProgressBytes: number = 0;

    let debugLogs: string[] = [];

    $: dict = translations[currentLang] || translations.zh;
    $: btnDisabled = step < 5 && !isCompleted;

    function addLog(msg: string): void {
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        debugLogs = [...debugLogs, `[${time}] ${msg}`];
        if (debugLogs.length > 60) {
            debugLogs = debugLogs.slice(debugLogs.length - 60);
        }
    }

    onMount(() => {
        const params = new URLSearchParams(window.location.search);
        token = params.get('token') || '';
        if (token) {
            addLog(`🚀 客户端初始化，RoomID: ${token}`);
            initTransport(token);
        } else {
            addLog(`⚠️ 链接缺失 token 参数`);
        }
    });

    function initTransport(tok: string): void {
        transport = new EQTTransport(tok);
        (window as any).transport = transport;

        transport.onModeDetect = (m, label) => {
            modeType = m;
            wanTipsLabel = label;
            addLog(`⚡ [Mode Detected] 物理传输模式确定: ${label}`);
        };

        transport.onPhase = (s: number, t: number, msg: string, err: boolean = false) => {
            step = s;
            totalSteps = t;
            phaseMsg = msg;
            isError = err;
            addLog(`[Phase ${s}/${t}] ${msg}${err ? ' (错误)' : ''}`);
        };

        transport.onStatus = (msg: string, color?: string) => {
            statusMsg = msg;
            if (color) statusColor = color;
            addLog(`[Status] ${msg}`);
        };

        transport.onMeta = (name: string, size: number) => {
            fileName = name || fileName;
            expectedSize = size || 0;
            phaseMsg = '✅ 物理打通，文件准备就绪！';
            statusMsg = '⚡ P2P 直连通道建立成功，点击开始下载！';
            addLog(`📄 元数据同步成功: ${fileName} (${formatBytes(expectedSize)})`);
        };

        transport.onProgress = (done: number, total: number) => {
            receivedSize = done;
            if (total > 0) expectedSize = total;
            isDownloading = true;

            const now = Date.now();
            if (!lastProgressTime) {
                lastProgressTime = now;
                lastProgressBytes = done;
            } else {
                const timeDiff = (now - lastProgressTime) / 1000;
                if (timeDiff >= 0.3) {
                    const bytesDiff = done - lastProgressBytes;
                    speedMBs = ((bytesDiff / (1024 * 1024)) / timeDiff).toFixed(2);
                    lastProgressTime = now;
                    lastProgressBytes = done;
                    addLog(`📊 解包进度: ${formatBytes(done)} / ${formatBytes(expectedSize)} | 速率: ${speedMBs} MB/s`);
                }
            }
        };

        transport.onComplete = (blob: Blob, name: string) => {
            downloadedBlob = blob;
            fileName = name || fileName;
            isDownloading = false;
            isCompleted = true;
            receivedSize = expectedSize;

            step = 5;
            phaseMsg = '🎉 物理传输已完成！';
            statusMsg = '🎉 文件已成功接收并保存至您的设备！';
            addLog(`🎉 传输物理完成，Blob 尺寸: ${blob.size} 字节，触发落盘保存`);

            triggerBlobSave();
        };

        transport.initReceiver();
    }

    function handleStartDownload(): void {
        if (!transport) return;
        isDownloading = true;
        statusMsg = '⏳ 正在物理传输数据流...';
        addLog(`⚡ 用户触发“开始极速下载”按钮，向 DataChannel 发送 request_download 指令`);
        transport.requestDownload();
    }

    function triggerBlobSave(): void {
        if (!downloadedBlob) return;
        try {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(downloadedBlob);
            a.download = fileName;
            a.click();
        } catch(e) {}
    }
</script>

<main class="app-container">
    <BrandHeader wanTips={wanTipsLabel} modeType={modeType} />

    <PhaseTimeline 
        step={step} 
        total={totalSteps} 
        msg={phaseMsg} 
        isError={isError} 
    />

    <TransferProgressCard 
        fileName={fileName}
        expectedSize={expectedSize}
        receivedSize={receivedSize}
        speedMBs={speedMBs}
        isDownloading={isDownloading}
        isCompleted={isCompleted}
        statusMsg={statusMsg}
    />

    <div class="action-bar">
        {#if isCompleted}
            <button class="btn btn-success" on:click={triggerBlobSave}>
                🎉 重新保存文件
            </button>
        {:else if isDownloading}
            <button class="btn btn-downloading" disabled>
                ⏳ 正在接收数据流 ({speedMBs} MB/s)
            </button>
        {:else}
            <button class="btn btn-primary" disabled={btnDisabled} on:click={handleStartDownload}>
                {#if btnDisabled}
                    ⏳ 等待 P2P 物理连接...
                {:else}
                    ⚡ 点击开始极速下载 ({formatBytes(expectedSize)})
                {/if}
            </button>
        {/if}
    </div>

    <div class="mode-diagnostic-card" class:direct-card={modeType === 'UDP-DIRECT'} class:fallback-card={modeType === 'SIGNAL-FALLBACK'}>
        <div class="card-label">物理传输模式诊断:</div>
        <div class="card-val">
            {#if modeType === 'UDP-DIRECT'}
                ⚡ WebRTC DataChannel (原生 UDP 点对点直连 - 无中转)
            {:else if modeType === 'SIGNAL-FALLBACK'}
                🐌 Signaling Fallback (HTTP 信令轮询中转兜底)
            {:else}
                ⏳ 物理握手协商中...
            {/if}
        </div>
    </div>

    <!-- 实时 Debug Live Terminal 调试终端 -->
    <div class="debug-terminal">
        <div class="terminal-header">
            <span>💻 实时调试终端 Logs ({debugLogs.length})</span>
            <button class="clear-btn" on:click={() => debugLogs = []}>清空</button>
        </div>
        <div class="terminal-body">
            {#if debugLogs.length === 0}
                <div class="log-line empty-log">等待传输日志...</div>
            {:else}
                {#each debugLogs as log}
                    <div class="log-line">{log}</div>
                {/each}
            {/if}
        </div>
    </div>

    <div class="lang-switch">
        <select bind:value={currentLang} aria-label="Switch Language">
            <option value="zh">简体中文</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
        </select>
    </div>
</main>

<style>
    :global(body) {
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        background: #f1f5f9;
        color: #0f172a;
        display: flex;
        justify-content: center;
        min-height: 100vh;
    }
    .app-container {
        width: 100%;
        max-width: 520px;
        padding: 20px 16px;
        box-sizing: border-box;
    }
    .mode-diagnostic-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 12px 16px;
        margin-bottom: 16px;
        text-align: left;
        box-shadow: 0 2px 8px rgba(0,0,0,0.04);
        transition: all 0.3s ease;
    }
    .mode-diagnostic-card.direct-card {
        background: #ecfdf5;
        border-color: #a7f3d0;
    }
    .mode-diagnostic-card.fallback-card {
        background: #fffbe6;
        border-color: #ffe58f;
    }
    .card-label {
        font-size: 12px;
        font-weight: 700;
        color: #64748b;
        margin-bottom: 4px;
    }
    .card-val {
        font-size: 13px;
        font-weight: 800;
        color: #0f172a;
    }
    .direct-card .card-val {
        color: #047857;
    }
    .fallback-card .card-val {
        color: #d97706;
    }

    /* 调试终端样式 */
    .debug-terminal {
        background: #0f172a;
        color: #38bdf8;
        border-radius: 12px;
        padding: 12px;
        margin-bottom: 20px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 12px;
        box-shadow: 0 8px 20px rgba(0,0,0,0.15);
        text-align: left;
    }
    .terminal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid #1e293b;
        padding-bottom: 8px;
        margin-bottom: 8px;
        font-weight: 700;
        color: #94a3b8;
    }
    .clear-btn {
        background: #1e293b;
        border: none;
        color: #94a3b8;
        padding: 2px 8px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
    }
    .clear-btn:hover {
        color: white;
        background: #334155;
    }
    .terminal-body {
        max-height: 180px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .log-line {
        line-height: 1.4;
        word-break: break-all;
    }
    .empty-log {
        color: #475569;
        font-style: italic;
    }
    .action-bar {
        margin-bottom: 24px;
    }
    .btn {
        width: 100%;
        padding: 14px 20px;
        border: none;
        border-radius: 12px;
        font-size: 15px;
        font-weight: 800;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    }
    .btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        box-shadow: none;
    }
    .btn-primary {
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
        color: white;
    }
    .btn-primary:not(:disabled):hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 16px rgba(37, 99, 235, 0.3);
    }
    .btn-downloading {
        background: #10b981;
        color: white;
    }
    .btn-success {
        background: #059669;
        color: white;
    }
    .btn-success:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 16px rgba(5, 150, 105, 0.3);
    }
    .lang-switch {
        display: flex;
        justify-content: center;
    }
    .lang-switch select {
        padding: 6px 12px;
        border-radius: 8px;
        border: 1px solid #cbd5e1;
        background: white;
        font-size: 12px;
        font-weight: 600;
        color: #475569;
        outline: none;
    }
</style>
