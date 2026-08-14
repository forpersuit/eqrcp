<script lang="ts">
  import { onMount } from 'svelte';
  import { adminFetch } from '../lib/api';
  import { t } from '../lib/i18n';
  import Banner from '../components/Banner.svelte';
  import type { AdminHealthResponse, HealthProbeResult } from '../lib/types';

  let health = $state<AdminHealthResponse | null>(null);
  let loading = $state(true);
  let errorMsg = $state('');

  function cfgBadge(ok: boolean | undefined): { cls: string; label: string } {
    if (ok) return { cls: 'active', label: $t('health.configured') };
    return { cls: 'warn', label: $t('health.notConfigured') };
  }

  function probeBadge(p?: HealthProbeResult): { cls: string; label: string } {
    if (!p) return { cls: 'warn', label: '—' };
    if (p.skipped) return { cls: 'warn', label: $t('health.probeSkipped', { reason: p.error || 'env' }) };
    if (p.ok) return { cls: 'active', label: $t('health.probeOk', { ms: p.latency_ms }) };
    return { cls: 'error', label: $t('health.probeFailed', { ms: p.latency_ms }) };
  }

  function paddleOk(h: AdminHealthResponse): boolean {
    return Boolean(h.config.paddle_configured ?? h.config.paddle_webhook_configured);
  }

  async function loadHealth() {
    loading = true;
    errorMsg = '';
    try {
      health = await adminFetch<AdminHealthResponse>('/api/v1/admin/health');
    } catch (err: any) {
      errorMsg = err.message || $t('common.failed');
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadHealth();
  });
</script>

