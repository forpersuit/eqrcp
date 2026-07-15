<script lang="ts">
  import { transfers, systemMessages, chatActions, currentDevice } from '../state/chatStore';

  export let currentLang = 'zh';

  // Extract only active transfers (running or queued) belonging to this device
  $: activeTransfers = Object.values($transfers).filter(tx => 
    (tx.state === 'running' || tx.state === 'queued') && 
    (tx.clientId === ($currentDevice?.peer || 'desktop'))
  );

  function clearLogs() {
    chatActions.clearSystemMessages();
  }
</script>

<div class="status-panel">
  <!-- Active Transfers Section -->
  <div class="section-box">
    <h3>{currentLang === 'en' ? 'Active Transfers' : '活跃传输任务'} ({activeTransfers.length})</h3>
    <div class="transfers-container">
      {#each activeTransfers as tx (tx.id)}
        <div class="tx-row">
          <div class="tx-meta">
            <span class="tx-name" title={tx.fileName}>{tx.fileName}</span>
            <span class="tx-percent">{tx.percent ?? 0}%</span>
          </div>
          <div class="tx-bar-bg">
            <div class="tx-bar-fg" style="width: {tx.percent ?? 0}%"></div>
          </div>
        </div>
      {:else}
        <div class="tx-empty">{currentLang === 'en' ? 'No active transfers' : '无进行中传输'}</div>
      {/each}
    </div>
  </div>

  <!-- System Console Logs Section -->
  <div class="section-box log-section">
    <div class="section-header">
      <h3>{currentLang === 'en' ? 'System Notifications' : '系统通知日志'}</h3>
      {#if $systemMessages.length > 0}
        <button class="clear-btn" on:click={clearLogs}>{currentLang === 'en' ? 'Clear' : '清空'}</button>
      {/if}
    </div>
    <div class="log-container">
      {#each $systemMessages as log, idx (idx)}
        <div class="log-line">{log}</div>
      {:else}
        <div class="log-empty">{currentLang === 'en' ? 'No system messages' : '暂无系统消息'}</div>
      {/each}
    </div>
  </div>
</div>

<style>
  .status-panel {
    display: flex;
    flex-direction: column;
    width: 280px;
    height: 100%;
    background: rgba(14, 12, 21, 0.6);
    border-left: 1px solid rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(10px);
  }

  .section-box {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    min-height: 0;
  }

  .log-section {
    flex: 1.2;
    border-bottom: none;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  h3 {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.85);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* Active Transfers */
  .transfers-container {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 12px;
  }

  .tx-row {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.04);
    border-radius: 8px;
    padding: 10px;
  }

  .tx-meta {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.8);
    margin-bottom: 6px;
    gap: 12px;
  }

  .tx-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
    flex: 1;
  }

  .tx-percent {
    font-weight: bold;
    color: #a78bfa;
  }

  .tx-bar-bg {
    height: 4px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 2px;
    overflow: hidden;
  }

  .tx-bar-fg {
    height: 100%;
    background: linear-gradient(90deg, #7c3aed, #db2777);
    border-radius: 2px;
  }

  .tx-empty {
    text-align: center;
    color: rgba(255, 255, 255, 0.25);
    font-size: 0.8rem;
    margin: auto 0;
  }

  /* Log Console */
  .log-container {
    flex: 1;
    overflow-y: auto;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    padding: 10px;
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.7rem;
    line-height: 1.4;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .log-line {
    color: #10b981;
    word-break: break-all;
  }

  .log-empty {
    text-align: center;
    color: rgba(255, 255, 255, 0.2);
    margin: auto 0;
  }

  .clear-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 0.7rem;
    color: rgba(255, 255, 255, 0.45);
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .clear-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.12);
  }
</style>
