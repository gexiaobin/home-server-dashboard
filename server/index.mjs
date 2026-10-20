import { createHash, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { request as httpRequest } from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

import express from 'express';

import {
  ConfigStore,
  ConfigValidationError,
  PostgresConfigStore,
} from './config-store.mjs';
import { MetricsCollector } from './metrics.mjs';
import { createServiceIconFetcher } from './service-icon.mjs';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(SERVER_DIR, '..');

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function secureEqual(left, right) {
  const leftDigest = createHash('sha256').update(String(left)).digest();
  const rightDigest = createHash('sha256').update(String(right)).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function authFromEnvironment(env) {
  const username = env.BASIC_AUTH_USERNAME || env.BASIC_AUTH_USER || env.AUTH_USERNAME;
  const password = env.BASIC_AUTH_PASSWORD || env.AUTH_PASSWORD;
  if (!username && !password) {
    return null;
  }
  if (!username || !password) {
    throw new Error('Basic Auth requires both BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD');
  }
  return { username, password };
}

export function createBasicAuthMiddleware(credentials) {
  if (!credentials) {
    return (_request, _response, next) => next();
  }
  const { username, password } = credentials;
  if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) {
    throw new Error('Basic Auth username and password must be non-empty strings');
  }

  return (request, response, next) => {
    const authorization = request.get('authorization') || '';
    const match = authorization.match(/^Basic\s+(.+)$/i);
    let suppliedUsername = '';
    let suppliedPassword = '';
    if (match) {
      try {
        const decoded = Buffer.from(match[1], 'base64').toString('utf8');
        const separator = decoded.indexOf(':');
        if (separator !== -1) {
          suppliedUsername = decoded.slice(0, separator);
          suppliedPassword = decoded.slice(separator + 1);
        }
      } catch {
        // Invalid credentials are handled by the common response below.
      }
    }

    if (secureEqual(suppliedUsername, username) && secureEqual(suppliedPassword, password)) {
      next();
      return;
    }

    response.set('WWW-Authenticate', 'Basic realm="Home Server", charset="UTF-8"');
    response.status(401).json({ error: 'Authentication required' });
  };
}

function tcpProbe(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    socket.setTimeout(timeoutMs, () => finish(new Error(`Timed out after ${timeoutMs} ms`)));
    socket.once('connect', () => finish());
    socket.once('error', finish);
  });
}

function serviceErrorMessage(error, timeoutMs) {
  if (error?.name === 'AbortError') {
    return `Timed out after ${timeoutMs} ms`;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function checkService(service, {
  fetchImpl = globalThis.fetch,
  tcpProbeImpl = tcpProbe,
  timeoutMs = 5000,
  monotonicNow = () => performance.now(),
  wallClock = () => new Date(),
} = {}) {
  const id = String(service?.id ?? '');
  const check = service?.check ?? { type: 'none' };
  if (check.type === 'none' || !check.type) {
    return {
      id,
      status: 'unknown',
      latency: null,
      checkedAt: null,
      message: 'Health check is not configured',
    };
  }

  const checkedAt = wallClock().toISOString();
  const startedAt = monotonicNow();
  try {
    let message;
    if (check.type === 'http') {
      const target = check.url || service.url;
      const parsed = new URL(target);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Only HTTP and HTTPS health checks are supported');
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(parsed, {
          method: check.method || 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: { 'user-agent': 'home-server-dashboard/1.0' },
        });
      } finally {
        clearTimeout(timeout);
      }
      response.body?.cancel().catch(() => {});
      const expected = Array.isArray(check.expectedStatuses) ? check.expectedStatuses : null;
      const healthy = expected ? expected.includes(response.status) : response.status >= 200 && response.status < 500;
      if (!healthy) {
        throw new Error(`HTTP ${response.status}`);
      }
      message = `HTTP ${response.status}`;
    } else if (check.type === 'tcp') {
      await tcpProbeImpl(check.host, check.port, timeoutMs);
      message = `Connected to ${check.host}:${check.port}`;
    } else {
      throw new Error(`Unsupported health check type: ${check.type}`);
    }

    return {
      id,
      status: 'up',
      latency: Math.max(0, Math.round(monotonicNow() - startedAt)),
      checkedAt,
      message,
    };
  } catch (error) {
    return {
      id,
      status: 'down',
      latency: Math.max(0, Math.round(monotonicNow() - startedAt)),
      checkedAt,
      message: serviceErrorMessage(error, timeoutMs),
    };
  }
}

function dockerRequest(socketPath, requestPath, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ socketPath, path: requestPath, method: 'GET' }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 10 * 1024 * 1024) {
          request.destroy(new Error('Docker response exceeded 10 MB'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if ((response.statusCode || 500) >= 400) {
          reject(new Error(`Docker API returned HTTP ${response.statusCode}`));
          return;
        }
        resolve(body);
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`Docker API timed out after ${timeoutMs} ms`)));
    request.once('error', reject);
    request.end();
  });
}

