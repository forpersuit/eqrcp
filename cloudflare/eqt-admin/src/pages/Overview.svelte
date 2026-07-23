<script lang="ts">
  import { onMount } from 'svelte';
  import { adminFetch } from '../lib/api';
  import type { AdminHealthResponse, AdminTab } from '../lib/types';

  interface Props {
    onNavigate?: (tab: AdminTab) => void;
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
      const data = await adminFetch<AdminHealthResponse>('/api/v1/admin/health');
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
      <h2>控制台全局概览</h2>
      <p class="subtitle">欢迎来到 EQT 运维管理系统，快速监控全站运营状态与实时 KPI</p>
    </div>
  </div>

  <div class="stats-grid">
    <div class="card stat-card">
      <div class="stat-icon">🔑</div>
      <div>
        <div class="stat-num">{loading ? '...' : stats.total_licenses}</div>
        <div class="stat-label">全库授权总数（生效中: {stats.active_licenses}）</div>
      </div>
    </div>

    <div class="card stat-card">
      <div class="stat-icon">💻</div>
      <div>
        <div class="stat-num">{loading ? '...' : stats.today_activations}</div>
        <div class="stat-label">今日新增客户端设备激活数</div>
      </div>
    </div>

    <div class="card stat-card">
      <div class="stat-icon">⚠️</div>
      <div>
        <div class="stat-num">{loading ? '...' : stats.total_error_logs}</div>
        <div class="stat-label">待排查异常日志（24h内: {stats.errors_24h}）</div>
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
      <button type="button" class="link-card" onclick={() => go('audit')}>
        <h4>🚨 错误审计中心</h4>
        <p>实时排查 D1 system_error_logs，高亮查看 CRITICAL 堆栈与上下文信息。</p>
      </button>

      <button type="button" class="link-card" onclick={() => go('ops')}>
        <h4>📋 操作审计轨迹</h4>
        <p>追溯管理员发码、吊销、解绑与清空日志等高危写操作及来源 IP。</p>
      </button>

      <button type="button" class="link-card" onclick={() => go('licenses')}>
        <h4>🎫 授权码与订单管控</h4>
        <p>支持按邮箱/码/交易号全库检索、手动发码、吊销作废与绑定设备管理。</p>
      </button>

      <button type="button" class="link-card" onclick={() => go('health')}>
        <h4>🌐 发信引擎与系统健康</h4>
        <p>SMTP/Paddle 真探针、配置就绪度与近期履约相关事件时间线。</p>
      </button>
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
  .link-card {
    background: rgba(15, 23, 42, 0.4);
    padding: 1.25rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
    text-align: left;
    cursor: pointer;
    font-family: inherit;
    color: inherit;
    transition: border-color 0.15s ease, background 0.15s ease;
  }
  .link-card:hover {
    border-color: rgba(99, 102, 241, 0.5);
    background: rgba(99, 102, 241, 0.08);
  }
  .link-card h4 { font-size: 1.05rem; font-weight: 600; color: var(--accent-primary); margin-bottom: 0.5rem; }
  .link-card p { font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5; }
</style>
