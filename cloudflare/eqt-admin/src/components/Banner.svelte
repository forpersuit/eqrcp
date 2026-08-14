<script lang="ts">
  interface Props {
    type?: 'error' | 'ok' | 'info';
    message: string;
    onclose?: () => void;
  }

  let { type = 'info', message, onclose }: Props = $props();
</script>

{#if message}
  <div class="banner {type}" role="alert">
    <span>{message}</span>
    {#if onclose}
      <button type="button" class="btn-close" onclick={onclose} aria-label="关闭">×</button>
    {/if}
  </div>
{/if}

<style>
  .banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    border-radius: var(--radius-sm);
    margin-bottom: 1rem;
    font-size: 0.9rem;
  }
  .banner.error {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.4);
    color: #fca5a5;
  }
  .banner.ok {
    background: rgba(16, 185, 129, 0.15);
    border: 1px solid rgba(16, 185, 129, 0.4);
    color: #6ee7b7;
  }
  .banner.info {
    background: rgba(99, 102, 241, 0.15);
    border: 1px solid rgba(99, 102, 241, 0.4);
    color: #c7d2fe;
  }
  .btn-close {
    background: transparent;
    border: none;
    color: inherit;
    font-size: 1.25rem;
    line-height: 1;
    cursor: pointer;
    padding: 0 0.25rem;
    opacity: 0.7;
  }
  .btn-close:hover {
    opacity: 1;
  }
</style>
