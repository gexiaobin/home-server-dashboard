import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from './types';
import { api } from './api';

const config = {
  settings: { title: 'HomeLab', location: 'Home', hostDisplayName: '', refreshInterval: 5000 },
  services: [],
  topology: { source: 'manual', refreshInterval: 15_000, hosts: [], nodes: [], links: [] },
} satisfies AppConfig;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('config API revisions', () => {
  it('returns the server ETag with the config document', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(config), {
      status: 200,
      headers: { 'content-type': 'application/json', etag: '"config-7"' },
    })));

    await expect(api.getConfig()).resolves.toEqual({ config, revision: '"config-7"' });
  });

  it('sends the loaded ETag in If-Match when saving', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(config), {
      status: 200,
      headers: { 'content-type': 'application/json', etag: '"config-8"' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.saveConfig(config, '"config-7"')).resolves.toEqual({
      config,
      revision: '"config-8"',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/config', expect.objectContaining({
      method: 'PUT',
      headers: expect.objectContaining({ 'If-Match': '"config-7"' }),
    }));
  });

  it('preserves the HTTP status on a config conflict', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'Config has changed since it was loaded',
    }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    })));

    await expect(api.saveConfig(config, '"config-stale"')).rejects.toEqual(expect.objectContaining({
      status: 409,
      message: 'Config has changed since it was loaded',
    }));
  });
});