<div class="page-container">
  <div class="header-row">
    <div>
      <h2>{$t('health.title')}</h2>
      <p class="subtitle">{$t('health.subtitle')}</p>
    </div>
    <div class="actions">
      <button class="btn btn-secondary btn-sm" onclick={loadHealth} disabled={loading}>
        {loading ? $t('common.loading') : $t('common.refresh')}
      </button>
    </div>
  </div>

  <Banner type="error" message={errorMsg} />

  {#if loading}
    <div class="loading-state">{$t('common.loading')}</div>
  {:else if health}
    <div class="metrics-grid">
      <div class="card metric-card">
        <div class="metric-title">{$t('overview.totalLicenses')}</div>
        <div class="metric-value">{health.metrics.total_licenses}</div>
        <div class="metric-desc">
          {$t('common.active')} {health.metrics.active_licenses ?? '—'} · {$t('overview.recentActivations')} {health.metrics.today_activations ?? '—'}
        </div>
      </div>

      <div class="card metric-card">
        <div class="metric-title">{$t('errorAudit.title')}</div>
        <div class="metric-value" class:warn={health.metrics.total_error_logs > 0}>
          {health.metrics.total_error_logs}
        </div>
        <div class="metric-desc">24h: {health.metrics.errors_24h ?? '—'}</div>
      </div>

      <div class="card metric-card">
        <div class="metric-title">{$t('health.serviceStatus')}</div>
        <div class="metric-value status-text">
          <span class={`badge badge-${health.status === 'healthy' ? 'active' : 'warn'}`}>
            {health.status === 'healthy' ? $t('health.overallHealthy') : (health.status || 'unknown').toUpperCase()}
          </span>
        </div>
        <div class="metric-desc">{$t('health.dbStatus')}: {health.config.db_status}</div>
      </div>
    </div>

    <div class="card health-section">
      <h3>{$t('health.probesTitle')}</h3>
      <div class="probe-list">
        <div class="probe-item">
          <div>
            <div class="probe-name">{$t('health.probeSmtpTitle')}</div>
            <div class="probe-desc">
              {$t('health.probeSmtpDesc')}
              {#if health.probes?.smtp?.error && !health.probes.smtp.ok}
                <span class="err-inline"> — {health.probes.smtp.error}</span>
              {/if}
            </div>
          </div>
          <span class={`badge badge-${probeBadge(health.probes?.smtp).cls}`}>
            {probeBadge(health.probes?.smtp).label}
          </span>
        </div>
        <div class="probe-item">
          <div>
            <div class="probe-name">{$t('health.probePaddleTitle')}</div>
            <div class="probe-desc">
              {$t('health.probePaddleDesc', { mode: health.probes?.paddle?.mode || '—' })}
              {#if health.probes?.paddle?.error && !health.probes.paddle.ok}
                <span class="err-inline"> — {health.probes.paddle.error}</span>
              {/if}
            </div>
          </div>
          <span class={`badge badge-${probeBadge(health.probes?.paddle).cls}`}>
            {probeBadge(health.probes?.paddle).label}
          </span>
        </div>
        <div class="probe-item">
          <div>
            <div class="probe-name">{$t('health.probeDbTitle')}</div>
            <div class="probe-desc">
              {#if health.probes?.db?.error && !health.probes.db.ok}
                <span class="err-inline">{health.probes.db.error}</span>
              {:else}
                {$t('health.dbStatus')}
              {/if}
            </div>
          </div>
          <span class={`badge badge-${probeBadge(health.probes?.db).cls}`}>
            {probeBadge(health.probes?.db).label}
          </span>
        </div>
      </div>
    </div>

    <div class="card health-section">
      <h3>{$t('health.configTitle')}</h3>
      <div class="probe-list">
        <div class="probe-item">
          <div>
            <div class="probe-name">{$t('health.cfgSmtpTitle')}</div>
            <div class="probe-desc">{$t('health.cfgSmtpDesc')}</div>
          </div>
          <span class={`badge badge-${cfgBadge(health.config.smtp_configured).cls}`}>
            {cfgBadge(health.config.smtp_configured).label}
          </span>
        </div>
        <div class="probe-item">
          <div>
            <div class="probe-name">{$t('health.cfgPaddleTitle')}</div>
            <div class="probe-desc">{$t('health.cfgPaddleDesc')}</div>
          </div>
          <span class={`badge badge-${cfgBadge(paddleOk(health)).cls}`}>
            {cfgBadge(paddleOk(health)).label}
          </span>
        </div>
        <div class="probe-item">
          <div>
            <div class="probe-name">{$t('health.cfgR2Title')}</div>
            <div class="probe-desc">{$t('health.cfgR2Desc')}</div>
          </div>
          <span class={`badge badge-${cfgBadge(health.config.r2_configured).cls}`}>
            {cfgBadge(health.config.r2_configured).label}
          </span>
        </div>
        <div class="probe-item">
          <div>
            <div class="probe-name">{$t('health.cfgSecurityTitle')}</div>
            <div class="probe-desc">{$t('health.cfgSecurityDesc')}</div>
          </div>
          <span class={`badge badge-${cfgBadge(!!health.config.ed25519_key_configured && !!health.config.access_configured).cls}`}>
            Ed25519: {health.config.ed25519_key_configured ? 'OK' : 'NO'} · Access: {health.config.access_configured ? 'OK' : 'NO'}
          </span>
        </div>
      </div>
    </div>

    <div class="card health-section">
      <h3>{$t('health.recentEventsTitle')}</h3>
      <p class="section-hint">
        {$t('health.recentEventsHint')}
      </p>
      {#if !health.recent_events?.length}
        <div class="empty-inline">{$t('common.none')}</div>
      {:else}
        <div class="events-list">
          {#each health.recent_events as ev (ev.id)}
            <div class="event-row">
              <span class={`badge badge-${String(ev.level).toLowerCase()}`}>{ev.level}</span>
              <span class="cat">{ev.category}</span>
              <span class="msg">{ev.error_message}</span>
              <span class="ts">{new Date(ev.created_at).toLocaleString()}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .page-container { display: flex; flex-direction: column; gap: 1.5rem; }
  .header-row { display: flex; justify-content: space-between; align-items: center; }
  h2 { font-size: 1.5rem; font-weight: 700; }
  .subtitle { font-size: 0.875rem; color: var(--text-muted); }
  .actions { display: flex; gap: 0.75rem; }

  .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.25rem; }
  .metric-card { padding: 1.25rem; }
  .metric-title { font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 0.5rem; }
  .metric-value { font-size: 1.75rem; font-weight: 700; color: var(--text-primary); }
  .metric-value.warn { color: var(--accent-warning); }
  .metric-desc { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.35rem; }

  .health-section { padding: 1.5rem; }
  .health-section h3 { margin: 0 0 1rem; font-size: 1.05rem; }
  .section-hint { font-size: 0.8rem; color: var(--text-muted); margin: -0.5rem 0 1rem; }

  .probe-list { display: flex; flex-direction: column; gap: 0.85rem; }
  .probe-item { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 0; border-bottom: 1px solid var(--border-color); }
  .probe-item:last-child { border-bottom: none; }
  .probe-name { font-weight: 600; font-size: 0.9rem; }
  .probe-desc { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.2rem; }
  .err-inline { color: var(--accent-danger); }

  .events-list { display: flex; flex-direction: column; gap: 0.5rem; }
  .event-row { display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0; font-size: 0.85rem; border-bottom: 1px solid var(--border-color); }
  .event-row:last-child { border-bottom: none; }
  .cat { font-family: var(--font-mono); font-size: 0.75rem; color: var(--accent-primary); }
  .msg { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: 0.8rem; }
  .ts { font-size: 0.75rem; color: var(--text-muted); white-space: nowrap; }

  .loading-state, .empty-inline { text-align: center; padding: 2rem; color: var(--text-muted); }
</style>
