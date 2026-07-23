<script lang="ts">
  import { isAuthenticated, clearAdminSecret } from './lib/auth';
  import Login from './pages/Login.svelte';
  import Overview from './pages/Overview.svelte';
  import ErrorAudit from './pages/ErrorAudit.svelte';
  import OpsAudit from './pages/OpsAudit.svelte';
  import Licenses from './pages/Licenses.svelte';
  import SystemHealth from './pages/SystemHealth.svelte';
  import type { AdminTab } from './lib/types';

  let authed = $state(isAuthenticated());
  let currentTab = $state<AdminTab>('overview');

  function handleLogout() {
    clearAdminSecret();
    authed = false;
  }

  function navigateTo(tab: AdminTab) {
    currentTab = tab;
  }
</script>

{#if !authed}
  <Login />
{:else}
  <div class="admin-layout">
    <!-- Sidebar Navigation -->
    <aside class="sidebar card">
      <div class="brand">
        <span class="brand-logo">EQT</span> Admin
      </div>

      <nav class="nav-menu">
        <button
          class="nav-item"
          class:active={currentTab === 'overview'}
          onclick={() => (currentTab = 'overview')}
        >
          <span class="nav-icon">📊</span> 全局概览
        </button>

        <button
          class="nav-item"
          class:active={currentTab === 'audit'}
          onclick={() => (currentTab = 'audit')}
        >
          <span class="nav-icon">🚨</span> 错误审计中心
        </button>

        <button
          class="nav-item"
          class:active={currentTab === 'ops'}
          onclick={() => (currentTab = 'ops')}
        >
          <span class="nav-icon">📋</span> 操作审计轨迹
        </button>

        <button
          class="nav-item"
          class:active={currentTab === 'licenses'}
          onclick={() => (currentTab = 'licenses')}
        >
          <span class="nav-icon">🎫</span> 授权与订单管控
        </button>

        <button
          class="nav-item"
          class:active={currentTab === 'health'}
          onclick={() => (currentTab = 'health')}
        >
          <span class="nav-icon">🌐</span> 系统健康监控
        </button>
      </nav>

      <div class="sidebar-footer">
        <button class="btn btn-secondary logout-btn" onclick={handleLogout}>
          退出登录 (Clear Secret)
        </button>
      </div>
    </aside>

    <!-- Main Content Area -->
    <main class="main-content">
      {#if currentTab === 'overview'}
        <Overview onNavigate={navigateTo} />
      {:else if currentTab === 'audit'}
        <ErrorAudit />
      {:else if currentTab === 'ops'}
        <OpsAudit />
      {:else if currentTab === 'licenses'}
        <Licenses />
      {:else if currentTab === 'health'}
        <SystemHealth />
      {/if}
    </main>
  </div>
{/if}

<style>
  .admin-layout {
    display: flex;
    min-height: 100vh;
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
    margin-bottom: 2rem;
    padding-left: 0.5rem;
  }

  .brand-logo {
    color: var(--accent-primary);
    font-weight: 900;
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
  }

  .logout-btn {
    width: 100%;
    font-size: 0.8rem;
  }

  .main-content {
    flex: 1;
    margin-left: 260px;
    padding: 2rem 2.5rem;
    max-width: 1400px;
  }
</style>
