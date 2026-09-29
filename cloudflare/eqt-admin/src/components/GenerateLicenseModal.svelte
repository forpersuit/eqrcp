<script lang="ts">
  import Modal from './Modal.svelte';
  import { adminFetch } from '../lib/api';
  import { adminEnv } from '../lib/env.svelte';
  import { t } from '../lib/i18n';
  import { exportLicensesToCsv, exportToTxt } from '../lib/export';
  import type {
    GenerateLicenseResponse,
    GenerateBatchResponse,
    BatchLicenseItem,
    License,
    LicenseTier
  } from '../lib/types';

  interface Props {
    open: boolean;
    onclose: () => void;
    ongenerated?: () => void;
  }

  let { open, onclose, ongenerated }: Props = $props();

  let generating = $state(false);
  let errorMsg = $state('');
  let actionMsg = $state('');

  let genTier = $state<LicenseTier>('PLUS');
  let genMaxDevices = $state(2);
  let genCount = $state(1);
  /** admin = 客服补发；promo = 活动码；test = 沙箱内测专属码 */
  let genSource = $state<'admin' | 'promo' | 'test'>('admin');
  let genExpiresInDays = $state<number | string>('');
  let genDurationDays = $state<number | string>('');
  let genBuyerEmail = $state('');
  let genBoundDeviceId = $state('');
  let genSendEmail = $state(false);

  let lastGeneratedCode = $state<string | null>(null);
  let batchGeneratedCodes = $state<BatchLicenseItem[]>([]);
  let copyHint = $state('');
  let batchCopyHint = $state('');

  async function handleGenerate(e: Event) {
    e.preventDefault();
    generating = true;
    errorMsg = '';
    actionMsg = '';
    lastGeneratedCode = null;
    batchGeneratedCodes = [];
    copyHint = '';
    batchCopyHint = '';

    try {
      const count = Math.max(1, Math.min(100, Math.floor(Number(genCount) || 1)));

      const body: Record<string, any> = {
        tier: genTier,
        max_devices: genMaxDevices,
        source: genSource
      };

      if (genSource === 'promo' || genSource === 'test') {
        const expStr = String(genExpiresInDays ?? '').trim();
        const durStr = String(genDurationDays ?? '').trim();
        const expDays = parseInt(expStr, 10);
        const durDays = parseInt(durStr, 10);
        if (isNaN(expDays) || expDays <= 0) {
          errorMsg = $t('licenses.errPromoRedeemDays');
          return;
        }
        if (isNaN(durDays) || durDays <= 0) {
          errorMsg = $t('licenses.errPromoDurationDays');
          return;
        }
        body.expires_in_days = expDays;
        body.duration_days = durDays;
      } else {
        const expStr = String(genExpiresInDays ?? '').trim();
        if (expStr) {
          const d = parseInt(expStr, 10);
          if (!isNaN(d) && d > 0) body.expires_in_days = d;
        }
        const durStr = String(genDurationDays ?? '').trim();
        if (durStr) {
          const d = parseInt(durStr, 10);
          if (!isNaN(d) && d > 0) body.duration_days = d;
        }
      }

      const boundDevStr = String(genBoundDeviceId ?? '').trim();
      if (boundDevStr) {
        body.bound_device_id = boundDevStr;
      }

      // Single license generation mode
      if (count === 1) {
        const buyerEmailStr = String(genBuyerEmail ?? '').trim();
        if (buyerEmailStr) {
          body.buyer_email = buyerEmailStr;
          if (genSendEmail) {
            body.send_email = true;
          }
        }

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
        if (ongenerated) ongenerated();
        return;
      }

      // Batch generation mode
      body.count = count;
      const res = await adminFetch<GenerateBatchResponse>('/api/v1/admin/generate-batch', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      batchGeneratedCodes = res.licenses || [];
      actionMsg = $t('licenses.batchSuccessMsg', { count: res.count });
      if (ongenerated) ongenerated();
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

  async function copyAllBatchCodes() {
    if (!batchGeneratedCodes.length) return;
    try {
      const text = batchGeneratedCodes.map(item => item.license_code).join('\r\n');
      await navigator.clipboard.writeText(text);
      batchCopyHint = $t('licenses.copyAllSuccess');
      setTimeout(() => {
        batchCopyHint = '';
      }, 2000);
    } catch {
      batchCopyHint = $t('common.failed');
    }
  }

  function handleExportBatchCsv() {
    if (!batchGeneratedCodes.length) return;
    const nowStr = new Date().toISOString().slice(0, 10);
    const filename = `eqt-batch-${genSource}-${nowStr}.csv`;
    const mockList: License[] = batchGeneratedCodes.map(b => ({
      ...b,
      active_devices_count: 0,
      activations: []
    }));
    exportLicensesToCsv(filename, mockList, {
      code: $t('licenses.csvColumns.code'),
      tier: $t('licenses.csvColumns.tier'),
      source: $t('licenses.csvColumns.source'),
      status: $t('licenses.csvColumns.status'),
      redemption: $t('licenses.csvColumns.redemption'),
      activeDevices: $t('licenses.csvColumns.activeDevices'),
      maxDevices: $t('licenses.csvColumns.maxDevices'),
      expiresAt: $t('licenses.csvColumns.expiresAt'),
      durationDays: $t('licenses.csvColumns.durationDays'),
      buyerEmail: $t('licenses.csvColumns.buyerEmail'),
      createdAt: $t('licenses.csvColumns.createdAt'),
      redeemedLabel: $t('licenses.redemptionBadge.redeemed'),
      unredeemedLabel: $t('licenses.redemptionBadge.unredeemed'),
      expiredUnredeemedLabel: $t('licenses.redemptionBadge.expiredUnredeemed')
    });
  }

  function handleExportBatchTxt() {
    if (!batchGeneratedCodes.length) return;
    const nowStr = new Date().toISOString().slice(0, 10);
    const filename = `eqt-batch-${genSource}-${nowStr}.txt`;
    const codes = batchGeneratedCodes.map(b => b.license_code);
    exportToTxt(filename, codes);
  }
</script>

{#if open}
  <Modal open={true} title={genCount > 1 ? $t('licenses.batchGenerateTitle') : $t('licenses.generateTitle')} maxWidth="640px" onclose={onclose}>
    <form onsubmit={handleGenerate} class="gen-form">
      {#if errorMsg}
        <div class="banner banner-error">{errorMsg}</div>
      {/if}
      {#if actionMsg}
        <div class="banner banner-success">{actionMsg}</div>
      {/if}

      <div class="form-group">
        <label for="count-input">{$t('licenses.genCount')}:</label>
        <input id="count-input" type="number" class="input" bind:value={genCount} min="1" max="100" required />
        {#if genCount > 1}
          <p class="field-hint highlight-hint">
            {$t('licenses.batchModeHint', { count: genCount })}
          </p>
        {/if}
      </div>

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

      {#if genCount <= 1}
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

      {#if batchGeneratedCodes.length > 0}
        <div class="generated-box">
          <div class="gen-label">{$t('licenses.batchSuccessMsg', { count: batchGeneratedCodes.length })}</div>
          <textarea
            class="batch-codes-textarea"
            readonly
            rows="6"
            value={batchGeneratedCodes.map(b => b.license_code).join('\n')}
          ></textarea>
          <div class="batch-actions-row">
            <button type="button" class="btn btn-secondary btn-sm" onclick={copyAllBatchCodes}>
              {$t('licenses.copyAllCodes')}
            </button>
            <button type="button" class="btn btn-secondary btn-sm" onclick={handleExportBatchCsv}>
              {$t('licenses.exportCsv')}
            </button>
            <button type="button" class="btn btn-secondary btn-sm" onclick={handleExportBatchTxt}>
              {$t('licenses.exportTxt')}
            </button>
          </div>
          {#if batchCopyHint}
            <div class="copy-hint">{batchCopyHint}</div>
          {/if}
        </div>
      {/if}
    </form>
    {#snippet footer()}
      <button type="button" class="btn btn-secondary" onclick={onclose}>{$t('common.close')}</button>
      <button type="button" class="btn btn-primary" disabled={generating} onclick={handleGenerate}>
        {generating ? $t('licenses.generating') : $t('licenses.generateBtn')}
      </button>
    {/snippet}
  </Modal>
{/if}

<style>
  .gen-form { display: flex; flex-direction: column; gap: 1rem; }
  .form-group { display: flex; flex-direction: column; gap: 0.35rem; }
  .form-group label { font-size: 0.85rem; font-weight: 500; color: var(--text-primary); }
  .field-hint { font-size: 0.75rem; color: var(--text-muted); margin: 0; }
  .highlight-hint { color: var(--accent-primary); font-weight: 500; }
  .checkbox-group { margin-top: 0.25rem; }
  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    cursor: pointer;
    color: var(--text-primary);
  }
  .generated-box {
    margin-top: 0.5rem;
    padding: 0.85rem 1rem;
    background: rgba(16, 185, 129, 0.08);
    border: 1px solid rgba(16, 185, 129, 0.3);
    border-radius: var(--radius-sm, 4px);
  }
  .gen-label {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--accent-primary);
    margin-bottom: 0.4rem;
  }
  .gen-code-row { display: flex; align-items: center; gap: 0.75rem; }
  .gen-code {
    font-family: var(--font-mono, monospace);
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-primary);
    background: rgba(0, 0, 0, 0.2);
    padding: 0.25rem 0.5rem;
    border-radius: var(--radius-sm, 4px);
    flex: 1;
  }
  .copy-hint {
    margin-top: 0.35rem;
    font-size: 0.75rem;
    color: var(--accent-primary);
  }
  .batch-codes-textarea {
    width: 100%;
    font-family: var(--font-mono, monospace);
    font-size: 0.8rem;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
    border-radius: var(--radius-sm, 4px);
    color: var(--text-primary);
    padding: 0.5rem;
    resize: vertical;
    margin: 0.5rem 0;
  }
  .batch-actions-row { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.25rem; }
  .banner {
    padding: 0.6rem 0.85rem;
    border-radius: var(--radius-sm, 4px);
    font-size: 0.82rem;
  }
  .banner-error {
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #ef4444;
  }
  .banner-success {
    background: rgba(16, 185, 129, 0.12);
    border: 1px solid rgba(16, 185, 129, 0.3);
    color: #10b981;
  }
</style>
