<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import MessageList from './components/MessageList.svelte';
  import MessageComposer from './components/MessageComposer.svelte';
  import { getTranslation } from './lib/i18n';
  import { ChatWebSocketClient } from './services/websocket';
  import { chatActions, currentDevice, peers, connState, messages, transfers, chatSessionStatus } from './state/chatStore';
  import { getThemeColors } from './services/types';
  import type { Message } from './services/types';

  if (typeof window !== 'undefined') {
    window.addEventListener('error', (e) => {
      const errorMsg = `[Chat Iframe JS Error] Message: ${e.message} | Source: ${e.filename} | Line: ${e.lineno} | Col: ${e.colno} | Error: ${e.error?.stack || e.error}`;
      console.error(errorMsg);
      try {
        window.parent.postMessage({
          type: 'iframe-log-error',
          message: errorMsg
        }, '*');
      } catch (err) {
        // Ignored
      }
    });

    window.addEventListener('unhandledrejection', (e) => {
      const errorMsg = `[Chat Iframe Promise Rejection] Reason: ${e.reason?.stack || e.reason}`;
      console.error(errorMsg);
      try {
        window.parent.postMessage({
          type: 'iframe-log-error',
          message: errorMsg
        }, '*');
      } catch (err) {
        // Ignored
      }
    });
  }

  let client: ChatWebSocketClient;
  let token = '';
  let isEmbedded = false;
  let observer: MutationObserver | null = null;
  let visualViewportHandler: (() => void) | null = null;
  let windowScrollHandler: (() => void) | null = null;
  let aggressiveScrollTimer: any = null;
  let handleGlobalFocusIn: ((e: FocusEvent) => void) | null = null;
  const activeUploads = new Map<string, XMLHttpRequest>();

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
  let showLeaveConfirm = false;
  let showUrl = false;
  let composerText = '';
  let licenseTier = 'FREE';
  let isPaid = false;
  let usedSeconds = 0;
  let dailySeconds = 300;
  let remainingSeconds = 300;
  let freeDegraded = false;
  let quotaPollTimer: ReturnType<typeof setInterval> | null = null;
  let copied = false;
  
  let rawLang = localStorage.getItem('eqt_lang') || '';
  if (!rawLang) {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      rawLang = params.get('lang') || navigator.language || 'zh';
    } else {
      rawLang = 'zh';
    }
  }
  let currentLang = rawLang.toLowerCase().split('-')[0];

  let isMobileLayout = false;
  function checkScreenSize() {
    isMobileLayout = typeof window !== 'undefined' && window.innerWidth <= 820;
  }

  $: t = {
    viewSubscription: getTranslation('viewSubscription', currentLang),
    freeQuotaHint: getTranslation('freeQuotaHint', currentLang),
    freeQuotaDaily: getTranslation('freeQuotaDaily', currentLang),
    freeQuotaUsed: getTranslation('freeQuotaUsed', currentLang),
    freeQuotaAttachmentPolicy: getTranslation('freeQuotaAttachmentPolicy', currentLang),
    freeQuotaUpgrade: getTranslation('freeQuotaUpgrade', currentLang),
    freeQuotaDegraded: getTranslation('freeQuotaDegraded', currentLang),
    onlineDevices: getTranslation('onlineDevices', currentLang),
    self: getTranslation('self', currentLang),
    online: getTranslation('online', currentLang),
    inputDeviceName: getTranslation('inputDeviceName', currentLang),
    save: getTranslation('save', currentLang),
    cancel: getTranslation('cancel', currentLang),
    renameDevice: getTranslation('renameDevice', currentLang),
    kickOffline: getTranslation('kickOffline', currentLang),
    noOtherDevices: getTranslation('noOtherDevices', currentLang),
    subscriptionDetails: getTranslation('subscriptionDetails', currentLang),
    vipLifetime: getTranslation('vipLifetime', currentLang),
    authStatus: getTranslation('authStatus', currentLang),
    validLifetime: getTranslation('validLifetime', currentLang),
    speedLimit: getTranslation('speedLimit', currentLang),
    unlimitedSpeed: getTranslation('unlimitedSpeed', currentLang),
    fingerprintCheck: getTranslation('fingerprintCheck', currentLang),
    passed: getTranslation('passed', currentLang),
    selectLanguage: getTranslation('selectLanguage', currentLang),
    sessionQR: getTranslation('sessionQR', currentLang),
    scanQR: getTranslation('scanQR', currentLang),
    copied: getTranslation('copied', currentLang),
    copy: getTranslation('copy', currentLang),
    hideLink: getTranslation('hideLink', currentLang),
    showLink: getTranslation('showLink', currentLang)
  };

  function formatQuotaClock(totalSec: number): string {
    const s = Math.max(0, Math.floor(totalSec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  function applyQuotaInfo(data: any) {
    if (!data || typeof data !== 'object') return;
    if (data.licenseTier) {
      licenseTier = data.licenseTier;
    }
    if (typeof data.isPaid === 'boolean') {
      isPaid = data.isPaid;
    } else if (data.licenseTier && data.licenseTier !== 'FREE') {
      isPaid = true;
    }
    if (typeof data.usedSeconds === 'number') {
      usedSeconds = Math.max(0, data.usedSeconds);
    }
    if (typeof data.dailySeconds === 'number' && data.dailySeconds > 0) {
      dailySeconds = data.dailySeconds;
    }
    if (typeof data.remainingSeconds === 'number') {
      remainingSeconds = Math.max(0, data.remainingSeconds);
    } else {
      remainingSeconds = Math.max(0, dailySeconds - usedSeconds);
    }
    if (typeof data.freeDegraded === 'boolean') {
      freeDegraded = data.freeDegraded;
    } else {
      freeDegraded = !isPaid && remainingSeconds <= 0;
    }
  }

  async function refreshQuotaInfo() {
    if (!token) return;
    try {
      const res = await fetch(`/chat-v2/${token}/info`);
      if (!res.ok) return;
      const data = await res.json();
      applyQuotaInfo(data);
    } catch (err) {
      console.error('Failed to fetch chat v2 info:', err);
    }
  }

  $: quotaPillLabel = freeDegraded
    ? t.freeQuotaDegraded
    : getTranslation('freeQuotaRemaining', currentLang).replace('{time}', formatQuotaClock(remainingSeconds));
  $: quotaPillUrgent = !isPaid && !freeDegraded && remainingSeconds > 0 && remainingSeconds <= 60;
  $: showQuotaPill = !isPaid;

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
    if (event.data.type === 'update-lang') {
      const { lang } = event.data;
      if (lang) {
        setLanguage(lang);
      }
    } else if (event.data.type === 'update-identity') {
      const { name, avatar } = event.data;
      let updated = false;
      if (name && name !== localStorage.getItem('chat_label')) {
        localStorage.setItem('chat_label', name);
        localStorage.setItem('eqt_device_name', name);
        updated = true;
      }
      if (avatar !== undefined && avatar !== localStorage.getItem('chat_avatar')) {
        localStorage.setItem('chat_avatar', avatar);
        updated = true;
      }
      if (updated) {
        if (name) {
          if (client) client.clientLabel = name;
        }
        if (avatar !== undefined) {
          if (client) client.clientAvatar = avatar;
        }
        if ($currentDevice) {
          currentDevice.update(d => {
            if (d) {
              if (name) d.label = name;
              if (avatar !== undefined) d.avatar = avatar;
            }
            return d;
          });
        }
        if (client) {
          client.updateClient(localStorage.getItem('chat_label') || '', localStorage.getItem('chat_avatar') || '');
        }
      }
    } else if (event.data.type === 'pulse-session-qr') {
      const remaining = Math.max(0, Number(event.data.until || 0) - Date.now());
      startQRPulse(remaining);
    } else if (event.data.type === 'chat-debug-notice') {
      chatActions.addSystemMessage(event.data.message);
    } else if (event.data.type === 'selected-files') {
      const paths: string[] = event.data.paths || [];
      chatActions.addSystemMessage(currentLang === 'en'
        ? `[App] Received selected-files message: ${JSON.stringify(paths)}`
        : `[App] 收到 selected-files 文件消息: ${JSON.stringify(paths)}`);
      logToGui(`handleMessage type selected-files paths: ${JSON.stringify(paths)}`);
      paths.forEach(p => {
        registerLocalAttachment(p);
      });
    } else if (event.data.type === 'download-success') {
      const { messageId, path } = event.data;
      const peer = client ? client['clientPeer'] : 'desktop';
      if (client) {
        client.sendLog(`[ACTION] Completed download for Message ID: ${messageId}, Path: ${path}`);
      }
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
      if (client) {
        client.sendLog(`[ERROR] Download failed for Message ID: ${messageId}, Error: ${error}`);
      }
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

  function logToGui(message: string, isError = false) {
    if (typeof window !== 'undefined') {
      window.parent.postMessage({
        type: isError ? 'iframe-log-error' : 'iframe-log-info',
        message: `[Chat Iframe] ${message}`
      }, '*');
    }
  }

  function registerLocalAttachment(filePath: string) {
    chatActions.addSystemMessage(currentLang === 'en'
      ? `[App] Started registering attachment: ${filePath}`
      : `[App] 开始注册附件: ${filePath}`);
    logToGui(`registerLocalAttachment called with: ${filePath}`);
    const hostToken = localStorage.getItem('chat_host_token') || '';
    const url = `/chat-v2/${token}/attachments/local?hostToken=${encodeURIComponent(hostToken)}`;
    const sender = $currentDevice?.label || 'Me';
    const avatar = $currentDevice?.avatar || '';
    const deviceToken = localStorage.getItem('chat_token') || '';

    logToGui(`registerLocalAttachment sending POST to: ${url}`);
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
      chatActions.addSystemMessage(currentLang === 'en'
        ? `[App] Registration success: ${message.fileName}`
        : `[App] 注册成功: ${message.fileName}`);
      logToGui(`Successfully registered local attachment response: ${JSON.stringify(message)}`);
    })
    .catch(err => {
      chatActions.addSystemMessage(currentLang === 'en'
        ? `[App] Registration failed: ${err.message}`
        : `[App] 注册失败: ${err.message}`);
      logToGui(`Failed to register local attachment: ${err.message}`, true);
    });
  }

  let selectedDevId = '';
  let isEditingName = false;
  let editNameVal = '';

  function getDeviceColor(theme?: string): string {
    const colors = getThemeColors(theme);
    return colors ? colors.border : '#333333';
  }

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
    if (client) {
      client.kickClient(devId);
    }
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

    isEditingName = false;
    selectedDevId = '';

    if (isEmbedded) {
      window.parent.postMessage({ type: 'rename-chat-sender', name: newLabel }, '*');
    }

    // Sync label directly to the backend over WebSocket
    if (client) {
      client.updateClient(newLabel, localStorage.getItem('chat_avatar') || '');
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
    if (!timeStr) return currentLang === 'en' ? 'just now' : '刚刚';
    const date = new Date(timeStr);
    if (isNaN(date.getTime())) return currentLang === 'en' ? 'just now' : '刚刚';
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
    chatActions.setSessionStatus('active');
    checkScreenSize();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', checkScreenSize);
    }
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

    // Persist peer type if passed via URL parameter (only for desktop to avoid multi-tab collisions)
    const params = new URLSearchParams(window.location.search);
    const urlLang = params.get('lang');
    if (urlLang) {
      setLanguage(urlLang);
    }
    const urlPeer = params.get('peer');
    if (urlPeer === 'desktop') {
      localStorage.setItem('chat_peer', urlPeer);
    }

    const hostToken = params.get('hostToken') || '';
    if (hostToken) {
      localStorage.setItem('chat_host_token', hostToken);
    }

    const runAggressiveScrollCorrection = () => {
      let count = 0;
      if (aggressiveScrollTimer) clearInterval(aggressiveScrollTimer);
      aggressiveScrollTimer = setInterval(() => {
        if (window.scrollY !== 0) {
          window.scrollTo(0, 0);
        }
        count++;
        if (count > 12) {
          clearInterval(aggressiveScrollTimer);
          aggressiveScrollTimer = null;
        }
      }, 50);
    };

    handleGlobalFocusIn = (e: FocusEvent) => {
      const activeEl = e.target as HTMLElement;
      if (activeEl && (activeEl.closest('.composer') || activeEl.closest('form.composer') || activeEl.id === 'message-textarea')) {
        runAggressiveScrollCorrection();
      }
    };
    document.addEventListener('focusin', handleGlobalFocusIn);

    if (typeof window !== 'undefined') {
      windowScrollHandler = () => {
        if (window.scrollY !== 0) {
          window.scrollTo(0, 0);
        }
      };
      window.addEventListener('scroll', windowScrollHandler);
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

    void refreshQuotaInfo();
    quotaPollTimer = setInterval(() => {
      void refreshQuotaInfo();
    }, 2000);

    client = new ChatWebSocketClient(token, joinToken);
    client.onRequestFileData = (messageId) => {
      // 采用预先落盘暂存模式，下载端直接拉取服务器临时文件，不需要实时向发送端请求流数据。
    };
    client.connect();
    document.addEventListener('contextmenu', handleGlobalContextMenu);
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', checkScreenSize);
    }
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
    if (windowScrollHandler && typeof window !== 'undefined') {
      window.removeEventListener('scroll', windowScrollHandler);
    }
    if (handleGlobalFocusIn) {
      document.removeEventListener('focusin', handleGlobalFocusIn);
    }
    if (aggressiveScrollTimer) {
      clearInterval(aggressiveScrollTimer);
    }
    if (qrPulseTimer) {
      clearTimeout(qrPulseTimer);
    }
    if (quotaPollTimer) {
      clearInterval(quotaPollTimer);
      quotaPollTimer = null;
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
    formData.append('sender', client?.clientLabel || $currentDevice?.label || 'Me');
    formData.append('avatar', $currentDevice?.avatar || '');
    formData.append('peer', client?.clientPeer || localStorage.getItem('chat_peer') || '');

    const xhr = new XMLHttpRequest();
    let isAborted = false;
    activeUploads.set('ul-' + messageId, xhr);
    xhr.open('POST', uploadUrl, true);

    // Track upload progress locally and update the transfers store
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        transfers.update(map => {
          map['ul-' + messageId] = {
            id: 'ul-' + messageId,
            messageId: messageId,
            clientId: localStorage.getItem('chat_peer') || '',
            fileName: file.name,
            bytesDone: e.loaded,
            bytesTotal: e.total,
            percent: percent,
            state: 'running'
          };
          return map;
        });
        if (client) {
          client.reportUploadProgress(messageId, e.loaded, e.total);
        }
      }
    };

    // Upload complete handler
    xhr.onload = () => {
      activeUploads.delete('ul-' + messageId);
      if (xhr.status >= 200 && xhr.status < 300) {
        console.log('File upload succeeded for messageId:', messageId);
        if (client) {
          client.sendLog(`[ACTION] Completed file upload for: ${file.name} (Message ID: ${messageId})`);
        }
        // Locally clear the transfer progress and mark uploading as complete to lift the mask
        transfers.update(map => {
          delete map['ul-' + messageId];
          return map;
        });
        chatActions.markMessageUploadComplete(messageId);
      } else {
        handleError(new Error(xhr.responseText || `Upload failed with status ${xhr.status}`));
      }
    };

    // Upload abort handler
    xhr.onabort = () => {
      isAborted = true;
      activeUploads.delete('ul-' + messageId);
      transfers.update(map => {
        map['ul-' + messageId] = {
          id: 'ul-' + messageId,
          messageId: messageId,
          clientId: localStorage.getItem('chat_peer') || '',
          fileName: file.name,
          bytesDone: 0,
          bytesTotal: file.size,
          percent: 0,
          state: 'cancelled',
          error: 'Upload cancelled by user'
        };
        return map;
      });
      chatActions.addSystemMessage(currentLang === 'en'
        ? `Upload cancelled for: ${file.name}`
        : `已取消上传文件: ${file.name}`);
    };

    // Upload error handler
    xhr.onerror = () => {
      activeUploads.delete('ul-' + messageId);
      handleError(new Error('Network error during upload'));
    };

    function handleError(err: Error) {
      if (isAborted) return;
      console.error('File upload failed:', err);
      if (client) {
        client.sendLog(`[ERROR] File upload failed for: ${file.name}: ${err.message}`);
      }
      transfers.update(map => {
        map['ul-' + messageId] = {
          id: 'ul-' + messageId,
          messageId: messageId,
          clientId: localStorage.getItem('chat_peer') || '',
          fileName: file.name,
          bytesDone: 0,
          bytesTotal: file.size,
          percent: -1,
          state: 'failed',
          error: err.message
        };
        return map;
      });
      chatActions.addSystemMessage(currentLang === 'en'
        ? `Failed to upload "${file.name}": ${err.message}`
        : `上传文件 "${file.name}" 失败: ${err.message}`);
    }

    xhr.send(formData);
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
        sender: client?.clientLabel || $currentDevice?.label || 'Me',
        avatar: $currentDevice?.avatar || '',
        peer: client?.clientPeer || localStorage.getItem('chat_peer') || ''
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
      chatActions.addMessage(msg);
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
    if ($chatSessionStatus !== 'active') return;
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
    const txId = e.detail;
    const activeXhr = activeUploads.get(txId);
    if (activeXhr) {
      activeXhr.abort();
      activeUploads.delete(txId);
    }
    if (client) {
      client.cancelTransfer(txId);
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

  function handleLeaveSessionConfirm() {
    showLeaveConfirm = false;
    if (client) {
      client.leaveSession();
    }
  }

  function setLanguage(lang: string) {
    const normLang = lang.toLowerCase().split('-')[0];
    localStorage.setItem('eqt_lang', normLang);
    localStorage.setItem('eqt-page-lang', normLang);
    currentLang = normLang;
    showLangPanel = false;
  }

  $: currentTheme = ($currentDevice && $currentDevice.theme) || 'theme-0';
  $: joinUrl = window.location.origin + "/chat-v2/" + token + "?join=" + joinToken + "&theme=" + currentTheme + "&lang=" + currentLang;
  $: qrImgSrc = `/chat-v2/${token}/qr.png?join=${joinToken}&theme=${currentTheme}&lang=${currentLang}`;

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
    showLeaveConfirm = false;
  }

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    logToGui('Svelte dragenter triggered, posting iframe-drag-active to parent');
    window.parent.postMessage({ type: 'iframe-drag-active' }, '*');
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="chat-viewport" on:click={closeAllPanels}
  on:dragenter={handleDragEnter}
  on:dragover={handleDragOver}
  on:dragleave={handleDragLeave}
  on:drop={handleDrop}
>
  <main>
    <section class="chat-shell">
      <header class="chat-head" class:offline={$connState !== 'connected'}>
        <div class="chat-head-title">
          <img class="chat-logo" src="/assets/eqt-logo-mark.png" alt="EQT logo">
          <div class="chat-title-container">
            <h1 id="chat-title-text">
              <span class="chat-title-brand">EQT</span>
              {#if licenseTier}
                <span class="license-badge">{licenseTier}</span>
              {/if}
            </h1>
          </div>
        </div>

        <div class="head-actions">
          {#if showQuotaPill}
            <!-- Free-tier countdown: left of device list; also shown when embedded in desktop GUI -->
            <button
              class="quota-pill"
              class:urgent={quotaPillUrgent}
              class:degraded={freeDegraded}
              type="button"
              title={t.freeQuotaHint}
              on:click|stopPropagation={() => { showLicensePanel = !showLicensePanel; showDevicePanel = false; showLangPanel = false; }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>
              <span>{quotaPillLabel}</span>
            </button>
          {:else if !isEmbedded && licenseTier}
            <!-- Paid: keep compact tier pill (non-embedded only) -->
            <button
              class="quota-pill"
              type="button"
              title={t.viewSubscription}
              on:click|stopPropagation={() => { showLicensePanel = !showLicensePanel; showDevicePanel = false; showLangPanel = false; }}
            >
              <span>{licenseTier}</span>
            </button>
          {/if}

          {#if $chatSessionStatus === 'active'}
            <button class="device-pill" type="button" on:click|stopPropagation={() => { showDevicePanel = !showDevicePanel; showLangPanel = false; showLicensePanel = false; }} title="Show connected devices">
              <svg viewBox="0 0 24 24" aria-hidden="true" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="4" width="18" height="12" rx="2"></rect><path d="M8 20h8"></path><path d="M12 16v4"></path></svg>
              <span id="device-count">{$peers.length}</span>
            </button>

            <button class="icon-button qr-btn" class:qr-breathe={isQRPulsing} type="button" on:click|stopPropagation={() => { showShareModal = true; stopQRPulse(); closeAllPanels(); }} title="Show session QR">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4z"></path><path d="M14 4h6v6h-6z"></path><path d="M4 14h6v6H4z"></path><path d="M14 14h2v2h-2z"></path><path d="M18 14h2v6h-4v-2h2z"></path><path d="M14 18h2v2h-2z"></path></svg>
            </button>
          {/if}

          {#if isEmbedded}
            <button class="icon-button danger" type="button" on:click={handleClose} title="Stop chat">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>
            </button>
          {:else if $chatSessionStatus === 'active'}
            <button class="icon-button danger" type="button" on:click|stopPropagation={() => { closeAllPanels(); showLeaveConfirm = true; }} title="Exit chat">
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            </button>
          {/if}

          {#if !isEmbedded}
            <button class="icon-button lang-btn" type="button" on:click|stopPropagation={() => { showLangPanel = !showLangPanel; showDevicePanel = false; showLicensePanel = false; }} title="Switch language">
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
            </button>
          {/if}

          <!-- Panels -->
          <div class="device-panel" class:open={showDevicePanel} on:click|stopPropagation>
            <div class="device-panel-title" style="margin-bottom: 8px;">{t.onlineDevices}</div>
            <div class="device-roster">
              {#each $peers as dev}
                {@const isSelf = dev.id === $currentDevice?.id}
                {@const activeTx = Object.values($transfers).find(tx => tx.clientId === dev.peer && (tx.state === 'running' || tx.state === 'queued'))}
                {@const tc = getThemeColors(dev.theme)}
                <div class="device-item">
                  <button class="device-row-lite roster-row" type="button" on:click={() => toggleDeviceDetail(dev.id)} aria-expanded={selectedDevId === dev.id ? 'true' : 'false'}>
                    <div class="message-avatar" style="width: 24px; height: 24px; font-size: 10px; line-height: 24px; border-radius: 50%; background: {getDeviceColor(dev.theme)}; color: #fff; text-align: center; font-weight: bold; flex-shrink: 0; overflow: hidden; display: flex; align-items: center; justify-content: center; border: none !important;">
                      {#if dev.avatar && dev.avatar.startsWith('data:image/')}
                        <img src={dev.avatar} alt={dev.label} style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;" />
                      {:else if dev.avatar}
                        {dev.avatar}
                      {:else}
                        {dev.label ? dev.label.slice(0, 2).toUpperCase() : 'DE'}
                      {/if}
                    </div>
                    <div style="text-align: left; margin-left: 8px; flex: 1; min-width: 0;">
                      <strong style="display: block; font-size: 13px; color: {getDeviceColor(dev.theme)}; overflow-x: auto; white-space: nowrap; max-width: 100%; scrollbar-width: none; -ms-overflow-style: none;">{dev.label}</strong>
                      {#if activeTx}
                        {#if activeTx.state === 'running'}
                          <span style="font-size: 10px; color: var(--accent-strong); font-weight: bold;">
                            {currentLang === 'en' ? 'Transferring' : '传输中'}: {activeTx.percent ?? 0}% ({formatSpeed(activeTx.speed ?? 0)})
                          </span>
                        {:else}
                          <span style="font-size: 10px; color: #6b7280;">{currentLang === 'en' ? 'Queued...' : '排队等待中...'}</span>
                        {/if}
                      {/if}
                    </div>
                    {#if isSelf}
                      <span class="device-state" style="background: transparent; color: var(--muted); padding: 0;">{t.self}</span>
                    {:else}
                      <span class="device-state" style="background: transparent; color: {tc ? tc.border : 'var(--accent-strong)'}; padding: 0;">{t.online}</span>
                    {/if}
                  </button>

                  <div class="device-detail" class:open={selectedDevId === dev.id}>
                    <div class="device-detail-head" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px dashed var(--line); min-width: 0;">
                      {#if isSelf}
                        {#if isEditingName}
                          <div class="device-rename-form">
                            <input bind:value={editNameVal} on:keydown={handleRenameInputKeydown} class="device-rename-input" placeholder={t.inputDeviceName}>
                            <div class="device-rename-buttons">
                              <button class="side-btn device-rename-btn" on:click|preventDefault={handleRenameDevice}>{t.save}</button>
                              <button class="side-btn device-rename-btn cancel" on:click|preventDefault={() => { if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) { document.activeElement.blur(); } isEditingName = false; }}>{t.cancel}</button>
                            </div>
                          </div>
                        {:else}
                          <strong style="font-size: 11px; color: #333; overflow-x: auto; white-space: nowrap; max-width: 100%; scrollbar-width: none; -ms-overflow-style: none;">{dev.label} ({t.self})</strong>
                          <button class="icon-button" style="padding: 2px; width: 22px; height: 22px; flex-shrink: 0;" on:click={() => isEditingName = true} title={t.renameDevice}>
                            <svg viewBox="0 0 24 24" aria-hidden="true" stroke="currentColor" stroke-width="2" fill="none"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                          </button>
                        {/if}
                      {:else}
                        <strong style="font-size: 11px; color: #333; overflow-x: auto; white-space: nowrap; max-width: 100%; scrollbar-width: none; -ms-overflow-style: none;">{dev.label}</strong>
                        <button class="icon-button danger" style="padding: 2px; width: 22px; height: 22px; color: #dc2626; flex-shrink: 0;" on:click={() => handleKickDevice(dev.id, dev.label)} title={t.kickOffline}>
                          <svg viewBox="0 0 24 24" aria-hidden="true" stroke="currentColor" stroke-width="2" fill="none"><path d="M10 12h10M17 8l4 4-4 4M15 4H9a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6"/></svg>
                        </button>
                      {/if}
                    </div>
                    <div class="device-detail-meta" style="font-size: 10px; color: #666; display: flex; flex-direction: column; gap: 2px; text-align: left;">
                      <span>{currentLang === 'en' ? 'Status: Online' : '状态: 在线'}</span>
                      <span>{currentLang === 'en' ? 'Concurrent Connections: 1' : '并发连接数: 1'}</span>
                      <span>{currentLang === 'en' ? 'Last Active:' : '上次活跃时间:'} {formatDeviceTime(dev.lastSeen)}</span>
                    </div>
                  </div>
                </div>
              {:else}
                <div class="device-empty">{t.noOtherDevices}</div>
              {/each}
            </div>
          </div>

          <div class="license-panel" class:open={showLicensePanel} on:click|stopPropagation>
            <div class="license-panel-title" style="margin-bottom: 8px;">{t.subscriptionDetails}</div>
            <div class="license-details-box">
              {#if isPaid}
                <div class="license-status-badge success">{licenseTier || t.vipLifetime}</div>
                <div class="license-info-row">
                  <strong>{t.authStatus}</strong>
                  <span>{t.validLifetime}</span>
                </div>
                <div class="license-info-row">
                  <strong>{t.speedLimit}</strong>
                  <span>{t.unlimitedSpeed}</span>
                </div>
              {:else}
                <div class="license-status-badge" class:success={!freeDegraded}>{getTranslation('freeTier', currentLang)}</div>
                <div class="license-info-row">
                  <strong>{t.freeQuotaDaily}</strong>
                  <span>{formatQuotaClock(dailySeconds)}</span>
                </div>
                <div class="license-info-row">
                  <strong>{t.freeQuotaUsed}</strong>
                  <span>{formatQuotaClock(usedSeconds)}</span>
                </div>
                <div class="license-info-row">
                  <strong>{freeDegraded ? t.freeQuotaDegraded : getTranslation('freeQuotaRemaining', currentLang).replace('{time}', '').trim()}</strong>
                  <span>{freeDegraded ? t.freeQuotaAttachmentPolicy : formatQuotaClock(remainingSeconds)}</span>
                </div>
                <p style="margin: 8px 0 0; font-size: 11px; line-height: 1.45; color: #666;">{t.freeQuotaHint}</p>
                {#if !isEmbedded}
                  <a
                    href="https://eqt.net.im/pricing.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    style="display: block; margin-top: 10px; text-align: center; font-size: 12px; font-weight: 700; color: var(--accent-strong);"
                  >{t.freeQuotaUpgrade}</a>
                {/if}
              {/if}
            </div>
          </div>

          <div class="lang-panel" class:open={showLangPanel} on:click|stopPropagation>
            <div class="lang-panel-title">{t.selectLanguage}</div>
            <div class="lang-list">
              <button class="lang-option" class:active={currentLang === 'en'} on:click={() => setLanguage('en')}>English</button>
              <button class="lang-option" class:active={currentLang === 'ja'} on:click={() => setLanguage('ja')}>日本語</button>
              <button class="lang-option" class:active={currentLang === 'ko'} on:click={() => setLanguage('ko')}>한국어</button>
              <button class="lang-option" class:active={currentLang === 'es'} on:click={() => setLanguage('es')}>Español</button>
              <button class="lang-option" class:active={currentLang === 'de'} on:click={() => setLanguage('de')}>Deutsch</button>
              <button class="lang-option" class:active={currentLang === 'fr'} on:click={() => setLanguage('fr')}>Français</button>
              <button class="lang-option" class:active={currentLang === 'zh'} on:click={() => setLanguage('zh')}>简体中文</button>
            </div>
          </div>
        </div>
      </header>

      {#if $chatSessionStatus === 'replaced'}
        <div class="session-resume-banner" role="status">
          <span class="session-resume-text">{getTranslation('tabReplacedHint', currentLang)}</span>
          <button
            type="button"
            class="session-resume-btn"
            on:click={() => client?.resumeConnection()}
          >
            {getTranslation('reconnectSession', currentLang)}
          </button>
        </div>
      {/if}

      <MessageList 
        messages={$messages}
        txState={$transfers}
        currentLang={currentLang}
        isEmbedded={isEmbedded}
        isMine={(msg) => {
          const myPeer = client?.clientPeer || localStorage.getItem('chat_peer');
          if (msg.senderId && myPeer) {
            return msg.senderId === myPeer || (myPeer === 'desktop' && msg.senderId === 'desktop');
          }
          return false;
        }}
        on:startDownload={handleStartDownload}
        on:cancelDownload={handleCancelDownload}
        on:recallMessage={handleRecallMessage}
        on:systemNotice={handleSystemNotice}
        on:editAgain={handleEditAgain}
        on:resendFile={handleResendFile}
        on:openFolder={handleOpenFolder}
        on:loadOlderHistory={() => client?.loadOlderHistory()}
      />

      <MessageComposer 
        bind:text={composerText}
        currentLang={currentLang}
        on:sendText={handleSendText}
        on:sendFile={handleSendFile}
      />
    </section>

    <!-- QR Backdrop Modal -->
    <div class="session-backdrop" class:mobile-layout={isMobileLayout} class:open={showShareModal} on:click|self={() => showShareModal = false}>
      <aside class="side">
        <div class="side-section-head">
          <h1 style="font-size: 16px; font-weight: bold;">{t.sessionQR}</h1>
          <button class="icon-button" type="button" on:click={() => showShareModal = false} title="Close">
            <svg viewBox="0 0 24 24" aria-hidden="true" stroke="currentColor" stroke-width="2" fill="none"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <p class="side-note">{t.scanQR}</p>
        <div class="qr-frame">
          <img class="qr" src={qrImgSrc} alt="Chat QR code">
        </div>
        <div class="session-collapsible" class:collapsed={!showUrl}>
          <div class="url-row">
            <input value={joinUrl} readonly style="background: #eef5ee; border: 1px solid var(--line); border-radius: 8px; font-family: monospace; font-size: 12px; padding: 6px 8px; width: 100%; box-sizing: border-box;">
            <button class="side-btn" type="button" on:click={handleCopyUrl} style="flex-shrink: 0;">
              {copied ? t.copied : t.copy}
            </button>
          </div>
        </div>
        <button class="session-toggle" type="button" on:click={() => showUrl = !showUrl}>
          {showUrl ? t.hideLink : t.showLink}
        </button>
      </aside>
    </div>

    <!-- 退出确认模态框 -->
    <div class="session-backdrop" class:mobile-layout={isMobileLayout} class:open={showLeaveConfirm} on:click|self={() => showLeaveConfirm = false}>
      <aside class="side" style="max-width: 300px; padding: 16px;">
        <div class="side-section-head">
          <h1 style="font-size: 16px; font-weight: bold; color: var(--danger);">
            {currentLang === 'en' ? 'Exit Session' : '退出当前会话'}
          </h1>
          <button class="icon-button" type="button" on:click={() => showLeaveConfirm = false} title="Close">
            <svg viewBox="0 0 24 24" aria-hidden="true" stroke="currentColor" stroke-width="2" fill="none"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <p class="side-note" style="margin-top: 4px; margin-bottom: 12px; font-size: 13px; line-height: 1.4; color: var(--muted);">
          {currentLang === 'en' 
            ? 'Are you sure you want to exit the current chat session? Once you exit, your device will be unregistered and you will have to re-scan the QR code to join again.' 
            : '确定要退出当前聊天会话吗？退出后，您的设备将被注销，且必须重新扫描二维码才能再次加入。'}
        </p>
        <div style="display: flex; gap: 10px; justify-content: flex-end;">
          <button class="side-btn" style="background: transparent; border: 1px solid var(--line); color: var(--muted);" on:click={() => showLeaveConfirm = false}>
            {currentLang === 'en' ? 'Cancel' : '取消'}
          </button>
          <button class="side-btn" style="background: var(--danger); border-color: var(--danger); color: white;" on:click={handleLeaveSessionConfirm}>
            {currentLang === 'en' ? 'Exit' : '确定退出'}
          </button>
        </div>
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
