import { getAdminSecret, clearAdminSecret, getAdminAuthMode } from './auth';

/**
 * Base URL:
 * - Local/dev secret mode: VITE_API_BASE=http://127.0.0.1:8787 (direct Worker)
 * - Production Access mode: empty / same-origin → Pages Function proxies /api/* → lic.eqt.net.im
 * Contract: docs/admin/api-contract.md
 */
function resolveApiBase(): string {
  const envBase = import.meta.env.VITE_API_BASE;
  if (envBase !== undefined && envBase !== null && String(envBase).length > 0) {
    return String(envBase).replace(/\/$/, '');
  }
  if (getAdminAuthMode() === 'access') {
    return ''; // same-origin /api via Pages Function
  }
  return 'https://lic.eqt.net.im';
}

export interface ApiOptions extends RequestInit {
  params?: Record<string, string>;
}

export async function adminFetch<T = any>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const mode = getAdminAuthMode();
  const secret = getAdminSecret();

  if (mode === 'secret' && !secret) {
    throw new Error('未设置 Admin Secret');
  }

  const { params, headers: optHeaders, ...fetchInit } = options;
  const API_BASE = resolveApiBase();

  let urlStr = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams(params);
    urlStr += (urlStr.includes('?') ? '&' : '?') + searchParams.toString();
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((optHeaders as Record<string, string>) || {})
  };

  // Secret mode (or break-glass while Access also accepts secret)
  if (secret) {
    headers['X-Admin-Secret'] = secret;
  }

  const response = await fetch(urlStr, {
    ...fetchInit,
    headers,
    credentials: mode === 'access' ? 'same-origin' : 'omit'
  });

  if (response.status === 401) {
    clearAdminSecret();
    // Access: bounce to reload so CF Access login can re-run
    if (mode === 'access' && !secret) {
      window.location.href = window.location.pathname + '?auth=retry';
      throw new Error('Cloudflare Access 会话无效或未登录');
    }
    window.location.reload();
    throw new Error('鉴权凭证已失效或不正确');
  }

  if (response.status === 503) {
    const data = await response.json().catch(() => ({}));
    throw new Error((data as any).error || 'Admin API 未配置');
  }

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error || `请求失败 (${response.status})`);
  }

  return data as T;
}
