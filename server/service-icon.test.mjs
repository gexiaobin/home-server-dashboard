import http from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createServiceIconFetcher,
  detectIconContentType,
  parseIconCandidates,
  requestServiceResource,
  resolveServiceIcon,
  ServiceIconNotFoundError,
} from './service-icon.mjs';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const servers = [];

async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  servers.push(server);
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve, reject) => {
    server.closeAllConnections?.();
    server.close((error) => (error ? reject(error) : resolve()));
  })));
});

describe('parseIconCandidates', () => {
  it('resolves and prioritizes the largest DSM icon declared by the service page', () => {
    const html = `
      <link rel="apple-touch-icon" href="webman/resources/images/icon_dsm_96.png">
      <link rel="icon" href="webman/favicon.ico">
      <link sizes="96x96" href="webman/resources/images/icon_dsm_96.png?v=1" rel="icon">
      <link rel="icon" sizes="32x32" href="webman/resources/images/icon_dsm_32.png">
    `;

    expect(parseIconCandidates(html, 'https://nas.example.test:5001/')).toEqual([
      'https://nas.example.test:5001/webman/resources/images/icon_dsm_96.png?v=1',
      'https://nas.example.test:5001/webman/resources/images/icon_dsm_32.png',
      'https://nas.example.test:5001/webman/favicon.ico',
      'https://nas.example.test:5001/webman/resources/images/icon_dsm_96.png',
      'https://nas.example.test:5001/favicon.ico',
    ]);
  });

  it('prefers a service-declared SVG and respects a same-host base URL', () => {
    const html = `
      <base href="/ui/">
      <link rel="icon" href="favicon.ico" sizes="any">
      <link href="icon.svg" type="image/svg+xml" rel="shortcut icon">
    `;

    expect(parseIconCandidates(html, 'http://apps.example.test/login')).toEqual([
      'http://apps.example.test/ui/icon.svg',
      'http://apps.example.test/ui/favicon.ico',
      'http://apps.example.test/favicon.ico',
    ]);
  });

  it('ignores embedded and cross-host icon URLs', () => {
    const html = `
      <link rel="icon" href="data:image/png;base64,AAAA">
      <link rel="icon" href="javascript:alert(1)">
      <link rel="icon" href="https://tracker.example/icon.png">
      <link rel="icon" href="http://service.example.test:9000/admin.png">
    `;
    expect(parseIconCandidates(html, 'http://service.example.test/app')).toEqual([
      'http://service.example.test/favicon.ico',
    ]);
  });

  it('limits declared candidates while always retaining the conventional fallback', () => {
    const html = Array.from({ length: 30 }, (_, index) => (
      `<link rel="icon" sizes="${index + 1}x${index + 1}" href="/icon-${index}.png">`
    )).join('');

    const candidates = parseIconCandidates(html, 'http://service.example.test/app');
    expect(candidates).toHaveLength(12);
    expect(candidates.at(-1)).toBe('http://service.example.test/favicon.ico');
  });
});

describe('detectIconContentType', () => {
  it('detects image bytes instead of trusting the upstream header', () => {
    expect(detectIconContentType(PNG, 'text/plain')).toBe('image/png');
    expect(detectIconContentType(Buffer.from('not an icon'), 'image/png')).toBeNull();
    expect(detectIconContentType(Buffer.from('<svg viewBox="0 0 1 1"></svg>'), 'image/svg+xml'))
      .toBe('image/svg+xml');
    expect(detectIconContentType(
      Buffer.from('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"><svg></svg>'),
      'text/plain',
    )).toBe('image/svg+xml');
  });
});

