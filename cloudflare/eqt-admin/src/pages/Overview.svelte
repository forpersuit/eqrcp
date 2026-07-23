<script lang="ts">
  import { onMount } from 'svelte';
  import { adminFetch } from '../lib/api';

  interface QuickStats {
    total_licenses: number;
    total_error_logs: number;
    db_status: string;
  }

  let stats = $state<QuickStats>({ total_licenses: 0, total_error_logs: 0, db_status: 'checking...' });
  let loading = $state(true);

  async function loadStats() {
    try {
      const data = await adminFetch('/api/v1/admin/health');
      stats = {
        total_licenses: data.metrics?.total_licenses || 0,
        total_error_logs: data.metrics?.total_error_logs || 0,
        db_status: data.config?.db_status || 'ok'
      };
    } catch {
      stats.db_status = 'error';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadStats();
  });
</script>

<div class="page-container">
  <div class="header-row">
    <div>
      <h2>控制台全局概览</h2>
      <p class="subtitle">欢迎来到 EQT 运维管理系统，快速监控全站运营状态</p>
    </div>
  </div>

  <div class="stats-grid">
    <div class="card stat-card">
      <div class="stat-icon">🔑</div>
      <div>
        <div class="stat-num">{loading ? '...' : stats.total_licenses}</div>
        <div class="stat-label">已发放全库授权总数</div>
      </div>
    </div>

    <div class="card stat-card">
      <div class="stat-icon">⚠️</div>
      <div>
        <div class="stat-num">{loading ? '...' : stats.total_error_logs}</div>
        <div class="stat-label">待排查系统异常日志</div>
      </div>
    </div>

    <div class="card stat-card">
      <div class="stat-icon">⚡</div>
      <div>
        <div class="stat-num">{stats.db_status.toUpperCase()}</div>
        <div class="stat-label">Cloudflare D1 数据库状态</div>
      </div>
    </div>
  </div>

  <div class="quick-links card">
    <h3>核心业务模块快捷入口</h3>
    <div class="links-grid">
      <div class="link-card">
        <h4>🚨 错误审计中心</h4>
        <p>实时排查 D1 system_error_logs，高亮查看 CRITICAL 堆栈与上下文信息。</p>
      </div>

      <div class="link-card">
        <h4>🎫 授权码与订单管控</h4>
        <p>支持按邮箱/码/交易号全库检索、手动发码、吊销作废与绑定设备管理。</p>
      </div>

      <div class="link-card">
        <h4>🌐 发信引擎与系统健康</h4>
        <p>检测 465 端口 SMTP TLS 握手状态与 Paddle Webhook 回调履约管道。</p>
      </div>
    </div>
  </div>
</div>

<style>
  .page-container { display: flex; flex-direction: column; gap: 1.5rem; }
  .header-row { display: flex; justify-content: space-between; align-items: center; }
  h2 { font-size: 1.5rem; font-weight: 700; }
  .subtitle { font-size: 0.875rem; color: var(--text-muted); }

  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.25rem; }
  .stat-card { display: flex; align-items: center; gap: 1.25rem; padding: 1.5rem; }
  .stat-icon { font-size: 2.25rem; background: rgba(99, 102, 241, 0.1); padding: 0.75rem; border-radius: var(--radius-md); }
  .stat-num { font-size: 1.75rem; font-weight: 800; color: var(--text-primary); }
  .stat-label { font-size: 0.85rem; color: var(--text-muted); }

  .quick-links { display: flex; flex-direction: column; gap: 1rem; margin-top: 0.5rem; }
  .links-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; }
  .link-card { background: rgba(15, 23, 42, 0.4); padding: 1.25rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color); }
  .link-card h4 { font-size: 1.05rem; font-weight: 600; color: var(--accent-primary); margin-bottom: 0.5rem; }
  .link-card p { font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5; }
</style>
