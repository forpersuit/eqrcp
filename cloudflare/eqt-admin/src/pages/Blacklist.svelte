<script lang="ts">
  import { onMount } from 'svelte';
  import { adminFetch } from '../lib/api';
  import { t } from '../lib/i18n';
  import type { ManualBlacklistEntry } from '../lib/types';
  import Modal from '../components/Modal.svelte';
  import Banner from '../components/Banner.svelte';

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
      errorMsg = err.message || $t('common.failed');
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
      actionMsg = `${$t('blacklist.addTitle')} ${$t('common.success')}`;
      formEmail = '';
      formDeviceId = '';
      formUuid = '';
      formCpu = '';
      formDisk = '';
      formReason = '';
      await loadList();
    } catch (err: any) {
      errorMsg = $t('common.failed') + ': ' + (err.message || String(err));
    } finally {
      busy = false;
    }
  }

  let unbanTarget = $state<ManualBlacklistEntry | null>(null);

  async function executeUnban() {
    if (!unbanTarget) return;
    const targetId = unbanTarget.id;
    busy = true;
    errorMsg = '';
    try {
      await adminFetch(`/api/v1/admin/blacklist/${targetId}`, { method: 'DELETE' });
      actionMsg = `${$t('blacklist.unbanBtn')} ${$t('common.success')}: #${targetId}`;
      unbanTarget = null;
      await loadList();
    } catch (err: any) {
      errorMsg = $t('common.failed') + ': ' + (err.message || String(err));
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
      <h2>{$t('blacklist.title')}</h2>
      <p class="subtitle">{$t('blacklist.subtitle')}</p>
    </div>
  </div>

  <Banner type="error" message={errorMsg} />
  <Banner type="ok" message={actionMsg} />

  <div class="card form-card">
    <h3>{$t('blacklist.addTitle')}</h3>
    <form onsubmit={handleAdd} class="add-form">
      <div class="kind-row">
        <label class="radio">
          <input type="radio" bind:group={formKind} value="email" /> {$t('blacklist.kindEmail')}
        </label>
        <label class="radio">
          <input type="radio" bind:group={formKind} value="device" /> {$t('blacklist.kindDevice')}
        </label>
      </div>

      {#if formKind === 'email'}
        <div class="form-group">
          <label for="bl-email">{$t('blacklist.emailLabel')}</label>
          <input id="bl-email" class="input" type="email" bind:value={formEmail} required placeholder={$t('blacklist.emailPlaceholder')} />
        </div>
      {:else}
        <div class="form-group">
          <label for="bl-dev">{$t('blacklist.deviceIdLabel')}</label>
          <input id="bl-dev" class="input" bind:value={formDeviceId} placeholder="DEV-..." />
        </div>
        <div class="fp-grid">
          <div class="form-group">
            <label for="bl-uuid">{$t('blacklist.uuidHash')}</label>
            <input id="bl-uuid" class="input" bind:value={formUuid} />
          </div>
          <div class="form-group">
            <label for="bl-cpu">{$t('blacklist.cpuHash')}</label>
            <input id="bl-cpu" class="input" bind:value={formCpu} />
          </div>
          <div class="form-group">
            <label for="bl-disk">{$t('blacklist.diskHash')}</label>
            <input id="bl-disk" class="input" bind:value={formDisk} />
          </div>
        </div>
        <p class="hint">{$t('blacklist.deviceFpLabel')}</p>
      {/if}

      <div class="form-group">
        <label for="bl-reason">{$t('blacklist.reasonLabel')}</label>
        <input id="bl-reason" class="input" bind:value={formReason} placeholder={$t('blacklist.reasonPlaceholder')} required />
      </div>

      <button type="submit" class="btn btn-primary" disabled={busy}>
        {busy ? $t('blacklist.submitting') : $t('blacklist.submitBtn')}
      </button>
    </form>
  </div>

  <div class="card list-card">
    <div class="toolbar">
      <select class="input select" bind:value={filterKind} onchange={() => loadList()}>
        <option value="all">{$t('blacklist.filterAll')}</option>
        <option value="email">{$t('blacklist.filterEmail')}</option>
        <option value="device">{$t('blacklist.filterDevice')}</option>
      </select>
      <input
        class="input search"
        placeholder={$t('blacklist.searchPlaceholder')}
        bind:value={searchQuery}
        onkeydown={(e) => e.key === 'Enter' && loadList()}
      />
      <label class="check">
        <input type="checkbox" bind:checked={includeInactive} onchange={() => loadList()} />
        {$t('blacklist.includeInactive')}
      </label>
      <button type="button" class="btn btn-secondary btn-sm" onclick={() => loadList()} disabled={loading}>
        {$t('common.refresh')}
      </button>
    </div>

    <p class="meta">{$t('pagination.total', { total })}</p>

    {#if loading}
      <div class="empty">{$t('common.loading')}</div>
    {:else if !entries.length}
      <div class="empty">{$t('blacklist.emptyList')}</div>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{$t('blacklist.tableHeaderId')}</th>
              <th>{$t('blacklist.tableHeaderKind')}</th>
              <th>{$t('blacklist.tableHeaderTarget')}</th>
              <th>{$t('blacklist.tableHeaderReason')}</th>
              <th>{$t('blacklist.tableHeaderCreated')}</th>
              <th>{$t('common.status')}</th>
              <th>{$t('blacklist.tableHeaderActions')}</th>
            </tr>
          </thead>
          <tbody>
            {#each entries as row (row.id)}
              <tr class:inactive={!row.active}>
                <td>{row.id}</td>
                <td><span class="badge">{row.kind}</span></td>
                <td class="mono">{identityLine(row)}</td>
                <td>{row.reason || '—'}</td>
                <td class="muted">{row.created_at?.slice(0, 19)?.replace('T', ' ') || '—'}</td>
                <td>{row.active ? $t('common.active') : $t('common.revoked')}</td>
                <td>
                  {#if row.active}
                    <button type="button" class="btn btn-secondary btn-sm" disabled={busy} onclick={() => (unbanTarget = row)}>
                      {$t('blacklist.unbanBtn')}
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

{#if unbanTarget}
  <Modal open={true} title={$t('blacklist.unbanTitle')} maxWidth="480px" onclose={() => (unbanTarget = null)}>
    <p class="confirm-text">
      {$t('blacklist.unbanConfirmText', { id: unbanTarget.id, identity: identityLine(unbanTarget) })}
    </p>
    {#snippet footer()}
      <button type="button" class="btn btn-secondary" onclick={() => (unbanTarget = null)} disabled={busy}>{$t('common.cancel')}</button>
      <button type="button" class="btn btn-danger" onclick={executeUnban} disabled={busy}>
        {busy ? $t('common.loading') : $t('blacklist.unbanConfirmBtn')}
      </button>
    {/snippet}
  </Modal>
{/if}

<style>
  .header-row {
    margin-bottom: 1.25rem;
  }
  .subtitle {
    color: var(--text-muted);
    font-size: 0.9rem;
    margin-top: 0.35rem;
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
    cursor: pointer;
    font-size: 0.9rem;
  }
  .form-group {
    margin-bottom: 0.9rem;
  }
  .form-group label {
    display: block;
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-bottom: 0.3rem;
  }
  .fp-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.75rem;
  }
  .hint {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin: -0.4rem 0 0.8rem;
  }
  .toolbar {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 0.75rem;
  }
  .toolbar .select {
    width: 120px;
  }
  .toolbar .search {
    flex: 1;
    min-width: 180px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.85rem;
    color: var(--text-muted);
    cursor: pointer;
    white-space: nowrap;
  }
  .meta {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-bottom: 0.75rem;
  }
  .empty {
    text-align: center;
    color: var(--text-muted);
    padding: 2rem 0;
    font-size: 0.9rem;
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
    padding: 0.6rem 0.75rem;
    text-align: left;
    border-bottom: 1px solid var(--border-color);
  }
  th {
    color: var(--text-muted);
    font-weight: 500;
    font-size: 0.75rem;
    text-transform: uppercase;
  }
  tr.inactive {
    opacity: 0.5;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    max-width: 320px;
    word-break: break-all;
  }
  .muted {
    color: var(--text-muted);
    font-size: 0.8rem;
  }
  .badge {
    display: inline-block;
    padding: 0.15rem 0.45rem;
    border-radius: var(--radius-sm);
    background: rgba(99, 102, 241, 0.15);
    color: var(--accent-primary);
    font-size: 0.75rem;
    text-transform: uppercase;
  }
  .btn-sm {
    font-size: 0.75rem;
    padding: 0.3rem 0.6rem;
  }
  .confirm-text {
    font-size: 0.9rem;
    color: var(--text-secondary);
    line-height: 1.5;
    margin-bottom: 1.25rem;
  }
  @media (max-width: 900px) {
    .fp-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
