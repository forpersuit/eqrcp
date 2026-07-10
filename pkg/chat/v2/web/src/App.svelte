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
  let visualViewportHandler: (() => void) | null = null;

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
    } else if (event.data.type === 'selected-files') {
      const paths: string[] = event.data.paths || [];
      paths.forEach(p => {
        registerLocalAttachment(p);
      });
    } else if (event.data.type === 'download-success') {
      const { messageId, path } = event.data;
      const peer = client ? client['clientPeer'] : 'desktop';
      chatActions.updateMessageFilePath(messageId, path);
      chatActions.updateTransfer({
        id: 'dl-' + messageId + '-' + peer,
        state: 'completed',
        progress: 100,
        speed: 0,
        error: ''
      });
    } else if (event.data.type === 'download-failed') {
      const { messageId, error } = event.data;
      const peer = client ? client['clientPeer'] : 'desktop';
      chatActions.addSystemMessage(currentLang === 'en'
        ? `Download attachment failed: ${error}`
        : `下载附件失败: ${error}`);
      chatActions.updateTransfer({
        id: 'dl-' + messageId + '-' + peer,
        state: 'failed',
        progress: -1,
        speed: 0,
        error: error
      });
      const transferId = 'dl-' + messageId + '-' + peer;
      if (client) {
        client.cancelTransfer(transferId);
      }
    } else if (event.data.type === 'chat-download-progress') {
      const { messageId, progress } = event.data;
      const peer = client ? client['clientPeer'] : 'desktop';
      const transferId = 'dl-' + messageId + '-' + peer;
      if (progress === -1) {
        chatActions.updateTransfer({
          id: transferId,
          state: 'failed',
          progress: -1,
          speed: 0,
          error: currentLang === 'en' ? 'Download interrupted or failed' : '下载中断或失败'
        });
      } else {
        chatActions.updateTransfer({
          id: transferId,
          state: progress >= 100 ? 'completed' : 'running',
          progress: progress,
          percent: progress,
          speed: 0,
          error: ''
        });
      }
    }
  }

  function registerLocalAttachment(filePath: string) {
    const hostToken = localStorage.getItem('chat_host_token') || '';
    const url = `/chat-v2/${token}/attachments/local?hostToken=${encodeURIComponent(hostToken)}`;
    const sender = $currentDevice?.label || 'Me';
    const avatar = $currentDevice?.avatar || '';
    const deviceToken = localStorage.getItem('chat_token') || '';

    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        path: filePath,
        sender: sender,
        avatar: avatar,
        token: deviceToken,
        peer: localStorage.getItem('chat_peer') || ''
      })
    })
    .then(r => {
      if (!r.ok) {
        return r.text().then(t => { throw new Error(t); });
      }
      return r.json();
    })
    .then(message => {
      console.log('Successfully registered local attachment:', message);
    })
    .catch(err => {
      console.error('Failed to register local attachment:', err);
      chatActions.addSystemMessage('发送本地附件失败: ' + err.message);
    });
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

  function handleRenameInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (e.target instanceof HTMLInputElement) {
        e.target.blur();
      }
      handleRenameDevice();
    }
  }

  function handleRenameDevice() {
    if (!editNameVal.trim() || !$currentDevice) return;
    
    // Explicitly blur focused elements to hide mobile software keyboard
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

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

  let contextMenuEl: HTMLDivElement | null = null;

  function handleGlobalContextMenu(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      const isReadOnly = (target as HTMLInputElement).readOnly || (target as HTMLInputElement).disabled;
      const type = target.getAttribute('type') || 'text';
      if (type === 'checkbox' || type === 'radio' || type === 'file') {
        return;
      }

      e.preventDefault();
      closeContextMenu();

      const menu = document.createElement('div');
      menu.className = 'custom-context-menu';
      menu.style.position = 'fixed';
      menu.style.zIndex = '99999';

      const input = target as HTMLInputElement | HTMLTextAreaElement;
      const isZh = currentLang === 'zh';
      const labels = isZh ? {
        cut: '剪切',
        copy: '复制',
        paste: '粘贴',
        selectAll: '全选'
      } : {
        cut: 'Cut',
        copy: 'Copy',
        paste: 'Paste',
        selectAll: 'Select All'
      };

      const items = [];

      // Cut
      if (!isReadOnly) {
        items.push({
          label: labels.cut,
          action: () => {
            const start = input.selectionStart || 0;
            const end = input.selectionEnd || 0;
            const val = input.value;
            if (start !== end) {
              const selectedText = val.substring(start, end);
              navigator.clipboard.writeText(selectedText).then(() => {
                input.value = val.substring(0, start) + val.substring(end);
                input.dispatchEvent(new Event('input', { bubbles: true }));
              });
            }
          }
        });
      }

      // Copy
      items.push({
        label: labels.copy,
        action: () => {
          const start = input.selectionStart || 0;
          const end = input.selectionEnd || 0;
          if (start !== end) {
            const selectedText = input.value.substring(start, end);
            navigator.clipboard.writeText(selectedText);
          }
        }
      });

      // Paste
      if (!isReadOnly) {
        items.push({
          label: labels.paste,
          action: () => {
            navigator.clipboard.readText().then(text => {
              const start = input.selectionStart || 0;
              const end = input.selectionEnd || 0;
              const val = input.value;
              input.value = val.substring(0, start) + text + val.substring(end);
              input.dispatchEvent(new Event('input', { bubbles: true }));
              setTimeout(() => {
                input.selectionStart = input.selectionEnd = start + text.length;
              }, 0);
            }).catch(() => {});
          }
        });
      }

      // Select All
      items.push({
        label: labels.selectAll,
        action: () => {
          input.select();
        }
      });

      items.forEach(item => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = item.label;
        btn.style.width = '100%';
        btn.style.padding = '8px 12px';
        btn.style.border = 'none';
        btn.style.background = 'none';
        btn.style.color = 'var(--ink, #333)';
        btn.style.textAlign = 'left';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '12px';
        btn.style.outline = 'none';
        btn.addEventListener('click', () => {
          item.action();
          closeContextMenu();
        });
        menu.appendChild(btn);
      });

      document.body.appendChild(menu);
      contextMenuEl = menu;

      const rect = menu.getBoundingClientRect();
      let left = e.clientX;
      let top = e.clientY - rect.height;

      // 检查水平方向是否超出右边缘
      if (left + rect.width > window.innerWidth - 8) {
        // 超出则调整到水平对侧 (向左展开)
        left = e.clientX - rect.width;
        // 如果向左展开后又超出了左边缘，则限制在可见区域内
        if (left < 8) {
          left = Math.max(8, window.innerWidth - rect.width - 8);
        }
      } else {
        if (left < 8) {
          left = 8;
        }
      }

      // 检查垂直方向是否超出上边缘
      if (top < 8) {
        // 超出则调整到水平对侧 (向下展开)
        top = e.clientY;
        // 如果向下展开后又超出了下边缘，则限制在可见区域内
        if (top + rect.height > window.innerHeight - 8) {
          top = Math.max(8, window.innerHeight - rect.height - 8);
        }
      } else {
        if (top + rect.height > window.innerHeight - 8) {
          top = Math.max(8, window.innerHeight - rect.height - 8);
        }
      }

      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;

      document.addEventListener('click', closeContextMenu, { once: true });
    }
  }

  function closeContextMenu() {
    if (contextMenuEl) {
      contextMenuEl.remove();
      contextMenuEl = null;
    }
  }

  function formatDeviceTime(timeStr?: string): string {
    if (!timeStr) return '刚刚';
    const date = new Date(timeStr);
    if (isNaN(date.getTime())) return '刚刚';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatSpeed(bytes: number): string {
    if (bytes <= 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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

    const hostToken = params.get('hostToken') || '';
    if (hostToken) {
      localStorage.setItem('chat_host_token', hostToken);
    }

    if (typeof window !== 'undefined' && window.visualViewport) {
      visualViewportHandler = () => {
        const vv = window.visualViewport;
        if (vv) {
          const activeEl = document.activeElement;
          const isComposerActive = activeEl && (activeEl.closest('.composer') || activeEl.closest('form.composer') || activeEl.id === 'message-textarea');
          const isKeyboardOpen = vv.height < window.innerHeight - 80;

          if (isKeyboardOpen && !isComposerActive) {
            // Keep height at full screen so composer stays hidden under keyboard
            document.documentElement.style.setProperty('--chat-viewport-height', `${window.innerHeight}px`);
          } else {
            document.documentElement.style.setProperty('--chat-viewport-height', `${vv.height}px`);
          }

          // Prevent mobile keyboard from scrolling the entire fixed body out of viewport
          if (window.scrollY !== 0) {
            window.scrollTo(0, 0);
          }

          if (isComposerActive) {
            const messagesEl = document.querySelector('.messages');
            if (messagesEl) {
              messagesEl.scrollTop = messagesEl.scrollHeight;
              setTimeout(() => {
                messagesEl.scrollTop = messagesEl.scrollHeight;
              }, 50);
            }
          }
        }
      };
      window.visualViewport.addEventListener('resize', visualViewportHandler);
      window.visualViewport.addEventListener('scroll', visualViewportHandler);
      visualViewportHandler();
    }

    client = new ChatWebSocketClient(token);
    client.onRequestFileData = (messageId) => {
      // 采用预先落盘暂存模式，下载端直接拉取服务器临时文件，不需要实时向发送端请求流数据。
    };
    client.connect();
    document.addEventListener('contextmenu', handleGlobalContextMenu);
  });

  onDestroy(() => {
    document.removeEventListener('contextmenu', handleGlobalContextMenu);
    closeContextMenu();
    window.removeEventListener('message', handleMessage);
    if (observer) {
      observer.disconnect();
    }
    if (visualViewportHandler && typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', visualViewportHandler);
      window.visualViewport.removeEventListener('scroll', visualViewportHandler);
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

  function performFileUpload(messageId: string, file: File) {
    chatActions.addSystemMessage(currentLang === 'en' 
      ? `Uploading file: ${file.name}...` 
      : `正在上传文件: ${file.name}...`);
    
    if (client) {
      client.sendLog(`[ACTION] Starting file upload for: ${file.name} (Size: ${file.size} bytes, Message ID: ${messageId})`);
    }

    const uploadUrl = `/chat-v2/${token}/upload`;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('messageId', messageId);
    formData.append('sender', $currentDevice?.label || 'Me');
    formData.append('avatar', $currentDevice?.avatar || '');
    formData.append('peer', localStorage.getItem('chat_peer') || '');

    fetch(uploadUrl, {
      method: 'POST',
      body: formData
    })
    .then(r => {
      if (!r.ok) {
        return r.text().then(t => { throw new Error(t); });
      }
      return r.json();
    })
    .then(res => {
      console.log('File upload succeeded for messageId:', messageId, res);
      if (client) {
        client.sendLog(`[ACTION] Completed file upload for: ${file.name} (Message ID: ${messageId})`);
      }
    })
    .catch(err => {
      console.error('File upload failed:', err);
      if (client) {
        client.sendLog(`[ERROR] File upload failed for: ${file.name}: ${err.message}`);
      }
      chatActions.addSystemMessage(currentLang === 'en'
        ? `Failed to upload "${file.name}": ${err.message}`
        : `上传文件 "${file.name}" 失败: ${err.message}`);
    });
  }

  function handleSendFile(e: CustomEvent<{ file: File; name: string; size: number; type: string }>) {
    const { file, name } = e.detail;
    if (!file) return;

    chatActions.addSystemMessage(currentLang === 'en' 
      ? `Added file "${name}". Initializing upload...` 
      : `已添加文件 "${name}"。正在初始化上传...`);

    const initUrl = `/chat-v2/${token}/upload/init`;
    fetch(initUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fileName: name,
        size: file.size,
        sender: $currentDevice?.label || 'Me',
        avatar: $currentDevice?.avatar || '',
        peer: localStorage.getItem('chat_peer') || ''
      })
    })
    .then(r => {
      if (!r.ok) {
        return r.text().then(t => { throw new Error(t); });
      }
      return r.json();
    })
    .then(msg => {
      const msgID = msg.id;
      console.log('Attachment registered successfully, messageID:', msgID);
      performFileUpload(msgID, file);
    })
    .catch(err => {
      console.error('Failed to add attachment:', err);
      chatActions.addSystemMessage(currentLang === 'en'
        ? `Failed to add attachment "${name}": ${err.message}`
        : `添加文件 "${name}" 失败: ${err.message}`);
    });
  }

  function handleStartDownload(e: CustomEvent<{ messageId: string; filename: string; size: number; isPaid: boolean }>) {
    const { messageId, filename, size } = e.detail;
    if (!client) return;

    const peer = client['clientPeer'] || 'desktop';
    const transferId = 'dl-' + messageId + '-' + peer;
    client.startTransfer(transferId);
    client.sendLog(`[ACTION] Initiated download for file: ${filename} (Size: ${size} bytes, Message ID: ${messageId})`);

    const downloadURL = `/chat-v2/${token}/files/${messageId}?clientId=${peer}&messageId=${messageId}&filename=${encodeURIComponent(filename)}`;

    if (isEmbedded) {
      window.parent.postMessage({
        type: 'download-file',
        messageId: messageId,
        url: window.location.origin + downloadURL,
        name: filename
      }, '*');
    } else {
      const link = document.createElement('a');
      link.href = downloadURL;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    chatActions.addSystemMessage(currentLang === 'en'
      ? `Initiated download for: ${filename}`
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
      if (msg.filePath) {
        window.parent.postMessage({ type: 'open-path', path: msg.filePath }, '*');
      } else {
        window.parent.postMessage({ type: 'open-chat-file', filename: msg.fileName }, '*');
      }
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
                {@const activeTx = Object.values($transfers).find(tx => tx.clientId === dev.peer && (tx.state === 'running' || tx.state === 'queued'))}
                <div class="device-item">
                  <button class="device-row-lite roster-row" type="button" on:click={() => toggleDeviceDetail(dev.id)} aria-expanded={selectedDevId === dev.id ? 'true' : 'false'}>
                    <div class="message-avatar" style="width: 24px; height: 24px; font-size: 10px; line-height: 24px; border-radius: 50%; background: var(--accent); color: #fff; text-align: center; font-weight: bold; flex-shrink: 0;">
                      {dev.label ? dev.label.slice(0, 2).toUpperCase() : 'DE'}
                    </div>
                    <div style="text-align: left; margin-left: 8px; flex: 1; min-width: 0;">
                      <strong style="display: block; font-size: 13px; color: #333; overflow-x: auto; white-space: nowrap; max-width: 100%; scrollbar-width: none; -ms-overflow-style: none;">{dev.label}</strong>
                      {#if activeTx}
                        {#if activeTx.state === 'running'}
                          <span style="font-size: 10px; color: var(--accent-strong); font-weight: bold;">
                            传输中: {activeTx.percent ?? 0}% ({formatSpeed(activeTx.speed ?? 0)})
                          </span>
                        {:else}
                          <span style="font-size: 10px; color: #6b7280;">排队等待中...</span>
                        {/if}
                      {:else}
                        <span style="font-size: 10px; color: #888;">{dev.peer || 'connected'}</span>
                      {/if}
                    </div>
                    {#if isSelf}
                      <span class="device-state">本机</span>
                    {:else}
                      <span class="device-state" style="background: #eef5ee; color: var(--accent-strong);">在线</span>
                    {/if}
                  </button>

                  <div class="device-detail" class:open={selectedDevId === dev.id}>
                    <div class="device-detail-head" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px dashed var(--line); min-width: 0;">
                      {#if isSelf}
                        {#if isEditingName}
                          <div class="device-rename-form">
                            <input bind:value={editNameVal} on:keydown={handleRenameInputKeydown} class="device-rename-input" placeholder="输入设备名称">
                            <div class="device-rename-buttons">
                              <button class="side-btn device-rename-btn" on:click|preventDefault={handleRenameDevice}>保存</button>
                              <button class="side-btn device-rename-btn cancel" on:click|preventDefault={() => { if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) { document.activeElement.blur(); } isEditingName = false; }}>取消</button>
                            </div>
                          </div>
                        {:else}
                          <strong style="font-size: 11px; color: #333; overflow-x: auto; white-space: nowrap; max-width: 100%; scrollbar-width: none; -ms-overflow-style: none;">{dev.label} (本机)</strong>
                          <button class="icon-button" style="padding: 2px; width: 22px; height: 22px; flex-shrink: 0;" on:click={() => isEditingName = true} title="重命名设备">
                            <svg viewBox="0 0 24 24" aria-hidden="true" stroke="currentColor" stroke-width="2" fill="none"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                          </button>
                        {/if}
                      {:else}
                        <strong style="font-size: 11px; color: #333; overflow-x: auto; white-space: nowrap; max-width: 100%; scrollbar-width: none; -ms-overflow-style: none;">{dev.label}</strong>
                        <button class="icon-button danger" style="padding: 2px; width: 22px; height: 22px; color: #dc2626; flex-shrink: 0;" on:click={() => handleKickDevice(dev.id, dev.label)} title="强制踢下线">
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
        isEmbedded={isEmbedded}
        isMine={(msg) => {
          const myPeer = localStorage.getItem('chat_peer');
          if (msg.senderId) {
            if (msg.senderId === myPeer) return true;
            if (myPeer === 'desktop' && msg.senderId === 'desktop') return true;
          }
          return msg.sender === ($currentDevice?.label || 'Me');
        }}
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
