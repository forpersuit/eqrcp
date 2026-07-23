<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { adminFetch } from '../lib/api';
  import type {
    Activation,
    GenerateLicenseResponse,
    License,
    LicenseTier
  } from '../lib/types';

  const AUTO_REFRESH_MS = 20_000;

  let licenses = $state<License[]>([]);
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
  let actionBusy = $state(false);

  let genTier = $state<LicenseTier>('PLUS');
  let genMaxDevices = $state(2);
  let genExpiresInDays = $state<string>('');
  let genBuyerEmail = $state('');
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
    const parts: string[] = [];
    if (act.ip_country) parts.push(act.ip_country);
    if (act.client_ip) parts.push(act.client_ip);
    return parts.length ? parts.join(' · ') : 'IP 未记录（旧激活）';
  }

  function latestActivationHint(lic: License): string {
    if (!lic.activations?.length) return '';
    const sorted = [...lic.activations].sort((a, b) =>
      String(b.activated_at || '').localeCompare(String(a.activated_at || ''))
    );
    const latest = sorted[0];
    if (!latest) return '';
    const geo = latest.ip_country || latest.client_ip;
    if (!geo) return '';
    return latest.ip_country
      ? `${latest.ip_country}${latest.client_ip ? ' ' + latest.client_ip : ''}`
      : String(latest.client_ip);
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
      const params: Record<string, string> = {};
      if (searchQuery.trim()) params.q = searchQuery.trim();
      const data = await adminFetch<{ licenses: License[] }>('/api/v1/admin/licenses', { params });
      licenses = data.licenses || [];
      // Keep unbind modal selection in sync when silent refresh brings new activations
      if (selectedLicense) {
        const refreshed = licenses.find((l) => l.license_code === selectedLicense?.license_code);
        if (refreshed) selectedLicense = refreshed;
      }
      lastRefreshedAt = new Date().toLocaleTimeString();
    } catch (err: any) {
      if (!silent) {
        errorMsg = err.message || '加载授权列表失败';
        licenses = [];
      }
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    if (!autoRefresh) return;
    refreshTimer = setInterval(() => {
      if (actionBusy || generating || showGenerateModal) return;
      loadLicenses({ silent: true });
    }, AUTO_REFRESH_MS);
  }

  function stopAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  async function handleGenerate(e: SubmitEvent) {
    e.preventDefault();
    generating = true;
    errorMsg = '';
    actionMsg = '';
    lastGeneratedCode = null;
    copyHint = '';
    try {
      const body: Record<string, unknown> = {
        tier: genTier,
        max_devices: Number(genMaxDevices) || 2
      };
      const days = genExpiresInDays.trim() ? Number(genExpiresInDays) : null;
      if (days && days > 0) {
        body.expires_in_days = days;
      }
      if (genBuyerEmail.trim()) {
        body.buyer_email = genBuyerEmail.trim();
        body.send_email = genSendEmail;
      }

      const res = await adminFetch<GenerateLicenseResponse & { email_sent?: boolean }>('/api/v1/admin/generate', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      lastGeneratedCode = res.license_code;
      actionMsg = `已生成授权码 ${res.license_code}${res.email_sent ? '（通知邮件已并发投递）' : ''}`;
      await loadLicenses();
    } catch (err: any) {
      errorMsg = '生成授权码失败: ' + (err.message || String(err));
    } finally {
      generating = false;
    }
  }

  async function copyGeneratedCode() {
    if (!lastGeneratedCode) return;
    try {
      await navigator.clipboard.writeText(lastGeneratedCode);
      copyHint = '已复制到剪贴板';
    } catch {
      copyHint = '复制失败，请手动选择授权码';
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
      actionMsg = `已吊销 ${selectedLicense.license_code}`;
      showRevokeConfirm = false;
      selectedLicense = null;
      await loadLicenses();
    } catch (err: any) {
      errorMsg = '吊销授权失败: ' + (err.message || String(err));
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
          ? `已解绑 activation #${activationId}`
          : `已清空 ${selectedLicense.license_code} 下全部设备`;
      // refresh selected license devices without closing modal if single unbind
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
      errorMsg = '设备解绑失败: ' + (err.message || String(err));
    } finally {
      actionBusy = false;
    }
  }

  onMount(() => {
    loadLicenses();
    startAutoRefresh();
  });

  onDestroy(() => {
    stopAutoRefresh();
  });
</script>

<div class="page-container">
  <div class="header-row">
    <div>
      <h2>授权码与订单管控</h2>
      <p class="subtitle">全库授权检索、手动发码、吊销与设备解绑 · 列表 {AUTO_REFRESH_MS / 1000}s 近实时刷新</p>
    </div>
    <div class="actions">
      <label class="auto-refresh-toggle" title="静默轮询授权与设备绑定状态">
        <input
          type="checkbox"
          bind:checked={autoRefresh}
          onchange={() => (autoRefresh ? startAutoRefresh() : stopAutoRefresh())}
        />
        自动刷新
      </label>
      <button class="btn btn-secondary" onclick={() => loadLicenses()} disabled={loading || refreshing}>
        {refreshing ? '刷新中…' : '立即刷新'}
      </button>
      <button class="btn btn-primary" onclick={() => { showGenerateModal = true; lastGeneratedCode = null; copyHint = ''; }}>
        + 手动生成授权码
      </button>
    </div>
  </div>

  <div class="filter-bar card">
    <div class="search-group">
      <input
        type="text"
        class="input"
        placeholder="输入 Email、License Code 或 Paddle Transaction ID 回车检索..."
        bind:value={searchQuery}
        onkeydown={(e) => e.key === 'Enter' && loadLicenses()}
      />
      <button class="btn btn-secondary" onclick={() => loadLicenses()} disabled={loading}>
        搜索
      </button>
      {#if lastRefreshedAt}
        <span class="refresh-meta">上次更新 {lastRefreshedAt}{refreshing ? ' · 同步中' : ''}</span>
      {/if}
    </div>
  </div>

  {#if errorMsg}
    <div class="error-banner">{errorMsg}</div>
  {/if}
  {#if actionMsg}
    <div class="ok-banner">{actionMsg}</div>
  {/if}

  {#if loading}
    <div class="loading-state">正在查询全库授权数据...</div>
  {:else if licenses.length === 0}
    <div class="empty-state card">未找到符合条件的授权记录</div>
  {:else}
    <div class="table-container card">
      <table class="data-table">
        <thead>
          <tr>
            <th>授权码 (License Code)</th>
            <th>类型</th>
            <th>状态</th>
            <th>设备配额</th>
            <th>买家 Email</th>
            <th>生成时间</th>
            <th>操作</th>
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
                <span class={`badge badge-${lic.status === 'active' ? 'active' : 'revoked'}`}>
                  {lic.status}
                </span>
              </td>
              <td>
                <span class="device-info">
                  {lic.active_devices_count} / {lic.max_devices}
                </span>
                {#if latestActivationHint(lic)}
                  <div class="device-geo-hint" title="最近一次激活的 IP / 国家">
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
                    解绑设备
                  </button>
                  {#if lic.status === 'active'}
                    <button
                      class="btn btn-danger btn-sm"
                      onclick={() => {
                        selectedLicense = lic;
                        showRevokeConfirm = true;
                      }}
                    >
                      吊销
                    </button>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

{#if showGenerateModal}
  <div class="modal-overlay" onclick={() => (showGenerateModal = false)} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="modal-content" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" tabindex="-1" aria-modal="true">
      <h3>手动生成授权码</h3>
      <form onsubmit={handleGenerate} class="gen-form">
        <div class="form-group">
          <label for="tier-select">订阅类型 (Tier):</label>
          <select id="tier-select" class="input" bind:value={genTier}>
            <option value="PLUS">PLUS</option>
            <option value="PRO">PRO</option>
          </select>
        </div>

        <div class="form-group">
          <label for="max-dev">最大绑定设备数:</label>
          <input id="max-dev" type="number" class="input" bind:value={genMaxDevices} min="1" max="50" required />
        </div>

        <div class="form-group">
          <label for="exp-days">有效期天数 (留空为 LIFETIME 永久):</label>
          <input id="exp-days" type="number" class="input" placeholder="例如 365" bind:value={genExpiresInDays} min="1" />
        </div>

        <div class="form-group">
          <label for="buyer-email">买家邮箱 (选填，用于绑定与开通通知):</label>
          <input id="buyer-email" type="email" class="input" placeholder="例如 buyer@example.com" bind:value={genBuyerEmail} />
        </div>

        {#if genBuyerEmail.trim()}
          <div class="form-group checkbox-group">
            <label for="send-email-check" class="checkbox-label">
              <input id="send-email-check" type="checkbox" bind:checked={genSendEmail} />
              自动向买家发送授权码通知邮件
            </label>
          </div>
        {/if}

        {#if lastGeneratedCode}
          <div class="generated-box">
            <div class="gen-label">新授权码（请立即复制保存）</div>
            <div class="gen-code-row">
              <code class="gen-code">{lastGeneratedCode}</code>
              <button type="button" class="btn btn-secondary btn-sm" onclick={copyGeneratedCode}>复制</button>
            </div>
            {#if copyHint}
              <div class="copy-hint">{copyHint}</div>
            {/if}
          </div>
        {/if}

        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick={() => (showGenerateModal = false)}>关闭</button>
          <button type="submit" class="btn btn-primary" disabled={generating}>
            {generating ? '生成中...' : '立即生成'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

{#if showRevokeConfirm && selectedLicense}
  <div class="modal-overlay" onclick={() => (showRevokeConfirm = false)} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="modal-content" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" tabindex="-1" aria-modal="true">
      <h3 class="danger-title">高危操作确认：吊销授权</h3>
      <p class="confirm-text">
        确定要吊销授权码 <strong>{selectedLicense.license_code}</strong> 吗？<br />
        吊销后客户端下次同步时将强制作废并擦除本地 <code>.lic</code> 凭证。
      </p>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={() => (showRevokeConfirm = false)} disabled={actionBusy}>取消</button>
        <button class="btn btn-danger" onclick={handleRevoke} disabled={actionBusy}>
          {actionBusy ? '处理中...' : '确认吊销'}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showUnbindConfirm && selectedLicense}
  <div class="modal-overlay" onclick={() => (showUnbindConfirm = false)} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="modal-content" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" tabindex="-1" aria-modal="true">
      <h3>设备解绑管理</h3>
      <p class="subtitle">授权码: {selectedLicense.license_code}</p>

      {#if !selectedLicense.activations?.length}
        <div class="empty-state">目前该授权码下未绑定任何硬件设备。</div>
      {:else}
        <div class="device-list">
          {#each selectedLicense.activations as act (act.id)}
            <div class="device-item card">
              <div>
                <div class="dev-name">{deviceTitle(act)}</div>
                <div class="dev-fp">{deviceSubtitle(act)}</div>
                <div class="dev-time">
                  激活于: {act.activated_at ? new Date(act.activated_at).toLocaleString() : '-'}
                </div>
                <div class="dev-net" title={act.user_agent || ''}>
                  网络: {deviceNetworkLine(act)}
                </div>
              </div>
              <button
                class="btn btn-danger btn-sm"
                disabled={actionBusy}
                onclick={() => handleUnbind(act.id)}
              >
                解绑此设备
              </button>
            </div>
          {/each}
        </div>
      {/if}

      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={() => (showUnbindConfirm = false)} disabled={actionBusy}>关闭</button>
        {#if selectedLicense.activations?.length}
          <button class="btn btn-danger" disabled={actionBusy} onclick={() => handleUnbind()}>
            一键清空所有设备
          </button>
        {/if}
      </div>
    </div>
  </div>
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
  .form-group label { display: block; font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.4rem; }
  .confirm-text { margin: 1rem 0; color: var(--text-secondary); line-height: 1.6; }
  .danger-title { color: var(--accent-danger); }

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
  .dev-name { font-weight: 600; color: var(--text-primary); }
  .dev-fp { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-muted); margin-top: 0.2rem; }
  .dev-time { font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem; }

  .modal-footer { display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1.5rem; }
  .loading-state, .empty-state { text-align: center; padding: 3rem; color: var(--text-muted); }
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
</style>
