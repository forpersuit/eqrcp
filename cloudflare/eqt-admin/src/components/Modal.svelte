<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    open: boolean;
    title?: string;
    maxWidth?: string;
    onclose: () => void;
    children?: Snippet;
    footer?: Snippet;
  }

  let { open, title = '', maxWidth = '650px', onclose, children, footer }: Props = $props();

  let modalEl: HTMLDivElement | null = $state(null);
  let previouslyFocused: HTMLElement | null = null;

  const FOCUSABLE_SELECTOR =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])';

  $effect(() => {
    if (open) {
      if (typeof document !== 'undefined') {
        previouslyFocused = document.activeElement as HTMLElement | null;
        requestAnimationFrame(() => {
          if (!modalEl) return;
          const focusables = modalEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
          if (focusables.length > 0) {
            focusables[0].focus();
          } else {
            modalEl.focus();
          }
        });
      }
    } else if (previouslyFocused) {
      previouslyFocused.focus();
      previouslyFocused = null;
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    if (!open) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
      return;
    }

    if (e.key === 'Tab' && modalEl) {
      const focusables = Array.from(
        modalEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null);

      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first || document.activeElement === modalEl) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div class="modal-overlay" onclick={onclose} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      bind:this={modalEl}
      class="modal-content"
      style:max-width={maxWidth}
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      {#if title}
        <div class="modal-header">
          <h3>{title}</h3>
          <button type="button" class="btn-close" onclick={onclose} aria-label="关闭">×</button>
        </div>
      {/if}
      <div class="modal-body">
        {@render children?.()}
      </div>
      {#if footer}
        <div class="modal-footer">
          {@render footer()}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.25rem;
  }
  .modal-header h3 {
    margin: 0;
    font-size: 1.15rem;
    color: var(--text-primary);
  }
  .btn-close {
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
    padding: 0.2rem 0.5rem;
    border-radius: var(--radius-sm);
  }
  .btn-close:hover {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.08);
  }
  .modal-body {
    color: var(--text-secondary);
  }
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 1.5rem;
  }
</style>
