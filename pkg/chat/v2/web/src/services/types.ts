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
