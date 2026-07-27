<script lang="ts">
  import { isAuthenticated, clearAccessSession, accessLogoutUrl, accessLoginUrl } from './lib/auth';
  import Overview from './pages/Overview.svelte';
  import ErrorAudit from './pages/ErrorAudit.svelte';
  import OpsAudit from './pages/OpsAudit.svelte';
  import Licenses from './pages/Licenses.svelte';
  import Blacklist from './pages/Blacklist.svelte';
  import SystemHealth from './pages/SystemHealth.svelte';
  import ProP2P from './pages/ProP2P.svelte';
  import Feedbacks from './pages/Feedbacks.svelte';
  import type { AdminTab } from './lib/types';

  let authed = $state(isAuthenticated());
  let currentTab = $state<AdminTab>('overview');

  $effect(() => {
    if (!authed) {
      window.location.href = accessLoginUrl();
    }
  });

  function handleLogout() {
    clearAccessSession();
    authed = false;
    window.location.href = accessLogoutUrl();
  }

  function navigateTo(tab: AdminTab) {
    currentTab = tab;
  }
</script>

{#if !authed}
  <div class="access-redirecting-screen">
    <div class="card redirect-card">
      <div class="spinner"></div>
      <h2>EQT Admin 安全控制台</h2>
      <p>未检测到 Access 会话，正在自动跳转至 Cloudflare Access 官方登录页…</p>
    </div>
  </div>
{:else}
  <div class="admin-layout">
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
          class:active={currentTab === 'pro_p2p'}
          onclick={() => (currentTab = 'pro_p2p')}
        >
          <span class="nav-icon">🚀</span> Pro P2P 直连
        </button>

        <button
          class="nav-item"
          class:active={currentTab === 'feedbacks'}
          onclick={() => (currentTab = 'feedbacks')}
        >
          <span class="nav-icon">💬</span> 用户反馈中心
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
          class:active={currentTab === 'blacklist'}
          onclick={() => (currentTab = 'blacklist')}
        >
          <span class="nav-icon">🚫</span> 黑名单管理
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
          退出 (Access Logout)
        </button>
      </div>
    </aside>

    <main class="main-content">
      {#if currentTab === 'overview'}
        <Overview onNavigate={navigateTo} />
      {:else if currentTab === 'pro_p2p'}
        <ProP2P />
      {:else if currentTab === 'feedbacks'}
        <Feedbacks />
      {:else if currentTab === 'audit'}
        <ErrorAudit />
      {:else if currentTab === 'ops'}
        <OpsAudit />
      {:else if currentTab === 'licenses'}
        <Licenses />
      {:else if currentTab === 'blacklist'}
        <Blacklist />
      {:else if currentTab === 'health'}
        <SystemHealth />
      {/if}
    </main>
  </div>
{/if}

<style>
  .access-redirecting-screen {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: radial-gradient(circle at top, #1e1b4b 0%, #0f172a 70%);
    color: var(--text-primary);
  }

  .redirect-card {
    text-align: center;
    padding: 2.5rem 2rem;
    max-width: 420px;
    width: 90%;
  }

  .redirect-card h2 {
    font-size: 1.2rem;
    margin-bottom: 0.5rem;
    color: var(--accent-primary);
  }

  .redirect-card p {
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .spinner {
    width: 36px;
    height: 36px;
    border: 3px solid rgba(99, 102, 241, 0.2);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto 1.25rem auto;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

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
