<script lang="ts">
  import { onMount } from 'svelte';
  import { markAccessAuthenticated } from '../lib/auth';
  import { adminFetch } from '../lib/api';
  import { t } from '../lib/i18n';
  import Banner from '../components/Banner.svelte';

  let errorMessage = $state('');
  let probing = $state(true);

  async function probeAccess() {
    probing = true;
    errorMessage = '';
    try {
      await adminFetch('/api/v1/admin/error-logs?limit=1');
      markAccessAuthenticated();
      window.location.reload();
    } catch (err: any) {
      errorMessage =
        err.message ||
        $t('login.invalidToken');
    } finally {
      probing = false;
    }
  }

  onMount(() => {
    probeAccess();
  });
</script>

<div class="login-wrapper">
  <div class="card login-card">
    <div class="login-header">
      <div class="logo">EQT Admin</div>
      <h2>{$t('login.title')}</h2>
      <p class="subtitle">{$t('login.subtitle')}</p>
    </div>

    <Banner type="error" message={errorMessage} />

    <div class="access-panel">
      <p class="access-desc">
        {$t('login.accessDesc')}
      </p>
      <button
        type="button"
        class="btn btn-primary login-btn"
        disabled={probing}
        onclick={() => probeAccess()}
      >
        {probing ? $t('common.loading') : $t('login.submit')}
      </button>
      <p class="hint">
        {$t('login.hintText')}
      </p>
    </div>
  </div>
</div>

<style>
  .login-wrapper {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: radial-gradient(circle at top, #1e1b4b 0%, #0f172a 70%);
  }

  .login-card {
    width: 100%;
    max-width: 420px;
    padding: 2.5rem 2rem;
  }

  .login-header {
    text-align: center;
    margin-bottom: 2rem;
  }

  .logo {
    display: inline-block;
    font-size: 1.5rem;
    font-weight: 800;
    background: linear-gradient(135deg, #818cf8 0%, #c084fc 100%);
    background-clip: text;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    margin-bottom: 0.5rem;
  }

  h2 {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .subtitle {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin-top: 0.25rem;
  }

  .login-btn {
    width: 100%;
    padding: 0.75rem;
    font-size: 0.95rem;
  }

  .access-desc {
    font-size: 0.9rem;
    color: var(--text-secondary);
    line-height: 1.5;
    margin-bottom: 1.25rem;
    text-align: center;
  }

  .hint {
    margin-top: 1rem;
    font-size: 0.75rem;
    color: var(--text-muted);
    line-height: 1.45;
  }
</style>
