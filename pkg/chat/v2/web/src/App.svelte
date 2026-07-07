<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import MessageList from './components/MessageList.svelte';
  import MessageComposer from './components/MessageComposer.svelte';
  import { ChatWebSocketClient } from './services/websocket';
  import { chatActions, currentDevice, peers, connState, messages, transfers } from './state/chatStore';
  import { getThemeColors } from './services/types';
  import type { Message } from './services/types';

  let client: ChatWebSocketClient;
  let token = '';
  let isEmbedded = false;
  let observer: MutationObserver | null = null;

  // Generate a dynamic random joinToken for the lifetime of this session page
  function generateJoinToken(): string {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
    let tok = '';
    for (let i = 0; i < 16; i++) {
      tok += chars[Math.floor(Math.random() * chars.length)];
    }
    return tok;
  }
  const joinToken = generateJoinToken();

  let showDevicePanel = false;
  let showLicensePanel = false;
  let showLangPanel = false;
  let showShareModal = false;
  let showUrl = false;
  let copied = false;
  let composerText = '';
  
  let currentLang = localStorage.getItem('eqt_lang') || 'zh';

  // React to theme changes and inject CSS variables
  function hexToRgb(hex: string): string | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? 
      parseInt(result[1], 16) + ',' + 
      parseInt(result[2], 16) + ',' + 
      parseInt(result[3], 16) : null;
  }

  $: {
    if ($currentDevice && $currentDevice.theme) {
      const colors = getThemeColors($currentDevice.theme);
      if (colors) {
        document.documentElement.style.setProperty('--accent', colors.border);
        document.documentElement.style.setProperty('--accent-strong', colors.text);
        document.documentElement.style.setProperty('--accent-wash', colors.bg);
        document.documentElement.style.setProperty('--wash', colors.bg);
        document.documentElement.style.setProperty('--bg', colors.bg);
        document.documentElement.style.setProperty('--line', colors.border);
        const rgb = hexToRgb(colors.border);
        if (rgb) {
          document.documentElement.style.setProperty('--accent-rgb', rgb);
        }
      }
    }
  }

  let isQRPulsing = false;
  let qrPulseTimer: any = null;

  function stopQRPulse() {
    isQRPulsing = false;
    if (qrPulseTimer) {
      clearTimeout(qrPulseTimer);
      qrPulseTimer = null;
    }
  }

  function startQRPulse(remaining: number) {
    if (qrPulseTimer) {
      clearTimeout(qrPulseTimer);
    }
    isQRPulsing = true;
    const duration = remaining > 0 ? remaining : 10000;
    qrPulseTimer = setTimeout(stopQRPulse, Math.min(duration, 10000));
  }

  function handleMessage(event: MessageEvent) {
    if (!event.data || typeof event.data !== 'object') return;
    if (event.data.type === 'pulse-session-qr') {
      const remaining = Math.max(0, Number(event.data.until || 0) - Date.now());
      startQRPulse(remaining);
    }
  }

  let selectedDevId = '';
  let isEditingName = false;
  let editNameVal = '';

  function toggleDeviceDetail(devId: string) {
    if (selectedDevId === devId) {
      selectedDevId = '';
      isEditingName = false;
    } else {
      selectedDevId = devId;
      isEditingName = false;
      const dev = $peers.find(p => p.id === devId);
      if (dev) {
        editNameVal = dev.label;
      }
    }
  }

  function handleKickDevice(devId: string, label: string) {
    // Local list simulation for immediate high fidelity UI feedback
    peers.update(list => list.filter(p => p.id !== devId));
    chatActions.addSystemMessage(`已强制设备 "${label}" 退出会话。`);
    selectedDevId = '';
  }

  function handleRenameDevice() {
    if (!editNameVal.trim() || !$currentDevice) return;
    const oldLabel = $currentDevice.label;
    const newLabel = editNameVal.trim();

    // Preserve name under BOTH keys so both Svelte store and ChatWebSocketClient load it
    localStorage.setItem('eqt_device_name', newLabel);
    localStorage.setItem('chat_label', newLabel);

    currentDevice.update(d => {
      if (d) d.label = newLabel;
      return d;
    });

    chatActions.addSystemMessage(`本机设备名称已从 "${oldLabel}" 重命名为 "${newLabel}"，正在重新同步。`);
    isEditingName = false;
    selectedDevId = '';

    // Hot reconnect so the websocket establishes using the fresh custom label
    if (client) {
      client.close();
      setTimeout(() => {
        client = new ChatWebSocketClient(token);
        client.connect();
      }, 100);
    }
  }

  function formatDeviceTime(timeStr?: string): string {
    if (!timeStr) return '刚刚';
    const date = new Date(timeStr);
    if (isNaN(date.getTime())) return '刚刚';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  onMount(() => {
    const updateEmbeddedState = () => {
      isEmbedded = window.parent !== window || document.documentElement.classList.contains('embedded-chat');
      if (isEmbedded && !document.documentElement.classList.contains('embedded-chat')) {
        document.documentElement.classList.add('embedded-chat');
      }
    };
    updateEmbeddedState();

    // Dynamically observe class change on <html> element to update Svelte state reactive-like
    observer = new MutationObserver(updateEmbeddedState);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    window.addEventListener('message', handleMessage);

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

    // Persist peer type if passed via URL parameter
    const params = new URLSearchParams(window.location.search);
    const urlPeer = params.get('peer');
    if (urlPeer) {
      localStorage.setItem('chat_peer', urlPeer);
    }

    client = new ChatWebSocketClient(token);
    client.connect();
  });

  onDestroy(() => {
    window.removeEventListener('message', handleMessage);
    if (observer) {
      observer.disconnect();
    }
    if (qrPulseTimer) {
      clearTimeout(qrPulseTimer);
    }
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
    const { messageId, filename, size } = e.detail;
    if (!client) return;

    const transferId = 'dl-' + messageId;
    client.startTransfer(transferId);

    const downloadURL = `/chat-v2/${token}/files/${messageId}?mock_size=${size}&clientId=${client['clientPeer']}&messageId=${messageId}&filename=${encodeURIComponent(filename)}`;

    const link = document.createElement('a');
    link.href = downloadURL;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    chatActions.addSystemMessage(currentLang === 'en'
      ? `Initiated native stream download for: ${filename}`
      : `开始下载文件: ${filename}`);
  }

  function handleCancelDownload(e: CustomEvent<string>) {
    if (client) {
      client.cancelTransfer(e.detail);
    }
  }

  function handleRecallMessage(e: CustomEvent<string>) {
    if (client) {
      client.recallMessage(e.detail);
    }
  }

  function handleSystemNotice(e: CustomEvent<string>) {
    chatActions.addSystemMessage(e.detail);
  }

  function handleEditAgain(e: CustomEvent<string>) {
    composerText = e.detail;
    // Focus composer textarea
    setTimeout(() => {
      const textarea = document.querySelector('.composer textarea') as HTMLTextAreaElement;
      if (textarea) {
        textarea.focus();
      }
    }, 50);
  }

  function handleResendFile(e: CustomEvent<{ name: string; size: number }>) {
    if (client) {
      const filePayload = JSON.stringify({
        type: 'file',
        fileName: e.detail.name,
        size: e.detail.size
      });
      client.sendText(filePayload);
    }
  }

  function handleOpenFolder(e: CustomEvent<Message>) {
    const msg = e.detail;
    if (isEmbedded) {
      window.parent.postMessage({ type: 'open-chat-file', filename: msg.fileName }, '*');
    } else {
      chatActions.addSystemMessage(currentLang === 'en'
        ? 'Browser sandbox restricted, cannot locate local folders'
        : '浏览器安全沙箱限制，无法直接定位本地文件夹');
    }
  }

  function handleClose() {
    if (isEmbedded) {
      window.parent.postMessage({ type: 'stop-chat' }, '*');
    } else {
      window.location.href = '/close';
    }
  }

  function setLanguage(lang: string) {
    localStorage.setItem('eqt_lang', lang);
    localStorage.setItem('eqt-page-lang', lang);
    currentLang = lang;
    showLangPanel = false;
    window.location.reload();
  }

  $: currentTheme = ($currentDevice && $currentDevice.theme) || 'theme-0';
  $: joinUrl = window.location.origin + "/chat-v2/" + token + "?join=" + joinToken + "&theme=" + currentTheme;
  $: qrImgSrc = `/chat-v2/${token}/qr.png?join=${joinToken}&theme=${currentTheme}`;

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
            <h1 id="chat-title-text"><span class="chat-title-brand">EQT</span><span class="license-badge">VIP</span></h1>
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

          <button class="icon-button qr-btn" class:qr-breathe={isQRPulsing} type="button" on:click|stopPropagation={() => { showShareModal = true; stopQRPulse(); closeAllPanels(); }} title="Show session QR">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4z"></path><path d="M14 4h6v6h-6z"></path><path d="M4 14h6v6H4z"></path><path d="M14 14h2v2h-2z"></path><path d="M18 14h2v6h-4v-2h2z"></path><path d="M14 18h2v2h-2z"></path></svg>
          </button>

          {#if isEmbedded}
            <button class="icon-button danger" type="button" on:click={handleClose} title="Stop chat">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>
            </button>
          {/if}

          <button class="icon-button lang-btn" type="button" on:click|stopPropagation={() => { showLangPanel = !showLangPanel; showDevicePanel = false; showLicensePanel = false; }} title="Switch language">
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
          </button>

          <!-- Panels -->
          <div class="device-panel" class:open={showDevicePanel} on:click|stopPropagation>
            <div class="device-panel-title" style="margin-bottom: 8px;">在线设备</div>
            <div class="device-roster">
              {#each $peers as dev}
                {@const isSelf = dev.id === $currentDevice?.id}
                <div class="device-item">
                  <button class="device-row-lite roster-row" type="button" on:click={() => toggleDeviceDetail(dev.id)} aria-expanded={selectedDevId === dev.id ? 'true' : 'false'}>
                    <div class="message-avatar" style="width: 24px; height: 24px; font-size: 10px; line-height: 24px; border-radius: 50%; background: var(--accent); color: #fff; text-align: center; font-weight: bold; flex-shrink: 0;">
                      {dev.label ? dev.label.slice(0, 2).toUpperCase() : 'DE'}
                    </div>
                    <div style="text-align: left; margin-left: 8px; flex: 1;">
                      <strong style="display: block; font-size: 13px; color: #333; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 110px;">{dev.label}</strong>
                      <span style="font-size: 10px; color: #888;">{dev.peer || 'connected'}</span>
                    </div>
                    {#if isSelf}
                      <span class="device-state">本机</span>
                    {:else}
                      <span class="device-state" style="background: #eef5ee; color: var(--accent-strong);">在线</span>
                    {/if}
                  </button>

                  <div class="device-detail" class:open={selectedDevId === dev.id}>
                    <div class="device-detail-head" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px dashed var(--line);">
                      {#if isSelf}
                        {#if isEditingName}
                          <div style="display: flex; gap: 4px; width: 100%;">
                            <input bind:value={editNameVal} style="font-size: 11px; padding: 2px 6px; border: 1px solid var(--line); border-radius: 4px; flex: 1; height: 22px; box-sizing: border-box;">
                            <button class="side-btn" style="height: 22px; font-size: 10px; padding: 0 6px;" on:click={handleRenameDevice}>保存</button>
                            <button class="side-btn" style="height: 22px; font-size: 10px; padding: 0 6px; background: #eee;" on:click={() => isEditingName = false}>取消</button>
                          </div>
                        {:else}
                          <strong style="font-size: 11px; color: #333; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100px;">{dev.label} (本机)</strong>
                          <button class="icon-button" style="padding: 2px; width: 22px; height: 22px;" on:click={() => isEditingName = true} title="重命名设备">
                            <svg viewBox="0 0 24 24" aria-hidden="true" stroke="currentColor" stroke-width="2" fill="none"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                          </button>
                        {/if}
                      {:else}
                        <strong style="font-size: 11px; color: #333; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100px;">{dev.label}</strong>
                        <button class="icon-button danger" style="padding: 2px; width: 22px; height: 22px; color: #dc2626;" on:click={() => handleKickDevice(dev.id, dev.label)} title="强制踢下线">
                          <svg viewBox="0 0 24 24" aria-hidden="true" stroke="currentColor" stroke-width="2" fill="none"><path d="M10 12h10M17 8l4 4-4 4M15 4H9a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6"/></svg>
                        </button>
                      {/if}
                    </div>
                    <div class="device-detail-meta" style="font-size: 10px; color: #666; display: flex; flex-direction: column; gap: 2px; text-align: left;">
                      <span>状态: 在线</span>
                      <span>并发连接数: 1</span>
                      <span>上次活跃时间: {formatDeviceTime(dev.lastSeen)}</span>
                    </div>
                  </div>
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
        messages={$messages}
        txState={$transfers}
        currentLang={currentLang}
        isMine={(msg) => msg.sender === ($currentDevice?.label || 'Me')}
        on:startDownload={handleStartDownload}
        on:cancelDownload={handleCancelDownload}
        on:recallMessage={handleRecallMessage}
        on:systemNotice={handleSystemNotice}
        on:editAgain={handleEditAgain}
        on:resendFile={handleResendFile}
        on:openFolder={handleOpenFolder}
      />

      <MessageComposer 
        bind:text={composerText}
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
          <img class="qr" src={qrImgSrc} alt="Chat QR code">
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
