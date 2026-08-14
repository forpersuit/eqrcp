<script lang="ts">
  interface Props {
    page: number;
    pageSize: number;
    total: number;
    onprev: () => void;
    onnext: () => void;
  }

  let { page, pageSize, total, onprev, onnext }: Props = $props();

  let maxPage = $derived(Math.max(1, Math.ceil(total / pageSize)));
</script>

<div class="pagination-bar card">
  <button type="button" class="btn btn-secondary btn-sm" disabled={page <= 1} onclick={onprev}>
    ← 上一页
  </button>
  <span class="page-info">
    第 <strong>{page}</strong> / <strong>{maxPage}</strong> 页 (共 {total} 条)
  </span>
  <button type="button" class="btn btn-secondary btn-sm" disabled={page >= maxPage} onclick={onnext}>
    下一页 →
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
  .page-info strong {
    color: var(--text-primary);
  }
  .btn-sm {
    padding: 0.35rem 0.75rem;
    font-size: 0.8rem;
  }
</style>
