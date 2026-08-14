<script lang="ts">
  import { isAuthenticated, clearAccessSession, accessLogoutUrl } from './lib/auth';
  import { t, setLocale, currentLocale } from './lib/i18n';
  import { adminEnv, setAdminEnvironment, type AdminEnvironment } from './lib/env.svelte';
  import Login from './pages/Login.svelte';
  import Overview from './pages/Overview.svelte';
  import ErrorAudit from './pages/ErrorAudit.svelte';
  import OpsAudit from './pages/OpsAudit.svelte';
  import Licenses from './pages/Licenses.svelte';
  import Blacklist from './pages/Blacklist.svelte';
  import SystemHealth from './pages/SystemHealth.svelte';
  import Metrics from './pages/Metrics.svelte';
  import type { AdminTab } from './lib/types';

  let authed = $state(isAuthenticated());
  let currentTab = $state<AdminTab>('overview');
  let licenseSearchPrefill = $state<string>('');

  function handleLogout() {
    clearAccessSession();
    const accessOut = accessLogoutUrl();
    if (accessOut) {
      window.location.href = accessOut;
      return;
    }
    authed = false;
  }

  function navigateTo(tab: AdminTab, prefillQuery?: string) {
    if (tab === 'licenses') {
      licenseSearchPrefill = prefillQuery || '';
    }
    currentTab = tab;
  }

  function switchEnv(target: AdminEnvironment) {
    setAdminEnvironment(target);
  }
</script>

