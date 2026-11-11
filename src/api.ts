import type { AppConfig, Overview, ServiceHealth, TopologySnapshot } from './types';

export interface ConfigSnapshot {
  config: AppConfig;
  revision: string;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

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
    throw new ApiError(body?.error || `请求失败 (${response.status})`, response.status);
  }
  return response.json() as Promise<T>;
}

async function configRequest(options?: RequestInit): Promise<ConfigSnapshot> {
  const response = await fetch('/api/config', {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(body?.error || `请求失败 (${response.status})`, response.status);
  }
  const revision = response.headers.get('etag');
  if (!revision) {
    throw new ApiError('服务端未返回配置版本，请刷新后重试', 502);
  }
  return {
    config: await response.json() as AppConfig,
    revision,
  };
}

export const api = {
  getConfig: () => configRequest(),
  saveConfig: (config: AppConfig, revision: string) => configRequest({
    method: 'PUT',
    headers: { 'If-Match': revision },
    body: JSON.stringify(config),
  }),
  getOverview: () => request<Overview>('/api/overview'),
  getTopology: () => request<TopologySnapshot>('/api/topology'),
  checkService: (id: string) => request<ServiceHealth>(`/api/services/${encodeURIComponent(id)}/check`, {
    method: 'POST',
  }),
};
