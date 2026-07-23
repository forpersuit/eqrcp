<script lang="ts">
  import { setAdminSecret } from '../lib/auth';
  import { adminFetch } from '../lib/api';

  let secret = $state('');
  let loading = $state(false);
  let errorMessage = $state('');

  async function handleLogin(e: SubmitEvent) {
    e.preventDefault();
    if (!secret.trim()) {
      errorMessage = '请输入 ADMIN_SECRET';
      return;
    }
    loading = true;
    errorMessage = '';

    try {
      setAdminSecret(secret);
      // Validate by attempting to fetch error logs
      await adminFetch('/api/v1/admin/error-logs?limit=1');
      window.location.reload();
    } catch (err: any) {
      errorMessage = err.message || '秘钥验证失败，请重新检查';
    } finally {
      loading = false;
    }
  }
</script>

<div class="login-wrapper">
  <div class="card login-card">
    <div class="login-header">
      <div class="logo">EQT Admin</div>
      <h2>管理后台控制台</h2>
      <p class="subtitle">授权管控 • 错误审计 • 系统监控</p>
    </div>

    {#if errorMessage}
      <div class="error-banner">
        {errorMessage}
      </div>
    {/if}

    <form onsubmit={handleLogin}>
      <div class="form-group">
        <label for="secret">Admin Secret 密钥</label>
        <input
          id="secret"
          type="password"
          class="input"
          placeholder="请输入 X-Admin-Secret..."
          bind:value={secret}
          disabled={loading}
          required
        />
      </div>

      <button type="submit" class="btn btn-primary login-btn" disabled={loading}>
        {loading ? '正在验证凭证...' : '进入控制台'}
      </button>
    </form>
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

  .form-group {
    margin-bottom: 1.5rem;
  }

  label {
    display: block;
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--text-secondary);
    margin-bottom: 0.5rem;
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
</style>
