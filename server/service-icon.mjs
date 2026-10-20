import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

import { parse } from 'parse5';

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_HTML_LIMIT = 256 * 1024;
const DEFAULT_ICON_LIMIT = 1024 * 1024;
const DEFAULT_POSITIVE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_NEGATIVE_TTL_MS = 60 * 1000;
const MAX_ICON_CANDIDATES = 12;

export class ServiceIconNotFoundError extends Error {
  constructor(message = 'Service icon not found') {
    super(message);
    this.name = 'ServiceIconNotFoundError';
    this.statusCode = 404;
  }
}

function parseHttpUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new ServiceIconNotFoundError('Service URL is invalid');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new ServiceIconNotFoundError('Service URL is not supported');
  }
  parsed.hash = '';
  return parsed;
}

function getHeader(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  const value = headers[name.toLowerCase()] ?? headers[name];
  return Array.isArray(value) ? value[0] || '' : String(value || '');
}

function requestOnce(target, {
  accept,
  allowInsecureTls,
  maxBytes,
  timeoutMs,
}) {
  return new Promise((resolve, reject) => {
    const requestImpl = target.protocol === 'https:' ? httpsRequest : httpRequest;
    let settled = false;
    let timer;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };

    const request = requestImpl(target, {
      method: 'GET',
      headers: {
        accept,
        'user-agent': 'home-server-dashboard/1.0',
      },
      ...(target.protocol === 'https:' ? { rejectUnauthorized: !allowInsecureTls } : {}),
    }, (response) => {
      const status = response.statusCode || 0;
      const headers = response.headers;
      if (status < 200 || status >= 300) {
        response.destroy();
        finish(null, { status, headers, body: Buffer.alloc(0), url: target });
        return;
      }

      const declaredLength = Number(getHeader(headers, 'content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        response.destroy();
        finish(new Error(`Response exceeded ${maxBytes} bytes`));
        return;
      }

      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > maxBytes) {
          response.destroy();
          finish(new Error(`Response exceeded ${maxBytes} bytes`));
          return;
        }
        chunks.push(bytes);
      });
      response.once('error', (error) => finish(error));
      response.once('end', () => finish(null, {
        status,
        headers,
        body: Buffer.concat(chunks),
        url: target,
      }));
    });

    timer = setTimeout(() => request.destroy(new Error(`Request timed out after ${timeoutMs} ms`)), timeoutMs);
    request.once('error', (error) => finish(error));
    request.end();
  });
}

