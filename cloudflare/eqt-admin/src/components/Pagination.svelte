<script lang="ts">
  import { t } from '../lib/i18n';

  interface Props {
    page: number;
    pageSize: number;
    total: number;
    loading?: boolean;
    onprev: () => void;
    onnext: () => void;
  }

  let { page, pageSize, total, loading = false, onprev, onnext }: Props = $props();

  let maxPage = $derived(Math.max(1, Math.ceil(total / pageSize)));
  let startItem = $derived(total === 0 ? 0 : (page - 1) * pageSize + 1);
  let endItem = $derived(Math.min(page * pageSize, total));
</script>

<div class="pagination-bar card">
  <button
    type="button"
    class="btn btn-secondary btn-sm"
    disabled={page <= 1 || loading}
    onclick={onprev}
  >
    {$t('pagination.prev')}
  </button>
  <span class="page-info">
    {$t('pagination.page', { page, maxPage })}
    {#if total > 0}
      <span class="range-info">
        ({$t('pagination.range', {
          start: startItem,
          end: endItem,
          total
        })})
      </span>
    {:else}
      <span class="range-info">({$t('pagination.total', { total })})</span>
    {/if}
  </span>
  <button
    type="button"
    class="btn btn-secondary btn-sm"
    disabled={page >= maxPage || loading}
    onclick={onnext}
  >
    {$t('pagination.next')}
  </button>
</div>

<style>
  .pagination-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1.25rem;
    margin-top: 1rem;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
  }
  .page-info {
    font-size: 0.85rem;
    color: var(--text-muted);
  }
  .range-info {
    margin-left: 0.25rem;
  }
  .btn-sm {
    padding: 0.35rem 0.75rem;
    font-size: 0.8rem;
  }
</style>
