<script lang="ts">
  import { onMount } from 'svelte';
  import { adminFetch } from '../lib/api';
  import type { AdminHealthResponse } from '../lib/types';

  let health = $state<AdminHealthResponse | null>(null);
  let loading = $state(true);
  let errorMsg = $state('');

  function cfgBadge(ok: boolean | undefined): { cls: string; label: string } {
    if (ok) return { cls: 'active', label: '正常就绪 (CONFIGURED)' };
    return { cls: 'warn', label: '未配置 (NOT CONFIGURED)' };
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
        环境配置就绪度与 D1 KPI（当前为 env 布尔徽章，非 SMTP TLS 真探针）
      </p>
    </div>
    <div class="actions">
      <button class="btn btn-secondary" onclick={loadHealth} disabled={loading}>
        刷新诊断
      </button>
    </div>
  </div>

  {#if errorMsg}
    <div class="error-banner">{errorMsg}</div>
  {/if}

  {#if loading}
    <div class="loading-state">正在诊断系统健康状态...</div>
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
        <div class="metric-title">D1 数据库连接</div>
        <div class="metric-value status-text">
          <span class={`badge badge-${health.config.db_status === 'ok' ? 'active' : 'error'}`}>
            {health.config.db_status.toUpperCase()}
          </span>
        </div>
        <div class="metric-desc">存储层 SQL 响应度</div>
      </div>
    </div>

    <div class="card health-section">
      <h3>核心服务配置就绪度</h3>

      <div class="probe-list">
        <div class="probe-item">
          <div>
            <div class="probe-name">SMTP 发信 (MAIL_SENDER / SERVER)</div>
            <div class="probe-desc">邮箱验证码与授权通知管道（配置是否齐全）</div>
          </div>
          <span class={`badge badge-${cfgBadge(health.config.smtp_configured).cls}`}>
            {cfgBadge(health.config.smtp_configured).label}
          </span>
        </div>

        <div class="probe-item">
          <div>
            <div class="probe-name">Paddle Webhook (PADDLE_WEBHOOK_SECRET)</div>
            <div class="probe-desc">支付回调签名校验与自动履约</div>
          </div>
          <span class={`badge badge-${cfgBadge(paddleOk(health)).cls}`}>
            {cfgBadge(paddleOk(health)).label}
          </span>
        </div>

        <div class="probe-item">
          <div>
            <div class="probe-name">R2 公共 URL (R2_PUBLIC_URL)</div>
            <div class="probe-desc">自动更新产物下载节点</div>
          </div>
          <span class={`badge badge-${cfgBadge(health.config.r2_configured).cls}`}>
            {cfgBadge(health.config.r2_configured).label}
          </span>
        </div>

        <div class="probe-item">
          <div>
            <div class="probe-name">Ed25519 签名私钥</div>
            <div class="probe-desc">客户端激活证书签发</div>
          </div>
          <span class={`badge badge-${cfgBadge(health.config.ed25519_key_configured).cls}`}>
            {cfgBadge(health.config.ed25519_key_configured).label}
          </span>
        </div>

        <div class="probe-item">
          <div>
            <div class="probe-name">Admin Secret</div>
            <div class="probe-desc">管理端鉴权密钥是否已配置</div>
          </div>
          <span class={`badge badge-${cfgBadge(health.config.admin_secret_configured).cls}`}>
            {cfgBadge(health.config.admin_secret_configured).label}
          </span>
        </div>
      </div>
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

  .health-section { display: flex; flex-direction: column; gap: 1.25rem; margin-top: 0.5rem; }
  .probe-list { display: flex; flex-direction: column; gap: 1rem; }
  .probe-item { display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: rgba(15, 23, 42, 0.4); border-radius: var(--radius-sm); border: 1px solid var(--border-color); gap: 1rem; }
  .probe-name { font-weight: 600; color: var(--text-primary); font-size: 0.95rem; }
  .probe-desc { font-size: 0.8rem; color: var(--text-muted); margin-top: 0.2rem; }

  .loading-state { text-align: center; padding: 3rem; color: var(--text-muted); }
  .error-banner { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; padding: 0.75rem; border-radius: var(--radius-sm); }
</style>