export async function requestServiceResource(url, {
  accept = '*/*',
  allowInsecureTls = false,
  maxBytes = DEFAULT_ICON_LIMIT,
  maxRedirects = 3,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  let target = parseHttpUrl(url);
  const allowedOrigin = target.origin;
  const deadline = Date.now() + timeoutMs;

  for (let redirectCount = 0; ; redirectCount += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error(`Request timed out after ${timeoutMs} ms`);
    const result = await requestOnce(target, {
      accept,
      allowInsecureTls,
      maxBytes,
      timeoutMs: remainingMs,
    });
    const location = getHeader(result.headers, 'location');
    if (result.status >= 300 && result.status < 400 && location) {
      if (redirectCount >= maxRedirects) throw new Error('Too many redirects');
      const next = parseHttpUrl(new URL(location, target).toString());
      if (next.origin !== allowedOrigin) {
        throw new Error('Cross-origin redirects are not allowed');
      }
      target = next;
      continue;
    }
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Upstream returned HTTP ${result.status}`);
    }
    return result;
  }
}

function walk(node, visitor) {
  visitor(node);
  for (const child of node.childNodes || []) walk(child, visitor);
}

function attribute(node, name) {
  return node.attrs?.find((item) => item.name.toLowerCase() === name)?.value || '';
}

function iconSizeScore(value) {
  if (!value) return 0;
  if (value.trim().toLowerCase() === 'any') return 180;
  return Math.min(160, Math.max(0, ...value.split(/\s+/).map((size) => {
    const match = size.match(/^(\d+)x(\d+)$/i);
    return match ? Math.max(Number(match[1]), Number(match[2])) : 0;
  })));
}

function isSameOrigin(left, right) {
  return left.origin === right.origin;
}

export function parseIconCandidates(html, pageUrl) {
  const page = parseHttpUrl(pageUrl);
  const document = parse(html);
  let base = page;
  walk(document, (node) => {
    if (node.tagName !== 'base' || base !== page) return;
    const href = attribute(node, 'href');
    if (!href) return;
    try {
      const candidate = parseHttpUrl(new URL(href, page).toString());
      if (isSameOrigin(candidate, page)) base = candidate;
    } catch {
      // Ignore invalid or unsupported base URLs.
    }
  });

  const candidates = [];
  let order = 0;
  walk(document, (node) => {
    if (node.tagName !== 'link') return;
    const rel = attribute(node, 'rel').toLowerCase().split(/\s+/).filter(Boolean);
    const href = attribute(node, 'href');
    if (!href) return;

    let score = 0;
    if (rel.includes('icon')) score = 300;
    else if (rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) score = 200;
    else if (rel.includes('mask-icon')) score = 100;
    else return;

    try {
      const candidate = parseHttpUrl(new URL(href, base).toString());
      if (!isSameOrigin(candidate, page)) return;
      const declaredType = attribute(node, 'type').toLowerCase();
      if (declaredType === 'image/svg+xml' || candidate.pathname.toLowerCase().endsWith('.svg')) score += 200;
      score += iconSizeScore(attribute(node, 'sizes'));
      candidates.push({ url: candidate.toString(), score, order: order++ });
    } catch {
      // Ignore invalid, embedded, and non-HTTP icon URLs.
    }
  });

  const fallback = new URL('/favicon.ico', page.origin).toString();
  const uniqueCandidates = [...new Set([
    ...candidates.sort((left, right) => right.score - left.score || left.order - right.order).map((item) => item.url),
    fallback,
  ])];
  const limitedCandidates = uniqueCandidates.slice(0, MAX_ICON_CANDIDATES);
  if (!limitedCandidates.includes(fallback)) {
    limitedCandidates[limitedCandidates.length - 1] = fallback;
  }
  return limitedCandidates;
}

export function detectIconContentType(body, declaredType = '') {
  if (!Buffer.isBuffer(body) || body.length < 4) return null;
  if (body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg';
  if (body.subarray(0, 6).toString('ascii') === 'GIF87a' || body.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  if (body.subarray(0, 4).toString('ascii') === 'RIFF' && body.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (body[0] === 0x00 && body[1] === 0x00 && [0x01, 0x02].includes(body[2]) && body[3] === 0x00) return 'image/x-icon';
  if (body.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp';
  if (body.subarray(4, 12).toString('ascii').includes('ftypavif')) return 'image/avif';

  const prefix = body.subarray(0, 4096).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!doctype\s+svg[^>]*>\s*)?<svg(?:\s|>)/i.test(prefix)) {
    return 'image/svg+xml';
  }
  return null;
}

export async function resolveServiceIcon(serviceUrl, {
  allowInsecureTls = false,
  htmlLimit = DEFAULT_HTML_LIMIT,
  iconLimit = DEFAULT_ICON_LIMIT,
  requestResource = requestServiceResource,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = () => Date.now(),
} = {}) {
  const configuredUrl = parseHttpUrl(serviceUrl);
  const deadline = now() + timeoutMs;
  let pageUrl = configuredUrl;
  let candidates = [new URL('/favicon.ico', configuredUrl.origin).toString()];

  const requestWithinDeadline = (url, options) => {
    const remainingMs = deadline - now();
    if (remainingMs <= 0) throw new Error(`Service icon resolution timed out after ${timeoutMs} ms`);
    return requestResource(url, { ...options, timeoutMs: remainingMs });
  };

  try {
    const page = await requestWithinDeadline(configuredUrl, {
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
      allowInsecureTls,
      maxBytes: htmlLimit,
    });
    const contentType = getHeader(page.headers, 'content-type').toLowerCase();
    if (contentType.startsWith('text/html') || contentType.startsWith('application/xhtml+xml')) {
      pageUrl = parseHttpUrl(page.url || configuredUrl);
      candidates = parseIconCandidates(page.body.toString('utf8'), pageUrl);
    }
  } catch {
    // The conventional favicon remains a useful fallback when the page cannot be read.
  }

  for (const candidate of candidates) {
    try {
      const icon = await requestWithinDeadline(candidate, {
        accept: 'image/avif,image/webp,image/svg+xml,image/png,image/jpeg,image/gif,image/x-icon,*/*;q=0.1',
        allowInsecureTls,
        maxBytes: iconLimit,
      });
      if (!isSameOrigin(parseHttpUrl(icon.url || candidate), pageUrl)) continue;
      const contentType = detectIconContentType(icon.body, getHeader(icon.headers, 'content-type'));
      if (!contentType) continue;
      return {
        body: icon.body,
        contentType,
        etag: `"${createHash('sha256').update(icon.body).digest('hex')}"`,
      };
    } catch {
      // Try the next icon declared by the service page.
    }
  }

  throw new ServiceIconNotFoundError();
}

export function createServiceIconFetcher({
  allowInsecureTls = false,
  maxCacheBytes = 16 * 1024 * 1024,
  maxCacheEntries = 128,
  negativeTtlMs = DEFAULT_NEGATIVE_TTL_MS,
  now = () => Date.now(),
  positiveTtlMs = DEFAULT_POSITIVE_TTL_MS,
  resolver = resolveServiceIcon,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const cache = new Map();
  const inflight = new Map();
  let cacheBytes = 0;

  function cacheResult(key, entry) {
    deleteCachedResult(key);
    cache.set(key, entry);
    if (entry.result) cacheBytes += entry.result.body.length;

    while (cache.size > maxCacheEntries || cacheBytes > maxCacheBytes) {
      const oldestKey = cache.keys().next().value;
      const oldest = cache.get(oldestKey);
      if (oldest?.result) cacheBytes -= oldest.result.body.length;
      cache.delete(oldestKey);
    }
  }

  function deleteCachedResult(key) {
    const previous = cache.get(key);
    if (previous?.result) cacheBytes -= previous.result.body.length;
    cache.delete(key);
  }

  return async function fetchServiceIcon(service) {
    const normalizedUrl = parseHttpUrl(service?.url).toString();
    const key = `${String(service?.id || '')}\n${normalizedUrl}`;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) {
      cache.delete(key);
      cache.set(key, cached);
      if (cached.result) return cached.result;
      throw new ServiceIconNotFoundError();
    }
    if (cached) deleteCachedResult(key);
    if (inflight.has(key)) return inflight.get(key);

    const pending = resolver(normalizedUrl, { allowInsecureTls, timeoutMs })
      .then((result) => {
        cacheResult(key, { result, expiresAt: now() + positiveTtlMs });
        return result;
      })
      .catch(() => {
        cacheResult(key, { expiresAt: now() + negativeTtlMs });
        throw new ServiceIconNotFoundError();
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
    return pending;
  };
}
