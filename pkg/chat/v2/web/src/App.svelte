<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import DevicePanel from './components/DevicePanel.svelte';
  import MessageList from './components/MessageList.svelte';
  import MessageComposer from './components/MessageComposer.svelte';
  import TransferStatus from './components/TransferStatus.svelte';
  import { ChatWebSocketClient } from './services/websocket';
  import { chatActions, currentDevice, peers, connState } from './state/chatStore';
  import { getThemeColors } from './services/types';

  let client: ChatWebSocketClient;
  let token = '';
  let isEmbedded = false;
  let showMobileDrawer = false;

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

  function toggleMobileDrawer() {
    showMobileDrawer = !showMobileDrawer;
  }

  function handleClose() {
    window.location.href = '/close';
  }
</script>

<main class="app-layout">
  <!-- Desktop Left Panel -->
  <div class="sidebar-desktop left-sidebar">
    <DevicePanel />
  </div>

  <div class="chat-main">
    <div class="chat-header">
      <div class="brand">
        {#if isEmbedded}
          <button class="close-btn" on:click={handleClose} title="关闭网页" aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
        {/if}
        <span class="logo-mark">EQT</span>
        <h1>CHAT V2</h1>
      </div>

      <div class="header-right">
        <!-- Mobile Device Pill Button -->
        <button class="device-pill-btn" on:click={toggleMobileDrawer}>
          <svg class="pill-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
          </svg>
          <span class="pill-dot" class:online={$connState === 'connected'}></span>
          <span class="pill-text">设备: {$peers.length}</span>
        </button>

        <div class="room-info-desktop">
          房间: <span class="token-code">{token}</span>
        </div>
      </div>
    </div>
    
    <MessageList 
      on:startDownload={handleStartDownload}
      on:cancelDownload={handleCancelDownload}
    />
    
    <MessageComposer 
      on:sendText={handleSendText}
      on:sendFile={handleSendFile}
    />
  </div>

  <!-- Desktop Right Panel -->
  <div class="sidebar-desktop right-sidebar">
    <TransferStatus />
  </div>

  <!-- Mobile Drawer Overlay -->
  {#if showMobileDrawer}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="drawer-backdrop" on:click={toggleMobileDrawer}>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="drawer-content" on:click|stopPropagation>
        <div class="drawer-header">
          <h3>房间详情</h3>
          <button class="drawer-close" on:click={toggleMobileDrawer} title="关闭详情" aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="drawer-body">
          <div class="room-details">
            房间 Token: <span class="token-code">{token}</span>
          </div>
          <div class="panels-stack">
            <DevicePanel />
            <div class="divider"></div>
            <TransferStatus />
          </div>
        </div>
      </div>
    </div>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background: #09080e;
    color: rgba(255, 255, 255, 0.95);
    overflow: hidden;
    height: 100vh;
  }

  :global(:root) {
    --accent: #7c3aed;
    --accent-strong: #db2777;
    --accent-wash: rgba(124, 58, 237, 0.1);
  }

  .app-layout {
    display: flex;
    width: 100vw;
    height: 100vh;
    background: radial-gradient(circle at top right, #1f1a30, #08070d);
  }

  .chat-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
  }

  .chat-header {
    height: 60px;
    padding: 0 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: rgba(14, 12, 21, 0.4);
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(10px);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .close-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.7);
    padding: 4px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .close-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.05);
  }

  .close-btn svg {
    width: 18px;
    height: 18px;
  }

  .logo-mark {
    font-size: 0.8rem;
    font-weight: 900;
    letter-spacing: 0.1em;
    background: linear-gradient(135deg, var(--accent), var(--accent-strong));
    padding: 3px 6px;
    border-radius: 4px;
    color: #fff;
    box-shadow: 0 2px 8px var(--accent-wash);
    transition: all 0.3s ease;
  }

  h1 {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.9);
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .room-info-desktop {
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.45);
  }

  .token-code {
    font-family: monospace;
    color: var(--accent-strong);
    background: var(--accent-wash);
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: bold;
    transition: all 0.3s ease;
  }

  /* Responsive Sidebar layouts */
  .sidebar-desktop {
    display: block;
    height: 100%;
  }

  /* Device Pill Button (Mobile & Adaptive) */
  .device-pill-btn {
    align-items: center;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 999px;
    color: var(--accent-strong);
    cursor: pointer;
    display: inline-flex;
    font-size: 0.75rem;
    font-weight: 800;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    transition: all 0.2s ease;
  }

  .device-pill-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.15);
  }

  .pill-icon {
    width: 14px;
    height: 14px;
  }

  .pill-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #ef4444;
  }

  .pill-dot.online {
    background: #10b981;
    box-shadow: 0 0 6px #10b981;
  }

  .pill-text {
    color: rgba(255, 255, 255, 0.85);
  }

  /* Drawer CSS */
  .drawer-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    z-index: 999;
    display: flex;
    justify-content: flex-end;
  }

  .drawer-content {
    width: 300px;
    height: 100%;
    background: #0d0b13;
    border-left: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    flex-direction: column;
    box-shadow: -10px 0 30px rgba(0, 0, 0, 0.5);
    animation: slideLeft 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .drawer-header {
    height: 60px;
    padding: 0 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .drawer-header h3 {
    margin: 0;
    font-size: 0.9rem;
    font-weight: bold;
    color: #fff;
  }

  .drawer-close {
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
  }

  .drawer-close svg {
    width: 20px;
    height: 20px;
  }

  .drawer-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .room-details {
    padding: 0 20px;
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .panels-stack {
    display: flex;
    flex-direction: column;
    flex: 1;
  }

  .panels-stack :global(.device-panel),
  .panels-stack :global(.status-panel) {
    width: 100%;
    border-right: none;
    border-left: none;
    background: transparent;
    backdrop-filter: none;
  }

  .divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.05);
    margin: 10px 20px;
  }

  /* Screen Rules */
  @media (max-width: 768px) {
    .sidebar-desktop {
      display: none;
    }
    .room-info-desktop {
      display: none;
    }
    .device-pill-btn {
      display: inline-flex;
    }
  }

  @media (min-width: 769px) {
    .device-pill-btn {
      display: none;
    }
    .sidebar-desktop {
      display: block;
    }
  }

  @keyframes slideLeft {
    from {
      transform: translateX(100%);
    }
    to {
      transform: translateX(0);
    }
  }
</style>
