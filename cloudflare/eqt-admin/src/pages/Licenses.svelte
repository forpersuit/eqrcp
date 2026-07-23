<script lang="ts">
  import { onMount } from 'svelte';
  import { adminFetch } from '../lib/api';
  import type {
    Activation,
    GenerateLicenseResponse,
    License,
    LicenseTier
  } from '../lib/types';

  let licenses = $state<License[]>([]);
  let loading = $state(true);
  let errorMsg = $state('');
  let actionMsg = $state('');
  let searchQuery = $state('');

  let showGenerateModal = $state(false);
  let selectedLicense = $state<License | null>(null);
  let showRevokeConfirm = $state(false);
  let showUnbindConfirm = $state(false);
  let generating = $state(false);
  let actionBusy = $state(false);

  let genTier = $state<LicenseTier>('PLUS');
  let genMaxDevices = $state(2);
  let genExpiresInDays = $state<string>('');
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

  async function loadLicenses() {
    loading = true;
    errorMsg = '';
    try {
      const params: Record<string, string> = {};
      if (searchQuery.trim()) params.q = searchQuery.trim();
      const data = await adminFetch<{ licenses: License[] }>('/api/v1/admin/licenses', { params });
      licenses = data.licenses || [];
    } catch (err: any) {
      errorMsg = err.message || '加载授权列表失败';
      licenses = [];
    } finally {
      loading = false;
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

      const res = await adminFetch<GenerateLicenseResponse>('/api/v1/admin/generate', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      lastGeneratedCode = res.license_code;
      actionMsg = `已生成授权码 ${res.license_code}`;
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
  });
</script>

<div class="page-container">
  <div class="header-row">
    <div>
      <h2>授权码与订单管控</h2>
      <p class="subtitle">全库授权检索、手动发码、吊销与设备解绑</p>
    </div>
    <div class="actions">
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
      <button class="btn btn-secondary" onclick={loadLicenses} disabled={loading}>
        搜索
      </button>
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
  .search-group { display: flex; gap: 0.75rem; width: 100%; }

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
