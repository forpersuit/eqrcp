import { clearAccessSession, isAuthenticated } from './auth';

/**
 * Base URL:
 * - Production Access: empty → same-origin /api via Pages Function → lic.eqt.net.im
 * - Local override: VITE_API_BASE=http://127.0.0.1:8787 (still needs Access JWT header from CF edge
 *   or local.dev test JWT; browser Access cookies only work on admin.eqt.net.im)
 */
function resolveApiBase(): string {
  const envBase = import.meta.env.VITE_API_BASE;
  if (envBase !== undefined && envBase !== null && String(envBase).length > 0) {
    return String(envBase).replace(/\/$/, '');
  }
  return '';
}

export interface ApiOptions extends RequestInit {
  params?: Record<string, string>;
}

export async function adminFetch<T = any>(endpoint: string, options: ApiOptions = {}): Promise<T> {
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

  const response = await fetch(urlStr, {
    ...fetchInit,
    headers,
    credentials: 'same-origin'
  });

  if (response.status === 401) {
    clearAccessSession();
    if (isAuthenticated() === false) {
      window.location.href = window.location.pathname + '?auth=retry';
    } else {
      window.location.reload();
    }
    throw new Error('Cloudflare Access 会话无效或未登录');
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
