import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildIkuaiTopology,
  createIkuaiTopologyProvider,
  IkuaiProviderError,
  requestIkuaiJson,
} from './ikuai.mjs';

const servers = [];

async function serve(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  servers.push(server);
  const address = server.address();
  return new URL(`http://127.0.0.1:${address.port}`);
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve, reject) => {
    server.closeAllConnections?.();
    server.close((error) => (error ? reject(error) : resolve()));
  })));
});

const systemFixture = {
  message: 'Success',
  results: {
    sysinfo: {
      hostname: 'Main Router',
      ip_addr: '192.0.2.1',
      cpu: ['12.5%'],
      memory: { used: '42%' },
      stream: { upload: 1024, download: 2048, total_up: 10_000, total_down: 20_000 },
      uptime: 12345,
      verinfo: { modelname: 'iKuai', verstring: '4.0.308 x64' },
    },
  },
};

const clientsFixture = {
  results: {
    total: 2,
    data: [
      {
        comment: 'Living Room TV',
        ip_addr: '192.0.2.20',
        mac: 'AA:BB:CC:DD:EE:20',
        uplink_addr: 'AA:BB:CC:DD:EE:10',
        interface: 'lan1',
        client_type: 'Smart TV',
        upload: 128,
        download: 512,
      },
      {
        termname: 'Laptop',
        ip_addr: '192.0.2.21',
        mac: 'AA:BB:CC:DD:EE:21',
        interface: 'lan1',
        client_vendor: 'Apple',
      },
    ],
  },
};

const downstreamFixture = {
  results: {
    data: [{
      name: 'Core Switch',
      ip_addr: '192.0.2.10',
      mac: 'AA:BB:CC:DD:EE:10',
      device: 'switches',
      status: 1,
    }],
  },
};

describe('buildIkuaiTopology', () => {
  it('normalizes router and client data into an anonymous layered graph', () => {
    const result = buildIkuaiTopology({
      system: systemFixture,
      clients: clientsFixture,
      downstream: downstreamFixture,
      interfaces: { results: { ether_info: { eth0: { link: 1 }, eth1: { link: 0 } } } },
      now: () => new Date('2026-10-21T12:00:00.000Z'),
    });

    expect(result.updatedAt).toBe('2026-10-21T12:00:00.000Z');
    expect(result.stats).toEqual({
      onlineClients: 2,
      knownDevices: 3,
      linkedInterfaces: 1,
      upload: 1024,
      download: 2048,
    });
    expect(result.nodes.slice(0, 2)).toMatchObject([
      { id: 'ikuai-internet', type: 'internet' },
      {
        id: 'ikuai-router',
        label: 'Main Router',
        ipAddress: '192.0.2.1',
        version: '4.0.308 x64',
        cpuUsage: 12.5,
        memoryUsage: 42,
      },
    ]);

    const switchNode = result.nodes.find((node) => node.label === 'Core Switch');
    const televisionNode = result.nodes.find((node) => node.label === 'Living Room TV');
    expect(switchNode).toMatchObject({ type: 'switch', status: 'up' });
    expect(televisionNode).toMatchObject({
      type: 'client',
      ipAddress: '192.0.2.20',
      upload: 128,
      download: 512,
    });
    expect(televisionNode.id).not.toContain('aa:bb');
    expect(result.links).toContainEqual({
      source: switchNode.id,
      target: televisionNode.id,
      label: 'lan1',
    });
    expect(televisionNode.y).toBeGreaterThan(switchNode.y);
    expect(switchNode).not.toHaveProperty('key');
  });

  it('merges a downstream device without a MAC by IP and restores its uplink relationship', () => {
    const result = buildIkuaiTopology({
      system: systemFixture,
      downstream: {
        results: {
          data: [{
            name: 'Core Switch',
            ip_addr: '192.0.2.10',
            mac: '',
            device: 'switches',
            status: 1,
          }],
        },
      },
      clients: {
        results: {
          total: 2,
          data: [
            {
              ip_addr: '192.0.2.10',
              mac: 'AA:BB:CC:DD:EE:10',
              client_type: 'generic',
            },
            {
              comment: 'Living Room TV',
              ip_addr: '192.0.2.20',
              mac: 'AA:BB:CC:DD:EE:20',
              uplink_addr: 'AA:BB:CC:DD:EE:10',
            },
          ],
        },
      },
      interfaces: { results: { ether_info: {} } },
    });

    const switchNodes = result.nodes.filter((node) => node.ipAddress === '192.0.2.10');
    const televisionNode = result.nodes.find((node) => node.label === 'Living Room TV');
    expect(switchNodes).toHaveLength(1);
    expect(switchNodes[0]).toMatchObject({
      label: 'Core Switch',
      mac: 'aa:bb:cc:dd:ee:10',
      type: 'switch',
    });
    expect(result.links).toContainEqual(expect.objectContaining({
      source: switchNodes[0].id,
      target: televisionNode.id,
    }));
  });
});

