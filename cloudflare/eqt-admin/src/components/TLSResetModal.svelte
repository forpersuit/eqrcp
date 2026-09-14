<script lang="ts">
  import { t } from '../lib/i18n';
  import { adminFetch } from '../lib/api';
  import Modal from './Modal.svelte';
  import Banner from './Banner.svelte';
  import type { ResetRateLimitResponse } from '../lib/types';

  interface Props {
    open: boolean;
    onclose: () => void;
    onSuccess?: (msg: string) => void;
  }

  let { open, onclose, onSuccess }: Props = $props();

  let target = $state<'circuit_breaker' | 'node_rate_limit' | 'ip_rate_limit'>('circuit_breaker');
  let targetKey = $state('');
  let submitting = $state(false);
  let errorMsg = $state('');
  let confirmStage = $state(false);

  function isValidIp(ip: string): boolean {
    if (!ip || typeof ip !== 'string') return false;
    const trimmed = ip.trim();
    const v4Parts = trimmed.split('.');
    if (v4Parts.length === 4) {
      return v4Parts.every(part => {
        if (!/^\d{1,3}$/.test(part)) return false;
        if (part.length > 1 && part.startsWith('0')) return false;
        const n = Number(part);
        return n >= 0 && n <= 255;
      });
    }
    if (!trimmed.includes(':') || !/^[0-9a-fA-F:]+$/.test(trimmed)) {
      return false;
    }
    const doubleColonCount = (trimmed.match(/::/g) || []).length;
    if (doubleColonCount > 1 || trimmed.includes(':::')) return false;
    if (doubleColonCount === 1) {
      const [left, right] = trimmed.split('::');
      const leftParts = left ? left.split(':') : [];
      const rightParts = right ? right.split(':') : [];
      const totalParts = leftParts.length + rightParts.length;
      if (totalParts > 7) return false;
      const allParts = [...leftParts, ...rightParts];
      return allParts.every(p => /^[0-9a-fA-F]{1,4}$/.test(p));
    } else {
      const parts = trimmed.split(':');
      if (parts.length !== 8) return false;
      return parts.every(p => /^[0-9a-fA-F]{1,4}$/.test(p));
    }
  }

  function resetForm() {
    target = 'circuit_breaker';
    targetKey = '';
    errorMsg = '';
    confirmStage = false;
    submitting = false;
  }

  function handleClose() {
    resetForm();
    onclose();
  }

  function validate(): boolean {
    errorMsg = '';
    const trimmed = targetKey.trim();
    if (target === 'node_rate_limit') {
      if (!trimmed) {
        errorMsg = $t('tls.nodeIdRequired');
        return false;
      }
      if (!/^[a-fA-F0-9]{12}$/.test(trimmed)) {
        errorMsg = $t('tls.nodeIdInvalid');
        return false;
      }
    } else if (target === 'ip_rate_limit') {
      if (!trimmed) {
        errorMsg = $t('tls.ipRequired');
        return false;
      }
      if (!isValidIp(trimmed)) {
        errorMsg = $t('tls.ipInvalid');
        return false;
      }
    }
    return true;
  }

  function handlePreSubmit() {
    if (!validate()) return;
    confirmStage = true;
  }

  async function handleExecute() {
    submitting = true;
    errorMsg = '';
    try {
      const payload: Record<string, string> = { target };
      if (target === 'node_rate_limit') {
        payload.key = targetKey.trim().toLowerCase();
      } else if (target === 'ip_rate_limit') {
        payload.key = targetKey.trim();
      }
      const res = await adminFetch<ResetRateLimitResponse>('/api/v1/admin/tls/reset-rate-limit', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      onSuccess?.(res.message || $t('tls.resetSuccess'));
      handleClose();
    } catch (err: any) {
      errorMsg = err.message || $t('tls.resetFailed');
      confirmStage = false;
    } finally {
      submitting = false;
    }
  }
</script>

<Modal {open} title={$t('tls.modalTitle')} onclose={handleClose} maxWidth="560px">
  <div class="reset-modal-body">
    <p class="modal-desc">{$t('tls.modalDesc')}</p>

    <Banner type="error" message={errorMsg} />

    {#if !confirmStage}
      <div class="form-group">
        <label for="reset-target-select" class="form-label">{$t('tls.targetLabel')}</label>
        <select id="reset-target-select" class="input select-input" bind:value={target} onchange={() => { errorMsg = ''; targetKey = ''; }}>
          <option value="circuit_breaker">{$t('tls.targetCircuitBreaker')}</option>
          <option value="node_rate_limit">{$t('tls.targetNodeLimit')}</option>
          <option value="ip_rate_limit">{$t('tls.targetIpLimit')}</option>
        </select>
        <div class="field-hint">
          {#if target === 'circuit_breaker'}
            {$t('tls.circuitBreakerHint')}
          {:else if target === 'node_rate_limit'}
            {$t('tls.nodeLimitHint')}
          {:else}
            {$t('tls.ipLimitHint')}
          {/if}
        </div>
      </div>

      {#if target === 'node_rate_limit'}
        <div class="form-group">
          <label for="reset-node-id" class="form-label">{$t('tls.nodeIdLabel')}</label>
          <input
            id="reset-node-id"
            type="text"
            class="input text-input"
            placeholder={$t('tls.nodeIdPlaceholder')}
            bind:value={targetKey}
          />
        </div>
      {:else if target === 'ip_rate_limit'}
        <div class="form-group">
          <label for="reset-ip-addr" class="form-label">{$t('tls.ipLabel')}</label>
          <input
            id="reset-ip-addr"
            type="text"
            class="input text-input"
            placeholder={$t('tls.ipPlaceholder')}
            bind:value={targetKey}
          />
        </div>
      {/if}

      <div class="action-row">
        <button type="button" class="btn btn-secondary" onclick={handleClose}>
          {$t('common.cancel')}
        </button>
        <button type="button" class="btn btn-primary" onclick={handlePreSubmit}>
          {$t('common.confirm')}
        </button>
      </div>
    {:else}
      <div class="confirm-warning-box">
        <div class="warn-icon">⚠️</div>
        <div class="warn-text">
          <strong>{$t('tls.resetConfirm')}</strong>
          <p class="warn-detail">
            {$t('tls.confirmTarget')}: <code>{target}</code>
            {#if target !== 'circuit_breaker' && targetKey.trim()}
              · {$t('tls.confirmKey')}: <code>{targetKey.trim()}</code>
            {/if}
          </p>
        </div>
      </div>

      <div class="action-row">
        <button type="button" class="btn btn-secondary" onclick={() => { confirmStage = false; }} disabled={submitting}>
          {$t('common.cancel')}
        </button>
        <button type="button" class="btn btn-danger" onclick={handleExecute} disabled={submitting}>
          {submitting ? $t('tls.resetting') : $t('common.confirm')}
        </button>
      </div>
    {/if}
  </div>
</Modal>

<style>
  .reset-modal-body {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .modal-desc {
    font-size: 0.875rem;
    color: var(--text-muted);
    line-height: 1.4;
    margin: 0;
  }
  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .form-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  .field-hint {
    font-size: 0.75rem;
    color: var(--text-muted);
    line-height: 1.3;
  }
  .action-row {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 0.5rem;
  }
  .confirm-warning-box {
    display: flex;
    align-items: flex-start;
    gap: 0.85rem;
    padding: 1rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: var(--radius-md, 8px);
  }
  .warn-icon {
    font-size: 1.5rem;
    line-height: 1;
  }
  .warn-text {
    font-size: 0.875rem;
    color: var(--text-primary);
  }
  .warn-detail {
    margin: 0.4rem 0 0;
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .warn-detail code {
    background: rgba(0, 0, 0, 0.3);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: monospace;
  }
  .btn-danger {
    background: #dc2626;
    color: #fff;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: var(--radius-md, 6px);
    font-weight: 600;
    cursor: pointer;
  }
  .btn-danger:hover:not(:disabled) {
    background: #b91c1c;
  }
  .btn-danger:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
