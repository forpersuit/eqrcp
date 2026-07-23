<script lang="ts">
  import { onMount } from 'svelte';
  import { adminFetch } from '../lib/api';
  import type { SystemErrorLog } from '../lib/types';

  let logs = $state<SystemErrorLog[]>([]);
  let total = $state(0);
  let page = $state(1);
  const pageSize = 50;
  let loading = $state(true);
  let errorMsg = $state('');
  let actionMsg = $state('');
  let filterLevel = $state('ALL');
  let filterCategory = $state('ALL');
  let searchKeyword = $state('');
  let selectedLog = $state<SystemErrorLog | null>(null);
  let showClearConfirm = $state(false);
  let clearing = $state(false);

  async function loadLogs() {
    loading = true;
    errorMsg = '';
    const offset = (page - 1) * pageSize;
    try {
      const data = await adminFetch<{ logs: SystemErrorLog[]; total: number }>('/api/v1/admin/error-logs', {
        params: {
          level: filterLevel,
          category: filterCategory,
          q: searchKeyword,
          limit: String(pageSize),
          offset: String(offset)
        }
      });
      logs = data.logs || [];
      total = data.total || logs.length;
    } catch (err: any) {
      errorMsg = err.message || '加载日志失败';
    } finally {
      loading = false;
    }
  }

  function handleFilterChange() {
    page = 1;
    loadLogs();
  }

  function prevPage() {
    if (page > 1) {
      page--;
      loadLogs();
    }
  }

  function nextPage() {
    if (page * pageSize < total) {
      page++;
      loadLogs();
    }
  }

  async function clearLogs() {
    clearing = true;
    errorMsg = '';
    actionMsg = '';
    try {
      await adminFetch('/api/v1/admin/error-logs', { method: 'DELETE' });
      showClearConfirm = false;
      actionMsg = '系统错误日志已清空';
      page = 1;
      await loadLogs();
    } catch (err: any) {
      errorMsg = '清空日志失败: ' + (err.message || String(err));
    } finally {
      clearing = false;
    }
  }

  const categories = [
    'ALL',
    'SERVER_EXCEPTION',
    'PADDLE_WEBHOOK',
    'PADDLE_API_ERROR',
    'SMTP_EMAIL_FAIL',
    'SMTP_ERROR',
    'AUTH_ERROR'
  ];

  onMount(() => {
    loadLogs();
  });
</script>

<div class="page-container">
  <div class="header-row">
    <div>
      <h2>错误审计中心</h2>
      <p class="subtitle">Cloudflare D1 system_error_logs 实时控制台 (共 {total} 条)</p>
    </div>
    <div class="actions">
      <button class="btn btn-secondary" onclick={loadLogs} disabled={loading}>
        刷新日志
      </button>
      <button
        class="btn btn-danger"
        onclick={() => (showClearConfirm = true)}
        disabled={loading || total === 0}
      >
        清空旧日志
      </button>
    </div>
  </div>

  <div class="filter-bar card">
    <div class="filter-group">
      <label for="level-select">级别筛选:</label>
      <select id="level-select" class="input select-input" bind:value={filterLevel} onchange={handleFilterChange}>
        <option value="ALL">全部 (ALL)</option>
        <option value="ERROR">ERROR</option>
        <option value="WARN">WARN</option>
        <option value="CRITICAL">CRITICAL</option>
      </select>
    </div>
    <div class="filter-group">
      <label for="cat-select">分类筛选:</label>
      <select id="cat-select" class="input select-input" bind:value={filterCategory} onchange={handleFilterChange}>
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
        placeholder="输入关键词按回车搜索..."
        bind:value={searchKeyword}
        onkeydown={(e) => e.key === 'Enter' && handleFilterChange()}
      />
      <button class="btn btn-secondary btn-sm" onclick={handleFilterChange}>搜索</button>
    </div>
  </div>

  {#if errorMsg}
    <div class="error-banner">{errorMsg}</div>
  {/if}
  {#if actionMsg}
    <div class="ok-banner">{actionMsg}</div>
  {/if}

  {#if loading}
    <div class="loading-state">正在拉取 D1 审计日志...</div>
  {:else if logs.length === 0}
    <div class="empty-state card">暂无符合条件的错误审计日志</div>
  {:else}
    <div class="logs-list">
      {#each logs as log (log.id)}
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

    <!-- Pagination Bar -->
    <div class="pagination-bar card">
      <button class="btn btn-secondary btn-sm" disabled={page <= 1 || loading} onclick={prevPage}>
        上一页
      </button>
      <span class="page-info">
        第 {page} 页 / 共 {Math.ceil(total / pageSize) || 1} 页 (第 {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, total)} 条，共 {total} 条)
      </span>
      <button class="btn btn-secondary btn-sm" disabled={page * pageSize >= total || loading} onclick={nextPage}>
        下一页
      </button>
    </div>
  {/if}
</div>

{#if selectedLog}
  <div class="modal-overlay" onclick={() => (selectedLog = null)} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="modal-content" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" tabindex="-1" aria-modal="true">
      <div class="modal-header">
        <h3>错误日志详情 #{selectedLog.id}</h3>
        <span class={`badge badge-${selectedLog.level.toLowerCase()}`}>{selectedLog.level}</span>
      </div>
      
      <div class="detail-section">
        <span class="detail-label">发生时间:</span>
        <div>{new Date(selectedLog.created_at).toLocaleString()}</div>
      </div>

      <div class="detail-section">
        <span class="detail-label">分类 (Category):</span>
        <div>{selectedLog.category}</div>
      </div>

      <div class="detail-section">
        <span class="detail-label">异常信息:</span>
        <pre class="code-block">{selectedLog.error_message}</pre>
      </div>

      {#if selectedLog.context_json}
        <div class="detail-section">
          <span class="detail-label">上下文 JSON (Context):</span>
          <pre class="code-block json-block">{selectedLog.context_json}</pre>
        </div>
      {/if}

      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={() => (selectedLog = null)}>关闭</button>
      </div>
    </div>
  </div>
{/if}

{#if showClearConfirm}
  <div class="modal-overlay" onclick={() => (showClearConfirm = false)} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="modal-content" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" tabindex="-1" aria-modal="true">
      <h3 style="color: var(--accent-danger);">确认清空错误日志</h3>
      <p class="confirm-text">
        确定要清空 <strong>全部</strong> system_error_logs 吗？此操作无法撤销。
      </p>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={() => (showClearConfirm = false)} disabled={clearing}>取消</button>
        <button class="btn btn-danger" onclick={clearLogs} disabled={clearing}>
          {clearing ? '清空中...' : '确认清空'}
        </button>
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

  .detail-section .detail-label {
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

  .ok-banner {
    background: rgba(16, 185, 129, 0.12);
    border: 1px solid rgba(16, 185, 129, 0.35);
    color: #6ee7b7;
    padding: 0.75rem;
    border-radius: var(--radius-sm);
  }

  .confirm-text {
    margin: 1rem 0;
    color: var(--text-secondary);
    line-height: 1.6;
  }
</style>
