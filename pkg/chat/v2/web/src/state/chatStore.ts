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
      const idx = list.findIndex(m => m.id === msg.id);
      if (idx !== -1) {
        const updated = [...list];
        updated[idx] = { ...updated[idx], ...msg };
        return updated;
      }
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

  updatePresence(devices: Device[], clientPeer?: string) {
    if (clientPeer) {
      const sorted = [...devices].sort((a, b) => {
        if (a.peer === clientPeer) return -1;
        if (b.peer === clientPeer) return 1;
        return 0; // Keep backend chronological sorting for other devices
      });
      peers.set(sorted);
    } else {
      peers.set(devices);
    }
  },

  updateTransfer(event: TransferEvent) {
    transfers.update(map => {
      const existing = map[event.id];
      const startTime = existing?.startTime || Date.now();
      let speed = existing?.speed || 0;
      if (event.state === 'running' && event.bytesDone > 0) {
        const elapsedSec = (Date.now() - startTime) / 1000;
        if (elapsedSec > 0.5) {
          speed = event.bytesDone / elapsedSec;
        }
      } else if (event.state === 'completed' && event.bytesDone > 0) {
        const elapsedSec = (Date.now() - startTime) / 1000;
        if (elapsedSec > 0) {
          speed = event.bytesDone / elapsedSec;
        }
      }
      return {
        ...map,
        [event.id]: {
          ...existing,
          ...event,
          startTime,
          speed
        }
      };
    });
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
  },

  updateMessageFilePath(messageId: string, filePath: string) {
    messages.update(list => list.map(m => {
      if (m.id === messageId) {
        return {
          ...m,
          filePath: filePath
        };
      }
      return m;
    }));
  },

  markMessageDownloaded(messageId: string) {
    messages.update(list => list.map(m => {
      if (m.id === messageId) {
        return {
          ...m,
          downloaded: true
        };
      }
      return m;
    }));
  },

  markMessageUploadComplete(messageId: string) {
    messages.update(list => list.map(m => {
      if (m.id === messageId) {
        return {
          ...m,
          uploading: false
        };
      }
      return m;
    }));
  },

  updateMessage(updated: Message) {
    if (updated.text) {
      try {
        const parsed = JSON.parse(updated.text);
        if (parsed && parsed.type === 'file') {
          updated.type = 'file';
          updated.fileName = parsed.fileName;
          updated.size = parsed.size;
          updated.text = '';
        }
      } catch (e) {
        // Leave as regular text message
      }
    }

    messages.update(list => {
      const idx = list.findIndex(m => m.id === updated.id);
      if (idx !== -1) {
        const result = [...list];
        result[idx] = {
          ...result[idx],
          ...updated
        };
        return result;
      }
      return [...list, updated].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    });
  }
};