describe('createIkuaiTopologyProvider', () => {
  it('uses only fixed read endpoints, reads the deployment token, and caches results', async () => {
    const requestImpl = vi.fn(async (url, options) => {
      expect(options.token).toBe('0123456789abcdef0123456789abcdef');
      if (url.pathname.endsWith('/system')) return systemFixture;
      if (url.pathname.endsWith('/clients-online')) return clientsFixture;
      if (url.pathname.endsWith('/downstream')) return downstreamFixture;
      return { results: { ether_info: {} } };
    });
    const provider = createIkuaiTopologyProvider({
      env: {
        IKUAI_BASE_URL: 'http://192.0.2.1',
        IKUAI_TOKEN_FILE: '/run/secrets/ikuai_token',
      },
      fsImpl: {
        stat: vi.fn(async () => ({ isFile: () => true, size: 32 })),
        readFile: vi.fn(async () => '0123456789abcdef0123456789abcdef'),
      },
      requestImpl,
      now: () => new Date('2026-10-21T12:00:00.000Z'),
      logger: { warn: vi.fn() },
    });

    const first = await provider.load(15_000);
    const second = await provider.load(15_000);

    expect(second).toBe(first);
    expect(requestImpl).toHaveBeenCalledTimes(4);
    expect(requestImpl.mock.calls.map(([url]) => `${url.pathname}${url.search}`)).toEqual([
      '/api/v4.0/monitoring/system',
      '/api/v4.0/monitoring/clients-online?page=1&limit=500&order_by=download&order=desc',
      '/api/v4.0/monitoring/downstream?TYPE=data&LIMIT=0%2C500&OFFSET=0',
      '/api/v4.0/monitoring/interfaces-physical',
    ]);
  });

  it('paginates online clients and caps collection requests at the supported page size', async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      ip_addr: `10.0.${Math.floor(index / 250)}.${(index % 250) + 1}`,
      mac: `02:00:00:${Math.floor(index / 65_536).toString(16).padStart(2, '0')}:${Math.floor(index / 256).toString(16).padStart(2, '0')}:${(index % 256).toString(16).padStart(2, '0')}`,
    }));
    const requestImpl = vi.fn(async (url) => {
      if (url.pathname.endsWith('/system')) return systemFixture;
      if (url.pathname.endsWith('/clients-online')) {
        return url.searchParams.get('page') === '1'
          ? { results: { total: 501, data: firstPage } }
          : { results: { total: 501, data: [{ ip_addr: '10.0.3.1', mac: '02:00:00:00:03:01' }] } };
      }
      return { results: { data: [], ether_info: {} } };
    });
    const provider = createIkuaiTopologyProvider({
      env: {
        IKUAI_BASE_URL: 'http://router.local',
        IKUAI_TOKEN: '0123456789abcdef0123456789abcdef',
      },
      requestImpl,
    });

    const result = await provider.load();

    expect(result.stats.onlineClients).toBe(501);
    expect(requestImpl.mock.calls
      .filter(([url]) => url.pathname.endsWith('/clients-online'))
      .map(([url]) => url.searchParams.get('page'))).toEqual(['1', '2']);
  });

  it('coalesces concurrent requests, expires its cache, and retries after a failure', async () => {
    let clock = 1_000_000;
    let failSystem = true;
    let releaseSystem;
    const systemGate = new Promise((resolve) => { releaseSystem = resolve; });
    const requestImpl = vi.fn(async (url) => {
      if (url.pathname.endsWith('/system')) {
        if (failSystem) {
          failSystem = false;
          throw new Error('temporary failure');
        }
        await systemGate;
        return systemFixture;
      }
      if (url.pathname.endsWith('/clients-online')) return { results: { total: 0, data: [] } };
      return { results: { data: [], ether_info: {} } };
    });
    const provider = createIkuaiTopologyProvider({
      env: {
        IKUAI_BASE_URL: 'http://router.local',
        IKUAI_TOKEN: '0123456789abcdef0123456789abcdef',
      },
      requestImpl,
      now: () => new Date(clock),
    });

    await expect(provider.load(5_000)).rejects.toBeInstanceOf(IkuaiProviderError);
    const first = provider.load(5_000);
    const concurrent = provider.load(5_000);
    expect(concurrent).toBe(first);
    releaseSystem();
    const firstValue = await first;
    await expect(concurrent).resolves.toBe(firstValue);

    await expect(provider.load(5_000)).resolves.toBe(firstValue);
    const callsBeforeExpiry = requestImpl.mock.calls.length;
    clock += 5_001;
    await provider.load(5_000);
    expect(requestImpl.mock.calls.length).toBe(callsBeforeExpiry + 4);
  });

  it('rejects malformed required response envelopes instead of caching an empty live graph', async () => {
    const createProvider = (system, clients) => createIkuaiTopologyProvider({
      env: {
        IKUAI_BASE_URL: 'http://router.local',
        IKUAI_TOKEN: '0123456789abcdef0123456789abcdef',
      },
      requestImpl: vi.fn(async (url) => {
        if (url.pathname.endsWith('/system')) return system;
        if (url.pathname.endsWith('/clients-online')) return clients;
        return { results: { data: [], ether_info: {} } };
      }),
    });

    await expect(createProvider(
      { code: 0, results: {} },
      { results: { total: 0, data: [] } },
    ).load()).rejects.toThrow('missing system information');
    await expect(createProvider(
      systemFixture,
      { code: 0, results: { total: 4 } },
    ).load()).rejects.toThrow('missing its data collection');
  });

  it('validates direct and file tokens before making a router request', async () => {
    const requestImpl = vi.fn(async (url) => {
      if (url.pathname.endsWith('/system')) return systemFixture;
      if (url.pathname.endsWith('/clients-online')) return { results: { total: 0, data: [] } };
      return { results: { data: [], ether_info: {} } };
    });
    const invalidDirect = createIkuaiTopologyProvider({
      env: { IKUAI_BASE_URL: 'http://router.local', IKUAI_TOKEN: 'short token' },
      requestImpl,
    });
    const conventionalFile = createIkuaiTopologyProvider({
      env: { IKUAI_BASE_URL: 'http://router.local', IKUAI_TOKEN_FILE: '/run/secrets/ikuai' },
      fsImpl: {
        stat: vi.fn(async () => ({ isFile: () => true, size: 33 })),
        readFile: vi.fn(async () => '0123456789abcdef0123456789abcdef\n'),
      },
      requestImpl,
    });

    await expect(invalidDirect.load()).rejects.toMatchObject({ code: 'IKUAI_MISCONFIGURED' });
    await expect(conventionalFile.load()).resolves.toMatchObject({ stats: { onlineClients: 0 } });
    expect(requestImpl).toHaveBeenCalledTimes(4);

    const opaqueRequest = vi.fn(async (url) => {
      if (url.pathname.endsWith('/system')) return systemFixture;
      if (url.pathname.endsWith('/clients-online')) return { results: { total: 0, data: [] } };
      return { results: { data: [], ether_info: {} } };
    });
    const opaqueToken = createIkuaiTopologyProvider({
      env: {
        IKUAI_BASE_URL: 'http://router.local',
        IKUAI_TOKEN: 'opaque.JWT-like_token~value+/==',
      },
      requestImpl: opaqueRequest,
    });
    await expect(opaqueToken.load()).resolves.toMatchObject({ stats: { onlineClients: 0 } });
    expect(opaqueRequest).toHaveBeenCalledTimes(4);
  });

  it('keeps an unconfigured provider isolated from the rest of the application', async () => {
    const provider = createIkuaiTopologyProvider({ env: {} });

    await expect(provider.load()).rejects.toMatchObject({
      name: 'IkuaiProviderError',
      code: 'IKUAI_NOT_CONFIGURED',
    });
  });

  it('rejects a user-info URL before sending the token', async () => {
    const requestImpl = vi.fn();
    const provider = createIkuaiTopologyProvider({
      env: {
        IKUAI_BASE_URL: 'http://attacker:password@example.com',
        IKUAI_TOKEN: 'secret-token',
      },
      requestImpl,
    });

    await expect(provider.load()).rejects.toMatchObject({ code: 'IKUAI_MISCONFIGURED' });
    expect(requestImpl).not.toHaveBeenCalled();
  });
});

