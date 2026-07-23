<script lang="ts">
  import { onMount } from 'svelte';
  import { adminFetch } from '../lib/api';
  import type { AdminHealthResponse, HealthProbeResult } from '../lib/types';

  let health = $state<AdminHealthResponse | null>(null);
  let loading = $state(true);
  let errorMsg = $state('');

  function cfgBadge(ok: boolean | undefined): { cls: string; label: string } {
    if (ok) return { cls: 'active', label: '正常就绪 (CONFIGURED)' };
    return { cls: 'warn', label: '未配置 (NOT CONFIGURED)' };
  }

  function probeBadge(p?: HealthProbeResult): { cls: string; label: string } {
    if (!p) return { cls: 'warn', label: '未返回' };
    if (p.skipped) return { cls: 'warn', label: `跳过 · ${p.error || 'env incomplete'}` };
    if (p.ok) return { cls: 'active', label: `通过 (${p.latency_ms}ms)` };
    return { cls: 'error', label: `失败 (${p.latency_ms}ms)` };
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
      errorMsg = err.message || '诊断服务请求失败';
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
      <h2>发信引擎与系统健康中心</h2>
      <p class="subtitle">
        配置就绪度 + 真探针（SMTP TLS/AUTH、Paddle、D1）与近期履约相关事件
      </p>
    </div>
    <div class="actions">
      <button class="btn btn-secondary" onclick={loadHealth} disabled={loading}>
        {loading ? '诊断中…' : '重新触发诊断探针'}
      </button>
    </div>
  </div>

  {#if errorMsg}
    <div class="error-banner">{errorMsg}</div>
  {/if}

  {#if loading}
    <div class="loading-state">正在诊断系统健康状态（含 SMTP 探针，最长约数秒）...</div>
  {:else if health}
    <div class="metrics-grid">
      <div class="card metric-card">
        <div class="metric-title">全库总授权量</div>
        <div class="metric-value">{health.metrics.total_licenses}</div>
        <div class="metric-desc">
          生效中 {health.metrics.active_licenses ?? '—'} · 今日激活
          {health.metrics.today_activations ?? '—'}
        </div>
      </div>

      <div class="card metric-card">
        <div class="metric-title">异常日志</div>
        <div class="metric-value" class:warn={health.metrics.total_error_logs > 0}>
          {health.metrics.total_error_logs}
        </div>
        <div class="metric-desc">24h 内 {health.metrics.errors_24h ?? '—'} 条</div>
      </div>

      <div class="card metric-card">
        <div class="metric-title">总体状态</div>
        <div class="metric-value status-text">
          <span class={`badge badge-${health.status === 'healthy' ? 'active' : 'warn'}`}>
            {(health.status || 'unknown').toUpperCase()}
          </span>
        </div>
        <div class="metric-desc">D1: {health.config.db_status}</div>
      </div>
    </div>

    <div class="card health-section">
      <h3>真探针结果 (probes)</h3>
      <div class="probe-list">
        <div class="probe-item">
          <div>
            <div class="probe-name">SMTP TLS + AUTH</div>
            <div class="probe-desc">
              465 TLS 连接 · EHLO · AUTH LOGIN · QUIT
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
            <div class="probe-name">Paddle</div>
            <div class="probe-desc">
              mode: {health.probes?.paddle?.mode || '—'}
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
            <div class="probe-name">D1 SELECT 1</div>
            <div class="probe-desc">
              {#if health.probes?.db?.error && !health.probes.db.ok}
                <span class="err-inline">{health.probes.db.error}</span>
              {:else}
                存储层即时探测
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
      <h3>环境配置就绪度 (config)</h3>
      <div class="probe-list">
        <div class="probe-item">
          <div>
            <div class="probe-name">SMTP 发信 env</div>
            <div class="probe-desc">MAIL_SENDER / SERVER / PASSWORD</div>
          </div>
          <span class={`badge badge-${cfgBadge(health.config.smtp_configured).cls}`}>
            {cfgBadge(health.config.smtp_configured).label}
          </span>
        </div>
        <div class="probe-item">
          <div>
            <div class="probe-name">Paddle Webhook Secret</div>
            <div class="probe-desc">PADDLE_WEBHOOK_SECRET</div>
          </div>
          <span class={`badge badge-${cfgBadge(paddleOk(health)).cls}`}>
            {cfgBadge(paddleOk(health)).label}
          </span>
        </div>
        <div class="probe-item">
          <div>
            <div class="probe-name">R2_PUBLIC_URL</div>
            <div class="probe-desc">更新产物下载节点</div>
          </div>
          <span class={`badge badge-${cfgBadge(health.config.r2_configured).cls}`}>
            {cfgBadge(health.config.r2_configured).label}
          </span>
        </div>
        <div class="probe-item">
          <div>
            <div class="probe-name">Ed25519 / Admin Secret</div>
            <div class="probe-desc">签名私钥与管理端密钥</div>
          </div>
          <span class={`badge badge-${cfgBadge(health.config.ed25519_key_configured && health.config.admin_secret_configured).cls}`}>
            Ed25519: {health.config.ed25519_key_configured ? 'OK' : 'NO'} · Admin:
            {health.config.admin_secret_configured ? 'OK' : 'NO'}
          </span>
        </div>
      </div>
    </div>

    <div class="card health-section">
      <h3>近期 Webhook / 发信相关事件</h3>
      <p class="section-hint">
        来自 system_error_logs（PADDLE_* / SMTP_*）。成功履约默认不落库；此为故障时间线代理。
      </p>
      {#if !health.recent_events?.length}
        <div class="empty-inline">暂无近期相关事件</div>
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

  .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.25rem; }
  .metric-card { padding: 1.5rem; }
  .metric-title { font-size: 0.85rem; color: var(--text-muted); }
  .metric-value { font-size: 2rem; font-weight: 800; color: var(--accent-primary); margin: 0.5rem 0 0.25rem; }
  .metric-value.warn { color: var(--accent-warning); }
  .metric-desc { font-size: 0.75rem; color: var(--text-secondary); }

  .health-section { display: flex; flex-direction: column; gap: 1rem; margin-top: 0.25rem; }
  .section-hint { font-size: 0.8rem; color: var(--text-muted); margin: 0; }
  .probe-list { display: flex; flex-direction: column; gap: 1rem; }
  .probe-item {
    display: flex; justify-content: space-between; align-items: center; gap: 1rem;
    padding: 1rem; background: rgba(15, 23, 42, 0.4); border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
  }
  .probe-name { font-weight: 600; color: var(--text-primary); font-size: 0.95rem; }
  .probe-desc { font-size: 0.8rem; color: var(--text-muted); margin-top: 0.2rem; }
  .err-inline { color: #fca5a5; }

  .events-list { display: flex; flex-direction: column; gap: 0.5rem; }
  .event-row {
    display: grid;
    grid-template-columns: auto auto 1fr auto;
    gap: 0.75rem;
    align-items: center;
    padding: 0.65rem 0.75rem;
    background: rgba(15, 23, 42, 0.35);
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
  }
  .cat { color: var(--accent-primary); font-family: var(--font-mono); }
  .msg { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ts { color: var(--text-muted); white-space: nowrap; }
  .empty-inline { color: var(--text-muted); font-size: 0.85rem; padding: 0.5rem 0; }

  .loading-state { text-align: center; padding: 3rem; color: var(--text-muted); }
  .error-banner {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.4);
    color: #fca5a5;
    padding: 0.75rem;
    border-radius: var(--radius-sm);
  }
</style>
