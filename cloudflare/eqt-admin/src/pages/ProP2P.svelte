<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { adminFetch } from '../lib/api';
  import type { P2PConnection, P2PConnectionsResponse } from '../lib/types';

  let connections = $state<P2PConnection[]>([]);
  let loading = $state(true);
  let errorMsg = $state<string | null>(null);
  let filterMode = $state<'all' | 'cross_border'>('all');
  let autoRefresh = $state(true);
  let timer: any = null;
  let iframeRef: HTMLIFrameElement | null = $state(null);

  let totalActive = $derived(connections.length);
  let crossBorderCount = $derived(connections.filter(c => c.is_cross_border).length);
  let domesticCount = $derived(totalActive - crossBorderCount);

  let filteredConnections = $derived(
    filterMode === 'cross_border' 
      ? connections.filter(c => c.is_cross_border)
      : connections
  );

  async function loadConnections() {
    try {
      errorMsg = null;
      const res = await adminFetch<P2PConnectionsResponse>('/api/v1/p2p/admin/connections');
      if (res && Array.isArray(res.connections)) {
        connections = [...res.connections];
      }
    } catch (err: any) {
      errorMsg = err.message || '获取 P2P 会话失败';
    } finally {
      loading = false;
    }
  }

  async function destroyRoom(roomId: string) {
    try {
      await adminFetch(`/api/v1/p2p/admin/room?room_id=${roomId}`, { method: 'DELETE' });
      await loadConnections();
    } catch (err: any) {
      errorMsg = '销毁房间失败: ' + (err.message || '未知错误');
    }
  }

  function formatTime(timestampMs: number): string {
    if (!timestampMs) return '-';
    return new Date(timestampMs).toLocaleString('zh-CN', {
      hour12: false,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  function formatRemaining(expiresAtMs: number): string {
    const diffSec = Math.floor((expiresAtMs - Date.now()) / 1000);
    if (diffSec <= 0) return '即将过期';
    const m = Math.floor(diffSec / 60);
    const s = diffSec % 60;
    return `${m}分${s}秒`;
  }

  onMount(() => {
    loadConnections();
    timer = setInterval(() => {
      if (autoRefresh) loadConnections();
    }, 5000);
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
  });
</script>

<div class="page-container">
  <div class="header-section">
    <div>
      <h1 class="page-title">🚀 EQT Pro P2P 实时直连中心</h1>
      <p class="page-subtitle">独立 Cloudflare Worker (eqt-p2p-signal) 全球 3D WebRTC 广域网信令拓扑大屏</p>
    </div>
    <div class="action-bar">
      <label class="toggle-label">
        <input type="checkbox" bind:checked={autoRefresh} />
        实时轮询 (5s)
      </label>
      <button class="btn btn-primary" onclick={loadConnections} disabled={loading}>
        {loading ? '刷新中...' : '🔄 刷新会话'}
      </button>
    </div>
  </div>

  {#if errorMsg}
    <div class="alert alert-error">
      ⚠️ 错误: {errorMsg}
    </div>
  {/if}

  <!-- KPI Badges -->
  <div class="stats-grid">
    <div class="stat-card blue">
      <div class="stat-value">{totalActive}</div>
      <div class="stat-label">全球活跃 P2P 房间</div>
    </div>
    <div class="stat-card purple">
      <div class="stat-value">{crossBorderCount}</div>
      <div class="stat-label">跨国 P2P 传输会话</div>
    </div>
    <div class="stat-card green">
      <div class="stat-value">{domesticCount}</div>
      <div class="stat-label">同国 P2P 传输会话</div>
    </div>
    <div class="stat-card cyan">
      <div class="stat-value">OK</div>
      <div class="stat-label">Worker 节点 (signal.eqt.net.im)</div>
    </div>
  </div>

  <!-- Embedded 3D Globe Visualization Screen -->
  <div class="card globe-card">
    <div class="card-header">
      <h3>🌐 3D 实时拓扑与全球节点流动大屏</h3>
      <span class="badge badge-info">WebGL 硬件加速</span>
    </div>
    <div class="globe-wrapper">
      <iframe
        src="/p2p-globe.html"
        title="3D P2P Connection Globe"
        class="globe-iframe"
        bind:this={iframeRef}
      ></iframe>
    </div>
  </div>

  <!-- Active Rooms Table -->
  <div class="card">
    <div class="card-header flex-between">
      <h3>📋 活跃信令房间控制台 ({filteredConnections.length})</h3>
      <div class="filter-group">
        <button
          class="btn btn-sm"
          class:btn-active={filterMode === 'all'}
          onclick={() => filterMode = 'all'}
        >
          全部房间 ({totalActive})
        </button>
        <button
          class="btn btn-sm"
          class:btn-active={filterMode === 'cross_border'}
          onclick={() => filterMode = 'cross_border'}
        >
          仅跨国 ({crossBorderCount})
        </button>
      </div>
    </div>

    {#if loading && connections.length === 0}
      <div class="loading-state">加载 P2P 实时连接数据中...</div>
    {:else if filteredConnections.length === 0}
      <div class="empty-state">
        <p>📡 当前暂无活跃的 P2P 传输房间</p>
      </div>
    {:else}
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>房间 ID (Room)</th>
              <th>Host (发起方)</th>
              <th>Client (接收方)</th>
              <th>会话类型</th>
              <th>创建时间</th>
              <th>剩余租约</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredConnections as conn (conn.room_id)}
              <tr>
                <td><code class="code-badge">{conn.room_id}</code></td>
                <td>
                  <div class="node-info">
                    <span class="flag">{conn.host.country}</span>
                    <span>{conn.host.ip}</span>
                  </div>
                </td>
                <td>
                  {#if conn.client}
                    <div class="node-info">
                      <span class="flag">{conn.client.country}</span>
                      <span>{conn.client.ip}</span>
                    </div>
                  {:else}
                    <span class="text-muted">等待客户端加入...</span>
                  {/if}
                </td>
                <td>
                  {#if conn.is_cross_border}
                    <span class="badge badge-purple">🌐 跨国 P2P</span>
                  {:else}
                    <span class="badge badge-success">🏠 同国 P2P</span>
                  {/if}
                </td>
                <td>{formatTime(conn.created_at)}</td>
                <td>
                  <span class="timer-tag">{formatRemaining(conn.expires_at)}</span>
                </td>
                <td>
                  <button
                    class="btn btn-xs btn-danger"
                    onclick={() => destroyRoom(conn.room_id)}
                  >
                    💥 强制断开
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>

<style>
  .page-container {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .header-section {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .page-title {
    font-size: 1.75rem;
    font-weight: 800;
    color: var(--text-primary);
  }

  .page-subtitle {
    font-size: 0.9rem;
    color: var(--text-secondary);
    margin-top: 0.25rem;
  }

  .action-bar {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1.25rem;
  }

  .stat-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .stat-card.blue { border-top: 3px solid #38bdf8; }
  .stat-card.purple { border-top: 3px solid #a855f7; }
  .stat-card.green { border-top: 3px solid #22c55e; }
  .stat-card.cyan { border-top: 3px solid #06b6d4; }

  .stat-value {
    font-size: 2rem;
    font-weight: 800;
    color: var(--text-primary);
  }

  .stat-label {
    font-size: 0.85rem;
    color: var(--text-secondary);
  }

  .globe-card {
    padding: 0;
    overflow: hidden;
  }

  .card-header {
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid var(--border-color);
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .flex-between {
    justify-content: space-between;
  }

  .card-header h3 {
    font-size: 1.1rem;
    font-weight: 700;
    margin: 0;
  }

  .globe-wrapper {
    width: 100%;
    height: 480px;
    background: #020617;
  }

  .globe-iframe {
    width: 100%;
    height: 100%;
    border: none;
  }

  .filter-group {
    display: flex;
    gap: 0.5rem;
  }

  .btn-sm {
    padding: 0.4rem 0.8rem;
    font-size: 0.8rem;
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .btn-sm.btn-active {
    background: rgba(99, 102, 241, 0.2);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
    font-weight: 600;
  }

  .table-wrapper {
    overflow-x: auto;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }

  .data-table th,
  .data-table td {
    padding: 1rem 1.25rem;
    text-align: left;
    border-bottom: 1px solid var(--border-color);
  }

  .data-table th {
    background: rgba(255, 255, 255, 0.02);
    color: var(--text-secondary);
    font-weight: 600;
  }

  .code-badge {
    font-family: monospace;
    background: rgba(255, 255, 255, 0.06);
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    color: #38bdf8;
    font-weight: 600;
  }

  .node-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .flag {
    font-weight: 700;
    background: rgba(255, 255, 255, 0.1);
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    font-size: 0.75rem;
  }

  .badge {
    padding: 0.25rem 0.6rem;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .badge-purple { background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3); }
  .badge-success { background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); }
  .badge-info { background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); }

  .timer-tag {
    color: var(--text-secondary);
    font-size: 0.85rem;
  }

  .text-muted {
    color: var(--text-secondary);
    font-style: italic;
  }

  .btn-xs {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    border-radius: 4px;
  }

  .btn-danger {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.3);
    cursor: pointer;
  }

  .btn-danger:hover {
    background: #ef4444;
    color: white;
  }

  .loading-state, .empty-state {
    padding: 3rem;
    text-align: center;
    color: var(--text-secondary);
  }

  .alert {
    padding: 1rem;
    border-radius: var(--radius-sm);
    font-size: 0.9rem;
  }

  .alert-error {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #ef4444;
  }
</style>
