<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import DevicePanel from './components/DevicePanel.svelte';
  import MessageList from './components/MessageList.svelte';
  import MessageComposer from './components/MessageComposer.svelte';
  import TransferStatus from './components/TransferStatus.svelte';
  import { ChatWebSocketClient } from './services/websocket';
  import { chatActions } from './state/chatStore';

  let client: ChatWebSocketClient;
  let token = '';

  onMount(() => {
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
      // Package file metadata inside a text message to exchange over WebSocket
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

    // First trigger start_transfer command over control-plane WS
    const transferId = 'dl-' + messageId;
    client.startTransfer(transferId);

    // Build native HTTP download URL with limit rules
    // Pass query params required by handleDownload in files.go
    const downloadURL = `/chat-v2/${token}/files/${messageId}?mock_size=${size}&clientId=${client['clientPeer']}&messageId=${messageId}&filename=${encodeURIComponent(filename)}&is_paid=${isPaid}`;

    // Execute native browser download
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
</script>

<main class="app-layout">
  <DevicePanel />
  
  <div class="chat-main">
    <div class="chat-header">
      <div class="brand">
        <span class="logo-mark">EQT</span>
        <h1>EXPERIMENTAL CHAT V2</h1>
      </div>
      <div class="room-info">
        房间 Token: <span class="token-code">{token}</span>
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
  
  <TransferStatus />
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
    gap: 10px;
  }

  .logo-mark {
    font-size: 0.8rem;
    font-weight: 900;
    letter-spacing: 0.1em;
    background: linear-gradient(135deg, #7c3aed, #db2777);
    padding: 3px 6px;
    border-radius: 4px;
    color: #fff;
    box-shadow: 0 2px 8px rgba(124, 58, 237, 0.3);
  }

  h1 {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.9);
  }

  .room-info {
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.45);
  }

  .token-code {
    font-family: monospace;
    color: #a78bfa;
    background: rgba(167, 139, 250, 0.1);
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: bold;
  }
</style>
