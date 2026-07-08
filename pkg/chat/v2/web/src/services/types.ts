export type CommandType =
  | 'connect'
  | 'heartbeat'
  | 'send_text'
  | 'recall_message'
  | 'start_transfer'
  | 'cancel_transfer'
  | 'ack';

export interface ClientInfo {
  token: string;
  label?: string;
  avatar?: string;
  theme?: string;
  peer?: string;
  join?: string;
}

export interface CommandEnvelope {
  type: CommandType;
  commandId?: string;
  client?: ClientInfo;
  afterSeq?: number;
  joinSeq?: number;
  text?: string;
  messageId?: string;
  transferId?: string;
}

export type EventType =
  | 'hello'
  | 'heartbeat'
  | 'message_added'
  | 'message_recalled'
  | 'presence_changed'
  | 'transfer_queued'
  | 'transfer_started'
  | 'transfer_progress'
  | 'transfer_completed'
  | 'transfer_failed'
  | 'transfer_cancelled'
  | 'error';

export type MessageType =
  | 'text'
  | 'file'
  | 'image'
  | 'video'
  | 'audio'
  | 'system';

export interface Message {
  id: string;
  recalled?: boolean;
  senderId?: string;
  sender: string;
  avatar?: string;
  theme?: string;
  type: MessageType;
  text?: string;
  fileName?: string;
  size?: number;
  mimeType?: string;
  url?: string;
  filePath?: string;
  downloaded?: boolean;
  uploading?: boolean;
  createdAt: string;
}

export interface Device {
  id: string;
  label: string;
  avatar?: string;
  theme?: string;
  peer?: string;
  lastSeen: string;
}

export interface PresenceEvent {
  devices: Device[];
}

export type TransferState =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TransferEvent {
  id: string;
  messageId?: string;
  clientId?: string;
  fileName?: string;
  bytesDone?: number;
  bytesTotal?: number;
  percent?: number;
  state: TransferState;
  error?: string;
  updatedAt: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export interface EventEnvelope {
  type: EventType;
  seq?: number;
  time: string;
  commandId?: string;
  message?: Message;
  presence?: PresenceEvent;
  transfer?: TransferEvent;
  error?: ErrorPayload;
}

// ── Seeded HSL theme calculations matching Go backend & Legacy html ──

export function themeIndex(theme?: string): number {
  if (!theme) return -1;
  const match = /^theme-(0|[1-9]\d{0,9})$/.exec(theme);
  if (!match) return -1;
  return parseInt(match[1], 10);
}

function seededUnit(seed: number, salt: number): number {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function hslToHex(h: number, s: number, l: number): string {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export interface ComputedTheme {
  bg: string;
  border: string;
  text: string;
}

export function generateThemeColors(index: number): ComputedTheme {
  if (index === 0) {
    // theme-0 defaults to classic EQT green
    return {
      bg: '#edf6f0',
      border: '#156f5a',
      text: '#0d4e42'
    };
  }

  const hue = seededUnit(index, 1) * 360;
  const saturation = 50 + seededUnit(index, 2) * 18;

  return {
    bg: hslToHex(hue, 22, 93),
    border: hslToHex(hue, saturation, 48),
    text: hslToHex(hue, saturation + 10, 25)
  };
}

export function getThemeColors(theme?: string): ComputedTheme | null {
  const idx = themeIndex(theme);
  if (idx < 0) return null;
  return generateThemeColors(idx);
}

export function getSenderThemeColors(sender?: string): ComputedTheme {
  if (!sender || sender === 'system') {
    return { bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.1)', text: 'rgba(255,255,255,0.9)' };
  }
  let hash = 0;
  for (let i = 0; i < sender.length; i++) {
    hash = ((hash << 5) - hash + sender.charCodeAt(i)) | 0;
  }
  const colorIndex = (Math.abs(hash) % 1000) + 1;
  return generateThemeColors(colorIndex);
}
