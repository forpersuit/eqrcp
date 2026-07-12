<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy, tick } from 'svelte';
  import { chatSessionStatus } from '../state/chatStore';
  const dispatch = createEventDispatcher();
  export let text = '';
  export let currentLang = 'zh';
  let fileInput: HTMLInputElement;
  let textareaEl: HTMLTextAreaElement;
  let composerEl: HTMLFormElement;

  function handleSubmit(e: Event) {
    e.preventDefault();
    if ($chatSessionStatus !== 'active') return;
    if (!text.trim()) return;
    
    // Focus back synchronously before the browser event loop triggers dismiss animations on mobile keyboard
    if (textareaEl) {
      textareaEl.focus();
    }

    dispatch('sendText', text);
    text = '';
    
    // Reset height asynchronously
    setTimeout(resizeComposer, 0);
  }

  const isEmbedded = typeof window !== 'undefined' && window.parent !== window;

  function triggerFileInput(e: Event) {
    e.preventDefault();
    if ($chatSessionStatus !== 'active') return;
    if (isEmbedded) {
      const requestId = 'select-' + Math.random().toString(36).substring(2, 11);
      window.parent.postMessage({ type: 'select-files', requestId }, '*');
    } else {
      fileInput.click();
    }
  }

  function handleFileChange(e: Event) {
    const files = fileInput.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      dispatch('sendFile', {
        file: file, // Include raw file object
        name: file.name,
        size: file.size,
        type: file.type
      });
    }
    fileInput.value = ''; // clear
  }

  let lastComposerHeight = 0;
  let lastTextLength = 0;

  async function resizeComposer() {
    await tick();
    if (!textareaEl || !composerEl) return;

    const messagesEl = document.querySelector('.messages');
    let wasNearBottom = false;
    if (messagesEl) {
      wasNearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
    }

    const style = window.getComputedStyle(textareaEl);
    const border = parseFloat(style.borderTopWidth || '0') + parseFloat(style.borderBottomWidth || '0');
    const paddingTop = parseFloat(style.paddingTop || '11');
    const paddingBottom = parseFloat(style.paddingBottom || '11');
    const paddingY = paddingTop + paddingBottom;
    const lineHeight = parseFloat(style.lineHeight || '20');

    // Only reset textarea height to auto if deleting characters to avoid scroll layout jumps on type addition
    const isDeleting = text.length < lastTextLength || text === '';
    lastTextLength = text.length;

    if (isDeleting) {
      textareaEl.style.height = 'auto';
    }

    const rawScrollHeight = textareaEl.scrollHeight;

    let lines = Math.round((rawScrollHeight - paddingY) / lineHeight);
    if (isNaN(lines) || lines < 1) {
      lines = 1;
    }

    const maxLines = 5;
    const effectiveLines = Math.min(lines, maxLines);
    const targetHeight = paddingY + (effectiveLines * lineHeight) + border;

    textareaEl.style.height = targetHeight + 'px';
    textareaEl.style.overflowY = lines > maxLines ? 'auto' : 'hidden';

    // Force scrollTop to bottom when lines exceed 5 to keep the typing line visible and push old lines upward
    if (lines > maxLines) {
      textareaEl.scrollTop = textareaEl.scrollHeight;
    }

    const finalHeight = composerEl.offsetHeight;
    lastComposerHeight = finalHeight;
    document.documentElement.style.setProperty('--composer-height', finalHeight + 'px');

    if (messagesEl && wasNearBottom) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  // Reactive listener to resize height as the user types text
  $: {
    if (text !== undefined) {
      resizeComposer();
    }
  }

  onMount(() => {
    window.addEventListener('resize', resizeComposer);
    resizeComposer();
  });

  onDestroy(() => {
    window.removeEventListener('resize', resizeComposer);
  });
</script>

<form bind:this={composerEl} class="composer" class:session-ended={$chatSessionStatus !== 'active'} on:submit={handleSubmit}>
  <div class="composer-shell">
    <div class="compose-row">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <label class="file-label" class:disabled={$chatSessionStatus !== 'active'} title={currentLang === 'en' ? 'Add attachment' : '添加附件'} aria-label={currentLang === 'en' ? 'Add attachment' : '添加附件'} on:click={triggerFileInput}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12.5 14.5 6a3 3 0 0 1 4.2 4.2L10.8 18.1a5 5 0 1 1-7.1-7.1l8.7-8.7" stroke="currentColor" stroke-width="2" fill="none"/></svg>
      </label>
      <textarea 
        bind:this={textareaEl}
        bind:value={text} 
        placeholder={$chatSessionStatus !== 'active' ? (currentLang === 'en' ? 'Session ended' : '会话已结束') : (currentLang === 'en' ? 'Message...' : '输入消息...')} 
        autocomplete="off" 
        rows="1"
        disabled={$chatSessionStatus !== 'active'}
      ></textarea>
      <div class="composer-actions-right">
        <button class="send-button" type="submit" aria-label={currentLang === 'en' ? 'Send' : '发送'} title={currentLang === 'en' ? 'Send' : '发送'} disabled={!text.trim() || $chatSessionStatus !== 'active'} on:mousedown|preventDefault>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 16-8-5 16-3-7-8-1z" fill="currentColor"/></svg>
        </button>
      </div>
    </div>
  </div>
  <input bind:this={fileInput} on:change={handleFileChange} class="hidden" type="file" multiple disabled={$chatSessionStatus !== 'active'}>
</form>

<style>
  /* Rely on global app.css V1 styling */
</style>
