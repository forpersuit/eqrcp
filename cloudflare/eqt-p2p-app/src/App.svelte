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

    $: dict = translations[currentLang] || translations.zh;
    $: btnDisabled = step < 5 && !isCompleted;

    onMount(() => {
        const params = new URLSearchParams(window.location.search);
        token = params.get('token') || '';
        if (token) {
            initTransport(token);
        }
    });

    function initTransport(tok: string): void {
        transport = new EQTTransport(tok);
        (window as any).transport = transport;

        transport.onModeDetect = (m, label) => {
            modeType = m;
            wanTipsLabel = label;
        };

        transport.onPhase = (s: number, t: number, msg: string, err: boolean = false) => {
            step = s;
            totalSteps = t;
            phaseMsg = msg;
            isError = err;
        };

        transport.onStatus = (msg: string, color?: string) => {
            statusMsg = msg;
            if (color) statusColor = color;
        };

        transport.onMeta = (name: string, size: number) => {
            fileName = name || fileName;
            expectedSize = size || 0;
            phaseMsg = '✅ 物理打通，文件准备就绪！';
            statusMsg = '⚡ P2P 直连通道建立成功，点击开始下载！';
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

            triggerBlobSave();
        };

        transport.initReceiver();
    }

    function handleStartDownload(): void {
        if (!transport) return;
        isDownloading = true;
        statusMsg = '⏳ 正在物理传输数据流...';
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
        max-width: 480px;
        padding: 20px 16px;
        box-sizing: border-box;
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
