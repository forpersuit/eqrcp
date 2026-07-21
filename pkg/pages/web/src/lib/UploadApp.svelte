<script lang="ts">
  import { onMount } from 'svelte';
  import { t, currentLocale, type Locale } from './i18n';

  export let title: string = 'Send to EQT';
  export let logoUrl: string = '/favicon.png';
  export let maxFileSizeStr: string = '';

  let files: File[] = [];
  let isUploading = false;
  let uploadProgress = 0;
  let statusMessage = '';
  let pasteText = '';
  let isDragging = false;

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files) {
      files = [...files, ...Array.from(input.files)];
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDragging = true;
  }

  function handleDragLeave() {
    isDragging = false;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
    if (e.dataTransfer?.files) {
      files = [...files, ...Array.from(e.dataTransfer.files)];
    }
  }

  function removeFile(index: number) {
    files = files.filter((_, i) => i !== index);
  }

  function clearFiles() {
    files = [];
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  async function startUpload() {
    if (files.length === 0 && !pasteText.trim()) return;
    isUploading = true;
    uploadProgress = 0;

    // 如果包含文本内容，则作为临时文本文件上传
    let uploadQueue = [...files];
    if (pasteText.trim()) {
      const blob = new Blob([pasteText], { type: 'text/plain;charset=utf-8' });
      const textFile = new File([blob], `note_${Date.now()}.txt`, { type: 'text/plain' });
      uploadQueue.push(textFile);
    }

    const formData = new FormData();
    uploadQueue.forEach((file) => formData.append('file', file));

    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/upload', true);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          uploadProgress = Math.round((e.loaded / e.total) * 100);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          uploadProgress = 100;
          statusMessage = t('uploadComplete');
          files = [];
          pasteText = '';
        } else {
          statusMessage = 'Upload failed with status ' + xhr.status;
        }
        isUploading = false;
      };
      xhr.onerror = () => {
        statusMessage = 'Network error during upload.';
        isUploading = false;
      };
      xhr.send(formData);
    } catch (err: any) {
      statusMessage = err.message || 'Upload error';
      isUploading = false;
    }
  }

  onMount(() => {
    const sysLang = navigator.language.slice(0, 2) as Locale;
    if (['zh', 'en', 'ja', 'ko', 'es', 'de', 'fr'].includes(sysLang)) {
      currentLocale.set(sysLang);
    }
  });
</script>

<div class="mobile-upload-container">
  <header class="app-header">
    <div class="brand">
      <img src={logoUrl} alt="Logo" class="logo" />
      <div>
        <h1>{title || t('sendToEQT')}</h1>
        <p class="subtitle">{maxFileSizeStr ? `Max: ${maxFileSizeStr}` : t('statusConnected')}</p>
      </div>
    </div>
  </header>

  <main class="app-content">
    <div
      class="dropzone {isDragging ? 'dragging' : ''}"
      on:dragover={handleDragOver}
      on:dragleave={handleDragLeave}
      on:drop={handleDrop}
      role="region"
      aria-label={t('dragDropTips')}
    >
      <div class="icon-cloud">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
      </div>
      <p class="drop-tips">{t('dragDropTips')}</p>
      <label class="btn-select">
        <span>{t('selectFiles')}</span>
        <input type="file" multiple on:change={handleFileSelect} />
      </label>
    </div>

    {#if files.length > 0}
      <div class="file-list">
        <div class="list-header">
          <span>{t('itemsSelected', { count: files.length })}</span>
          <button class="btn-clear" on:click={clearFiles}>Clear</button>
        </div>
        <ul>
          {#each files as file, index}
            <li>
              <span class="file-icon">📄</span>
              <div class="file-info">
                <span class="file-name">{file.name}</span>
                <span class="file-size">{formatBytes(file.size)}</span>
              </div>
              <button class="btn-remove" on:click={() => removeFile(index)}>×</button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <div class="text-composer">
      <textarea
        bind:value={pasteText}
        placeholder={t('pasteTextHint')}
        rows="3"
      ></textarea>
    </div>

    {#if isUploading}
      <div class="progress-bar-container">
        <div class="progress-bar" style="width: {uploadProgress}%"></div>
        <span class="progress-text">{t('uploading')} {uploadProgress}%</span>
      </div>
    {/if}

    {#if statusMessage}
      <div class="notice">{statusMessage}</div>
    {/if}

    <div class="action-row">
      <button
        class="btn-primary"
        disabled={isUploading || (files.length === 0 && !pasteText.trim())}
        on:click={startUpload}
      >
        {isUploading ? t('uploading') : t('startUpload')}
      </button>
    </div>
  </main>
</div>

<style>
  .mobile-upload-container {
    max-width: 600px;
    margin: 0 auto;
    padding: 16px;
    font-family: system-ui, -apple-system, sans-serif;
    color: var(--text, #17211f);
  }
  .app-header .brand {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
  }
  .logo {
    width: 44px;
    height: 44px;
    border-radius: 8px;
    border: 1px solid rgba(0,0,0,0.1);
  }
  h1 {
    font-size: 20px;
    margin: 0;
    font-weight: 700;
  }
  .subtitle {
    font-size: 12px;
    color: #66736f;
    margin: 2px 0 0 0;
  }
  .dropzone {
    border: 2px dashed #d8e0dd;
    border-radius: 12px;
    padding: 24px;
    text-align: center;
    background: #ffffff;
    transition: all 0.2s ease;
  }
  .dropzone.dragging {
    border-color: #0f766e;
    background: rgba(15, 118, 110, 0.05);
  }
  .icon-cloud svg {
    width: 36px;
    height: 36px;
    color: #0f766e;
  }
  .drop-tips {
    font-size: 13px;
    color: #66736f;
    margin: 12px 0;
  }
  .btn-select {
    display: inline-block;
    background: #0f766e;
    color: white;
    padding: 10px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .btn-select input {
    display: none;
  }
  .file-list {
    margin-top: 16px;
    background: #fff;
    border: 1px solid #d8e0dd;
    border-radius: 8px;
    padding: 12px;
  }
  .list-header {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    font-weight: 700;
    color: #66736f;
    margin-bottom: 8px;
  }
  .btn-clear {
    background: none;
    border: none;
    color: #b42318;
    cursor: pointer;
    font-size: 12px;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid #f0f4f3;
  }
  li:last-child {
    border-bottom: none;
  }
  .file-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .file-name {
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .file-size {
    font-size: 11px;
    color: #66736f;
  }
  .btn-remove {
    background: none;
    border: none;
    font-size: 16px;
    color: #999;
    cursor: pointer;
  }
  .text-composer {
    margin-top: 16px;
  }
  textarea {
    width: 100%;
    border: 1px solid #d8e0dd;
    border-radius: 8px;
    padding: 10px;
    font-size: 13px;
    box-sizing: border-box;
    outline: none;
  }
  .progress-bar-container {
    margin-top: 16px;
    background: #e5eae8;
    border-radius: 6px;
    height: 20px;
    position: relative;
    overflow: hidden;
  }
  .progress-bar {
    background: #0f766e;
    height: 100%;
    transition: width 0.2s ease;
  }
  .progress-text {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    color: #fff;
  }
  .notice {
    margin-top: 12px;
    padding: 8px 12px;
    background: rgba(15, 118, 110, 0.1);
    border: 1px solid #0f766e;
    color: #0f766e;
    border-radius: 6px;
    font-size: 13px;
  }
  .action-row {
    margin-top: 20px;
  }
  .btn-primary {
    width: 100%;
    background: #0f766e;
    color: white;
    border: none;
    padding: 12px;
    border-radius: 8px;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
