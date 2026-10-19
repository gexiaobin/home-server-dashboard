import type { AppConfig, Overview, ServiceHealth } from './types';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `请求失败 (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  getConfig: () => request<AppConfig>('/api/config'),
  saveConfig: (config: AppConfig) => request<AppConfig>('/api/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  }),
  getOverview: () => request<Overview>('/api/overview'),
  checkService: (id: string) => request<ServiceHealth>(`/api/services/${encodeURIComponent(id)}/check`, {
    method: 'POST',
  }),
};
