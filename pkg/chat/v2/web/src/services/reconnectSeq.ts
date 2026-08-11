/**
 * Resolve the afterSeq watermark sent on WebSocket connect.
 *
 * Warm reconnect (local message list still in memory): keep the saved afterSeq
 * so the server only replays events that were missed while offline.
 *
 * Cold start (page reload / mobile tab discard emptied the in-memory list):
 * lower afterSeq to joinSeq so the server rehydrates join-boundary history.
 * Without this, a high afterSeq + empty UI yields a blank chat even though the
 * server still has the events.
 */
export function resolveConnectAfterSeq(
  localMessageCount: number,
  joinSeq: number,
  afterSeq: number
): number {
  if (localMessageCount === 0 && joinSeq > 0) {
    return joinSeq;
  }
  return afterSeq;
}
