import { writable } from 'svelte/store';
import type { Message, Device, TransferEvent } from '../services/types';

export const messages = writable<Message[]>([]);
export const peers = writable<Device[]>([]);
export const transfers = writable<Record<string, TransferEvent>>({});
export const connState = writable<'connecting' | 'connected' | 'disconnected'>('disconnected');
export const currentDevice = writable<Device | null>(null);
export const systemMessages = writable<string[]>([]); // For in-app notifications

// Actions - Only update state through explicit actions
export const chatActions = {
  addMessage(msg: Message) {
    if (msg.text) {
      try {
        const parsed = JSON.parse(msg.text);
        if (parsed && parsed.type === 'file') {
          msg.type = 'file';
          msg.fileName = parsed.fileName;
          msg.size = parsed.size;
          msg.text = '';
        }
      } catch (e) {
        // Leave as regular text message
      }
    }

    messages.update(list => {
      if (list.some(m => m.id === msg.id)) return list;
      return [...list, msg].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    });
  },

  recallMessage(messageId: string) {
    messages.update(list => list.map(m => {
      if (m.id === messageId) {
        return {
          ...m,
          recalled: true
        };
      }
      return m;
    }));
  },

  clearMessages() {
    messages.set([]);
  },

  updatePresence(devices: Device[]) {
    peers.set(devices);
  },

  updateTransfer(event: TransferEvent) {
    transfers.update(map => ({
      ...map,
      [event.id]: event
    }));
  },

  setConnectionState(state: 'connecting' | 'connected' | 'disconnected') {
    connState.set(state);
  },

  setCurrentDevice(device: Device | null) {
    currentDevice.set(device);
  },

  addSystemMessage(msg: string) {
    systemMessages.update(list => [...list, `${new Date().toLocaleTimeString()}: ${msg}`]);
  },

  clearSystemMessages() {
    systemMessages.set([]);
  }
};
