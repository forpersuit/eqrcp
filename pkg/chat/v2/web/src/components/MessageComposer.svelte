<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy, tick } from 'svelte';
  const dispatch = createEventDispatcher();
  export let text = '';
  let fileInput: HTMLInputElement;
  let textareaEl: HTMLTextAreaElement;
  let composerEl: HTMLFormElement;

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (!text.trim()) return;
    dispatch('sendText', text);
    text = '';
    // Reset height after submit
    setTimeout(resizeComposer, 0);
  }

  function triggerFileInput() {
    fileInput.click();
  }

  function handleFileChange(e: Event) {
    const files = fileInput.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      dispatch('sendFile', {
        name: file.name,
        size: file.size,
        type: file.type
      });
    }
    fileInput.value = ''; // clear
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  let lastComposerHeight = 0;

  async function resizeComposer() {
    await tick();
    if (!textareaEl || !composerEl) return;

    const currentHeight = composerEl.offsetHeight;
    if (currentHeight === lastComposerHeight && lastComposerHeight > 0) {
      return;
    }

    const messagesEl = document.querySelector('.messages');
    let wasNearBottom = false;
    if (messagesEl) {
      wasNearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
    }

    const viewport = window.innerHeight;
    const isDesktop = window.matchMedia && window.matchMedia('(min-width: 821px)').matches;
    const max = isDesktop ? Math.min(viewport * 0.34, 168) : Math.min(viewport * 0.30, 140);
    const min = 40;

    const style = window.getComputedStyle(textareaEl);
    const border = parseFloat(style.borderTopWidth || '0') + parseFloat(style.borderBottomWidth || '0');

    textareaEl.style.height = 'auto';
    textareaEl.style.height = Math.max(min, Math.min(textareaEl.scrollHeight + border, max)) + 'px';
    textareaEl.style.overflowY = textareaEl.scrollHeight + border > max ? 'auto' : 'hidden';

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

<form bind:this={composerEl} class="composer" on:submit={handleSubmit}>
  <div class="composer-shell">
    <div class="compose-row">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <label class="file-label" title="Add attachment" aria-label="Add attachment" on:click={triggerFileInput}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12.5 14.5 6a3 3 0 0 1 4.2 4.2L10.8 18.1a5 5 0 1 1-7.1-7.1l8.7-8.7" stroke="currentColor" stroke-width="2" fill="none"/></svg>
      </label>
      <textarea 
        bind:this={textareaEl}
        bind:value={text} 
        on:keydown={handleKeydown}
        placeholder="Message" 
        autocomplete="off" 
        rows="1"
      ></textarea>
      <button class="send-button" type="submit" aria-label="Send" disabled={!text.trim()}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 16-8-5 16-3-7-8-1z" fill="currentColor"/></svg>
      </button>
    </div>
  </div>
  <input bind:this={fileInput} on:change={handleFileChange} class="hidden" type="file" multiple>
</form>

<style>
  /* Rely on global app.css V1 styling */
</style>
