<script lang="ts">
  import { createEventDispatcher, afterUpdate, onDestroy } from 'svelte';
  import { messages, currentDevice, transfers } from '../state/chatStore';
  import { getThemeColors, getSenderThemeColors } from '../services/types';

  const dispatch = createEventDispatcher();
  let listElement: HTMLDivElement;

  let recallConfirmingId: string | null = null;
  let resetTimer: any = null;

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

  function handleCopy(text: string) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      dispatch('systemNotice', currentLang === 'en' ? 'Copied to clipboard' : '已复制到剪贴板');
    }).catch(err => {
      dispatch('systemNotice', 'Copy failed: ' + err.message);
    });
  }

  function triggerRecall(msgId: string) {
    if (recallConfirmingId === msgId) {
      dispatch('recallMessage', msgId);
      recallConfirmingId = null;
      if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
      }
    } else {
      recallConfirmingId = msgId;
      if (resetTimer) {
        clearTimeout(resetTimer);
      }
      resetTimer = setTimeout(() => {
        if (recallConfirmingId === msgId) {
          recallConfirmingId = null;
        }
      }, 3000);
    }
  }

  onDestroy(() => {
    if (resetTimer) {
      clearTimeout(resetTimer);
    }
  });

  let currentLang = localStorage.getItem('eqt_lang') || 'zh';

  // Get sender colors dynamically based on message theme or sender name hash seed
  $: getColors = (msg: any) => {
    return getThemeColors(msg.theme) || getSenderThemeColors(msg.sender);
  };
</script>

