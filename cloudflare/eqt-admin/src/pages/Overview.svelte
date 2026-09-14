<script lang="ts">
  import { onMount } from 'svelte';
  import { adminFetch } from '../lib/api';
  import { t } from '../lib/i18n';
  import type { AdminHealthResponse, AdminTab } from '../lib/types';
  import LicenseGlobeCard from '../components/LicenseGlobeCard.svelte';
  import { tlsState } from '../lib/tls-state.svelte';

  interface Props {
    onNavigate?: (tab: AdminTab, prefillQuery?: string) => void;
  }
  let { onNavigate }: Props = $props();

  interface QuickStats {
    total_licenses: number;
    active_licenses: number;
    today_activations: number;
    total_error_logs: number;
    errors_24h: number;
    db_status: string;
  }

  let stats = $state<QuickStats>({
    total_licenses: 0,
    active_licenses: 0,
    today_activations: 0,
    total_error_logs: 0,
    errors_24h: 0,
    db_status: 'checking...'
  });
  let loading = $state(true);

  async function loadStats() {
    try {
      const data = await adminFetch<AdminHealthResponse>('/api/v1/admin/health?probe=0');
      stats = {
        total_licenses: data.metrics?.total_licenses || 0,
        active_licenses: data.metrics?.active_licenses || 0,
        today_activations: data.metrics?.today_activations || 0,
        total_error_logs: data.metrics?.total_error_logs || 0,
        errors_24h: data.metrics?.errors_24h || 0,
        db_status: data.config?.db_status || 'ok'
      };
    } catch {
      stats.db_status = 'error';
    } finally {
      loading = false;
    }
  }

  function go(tab: AdminTab) {
    onNavigate?.(tab);
  }

  onMount(() => {
    loadStats();
  });
</script>

<div class="page-container">
  <div class="header-row">
    <div>
      <h2>{$t('overview.title')}</h2>
      <p class="subtitle">{$t('overview.subtitle')}</p>
    </div>
  </div>

  <div class="stats-grid">
    <div class="card stat-card">
      <div class="stat-icon">🔑</div>
      <div>
        <div class="stat-num">{loading ? '...' : stats.total_licenses}</div>
        <div class="stat-label">{$t('overview.totalLicenses')} ({$t('common.active')}: {stats.active_licenses})</div>
      </div>
    </div>

    <div class="card stat-card">
      <div class="stat-icon">💻</div>
      <div>
        <div class="stat-num">{loading ? '...' : stats.today_activations}</div>
        <div class="stat-label">{$t('overview.recentActivations')}</div>
      </div>
    </div>

    <div class="card stat-card">
      <div class="stat-icon">⚠️</div>
      <div>
        <div class="stat-num">{loading ? '...' : stats.total_error_logs}</div>
        <div class="stat-label">{$t('errorAudit.title')} (24h: {stats.errors_24h})</div>
      </div>
    </div>

    <div class="card stat-card">
      <div class="stat-icon">⚡</div>
      <div>
        <div class="stat-num">{stats.db_status.toUpperCase()}</div>
        <div class="stat-label">{$t('health.dbStatus')}</div>
      </div>
    </div>

    <div
      class="card stat-card clickable"
      class:stat-card-error={tlsState.alertLevel === 'error'}
      class:stat-card-warn={tlsState.alertLevel === 'warn'}
      onclick={() => go('tls')}
      role="button"
      tabindex="0"
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') go('tls'); }}
      title={$t('tls.subtitle')}
    >
      <div class="stat-icon" class:stat-icon-error={tlsState.alertLevel === 'error'} class:stat-icon-warn={tlsState.alertLevel === 'warn'}>
        🔒
      </div>
      <div>
        <div
          class="stat-num"
          class:success-num={tlsState.alertLevel === 'ok'}
          class:error-num={tlsState.alertLevel === 'error'}
          class:warn-num={tlsState.alertLevel === 'warn'}
        >
          {#if tlsState.loading && !tlsState.data}
            ...
          {:else if tlsState.alertLevel === 'error'}
            {$t('overview.tlsAlert')}
          {:else if tlsState.alertLevel === 'warn'}
            {$t('overview.tlsWarn')}
          {:else}
            {$t('overview.tlsNormal')}
          {/if}
        </div>
        <div class="stat-label">
          {$t('overview.tlsStatus')} ({$t('overview.tls24hProvisions')}: {tlsState.totalSuccess})
        </div>
      </div>
    </div>
  </div>

  <div class="globe-section">
    <LicenseGlobeCard onNavigateToLicense={(code) => onNavigate?.('licenses', code)} />
  </div>
</div>

<style>
  .page-container { display: flex; flex-direction: column; gap: 1.5rem; width: 100%; max-width: 100%; box-sizing: border-box; }
  .header-row { display: flex; justify-content: space-between; align-items: center; }
  h2 { font-size: 1.5rem; font-weight: 700; }
  .subtitle { font-size: 0.875rem; color: var(--text-muted); }

  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.25rem; width: 100%; box-sizing: border-box; }
  .stat-card { display: flex; align-items: center; gap: 1.25rem; padding: 1.5rem; box-sizing: border-box; }
  .clickable {
    cursor: pointer;
    transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .clickable:hover {
    transform: translateY(-2px);
    border-color: rgba(99, 102, 241, 0.4);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  }
  .stat-card-error {
    border-color: rgba(239, 68, 68, 0.4) !important;
    background: rgba(239, 68, 68, 0.05) !important;
  }
  .stat-card-warn {
    border-color: rgba(245, 158, 11, 0.4) !important;
    background: rgba(245, 158, 11, 0.05) !important;
  }
  .stat-icon { font-size: 2.25rem; background: rgba(99, 102, 241, 0.1); padding: 0.75rem; border-radius: var(--radius-md); }
  .stat-icon-error {
    background: rgba(239, 68, 68, 0.15) !important;
  }
  .stat-icon-warn {
    background: rgba(245, 158, 11, 0.15) !important;
  }
  .stat-num { font-size: 1.75rem; font-weight: 800; color: var(--text-primary); }
  .success-num {
    color: #10b981 !important;
  }
  .error-num {
    color: #ef4444 !important;
  }
  .warn-num {
    color: #f59e0b !important;
  }
  .stat-label { font-size: 0.85rem; color: var(--text-muted); }

  .globe-section { width: 100%; max-width: 100%; box-sizing: border-box; overflow: hidden; }
</style>
