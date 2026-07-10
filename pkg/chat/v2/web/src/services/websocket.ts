import type { CommandEnvelope, EventEnvelope } from './types';
import { chatActions } from '../state/chatStore';

export class ChatWebSocketClient {
  private ws: WebSocket | null = null;
  private token: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000; // start with 1s
  private heartbeatIntervalId: any = null;
  private lastHeartbeatAck = Date.now();
  private isManualClosed = false;
  private pendingLogs: string[] = [];

  public clientLabel: string;
  public clientPeer: string;
  private joinParam: string = '';
  private themeParam: string = '';
  public onRequestFileData: ((messageId: string) => void) | null = null;

  constructor(token: string) {
    this.token = token;
    // Extract join and theme parameter from URL search query
    const params = new URLSearchParams(window.location.search);
    this.joinParam = params.get('join') || '';
    this.themeParam = params.get('theme') || '';

    // Auto-generate some local client details if not provided
    this.clientLabel = localStorage.getItem('chat_label') || `Device-${Math.random().toString(36).substring(2, 6)}`;
    
    // Each device must have a unique, persistent clientPeer ID.
    // We check URL query param 'peer' first (ideal for simulation/multi-tab debugging), then fallback to localStorage or random UUID.
    this.clientPeer = params.get('peer') || localStorage.getItem('chat_peer') || `peer-${Math.random().toString(36).substring(2, 10)}`;
    // Only persist in localStorage if it was not forced via URL query parameter to avoid multi-tab collisions.
    if (!params.get('peer')) {
      localStorage.setItem('chat_peer', this.clientPeer);
    }
    
    localStorage.setItem('chat_label', this.clientLabel);
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
      
      let preferredTheme = this.themeParam;
      if (this.clientPeer === 'desktop') {
        preferredTheme = 'theme-0';
      }

      const savedJoinSeq = parseInt(localStorage.getItem(`eqt_join_seq_${this.token}`) || '0', 10);
      const savedAfterSeq = parseInt(localStorage.getItem(`eqt_after_seq_${this.token}`) || '0', 10);

      // Perform Connect Command handshake
      this.sendCommand({
        type: 'connect',
        commandId: `init-${Date.now()}`,
        client: {
          token: this.token,
          label: this.clientLabel,
          peer: this.clientPeer,
          theme: preferredTheme,
          join: this.joinParam
        },
        afterSeq: savedAfterSeq,
        joinSeq: savedJoinSeq
      });

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
    // Record event watermark to ensure reliable reconnection replay
    if (event.seq !== undefined && event.seq > 0) {
      localStorage.setItem(`eqt_after_seq_${this.token}`, event.seq.toString());
    }

    switch (event.type) {
      case 'hello':
        chatActions.setConnectionState('connected');
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
          chatActions.updatePresence(event.presence.devices);
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

  public close(): void {
    this.isManualClosed = true;
    this.stopHeartbeat();
    this.ws?.close();
  }
}
