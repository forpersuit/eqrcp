<script lang="ts">
  import { onMount } from 'svelte';
  import { adminFetch } from '../lib/api';
  import { t } from '../lib/i18n';
  import type { AdminMetricsResponse } from '../lib/types';

  let metrics = $state<AdminMetricsResponse | null>(null);
  let loading = $state(true);
  let errorMsg = $state('');

  async function loadMetrics() {
    loading = true;
    errorMsg = '';
    try {
      metrics = await adminFetch<AdminMetricsResponse>('/api/v1/admin/metrics');
    } catch (err: any) {
      errorMsg = err.message || $t('metrics.loadFailed');
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadMetrics();
  });

  // Compute max count for tier bar scaling
  function maxTierCount(): number {
    if (!metrics?.metrics.tier_distribution.length) return 1;
    return Math.max(...metrics.metrics.tier_distribution.map(t => t.count), 1);
  }

  // Compute max crash count for bar scaling
  function maxCrashCount(): number {
    if (!metrics?.metrics.crash_trend.length) return 1;
    return Math.max(...metrics.metrics.crash_trend.map(c => c.count), 1);
  }

  function formatRate(rate: number | null): string {
    if (rate === null) return '--';
    return rate.toFixed(2) + '%';
  }
</script>

<div class="page-container">
  <div class="header-row">
    <div>
      <h2>{$t('metrics.title')}</h2>
      <p class="subtitle">{$t('metrics.refreshes')}</p>
    </div>
    <div class="actions">
      <button class="btn btn-secondary" onclick={loadMetrics} disabled={loading}>
        {loading ? $t('common.loading') : $t('metrics.refreshData')}
      </button>
    </div>
  </div>

  {#if errorMsg}
    <div class="error-banner">{errorMsg}</div>
  {/if}

  {#if loading}
    <div class="loading-state">{$t('common.loading')}</div>
  {:else if metrics}
    <!-- KPI Row -->
    <div class="metrics-grid">
      <div class="card metric-card">
        <div class="metric-title">{$t('metrics.dailyActiveDevices')}</div>
        <div class="metric-value">{metrics.metrics.daily_active_devices}</div>
        <div class="metric-desc">{$t('metrics.last24h')}</div>
      </div>

      <div class="card metric-card">
        <div class="metric-title">{$t('metrics.activationSuccessRate')}</div>
        <div class="metric-value" class:warn={metrics.metrics.activation_success_rate !== null && metrics.metrics.activation_success_rate < 95}>
          {formatRate(metrics.metrics.activation_success_rate)}
        </div>
        <div class="metric-desc">{$t('metrics.last7d')}</div>
      </div>

      <div class="card metric-card">
        <div class="metric-title">{$t('metrics.rateLimitHits')}</div>
        <div class="metric-value" class:warn={metrics.metrics.rate_limit_hits_24h > 0}>
          {metrics.metrics.rate_limit_hits_24h}
        </div>
        <div class="metric-desc">{$t('metrics.last24h')}</div>
      </div>
    </div>

    <!-- Tier Distribution -->
    <div class="card section-card">
      <h3 class="section-title">{$t('metrics.tierDistribution')}</h3>
      {#if metrics.metrics.tier_distribution.length > 0}
        <div class="bar-chart">
          {#each metrics.metrics.tier_distribution as item}
            <div class="bar-row">
              <span class="bar-label">{item.tier || $t('common.unknown')}</span>
              <div class="bar-track">
                <div
                  class="bar-fill"
                  style="width: {(item.count / maxTierCount()) * 100}%"
                ></div>
              </div>
              <span class="bar-value">{item.count}</span>
            </div>
          {/each}
        </div>
      {:else}
        <p class="no-data">{$t('metrics.noData')}</p>
      {/if}
    </div>

    <!-- Crash Trend -->
    <div class="card section-card">
      <h3 class="section-title">{$t('metrics.crashTrend')}</h3>
      {#if metrics.metrics.crash_trend.length > 0}
        <div class="crash-table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>{$t('metrics.tableDate')}</th>
                <th>{$t('metrics.tableCrashes')}</th>
                <th>{$t('metrics.tableTrend')}</th>
              </tr>
            </thead>
            <tbody>
              {#each metrics.metrics.crash_trend as item}
                <tr>
                  <td>{item.date}</td>
                  <td>{item.count}</td>
                  <td>
                    <div class="mini-bar-track">
                      <div
                        class="mini-bar-fill"
                        style="width: {(item.count / maxCrashCount()) * 100}%"
                      ></div>
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="no-data">{$t('metrics.noData')}</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1.25rem;
    margin-bottom: 1.5rem;
  }

  .metric-card {
    padding: 1.5rem;
  }

  .metric-title {
    font-size: 0.85rem;
    color: var(--text-secondary);
    margin-bottom: 0.5rem;
    font-weight: 500;
  }

  .metric-value {
    font-size: 2.2rem;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.1;
    margin-bottom: 0.4rem;
  }

  .metric-value.warn {
    color: var(--accent-warning);
  }

  .metric-desc {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .section-card {
    padding: 1.5rem;
    margin-bottom: 1.25rem;
  }

  .section-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 1rem 0;
  }

  .bar-chart {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .bar-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .bar-label {
    width: 80px;
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--text-primary);
    flex-shrink: 0;
  }

  .bar-track {
    flex: 1;
    height: 24px;
    background: var(--bg-surface-hover);
    border-radius: 4px;
    overflow: hidden;
  }

  .bar-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent-primary), #818cf8);
    border-radius: 4px;
    transition: width 0.3s ease;
    min-width: 2px;
  }

  .bar-value {
    width: 50px;
    text-align: right;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-primary);
    flex-shrink: 0;
  }

  .crash-table-wrapper {
    overflow-x: auto;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }

  .data-table th {
    text-align: left;
    padding: 0.6rem 0.75rem;
    color: var(--text-secondary);
    font-weight: 600;
    border-bottom: 1px solid var(--border-color);
  }

  .data-table td {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--border-color);
    color: var(--text-primary);
  }

  .mini-bar-track {
    width: 120px;
    height: 14px;
    background: var(--bg-surface-hover);
    border-radius: 3px;
    overflow: hidden;
  }

  .mini-bar-fill {
    height: 100%;
    background: var(--accent-warning);
    border-radius: 3px;
    transition: width 0.3s ease;
    min-width: 2px;
  }

  .no-data {
    color: var(--text-muted);
    font-size: 0.9rem;
    text-align: center;
    padding: 1.5rem 0;
  }

  .loading-state {
    text-align: center;
    padding: 3rem 0;
    color: var(--text-secondary);
  }

  .error-banner {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #f87171;
    padding: 0.75rem 1rem;
    border-radius: var(--radius-sm);
    margin-bottom: 1rem;
    font-size: 0.9rem;
  }

  .header-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1.5rem;
  }

  .header-row h2 {
    margin: 0;
    font-size: 1.35rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .subtitle {
    margin: 0.25rem 0 0 0;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .actions {
    display: flex;
    gap: 0.5rem;
  }
</style>
