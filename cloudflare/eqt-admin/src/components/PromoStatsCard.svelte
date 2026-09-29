<script lang="ts">
  import { t } from '../lib/i18n';
  import type { PromoStats } from '../lib/types';

  interface Props {
    stats: PromoStats;
    activeRedeemedFilter?: string;
    onSelectFilter?: (filter: 'all' | 'redeemed' | 'unredeemed') => void;
  }

  let { stats, activeRedeemedFilter = 'all', onSelectFilter }: Props = $props();

  function handleClick(filter: 'all' | 'redeemed' | 'unredeemed') {
    if (onSelectFilter) {
      onSelectFilter(filter);
    }
  }
</script>

<div class="promo-stats-bar card">
  <div class="promo-header">
    <div class="promo-title">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
        <line x1="7" y1="7" x2="7.01" y2="7"></line>
      </svg>
      <span>{$t('licenses.promoDashboardTitle')}</span>
    </div>
    <span class="promo-desc">{$t('licenses.promoDashboardSubtitle')}</span>
  </div>

  <div class="stats-grid">
    <button
      type="button"
      class="stat-card {activeRedeemedFilter === 'all' ? 'active-filter' : ''}"
      onclick={() => handleClick('all')}
    >
      <span class="stat-label">{$t('licenses.promoTotal')}</span>
      <span class="stat-value">{stats.total}</span>
      <span class="stat-sub">{$t('licenses.promoFilterAll')}</span>
    </button>

    <button
      type="button"
      class="stat-card stat-redeemed {activeRedeemedFilter === 'redeemed' ? 'active-filter' : ''}"
      onclick={() => handleClick('redeemed')}
    >
      <span class="stat-label">{$t('licenses.promoRedeemed')}</span>
      <span class="stat-value">{stats.redeemed}</span>
      <span class="stat-sub">
        {stats.total > 0 ? Math.round((stats.redeemed / stats.total) * 100) : 0}% {$t('licenses.promoRedemptionRate')}
      </span>
    </button>

    <button
      type="button"
      class="stat-card stat-unredeemed {activeRedeemedFilter === 'unredeemed' ? 'active-filter' : ''}"
      onclick={() => handleClick('unredeemed')}
    >
      <span class="stat-label">{$t('licenses.promoUnredeemed')}</span>
      <span class="stat-value">{stats.unredeemed}</span>
      <span class="stat-sub">{$t('licenses.promoAvailable')}</span>
    </button>

    <div class="stat-card stat-expired">
      <span class="stat-label">{$t('licenses.promoExpiredUnclaimed')}</span>
      <span class="stat-value">{stats.expired_unredeemed}</span>
      <span class="stat-sub">{$t('licenses.promoExpiredWindow')}</span>
    </div>
  </div>
</div>

<style>
  .promo-stats-bar {
    padding: 1.25rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    border-left: 3px solid var(--accent-primary, #10b981);
    background: rgba(16, 185, 129, 0.03);
  }

  .promo-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .promo-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .promo-desc {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 0.85rem;
  }

  .stat-card {
    display: flex;
    flex-direction: column;
    padding: 0.85rem 1rem;
    background: rgba(15, 23, 42, 0.35);
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
    border-radius: var(--radius-sm, 6px);
    text-align: left;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
    color: inherit;
    font-family: inherit;
  }

  .stat-card:hover {
    border-color: var(--accent-primary, #10b981);
    transform: translateY(-1px);
  }

  .stat-card.active-filter {
    border-color: var(--accent-primary, #10b981);
    background: rgba(16, 185, 129, 0.12);
  }

  .stat-card.stat-expired {
    cursor: default;
  }

  .stat-card.stat-expired:hover {
    border-color: var(--border-color, rgba(255, 255, 255, 0.1));
    transform: none;
  }

  .stat-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-weight: 500;
  }

  .stat-value {
    font-size: 1.4rem;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0.2rem 0;
    font-family: var(--font-mono, monospace);
  }

  .stat-redeemed .stat-value {
    color: #10b981;
  }

  .stat-unredeemed .stat-value {
    color: #38bdf8;
  }

  .stat-expired .stat-value {
    color: #f59e0b;
  }

  .stat-sub {
    font-size: 0.7rem;
    color: var(--text-muted);
  }
</style>
