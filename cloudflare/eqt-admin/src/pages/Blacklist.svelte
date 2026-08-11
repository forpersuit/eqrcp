<script lang="ts">
  import { onMount } from 'svelte';
  import { adminFetch } from '../lib/api';
  import type { ManualBlacklistEntry } from '../lib/types';

  let entries = $state<ManualBlacklistEntry[]>([]);
  let total = $state(0);
  let loading = $state(true);
  let errorMsg = $state('');
  let actionMsg = $state('');
  let busy = $state(false);

  let filterKind = $state<'all' | 'email' | 'device'>('all');
  let searchQuery = $state('');
  let includeInactive = $state(false);

  let formKind = $state<'email' | 'device'>('email');
  let formEmail = $state('');
  let formDeviceId = $state('');
  let formUuid = $state('');
  let formCpu = $state('');
  let formDisk = $state('');
  let formReason = $state('');

  async function loadList() {
    loading = true;
    errorMsg = '';
    try {
      const params: Record<string, string> = { limit: '100' };
      if (filterKind !== 'all') params.kind = filterKind;
      if (searchQuery.trim()) params.q = searchQuery.trim();
      if (includeInactive) params.include_inactive = '1';
      const data = await adminFetch<{ entries: ManualBlacklistEntry[]; total: number }>(
        '/api/v1/admin/blacklist',
        { params }
      );
      entries = data.entries || [];
      total = data.total || 0;
    } catch (err: any) {
      errorMsg = err.message || '加载黑名单失败';
      entries = [];
      total = 0;
    } finally {
      loading = false;
    }
  }

  async function handleAdd(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    actionMsg = '';
    errorMsg = '';
    try {
      const body: Record<string, string> = {
        kind: formKind,
        reason: formReason.trim()
      };
      if (formKind === 'email') {
        body.email = formEmail.trim();
      } else {
        if (formDeviceId.trim()) body.device_id = formDeviceId.trim();
        if (formUuid.trim()) body.uuid_hash = formUuid.trim();
        if (formCpu.trim()) body.cpu_hash = formCpu.trim();
        if (formDisk.trim()) body.disk_hash = formDisk.trim();
      }
      await adminFetch('/api/v1/admin/blacklist', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      actionMsg = '已添加封禁条目';
      formEmail = '';
      formDeviceId = '';
      formUuid = '';
      formCpu = '';
      formDisk = '';
      formReason = '';
      await loadList();
    } catch (err: any) {
      errorMsg = err.message || '添加失败';
    } finally {
      busy = false;
    }
  }

  async function handleUnban(id: number) {
    if (!confirm(`确认解除封禁 #${id}？`)) return;
    busy = true;
    errorMsg = '';
    try {
      await adminFetch(`/api/v1/admin/blacklist/${id}`, { method: 'DELETE' });
      actionMsg = `已解除 #${id}`;
      await loadList();
    } catch (err: any) {
      errorMsg = err.message || '解封失败';
    } finally {
      busy = false;
    }
  }

  function identityLine(row: ManualBlacklistEntry): string {
    if (row.kind === 'email') {
      return row.email || row.email_hash || '—';
    }
    const parts: string[] = [];
    if (row.device_id) parts.push(`device_id=${row.device_id}`);
    if (row.uuid_hash) parts.push(`uuid=${row.uuid_hash.slice(0, 12)}…`);
    if (row.cpu_hash) parts.push(`cpu=${row.cpu_hash.slice(0, 12)}…`);
    if (row.disk_hash) parts.push(`disk=${row.disk_hash.slice(0, 12)}…`);
    return parts.join(' · ') || '—';
  }

  onMount(() => {
    loadList();
  });
</script>

<div class="page-container">
  <div class="header-row">
    <div>
      <h2>黑名单管理</h2>
      <p class="subtitle">
        手工封禁邮箱与设备码。自动滥用黑名单（365 天 ≥3 次已激活 purchase 退款/拒付）仍并行生效。
      </p>
    </div>
  </div>

  {#if errorMsg}
    <div class="banner error">{errorMsg}</div>
  {/if}
  {#if actionMsg}
    <div class="banner ok">{actionMsg}</div>
  {/if}

  <div class="card form-card">
    <h3>添加封禁</h3>
    <form onsubmit={handleAdd} class="add-form">
      <div class="kind-row">
        <label class="radio">
          <input type="radio" bind:group={formKind} value="email" /> 邮箱
        </label>
        <label class="radio">
          <input type="radio" bind:group={formKind} value="device" /> 设备
        </label>
      </div>

      {#if formKind === 'email'}
        <div class="form-group">
          <label for="bl-email">邮箱</label>
          <input id="bl-email" class="input" type="email" bind:value={formEmail} required placeholder="user@example.com" />
        </div>
      {:else}
        <div class="form-group">
          <label for="bl-dev">设备码 device_id（推荐）</label>
          <input id="bl-dev" class="input" bind:value={formDeviceId} placeholder="DEV-..." />
        </div>
        <div class="fp-grid">
          <div class="form-group">
            <label for="bl-uuid">uuid_hash（可选）</label>
            <input id="bl-uuid" class="input" bind:value={formUuid} />
          </div>
          <div class="form-group">
            <label for="bl-cpu">cpu_hash（可选）</label>
            <input id="bl-cpu" class="input" bind:value={formCpu} />
          </div>
          <div class="form-group">
            <label for="bl-disk">disk_hash（可选）</label>
            <input id="bl-disk" class="input" bind:value={formDisk} />
          </div>
        </div>
        <p class="hint">至少填写 device_id 或一项指纹；指纹按 3 选 2 匹配。</p>
      {/if}

      <div class="form-group">
        <label for="bl-reason">原因（可选）</label>
        <input id="bl-reason" class="input" bind:value={formReason} placeholder="滥用 / 拒付 / 客服备注…" />
      </div>

      <button type="submit" class="btn btn-primary" disabled={busy}>添加封禁</button>
    </form>
  </div>

  <div class="card list-card">
    <div class="toolbar">
      <select class="input select" bind:value={filterKind} onchange={() => loadList()}>
        <option value="all">全部类型</option>
        <option value="email">仅邮箱</option>
        <option value="device">仅设备</option>
      </select>
      <input
        class="input search"
        placeholder="搜索邮箱 / 设备码 / 原因…"
        bind:value={searchQuery}
        onkeydown={(e) => e.key === 'Enter' && loadList()}
      />
      <label class="check">
        <input type="checkbox" bind:checked={includeInactive} onchange={() => loadList()} />
        含已解封
      </label>
      <button type="button" class="btn btn-secondary" onclick={() => loadList()} disabled={loading}>
        刷新
      </button>
    </div>

    <p class="meta">共 {total} 条</p>

    {#if loading}
      <div class="empty">加载中…</div>
    {:else if !entries.length}
      <div class="empty">暂无手工黑名单条目</div>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>类型</th>
              <th>标识</th>
              <th>原因</th>
              <th>操作人</th>
              <th>时间</th>
              <th>状态</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each entries as row (row.id)}
              <tr class:inactive={!row.active}>
                <td>{row.id}</td>
                <td><span class="badge">{row.kind}</span></td>
                <td class="mono">{identityLine(row)}</td>
                <td>{row.reason || '—'}</td>
                <td class="muted">{row.created_by || '—'}</td>
                <td class="muted">{row.created_at?.slice(0, 19)?.replace('T', ' ') || '—'}</td>
                <td>{row.active ? '生效' : '已解封'}</td>
                <td>
                  {#if row.active}
                    <button type="button" class="btn btn-secondary btn-sm" disabled={busy} onclick={() => handleUnban(row.id)}>
                      解封
                    </button>
                  {/if}
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
  .header-row {
    margin-bottom: 1.25rem;
  }
  .subtitle {
    color: var(--text-muted);
    font-size: 0.9rem;
    margin-top: 0.35rem;
  }
  .banner {
    padding: 0.75rem 1rem;
    border-radius: var(--radius-sm);
    margin-bottom: 1rem;
    font-size: 0.9rem;
  }
  .banner.error {
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.35);
    color: #fca5a5;
  }
  .banner.ok {
    background: rgba(34, 197, 94, 0.12);
    border: 1px solid rgba(34, 197, 94, 0.35);
    color: #86efac;
  }
  .form-card,
  .list-card {
    padding: 1.25rem 1.5rem;
    margin-bottom: 1.25rem;
  }
  .form-card h3 {
    margin-bottom: 1rem;
    font-size: 1rem;
  }
  .kind-row {
    display: flex;
    gap: 1.25rem;
    margin-bottom: 1rem;
  }
  .radio {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--text-secondary);
    font-size: 0.9rem;
  }
  .form-group {
    margin-bottom: 0.85rem;
  }
  .form-group label {
    display: block;
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-bottom: 0.35rem;
  }
  .fp-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.75rem;
  }
  .hint {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin: -0.25rem 0 0.75rem;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
    margin-bottom: 0.75rem;
  }
  .select {
    width: auto;
    min-width: 120px;
  }
  .search {
    flex: 1;
    min-width: 180px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.85rem;
    color: var(--text-secondary);
  }
  .meta {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-bottom: 0.75rem;
  }
  .empty {
    padding: 2rem;
    text-align: center;
    color: var(--text-muted);
  }
  .table-wrap {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }
  th,
  td {
    text-align: left;
    padding: 0.6rem 0.5rem;
    border-bottom: 1px solid var(--border-color);
    vertical-align: top;
  }
  th {
    color: var(--text-muted);
    font-weight: 500;
  }
  tr.inactive {
    opacity: 0.55;
  }
  .mono {
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    word-break: break-all;
  }
  .muted {
    color: var(--text-muted);
    font-size: 0.8rem;
  }
  .badge {
    display: inline-block;
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
    background: rgba(99, 102, 241, 0.15);
    color: var(--accent-primary);
    font-size: 0.75rem;
    text-transform: uppercase;
  }
  .btn-sm {
    font-size: 0.75rem;
    padding: 0.3rem 0.6rem;
  }
  @media (max-width: 900px) {
    .fp-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
