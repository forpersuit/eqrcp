<script lang="ts">
  import { onMount } from 'svelte';
  import { adminFetch } from '../lib/api';

  interface HealthData {
    success: boolean;
    status: string;
    timestamp: string;
    metrics: {
      total_licenses: number;
      total_error_logs: number;
    };
    config: {
      smtp_configured: boolean;
      paddle_configured: boolean;
      r2_configured: boolean;
      db_status: string;
    };
  }

  let health = $state<HealthData | null>(null);
  let loading = $state(true);
  let errorMsg = $state('');

  async function loadHealth() {
    loading = true;
    errorMsg = '';
    try {
      health = await adminFetch<HealthData>('/api/v1/admin/health');
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
      <p class="subtitle">SMTP TLS 握手状态、Paddle 履约监控与基础设施诊断</p>
    </div>
    <div class="actions">
      <button class="btn btn-secondary" onclick={loadHealth} disabled={loading}>
        重新触发诊断探针
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
        <div class="metric-desc">Cloudflare D1 licenses 记录</div>
      </div>

      <div class="card metric-card">
        <div class="metric-title">累计异常日志数</div>
        <div class="metric-value" class:warn={health.metrics.total_error_logs > 0}>
          {health.metrics.total_error_logs}
        </div>
        <div class="metric-desc">system_error_logs 积压</div>
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
      <h3>核心服务配置与探针诊断</h3>
      
      <div class="probe-list">
        <div class="probe-item">
          <div>
            <div class="probe-name">SMTP 发信服务器 (MAIL_SEND_SERVER)</div>
            <div class="probe-desc">465 端口 TLS 加密握手与邮箱验证码/授权发信管道</div>
          </div>
          <span class={`badge badge-${health.config.smtp_configured ? 'active' : 'warn'}`}>
            {health.config.smtp_configured ? '正常就绪 (CONFIGURED)' : '未配置 (NOT CONFIGURED)'}
          </span>
        </div>

        <div class="probe-item">
          <div>
            <div class="probe-name">Paddle 履约 Webhook 密钥 (PADDLE_WEBHOOK_SECRET)</div>
            <div class="probe-desc">Paddle 支付回调签名校验与自动化履约发码引擎</div>
          </div>
          <span class={`badge badge-${health.config.paddle_configured ? 'active' : 'warn'}`}>
            {health.config.paddle_configured ? '正常就绪 (CONFIGURED)' : '未配置 (NOT CONFIGURED)'}
          </span>
        </div>

        <div class="probe-item">
          <div>
            <div class="probe-name">R2 对象存储服务 (R2_PUBLIC_URL)</div>
            <div class="probe-desc">自动更新文件与编译产物下载节点</div>
          </div>
          <span class={`badge badge-${health.config.r2_configured ? 'active' : 'warn'}`}>
            {health.config.r2_configured ? '已连接 (CONFIGURED)' : '未绑定 (NOT CONFIGURED)'}
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
  .probe-item { display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: rgba(15, 23, 42, 0.4); border-radius: var(--radius-sm); border: 1px solid var(--border-color); }
  .probe-name { font-weight: 600; color: var(--text-primary); font-size: 0.95rem; }
  .probe-desc { font-size: 0.8rem; color: var(--text-muted); margin-top: 0.2rem; }

  .loading-state { text-align: center; padding: 3rem; color: var(--text-muted); }
  .error-banner { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; padding: 0.75rem; border-radius: var(--radius-sm); }
</style>
