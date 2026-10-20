import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkService, createApp, createConfigStore } from './index.mjs';

const servers = [];
const iconBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const configFixture = {
  settings: {
    title: 'Test dashboard',
    location: 'Test lab',
    refreshInterval: 5_000,
  },
  services: [
    {
      id: 'photos',
      name: 'Photos',
      url: 'http://photos.home.arpa',
      check: { type: 'http' },
    },
  ],
  topology: { nodes: [], links: [] },
};

function createDependencies(overrides = {}) {
  return {
    configStore: {
      get: vi.fn(async () => configFixture),
      put: vi.fn(async (config) => config),
    },
    metricsCollector: {
      collect: vi.fn(async () => ({
        system: { hostname: 'nas-test', platform: 'linux', uptime: 100, loadAverage: [0, 0, 0] },
        cpu: { usage: 12.5, cores: 4 },
        memory: { used: 25, total: 100, percent: 25 },
        disks: [],
        network: { rxBytesPerSecond: 10, txBytesPerSecond: 20, interfaces: [] },
        temperatures: [],
      })),
    },
    serviceChecker: vi.fn(async (service) => ({
      id: service.id,
      status: 'up',
      latency: 8,
      checkedAt: '2026-10-19T12:00:00.000Z',
      message: 'HTTP 200',
    })),
    serviceIconFetcher: vi.fn(async () => ({
      body: iconBytes,
      contentType: 'image/png',
      etag: '"fixture-icon"',
    })),
    dockerClient: vi.fn(async () => ([{
      id: 'container-1',
      name: 'photos',
      image: 'example/photos:latest',
      state: 'running',
      status: 'Up 1 hour',
    }])),
    dockerSocket: null,
    basicAuth: null,
    env: { npm_package_version: '9.9.9' },
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    serviceTimeoutMs: 321,
    serveStatic: false,
    ...overrides,
  };
}

async function serve(app) {
  const server = await new Promise((resolve, reject) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
    listeningServer.once('error', reject);
  });
  servers.push(server);
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function readJson(response) {
  return response.json();
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve, reject) => {
    server.closeAllConnections?.();
    server.close((error) => (error ? reject(error) : resolve()));
  })));
});

