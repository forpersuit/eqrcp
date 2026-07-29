<script lang="ts">
    import { formatBytes } from '../lib/i18n';

    export let fileName: string = 'downloaded_file';
    export let expectedSize: number = 0;
    export let receivedSize: number = 0;
    export let speedMBs: string = '0.00';
    export let isDownloading: boolean = false;
    export let isCompleted: boolean = false;
    export let statusMsg: string = '⚡ P2P 直连通道已建立';

    $: percent = expectedSize > 0 ? Math.min(100, Math.round((receivedSize / expectedSize) * 100)) : 0;
    $: formattedReceived = formatBytes(receivedSize);
    $: formattedExpected = formatBytes(expectedSize);
</script>

<div class="card-box">
    <div class="status-header">
        <div class="status-icon" class:downloading={isDownloading} class:completed={isCompleted}>
            {#if isCompleted}
                ✓
            {:else if isDownloading}
                <svg class="pulse-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            {:else}
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            {/if}
        </div>
        <div class="status-info">
            <h2 class="title">{isCompleted ? '✅ 传输成功' : (isDownloading ? '⚡ 正在极速接收中...' : '文件准备就绪')}</h2>
            <p class="subtitle">{statusMsg}</p>
        </div>
    </div>

    <!-- 真实数据与速率呈现面板 -->
    <div class="progress-section">
        <div class="progress-meta-row">
            <span class="file-name-label" title={fileName}>{fileName}</span>
            <span class="percent-badge">{percent}%</span>
        </div>

        <div class="track">
            <div class="fill" style="width: {percent}%" class:active-fill={isDownloading}></div>
        </div>

        <div class="stats-row">
            <div class="bytes-counter">
                <span class="current-bytes">{formattedReceived}</span>
                <span class="divider">/</span>
                <span class="total-bytes">{formattedExpected}</span>
            </div>

            {#if isDownloading || isCompleted}
                <div class="speed-pill" class:completed-pill={isCompleted}>
                    <span class="bolt">{isCompleted ? '✓' : '⚡'}</span>
                    <span class="speed-value">{isCompleted ? '传输完成' : speedMBs}</span>
                    <span class="speed-unit">{isCompleted ? '' : 'MB/s'}</span>
                </div>
            {/if}
        </div>
    </div>
</div>

<style>
    .card-box {
        background: #ffffff;
        border: 1px solid rgba(226, 232, 240, 0.9);
        border-radius: 16px;
        padding: 20px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01);
        margin-bottom: 20px;
    }
    .status-header {
        display: flex;
        align-items: center;
        gap: 14px;
        margin-bottom: 18px;
        text-align: left;
    }
    .status-icon {
        width: 48px;
        height: 48px;
        border-radius: 12px;
        background: #eff6ff;
        color: #2563eb;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 22px;
        font-weight: 800;
        flex-shrink: 0;
        transition: all 0.3s ease;
    }
    .status-icon.downloading {
        background: #ecfdf5;
        color: #10b981;
    }
    .status-icon.completed {
        background: #10b981;
        color: white;
    }
    .pulse-icon {
        animation: bounce 1.2s infinite;
    }
    @keyframes bounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(3px); }
    }
    .status-info {
        flex: 1;
        overflow: hidden;
    }
    .title {
        font-size: 16px;
        font-weight: 800;
        color: #0f172a;
        margin: 0 0 2px 0;
    }
    .subtitle {
        font-size: 13px;
        color: #64748b;
        margin: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .progress-section {
        background: #f8fafc;
        border: 1px solid #f1f5f9;
        border-radius: 12px;
        padding: 14px;
    }
    .progress-meta-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
    }
    .file-name-label {
        font-size: 14px;
        font-weight: 700;
        color: #1e293b;
        max-width: 75%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .percent-badge {
        font-size: 13px;
        font-weight: 800;
        color: #2563eb;
    }
    .track {
        height: 8px;
        background: #e2e8f0;
        border-radius: 6px;
        overflow: hidden;
        position: relative;
        margin-bottom: 10px;
    }
    .fill {
        height: 100%;
        background: #2563eb;
        border-radius: 6px;
        transition: width 0.15s ease-out;
    }
    .fill.active-fill {
        background: linear-gradient(90deg, #2563eb 0%, #10b981 100%);
    }
    .stats-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 13px;
    }
    .bytes-counter {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-weight: 600;
    }
    .current-bytes {
        color: #0f172a;
        font-weight: 700;
    }
    .divider {
        color: #94a3b8;
        margin: 0 2px;
    }
    .total-bytes {
        color: #64748b;
    }
    .speed-pill {
        display: flex;
        align-items: center;
        gap: 4px;
        background: #ecfdf5;
        border: 1px solid #a7f3d0;
        color: #047857;
        padding: 2px 10px;
        border-radius: 20px;
        font-weight: 800;
        font-size: 12px;
        box-shadow: 0 2px 6px rgba(16, 185, 129, 0.12);
        animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.85; }
    }
    .speed-value {
        font-family: ui-monospace, monospace;
        font-size: 13px;
    }
</style>
