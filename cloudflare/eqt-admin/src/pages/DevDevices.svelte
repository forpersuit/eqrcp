<script lang="ts">
  import { onMount } from 'svelte';
  import { adminFetch } from '../lib/api';
  import { t } from '../lib/i18n';
  import type { DevDeviceEntry } from '../lib/types';
  import Modal from '../components/Modal.svelte';
  import Banner from '../components/Banner.svelte';

  let devices = $state<DevDeviceEntry[]>([]);
  let loading = $state(true);
  let errorMsg = $state('');
  let actionMsg = $state('');
  let busy = $state(false);
  let searchQuery = $state('');

  // Modal State
  let showModal = $state(false);
  let editingId = $state<number | null>(null);
  let formDeviceId = $state('');
  let formEmail = $state('');
  let formNotes = $state('');
  let formIsDev = $state(true);

  async function loadDevices() {
    loading = true;
    errorMsg = '';
    try {
      const data = await adminFetch<{ success: boolean; devices: DevDeviceEntry[] }>(
        '/api/v1/admin/dev-devices'
      );
      devices = data.devices || [];
    } catch (err: any) {
      errorMsg = err.message || $t('common.failed');
      devices = [];
    } finally {
      loading = false;
    }
  }

  function openAddModal() {
    editingId = null;
    formDeviceId = '';
    formEmail = '';
    formNotes = '';
    formIsDev = true;
    showModal = true;
    actionMsg = '';
    errorMsg = '';
  }

  function openEditModal(dev: DevDeviceEntry) {
    editingId = dev.id;
    formDeviceId = dev.device_id || '';
    formEmail = dev.email || '';
    formNotes = dev.notes || '';
    formIsDev = Boolean(dev.is_dev);
    showModal = true;
    actionMsg = '';
    errorMsg = '';
  }

  function closeModal() {
    showModal = false;
    editingId = null;
  }

  async function handleSave(e: SubmitEvent) {
    e.preventDefault();
    const devId = formDeviceId.trim().toLowerCase();
    const email = formEmail.trim().toLowerCase();
    const notes = formNotes.trim();

    if (!devId && !email && !editingId) {
      errorMsg = 'Must enter Device ID or Email';
      return;
    }

    busy = true;
    actionMsg = '';
    errorMsg = '';

    try {
      const body: any = {
        device_id: devId || null,
        email: email || null,
        notes: notes || null,
        is_dev: formIsDev ? 1 : 0
      };
      if (editingId) {
        body.id = editingId;
      }

      await adminFetch('/api/v1/admin/dev-devices', {
        method: 'POST',
        body: JSON.stringify(body)
      });

      actionMsg = editingId ? $t('common.success') : `${$t('devDevices.addBtn')} ${$t('common.success')}`;
      closeModal();
      await loadDevices();
    } catch (err: any) {
      errorMsg = err.message || $t('common.failed');
    } finally {
      busy = false;
    }
  }

  async function toggleDevPermission(dev: DevDeviceEntry) {
    if (busy) return;
    busy = true;
    errorMsg = '';
    actionMsg = '';
    try {
      await adminFetch(`/api/v1/admin/dev-devices/${dev.id}/toggle-dev`, {
        method: 'POST'
      });
      actionMsg = $t('devDevices.toggleDevSuccess');
      await loadDevices();
    } catch (err: any) {
      errorMsg = err.message || $t('common.failed');
    } finally {
      busy = false;
    }
  }

  async function handleDelete(dev: DevDeviceEntry) {
    if (!window.confirm($t('devDevices.deleteConfirm'))) {
      return;
    }
    busy = true;
    errorMsg = '';
    actionMsg = '';
    try {
      await adminFetch(`/api/v1/admin/dev-devices/${dev.id}`, {
        method: 'DELETE'
      });
      actionMsg = `${$t('common.delete')} ${$t('common.success')}`;
      await loadDevices();
    } catch (err: any) {
      errorMsg = err.message || $t('common.failed');
    } finally {
      busy = false;
    }
  }

  function copyText(val: string) {
    navigator.clipboard.writeText(val);
    actionMsg = $t('common.copied');
    setTimeout(() => {
      if (actionMsg === $t('common.copied')) actionMsg = '';
    }, 2000);
  }

  const filteredDevices = $derived(
    devices.filter(d => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        (d.device_id && d.device_id.toLowerCase().includes(q)) ||
        (d.email && d.email.toLowerCase().includes(q)) ||
        (d.notes && d.notes.toLowerCase().includes(q))
      );
    })
  );

  onMount(() => {
    loadDevices();
  });
</script>

