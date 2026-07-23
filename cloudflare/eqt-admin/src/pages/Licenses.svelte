<script lang="ts">
  import { onMount } from 'svelte';
  import { adminFetch } from '../lib/api';

  interface Activation {
    device_fingerprint: string;
    device_name?: string;
    activated_at: string;
  }

  interface License {
    id: number;
    license_code: string;
    tier: string;
    status: string;
    max_devices: number;
    expires_at: string;
    buyer_email?: string;
    buyer_email_hash?: string;
    paddle_transaction_id?: string;
    created_at: string;
    active_devices_count: number;
    activations: Activation[];
  }

  let licenses = $state<License[]>([]);
  let loading = $state(true);
  let errorMsg = $state('');
  let searchQuery = $state('');

  // Modals
  let showGenerateModal = $state(false);
  let selectedLicense = $state<License | null>(null);
  let showRevokeConfirm = $state(false);
  let showUnbindConfirm = $state(false);

  // Form states for Generation
  let genTier = $state('PLUS');
  let genMaxDevices = $state(2);
  let genExpiresInDays = $state<number | null>(null);

  async function loadLicenses() {
    loading = true;
    errorMsg = '';
    try {
      const data = await adminFetch(`/api/v1/admin/licenses?q=${encodeURIComponent(searchQuery)}`);
      licenses = data.licenses || [];
    } catch (err: any) {
      errorMsg = err.message || '加载授权列表失败';
    } finally {
      loading = false;
    }
  }

  async function handleGenerate(e: SubmitEvent) {
    e.preventDefault();
    try {
      await adminFetch('/api/v1/admin/generate', {
        method: 'POST',
        body: JSON.stringify({
          tier: genTier,
          max_devices: genMaxDevices,
          expires_in_days: genExpiresInDays
        })
      });
      showGenerateModal = false;
      await loadLicenses();
    } catch (err: any) {
      alert('生成授权码失败: ' + err.message);
    }
  }

  async function handleRevoke() {
    if (!selectedLicense) return;
    try {
      await adminFetch('/api/v1/admin/revoke', {
        method: 'POST',
        body: JSON.stringify({ license_code: selectedLicense.license_code })
      });
      showRevokeConfirm = false;
      selectedLicense = null;
      await loadLicenses();
    } catch (err: any) {
      alert('吊销授权失败: ' + err.message);
    }
  }

  async function handleUnbind(deviceFingerprint?: string) {
    if (!selectedLicense) return;
    try {
      await adminFetch('/api/v1/admin/unbind', {
        method: 'POST',
        body: JSON.stringify({
          license_code: selectedLicense.license_code,
          device_fingerprint: deviceFingerprint
        })
      });
      showUnbindConfirm = false;
      selectedLicense = null;
      await loadLicenses();
    } catch (err: any) {
      alert('设备解绑失败: ' + err.message);
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
      <button class="btn btn-primary" onclick={() => (showGenerateModal = true)}>
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
          {#each licenses as lic (lic.id)}
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
              <td>{lic.buyer_email || lic.buyer_email_hash?.slice(0, 10) + '...' || '-'}</td>
              <td>{new Date(lic.created_at).toLocaleDateString()}</td>
              <td>
                <div class="action-btns">
                  <button
                    class="btn btn-secondary btn-sm"
                    onclick={() => { selectedLicense = lic; showUnbindConfirm = true; }}
                  >
                    解绑设备
                  </button>
                  {#if lic.status === 'active'}
                    <button
                      class="btn btn-danger btn-sm"
                      onclick={() => { selectedLicense = lic; showRevokeConfirm = true; }}
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

<!-- Modal: Generate License -->
{#if showGenerateModal}
  <div class="modal-overlay" onclick={() => (showGenerateModal = false)} role="presentation">
    <div class="modal-content" onclick={(e) => e.stopPropagation()} role="dialog">
      <h3>手动生成授权码</h3>
      <form onsubmit={handleGenerate} class="gen-form">
        <div class="form-group">
          <label for="tier-select">订阅类型 (Tier):</label>
          <select id="tier-select" class="input" bind:value={genTier}>
            <option value="PLUS">PLUS (个人终身/专业包)</option>
            <option value="PRO">PRO (高级团队包)</option>
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

        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick={() => (showGenerateModal = false)}>取消</button>
          <button type="submit" class="btn btn-primary">立即生成</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- Modal: Revoke Confirmation -->
{#if showRevokeConfirm && selectedLicense}
  <div class="modal-overlay" onclick={() => (showRevokeConfirm = false)} role="presentation">
    <div class="modal-content" onclick={(e) => e.stopPropagation()} role="dialog">
      <h3 style="color: var(--accent-danger);">高危操作确认：吊销授权</h3>
      <p class="confirm-text">
        确定要吊销授权码 <strong>{selectedLicense.license_code}</strong> 吗？<br />
        吊销后客户端下次同步时将强制作废并擦除本地 `.lic` 凭证。
      </p>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={() => (showRevokeConfirm = false)}>取消</button>
        <button class="btn btn-danger" onclick={handleRevoke}>确认吊销</button>
      </div>
    </div>
  </div>
{/if}

<!-- Modal: Unbind Devices -->
{#if showUnbindConfirm && selectedLicense}
  <div class="modal-overlay" onclick={() => (showUnbindConfirm = false)} role="presentation">
    <div class="modal-content" onclick={(e) => e.stopPropagation()} role="dialog">
      <h3>设备解绑管理</h3>
      <p class="subtitle">授权码: {selectedLicense.license_code}</p>

      {#if selectedLicense.activations.length === 0}
        <div class="empty-state">目前该授权码下未绑定任何硬件设备。</div>
      {:else}
        <div class="device-list">
          {#each selectedLicense.activations as act}
            <div class="device-item card">
              <div>
                <div class="dev-name">{act.device_name || '未命名设备'}</div>
                <div class="dev-fp">{act.device_fingerprint}</div>
                <div class="dev-time">激活于: {new Date(act.activated_at).toLocaleString()}</div>
              </div>
              <button class="btn btn-danger btn-sm" onclick={() => handleUnbind(act.device_fingerprint)}>
                解绑此设备
              </button>
            </div>
          {/each}
        </div>
      {/if}

      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={() => (showUnbindConfirm = false)}>关闭</button>
        {#if selectedLicense.activations.length > 0}
          <button class="btn btn-danger" onclick={() => handleUnbind()}>一键清空所有设备</button>
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
  .code-text { font-family: var(--font-mono); font-weight: 600; color: var(--accent-primary); }

  .btn-sm { padding: 0.35rem 0.75rem; font-size: 0.75rem; }
  .action-btns { display: flex; gap: 0.5rem; }

  .gen-form { display: flex; flex-direction: column; gap: 1rem; margin-top: 1rem; }
  .confirm-text { margin: 1rem 0; color: var(--text-secondary); line-height: 1.6; }

  .device-list { display: flex; flex-direction: column; gap: 0.75rem; margin: 1rem 0; }
  .device-item { display: flex; justify-content: space-between; align-items: center; padding: 0.85rem; }
  .dev-name { font-weight: 600; color: var(--text-primary); }
  .dev-fp { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-muted); }
  .dev-time { font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem; }

  .modal-footer { display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1.5rem; }
  .loading-state, .empty-state { text-align: center; padding: 3rem; color: var(--text-muted); }
  .error-banner { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; padding: 0.75rem; border-radius: var(--radius-sm); }
</style>
