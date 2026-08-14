<script lang="ts">
  import { onMount } from 'svelte';
  import { adminFetch } from '../lib/api';
  import { t } from '../lib/i18n';
  import type { SystemErrorLog } from '../lib/types';
  import Modal from '../components/Modal.svelte';
  import Pagination from '../components/Pagination.svelte';
  import Banner from '../components/Banner.svelte';

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
      errorMsg = err.message || $t('common.failed');
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
      actionMsg = `${$t('errorAudit.clearTitle')} ${$t('common.success')}`;
      page = 1;
      await loadLogs();
    } catch (err: any) {
      errorMsg = $t('common.failed') + ': ' + (err.message || String(err));
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
      <h2>{$t('errorAudit.title')}</h2>
      <p class="subtitle">{$t('errorAudit.subtitle', { total })}</p>
    </div>
    <div class="actions">
      <button class="btn btn-secondary btn-sm" onclick={loadLogs} disabled={loading}>
        {$t('errorAudit.refreshBtn')}
      </button>
      <button
        class="btn btn-danger btn-sm"
        onclick={() => (showClearConfirm = true)}
        disabled={loading || total === 0}
      >
        {$t('errorAudit.clearBtn')}
      </button>
    </div>
  </div>

  <div class="filter-bar card">
    <div class="filter-group">
      <label for="level-select">{$t('errorAudit.levelFilter')}</label>
      <select id="level-select" class="input select-input" bind:value={filterLevel} onchange={handleFilterChange}>
        <option value="ALL">{$t('common.all')} (ALL)</option>
        <option value="ERROR">ERROR</option>
        <option value="WARN">WARN</option>
        <option value="CRITICAL">CRITICAL</option>
      </select>
    </div>
    <div class="filter-group">
      <label for="cat-select">{$t('errorAudit.categoryFilter')}</label>
      <select id="cat-select" class="input select-input" bind:value={filterCategory} onchange={handleFilterChange}>
        {#each categories as cat}
          <option value={cat}>{cat === 'ALL' ? $t('common.all') : cat}</option>
        {/each}
      </select>
    </div>
    <div class="filter-group search-group">
      <label for="kw-input">{$t('opsAudit.filterKeyword')}</label>
      <div class="search-input-wrap">
        <input
          id="kw-input"
          type="text"
          class="input"
          placeholder={$t('errorAudit.searchPlaceholder')}
          bind:value={searchKeyword}
          onkeydown={(e) => e.key === 'Enter' && handleFilterChange()}
        />
        <button class="search-icon-btn" onclick={handleFilterChange} title={$t('common.search')} aria-label={$t('common.search')}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </button>
      </div>
    </div>
  </div>

  <Banner type="error" message={errorMsg} />
  <Banner type="ok" message={actionMsg} />

  {#if loading}
    <div class="loading-state">{$t('common.loading')}</div>
  {:else if logs.length === 0}
    <div class="empty-state card">{$t('errorAudit.emptyState')}</div>
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
              <span class="context-hint">{$t('errorAudit.hasContext')}</span>
            </div>
          {/if}
        </div>
      {/each}
    </div>

    <!-- Pagination Bar -->
    <Pagination {page} {pageSize} {total} {loading} onprev={prevPage} onnext={nextPage} />
  {/if}
</div>

{#if selectedLog}
  <Modal open={true} title={$t('errorAudit.detailTitle', { id: selectedLog.id })} maxWidth="650px" onclose={() => (selectedLog = null)}>
    <div class="detail-section">
      <span class="detail-label">{$t('common.status')}:</span>
      <div><span class={`badge badge-${selectedLog.level.toLowerCase()}`}>{selectedLog.level}</span></div>
    </div>
    
    <div class="detail-section">
      <span class="detail-label">{$t('common.time')}:</span>
      <div>{new Date(selectedLog.created_at).toLocaleString()}</div>
    </div>

    <div class="detail-section">
      <span class="detail-label">{$t('common.summary')}:</span>
      <div>{selectedLog.category}</div>
    </div>

    <div class="detail-section">
      <span class="detail-label">{$t('common.details')}:</span>
      <pre class="code-block">{selectedLog.error_message}</pre>
    </div>

    {#if selectedLog.context_json}
      <div class="detail-section">
        <span class="detail-label">{$t('errorAudit.contextJson')}</span>
        <pre class="code-block json-block">{selectedLog.context_json}</pre>
      </div>
    {/if}

    {#snippet footer()}
      <button class="btn btn-secondary" onclick={() => (selectedLog = null)}>{$t('common.close')}</button>
    {/snippet}
  </Modal>
{/if}

{#if showClearConfirm}
  <Modal open={true} title={$t('errorAudit.clearTitle')} maxWidth="480px" onclose={() => (showClearConfirm = false)}>
    <p class="confirm-text">
      {$t('errorAudit.clearConfirmText')}
    </p>
    {#snippet footer()}
      <button class="btn btn-secondary" onclick={() => (showClearConfirm = false)} disabled={clearing}>{$t('common.cancel')}</button>
      <button class="btn btn-danger" onclick={clearLogs} disabled={clearing}>
        {clearing ? $t('common.loading') : $t('common.confirm')}
      </button>
    {/snippet}
  </Modal>
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
    flex-wrap: wrap;
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

  .search-group { flex: 1; min-width: 220px; }

  .select-input {
    width: 180px;
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

  .confirm-text {
    margin: 1rem 0;
    color: var(--text-secondary);
    line-height: 1.6;
  }
</style>