<div class="dev-devices-page">
  <div class="page-header">
    <div class="header-titles">
      <h2>{$t('devDevices.title')}</h2>
      <p class="subtitle">{$t('devDevices.subtitle')}</p>
    </div>
    <div class="header-actions">
      <button class="btn btn-secondary" onclick={loadDevices} disabled={loading || busy}>
        {$t('devDevices.refreshBtn')}
      </button>
      <button class="btn btn-primary" onclick={openAddModal}>
        {$t('devDevices.addBtn')}
      </button>
    </div>
  </div>

  {#if actionMsg}
    <Banner type="ok" message={actionMsg} onclose={() => (actionMsg = '')} />
  {/if}
  {#if errorMsg}
    <Banner type="error" message={errorMsg} onclose={() => (errorMsg = '')} />
  {/if}

  <div class="toolbar card">
    <div class="search-box">
      <input
        type="text"
        placeholder={$t('devDevices.searchPlaceholder')}
        bind:value={searchQuery}
      />
    </div>
    <div class="stats-counter">
      共 <strong>{filteredDevices.length}</strong> / {devices.length} 台设备
    </div>
  </div>

  {#if loading}
    <div class="loading-state card">{$t('common.loading')}</div>
  {:else if filteredDevices.length === 0}
    <div class="empty-state card">
      <div class="empty-icon">🛠️</div>
      <p>{$t('devDevices.emptyHint')}</p>
    </div>
  {:else}
    <div class="devices-grid">
      {#each filteredDevices as dev (dev.id)}
        <div class="device-card card" class:dev-enabled={Boolean(dev.is_dev)}>
          <div class="card-top">
            <div class="device-identity">
              <span class="device-badge" class:is-dev-badge={Boolean(dev.is_dev)}>
                {Boolean(dev.is_dev) ? '🛠️ DEV' : '🧪 TEST'}
              </span>
              {#if dev.device_id}
                <div class="device-id-wrapper" title={dev.device_id}>
                  <span class="device-id-mono">{dev.device_id}</span>
                  <button type="button" class="copy-icon-btn" onclick={() => copyText(dev.device_id!)}>📋</button>
                </div>
              {:else}
                <span class="device-id-empty">(未填 Device ID)</span>
              {/if}
            </div>

            <div class="dev-switch-wrapper">
              <button
                type="button"
                class="dev-toggle-pill"
                class:active={Boolean(dev.is_dev)}
                onclick={() => toggleDevPermission(dev)}
                disabled={busy}
                title="点击切换 Dev 模式授权"
              >
                <span class="toggle-indicator"></span>
                <span class="toggle-text">
                  {Boolean(dev.is_dev) ? $t('devDevices.devModeEnabled') : $t('devDevices.devModeDisabled')}
                </span>
              </button>
            </div>
          </div>

          <div class="card-meta">
            {#if dev.email}
              <div class="meta-row">
                <span class="meta-label">📧 {$t('devDevices.email')}:</span>
                <span class="meta-val">{dev.email}</span>
              </div>
            {/if}
            {#if dev.notes}
              <div class="meta-row">
                <span class="meta-label">📝 {$t('devDevices.notes')}:</span>
                <span class="meta-val">{dev.notes}</span>
              </div>
            {/if}
            <div class="meta-row">
              <span class="meta-label">⏱️ {$t('devDevices.createdAt')}:</span>
              <span class="meta-val">{dev.created_at ? new Date(dev.created_at).toLocaleString() : '-'}</span>
            </div>
          </div>

          <div class="card-footer">
            <div class="card-actions">
              <button type="button" class="btn btn-xs btn-secondary" onclick={() => openEditModal(dev)}>
                {$t('devDevices.edit')}
              </button>
              <button type="button" class="btn btn-xs btn-danger" onclick={() => handleDelete(dev)} disabled={busy}>
                {$t('devDevices.delete')}
              </button>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if showModal}
  <Modal
    open={true}
    title={editingId ? $t('devDevices.editModalTitle') : $t('devDevices.addModalTitle')}
    onclose={closeModal}
  >
    <form onsubmit={handleSave} class="device-modal-form">
      <div class="form-group">
        <label for="form-dev-id">{$t('devDevices.deviceId')} *</label>
        <input
          id="form-dev-id"
          type="text"
          bind:value={formDeviceId}
          placeholder={$t('devDevices.deviceIdPlaceholder')}
          class="font-mono"
        />
      </div>

      <div class="form-group">
        <label for="form-dev-email">{$t('devDevices.email')}</label>
        <input
          id="form-dev-email"
          type="email"
          bind:value={formEmail}
          placeholder={$t('devDevices.emailPlaceholder')}
        />
      </div>

      <div class="form-group">
        <label for="form-dev-notes">{$t('devDevices.notes')}</label>
        <input
          id="form-dev-notes"
          type="text"
          bind:value={formNotes}
          placeholder={$t('devDevices.notesPlaceholder')}
        />
      </div>

      <div class="form-group checkbox-group">
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={formIsDev} />
          <span>{$t('devDevices.enableDevModeCheckbox')}</span>
        </label>
      </div>

      <div class="modal-buttons">
        <button type="button" class="btn btn-secondary" onclick={closeModal} disabled={busy}>
          {$t('common.cancel')}
        </button>
        <button type="submit" class="btn btn-primary" disabled={busy}>
          {$t('common.save')}
        </button>
      </div>
    </form>
  </Modal>
{/if}

<style>
  .dev-devices-page {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .header-titles h2 {
    margin: 0 0 0.25rem 0;
    font-size: 1.5rem;
    font-weight: 700;
  }

  .subtitle {
    margin: 0;
    color: var(--text-muted, #8b949e);
    font-size: 0.875rem;
  }

  .header-actions {
    display: flex;
    gap: 0.75rem;
  }

  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    gap: 1rem;
  }

  .search-box {
    flex: 1;
    max-width: 400px;
  }

  .search-box input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    border: 1px solid var(--border-color, #30363d);
    background: var(--bg-input, #0d1117);
    color: var(--text-color, #c9d1d9);
    font-size: 0.875rem;
  }

  .stats-counter {
    font-size: 0.875rem;
    color: var(--text-muted, #8b949e);
  }

  .loading-state, .empty-state {
    padding: 3rem;
    text-align: center;
    color: var(--text-muted, #8b949e);
  }

  .empty-icon {
    font-size: 2.5rem;
    margin-bottom: 0.75rem;
  }

  .devices-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
    gap: 1rem;
  }

  .device-card {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    padding: 1.125rem;
    border: 1px solid var(--border-color, #30363d);
    border-radius: 8px;
    transition: all 0.2s ease;
  }

  .device-card.dev-enabled {
    border-color: rgba(47, 158, 115, 0.4);
    background: linear-gradient(180deg, rgba(47, 158, 115, 0.04) 0%, rgba(0, 0, 0, 0) 100%);
  }

  .card-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .device-identity {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 0;
    flex: 1;
  }

  .device-badge {
    align-self: flex-start;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 700;
    background: rgba(139, 148, 158, 0.2);
    color: var(--text-muted, #8b949e);
  }

  .device-badge.is-dev-badge {
    background: rgba(47, 158, 115, 0.2);
    color: #39e5b6;
    border: 1px solid rgba(47, 158, 115, 0.3);
  }

  .device-id-wrapper {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
  }

  .device-id-mono {
    font-family: var(--font-mono, monospace);
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-color, #e6edf3);
    word-break: break-all;
  }

  .copy-icon-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0 2px;
    font-size: 0.85rem;
    opacity: 0.7;
    transition: opacity 0.2s;
  }

  .copy-icon-btn:hover {
    opacity: 1;
  }

  .device-id-empty {
    font-size: 0.8rem;
    font-style: italic;
    color: var(--text-muted, #8b949e);
  }

  .dev-toggle-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 4px 10px;
    border-radius: 12px;
    border: 1px solid var(--border-color, #30363d);
    background: var(--bg-hover, #21262d);
    color: var(--text-muted, #8b949e);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .dev-toggle-pill .toggle-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #8b949e;
  }

  .dev-toggle-pill.active {
    background: rgba(47, 158, 115, 0.15);
    border-color: #2f9e73;
    color: #39e5b6;
  }

  .dev-toggle-pill.active .toggle-indicator {
    background: #39e5b6;
    box-shadow: 0 0 6px rgba(57, 229, 182, 0.6);
  }

  .card-meta {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.8125rem;
    padding: 0.5rem 0;
    border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.05));
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.05));
  }

  .meta-row {
    display: flex;
    gap: 0.5rem;
  }

  .meta-label {
    color: var(--text-muted, #8b949e);
    min-width: 90px;
  }

  .meta-val {
    color: var(--text-color, #c9d1d9);
    word-break: break-all;
  }

  .card-footer {
    display: flex;
    justify-content: flex-end;
  }

  .card-actions {
    display: flex;
    gap: 0.5rem;
  }

  .btn-xs {
    padding: 2px 8px;
    font-size: 0.75rem;
    border-radius: 4px;
  }

  .btn-danger {
    background: rgba(248, 81, 73, 0.1);
    color: #f85149;
    border: 1px solid rgba(248, 81, 73, 0.3);
  }

  .btn-danger:hover {
    background: rgba(248, 81, 73, 0.2);
  }

  .device-modal-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .form-group label {
    font-size: 0.875rem;
    font-weight: 600;
  }

  .form-group input[type="text"],
  .form-group input[type="email"] {
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    border: 1px solid var(--border-color, #30363d);
    background: var(--bg-input, #0d1117);
    color: var(--text-color, #c9d1d9);
  }

  .checkbox-group {
    margin-top: 0.5rem;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    font-size: 0.875rem;
    color: #39e5b6;
  }

  .modal-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .font-mono {
    font-family: var(--font-mono, monospace);
  }
</style>
