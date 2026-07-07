<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();
  let text = '';
  let fileInput: HTMLInputElement;

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (!text.trim()) return;
    dispatch('sendText', text);
    text = '';
  }

  function triggerFileInput() {
    fileInput.click();
  }

  function handleFileChange(e: Event) {
    const files = fileInput.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    dispatch('sendFile', {
      name: file.name,
      size: file.size,
      type: file.type
    });
    fileInput.value = ''; // clear
  }
</script>

<form class="composer-form" on:submit={handleSubmit}>
  <input 
    type="file" 
    bind:this={fileInput} 
    on:change={handleFileChange} 
    style="display: none;" 
  />
  
  <button type="button" class="action-btn file-btn" on:click={triggerFileInput} title="发送文件">
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" />
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v6m3-3H9" />
    </svg>
  </button>

  <input 
    type="text" 
    placeholder="输入消息..." 
    bind:value={text} 
    class="text-input"
  />

  <button type="submit" class="action-btn send-btn" disabled={!text.trim()} title="发送">
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
    </svg>
  </button>
</form>

<style>
  .composer-form {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 20px;
    background: rgba(14, 12, 21, 0.4);
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(10px);
  }

  .text-input {
    flex: 1;
    height: 42px;
    padding: 0 16px;
    border-radius: 20px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.03);
    color: #fff;
    font-size: 0.9rem;
    outline: none;
    transition: all 0.2s ease;
  }

  .text-input:focus {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(124, 58, 237, 0.4);
    box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1);
  }

  .action-btn {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    cursor: pointer;
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    transition: all 0.2s ease;
  }

  .action-btn svg {
    width: 20px;
    height: 20px;
  }

  .file-btn {
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.02);
  }

  .file-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.12);
  }

  .send-btn {
    background: linear-gradient(135deg, #7c3aed, #db2777);
    color: #fff;
    box-shadow: 0 4px 12px rgba(124, 58, 237, 0.3);
  }

  .send-btn:hover:not(:disabled) {
    transform: scale(1.05);
    box-shadow: 0 4px 16px rgba(124, 58, 237, 0.5);
  }

  .send-btn:disabled {
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.2);
    box-shadow: none;
    cursor: not-allowed;
  }
</style>