export async function listDockerContainers(socketPath, { timeoutMs = 3000 } = {}) {
  if (!socketPath) {
    return [];
  }
  const raw = await dockerRequest(socketPath, '/containers/json?all=1', timeoutMs);
  const containers = JSON.parse(raw);
  if (!Array.isArray(containers)) {
    throw new Error('Docker API returned an invalid container list');
  }
  return containers.map((container) => ({
    id: String(container.Id || ''),
    name: String(container.Names?.[0] || '').replace(/^\//, '') || String(container.Id || '').slice(0, 12),
    image: String(container.Image || ''),
    state: String(container.State || 'unknown'),
    status: String(container.Status || ''),
  }));
}

function parsePositiveInteger(value, fallback, name) {
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseBoolean(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const normalized = String(value).toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

export function createConfigStore(env = process.env, { poolErrorHandler } = {}) {
  const backend = String(env.STORAGE_BACKEND || 'auto').toLowerCase();
  if (!['auto', 'file', 'postgresql'].includes(backend)) {
    throw new Error('STORAGE_BACKEND must be auto, file, or postgresql');
  }

  const connectionString = env.DATABASE_URL || null;
  const connectionStringFile = env.DATABASE_URL_FILE || null;
  if (connectionString && connectionStringFile) {
    throw new Error('Set only one of DATABASE_URL or DATABASE_URL_FILE');
  }
  if (backend === 'file' && (connectionString || connectionStringFile)) {
    throw new Error('Database connection settings cannot be used with STORAGE_BACKEND=file');
  }

  const commonOptions = {
    dataDir: env.DATA_DIR || path.join(PROJECT_DIR, 'data'),
  };
  if (connectionString || connectionStringFile || backend === 'postgresql') {
    return new PostgresConfigStore({
      ...commonOptions,
      connectionString,
      connectionStringFile,
      maxConnections: parsePositiveInteger(env.DATABASE_POOL_MAX, 5, 'DATABASE_POOL_MAX'),
      connectionTimeoutMs: parsePositiveInteger(
        env.DATABASE_CONNECT_TIMEOUT_MS,
        5000,
        'DATABASE_CONNECT_TIMEOUT_MS',
      ),
      queryTimeoutMs: parsePositiveInteger(env.DATABASE_QUERY_TIMEOUT_MS, 5000, 'DATABASE_QUERY_TIMEOUT_MS'),
      poolErrorHandler,
    });
  }
  return new ConfigStore(commonOptions);
}

export function createApp({
  env = process.env,
  configStore = createConfigStore(env),
  metricsCollector = new MetricsCollector({
    procRoot: env.HOST_PROC,
    sysRoot: env.HOST_SYS,
    diskPaths: env.HOST_STORAGE ? [env.HOST_STORAGE] : undefined,
  }),
  serviceChecker = checkService,
  dockerClient = listDockerContainers,
  dockerSocket = env.DOCKER_SOCKET || null,
  basicAuth,
  logger = console,
  serviceTimeoutMs = parsePositiveInteger(env.SERVICE_CHECK_TIMEOUT_MS, 5000, 'SERVICE_CHECK_TIMEOUT_MS'),
  serviceIconFetcher = createServiceIconFetcher({
    allowInsecureTls: parseBoolean(
      env.SERVICE_ICON_ALLOW_INSECURE_TLS,
      false,
      'SERVICE_ICON_ALLOW_INSECURE_TLS',
    ),
    timeoutMs: parsePositiveInteger(env.SERVICE_ICON_TIMEOUT_MS, 5000, 'SERVICE_ICON_TIMEOUT_MS'),
  }),
  distDir = path.join(PROJECT_DIR, 'dist'),
  serveStatic = true,
} = {}) {
  const app = express();
  const credentials = basicAuth === undefined ? authFromEnvironment(env) : basicAuth;

  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', asyncRoute(async (_request, response) => {
    try {
      await configStore.healthCheck?.();
      response.json({
        status: 'ok',
        storage: configStore.backend || 'injected',
        version: env.npm_package_version || '1.0.0',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
    } catch {
      logger.warn?.('Storage readiness check failed');
      response.status(503).json({
        status: 'error',
        storage: configStore.backend || 'injected',
        timestamp: new Date().toISOString(),
      });
    }
  }));

  app.use(createBasicAuthMiddleware(credentials));

  app.get('/api/config', asyncRoute(async (_request, response) => {
    response.json(await configStore.get());
  }));

  app.put('/api/config', asyncRoute(async (request, response) => {
    response.json(await configStore.put(request.body));
  }));

  const handleServiceCheck = asyncRoute(async (request, response) => {
    const config = await configStore.get();
    const service = config.services.find((item) => item.id === request.params.id);
    if (!service) {
      response.status(404).json({ error: 'Service not found' });
      return;
    }
    response.json(await serviceChecker(service, { timeoutMs: serviceTimeoutMs }));
  });
  app.post('/api/services/:id/check', handleServiceCheck);
  app.get('/api/services/:id/check', handleServiceCheck);

  app.get('/api/services/:id/icon', asyncRoute(async (request, response) => {
    const config = await configStore.get();
    const service = config.services.find((item) => item.id === request.params.id);
    if (!service) {
      response.status(404).end();
      return;
    }

    let icon;
    try {
      icon = await serviceIconFetcher(service);
    } catch {
      logger.warn?.(`Unable to resolve icon for service ${service.id}`);
      response.status(404).end();
      return;
    }

    response.set({
      'Cache-Control': 'private, no-cache',
      'Content-Security-Policy': "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
      'Content-Type': icon.contentType,
      'Cross-Origin-Resource-Policy': 'same-origin',
      ETag: icon.etag,
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.get('if-none-match') === icon.etag) {
      response.status(304).end();
      return;
    }
    response.send(icon.body);
  }));

  app.get('/api/overview', asyncRoute(async (_request, response) => {
    const [config, metrics] = await Promise.all([
      configStore.get(),
      metricsCollector.collect(),
    ]);
    const services = await Promise.all(config.services.map((service) => serviceChecker(service, {
      timeoutMs: serviceTimeoutMs,
    })));

    let containers = [];
    if (dockerSocket) {
      try {
        containers = await dockerClient(dockerSocket);
      } catch (error) {
        logger.warn?.(`Unable to read Docker containers: ${error.message}`);
      }
    }

    response.json({
      timestamp: new Date().toISOString(),
      ...metrics,
      services,
      containers,
    });
  }));

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'API endpoint not found' });
  });

  if (serveStatic) {
    app.use(express.static(distDir, { index: false, maxAge: '1h' }));
    app.get('*', asyncRoute(async (request, response, next) => {
      if (!request.accepts('html')) {
        next();
        return;
      }
      try {
        await fs.access(path.join(distDir, 'index.html'));
        response.set('Cache-Control', 'no-cache');
        response.sendFile(path.join(distDir, 'index.html'));
      } catch {
        next();
      }
    }));
  }

  app.use((request, response) => {
    response.status(404).json({ error: 'Not found', path: request.path });
  });

  app.use((error, _request, response, _next) => {
    void _next;
    const isJsonSyntaxError = error instanceof SyntaxError && error.status === 400 && 'body' in error;
    const status = error instanceof ConfigValidationError
      ? 400
      : (isJsonSyntaxError ? 400 : (error.statusCode || error.status || 500));
    if (status >= 500) {
      const suffix = error?.code ? ` (${error.code})` : '';
      logger.error?.(`Request failed${suffix}`);
    }
    response.status(status).json({
      error: isJsonSyntaxError ? 'Invalid JSON body' : (status >= 500 ? 'Internal server error' : error.message),
    });
  });

  return app;
}

