<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { connState } from '../state/chatStore';
  import type { Message } from '../services/types';
  import { getThemeColors, getSenderThemeColors } from '../services/types';
  import { currentDevice } from '../state/chatStore';

  const dispatch = createEventDispatcher();

  export let messages: Message[] = [];
  export let currentLang = 'zh';
  export let isMine: (msg: Message) => boolean;
  export let txState: Record<string, any> = {};
  export let isEmbedded = false;

  let recallConfirmingId: string | null = null;
  let confirmTimer: number | null = null;

  let redownloadConfirmingId: string | null = null;
  let redownloadConfirmTimer: number | null = null;

  // Copy success indicator
  let copiedId: string | null = null;
  let copiedTimer: number | null = null;

  // Scroll to bottom logic
  let messagesEl: HTMLDivElement;
  let followLatest = true;
  let unreadSinceScroll = 0;
  let isNearBottomValue = true;
  let programmaticScroll = false;
  let programmaticScrollTimer: number | null = null;

  function handleCopy(messageId: string, text: string) {
    const doCopy = () => {
      copiedId = messageId;
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = window.setTimeout(() => {
        copiedId = null;
      }, 2000);
      dispatch('systemNotice', currentLang === 'en' ? 'Text copied' : '文本已复制');
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        doCopy();
      }).catch(() => {
        if (fallbackCopyInternal(text)) {
          doCopy();
        } else {
          dispatch('systemNotice', currentLang === 'en' ? 'Copy failed' : '复制失败');
        }
      });
    } else {
      if (fallbackCopyInternal(text)) {
        doCopy();
      } else {
        dispatch('systemNotice', currentLang === 'en' ? 'Copy failed' : '复制失败');
      }
    }
  }

  function fallbackCopyInternal(text: string): boolean {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    } catch (e) {
      return false;
    }
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

  function handleFocusIn(e: FocusEvent) {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
      if (followLatest && messagesEl) {
        const scroll = () => {
          if (followLatest && messagesEl) {
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
        };
        scroll();
        setTimeout(scroll, 50);
        setTimeout(scroll, 150);
        setTimeout(scroll, 300);
        setTimeout(scroll, 500);
      }
    }
  }

  function handleVisualViewportResize() {
    if (followLatest && messagesEl) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  function handleWindowResize() {
    if (followLatest && messagesEl) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  onMount(() => {
    window.addEventListener('resize', handleWindowResize);
    document.addEventListener('focusin', handleFocusIn);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleVisualViewportResize);
    }
  });

  onDestroy(() => {
    window.removeEventListener('resize', handleWindowResize);
    document.removeEventListener('focusin', handleFocusIn);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', handleVisualViewportResize);
    }
    if (confirmTimer) clearTimeout(confirmTimer);
    if (copiedTimer) clearTimeout(copiedTimer);
    if (programmaticScrollTimer) clearTimeout(programmaticScrollTimer);
    if (redownloadConfirmTimer) clearTimeout(redownloadConfirmTimer);
  });

  function handleRedownloadClick(messageId: string, filename: string, size: number, isPaid: boolean) {
    if (redownloadConfirmingId === messageId) {
      handleDownload(messageId, filename, size, isPaid);
      clearRedownloadConfirm();
    } else {
      redownloadConfirmingId = messageId;
      if (redownloadConfirmTimer) clearTimeout(redownloadConfirmTimer);
      redownloadConfirmTimer = window.setTimeout(clearRedownloadConfirm, 4000);
    }
  }

  function clearRedownloadConfirm() {
    redownloadConfirmingId = null;
    if (redownloadConfirmTimer) {
      clearTimeout(redownloadConfirmTimer);
      redownloadConfirmTimer = null;
    }
  }

  function handleDownload(messageId: string, filename: string, size: number, isPaid: boolean) {
    dispatch('startDownload', { messageId, filename, size, isPaid });
  }

  function handleCancel(txId: string) {
    dispatch('cancelDownload', txId);
  }

  function handleOpenFolder(msg: Message) {
    dispatch('openFolder', msg);
  }

  function formatBytes(bytes: number, decimals = 2) {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  function getMessageColors(msg: Message, mine: boolean) {
    if (mine && $currentDevice && $currentDevice.theme) {
      const colors = getThemeColors($currentDevice.theme);
      if (colors) return colors;
    }
    if (msg.theme) {
      const colors = getThemeColors(msg.theme);
      if (colors) return colors;
    }
    if (msg.sender) {
      return getSenderThemeColors(msg.sender);
    }
    return { bg: '#f1f5f9', border: '#cbd5e1', text: '#334155' };
  }

  // Scroll Helpers
  function isNearBottom(): boolean {
    if (!messagesEl) return true;
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
  }

  function handleScroll() {
    if (!messagesEl) return;
    isNearBottomValue = isNearBottom();

    if (isNearBottomValue) {
      followLatest = true;
      unreadSinceScroll = 0;
    } else {
      if (!programmaticScroll) {
        followLatest = false;
      }
    }
  }

  function scrollToBottom() {
    if (!messagesEl) return;
    programmaticScroll = true;
    if (programmaticScrollTimer) clearTimeout(programmaticScrollTimer);

    messagesEl.scrollTop = messagesEl.scrollHeight;
    isNearBottomValue = true;

    programmaticScrollTimer = window.setTimeout(() => {
      programmaticScroll = false;
      if (isNearBottom()) {
        followLatest = true;
        unreadSinceScroll = 0;
      }
    }, 200);
  }

  let prevMessageCount = 0;
  function handleNewMessages(currentMessages: Message[]) {
    if (prevMessageCount === 0) {
      prevMessageCount = currentMessages.length;
      setTimeout(scrollToBottom, 50);
      return;
    }

    if (currentMessages.length > prevMessageCount) {
      const addedCount = currentMessages.length - prevMessageCount;
      prevMessageCount = currentMessages.length;

      const lastMsg = currentMessages[currentMessages.length - 1];
      const sentByMe = isMine(lastMsg);

      if (sentByMe) {
        followLatest = true;
        unreadSinceScroll = 0;
        setTimeout(scrollToBottom, 50);
      } else {
        if (followLatest) {
          setTimeout(scrollToBottom, 50);
        } else {
          unreadSinceScroll += addedCount;
        }
      }
    } else {
      prevMessageCount = currentMessages.length;
    }
  }

  $: {
    if (messages && messages.length > 0) {
      handleNewMessages(messages);
    }
  }
  let completedMap: Record<string, boolean> = {};
</script>

<div class="message-list-container" style="position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column;">
  <div bind:this={messagesEl} class="messages" on:scroll={handleScroll}>
    {#each messages.filter(m => !(m.type === 'file' && !isMine(m) && !isEmbedded && (m.uploading || !m.downloaded))) as msg (msg.id)}
      {#if msg.type === 'system'}
        <div class="system-message">
          <span class="system-text">{msg.text}</span>
        </div>
      {:else}
        {@const mine = isMine(msg)}
        {@const localPeer = $currentDevice?.peer || 'desktop'}
        {@const dlTx = txState[msg.id] || Object.values(txState).find(t => t.messageId === msg.id && t.clientId === localPeer)}
        {@const ulTx = txState['ul-' + msg.id]}
        {@const isTxCompleted = dlTx && dlTx.state === 'completed'}
        {@const _dummy = isTxCompleted ? (completedMap[msg.id] = true) : null}
        {@const isDownloaded = isTxCompleted || completedMap[msg.id] || (isEmbedded && !!msg.filePath)}
        {@const tx = mine ? ulTx : dlTx}
        {@const colors = getMessageColors(msg, mine)}
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
            <div class="bubble" style="position: relative; overflow: hidden;">
              {#if msg.type === 'file' && (mine || isEmbedded) && (msg.uploading || (ulTx && ulTx.state === 'running'))}
                <div class="upload-mask" style="
                  position: absolute;
                  top: 0;
                  left: 0;
                  right: 0;
                  bottom: 0;
                  background: var(--accent-wash);
                  opacity: 0.96;
                  backdrop-filter: blur(1.5px);
                  display: flex;
                  flex-direction: column;
                  align-items: center;
                  justify-content: center;
                  z-index: 10;
                  padding: 8px 12px;
                  box-sizing: border-box;
                  text-align: center;
                ">
                  <span style="font-size: 13px; font-weight: 600; color: var(--accent-strong); margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                    <svg class="icon-uploading-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-dasharray="16 16" fill="none" />
                    </svg>
                    {#if ulTx && ulTx.state === 'running'}
                      {currentLang === 'en' ? 'Uploading' : '正在上传'} {ulTx.percent ?? 0}%
                    {:else}
                      {currentLang === 'en' ? 'Preparing' : '准备中'}...
                    {/if}
                  </span>
                  <div style="width: 80%; height: 5px; background: rgba(0, 0, 0, 0.08); border-radius: 3.5px; overflow: hidden; margin-top: 2px;">
                    <div style="width: {ulTx?.percent ?? 0}%; height: 100%; background: var(--accent-strong); transition: width 0.15s ease-out; border-radius: 3.5px;"></div>
                  </div>
                </div>
              {/if}
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
                                · {currentLang === 'en' ? 'Transferring' : '传输中'} {tx.percent ?? 0}%
                              {:else if tx.state === 'completed'}
                                · {mine ? (currentLang === 'en' ? 'Shared' : '已分享') : (currentLang === 'en' ? 'Downloaded' : '已下载')}
                              {:else if tx.state === 'failed'}
                                · <span class="tx-error-text" title={tx.error || (currentLang === 'en' ? 'Unknown error' : '未知传输错误')} style="color: #ef4444; cursor: help; text-decoration: underline dotted;">{currentLang === 'en' ? 'Failed' : '传输失败'} ⚠️</span>
                              {/if}
                            {:else}
                              {#if mine && msg.downloaded}
                                · {currentLang === 'en' ? 'Shared' : '已分享'}
                              {:else if !mine && isDownloaded}
                                · {currentLang === 'en' ? 'Downloaded' : '已下载'}
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
              <div class="message-footer" style="
                margin-top: 4px;
                --message-action-bg: {colors.bg};
                --message-action-border: {colors.border};
                --message-action-text: {colors.text};
              ">
                {#if msg.type === 'text'}
                  <div class="message-footer-actions">
                    <button class="bubble-action" type="button" on:click={() => handleCopy(msg.id, msg.text || '')} title="Copy">
                      {#if copiedId === msg.id}
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--message-action-text, var(--accent-strong));">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      {:else}
                        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <rect x="9" y="9" width="11" height="11" rx="2" ry="2"/>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                      {/if}
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
                  <div class="message-footer-actions">
                    {#if mine}
                      {#if ulTx && ulTx.state === 'running'}
                        <button class="bubble-action" on:click={() => handleCancel(ulTx.id)} title="Cancel">
                          <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                        </button>
                      {:else}
                        {#if isEmbedded}
                          <button class="bubble-action" on:click={() => handleOpenFolder(msg)} title={currentLang === 'en' ? 'Open in Folder' : '定位文件'}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                            </svg>
                          </button>
                        {/if}
                      {/if}
                    {:else}
                      {#if msg.uploading}
                        <div class="bubble-action disabled-upload" title={currentLang === 'en' ? 'Uploading...' : '对方上传中...'} style="display: flex; align-items: center; justify-content: center; padding: 4px;">
                          <svg class="icon-uploading-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px; opacity: 0.6;">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-dasharray="16 16" fill="none" />
                          </svg>
                        </div>
                      {:else if isDownloaded}
                        <div style="display: flex; gap: 6px; align-items: center;">
                          <button 
                            class="bubble-action completed-btn {redownloadConfirmingId === msg.id ? 'confirm-redownload' : ''}" 
                            on:click={() => handleRedownloadClick(msg.id, msg.fileName || '', msg.size || 0, false)} 
                            title={isEmbedded
                              ? (currentLang === 'en' ? 'Download' : '下载')
                              : (redownloadConfirmingId === msg.id 
                                ? (currentLang === 'en' ? 'Click again to redownload' : '再次点击以重新下载') 
                                : (currentLang === 'en' ? 'Downloaded (Click to redownload)' : '已下载 (点击重新下载)'))}
                          >
                            {#if redownloadConfirmingId === msg.id || isEmbedded}
                              <svg class="icon-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                              </svg>
                            {:else}
                              <svg class="icon-completed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                              <svg class="icon-download icon-download-hover" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                              </svg>
                            {/if}
                          </button>
                          {#if isEmbedded && (msg.filePath || msg.fileName)}
                            <button class="bubble-action" on:click={() => handleOpenFolder(msg)} title={currentLang === 'en' ? 'Open in Folder' : '定位文件'}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                              </svg>
                            </button>
                          {/if}
                        </div>
                      {:else if dlTx && dlTx.state === 'running'}
                        <button class="bubble-action" on:click={() => handleCancel(dlTx.id)} title="Cancel">
                          <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                        </button>
                      {:else if dlTx && dlTx.state === 'failed'}
                        <button class="bubble-action error-retry-btn" on:click={() => handleDownload(msg.id, msg.fileName || '', msg.size || 0, false)} title={`${currentLang === 'en' ? 'Download failed:' : '传输失败:'} ${dlTx.error || (currentLang === 'en' ? 'Unknown error' : '未知错误')}. ${currentLang === 'en' ? 'Click to retry.' : '点击以重试。'}`}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #ef4444;">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                          </svg>
                        </button>
                      {:else}
                        <button class="bubble-action" on:click={() => handleDownload(msg.id, msg.fileName || '', msg.size || 0, false)} title="Download">
                          <svg class="icon-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                        </button>
                      {/if}
                    {/if}

                    {#if mine}
                      {#if !(msg.type === 'file' && ((tx && (tx.state === 'running' || tx.state === 'completed')) || msg.downloaded || msg.uploading))}
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

  <button class="scroll-arrow" class:visible={!followLatest && !isNearBottomValue} on:click={scrollToBottom} aria-label="Jump to latest message" title="Latest message">
    <svg viewBox="0 0 24 24">
      <polyline points="6 9 12 15 18 9" />
    </svg>
    {#if unreadSinceScroll > 0}
      <span class="scroll-arrow-badge">
        {unreadSinceScroll > 99 ? '99+' : unreadSinceScroll}
      </span>
    {/if}
  </button>
</div>

<style>
  /* Rely on global app.css V1 classes */
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  :global(.icon-uploading-spin) {
    animation: spin 1.5s linear infinite;
  }
</style>
