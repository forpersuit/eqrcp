/**
 * EQT Chat v2 Client Telemetry Probe
 * Lightweight, zero-dependency telemetry reporter for Chat Svelte SPA.
 */

export function getOrCreateClientID(): string {
  try {
    let id = window.sessionStorage.getItem('eqt_telemetry_client_id');
    if (!id) {
      const legacy = window.localStorage.getItem('chat_peer');
      if (legacy && legacy.length >= 4) {
        id = legacy.slice(-6);
      } else {
        id = Math.random().toString(36).substring(2, 8);
      }
      window.sessionStorage.setItem('eqt_telemetry_client_id', id);
    }
    return id;
  } catch (e) {
    return Math.random().toString(36).substring(2, 8);
  }
}

export function sendTelemetry(
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG',
  category: string,
  message: string,
  details: Record<string, any> = {}
): void {
  try {
    const payload = {
      client_id: getOrCreateClientID(),
      timestamp: Date.now(),
      level: level.toUpperCase(),
      category: category.toUpperCase(),
      message: String(message || '').slice(0, 256),
      details: details || {}
    };

    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/client-log', blob);
    } else if (window.fetch) {
      fetch('/client-log', {
        method: 'POST',
        body: blob,
        keepalive: true,
        headers: { 'Content-Type': 'application/json' }
      }).catch(() => {});
    }
  } catch (err) {
    // Silently ignore telemetry failure - never disrupt user experience or chat flows
  }
}

let isInitialized = false;

export function initTelemetry(): void {
  if (typeof window === 'undefined' || isInitialized) return;
  isInitialized = true;

  window.addEventListener('error', (e) => {
    try {
      const filename = e.filename ? e.filename.split('/').pop() : '';
      sendTelemetry('ERROR', 'EXCEPTION', e.message || 'Uncaught Chat UI Error', {
        file: filename,
        line: e.lineno || 0,
        col: e.colno || 0
      });
    } catch (err) {}
  });

  window.addEventListener('unhandledrejection', (e) => {
    try {
      const reason = e.reason;
      const msg = (reason && (reason.message || String(reason))) || 'Unhandled Promise Rejection';
      sendTelemetry('ERROR', 'EXCEPTION', msg);
    } catch (err) {}
  });

  window.addEventListener('offline', () => {
    sendTelemetry('WARN', 'NETWORK_OFFLINE', 'Chat client network offline');
  });

  window.addEventListener('online', () => {
    sendTelemetry('INFO', 'NETWORK_ONLINE', 'Chat client network online');
  });

  sendTelemetry('INFO', 'PAGE_LOAD', 'Chat SPA client initialized', {
    secure: !!window.isSecureContext,
    screen: `${window.innerWidth}x${window.innerHeight}`
  });
}
