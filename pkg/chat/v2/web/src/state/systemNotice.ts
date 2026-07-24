/** Pure helper: which addSystemMessage texts should appear as chat stream bubbles. */
export function shouldSurfaceSystemNotice(msg: string): boolean {
  if (!msg || !msg.trim()) return false;
  // Routine connect acks — keep in TransferStatus store only, not the chat stream.
  if (msg === 'WebSocket connection established.') return false;
  if (msg.startsWith('WebSocket connection established')) return false;
  return true;
}
