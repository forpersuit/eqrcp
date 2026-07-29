<script lang="ts">
    export let step: number = 1;
    export let total: number = 5;
    export let msg: string = '正在初始化...';
    export let isError: boolean = false;
</script>

<div class="phase-timeline" class:error={isError}>
    <span class="phase-badge" class:error-badge={isError}>
        {isError ? '错误' : `${step}/${total}`}
    </span>
    <span class="phase-text">{msg}</span>
    {#if !isError && step < total}
        <span class="phase-spinner"></span>
    {/if}
</div>

<style>
    .phase-timeline {
        margin-bottom: 16px;
        padding: 8px 14px;
        background: rgba(239, 246, 255, 0.8);
        border: 1px solid rgba(191, 219, 254, 0.8);
        border-radius: 10px;
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 13px;
        font-weight: 600;
        color: #1e40af;
        transition: all 0.3s ease;
    }
    .phase-timeline.error {
        background: #fef2f2;
        border-color: #fecaca;
        color: #991b1b;
    }
    .phase-badge {
        background: #2563eb;
        color: white;
        padding: 2px 7px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 800;
        flex-shrink: 0;
    }
    .phase-badge.error-badge {
        background: #dc2626;
    }
    .phase-text {
        flex: 1;
        text-align: left;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .phase-spinner {
        width: 14px;
        height: 14px;
        border: 2px solid #2563eb;
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        flex-shrink: 0;
    }
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
</style>