{#if !authed}
  <Login />
{:else}
  <div class="admin-layout" class:sandbox-mode={adminEnv.current === 'test'}>
    <aside class="sidebar card">
      <div class="brand">
        <span class="brand-logo">EQT</span> {$t('nav.title')}
      </div>

      <div class="env-toggle-wrapper">
        <div class="env-toggle-group">
          <button
            type="button"
            class="env-pill-btn"
            class:selected={adminEnv.current === 'production'}
            onclick={() => switchEnv('production')}
          >
            <span class="env-indicator prod-indicator"></span>
            <span>{$t('nav.production')}</span>
          </button>
          <button
            type="button"
            class="env-pill-btn"
            class:selected={adminEnv.current === 'test'}
            onclick={() => switchEnv('test')}
          >
            <span class="env-indicator test-indicator"></span>
            <span>{$t('nav.sandbox')}</span>
          </button>
        </div>
      </div>

      <nav class="nav-menu">
        <button
          class="nav-item"
          class:active={currentTab === 'overview'}
          onclick={() => (currentTab = 'overview')}
        >
          <span class="nav-icon">📊</span> {$t('nav.overview')}
        </button>

        <button
          class="nav-item"
          class:active={currentTab === 'audit'}
          onclick={() => (currentTab = 'audit')}
        >
          <span class="nav-icon">🚨</span> {$t('nav.errorAudit')}
        </button>

        <button
          class="nav-item"
          class:active={currentTab === 'ops'}
          onclick={() => (currentTab = 'ops')}
        >
          <span class="nav-icon">📋</span> {$t('nav.opsAudit')}
        </button>

        <button
          class="nav-item"
          class:active={currentTab === 'licenses'}
          onclick={() => (currentTab = 'licenses')}
        >
          <span class="nav-icon">🎫</span> {$t('nav.licenses')}
        </button>

        <button
          class="nav-item"
          class:active={currentTab === 'blacklist'}
          onclick={() => (currentTab = 'blacklist')}
        >
          <span class="nav-icon">🚫</span> {$t('nav.blacklist')}
        </button>

        <button
          class="nav-item"
          class:active={currentTab === 'health'}
          onclick={() => (currentTab = 'health')}
        >
          <span class="nav-icon">🏥</span> {$t('nav.health')}
        </button>

        <button
          class="nav-item"
          class:active={currentTab === 'metrics'}
          onclick={() => (currentTab = 'metrics')}
        >
          <span class="nav-icon">📈</span> {$t('nav.metrics')}
        </button>
      </nav>

      <div class="sidebar-footer">
        <div class="lang-switch-row">
          <button
            type="button"
            class="lang-pill-btn"
            class:selected={$currentLocale === 'zh'}
            onclick={() => setLocale('zh')}
          >
            中文
          </button>
          <button
            type="button"
            class="lang-pill-btn"
            class:selected={$currentLocale === 'en'}
            onclick={() => setLocale('en')}
          >
            EN
          </button>
        </div>
        <button class="btn btn-secondary btn-block logout-btn" onclick={handleLogout}>
          {$t('nav.logout')}
        </button>
      </div>
    </aside>

    <main class="main-content">
      {#if adminEnv.current === 'test'}
        <div class="sandbox-banner">
          <span class="sandbox-badge">TEST SANDBOX</span>
          <span>{$t('nav.envBanner')}</span>
        </div>
      {/if}

      {#key `${adminEnv.current}-${currentTab}`}
        {#if currentTab === 'overview'}
          <Overview onNavigate={navigateTo} />
        {:else if currentTab === 'audit'}
          <ErrorAudit />
        {:else if currentTab === 'ops'}
          <OpsAudit />
        {:else if currentTab === 'licenses'}
          <Licenses prefillQuery={licenseSearchPrefill} />
        {:else if currentTab === 'blacklist'}
          <Blacklist />
        {:else if currentTab === 'health'}
          <SystemHealth />
        {:else if currentTab === 'metrics'}
          <Metrics />
        {/if}
      {/key}
    </main>
  </div>
{/if}

<style>
  .admin-layout {
    display: flex;
    min-height: 100vh;
    width: 100%;
    max-width: 100vw;
    overflow-x: hidden;
    box-sizing: border-box;
  }

  .sidebar {
    width: 260px;
    border-radius: 0;
    border-right: 1px solid var(--border-color);
    border-top: none;
    border-bottom: none;
    border-left: none;
    display: flex;
    flex-direction: column;
    padding: 1.75rem 1.25rem;
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 10;
  }

  .brand {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text-primary);
    margin-bottom: 1.25rem;
    padding-left: 0.5rem;
  }

  .brand-logo {
    color: var(--accent-primary);
    font-weight: 900;
  }

  .env-toggle-wrapper {
    margin-bottom: 1.5rem;
    padding: 0 0.25rem;
  }

  .env-toggle-group {
    display: flex;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md, 8px);
    padding: 3px;
    gap: 3px;
  }

  .env-pill-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.45rem 0.6rem;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .env-pill-btn:hover {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.05);
  }

  .env-pill-btn.selected {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }

  .env-indicator {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    display: inline-block;
  }

  .prod-indicator {
    background: #10b981;
    box-shadow: 0 0 6px rgba(16, 185, 129, 0.6);
  }

  .test-indicator {
    background: #f59e0b;
    box-shadow: 0 0 6px rgba(245, 158, 11, 0.6);
  }

  .sandbox-banner {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1.25rem;
    background: rgba(245, 158, 11, 0.12);
    border: 1px solid rgba(245, 158, 11, 0.35);
    border-radius: var(--radius-md, 8px);
    color: #fbbf24;
    font-size: 0.85rem;
    font-weight: 500;
    margin-bottom: 1.5rem;
    box-shadow: 0 0 15px rgba(245, 158, 11, 0.08);
  }

  .sandbox-badge {
    background: #f59e0b;
    color: #000;
    font-weight: 800;
    font-size: 0.65rem;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    letter-spacing: 0.05em;
  }

  .admin-layout.sandbox-mode .sidebar {
    border-right-color: rgba(245, 158, 11, 0.25);
  }

  .nav-menu {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    flex: 1;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease;
  }

  .nav-item:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .nav-item.active {
    background: rgba(99, 102, 241, 0.15);
    color: var(--accent-primary);
    border: 1px solid rgba(99, 102, 241, 0.3);
    font-weight: 600;
  }

  .nav-icon {
    font-size: 1.1rem;
  }

  .sidebar-footer {
    padding-top: 1rem;
    border-top: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .lang-switch-row {
    display: flex;
    background: rgba(0, 0, 0, 0.2);
    border-radius: var(--radius-sm);
    padding: 2px;
    gap: 2px;
  }

  .lang-pill-btn {
    flex: 1;
    padding: 0.3rem;
    font-size: 0.75rem;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .lang-pill-btn:hover {
    color: var(--text-primary);
  }

  .lang-pill-btn.selected {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    font-weight: 600;
  }

  .logout-btn {
    width: 100%;
    font-size: 0.8rem;
  }

  .main-content {
    flex: 1;
    min-width: 0;
    margin-left: 260px;
    padding: 2rem 2.5rem;
    max-width: 1400px;
    box-sizing: border-box;
  }
</style>