describe('requestIkuaiJson', () => {
  it('sends a bearer token and parses a bounded JSON response', async () => {
    const baseUrl = await serve((request, response) => {
      expect(request.headers.authorization).toBe('Bearer private-token');
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ results: { ok: true } }));
    });

    await expect(requestIkuaiJson(new URL('/api/v4.0/monitoring/system', baseUrl), {
      token: 'private-token',
      timeoutMs: 500,
    })).resolves.toEqual({ results: { ok: true } });
  });

  it('never follows an API redirect with the bearer token', async () => {
    const baseUrl = await serve((_request, response) => {
      response.writeHead(302, { location: 'http://example.com/collect' });
      response.end();
    });

    await expect(requestIkuaiJson(new URL('/api/v4.0/monitoring/system', baseUrl), {
      token: 'private-token',
      timeoutMs: 500,
    })).rejects.toBeInstanceOf(IkuaiProviderError);
  });

  it('normalizes nested bare nil values without changing quoted text', async () => {
    const baseUrl = await serve((_request, response) => {
      response.end('{"results":{"device":nil,"label":"vanilla nil"}}');
    });

    await expect(requestIkuaiJson(new URL('/api/v4.0/monitoring/system', baseUrl), {
      token: 'private-token',
      timeoutMs: 500,
    })).resolves.toEqual({ results: { device: null, label: 'vanilla nil' } });
  });

  it.each([3_007, 1_008, 10_014])('rejects iKuai authentication business error %i', async (code) => {
    const baseUrl = await serve((_request, response) => {
      response.end(JSON.stringify({ code, message: 'token expired', results: {} }));
    });

    await expect(requestIkuaiJson(new URL('/api/v4.0/monitoring/system', baseUrl), {
      token: 'private-token',
      timeoutMs: 500,
    })).rejects.toMatchObject({
      code: 'IKUAI_AUTH_FAILED',
      message: expect.stringContaining('token expired'),
    });
  });

  it.each([401, 403])('classifies HTTP %i as an authentication failure without reading the body', async (status) => {
    const baseUrl = await serve((_request, response) => {
      response.writeHead(status, { 'content-type': 'text/html' });
      response.end('<p>sensitive router detail</p>');
    });

    await expect(requestIkuaiJson(new URL('/api/v4.0/monitoring/system', baseUrl), {
      token: 'private-token',
      timeoutMs: 500,
    })).rejects.toMatchObject({
      code: 'IKUAI_AUTH_FAILED',
      message: `iKuai API returned HTTP ${status}`,
    });
  });

  it('enforces timeout, declared content length, and streamed response limits', async () => {
    const timeoutUrl = await serve(() => {});
    await expect(requestIkuaiJson(new URL('/timeout', timeoutUrl), {
      token: 'private-token',
      timeoutMs: 25,
    })).rejects.toThrow('timed out');

    const declaredUrl = await serve((_request, response) => {
      response.setHeader('content-length', '100');
      response.end('{}');
    });
    await expect(requestIkuaiJson(new URL('/declared', declaredUrl), {
      token: 'private-token',
      timeoutMs: 500,
      maxBytes: 10,
    })).rejects.toThrow('too large');

    const streamedUrl = await serve((_request, response) => {
      response.write('{"results":"');
      response.end('a-long-response"}');
    });
    await expect(requestIkuaiJson(new URL('/streamed', streamedUrl), {
      token: 'private-token',
      timeoutMs: 500,
      maxBytes: 10,
    })).rejects.toThrow('too large');
  });
});

