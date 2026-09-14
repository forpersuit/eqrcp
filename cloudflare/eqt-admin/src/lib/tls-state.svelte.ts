import { adminFetch } from './api';
import type { AdminTLSCircuitStatusResponse } from './types';

class TLSState {
  data = $state<AdminTLSCircuitStatusResponse | null>(null);
  loading = $state(false);
  lastError = $state<string | null>(null);
  private timer: any = null;

  get primaryState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN' | 'UNKNOWN' {
    return this.data?.circuit_breaker?.state || 'UNKNOWN';
  }

  get backupState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN' | 'UNKNOWN' {
    return this.data?.backup_circuit_breaker?.state || 'UNKNOWN';
  }

  /**
   * Alert level:
   * - 'error': Any circuit breaker is OPEN (tripped)
   * - 'warn': Any circuit breaker is HALF_OPEN (probing) or recent failover events > 0
   * - 'ok': Normal operating state
   */
  get alertLevel(): 'error' | 'warn' | 'ok' {
    if (this.primaryState === 'OPEN' || this.backupState === 'OPEN') {
      return 'error';
    }
    if (
      this.primaryState === 'HALF_OPEN' ||
      this.backupState === 'HALF_OPEN' ||
      (this.data?.metrics_24h?.failover_events ?? 0) > 0
    ) {
      return 'warn';
    }
    return 'ok';
  }

  get totalSuccess(): number {
    return this.data?.metrics_24h?.provisions_success ?? 0;
  }

  get failoverCount(): number {
    return this.data?.metrics_24h?.failover_events ?? 0;
  }

  async fetchStatus() {
    this.loading = true;
    this.lastError = null;
    try {
      this.data = await adminFetch<AdminTLSCircuitStatusResponse>('/api/v1/admin/tls/circuit-status');
    } catch (err: any) {
      this.lastError = err?.message || 'Failed to fetch TLS status';
    } finally {
      this.loading = false;
    }
  }

  startPolling(intervalMs = 30000) {
    if (this.timer) return;
    this.fetchStatus();
    this.timer = setInterval(() => {
      this.fetchStatus();
    }, intervalMs);
  }

  stopPolling() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const tlsState = new TLSState();
