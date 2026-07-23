import { getAdminSecret, clearAdminSecret } from './auth';

// Base URL: set VITE_API_BASE in .env.local (see .env.example).
// Contract: docs/admin/api-contract.md — production https://lic.eqt.net.im
const API_BASE = import.meta.env.VITE_API_BASE || 'https://eqt-drm-api.yelon.workers.dev';

export interface ApiOptions extends RequestInit {
  params?: Record<string, string>;
}

export async function adminFetch<T = any>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const secret = getAdminSecret();
  if (!secret) {
    throw new Error('未设置 Admin Secret');
  }

  const { params, headers: optHeaders, ...fetchInit } = options;

  let urlStr = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams(params);
    urlStr += (urlStr.includes('?') ? '&' : '?') + searchParams.toString();
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Admin-Secret': secret,
    ...((optHeaders as Record<string, string>) || {})
  };

  const response = await fetch(urlStr, {
    ...fetchInit,
    headers
  });

  if (response.status === 401) {
    clearAdminSecret();
    window.location.reload();
    throw new Error('鉴权凭证已失效或不正确');
  }

  if (response.status === 503) {
    const data = await response.json().catch(() => ({}));
    throw new Error((data as any).error || 'Admin API 未配置 (ADMIN_SECRET)');
  }

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error || `请求失败 (${response.status})`);
  }

  return data as T;
}