export async function startServer({ env = process.env, logger = console } = {}) {
  const port = parsePositiveInteger(env.PORT, 3000, 'PORT');
  const host = env.HOST || '0.0.0.0';
  const configStore = createConfigStore(env, {
    poolErrorHandler: (error) => {
      const suffix = error?.code ? ` (${error.code})` : '';
      logger.error?.(`PostgreSQL pool error${suffix}`);
    },
  });
  try {
    await configStore.healthCheck?.();
  } catch (error) {
    await configStore.close?.().catch(() => {});
    throw error;
  }
  const app = createApp({ env, logger, configStore });
  const server = app.listen(port, host, () => {
    logger.log?.(`Home Server Dashboard listening on http://${host}:${port}`);
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.log?.(`Received ${signal}; shutting down`);
    server.close(async (serverError) => {
      let closeError = null;
      try {
        await configStore.close?.();
      } catch {
        closeError = new Error('Unable to close storage cleanly');
        logger.error?.(closeError.message);
      }
      process.exitCode = serverError || closeError ? 1 : 0;
    });
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  return server;
}

const entryPoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryPoint === import.meta.url) {
  startServer().catch((error) => {
    const suffix = error?.code ? ` (${error.code})` : '';
    console.error(`Unable to start Home Server Dashboard${suffix}`);
    process.exitCode = 1;
  });
}
