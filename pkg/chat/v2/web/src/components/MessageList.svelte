<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { connState } from '../state/chatStore';
  import type { Message } from '../services/types';
  import { currentDevice } from '../state/chatStore';

  const dispatch = createEventDispatcher();

  export let messages: Message[] = [];
  export let currentLang = 'zh';
  export let isMine: (msg: Message) => boolean;
  export let txState: Record<string, any> = {};

  let recallConfirmingId: string | null = null;
  let confirmTimer: number | null = null;

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      dispatch('systemNotice', currentLang === 'en' ? 'Text copied' : '文本已复制');
    });
  }

  function triggerRecall(messageId: string) {
    if (recallConfirmingId === messageId) {
      // Confirmed, trigger recall
      dispatch('recallMessage', messageId);
      clearConfirm();
    } else {
      // First click, show confirmation
      recallConfirmingId = messageId;
      if (confirmTimer) clearTimeout(confirmTimer);
      confirmTimer = window.setTimeout(clearConfirm, 3000);
    }
  }

  function clearConfirm() {
    recallConfirmingId = null;
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
  }

  onDestroy(() => {
    if (confirmTimer) clearTimeout(confirmTimer);
  });

  function handleDownload(messageId: string, filename: string, size: number, isPaid: boolean) {
    dispatch('startDownload', { messageId, filename, size, isPaid });
  }

  function handleCancel(txId: string) {
    dispatch('cancelDownload', txId);
  }

  function formatBytes(bytes: number, decimals = 2) {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }
</script>

<div class="messages">
  {#each messages as msg (msg.id)}
    {#if msg.type === 'system'}
      <div class="system-message">
        <span class="system-text">{msg.text}</span>
      </div>
    {:else}
      {@const mine = isMine(msg)}
      {@const tx = txState[msg.id]}
      {@const colors = msg.senderColor || { bg: '#f1f5f9', border: '#cbd5e1', text: '#334155' }}
      <div 
        class="message" 
        class:mine 
        class:recalled={msg.recalled}
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
              {#if mine}
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
                </div>
              {/if}
            {/if}
          </div>

          {#if !msg.recalled}
            <div class="message-footer" style="margin-top: 4px;">
              {#if msg.type === 'text'}
                <div class="message-footer-meta" style="flex: 1;"></div>
                <div class="message-footer-actions">
                  <button class="bubble-action" type="button" on:click={() => handleCopy(msg.text || '')} title="Copy">
                    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="9" y="9" width="11" height="11" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  </button>
                  {#if mine}
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
              {:else if msg.type === 'file'}
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

                  {#if mine}
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
              {/if}
            </div>
          {/if}
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
