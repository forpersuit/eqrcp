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

  private clientLabel: string;
  private clientPeer: string;

  constructor(token: string) {
    this.token = token;
    // Auto-generate some local client details if not provided
    this.clientLabel = localStorage.getItem('chat_label') || `Device-${Math.random().toString(36).substring(2, 6)}`;
    this.clientPeer = localStorage.getItem('chat_peer') || `peer-${Math.random().toString(36).substring(2, 10)}`;
    localStorage.setItem('chat_label', this.clientLabel);
    localStorage.setItem('chat_peer', this.clientPeer);
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
      
      // Perform Connect Command handshake
      this.sendCommand({
        type: 'connect',
        commandId: `init-${Date.now()}`,
        client: {
          token: this.token,
          label: this.clientLabel,
          peer: this.clientPeer,
          theme: 'dark'
        }
      });

      this.startHeartbeat();
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
    };

    this.ws.onclose = (event) => {
      chatActions.setConnectionState('disconnected');
      this.stopHeartbeat();
      if (!this.isManualClosed) {
        chatActions.addSystemMessage(`WebSocket closed: ${event.reason || 'No reason given'}. Reconnecting...`);
        this.handleReconnect();
      } else {
        chatActions.addSystemMessage('WebSocket closed manually.');
      }
    };
  }

  private handleEvent(event: EventEnvelope): void {
    switch (event.type) {
      case 'hello':
        chatActions.setConnectionState('connected');
        if (event.commandId && event.commandId.startsWith('init-')) {
          chatActions.addSystemMessage(`Registered presence roster as ${this.clientLabel}.`);
        }
        break;

      case 'heartbeat':
        this.lastHeartbeatAck = Date.now();
        break;

      case 'message_added':
        if (event.message) {
          chatActions.addMessage(event.message);
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
        }
        break;

      case 'transfer_queued':
      case 'transfer_started':
      case 'transfer_progress':
      case 'transfer_completed':
      case 'transfer_failed':
      case 'transfer_cancelled':
        if (event.transfer) {
          chatActions.updateTransfer(event.transfer);
        }
        break;

      case 'error':
        if (event.error) {
          chatActions.addSystemMessage(`Server Error: [${event.error.code}] ${event.error.message}`);
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
