<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { adminFetch } from '../lib/api';
  import { t } from '../lib/i18n';
  import Banner from './Banner.svelte';
  import TLSResetModal from './TLSResetModal.svelte';
  import type { AdminTLSCircuitStatusResponse } from '../lib/types';

  let data = $state<AdminTLSCircuitStatusResponse | null>(null);
  let loading = $state(true);
  let errorMsg = $state('');
  let successBanner = $state('');
  let resetModalOpen = $state(false);
  let autoRefresh = $state(true);
  let timer: any = null;

  async function loadData() {
    errorMsg = '';
    try {
      data = await adminFetch<AdminTLSCircuitStatusResponse>('/api/v1/admin/tls/circuit-status');
    } catch (err: any) {
      errorMsg = err.message || $t('common.failed');
    } finally {
      loading = false;
    }
  }

  function handleResetSuccess(msg: string) {
    successBanner = msg;
    loadData();
    setTimeout(() => {
      successBanner = '';
    }, 5000);
  }

  function formatSuccessRate(rate: number | null): string {
    if (rate === null || rate === undefined) return '--';
    return (rate * 100).toFixed(1) + '%';
  }

  function formatDuration(ms: number | null): string {
    if (!ms || ms <= 0) return '--';
    return ms.toFixed(1) + ' ms';
  }

  function circuitBadge(state?: string): { cls: string; label: string; icon: string } {
    if (state === 'CLOSED') {
      return { cls: 'badge-active', label: $t('tls.stateClosed'), icon: '🟢' };
    }
    if (state === 'HALF_OPEN') {
      return { cls: 'badge-warn', label: $t('tls.stateHalfOpen'), icon: '🟡' };
    }
    if (state === 'OPEN') {
      return { cls: 'badge-error', label: $t('tls.stateOpen'), icon: '🔴' };
    }
    return { cls: 'badge-secondary', label: state || $t('common.unknown'), icon: '⚪' };
  }

  onMount(() => {
    loadData();
    timer = setInterval(() => {
      if (autoRefresh) {
        loadData();
      }
    }, 30000);
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
  });
</script>

