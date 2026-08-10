<script lang="ts">
  import { onMount } from 'svelte';
  import { adminFetch } from '../lib/api';
  import type { AdminAuditLog } from '../lib/types';

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
      errorMsg = err.message || '加载操作审计失败';
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

  function parseDetails(raw: string | null): Record<string, unknown> | null {
    if (!raw) return null;
    try {
      const v = JSON.parse(raw);
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  function prettyDetails(raw: string | null): string {
    if (!raw) return '—';
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }

  /** One-line summary for table; full JSON still in modal */
  function summarizeDetails(row: AdminAuditLog): string {
    const d = parseDetails(row.details_json);
    if (!d) return '—';
    switch (row.action) {
      case 'GENERATE':
        return [
          d.tier,
          d.max_devices != null ? `设备上限 ${d.max_devices}` : null,
          d.expires_at === 'LIFETIME' ? '永久' : d.expires_at ? `到期 ${d.expires_at}` : null,
          d.buyer_email ? `邮箱 ${d.buyer_email}` : null,
          d.email_sent === true ? '已发信' : d.send_email_requested ? '未发信' : null
        ]
          .filter(Boolean)
          .join(' · ');
      case 'REVOKE':
        return [
          d.previous_status ? `${d.previous_status}→revoked` : '→revoked',
          d.tier,
          d.active_devices_count != null ? `当时设备 ${d.active_devices_count}` : null,
          d.buyer_email ? String(d.buyer_email) : null
        ]
          .filter(Boolean)
          .join(' · ');
      case 'UNBIND':
        return [
          d.mode === 'clear_all' ? '全清' : '单台',
          d.license_code ? String(d.license_code) : null,
          d.unbound_count != null ? `解绑 ${d.unbound_count} 台` : null,
          d.counts_toward_user_quota === false ? '不计用户配额' : null
        ]
          .filter(Boolean)
          .join(' · ');
      case 'CLEAR_LOGS':
        return d.cleared_error_log_count != null
          ? `清空错误日志 ${d.cleared_error_log_count} 条`
          : '清空错误日志';
      default:
        return Object.keys(d).slice(0, 3).join(', ') || '—';
    }
  }

  onMount(() => {
    loadLogs();
  });
</script>

<div class="page-container">
  <div class="header-row">
    <div>
      <h2>操作审计轨迹</h2>
      <p class="subtitle">admin_audit_logs：发码 / 吊销 / 解绑 / 清空日志等高危写操作（共 {total} 条）</p>
    </div>
    <div class="actions">
      <button class="btn btn-secondary" onclick={loadLogs} disabled={loading}>刷新</button>
    </div>
  </div>

  <div class="filter-bar card">
    <div class="filter-group">
      <label for="action-select">动作:</label>
      <select id="action-select" class="input select-input" bind:value={filterAction} onchange={handleFilterChange}>
        {#each actions as a}
          <option value={a}>{a}</option>
        {/each}
      </select>
    </div>
    <div class="filter-group search-group">
      <label for="ops-q">关键词:</label>
      <input
        id="ops-q"
        type="text"
        class="input"
        placeholder="license_code / IP / details..."
        bind:value={searchKeyword}
        onkeydown={(e) => e.key === 'Enter' && handleFilterChange()}
      />
      <button class="btn btn-secondary btn-sm" onclick={handleFilterChange}>搜索</button>
    </div>
  </div>

  {#if errorMsg}
    <div class="error-banner">{errorMsg}</div>
  {/if}

  {#if loading}
    <div class="loading-state">正在拉取操作审计...</div>
  {:else if logs.length === 0}
    <div class="empty-state card">暂无操作审计记录</div>
  {:else}
    <div class="table-wrap card">
      <table class="data-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>动作</th>
            <th>目标类型</th>
            <th>目标 ID</th>
            <th>摘要</th>
            <th>操作 IP</th>
            <th></th>
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
                <button class="btn btn-secondary btn-sm" onclick={() => (selected = row)}>详情</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="pagination-bar card">
      <button class="btn btn-secondary btn-sm" disabled={page <= 1 || loading} onclick={prevPage}>上一页</button>
      <span class="page-info">
        第 {page} 页 / 共 {Math.ceil(total / pageSize) || 1} 页（共 {total} 条）
      </span>
      <button class="btn btn-secondary btn-sm" disabled={page * pageSize >= total || loading} onclick={nextPage}>
        下一页
      </button>
    </div>
  {/if}
</div>

{#if selected}
  <div class="modal-overlay" onclick={() => (selected = null)} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="modal-content"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="dialog"
      tabindex="-1"
      aria-modal="true"
    >
      <div class="modal-header">
        <h3>审计详情 #{selected.id}</h3>
        <span class="badge badge-active">{selected.action}</span>
      </div>
      <div class="detail-section">
        <span class="detail-label">时间</span>
        <div>{new Date(selected.created_at).toLocaleString()}</div>
      </div>
      <div class="detail-section">
        <span class="detail-label">目标</span>
        <div class="mono">{selected.target_type} · {selected.target_id || '—'}</div>
      </div>
      <div class="detail-section">
        <span class="detail-label">操作 IP</span>
        <div class="mono">{selected.operator_ip || '—'}</div>
      </div>
      <div class="detail-section">
        <span class="detail-label">摘要</span>
        <div>{summarizeDetails(selected)}</div>
      </div>
      <div class="detail-section">
        <span class="detail-label">details_json（完整）</span>
        <pre class="code-block">{prettyDetails(selected.details_json)}</pre>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={() => (selected = null)}>关闭</button>
      </div>
    </div>
  </div>
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
  .error-banner {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.4);
    color: #fca5a5;
    padding: 0.75rem;
    border-radius: var(--radius-sm);
  }
  .pagination-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 1rem;
  }
  .page-info { font-size: 0.85rem; color: var(--text-muted); }

  .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; }
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
  .modal-footer { display: flex; justify-content: flex-end; margin-top: 1.5rem; }
</style>
