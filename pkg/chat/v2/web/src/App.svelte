<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import MessageList from './components/MessageList.svelte';
  import MessageComposer from './components/MessageComposer.svelte';
  import { ChatWebSocketClient } from './services/websocket';
  import { chatActions, currentDevice, peers, connState } from './state/chatStore';
  import { getThemeColors } from './services/types';

  let client: ChatWebSocketClient;
  let token = '';
  let isEmbedded = false;

  let showDevicePanel = false;
  let showLicensePanel = false;
  let showLangPanel = false;
  let showShareModal = false;
  let showUrl = false;
  let copied = false;
  
  let currentLang = localStorage.getItem('eqt_lang') || 'zh';

  // React to theme changes and inject CSS variables
  $: {
    if ($currentDevice && $currentDevice.theme) {
      const colors = getThemeColors($currentDevice.theme);
      if (colors) {
        document.documentElement.style.setProperty('--accent', colors.border);
        document.documentElement.style.setProperty('--accent-strong', colors.text);
        document.documentElement.style.setProperty('--accent-wash', colors.bg);
      }
    }
  }

  onMount(() => {
    isEmbedded = window.parent !== window || document.documentElement.classList.contains('embedded-chat');

    // Extract token from path /chat-v2/{token}
    const path = window.location.pathname;
    const parts = path.split('/');
    const tokenIdx = parts.indexOf('chat-v2');
    if (tokenIdx !== -1 && tokenIdx + 1 < parts.length) {
      token = parts[tokenIdx + 1];
    }
    if (!token) {
      token = 'default-room';
    }

    client = new ChatWebSocketClient(token);
    client.connect();
  });

  onDestroy(() => {
    if (client) {
      client.close();
    }
  });

  function handleSendText(e: CustomEvent<string>) {
    if (client) {
      client.sendText(e.detail);
    }
  }

  function handleSendFile(e: CustomEvent<{ name: string; size: number; type: string }>) {
    if (client) {
      const filePayload = JSON.stringify({
        type: 'file',
        fileName: e.detail.name,
        size: e.detail.size
      });
      client.sendText(filePayload);
    }
  }

  function handleStartDownload(e: CustomEvent<{ messageId: string; filename: string; size: number; isPaid: boolean }>) {
    const { messageId, filename, size, isPaid } = e.detail;
    if (!client) return;

    const transferId = 'dl-' + messageId;
    client.startTransfer(transferId);

    const downloadURL = `/chat-v2/${token}/files/${messageId}?mock_size=${size}&clientId=${client['clientPeer']}&messageId=${messageId}&filename=${encodeURIComponent(filename)}&is_paid=${isPaid}`;

    const link = document.createElement('a');
    link.href = downloadURL;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    chatActions.addSystemMessage(`Initiated ${isPaid ? 'VIP Accelerated (10MB/s)' : 'Standard Limit (512KB/s)'} native stream download for: ${filename}`);
  }

  function handleCancelDownload(e: CustomEvent<string>) {
    if (client) {
      client.cancelTransfer(e.detail);
    }
  }

  function handleClose() {
    window.location.href = '/close';
  }

  function setLanguage(lang: string) {
    localStorage.setItem('eqt_lang', lang);
    localStorage.setItem('eqt-page-lang', lang);
    currentLang = lang;
    showLangPanel = false;
    window.location.reload();
  }

  $: joinUrl = window.location.origin + "/chat-v2/" + token;

  function handleCopyUrl() {
    navigator.clipboard.writeText(joinUrl).then(() => {
      copied = true;
      setTimeout(() => copied = false, 2000);
    });
  }

  function closeAllPanels() {
    showDevicePanel = false;
    showLicensePanel = false;
    showLangPanel = false;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="chat-viewport" on:click={closeAllPanels}>
  <main>
    <section class="chat-shell">
      <header class="chat-head" class:offline={$connState !== 'connected'}>
        <div class="chat-head-title">
          <img class="chat-logo" src="/assets/eqt-logo-mark.png" alt="EQT logo">
          <div class="chat-title-container">
            <h1 id="chat-title-text">EQT<span class="license-badge">VIP</span></h1>
          </div>
        </div>

        <div class="head-actions">
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="limit-status-pill" style="display: flex; cursor: pointer; align-items: center; background: #eef5ee; border: 1px solid var(--line); border-radius: 999px; height: 36px; padding: 0 11px; color: var(--accent-strong); font-size: 12px; font-weight: 800;" on:click|stopPropagation={() => { showLicensePanel = !showLicensePanel; showDevicePanel = false; showLangPanel = false; }} title="点击查看订阅详情">
            <span>VIP / 无限制</span>
          </div>

          <button class="device-pill" type="button" on:click|stopPropagation={() => { showDevicePanel = !showDevicePanel; showLangPanel = false; showLicensePanel = false; }} title="Show connected devices">
            <svg viewBox="0 0 24 24" aria-hidden="true" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="4" width="18" height="12" rx="2"></rect><path d="M8 20h8"></path><path d="M12 16v4"></path></svg>
            <span id="device-count">{$peers.length}</span>
          </button>

          <button class="icon-button qr-breathe" type="button" on:click|stopPropagation={() => { showShareModal = true; closeAllPanels(); }} title="Show session QR">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4z"></path><path d="M14 4h6v6h-6z"></path><path d="M4 14h6v6H4z"></path><path d="M14 14h2v2h-2z"></path><path d="M18 14h2v6h-4v-2h2z"></path><path d="M14 18h2v2h-2z"></path></svg>
          </button>

          {#if isEmbedded}
            <button class="icon-button danger" type="button" on:click={handleClose} title="Stop chat">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>
            </button>
          {/if}

          <button class="icon-button" type="button" on:click|stopPropagation={() => { showLangPanel = !showLangPanel; showDevicePanel = false; showLicensePanel = false; }} title="Switch language">
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
          </button>

          <!-- Panels -->
          <div class="device-panel" class:open={showDevicePanel} on:click|stopPropagation>
            <div class="device-panel-title" style="margin-bottom: 8px;">在线设备</div>
            <div class="device-roster">
              {#each $peers as dev}
                <div class="device-row-lite">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"></rect><path d="M8 20h8"></path><path d="M12 16v4"></path></svg>
                  <div>
                    <strong>{dev.label}</strong>
                    <span>{dev.peer || 'connected'}</span>
                  </div>
                  {#if dev.id === $currentDevice?.id}
                    <span class="device-state">本机</span>
                  {/if}
                </div>
              {:else}
                <div class="device-empty">无其他在线设备</div>
              {/each}
            </div>
          </div>

          <div class="license-panel" class:open={showLicensePanel} on:click|stopPropagation>
            <div class="license-panel-title" style="margin-bottom: 8px;">订阅与许可证详情</div>
            <div class="license-details-box">
              <div class="license-status-badge success">VIP 永久授权版</div>
              <div class="license-info-row">
                <strong>授权状态</strong>
                <span>有效（永久）</span>
              </div>
              <div class="license-info-row">
                <strong>加速限流</strong>
                <span>无限制极速加速</span>
              </div>
              <div class="license-info-row">
                <strong>指纹校验</strong>
                <span>通过</span>
              </div>
            </div>
          </div>

          <div class="lang-panel" class:open={showLangPanel} on:click|stopPropagation>
            <div class="lang-panel-title">选择语言</div>
            <div class="lang-list">
              <button class="lang-option" class:active={currentLang === 'zh'} on:click={() => setLanguage('zh')}>简体中文</button>
              <button class="lang-option" class:active={currentLang === 'en'} on:click={() => setLanguage('en')}>English</button>
            </div>
          </div>
        </div>
      </header>

      <MessageList 
        on:startDownload={handleStartDownload}
        on:cancelDownload={handleCancelDownload}
      />

      <MessageComposer 
        on:sendText={handleSendText}
        on:sendFile={handleSendFile}
      />
    </section>

    <!-- QR Backdrop Modal -->
    <div class="session-backdrop" class:open={showShareModal} on:click|self={() => showShareModal = false}>
      <aside class="side">
        <div class="side-section-head">
          <h1 style="font-size: 16px; font-weight: bold;">会话二维码</h1>
          <button class="icon-button" type="button" on:click={() => showShareModal = false} title="Close">
            <svg viewBox="0 0 24 24" aria-hidden="true" stroke="currentColor" stroke-width="2" fill="none"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <p class="side-note">扫描下方二维码从其他设备加入会话</p>
        <div class="qr-frame">
          <img class="qr" src="/chat-v2/{token}/qr.png" alt="Chat QR code">
        </div>
        <div class="session-collapsible" class:collapsed={!showUrl}>
          <div class="url-row" style="margin-top: 8px;">
            <input value={joinUrl} readonly style="background: #eef5ee; border: 1px solid var(--line); border-radius: 8px; font-family: monospace; font-size: 12px; padding: 6px 8px; width: 100%; box-sizing: border-box;">
            <button class="side-btn" type="button" on:click={handleCopyUrl} style="flex-shrink: 0;">
              {copied ? '已复制' : '复制'}
            </button>
          </div>
        </div>
        <button class="session-toggle" type="button" on:click={() => showUrl = !showUrl} style="margin-top: 8px;">
          {showUrl ? '隐藏加入链接' : '显示加入链接'}
        </button>
      </aside>
    </div>
  </main>
</div>

<style>
  /* 
    Rely on global app.css V1 styling to layout the components. 
    This enables full复刻 of Legacy V1 UI style.
  */
</style>
