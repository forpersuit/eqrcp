<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { adminFetch } from '../lib/api';
  import { t } from '../lib/i18n';
  import { adminEnv } from '../lib/env.svelte';
  import Modal from '../components/Modal.svelte';
  import Banner from '../components/Banner.svelte';
  import Pagination from '../components/Pagination.svelte';
  import type {
    Activation,
    BetaTester,
    GenerateLicenseResponse,
    License,
    LicenseTier
  } from '../lib/types';

  interface Props {
    prefillQuery?: string;
  }
  let { prefillQuery = '' }: Props = $props();

  const AUTO_REFRESH_MS = 20_000;

  let licenses = $state<License[]>([]);
  let total = $state(0);
  let page = $state(1);
  const pageSize = 50;
  let loading = $state(true);
  let refreshing = $state(false);
  let errorMsg = $state('');
  let actionMsg = $state('');
  let searchQuery = $state('');
  let lastRefreshedAt = $state<string>('');
  let autoRefresh = $state(true);
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  let showGenerateModal = $state(false);
  let selectedLicense = $state<License | null>(null);
  let showRevokeConfirm = $state(false);
  let showUnbindConfirm = $state(false);
  let generating = $state(false);
  let quickMinting = $state(false);
  let actionBusy = $state(false);

  let genTier = $state<LicenseTier>('PLUS');
  let genMaxDevices = $state(2);
  /** admin = 客服补发；promo = 活动码；test = 沙箱内测专属码 */
  let genSource = $state<'admin' | 'promo' | 'test'>('admin');
  let genExpiresInDays = $state<string>('');
  let genDurationDays = $state<string>('');
  let genBuyerEmail = $state('');
  let genBoundDeviceId = $state('');
  let genSendEmail = $state(false);
  let lastGeneratedCode = $state<string | null>(null);
  let copyHint = $state('');

  function shortHash(value?: string | null): string {
    if (!value) return '—';
    return value.length > 10 ? value.slice(0, 10) + '…' : value;
  }

  function deviceTitle(act: Activation): string {
    if (act.device_id) return act.device_id;
    return `Activation #${act.id}`;
  }

  function deviceSubtitle(act: Activation): string {
    return `uuid:${shortHash(act.uuid_hash)} · cpu:${shortHash(act.cpu_hash)} · disk:${shortHash(act.disk_hash)}`;
  }

  function deviceNetworkLine(act: Activation): string {
    const locParts = [act.last_city, act.last_region, act.last_country || act.ip_country].filter(Boolean);
    const ip = act.last_ip || act.client_ip;
    const parts = [...locParts, ip].filter(Boolean);
    return parts.length ? parts.join(' · ') : $t('licenses.noIpRecorded');
  }

  function latestActivationHint(lic: License): string {
    if (!lic.activations?.length) return '';
    const sorted = [...lic.activations].sort((a, b) =>
      String(b.last_seen_at || b.activated_at || '').localeCompare(String(a.last_seen_at || a.activated_at || ''))
    );
    const latest = sorted[0];
    if (!latest) return '';
    const geo = latest.last_country || latest.ip_country || latest.last_ip || latest.client_ip;
    if (!geo) return '';
    const country = latest.last_country || latest.ip_country;
    const ip = latest.last_ip || latest.client_ip;
    return country ? `${country}${ip ? ' ' + ip : ''}` : String(ip);
  }

  async function loadLicenses(opts: { silent?: boolean } = {}) {
    const silent = !!opts.silent;
    if (silent) {
      refreshing = true;
    } else {
      loading = true;
    }
    if (!silent) errorMsg = '';
    try {
      const offset = (page - 1) * pageSize;
      const params: Record<string, string> = {
        limit: String(pageSize),
        offset: String(offset)
      };
      if (searchQuery.trim()) params.q = searchQuery.trim();
      const data = await adminFetch<{ licenses: License[]; total?: number }>('/api/v1/admin/licenses', { params });
      licenses = data.licenses || [];
      total = typeof data.total === 'number' ? data.total : licenses.length;
      if (selectedLicense) {
        const refreshed = licenses.find((l) => l.license_code === selectedLicense?.license_code);
        if (refreshed) selectedLicense = refreshed;
      }
      lastRefreshedAt = new Date().toLocaleTimeString();
    } catch (err: any) {
      if (!silent) {
        errorMsg = err.message || $t('common.failed');
        licenses = [];
        total = 0;
      }
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  function handleSearch() {
    page = 1;
    loadLicenses();
  }

  function prevPage() {
    if (page > 1) {
      page--;
      loadLicenses();
    }
  }

  function nextPage() {
    if (page * pageSize < total) {
      page++;
      loadLicenses();
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (!showGenerateModal && !showRevokeConfirm && !showUnbindConfirm) {
        loadLicenses({ silent: true });
      }
    }, AUTO_REFRESH_MS);
  }

  function stopAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  async function handleQuickMintTestLicense(devId?: string | null, email?: string | null) {
    quickMinting = true;
    errorMsg = '';
    actionMsg = '';
    try {
      const res = await adminFetch<any>('/api/v1/admin/sandbox/mint-test-license', {
        method: 'POST',
        body: JSON.stringify({
          device_id: devId || undefined,
          email: email || undefined,
          expires_in_days: 30,
          duration_days: 30
        })
      });
      actionMsg = $t('licenses.quickMintSuccess', { code: res.license_code });
      lastGeneratedCode = res.license_code;
      await loadLicenses();
    } catch (err: any) {
      errorMsg = $t('common.failed') + ': ' + (err.message || String(err));
    } finally {
      quickMinting = false;
    }
  }

  async function handleGenerate(e: Event) {
    e.preventDefault();
    generating = true;
    errorMsg = '';
    actionMsg = '';
    lastGeneratedCode = null;
    copyHint = '';

    const body: Record<string, any> = {
      tier: genTier,
      max_devices: genMaxDevices,
      source: genSource
    };

    if (genSource === 'promo' || genSource === 'test') {
      const expDays = parseInt(genExpiresInDays.trim(), 10);
      const durDays = parseInt(genDurationDays.trim(), 10);
      if (isNaN(expDays) || expDays <= 0) {
        errorMsg = $t('licenses.errPromoRedeemDays');
        generating = false;
        return;
      }
      if (isNaN(durDays) || durDays <= 0) {
        errorMsg = $t('licenses.errPromoDurationDays');
        generating = false;
        return;
      }
      body.expires_in_days = expDays;
      body.duration_days = durDays;
    } else {
      if (genExpiresInDays.trim()) {
        const d = parseInt(genExpiresInDays.trim(), 10);
        if (!isNaN(d) && d > 0) body.expires_in_days = d;
      }
      if (genDurationDays.trim()) {
        const d = parseInt(genDurationDays.trim(), 10);
        if (!isNaN(d) && d > 0) body.duration_days = d;
      }
    }

    if (genBuyerEmail.trim()) {
      body.buyer_email = genBuyerEmail.trim();
      if (genSendEmail) {
        body.send_email = true;
      }
    }

    if (genBoundDeviceId.trim()) {
      body.bound_device_id = genBoundDeviceId.trim();
    }

    try {
      const res = await adminFetch<GenerateLicenseResponse>('/api/v1/admin/generate-license', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      lastGeneratedCode = res.license_code;
      let okText = `${$t('licenses.generateTitle')} ${$t('common.success')}: ${res.license_code} (${res.tier})`;
      if (res.email_sent !== undefined) {
        okText += res.email_sent ? ` · ${$t('licenses.emailSent')}` : ` · ${$t('licenses.emailNotSent')}`;
      }
      actionMsg = okText;
      await loadLicenses();
    } catch (err: any) {
      errorMsg = $t('common.failed') + ': ' + (err.message || String(err));
    } finally {
      generating = false;
    }
  }

  async function copyGeneratedCode() {
    if (!lastGeneratedCode) return;
    try {
      await navigator.clipboard.writeText(lastGeneratedCode);
      copyHint = $t('common.copied');
      setTimeout(() => {
        copyHint = '';
      }, 2000);
    } catch {
      copyHint = $t('common.failed');
    }
  }

  async function handleRevoke() {
    if (!selectedLicense) return;
    actionBusy = true;
    errorMsg = '';
    try {
      await adminFetch('/api/v1/admin/revoke', {
        method: 'POST',
        body: JSON.stringify({ license_code: selectedLicense.license_code })
      });
      actionMsg = `${$t('licenses.revokeSuccess')}: ${selectedLicense.license_code}`;
      showRevokeConfirm = false;
      selectedLicense = null;
      await loadLicenses();
    } catch (err: any) {
      errorMsg = $t('common.failed') + ': ' + (err.message || String(err));
    } finally {
      actionBusy = false;
    }
  }

  async function handleUnbind(activationId?: number) {
    if (!selectedLicense) return;
    actionBusy = true;
    errorMsg = '';
    try {
      const body: { license_code: string; activation_id?: number } = {
        license_code: selectedLicense.license_code
      };
      if (activationId !== undefined) {
        body.activation_id = activationId;
      }
      await adminFetch('/api/v1/admin/unbind', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      actionMsg =
        activationId !== undefined
          ? `${$t('licenses.unbindSuccess')} (activation #${activationId})`
          : `${$t('licenses.unbindAllSuccess')} (${selectedLicense.license_code})`;
      await loadLicenses();
      const refreshed = licenses.find((l) => l.license_code === selectedLicense?.license_code);
      if (refreshed) {
        selectedLicense = refreshed;
        if (refreshed.activations.length === 0) {
          showUnbindConfirm = false;
          selectedLicense = null;
        }
      } else {
        showUnbindConfirm = false;
        selectedLicense = null;
      }
    } catch (err: any) {
      errorMsg = $t('common.failed') + ': ' + (err.message || String(err));
    } finally {
      actionBusy = false;
    }
  }

  let prevPrefill = '';
  $effect(() => {
    if (prefillQuery && prefillQuery !== prevPrefill) {
      prevPrefill = prefillQuery;
      searchQuery = prefillQuery;
      page = 1;
      loadLicenses();
    }
  });

  onMount(() => {
    if (!prefillQuery) {
      loadLicenses();
    }
    startAutoRefresh();
  });

  onDestroy(() => {
    stopAutoRefresh();
  });
</script>

<div class="page-container">
  <div class="header-row">
    <div>
      <h2>{$t('licenses.title')}</h2>
      <p class="subtitle">{$t('licenses.subtitle')}</p>
    </div>
    <div class="actions">
      <label class="auto-refresh-toggle" title={$t('licenses.autoRefresh')}>
        <input
          type="checkbox"
          bind:checked={autoRefresh}
          onchange={() => (autoRefresh ? startAutoRefresh() : stopAutoRefresh())}
        />
        {$t('licenses.autoRefresh')}
      </label>
      <button class="btn btn-secondary btn-sm" onclick={() => loadLicenses()} disabled={loading || refreshing}>
        {refreshing ? $t('common.loading') : $t('licenses.manualRefresh')}
      </button>
      <button class="btn btn-primary btn-sm" onclick={() => { showGenerateModal = true; lastGeneratedCode = null; copyHint = ''; }}>
        + {$t('licenses.generateTitle')}
      </button>
    </div>
  </div>

  <div class="filter-bar card">
    <div class="search-group">
      <div class="search-input-wrap">
        <input
          type="text"
          class="input"
          placeholder={$t('licenses.searchPlaceholder')}
          bind:value={searchQuery}
          onkeydown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <button class="search-icon-btn" onclick={handleSearch} disabled={loading} title={$t('common.search')} aria-label={$t('common.search')}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </button>
      </div>
      {#if lastRefreshedAt}
        <span class="refresh-meta">{$t('licenses.lastUpdated')} {lastRefreshedAt}{refreshing ? ' · ...' : ''}</span>
      {/if}
    </div>
  </div>

  <Banner type="error" message={errorMsg} />
  <Banner type="ok" message={actionMsg} />

  {#if loading}
    <div class="loading-state">{$t('common.loading')}</div>
  {:else if licenses.length === 0}
    <div class="empty-state card">{$t('licenses.emptyState')}</div>
  {:else}
    <div class="table-container card">
      <table class="data-table">
        <thead>
          <tr>
            <th>{$t('licenses.tableHeaderCode')}</th>
            <th>{$t('licenses.tableHeaderTier')}</th>
            <th>{$t('licenses.source')}</th>
            <th>{$t('licenses.tableHeaderStatus')}</th>
            <th>{$t('licenses.tableHeaderDevices')}</th>
            <th>{$t('licenses.tableHeaderBuyer')}</th>
            <th>{$t('common.created_at')}</th>
            <th>{$t('licenses.tableHeaderActions')}</th>
          </tr>
        </thead>
        <tbody>
          {#each licenses as lic (lic.license_code)}
            <tr>
              <td>
                <span class="code-text">{lic.license_code}</span>
              </td>
              <td><span class="badge badge-active">{lic.tier}</span></td>
              <td>
                <span class={`badge badge-${lic.source || 'admin'}`} title={$t('licenses.sourceHintTooltip')}>
                  {lic.source ? ($t('licenses.sourceBadge.' + lic.source) || lic.source) : '—'}
                </span>
              </td>
              <td>
                <span class={`badge badge-${lic.status === 'active' ? 'active' : 'revoked'}`}>
                  {lic.status === 'active' ? $t('common.active') : $t('common.revoked')}{lic.revoke_reason ? ` · ${lic.revoke_reason}` : ''}
                </span>
              </td>
              <td>
                <span class="device-info">
                  {lic.active_devices_count} / {lic.max_devices}
                </span>
                {#if latestActivationHint(lic)}
                  <div class="device-geo-hint">
                    {latestActivationHint(lic)}
                  </div>
                {/if}
              </td>
              <td>
                {lic.buyer_email ||
                  (lic.buyer_email_hash ? shortHash(lic.buyer_email_hash) : '-')}
              </td>
              <td>{lic.created_at ? new Date(lic.created_at).toLocaleDateString() : '-'}</td>
              <td>
                <div class="action-btns">
                  <button
                    class="btn btn-secondary btn-sm"
                    onclick={() => {
                      selectedLicense = lic;
                      showUnbindConfirm = true;
                    }}
                  >
                    {$t('licenses.unbindBtn')}
                  </button>
                  {#if lic.status === 'active'}
                    <button
                      class="btn btn-danger btn-sm"
                      onclick={() => {
                        selectedLicense = lic;
                        showRevokeConfirm = true;
                      }}
                    >
                      {$t('licenses.revokeBtn')}
                    </button>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <Pagination {page} {pageSize} {total} onprev={prevPage} onnext={nextPage} />
  {/if}
</div>

{#if showGenerateModal}
  <Modal open={true} title={$t('licenses.generateTitle')} maxWidth="600px" onclose={() => (showGenerateModal = false)}>
    <form onsubmit={handleGenerate} class="gen-form">
      <div class="form-group">
        <label for="source-select">{$t('licenses.source')}:</label>
        <select id="source-select" class="input" bind:value={genSource}>
          <option value="admin">{$t('licenses.sourceAdmin')}</option>
          <option value="promo">{$t('licenses.sourcePromo')}</option>
          {#if adminEnv.current === 'test'}
            <option value="test">{$t('licenses.sourceTest')}</option>
          {/if}
        </select>
        <p class="field-hint">{$t('licenses.sourceHint')}</p>
      </div>

      <div class="form-group">
        <label for="tier-select">{$t('licenses.tier')}:</label>
        <select id="tier-select" class="input" bind:value={genTier}>
          <option value="PLUS">PLUS</option>
          <option value="PRO">PRO</option>
        </select>
      </div>

      <div class="form-group">
        <label for="max-dev">{$t('licenses.maxDevices')}:</label>
        <input id="max-dev" type="number" class="input" bind:value={genMaxDevices} min="1" max="50" required />
      </div>

      <div class="form-group">
        <label for="exp-days">
          {genSource === 'promo' || genSource === 'test' ? $t('licenses.redeemDays') : $t('licenses.expiresDays')}
        </label>
        <input id="exp-days" type="number" class="input" placeholder={genSource === 'promo' || genSource === 'test' ? $t('licenses.redeemPlaceholder') : $t('licenses.expiresPlaceholder')} bind:value={genExpiresInDays} min="1" />
      </div>

      <div class="form-group">
        <label for="dur-days">
          {genSource === 'promo' || genSource === 'test' ? $t('licenses.durationDaysPromo') : $t('licenses.durationDaysAdmin')}
        </label>
        <input id="dur-days" type="number" class="input" placeholder={genSource === 'promo' || genSource === 'test' ? $t('licenses.durationPromoPlaceholder') : $t('licenses.durationAdminPlaceholder')} bind:value={genDurationDays} min="0" />
      </div>

      <div class="form-group">
        <label for="bound-dev">{$t('licenses.boundDeviceId')}:</label>
        <input id="bound-dev" type="text" class="input" placeholder={$t('licenses.boundDevicePlaceholder')} bind:value={genBoundDeviceId} />
        <p class="field-hint">{$t('licenses.boundDeviceHint')}</p>
      </div>

      <div class="form-group">
        <label for="buyer-email">{$t('licenses.buyerEmail')}:</label>
        <input id="buyer-email" type="email" class="input" placeholder={$t('licenses.buyerEmailPlaceholder')} bind:value={genBuyerEmail} />
      </div>

      {#if genBuyerEmail.trim()}
        <div class="form-group checkbox-group">
          <label for="send-email-check" class="checkbox-label">
            <input id="send-email-check" type="checkbox" bind:checked={genSendEmail} />
            {$t('licenses.sendEmailCheck')}
          </label>
        </div>
      {/if}

      {#if lastGeneratedCode}
        <div class="generated-box">
          <div class="gen-label">{$t('licenses.newLicenseAlert')}</div>
          <div class="gen-code-row">
            <code class="gen-code">{lastGeneratedCode}</code>
            <button type="button" class="btn btn-secondary btn-sm" onclick={copyGeneratedCode}>{$t('common.copy')}</button>
          </div>
          {#if copyHint}
            <div class="copy-hint">{copyHint}</div>
          {/if}
        </div>
      {/if}
    </form>
    {#snippet footer()}
      <button type="button" class="btn btn-secondary" onclick={() => (showGenerateModal = false)}>{$t('common.close')}</button>
      <button type="button" class="btn btn-primary" disabled={generating} onclick={handleGenerate}>
        {generating ? $t('licenses.generating') : $t('licenses.generateBtn')}
      </button>
    {/snippet}
  </Modal>
{/if}

{#if showRevokeConfirm && selectedLicense}
  <Modal open={true} title={$t('licenses.revokeTitle')} maxWidth="480px" onclose={() => (showRevokeConfirm = false)}>
    <p class="confirm-text">
      {$t('licenses.revokeConfirmText', { code: selectedLicense.license_code })}
    </p>
    {#snippet footer()}
      <button class="btn btn-secondary" onclick={() => (showRevokeConfirm = false)} disabled={actionBusy}>{$t('common.cancel')}</button>
      <button class="btn btn-danger" onclick={handleRevoke} disabled={actionBusy}>
        {actionBusy ? $t('common.loading') : $t('licenses.revokeBtn')}
      </button>
    {/snippet}
  </Modal>
{/if}

{#if showUnbindConfirm && selectedLicense}
  <Modal open={true} title={$t('licenses.unbindTitle')} maxWidth="580px" onclose={() => (showUnbindConfirm = false)}>
    <p class="subtitle">{$t('licenses.unbindSubtitle', { code: selectedLicense.license_code })}</p>

    {#if !selectedLicense.activations?.length}
      <div class="empty-state">{$t('licenses.noDevices')}</div>
    {:else}
      <div class="device-list">
        {#each selectedLicense.activations as act (act.id)}
          <div class="device-item card">
            <div class="device-item-content">
              <div class="dev-name-row">
                <span class="dev-name">{deviceTitle(act)}</span>
                {#if act.app_version}
                  <span class="badge badge-active dev-ver-badge">v{act.app_version}</span>
                {/if}
              </div>
              <div class="dev-fp">{deviceSubtitle(act)}</div>
              <div class="dev-metrics-grid">
                <div class="dev-metric-item">
                  <span class="metric-label">{$t('licenses.activatedAt')}:</span>
                  <span class="metric-val">{act.activated_at ? new Date(act.activated_at).toLocaleString() : '-'}</span>
                </div>
                {#if act.last_seen_at}
                  <div class="dev-metric-item">
                    <span class="metric-label">{$t('licenses.lastSeenAt')}:</span>
                    <span class="metric-val highlight-seen">{new Date(act.last_seen_at).toLocaleString()}</span>
                  </div>
                {/if}
                <div class="dev-metric-item">
                  <span class="metric-label">{$t('licenses.network')}:</span>
                  <span class="metric-val" title={act.user_agent || ''}>{deviceNetworkLine(act)}</span>
                </div>
              </div>
            </div>
            <button
              class="btn btn-danger btn-sm"
              disabled={actionBusy}
              onclick={() => handleUnbind(act.id)}
            >
              {$t('licenses.unbindSingle')}
            </button>
          </div>
        {/each}
      </div>
    {/if}

    {#snippet footer()}
      <button class="btn btn-secondary" onclick={() => (showUnbindConfirm = false)} disabled={actionBusy}>{$t('common.close')}</button>
      {#if selectedLicense?.activations?.length}
        <button class="btn btn-danger" disabled={actionBusy} onclick={() => handleUnbind()}>
          {$t('licenses.unbindAllBtn')}
        </button>
      {/if}
    {/snippet}
  </Modal>
{/if}

<style>
  .page-container { display: flex; flex-direction: column; gap: 1.5rem; }
  .header-row { display: flex; justify-content: space-between; align-items: center; }
  h2 { font-size: 1.5rem; font-weight: 700; }
  .subtitle { font-size: 0.875rem; color: var(--text-muted); }
  .filter-bar { padding: 1rem 1.5rem; }
  .search-group { display: flex; gap: 0.75rem; width: 100%; align-items: center; flex-wrap: wrap; }
  .actions { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; }
  .auto-refresh-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.8rem;
    color: var(--text-secondary);
    cursor: pointer;
    user-select: none;
  }
  .refresh-meta { font-size: 0.75rem; color: var(--text-muted); white-space: nowrap; }
  .device-geo-hint {
    margin-top: 0.25rem;
    font-size: 0.7rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }
  .dev-net {
    margin-top: 0.2rem;
    font-size: 0.75rem;
    color: var(--accent-primary);
    font-family: var(--font-mono);
    opacity: 0.9;
  }

  .table-container { padding: 0; overflow-x: auto; }
  .data-table { width: 100%; border-collapse: collapse; text-align: left; }
  .data-table th, .data-table td { padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-color); }
  .data-table th { font-size: 0.8rem; color: var(--text-muted); background: rgba(15, 23, 42, 0.4); text-transform: uppercase; }
  .code-text { font-family: var(--font-mono); font-weight: 600; color: var(--accent-primary); font-size: 0.85rem; }

  .btn-sm { padding: 0.35rem 0.75rem; font-size: 0.75rem; }
  .action-btns { display: flex; gap: 0.5rem; }

  .gen-form { display: flex; flex-direction: column; gap: 1rem; margin-top: 1rem; }
  .field-hint { margin: 0.35rem 0 0; font-size: 0.75rem; color: var(--text-muted); line-height: 1.4; }
  .form-group label { display: block; font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.4rem; }
  .confirm-text { margin: 1rem 0; color: var(--text-secondary); line-height: 1.6; }

  .generated-box {
    background: rgba(16, 185, 129, 0.1);
    border: 1px solid rgba(16, 185, 129, 0.35);
    border-radius: var(--radius-sm);
    padding: 0.85rem 1rem;
  }
  .gen-label { font-size: 0.8rem; color: var(--accent-success); margin-bottom: 0.5rem; }
  .gen-code-row { display: flex; gap: 0.75rem; align-items: center; }
  .gen-code {
    font-family: var(--font-mono);
    font-size: 0.9rem;
    color: var(--text-primary);
    word-break: break-all;
    flex: 1;
  }
  .copy-hint { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.4rem; }

  .device-list { display: flex; flex-direction: column; gap: 0.75rem; margin: 1rem 0; }
  .device-item { display: flex; justify-content: space-between; align-items: center; padding: 0.85rem; gap: 1rem; }
  .device-item-content { flex: 1; min-width: 0; }
  .dev-name-row { display: flex; align-items: center; gap: 0.5rem; }
  .dev-name { font-weight: 600; color: var(--text-primary); }
  .dev-ver-badge { font-size: 0.65rem; padding: 1px 6px; }
  .dev-fp { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-muted); margin-top: 0.2rem; }
  .dev-metrics-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1.25rem;
    margin-top: 0.4rem;
    font-size: 0.75rem;
  }
  .dev-metric-item { display: flex; align-items: center; gap: 0.35rem; }
  .metric-label { color: var(--text-muted); }
  .metric-val { color: var(--text-secondary); }
  .highlight-seen { color: var(--accent-primary); font-weight: 600; }

  .loading-state, .empty-state { text-align: center; padding: 3rem; color: var(--text-muted); }
</style>