describe('checkService', () => {
  it('returns unknown without performing I/O when checks are disabled', async () => {
    const fetchImpl = vi.fn();

    await expect(checkService({ id: 'nas', check: { type: 'none' } }, { fetchImpl })).resolves.toEqual({
      id: 'nas',
      status: 'unknown',
      latency: null,
      checkedAt: null,
      message: 'Health check is not configured',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a successful HTTP probe with deterministic timing', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 204, body: null }));
    const monotonicNow = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(112);

    const result = await checkService({
      id: 'photos',
      url: 'http://photos.home.arpa',
      check: { type: 'http' },
    }, {
      fetchImpl,
      monotonicNow,
      wallClock: () => new Date('2026-10-19T12:00:00.000Z'),
    });

    expect(result).toEqual({
      id: 'photos',
      status: 'up',
      latency: 12,
      checkedAt: '2026-10-19T12:00:00.000Z',
      message: 'HTTP 204',
    });
    expect(fetchImpl.mock.calls[0][0]).toEqual(new URL('http://photos.home.arpa'));
  });

  it('turns failed HTTP and TCP probes into down status responses', async () => {
    const httpResult = await checkService({
      id: 'web',
      url: 'http://web.home.arpa',
      check: { type: 'http' },
    }, {
      fetchImpl: async () => ({ status: 503, body: null }),
      monotonicNow: () => 10,
    });
    const tcpResult = await checkService({
      id: 'ssh',
      check: { type: 'tcp', host: '192.0.2.1', port: 22 },
    }, {
      tcpProbeImpl: async () => { throw new Error('Connection refused'); },
      monotonicNow: () => 10,
    });

    expect(httpResult).toMatchObject({ id: 'web', status: 'down', message: 'HTTP 503' });
    expect(tcpResult).toMatchObject({ id: 'ssh', status: 'down', message: 'Connection refused' });
  });
});

describe('createApp', () => {
  it('keeps health public while requiring valid Basic Auth for protected endpoints', async () => {
    const dependencies = createDependencies({
      basicAuth: { username: 'admin', password: 'correct horse' },
    });
    const baseUrl = await serve(createApp(dependencies));

    const healthResponse = await fetch(`${baseUrl}/api/health`);
    const health = await readJson(healthResponse);
    expect(healthResponse.status).toBe(200);
    expect(health).toMatchObject({ status: 'ok', version: '9.9.9' });

    const unauthorizedResponse = await fetch(`${baseUrl}/api/config`);
    expect(unauthorizedResponse.status).toBe(401);
    expect(unauthorizedResponse.headers.get('www-authenticate')).toContain('Basic realm="Home Server"');
    await expect(readJson(unauthorizedResponse)).resolves.toEqual({ error: 'Authentication required' });

    const authorization = `Basic ${Buffer.from('admin:correct horse').toString('base64')}`;
    const authorizedResponse = await fetch(`${baseUrl}/api/config`, {
      headers: { authorization },
    });
    expect(authorizedResponse.status).toBe(200);
    await expect(readJson(authorizedResponse)).resolves.toEqual(configFixture);
    expect(dependencies.configStore.get).toHaveBeenCalledTimes(1);
  });

  it('reports storage readiness failures without exposing driver errors', async () => {
    const dependencies = createDependencies({
      configStore: {
        backend: 'postgresql',
        healthCheck: vi.fn(async () => {
          throw Object.assign(new Error('password authentication failed for secret-user'), { code: '28P01' });
        }),
        get: vi.fn(async () => configFixture),
        put: vi.fn(async (config) => config),
      },
    });
    const baseUrl = await serve(createApp(dependencies));

    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      status: 'error',
      storage: 'postgresql',
    });
    expect(dependencies.logger.warn).toHaveBeenCalledWith('Storage readiness check failed');
  });

  it('reads and updates config through the injected store', async () => {
    const dependencies = createDependencies();
    const baseUrl = await serve(createApp(dependencies));
    const updatedConfig = {
      ...configFixture,
      settings: { ...configFixture.settings, title: 'Updated dashboard' },
    };

    const getResponse = await fetch(`${baseUrl}/api/config`);
    expect(getResponse.status).toBe(200);
    await expect(readJson(getResponse)).resolves.toEqual(configFixture);

    const putResponse = await fetch(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(updatedConfig),
    });
    expect(putResponse.status).toBe(200);
    await expect(readJson(putResponse)).resolves.toEqual(updatedConfig);
    expect(dependencies.configStore.put).toHaveBeenCalledWith(updatedConfig);
  });

  it('rejects malformed JSON before it reaches the config store', async () => {
    const dependencies = createDependencies();
    const baseUrl = await serve(createApp(dependencies));

    const response = await fetch(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{"services": [',
    });

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({ error: 'Invalid JSON body' });
    expect(dependencies.configStore.put).not.toHaveBeenCalled();
  });

  it.each(['GET', 'POST'])('checks one configured service via %s without real network access', async (method) => {
    const dependencies = createDependencies();
    const baseUrl = await serve(createApp(dependencies));

    const response = await fetch(`${baseUrl}/api/services/photos/check`, { method });

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toMatchObject({
      id: 'photos',
      status: 'up',
      latency: 8,
    });
    expect(dependencies.serviceChecker).toHaveBeenCalledWith(
      configFixture.services[0],
      { timeoutMs: 321 },
    );
  });

  it('returns 404 for an unknown service without invoking the checker', async () => {
    const dependencies = createDependencies();
    const baseUrl = await serve(createApp(dependencies));

    const response = await fetch(`${baseUrl}/api/services/missing/check`, { method: 'POST' });

    expect(response.status).toBe(404);
    await expect(readJson(response)).resolves.toEqual({ error: 'Service not found' });
    expect(dependencies.serviceChecker).not.toHaveBeenCalled();
  });

  it('proxies the configured service icon with hardened response headers', async () => {
    const dependencies = createDependencies();
    const baseUrl = await serve(createApp(dependencies));

    const response = await fetch(`${baseUrl}/api/services/photos/icon?url=http://attacker.invalid/icon`);

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(iconBytes);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(dependencies.serviceIconFetcher).toHaveBeenCalledWith(configFixture.services[0]);

    const cachedResponse = await fetch(`${baseUrl}/api/services/photos/icon`, {
      headers: { 'if-none-match': '"fixture-icon"' },
    });
    expect(cachedResponse.status).toBe(304);
  });

  it('does not invoke icon discovery for an unknown service', async () => {
    const dependencies = createDependencies();
    const baseUrl = await serve(createApp(dependencies));

    const response = await fetch(`${baseUrl}/api/services/missing/icon`);

    expect(response.status).toBe(404);
    expect(dependencies.serviceIconFetcher).not.toHaveBeenCalled();
  });

  it('returns 404 without exposing upstream icon errors', async () => {
    const dependencies = createDependencies({
      serviceIconFetcher: vi.fn(async () => { throw new Error('certificate expired at private host'); }),
    });
    const baseUrl = await serve(createApp(dependencies));

    const response = await fetch(`${baseUrl}/api/services/photos/icon`);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
    expect(dependencies.logger.warn).toHaveBeenCalledWith('Unable to resolve icon for service photos');
  });

  it('aggregates injected metrics, service checks, and Docker data for overview', async () => {
    const dependencies = createDependencies({ dockerSocket: '/fixture/docker.sock' });
    const baseUrl = await serve(createApp(dependencies));

    const response = await fetch(`${baseUrl}/api/overview`);
    const overview = await readJson(response);

    expect(response.status).toBe(200);
    expect(overview).toMatchObject({
      system: { hostname: 'nas-test' },
      cpu: { usage: 12.5, cores: 4 },
      services: [{ id: 'photos', status: 'up' }],
      containers: [{ id: 'container-1', name: 'photos', state: 'running' }],
    });
    expect(dependencies.metricsCollector.collect).toHaveBeenCalledOnce();
    expect(dependencies.serviceChecker).toHaveBeenCalledWith(
      configFixture.services[0],
      { timeoutMs: 321 },
    );
    expect(dependencies.dockerClient).toHaveBeenCalledWith('/fixture/docker.sock');
  });
});

describe('createConfigStore', () => {
  it('keeps file storage available for local development', () => {
    expect(createConfigStore({ STORAGE_BACKEND: 'file', DATA_DIR: '/tmp/dashboard-test' }).backend).toBe('file');
  });

  it('requires a connection source for explicit PostgreSQL storage', () => {
    expect(() => createConfigStore({ STORAGE_BACKEND: 'postgresql' }))
      .toThrow('PostgreSQL storage requires DATABASE_URL or DATABASE_URL_FILE');
  });

  it('selects PostgreSQL when a secret file is configured', () => {
    const store = createConfigStore({ DATABASE_URL_FILE: '/run/secrets/database_url' });
    expect(store.backend).toBe('postgresql');
  });
});
