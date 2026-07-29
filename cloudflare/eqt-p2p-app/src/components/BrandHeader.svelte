<script lang="ts">
    export let wanTips: string = '公网 WAN P2P 直连';
</script>

<div class="brand-header">
    <div class="brand-left">
        <span class="brand-title">EQT</span>
        <span class="license-badge">PRO WAN</span>
    </div>
    <div class="brand-right">
        <span class="connection-mode">{wanTips}</span>
    </div>
</div>

<style>
    .brand-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        background: rgba(255, 255, 255, 0.75);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(226, 232, 240, 0.8);
        border-radius: 14px;
        margin-bottom: 16px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
    }
    .brand-left {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .brand-title {
        font-size: 20px;
        font-weight: 900;
        background: linear-gradient(135deg, #0f172a 0%, #3b82f6 100%);
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        letter-spacing: -0.5px;
    }
    .license-badge {
        background: #2563eb;
        color: white;
        font-size: 11px;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 6px;
        letter-spacing: 0.5px;
    }
    .connection-mode {
        font-size: 12px;
        font-weight: 600;
        color: #475569;
    }
</style>