<div class="messages" bind:this={listElement}>
  {#each $messages as msg (msg.id)}
    {#if msg.type === 'system'}
      <div class="message system">
        <div class="bubble">
          <span class="text">{msg.text}</span>
        </div>
      </div>
    {:else}
      {@const isMine = msg.senderId === $currentDevice?.id}
      {@const transferId = 'dl-' + msg.id}
      {@const tx = $transfers[transferId]}
      {@const colors = getColors(msg)}
      
      <!-- 
        Bind dynamic theme color variables onto each message local DOM context.
        This restores the original V1 look where bubble wash/border tints 
        inherited the sender's device visual styling.
      -->
      <div class="message" class:mine={isMine} class:attachment-message={msg.type === 'file'} class:recalled={msg.recalled}
           style="
             --accent: {colors.border};
             --accent-strong: {colors.text};
             --accent-wash: {colors.bg};
             --line: {colors.border}44;
           "
      >
        <div class="avatar-stack">
          <div class="message-avatar">
            {msg.sender ? msg.sender.slice(0, 2).toUpperCase() : 'DE'}
          </div>
          <div class="bubble-time">
            {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
        </div>

        <div class="message-main">
          <div class="sender">{msg.sender}</div>
          <div class="bubble">
            {#if msg.recalled}
              <span class="text recalled">{msg.sender} {currentLang === 'en' ? 'recalled a message' : '撤回了一条消息'}</span>
              {#if isMine}
                <div class="recalled-actions">
                  {#if msg.type === 'text'}
                    <button class="edit-recalled" type="button" on:click={() => dispatch('editAgain', msg.text || '')}>
                      {currentLang === 'en' ? 'Edit again' : '再次编辑'}
                    </button>
                  {:else if msg.type === 'file'}
                    <button class="edit-recalled" type="button" on:click={() => dispatch('resendFile', { name: msg.fileName, size: msg.size })}>
                      {currentLang === 'en' ? 'Resend' : '再次发送'}
                    </button>
                  {/if}
                </div>
              {/if}
            {:else}
              {#if msg.type === 'text'}
                <span class="text">{msg.text}</span>
                <div class="message-footer" style="margin-top: 4px;">
                  <div class="message-footer-meta" style="flex: 1;"></div>
                  <div class="message-footer-actions">
                    <button class="bubble-action" type="button" on:click={() => handleCopy(msg.text || '')} title="Copy">
                      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="9" y="9" width="11" height="11" rx="2" ry="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                    </button>
                    {#if isMine}
                      <button class="bubble-action {recallConfirmingId === msg.id ? 'confirm-delete' : ''}" type="button" on:click={() => triggerRecall(msg.id)} title="Delete">
                        {#if recallConfirmingId === msg.id}
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                        {:else}
                          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 6h18"></path>
                            <path d="M8 6V4h8v2"></path>
                            <path d="M10 11v6"></path>
                            <path d="M14 11v6"></path>
                            <path d="M6 6l1 14h10l1-14"></path>
                          </svg>
                        {/if}
                      </button>
                    {/if}
                  </div>
                </div>
              {:else if msg.type === 'file'}
                <div class="bubble-content">
                  <div class="attachment-card file-attachment">
                    <div class="file-card">
                      <div class="file-icon">FILE</div>
                      <div class="file-details">
                        <div class="file-name" title={msg.fileName}>{msg.fileName}</div>
                        <div class="file-subtitle">
                          {formatBytes(msg.size || 0)}
                          {#if tx}
                            {#if tx.state === 'running'}
                              · 传输中 {tx.percent}%
                            {:else if tx.state === 'completed'}
                              · 已完成
                            {/if}
                          {/if}
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Footer interactions and progress inside the bubble card -->
                  <div class="message-footer">
                    {#if tx}
                      {#if tx.state === 'queued'}
                        <div class="message-footer-meta" style="flex: 1;">{currentLang === 'en' ? 'Queued...' : '排队中...'}</div>
                      {:else if tx.state === 'running'}
                        <div class="message-footer-meta" style="flex: 1;">
                          {tx.percent}% ({formatBytes(tx.bytesDone || 0)} / {formatBytes(tx.bytesTotal || 0)})
                        </div>
                      {:else if tx.state === 'completed'}
                        <div class="message-footer-meta text-success" style="font-weight: 700; flex: 1;">{currentLang === 'en' ? 'Download completed' : '下载已完成'}</div>
                      {:else if tx.state === 'failed'}
                        <div class="message-footer-meta text-danger" style="flex: 1;">{currentLang === 'en' ? 'Download failed' : '下载失败'}</div>
                      {:else if tx.state === 'cancelled'}
                        <div class="message-footer-meta" style="flex: 1;">{currentLang === 'en' ? 'Cancelled' : '已取消'}</div>
                      {/if}
                    {:else}
                      <div class="message-footer-meta" style="flex: 1;">{currentLang === 'en' ? 'Not downloaded' : '未下载'}</div>
                    {/if}
 
                    <div class="message-footer-actions">
                      {#if tx}
                        {#if tx.state === 'running'}
                          <button class="bubble-action" on:click={() => handleCancel(tx.id)} title="Cancel">
                            <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                          </button>
                        {:else if tx.state === 'completed'}
                          <button class="bubble-action completed-btn" on:click={() => handleDownload(msg.id, msg.fileName || '', msg.size || 0, false)} title="Redownload">
                            <svg class="icon-completed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            <svg class="icon-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                          </button>
                        {:else if tx.state === 'failed'}
                          <button class="bubble-action" on:click={() => handleDownload(msg.id, msg.fileName || '', msg.size || 0, false)} title="Retry">
                            <svg class="icon-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                          </button>
                        {:else if tx.state === 'cancelled'}
                          <button class="bubble-action" on:click={() => handleDownload(msg.id, msg.fileName || '', msg.size || 0, false)} title="Redownload">
                            <svg class="icon-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                          </button>
                        {/if}
                      {:else}
                        <button class="bubble-action" on:click={() => handleDownload(msg.id, msg.fileName || '', msg.size || 0, false)} title="Download">
                          <svg class="icon-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                        </button>
                      {/if}
 
                      {#if isMine}
                        <button class="bubble-action {recallConfirmingId === msg.id ? 'confirm-delete' : ''}" type="button" on:click={() => triggerRecall(msg.id)} title="Delete">
                          {#if recallConfirmingId === msg.id}
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                          {:else}
                            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M3 6h18"></path>
                              <path d="M8 6V4h8v2"></path>
                              <path d="M10 11v6"></path>
                              <path d="M14 11v6"></path>
                              <path d="M6 6l1 14h10l1-14"></path>
                            </svg>
                          {/if}
                        </button>
                      {/if}
                    </div>
                  </div>
                </div>
              {/if}
            {/if}
          </div>
 

        </div>
      </div>
    {/if}
  {:else}
    <div class="messages-empty">
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-3.658A8.967 8.967 0 013 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" /></svg>
      <strong>开始聊天吧！</strong>
      <span>向其他已连接设备发送文本或局限大文件。</span>
    </div>
  {/each}
</div>

<style>
  /* Rely on global app.css V1 classes */
</style>
