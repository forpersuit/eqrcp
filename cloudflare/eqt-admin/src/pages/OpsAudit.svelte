<script lang="ts">
  import { onMount } from 'svelte';
  import { adminFetch } from '../lib/api';
  import { t } from '../lib/i18n';
  import { summarizeDetails, prettyDetails } from '../lib/audit';
  import type { AdminAuditLog } from '../lib/types';
  import Modal from '../components/Modal.svelte';
  import Pagination from '../components/Pagination.svelte';
  import Banner from '../components/Banner.svelte';

  let logs = $state<AdminAuditLog[]>([]);
  let total = $state(0);
  let page = $state(1);
  const pageSize = 50;
  let loading = $state(true);
  let errorMsg = $state('');
  let filterAction = $state('ALL');
  let searchKeyword = $state('');
  let selected = $state<AdminAuditLog | null>(null);

  const actions = ['ALL', 'GENERATE', 'REVOKE', 'UNBIND', 'CLEAR_LOGS'];

  async function loadLogs() {
    loading = true;
    errorMsg = '';
    const offset = (page - 1) * pageSize;
    try {
      const data = await adminFetch<{ logs: AdminAuditLog[]; total: number }>('/api/v1/admin/audit-logs', {
        params: {
          action: filterAction,
          q: searchKeyword,
          limit: String(pageSize),
          offset: String(offset)
        }
      });
      logs = data.logs || [];
      total = data.total || logs.length;
    } catch (err: any) {
      errorMsg = err.message || $t('common.failed');
      logs = [];
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

  onMount(() => {
    loadLogs();
  });
</script>

<div class="page-container">
  <div class="header-row">
    <div>
      <h2>{$t('opsAudit.title')}</h2>
      <p class="subtitle">{$t('opsAudit.subtitle', { total })}</p>
    </div>
    <div class="actions">
      <button class="btn btn-secondary btn-sm" onclick={loadLogs} disabled={loading}>
        {$t('common.refresh')}
      </button>
    </div>
  </div>

  <div class="filter-bar card">
    <div class="filter-group">
      <label for="action-select">{$t('opsAudit.filterAction')}</label>
      <select id="action-select" class="input select-input" bind:value={filterAction} onchange={handleFilterChange}>
        {#each actions as a}
          <option value={a}>{a === 'ALL' ? $t('common.all') : a}</option>
        {/each}
      </select>
    </div>
    <div class="filter-group search-group">
      <label for="ops-q">{$t('opsAudit.filterKeyword')}</label>
      <div class="search-input-wrap">
        <input
          id="ops-q"
          type="text"
          class="input"
          placeholder={$t('opsAudit.searchPlaceholder')}
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

  {#if loading}
    <div class="loading-state">{$t('common.loading')}</div>
  {:else if logs.length === 0}
    <div class="empty-state card">{$t('opsAudit.emptyState')}</div>
  {:else}
    <div class="table-wrap card">
      <table class="data-table">
        <thead>
          <tr>
            <th>{$t('common.time')}</th>
            <th>{$t('common.actions')}</th>
            <th>{$t('common.targetType')}</th>
            <th>{$t('common.targetId')}</th>
            <th>{$t('common.summary')}</th>
            <th>{$t('common.ip')}</th>
            <th>{$t('common.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {#each logs as row (row.id)}
            <tr>
              <td class="mono">{new Date(row.created_at).toLocaleString()}</td>
              <td><span class="badge badge-active">{row.action}</span></td>
              <td>{row.target_type || '—'}</td>
              <td class="mono">{row.target_id || '—'}</td>
              <td class="summary-cell" title={summarizeDetails(row)}>{summarizeDetails(row)}</td>
              <td class="mono">{row.operator_ip || '—'}</td>
              <td>
                <button class="btn btn-secondary btn-sm" onclick={() => (selected = row)}>{$t('common.details')}</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <Pagination {page} {pageSize} {total} {loading} onprev={prevPage} onnext={nextPage} />
  {/if}
</div>

{#if selected}
  <Modal open={true} title={$t('opsAudit.modalTitle', { id: selected.id })} maxWidth="620px" onclose={() => (selected = null)}>
    <div class="detail-section">
      <span class="detail-label">{$t('common.actions')}</span>
      <div><span class="badge badge-active">{selected.action}</span></div>
    </div>
    <div class="detail-section">
      <span class="detail-label">{$t('common.time')}</span>
      <div>{new Date(selected.created_at).toLocaleString()}</div>
    </div>
    <div class="detail-section">
      <span class="detail-label">{$t('common.target')}</span>
      <div class="mono">{selected.target_type} · {selected.target_id || '—'}</div>
    </div>
    <div class="detail-section">
      <span class="detail-label">{$t('common.ip')}</span>
      <div class="mono">{selected.operator_ip || '—'}</div>
    </div>
    <div class="detail-section">
      <span class="detail-label">{$t('common.summary')}</span>
      <div>{summarizeDetails(selected)}</div>
    </div>
    <div class="detail-section">
      <span class="detail-label">{$t('opsAudit.fullJson')}</span>
      <pre class="code-block">{prettyDetails(selected.details_json)}</pre>
    </div>
    {#snippet footer()}
      <button class="btn btn-secondary" onclick={() => (selected = null)}>{$t('common.close')}</button>
    {/snippet}
  </Modal>
{/if}

<style>
  .page-container { display: flex; flex-direction: column; gap: 1.5rem; }
  .header-row { display: flex; justify-content: space-between; align-items: center; }
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
  .filter-group { display: flex; align-items: center; gap: 0.75rem; }
  .filter-group label { font-size: 0.85rem; color: var(--text-secondary); white-space: nowrap; }
  .search-group { flex: 1; min-width: 220px; }
  .select-input { width: 180px; background: var(--bg-surface); }

  .table-wrap { overflow-x: auto; padding: 0; }
  .data-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  .summary-cell {
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary, #64748b);
    font-size: 0.8rem;
  }
  .data-table th, .data-table td {
    padding: 0.75rem 1rem;
    text-align: left;
    border-bottom: 1px solid var(--border-color);
  }
  .data-table th { color: var(--text-muted); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; }
  .mono { font-family: var(--font-mono); font-size: 0.8rem; }

  .loading-state, .empty-state { text-align: center; padding: 3rem; color: var(--text-muted); }
  .detail-section { margin-bottom: 1rem; }
  .detail-label { font-size: 0.8rem; color: var(--text-muted); display: block; margin-bottom: 0.25rem; }
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
</style>
