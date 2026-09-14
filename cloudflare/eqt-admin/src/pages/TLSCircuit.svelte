<script lang="ts">
  import { t } from '../lib/i18n';
  import TLSCircuitCard from '../components/TLSCircuitCard.svelte';
</script>

<div class="page-container">
  <div class="header-row">
    <div>
      <h2>{$t('tls.title')}</h2>
      <p class="subtitle">{$t('tls.subtitle')}</p>
    </div>
  </div>

  <div class="tls-content">
    <TLSCircuitCard />
  </div>
</div>

<style>
  .page-container {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 2rem;
    max-width: 1400px;
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
  }

  .header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  h2 {
    font-size: 1.5rem;
    font-weight: 700;
    margin: 0;
    color: var(--text-primary);
  }

  .subtitle {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin: 0.25rem 0 0 0;
  }

  .tls-content {
    width: 100%;
  }
</style>
