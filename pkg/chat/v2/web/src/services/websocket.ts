import { get } from 'svelte/store';
import type { CommandEnvelope, EventEnvelope } from './types';
import { chatActions, messages, historyHasMore, historyOldestSeq, historyLoading } from '../state/chatStore';
import { resolveConnectAfterSeq } from './reconnectSeq';

/** Default page size; must stay aligned with session.DefaultHistoryPageSize. */
export const HISTORY_PAGE_SIZE = 100;

// Track initial page connection globally across renames within the same page load
let isInitialConnect = true;

export class ChatWebSocketClient {
  private ws: WebSocket | null = null;
  private token: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000; // start with 1s
  private heartbeatIntervalId: any = null;
  private lastHeartbeatAck = Date.now();
  private isManualClosed = false;
  private isSuspended = false;
  private clientToken = '';
  private pendingLogs: string[] = [];

  public clientLabel: string;
  public clientPeer: string;
  public clientAvatar: string;
  private joinParam: string = '';
  private themeParam: string = '';
  public onRequestFileData: ((messageId: string) => void) | null = null;
  private localJoin: string = '';

  constructor(token: string, localJoin?: string) {
    this.token = token;
    this.localJoin = localJoin || '';
    // Extract join and theme parameter from URL search query
    const params = new URLSearchParams(window.location.search);
    const wasKicked = localStorage.getItem('eqt_kicked_state') === 'true';
    const wasLeft = localStorage.getItem('eqt_manual_leave') === 'true';

    // If device was previously kicked out or manually exited, any page reload/scan represents a manual override join action,
    // so we fully purge the local registration keys, tokens, and generate clean credentials for a reset device.
    if (wasKicked || wasLeft) {
      localStorage.removeItem('eqt_kicked_state');
      localStorage.removeItem('eqt_manual_leave');
      localStorage.removeItem('chat_label');
      localStorage.removeItem('chat_avatar');
      localStorage.removeItem('chat_peer');
      const key = `eqt-chat-token:${window.location.pathname}`;
      localStorage.removeItem(key);
      localStorage.removeItem('chat_token');
    }

    this.joinParam = params.get('join') || '';
    const themeFromUrl = params.get('theme') || '';
    if (themeFromUrl) {
      localStorage.setItem('eqt_chat_theme', themeFromUrl);
    }
    this.themeParam = localStorage.getItem('eqt_chat_theme') || themeFromUrl || '';

    // Auto-generate some local client details if not provided
    let randSuffix = '';
    try {
      randSuffix = Math.random().toString(36).substring(2, 6);
    } catch (e) {
      // fallback
    }
    if (!randSuffix || randSuffix.length < 4) {
      randSuffix = Math.floor(1000 + Math.random() * 9000).toString();
    }
    this.clientLabel = params.get('sender') || localStorage.getItem('chat_label') || `Device-${randSuffix}`;
    this.clientAvatar = params.get('avatar') || localStorage.getItem('chat_avatar') || '';
    
    // Device identity: same browser shares one peer via localStorage so multiple
    // tabs of the same room count as one device. The server keeps a single live
    // connection per peer (newer tab replaces older). Use ?peer= only for multi-tab
    // simulation/debug when you intentionally want distinct devices.
    this.clientPeer = params.get('peer') || localStorage.getItem('chat_peer') || `peer-${Math.random().toString(36).substring(2, 10)}`;
    if (!params.get('peer')) {
      localStorage.setItem('chat_peer', this.clientPeer);
    }
    
    localStorage.setItem('chat_label', this.clientLabel);
    localStorage.setItem('chat_avatar', this.clientAvatar);

    // Generate/load client-unique token for session verification
    const key = `eqt-chat-token:${window.location.pathname}`;
    let savedToken = localStorage.getItem(key);
    if (!savedToken) {
      if (window.crypto && window.crypto.getRandomValues) {
        const data = new Uint8Array(16);
        window.crypto.getRandomValues(data);
        savedToken = Array.from(data).map(v => ('0' + v.toString(16)).slice(-2)).join('');
      } else {
        savedToken = String(Date.now()) + '-' + String(Math.random()).slice(2);
      }
      localStorage.setItem(key, savedToken);
    }
    this.clientToken = savedToken;
    localStorage.setItem('chat_token', savedToken);

    // Register Page Visibility listener to suspend actively on sleep
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.isSuspended = true;
          if (this.ws) {
            this.sendLog(`[SYSTEM] Page hidden/suspended, closing WebSocket client actively.`);
            this.ws.close(1000, "page_hidden");
          }
        } else if (document.visibilityState === 'visible') {
          this.isSuspended = false;
          if (!this.isManualClosed && (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING)) {
            this.reconnectAttempts = 0;
            this.reconnectDelay = 1000;
            this.connect();
          }
        }
      });
    }
  }

  public connect(): void {
    if (this.ws) {
      this.ws.close();
    }

    this.isManualClosed = false;
    chatActions.setConnectionState('connecting');

    const protocolStr = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Path: /chat-v2/{token}/ws
    const wsUrl = `${protocolStr}//${window.location.host}/chat-v2/${this.token}/ws`;

    try {
      this.ws = new WebSocket(wsUrl);
      this.setupHandlers();
    } catch (err: any) {
      chatActions.addSystemMessage(`Connection setup failed: ${err.message}`);
      this.handleReconnect();
    }
  }

  private setupHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      chatActions.addSystemMessage('WebSocket connection established.');
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      
      let preferredTheme = localStorage.getItem('eqt_chat_theme') || this.themeParam || 'theme-0';
      if (this.clientPeer === 'desktop') {
        preferredTheme = 'theme-0';
      }

      const savedJoinSeq = parseInt(localStorage.getItem(`eqt_join_seq_${this.token}`) || '0', 10);
      const savedAfterSeq = parseInt(localStorage.getItem(`eqt_after_seq_${this.token}`) || '0', 10);
      // Cold start (empty in-memory list): replay from join boundary, not high watermark.
      const connectAfterSeq = resolveConnectAfterSeq(get(messages).length, savedJoinSeq, savedAfterSeq);
      if (connectAfterSeq !== savedAfterSeq) {
        // Queue until after connect handshake (cl is nil before Register).
        this.pendingLogs.push(
          `[SYSTEM] Cold-start history rehydrate: localMessages=0 joinSeq=${savedJoinSeq} afterSeq=${savedAfterSeq} -> connectAfterSeq=${connectAfterSeq}`
        );
      }

      // Perform Connect Command handshake
      this.sendCommand({
        type: 'connect',
        commandId: `init-${Date.now()}`,
        client: {
          token: this.clientToken,
          label: this.clientLabel,
          avatar: this.clientAvatar,
          peer: this.clientPeer,
          theme: preferredTheme,
          join: this.joinParam,
          localJoin: this.localJoin,
          isNewScan: isInitialConnect
        },
        afterSeq: connectAfterSeq,
        joinSeq: savedJoinSeq
      });
      isInitialConnect = false;

      // Clean query 'join' parameter from address bar to distinguish future page refreshes from a fresh scan
      if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
        const url = new URL(window.location.href);
        if (url.searchParams.has('join')) {
          url.searchParams.delete('join');
          window.history.replaceState({}, document.title, url.pathname + url.search);
        }
      }

      this.startHeartbeat();
      this.sendLog(`[SYSTEM] WebSocket connection established. Peer: ${this.clientPeer}, Label: ${this.clientLabel}`);
      this.flushPendingLogs();
    };

    this.ws.onmessage = (event) => {
      try {
        const payload: EventEnvelope = JSON.parse(event.data);
        this.handleEvent(payload);
      } catch (err: any) {
        chatActions.addSystemMessage(`Failed to parse server event: ${err.message}`);
      }
    };

    this.ws.onerror = (err) => {
      chatActions.addSystemMessage('WebSocket encountered an error.');
      this.sendLog(`[SYSTEM] WebSocket encountered an error.`);
    };

    this.ws.onclose = (event) => {
      chatActions.setConnectionState('disconnected');
      this.stopHeartbeat();
      if (this.isSuspended) {
        this.sendLog(`[SYSTEM] WebSocket closed due to suspension, omitting reconnection.`);
        return;
      }
      // Another tab/window of the same browser took over this peer in the room.
      // Stop auto-reconnect to avoid fights; user can resume via explicit button.
      if (event.reason === 'replaced_by_peer') {
        this.isManualClosed = true;
        chatActions.setSessionStatus('replaced');
        const currentLang = localStorage.getItem('eqt_lang') || 'zh';
        chatActions.addSystemMessage(
          currentLang === 'en'
            ? 'This tab was disconnected because the same device reconnected in another tab.'
            : '本标签页已断开：同一设备在其他标签页重新连接了本会话。'
        );
        this.sendLog(`[SYSTEM] WebSocket closed: replaced_by_peer. Stopping reconnect.`);
        return;
      }
      if (event.code === 1008 || event.code === 4008 || event.reason === "device was forced offline") {
        this.isManualClosed = true;
        localStorage.setItem('eqt_kicked_state', 'true');
        const isManualLeave = localStorage.getItem('eqt_manual_leave') === 'true';
        const currentLang = localStorage.getItem('eqt_lang') || 'zh';
        if (isManualLeave) {
          chatActions.setSessionStatus('left');
          chatActions.addSystemMessage(currentLang === 'en' ? 'You have exited the session.' : '您已退出当前会话。');
          chatActions.addMessage({
            id: `sys-leave-${Date.now()}`,
            sender: 'system',
            type: 'system',
            text: currentLang === 'en'
              ? 'You have voluntarily exited the current session. Please scan the QR code again to rejoin.'
              : '您已主动退出当前会话。如需重新加入，请重新扫码。',
            createdAt: new Date().toISOString()
          });
        } else {
          chatActions.setSessionStatus('kicked');
          chatActions.addSystemMessage(currentLang === 'en' ? 'You have been forced offline.' : '您已被强制下线，无法继续加入本会话。');
          chatActions.addMessage({
            id: `sys-kick-${Date.now()}`,
            sender: 'system',
            type: 'system',
            text: currentLang === 'en'
              ? 'You have been forced offline and cannot continue sending or receiving messages. To rejoin, please use another browser or re-scan the QR code.'
              : '您已被强制下线，无法继续在此会话中发送或接收消息。如需重新加入，请使用其他浏览器或重新扫码。',
            createdAt: new Date().toISOString()
          });
        }
        this.sendLog(`[SYSTEM] WebSocket closed: device offline. Stopping reconnect.`);
        return;
      }
      if (!this.isManualClosed) {
        chatActions.addSystemMessage(`WebSocket closed: ${event.reason || 'No reason given'}. Reconnecting...`);
        this.sendLog(`[SYSTEM] WebSocket closed: reason=${event.reason || 'none'}. Reconnecting...`);
        this.handleReconnect();
      } else {
        chatActions.addSystemMessage('WebSocket closed manually.');
        this.sendLog(`[SYSTEM] WebSocket closed manually.`);
      }
    };
  }

  private handleEvent(event: EventEnvelope): void {
    // Only advance watermark (never lower it) so older history pages do not
    // corrupt cold/warm reconnect cursors.
    if (
      event.seq !== undefined &&
      event.seq > 0 &&
      event.type !== 'hello' &&
      event.type !== 'history_page'
    ) {
      const key = `eqt_after_seq_${this.token}`;
      const prev = parseInt(localStorage.getItem(key) || '0', 10);
      if (event.seq > prev) {
        localStorage.setItem(key, event.seq.toString());
      }
    }

    switch (event.type) {
      case 'hello':
        chatActions.setConnectionState('connected');
        chatActions.setSessionStatus('active');
        chatActions.clearTransfers();
        chatActions.resetHistoryPager();
        if (event.commandId && event.commandId.startsWith('init-')) {
          chatActions.addSystemMessage(`Registered presence roster as ${this.clientLabel}.`);
        }
        // Initialize join sequence boundary for new clients
        const keyJoin = `eqt_join_seq_${this.token}`;
        if (!localStorage.getItem(keyJoin) && event.seq !== undefined && event.seq > 0) {
          localStorage.setItem(keyJoin, event.seq.toString());
        }
        this.sendLog(`[SYSTEM] Handshake Hello received. Sequence: ${event.seq}`);
        break;

      case 'history_page':
        if (event.history) {
          chatActions.setHistoryPage(
            !!event.history.hasMore,
            event.history.oldestSeq || 0
          );
          this.sendLog(
            `[EVENT] History page: count=${event.history.count}, hasMore=${event.history.hasMore}, oldestSeq=${event.history.oldestSeq || 0}`
          );
        } else {
          chatActions.setHistoryLoading(false);
        }
        break;

      case 'heartbeat':
        this.lastHeartbeatAck = Date.now();
        break;

      case 'message_added':
        if (event.message) {
          chatActions.addMessage(event.message);
          this.sendLog(`[EVENT] Message added: ID=${event.message.id}, Type=${event.message.type}`);
          this.sendAck(event.message.id);
        }
        break;

      case 'message_updated':
        if (event.message) {
          chatActions.updateMessage(event.message);
          this.sendLog(`[EVENT] Message updated: ID=${event.message.id}, Uploading=${event.message.uploading}`);
          this.sendAck(event.message.id);
        }
        break;

      case 'message_recalled':
        if (event.message?.id) {
          chatActions.recallMessage(event.message.id);
          this.sendLog(`[EVENT] Message recalled: ID=${event.message.id}`);
        }
        break;

      case 'presence_changed':
        if (event.presence) {
          chatActions.updatePresence(event.presence.devices, this.clientPeer);
          // Find our own device in roster
          const me = event.presence.devices.find(d => d.peer === this.clientPeer);
          if (me) {
            chatActions.setCurrentDevice(me);
          }
          this.sendLog(`[EVENT] Presence updated. Connected devices: ${event.presence.devices.map(d => d.label).join(', ')}`);
        }
        break;

      case 'transfer_queued':
      case 'transfer_started':
      case 'transfer_progress':
      case 'transfer_completed':
      case 'transfer_failed':
      case 'transfer_cancelled':
        if (event.transfer) {
          // Update local store with all transfer events (so we can display active speeds in the roster)
          chatActions.updateTransfer(event.transfer);
          
          // Only mark local message status if this transfer belongs to us (the downloader client)
          // or if it's an upload job and we are either the sender or the GUI host
          const isUploadJob = event.transfer.id.startsWith('ul-');
          const isGuiHost = typeof window !== 'undefined' && window.parent !== window;
          const isMineOrGui = event.transfer.clientId === this.clientPeer || isGuiHost;
          
          if ((event.transfer.clientId === this.clientPeer || (isUploadJob && isMineOrGui)) && event.transfer.messageId) {
            if (event.type === 'transfer_started' || event.type === 'transfer_progress' || event.type === 'transfer_completed') {
              chatActions.markMessageDownloaded(event.transfer.messageId);
            }
            if (event.type === 'transfer_completed') {
              chatActions.markMessageUploadComplete(event.transfer.messageId);
            }
          }
          this.sendLog(`[TRANSFER] Event=${event.type}, clientId=${event.transfer.clientId}, messageId=${event.transfer.messageId}, bytes=${event.transfer.bytesDone}/${event.transfer.bytesTotal}, state=${event.transfer.state}`);
        }
        break;

      case 'request_file_data':
        if (event.message && event.message.id) {
          this.sendLog(`[EVENT] Received request_file_data from server for messageId: ${event.message.id}`);
          if (this.onRequestFileData) {
            this.onRequestFileData(event.message.id);
          }
        }
        break;

      case 'error':
        if (event.error) {
          chatActions.addSystemMessage(`Server Error: [${event.error.code}] ${event.error.message}`);
          this.sendLog(`[SERVER-ERROR] Code=${event.error.code}, Msg=${event.error.message}`);
        }
        break;

      default:
        console.warn('Unhandled socket event:', event.type);
    }
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      chatActions.addSystemMessage('Reached maximum WebSocket reconnect attempts. Please refresh page.');
      return;
    }

    this.reconnectAttempts++;
    setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);

    // Exponential backoff capped at 15s
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 15000);
  }

  private startHeartbeat(): void {
    this.lastHeartbeatAck = Date.now();
    this.heartbeatIntervalId = setInterval(() => {
      if (Date.now() - this.lastHeartbeatAck > 30000) {
        chatActions.addSystemMessage('Heartbeat timeout (30s). Re-establishing connection.');
        this.ws?.close();
        return;
      }

      this.sendCommand({
        type: 'heartbeat',
        commandId: `hb-${Date.now()}`
      });
    }, 15000); // Send heartbeat every 15s
  }

  private stopHeartbeat(): void {
    if (this.heartbeatIntervalId) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }
  }

  public sendText(text: string): void {
    this.sendCommand({
      type: 'send_text',
      commandId: `txt-${Date.now()}`,
      text: text
    });
  }

  /** Request the next older page of messages (scroll-up pagination). */
  public loadOlderHistory(): void {
    if (get(historyLoading) || !get(historyHasMore)) {
      return;
    }
    const beforeSeq = get(historyOldestSeq);
    if (!beforeSeq || beforeSeq <= 0) {
      return;
    }
    const joinSeq = parseInt(localStorage.getItem(`eqt_join_seq_${this.token}`) || '0', 10);
    chatActions.setHistoryLoading(true);
    this.sendCommand({
      type: 'load_history',
      commandId: `hist-${Date.now()}`,
      joinSeq,
      beforeSeq,
      limit: HISTORY_PAGE_SIZE
    });
    this.sendLog(`[SYSTEM] load_history beforeSeq=${beforeSeq} joinSeq=${joinSeq}`);
  }

  public startTransfer(transferId: string): void {
    this.sendCommand({
      type: 'start_transfer',
      commandId: `start-tx-${Date.now()}`,
      transferId: transferId
    });
  }

  public cancelTransfer(transferId: string): void {
    this.sendCommand({
      type: 'cancel_transfer',
      commandId: `cancel-tx-${Date.now()}`,
      transferId: transferId
    });
  }

  public recallMessage(messageId: string): void {
    this.sendCommand({
      type: 'recall_message',
      commandId: `rc-${Date.now()}`,
      messageId: messageId
    });
    // Optimistic update locally
    chatActions.recallMessage(messageId);
  }

  public updateClient(label: string, avatar: string): void {
    this.clientLabel = label;
    this.clientAvatar = avatar;
    this.sendCommand({
      type: 'update_client',
      commandId: `upd-${Date.now()}`,
      client: {
        token: this.token,
        label: label,
        avatar: avatar
      }
    });
  }

  public kickClient(clientId: string): void {
    this.sendCommand({
      type: 'kick_client',
      commandId: `kick-${Date.now()}`,
      clientId: clientId
    });
  }

  public sendLog(text: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendCommand({
        type: 'log',
        commandId: `log-${Date.now()}`,
        text: text
      });
    } else {
      this.pendingLogs.push(text);
    }
  }

  private flushPendingLogs(): void {
    while (this.pendingLogs.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
      const logText = this.pendingLogs.shift();
      if (logText) {
        this.sendCommand({
          type: 'log',
          commandId: `log-${Date.now()}`,
          text: logText
        });
      }
    }
  }

  public log(msg: string): void {
    console.log(`[CLIENT-LOG] ${msg}`);
    this.sendLog(msg);
  }

  public reportUploadProgress(messageId: string, bytesDone: number, bytesTotal: number): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendCommand({
        type: 'report_progress',
        commandId: `progress-${Date.now()}`,
        messageId: messageId,
        bytesDone: bytesDone,
        bytesTotal: bytesTotal
      });
    }
  }

  public sendAck(messageId: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendCommand({
        type: 'ack',
        commandId: `ack-${Date.now()}`,
        messageId: messageId
      });
    }
  }

  private sendCommand(command: CommandEnvelope): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(command));
    } else {
      chatActions.addSystemMessage('Cannot send command. WebSocket is not open.');
    }
  }

  /**
   * Explicit resume after this tab was superseded by another tab of the same peer.
   * Clears the manual-close latch and reconnects; does not run on visibility alone.
   */
  public resumeConnection(): void {
    if (!this.isManualClosed && this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }
    this.isManualClosed = false;
    this.reconnectAttempts = 0;
    this.reconnectDelay = 1000;
    this.sendLog('[SYSTEM] User requested resumeConnection after peer replacement.');
    this.connect();
  }

  public close(): void {
    this.isManualClosed = true;
    this.stopHeartbeat();
    this.ws?.close();
  }

  public leaveSession(): void {
    this.isManualClosed = true;
    localStorage.setItem('eqt_kicked_state', 'true');
    localStorage.setItem('eqt_manual_leave', 'true');
    this.ws?.close(4008, "device was forced offline");
  }
}
