<script lang="ts">
  import { onMount } from 'svelte';
  import { adminFetch } from '../lib/api';

  interface LogEntry {
    id: number;
    level: string;
    category: string;
    error_message: string;
    context_json: string | null;
    created_at: string;
  }

  let logs = $state<LogEntry[]>([]);
  let loading = $state(true);
  let errorMsg = $state('');
  let filterCategory = $state('ALL');
  let searchKeyword = $state('');
  let selectedLog = $state<LogEntry | null>(null);

  async function loadLogs() {
    loading = true;
    errorMsg = '';
    try {
      const data = await adminFetch('/api/v1/admin/error-logs?limit=100');
      logs = data.logs || [];
    } catch (err: any) {
      errorMsg = err.message || '加载日志失败';
    } finally {
      loading = false;
    }
  }

  async function clearLogs() {
    if (!confirm('确定要清空所有系统错误日志吗？此操作无法撤销。')) return;
    try {
      await adminFetch('/api/v1/admin/error-logs', { method: 'DELETE' });
      await loadLogs();
    } catch (err: any) {
      alert('清空日志失败: ' + err.message);
    }
  }

  const filteredLogs = $derived(
    logs.filter((log) => {
      const matchCat = filterCategory === 'ALL' || log.category === filterCategory;
      const matchKw =
        !searchKeyword.trim() ||
        log.error_message.toLowerCase().includes(searchKeyword.toLowerCase()) ||
        log.category.toLowerCase().includes(searchKeyword.toLowerCase()) ||
        (log.context_json && log.context_json.toLowerCase().includes(searchKeyword.toLowerCase()));
      return matchCat && matchKw;
    })
  );

  const categories = $derived([
    'ALL',
    ...Array.from(new Set(logs.map((l) => l.category)))
  ]);

  onMount(() => {
    loadLogs();
  });
</script>

<div class="page-container">
  <div class="header-row">
    <div>
      <h2>错误审计中心</h2>
      <p class="subtitle">Cloudflare D1 system_error_logs 实时控制台</p>
    </div>
    <div class="actions">
      <button class="btn btn-secondary" onclick={loadLogs} disabled={loading}>
        刷新日志
      </button>
      <button class="btn btn-danger" onclick={clearLogs} disabled={loading || logs.length === 0}>
        清空旧日志
      </button>
    </div>
  </div>

  <div class="filter-bar card">
    <div class="filter-group">
      <label for="cat-select">分类筛选:</label>
      <select id="cat-select" class="input select-input" bind:value={filterCategory}>
        {#each categories as cat}
          <option value={cat}>{cat}</option>
        {/each}
      </select>
    </div>
    <div class="filter-group search-group">
      <label for="kw-input">搜索关键词:</label>
      <input
        id="kw-input"
        type="text"
        class="input"
        placeholder="搜索堆栈、Category 或 Email..."
        bind:value={searchKeyword}
      />
    </div>
  </div>

  {#if errorMsg}
    <div class="error-banner">{errorMsg}</div>
  {/if}

  {#if loading}
    <div class="loading-state">正在拉取 D1 审计日志...</div>
  {:else if filteredLogs.length === 0}
    <div class="empty-state card">暂无符合条件的错误审计日志</div>
  {:else}
    <div class="logs-list">
      {#each filteredLogs as log (log.id)}
        <div
          class="log-card card"
          class:critical={log.level === 'CRITICAL'}
          onclick={() => (selectedLog = log)}
          role="button"
          tabindex="0"
          onkeydown={(e) => e.key === 'Enter' && (selectedLog = log)}
        >
          <div class="log-top">
            <span class={`badge badge-${log.level.toLowerCase()}`}>{log.level}</span>
            <span class="category-tag">{log.category}</span>
            <span class="timestamp">{new Date(log.created_at).toLocaleString()}</span>
          </div>
          <div class="log-message">
            {log.error_message}
          </div>
          {#if log.context_json}
            <div class="log-footer">
              <span class="context-hint">包含 JSON 上下文信息 (点击查看详情)</span>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if selectedLog}
  <div class="modal-overlay" onclick={() => (selectedLog = null)} role="presentation">
    <div class="modal-content" onclick={(e) => e.stopPropagation()} role="dialog">
      <div class="modal-header">
        <h3>错误日志详情 #{selectedLog.id}</h3>
        <span class={`badge badge-${selectedLog.level.toLowerCase()}`}>{selectedLog.level}</span>
      </div>
      
      <div class="detail-section">
        <label>发生时间:</label>
        <div>{new Date(selectedLog.created_at).toLocaleString()}</div>
      </div>

      <div class="detail-section">
        <label>分类 (Category):</label>
        <div>{selectedLog.category}</div>
      </div>

      <div class="detail-section">
        <label>异常信息:</label>
        <pre class="code-block">{selectedLog.error_message}</pre>
      </div>

      {#if selectedLog.context_json}
        <div class="detail-section">
          <label>上下文 JSON (Context):</label>
          <pre class="code-block json-block">{selectedLog.context_json}</pre>
        </div>
      {/if}

      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={() => (selectedLog = null)}>关闭</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .page-container {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  h2 { font-size: 1.5rem; font-weight: 700; }
  .subtitle { font-size: 0.875rem; color: var(--text-muted); }

  .actions { display: flex; gap: 0.75rem; }

  .filter-bar {
    display: flex;
    gap: 1.5rem;
    align-items: center;
    padding: 1rem 1.5rem;
  }

  .filter-group {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .filter-group label {
    font-size: 0.85rem;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .search-group { flex: 1; }

  .select-input {
    width: 200px;
    background: var(--bg-surface);
  }

  .logs-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .log-card {
    cursor: pointer;
    transition: transform 0.15s ease, border-color 0.15s ease;
  }

  .log-card:hover {
    transform: translateY(-2px);
    border-color: var(--border-color-highlight);
  }

  .log-card.critical {
    border-left: 4px solid var(--accent-critical);
  }

  .log-top {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }

  .category-tag {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    color: var(--accent-primary);
    background: rgba(99, 102, 241, 0.1);
    padding: 0.15rem 0.5rem;
    border-radius: var(--radius-sm);
  }

  .timestamp {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-left: auto;
  }

  .log-message {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    color: var(--text-primary);
    word-break: break-all;
  }

  .log-footer {
    margin-top: 0.5rem;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .loading-state, .empty-state {
    text-align: center;
    padding: 3rem;
    color: var(--text-muted);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.25rem;
  }

  .detail-section {
    margin-bottom: 1rem;
  }

  .detail-section label {
    font-size: 0.8rem;
    color: var(--text-muted);
    display: block;
    margin-bottom: 0.25rem;
  }

  .code-block {
    background: #090d16;
    padding: 0.85rem;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.85rem;
    color: #e2e8f0;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 1.5rem;
  }

  .error-banner {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.4);
    color: #fca5a5;
    padding: 0.75rem;
    border-radius: var(--radius-sm);
  }
</style>
