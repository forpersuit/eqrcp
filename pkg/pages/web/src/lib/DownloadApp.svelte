<script lang="ts">
  import { onMount } from 'svelte';
  import { t, currentLocale, type Locale } from './i18n';

  export let title: string = 'Receive from EQT';
  export let logoUrl: string = '/favicon.png';
  export let files: Array<{ name: string; path: string; size: number; url: string }> = [];
  export let zipUrl: string = '';

  function formatBytes(bytes: number): string {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function downloadFile(url: string) {
    window.location.href = url;
  }

  function downloadAllZip() {
    if (zipUrl) {
      window.location.href = zipUrl;
    }
  }

  onMount(() => {
    const sysLang = navigator.language.slice(0, 2) as Locale;
    if (['zh', 'en', 'ja', 'ko', 'es', 'de', 'fr'].includes(sysLang)) {
      currentLocale.set(sysLang);
    }
  });
</script>

<div class="mobile-download-container">
  <header class="app-header">
    <div class="brand">
      <img src={logoUrl} alt="Logo" class="logo" />
      <div>
        <h1>{title || t('receiveFromEQT')}</h1>
        <p class="subtitle">{t('totalFiles', { count: files.length })}</p>
      </div>
    </div>
  </header>

  <main class="app-content">
    {#if zipUrl && files.length > 1}
      <div class="zip-banner">
        <button class="btn-zip" on:click={downloadAllZip}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>{t('downloadAll')}</span>
        </button>
      </div>
    {/if}

    <div class="file-section">
      <div class="section-title">{t('fileList')}</div>
      <ul class="file-cards">
        {#each files as file}
          <li class="file-card">
            <div class="file-icon">📄</div>
            <div class="file-details">
              <span class="file-name" title={file.name}>{file.name}</span>
              <span class="file-size">{formatBytes(file.size)}</span>
            </div>
            <button class="btn-download" on:click={() => downloadFile(file.url)}>
              {t('downloadFile')}
            </button>
          </li>
        {/each}
      </ul>
    </div>
  </main>
</div>

<style>
  .mobile-download-container {
    max-width: 600px;
    margin: 0 auto;
    padding: 16px;
    font-family: system-ui, -apple-system, sans-serif;
    color: #17211f;
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
  .zip-banner {
    margin-bottom: 16px;
  }
  .btn-zip {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: #0f766e;
    color: white;
    border: none;
    padding: 12px;
    border-radius: 8px;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
  }
  .btn-zip svg {
    width: 20px;
    height: 20px;
  }
  .file-section {
    background: #fff;
    border: 1px solid #d8e0dd;
    border-radius: 12px;
    padding: 16px;
  }
  .section-title {
    font-size: 13px;
    font-weight: 700;
    color: #66736f;
    margin-bottom: 12px;
  }
  .file-cards {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .file-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid #f0f4f3;
  }
  .file-card:last-child {
    border-bottom: none;
  }
  .file-icon {
    font-size: 20px;
  }
  .file-details {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .file-name {
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .file-size {
    font-size: 12px;
    color: #66736f;
    margin-top: 2px;
  }
  .btn-download {
    background: rgba(15, 118, 110, 0.1);
    color: #0f766e;
    border: 1px solid #0f766e;
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
</style>
