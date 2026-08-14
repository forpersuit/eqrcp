import { clearAccessSession } from './auth';
import { getAdminEnvironment } from './env.svelte';

/**
 * Base URL:
 * - Production Access: empty → same-origin /api via Pages Function → lic.eqt.net.im / lic-test.eqt.net.im
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

export async function adminFetch<T = unknown>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { params, headers: optHeaders, ...fetchInit } = options;
  const API_BASE = resolveApiBase();
  const currentEnv = getAdminEnvironment();

  let urlStr = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams(params);
    urlStr += (urlStr.includes('?') ? '&' : '?') + searchParams.toString();
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-EQT-Environment': currentEnv,
    ...((optHeaders as Record<string, string>) || {})
  };

  let response: Response;
  try {
    response = await fetch(urlStr, {
      ...fetchInit,
      headers,
      credentials: 'same-origin'
    });
  } catch (err: any) {
    throw new Error(`网络连接失败: ${err?.message || '未知网络错误'}`);
  }

  if (response.status === 401) {
    clearAccessSession();
    const data = await response.json().catch(() => ({}));
    const msg = data?.error ? `${data.error} (${data.code || '401'})` : 'Cloudflare Access 会话无效或未登录 (401)';
    throw new Error(msg);
  }

  if (response.status === 502 || response.status === 503) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error || `服务暂时不可用 (${response.status})`);
  }

  const data = await response.json().catch(() => null);
  if (data === null) {
    if (!response.ok) {
      throw new Error(`请求失败 (${response.status} ${response.statusText})`);
    }
    return {} as T;
  }

  if (!response.ok || (data && typeof data === 'object' && 'error' in data && data.error)) {
    throw new Error(data?.error || `请求失败 (${response.status})`);
  }

  return data as T;
}