describe('resolveServiceIcon', () => {
  it('reads the service page and tries declared icons in priority order', async () => {
    const requestResource = vi.fn(async (url) => {
      const target = String(url);
      if (target === 'http://service.example.test/app') {
        return {
          url: new URL(target),
          headers: { 'content-type': 'text/html; charset=utf-8' },
          body: Buffer.from(`
            <link rel="icon" sizes="64x64" href="/bad.png">
            <link rel="icon" sizes="32x32" href="/good.png">
          `),
        };
      }
      if (target.endsWith('/bad.png')) throw new Error('not found');
      if (target.endsWith('/good.png')) {
        return { url: new URL(target), headers: { 'content-type': 'text/plain' }, body: PNG };
      }
      throw new Error(`Unexpected URL: ${target}`);
    });

    await expect(resolveServiceIcon('http://service.example.test/app', { requestResource }))
      .resolves.toMatchObject({ body: PNG, contentType: 'image/png' });
    expect(requestResource.mock.calls.map(([url]) => String(url))).toEqual([
      'http://service.example.test/app',
      'http://service.example.test/bad.png',
      'http://service.example.test/good.png',
    ]);
  });

  it('falls back to the conventional origin favicon when HTML has no icon links', async () => {
    const requestResource = vi.fn(async (url) => {
      const target = String(url);
      if (target.endsWith('/app')) {
        return { url: new URL(target), headers: { 'content-type': 'text/html' }, body: Buffer.from('<title>App</title>') };
      }
      return { url: new URL(target), headers: {}, body: PNG };
    });

    await expect(resolveServiceIcon('http://service.example.test/app', { requestResource }))
      .resolves.toMatchObject({ contentType: 'image/png' });
    expect(String(requestResource.mock.calls[1][0])).toBe('http://service.example.test/favicon.ico');
  });

  it('returns a controlled not-found error when no candidate is a valid image', async () => {
    const requestResource = vi.fn(async (url) => ({
      url: new URL(String(url)),
      headers: { 'content-type': 'text/plain' },
      body: Buffer.from('not an image'),
    }));
    await expect(resolveServiceIcon('http://service.example.test', { requestResource }))
      .rejects.toBeInstanceOf(ServiceIconNotFoundError);
  });

  it('shares one timeout budget across page and candidate requests', async () => {
    let currentTime = 0;
    const requestResource = vi.fn(async (url) => {
      currentTime += 60;
      const target = String(url);
      if (target.endsWith('/app')) {
        return {
          url: new URL(target),
          headers: { 'content-type': 'text/html' },
          body: Buffer.from('<link rel="icon" href="/first.png"><link rel="icon" href="/second.png">'),
        };
      }
      throw new Error('offline');
    });

    await expect(resolveServiceIcon('http://service.example.test/app', {
      now: () => currentTime,
      requestResource,
      timeoutMs: 100,
    })).rejects.toBeInstanceOf(ServiceIconNotFoundError);
    expect(requestResource).toHaveBeenCalledTimes(2);
    expect(requestResource.mock.calls[1][1].timeoutMs).toBe(40);
  });
});

describe('requestServiceResource', () => {
  it('follows same-host redirects and enforces the response byte limit', async () => {
    const baseUrl = await serve((request, response) => {
      if (request.url === '/start') {
        response.writeHead(302, { location: '/icon' }).end();
        return;
      }
      response.writeHead(200, { 'content-type': 'image/png' }).end(PNG);
    });

    await expect(requestServiceResource(`${baseUrl}/start`, { maxBytes: 32 }))
      .resolves.toMatchObject({ status: 200, body: PNG });
    await expect(requestServiceResource(`${baseUrl}/icon`, { maxBytes: 4 }))
      .rejects.toThrow('exceeded 4 bytes');
  });

  it('rejects cross-host redirects and timeouts', async () => {
    const redirectUrl = await serve((_request, response) => {
      response.writeHead(302, { location: 'http://elsewhere.example/icon.png' }).end();
    });
    await expect(requestServiceResource(redirectUrl)).rejects.toThrow('Cross-origin redirects');

    const otherOrigin = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'image/png' }).end(PNG);
    });
    const crossPortUrl = await serve((_request, response) => {
      response.writeHead(302, { location: `${otherOrigin}/icon.png` }).end();
    });
    await expect(requestServiceResource(crossPortUrl)).rejects.toThrow('Cross-origin redirects');

    const slowUrl = await serve(() => {});
    await expect(requestServiceResource(slowUrl, { timeoutMs: 25 })).rejects.toThrow('timed out');
  });
});

describe('createServiceIconFetcher', () => {
  it('deduplicates concurrent work and keys the cache by id plus URL', async () => {
    const resolver = vi.fn(async () => ({ body: PNG, contentType: 'image/png', etag: '"png"' }));
    const fetchIcon = createServiceIconFetcher({ resolver });
    const service = { id: 'downloads', url: 'http://apps.example.test:8080' };

    const [first, second] = await Promise.all([fetchIcon(service), fetchIcon(service)]);
    expect(first).toBe(second);
    await fetchIcon(service);
    expect(resolver).toHaveBeenCalledTimes(1);

    await fetchIcon({ ...service, url: 'http://apps.example.test:8081' });
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it('briefly caches discovery failures', async () => {
    const resolver = vi.fn(async () => { throw new Error('offline'); });
    const fetchIcon = createServiceIconFetcher({ resolver });
    const service = { id: 'offline', url: 'http://offline.example.test' };

    await expect(fetchIcon(service)).rejects.toBeInstanceOf(ServiceIconNotFoundError);
    await expect(fetchIcon(service)).rejects.toBeInstanceOf(ServiceIconNotFoundError);
    expect(resolver).toHaveBeenCalledTimes(1);
  });
});
