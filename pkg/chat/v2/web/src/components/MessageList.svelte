<script lang="ts">
  import { createEventDispatcher, afterUpdate } from 'svelte';
  import { messages, currentDevice, transfers } from '../state/chatStore';
  import { getThemeColors, getSenderThemeColors } from '../services/types';

  const dispatch = createEventDispatcher();
  let listElement: HTMLDivElement;

  afterUpdate(() => {
    if (listElement) {
      listElement.scrollTop = listElement.scrollHeight;
    }
  });

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function handleDownload(msgId: string, filename: string, size: number, isPaid: boolean) {
    dispatch('startDownload', { messageId: msgId, filename, size, isPaid });
  }

  function handleCancel(transferId: string) {
    dispatch('cancelDownload', transferId);
  }

  // Get sender colors dynamically based on message theme or sender name hash seed
  $: getColors = (msg: any) => {
    return getThemeColors(msg.theme) || getSenderThemeColors(msg.sender);
  };
</script>

<div class="message-list" bind:this={listElement}>
  {#each $messages as msg (msg.id)}
    {@const colors = getColors(msg)}
    <div class="message-wrapper" class:is-me={msg.senderId === $currentDevice?.id}>
      <div 
        class="message-bubble" 
        style="
          --bubble-border: {colors.border}44; 
          --bubble-wash: {colors.bg}; 
          --accent-color: {colors.border}; 
          --accent-text: {colors.text};
        "
      >
        <div class="msg-header">
          <span class="sender">{msg.sender}</span>
          <span class="time">{new Date(msg.createdAt).toLocaleTimeString()}</span>
        </div>

        {#if msg.type === 'text'}
          <div class="text-content">{msg.text}</div>
        {:else if msg.type === 'file'}
          {@const transferId = 'dl-' + msg.id}
          {@const tx = $transfers[transferId]}
          <div class="file-card">
            <div class="file-info-row">
              <svg class="file-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <div class="file-details">
                <div class="filename" title={msg.fileName}>{msg.fileName}</div>
                <div class="filesize">{formatBytes(msg.size || 0)}</div>
              </div>
            </div>

            <!-- Transfer Status Render -->
            {#if tx}
              <div class="transfer-status-section">
                {#if tx.state === 'queued'}
                  <div class="status-badge queued">排队中...</div>
                {:else if tx.state === 'running'}
                  <div class="progress-bar-wrapper">
                    <div class="progress-bar-fill" style="width: {tx.percent}%"></div>
                  </div>
                  <div class="progress-meta">
                    <span>{tx.percent}% ({formatBytes(tx.bytesDone || 0)} / {formatBytes(tx.bytesTotal || 0)})</span>
                    <button class="text-btn cancel-btn" on:click={() => handleCancel(tx.id)}>取消</button>
                  </div>
                {:else if tx.state === 'completed'}
                  <div class="status-badge completed">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="badge-icon">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    下载完成
                  </div>
                {:else if tx.state === 'failed'}
                  <div class="status-badge failed">下载失败: {tx.error || '网络中断'}</div>
                  <div class="download-actions">
                    <button class="dl-btn free" on:click={() => handleDownload(msg.id, msg.fileName || '', msg.size || 0, false)}>重试 (普通限速)</button>
                    <button class="dl-btn paid" on:click={() => handleDownload(msg.id, msg.fileName || '', msg.size || 0, true)}>重试 (VIP加速)</button>
                  </div>
                {:else if tx.state === 'cancelled'}
                  <div class="status-badge cancelled">已取消</div>
                  <div class="download-actions">
                    <button class="dl-btn free" on:click={() => handleDownload(msg.id, msg.fileName || '', msg.size || 0, false)}>重新下载 (普通限速)</button>
                    <button class="dl-btn paid" on:click={() => handleDownload(msg.id, msg.fileName || '', msg.size || 0, true)}>重新下载 (VIP加速)</button>
                  </div>
                {/if}
              </div>
            {:else}
              <!-- No download started yet -->
              <div class="download-actions">
                <button class="dl-btn free" on:click={() => handleDownload(msg.id, msg.fileName || '', msg.size || 0, false)}>免费下载 (512K/s)</button>
                <button class="dl-btn paid" on:click={() => handleDownload(msg.id, msg.fileName || '', msg.size || 0, true)}>付费加速 (极速)</button>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <div class="empty-chat">
      <div class="icon-bubble">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-3.658A8.967 8.967 0 013 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
        </svg>
      </div>
      <p>开始聊天吧！发送文本或体验局限带宽大文件下载</p>
    </div>
  {/each}
</div>

<style>
  .message-list {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    background: radial-gradient(circle at top right, #181525, #0a0910);
  }

  .message-wrapper {
    display: flex;
    width: 100%;
  }

  .message-wrapper.is-me {
    justify-content: flex-end;
  }

  .message-bubble {
    max-width: 70%;
    padding: 12px 16px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--bubble-border, rgba(255, 255, 255, 0.05));
    backdrop-filter: blur(8px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .message-wrapper.is-me .message-bubble {
    background: var(--bubble-wash, rgba(124, 58, 237, 0.15));
    border-color: var(--bubble-border, rgba(124, 58, 237, 0.25));
  }

  .msg-header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 6px;
    font-size: 0.75rem;
  }

  .sender {
    font-weight: 600;
    color: var(--accent-text, rgba(255, 255, 255, 0.7));
    transition: color 0.2s ease;
  }

  .time {
    color: rgba(255, 255, 255, 0.35);
  }

  .text-content {
    font-size: 0.9rem;
    line-height: 1.45;
    color: rgba(255, 255, 255, 0.95);
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* File Card Styling */
  .file-card {
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    padding: 12px;
    margin-top: 4px;
    min-width: 280px;
    max-width: 320px;
  }

  .file-info-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }

  .file-icon {
    width: 32px;
    height: 32px;
    color: var(--accent-color, #a78bfa);
    transition: color 0.2s ease;
  }

  .file-details {
    flex: 1;
    min-width: 0;
  }

  .filename {
    font-size: 0.85rem;
    font-weight: 500;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .filesize {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.4);
    margin-top: 2px;
  }

  .download-actions {
    display: flex;
    gap: 8px;
  }

  .dl-btn {
    flex: 1;
    height: 28px;
    font-size: 0.7rem;
    font-weight: 500;
    border-radius: 14px;
    border: none;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .dl-btn.free {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }

  .dl-btn.free:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  .dl-btn.paid {
    background: linear-gradient(135deg, var(--accent-color, #7c3aed), #db2777);
    color: #fff;
    box-shadow: 0 2px 6px rgba(124, 58, 237, 0.2);
  }

  .dl-btn.paid:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 10px rgba(124, 58, 237, 0.4);
  }

  /* Progress and badging */
  .transfer-status-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .progress-bar-wrapper {
    height: 6px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 3px;
    overflow: hidden;
  }

  .progress-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent-color, #7c3aed), #db2777);
    border-radius: 3px;
    transition: width 0.1s linear, background-color 0.2s ease;
  }

  .progress-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.7rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .text-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 0.7rem;
    font-weight: 600;
  }

  .cancel-btn {
    color: #ef4444;
  }

  .cancel-btn:hover {
    text-decoration: underline;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.75rem;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .status-badge.queued {
    background: rgba(245, 158, 11, 0.1);
    color: #f59e0b;
  }

  .status-badge.completed {
    background: rgba(16, 185, 129, 0.1);
    color: #10b981;
  }

  .badge-icon {
    width: 14px;
    height: 14px;
  }

  .status-badge.failed {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
    word-break: break-word;
  }

  .status-badge.cancelled {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.4);
  }

  /* Empty Chat */
  .empty-chat {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.35);
    text-align: center;
    padding: 40px;
  }

  .icon-bubble {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.05);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 16px;
    color: rgba(255, 255, 255, 0.25);
  }

  .icon-bubble svg {
    width: 32px;
    height: 32px;
  }

  .empty-chat p {
    font-size: 0.85rem;
    margin: 0;
    max-width: 260px;
    line-height: 1.4;
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
