<script lang="ts">
  import { markAccessAuthenticated, accessLoginUrl } from '../lib/auth';
  import { adminFetch } from '../lib/api';

  let { onLoginSuccess }: { onLoginSuccess?: () => void } = $props();

  let loading = $state(false);
  let errorMessage = $state('');
  let probing = $state(true);

  async function probeAccess() {
    probing = true;
    errorMessage = '';
    try {
      await adminFetch('/api/v1/admin/error-logs?limit=1', { skipAutoRedirect: true });
      markAccessAuthenticated();
      if (onLoginSuccess) {
        onLoginSuccess();
      } else {
        window.location.reload();
      }
    } catch (err: any) {
      errorMessage =
        err.message ||
        '未能通过 Cloudflare Access 鉴权。请确认已用授权账号登录 Access，或重新点击下方按钮登录。';
    } finally {
      probing = false;
      loading = false;
    }
  }

  function handleReLogin() {
    window.location.href = accessLoginUrl();
  }

  queueMicrotask(() => {
    probeAccess();
  });
</script>

<div class="login-wrapper">
  <div class="card login-card">
    <div class="login-header">
      <div class="logo">EQT Admin</div>
      <h2>管理后台控制台</h2>
      <p class="subtitle">授权管控 • 黑名单 • 错误审计 • 系统监控</p>
    </div>

    {#if errorMessage}
      <div class="error-banner">
        {errorMessage}
      </div>
    {/if}

    <div class="access-panel">
      <p class="access-desc">
        通过 <strong>Cloudflare Access</strong> 鉴权防护。边缘登录成功后将自动校验 API JWT 权限。
      </p>
      
      <div class="actions">
        <button
          type="button"
          class="btn btn-primary login-btn"
          disabled={probing || loading}
          onclick={() => probeAccess()}
        >
          {probing ? '正在校验 Access 身份…' : '校验身份并进入控制台'}
        </button>

        <button
          type="button"
          class="btn btn-secondary relogin-btn"
          onclick={handleReLogin}
        >
          重新登录 (Cloudflare Access)
        </button>
      </div>

      <p class="hint">
        若校验失败：请确认已用管理员账号登录 Access。如有必要，可点击“重新登录”跳转 Cloudflare 边缘鉴权。
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

  .error-banner {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.4);
    color: #fca5a5;
    padding: 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    margin-bottom: 1.25rem;
    text-align: center;
  }

  .access-desc {
    font-size: 0.9rem;
    color: var(--text-secondary);
    line-height: 1.5;
    margin-bottom: 1.25rem;
    text-align: center;
  }

  .hint {
    margin-top: 1.25rem;
    font-size: 0.75rem;
    color: var(--text-muted);
    line-height: 1.45;
    text-align: center;
  }
</style>