<div class="card tls-card">
  <div class="tls-header">
    <div class="title-group">
      <div class="title-row">
        <span class="tls-icon">🔒</span>
        <h3>{$t('tls.title')}</h3>
      </div>
      <p class="tls-subtitle">{$t('tls.subtitle')}</p>
    </div>

    <div class="tls-actions">
      <label class="auto-refresh-toggle" title="每 30 秒自动刷新">
        <input type="checkbox" bind:checked={autoRefresh} />
        <span>{$t('licenses.autoRefresh')}</span>
      </label>

      <button type="button" class="btn btn-secondary btn-sm" onclick={loadData} disabled={loading}>
        {loading ? $t('common.loading') : $t('common.refresh')}
      </button>

      <button type="button" class="btn btn-break-glass btn-sm" onclick={() => { resetModalOpen = true; }}>
        {$t('tls.resetBtn')}
      </button>
    </div>
  </div>

  <Banner type="error" message={errorMsg} />
  <Banner type="ok" message={successBanner} />

  {#if loading && !data}
    <div class="loading-state">{$t('common.loading')}</div>
  {:else if data}
    <!-- Status & Watermark Row -->
    <div class="telemetry-grid">
      <!-- Circuit Breaker State -->
      <div class="telemetry-block circuit-block">
        <div class="block-header">
          <span class="block-title">{$t('tls.circuitStatus')}</span>
          <span class="badge {circuitBadge(data.circuit_breaker?.state).cls}">
            {circuitBadge(data.circuit_breaker?.state).icon} {circuitBadge(data.circuit_breaker?.state).label}
          </span>
        </div>

        <div class="state-details">
          <div class="state-item">
            <span class="item-label">{$t('tls.successCount')}</span>
            <span class="item-val success-val">{data.circuit_breaker?.success_count ?? 0}</span>
          </div>
          <div class="state-item">
            <span class="item-label">{$t('tls.failureCount')}</span>
            <span class="item-val" class:error-val={(data.circuit_breaker?.failure_count ?? 0) > 0}>
              {data.circuit_breaker?.failure_count ?? 0}
            </span>
          </div>
          <div class="state-item">
            <span class="item-label">{$t('tls.lastRetryAfter')}</span>
            <span class="item-val">{data.circuit_breaker?.last_retry_after ? data.circuit_breaker.last_retry_after + 's' : '0s'}</span>
          </div>
        </div>

        {#if data.circuit_breaker?.cooldown_until}
          <div class="cooldown-banner">
            ⏱️ {$t('tls.cooldownUntil')}: <code>{data.circuit_breaker.cooldown_until}</code>
          </div>
        {/if}
      </div>

      <!-- Token Bucket Watermark -->
      <div class="telemetry-block token-block">
        <div class="block-header">
          <span class="block-title">{$t('tls.tokenBucket')}</span>
          <span class="watermark-badge">
            {(data.token_bucket?.tokens ?? 0).toFixed(1)} / {data.token_bucket?.capacity ?? 5}
          </span>
        </div>

        <div class="watermark-bar-track">
          <div
            class="watermark-bar-fill"
            style="width: {Math.min(100, Math.max(0, ((data.token_bucket?.tokens ?? 0) / (data.token_bucket?.capacity || 5)) * 100))}%"
          ></div>
        </div>

        <div class="token-meta">
          <span>{$t('tls.refillRate')}: {((data.token_bucket?.refill_rate ?? 0.1667) * 60).toFixed(0)}/min</span>
          <span>Key: <code>{data.token_bucket?.key || 'acme_smoothing'}</code></span>
        </div>
      </div>
    </div>

    <!-- 24h Metrics KPI Cards -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">{$t('tls.totalAttempts')}</div>
        <div class="kpi-num">{data.metrics_24h?.total_attempts ?? 0}</div>
        <div class="kpi-sub">近 24 小时总发起</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">{$t('tls.provisionsSuccess')}</div>
        <div class="kpi-num success-num">{data.metrics_24h?.provisions_success ?? 0}</div>
        <div class="kpi-sub">
          {$t('tls.successRate')}: <strong>{formatSuccessRate(data.metrics_24h?.success_rate)}</strong>
        </div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">{$t('tls.avgDuration')}</div>
        <div class="kpi-num">{formatDuration(data.metrics_24h?.avg_duration_ms)}</div>
        <div class="kpi-sub">RFC 8555 闭环平均时延</div>
      </div>
    </div>

    <!-- Trip Attribution Breakdown (Constraint 1) -->
    <div class="attribution-box">
      <div class="attribution-header">
        <span class="attribution-title">{$t('tls.tripReasons')}</span>
        <span class="attribution-hint">根据系统错误审计精准归因，杜绝误判</span>
      </div>

      <div class="reasons-pills">
        <div class="reason-pill" class:has-trips={(data.metrics_24h?.trip_reasons?.ca_rate_limited ?? 0) > 0}>
          <span class="pill-name">{$t('tls.rateLimited')} (429)</span>
          <span class="pill-count">{data.metrics_24h?.trip_reasons?.ca_rate_limited ?? 0}</span>
        </div>

        <div class="reason-pill" class:has-trips={(data.metrics_24h?.trip_reasons?.ca_5xx_error ?? 0) > 0}>
          <span class="pill-name">{$t('tls.serverError')} (5xx)</span>
          <span class="pill-count">{data.metrics_24h?.trip_reasons?.ca_5xx_error ?? 0}</span>
        </div>

        <div class="reason-pill" class:has-trips={(data.metrics_24h?.trip_reasons?.other_cert_errors ?? 0) > 0}>
          <span class="pill-name">{$t('tls.otherErrors')}</span>
          <span class="pill-count">{data.metrics_24h?.trip_reasons?.other_cert_errors ?? 0}</span>
        </div>

        <div class="reason-pill" class:has-hits={(data.metrics_24h?.rate_limit_hits ?? 0) > 0}>
          <span class="pill-name">{$t('tls.rateLimitHits')}</span>
          <span class="pill-count">{data.metrics_24h?.rate_limit_hits ?? 0}</span>
        </div>
      </div>
    </div>
  {/if}
</div>

<TLSResetModal
  open={resetModalOpen}
  onclose={() => { resetModalOpen = false; }}
  onSuccess={handleResetSuccess}
/>

<style>
  .tls-card {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding: 1.5rem;
    background: var(--card-bg, rgba(255, 255, 255, 0.03));
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg, 12px);
  }

  .tls-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .title-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .tls-icon {
    font-size: 1.25rem;
  }

  h3 {
    font-size: 1.25rem;
    font-weight: 700;
    margin: 0;
    color: var(--text-primary);
  }

  .tls-subtitle {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin: 0;
  }

  .tls-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .auto-refresh-toggle {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.8rem;
    color: var(--text-muted);
    cursor: pointer;
    user-select: none;
  }

  .btn-break-glass {
    background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%);
    color: #fff;
    border: none;
    font-weight: 700;
    box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);
    cursor: pointer;
    border-radius: var(--radius-md, 6px);
    padding: 0.4rem 0.85rem;
  }

  .btn-break-glass:hover {
    background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.45);
  }

  .telemetry-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1rem;
  }

  .telemetry-block {
    padding: 1rem 1.25rem;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: var(--radius-md, 8px);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .block-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .block-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .state-details {
    display: flex;
    gap: 1.5rem;
  }

  .state-item {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .item-label {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .item-val {
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .success-val {
    color: #10b981;
  }

  .error-val {
    color: #ef4444;
  }

  .cooldown-banner {
    font-size: 0.75rem;
    background: rgba(239, 68, 68, 0.15);
    color: #fca5a5;
    padding: 0.4rem 0.6rem;
    border-radius: 4px;
    border: 1px solid rgba(239, 68, 68, 0.25);
  }

  .watermark-badge {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--accent-primary, #6366f1);
  }

  .watermark-bar-track {
    width: 100%;
    height: 8px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    overflow: hidden;
  }

  .watermark-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #6366f1 0%, #3b82f6 100%);
    border-radius: 4px;
    transition: width 0.3s ease;
  }

  .token-meta {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .token-meta code {
    background: rgba(0, 0, 0, 0.3);
    padding: 1px 4px;
    border-radius: 3px;
  }

  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1rem;
  }

  .kpi-card {
    padding: 1rem;
    background: rgba(0, 0, 0, 0.18);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: var(--radius-md, 8px);
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .kpi-label {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .kpi-num {
    font-size: 1.5rem;
    font-weight: 800;
    color: var(--text-primary);
  }

  .success-num {
    color: #10b981;
  }

  .kpi-sub {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .kpi-sub strong {
    color: #10b981;
  }

  .attribution-box {
    padding: 1rem;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: var(--radius-md, 8px);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .attribution-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .attribution-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .attribution-hint {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .reasons-pills {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .reason-pill {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.75rem;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 20px;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .pill-count {
    font-weight: 700;
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.1);
    padding: 1px 6px;
    border-radius: 10px;
    font-size: 0.75rem;
  }

  .reason-pill.has-trips {
    background: rgba(239, 68, 68, 0.12);
    border-color: rgba(239, 68, 68, 0.3);
    color: #fca5a5;
  }

  .reason-pill.has-trips .pill-count {
    background: #ef4444;
    color: #fff;
  }

  .reason-pill.has-hits {
    background: rgba(245, 158, 11, 0.12);
    border-color: rgba(245, 158, 11, 0.3);
    color: #fcd34d;
  }

  .reason-pill.has-hits .pill-count {
    background: #f59e0b;
    color: #fff;
  }

  .badge-active {
    background: rgba(16, 185, 129, 0.2);
    color: #10b981;
    border: 1px solid rgba(16, 185, 129, 0.3);
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .badge-warn {
    background: rgba(245, 158, 11, 0.2);
    color: #f59e0b;
    border: 1px solid rgba(245, 158, 11, 0.3);
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .badge-error {
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.3);
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
  }
</style>
