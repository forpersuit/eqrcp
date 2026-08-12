<script lang="ts">
  import { onMount } from 'svelte';
  import { adminFetch } from '../lib/api';
  import type { AdminHealthResponse, AdminTab } from '../lib/types';
  import LicenseGlobeCard from '../components/LicenseGlobeCard.svelte';

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
      <h2>控制台全局概览</h2>
      <p class="subtitle">欢迎来到 EQT 运维管理系统，快速监控全站运营状态与实时 3D 全球激活分布视界</p>
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

  <!-- Replace quick-links card with LicenseGlobeCard -->
  <div class="globe-section">
    <LicenseGlobeCard />
  </div>
</div>

<style>
  .page-container { display: flex; flex-direction: column; gap: 1.5rem; width: 100%; max-width: 100%; box-sizing: border-box; }
  .header-row { display: flex; justify-content: space-between; align-items: center; }
  h2 { font-size: 1.5rem; font-weight: 700; }
  .subtitle { font-size: 0.875rem; color: var(--text-muted); }

  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1.25rem; width: 100%; box-sizing: border-box; }
  .stat-card { display: flex; align-items: center; gap: 1.25rem; padding: 1.5rem; box-sizing: border-box; }
  .stat-icon { font-size: 2.25rem; background: rgba(99, 102, 241, 0.1); padding: 0.75rem; border-radius: var(--radius-md); }
  .stat-num { font-size: 1.75rem; font-weight: 800; color: var(--text-primary); }
  .stat-label { font-size: 0.85rem; color: var(--text-muted); }

  .globe-section { width: 100%; max-width: 100%; box-sizing: border-box; overflow: hidden; }
</style>
