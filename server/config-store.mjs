import { promises as fs } from 'node:fs';
import path from 'node:path';

import { Pool } from 'pg';

export const DEFAULT_CONFIG = Object.freeze({
  settings: Object.freeze({
    title: 'Home Server',
    location: 'Home network',
    hostDisplayName: '',
    refreshInterval: 5000,
  }),
  services: Object.freeze([]),
  topology: Object.freeze({
    source: 'manual',
    refreshInterval: 15_000,
    hosts: Object.freeze([]),
    nodes: Object.freeze([]),
    links: Object.freeze([]),
  }),
});

export class ConfigValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigValidationError';
    this.statusCode = 400;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigValidationError(`${field} must be a non-empty string`);
  }
}

function requireHttpUrl(value, field) {
  requireString(value, field);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigValidationError(`${field} must be a valid URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ConfigValidationError(`${field} must use http or https`);
  }
}

export function validateConfig(config) {
  if (!isObject(config)) {
    throw new ConfigValidationError('Config must be a JSON object');
  }

  if (config.settings !== undefined) {
    if (!isObject(config.settings)) {
      throw new ConfigValidationError('settings must be an object');
    }
    if (config.settings.title !== undefined) {
      requireString(config.settings.title, 'settings.title');
    }
    if (config.settings.location !== undefined && typeof config.settings.location !== 'string') {
      throw new ConfigValidationError('settings.location must be a string');
    }
    if (config.settings.hostDisplayName !== undefined) {
      if (typeof config.settings.hostDisplayName !== 'string') {
        throw new ConfigValidationError('settings.hostDisplayName must be a string');
      }
      if (config.settings.hostDisplayName.trim().length > 100) {
        throw new ConfigValidationError('settings.hostDisplayName must be at most 100 characters');
      }
    }
    if (config.settings.refreshInterval !== undefined) {
      const interval = config.settings.refreshInterval;
      if (!Number.isInteger(interval) || interval < 1000 || interval > 3_600_000) {
        throw new ConfigValidationError('settings.refreshInterval must be an integer between 1000 and 3600000');
      }
    }
  }

  if (config.services !== undefined) {
    if (!Array.isArray(config.services)) {
      throw new ConfigValidationError('services must be an array');
    }
    const ids = new Set();
    for (const [index, service] of config.services.entries()) {
      if (!isObject(service)) {
        throw new ConfigValidationError(`services[${index}] must be an object`);
      }
      requireString(service.id, `services[${index}].id`);
      if (ids.has(service.id)) {
        throw new ConfigValidationError(`Duplicate service id: ${service.id}`);
      }
      ids.add(service.id);

      requireString(service.name, `services[${index}].name`);
      requireHttpUrl(service.url, `services[${index}].url`);
      if (service.externalUrl !== undefined) {
        if (typeof service.externalUrl !== 'string') {
          throw new ConfigValidationError(`services[${index}].externalUrl must be a string`);
        }
        if (service.externalUrl.trim() !== '') {
          requireHttpUrl(service.externalUrl, `services[${index}].externalUrl`);
        }
      }
      if (service.scope !== undefined && !['internal', 'external'].includes(service.scope)) {
        throw new ConfigValidationError(`services[${index}].scope must be internal or external`);
      }
      if (service.runtime !== undefined && !['infrastructure', 'vm', 'docker'].includes(service.runtime)) {
        throw new ConfigValidationError(`services[${index}].runtime must be infrastructure, vm, or docker`);
      }
      if (service.description !== undefined && typeof service.description !== 'string') {
        throw new ConfigValidationError(`services[${index}].description must be a string`);
      }
      if (service.category !== undefined && typeof service.category !== 'string') {
        throw new ConfigValidationError(`services[${index}].category must be a string`);
      }
      if (service.icon !== undefined && typeof service.icon !== 'string') {
        throw new ConfigValidationError(`services[${index}].icon must be a string`);
      }
      if (service.iconUrl !== undefined) {
        if (typeof service.iconUrl !== 'string') {
          throw new ConfigValidationError(`services[${index}].iconUrl must be a string`);
        }
        if (service.iconUrl.trim() !== '') {
          requireHttpUrl(service.iconUrl, `services[${index}].iconUrl`);
        }
      }
      if (service.iconAllowInsecureTls !== undefined && typeof service.iconAllowInsecureTls !== 'boolean') {
        throw new ConfigValidationError(`services[${index}].iconAllowInsecureTls must be a boolean`);
      }
      if (service.favorite !== undefined && typeof service.favorite !== 'boolean') {
        throw new ConfigValidationError(`services[${index}].favorite must be a boolean`);
      }
      if (service.check !== undefined) {
        if (!isObject(service.check) || !['http', 'tcp', 'none'].includes(service.check.type)) {
          throw new ConfigValidationError(`services[${index}].check.type must be http, tcp, or none`);
        }
        if (service.check.type === 'http' && service.check.url !== undefined) {
          requireHttpUrl(service.check.url, `services[${index}].check.url`);
        }
        if (service.check.type === 'tcp') {
          requireString(service.check.host, `services[${index}].check.host`);
          if (!Number.isInteger(service.check.port) || service.check.port < 1 || service.check.port > 65535) {
            throw new ConfigValidationError(`services[${index}].check.port must be between 1 and 65535`);
          }
        }
      }
    }
  }

  if (config.topology !== undefined) {
    if (!isObject(config.topology)) {
      throw new ConfigValidationError('topology must be an object');
    }
    if (config.topology.nodes !== undefined && !Array.isArray(config.topology.nodes)) {
      throw new ConfigValidationError('topology.nodes must be an array');
    }
    if (config.topology.links !== undefined && !Array.isArray(config.topology.links)) {
      throw new ConfigValidationError('topology.links must be an array');
    }
    if (config.topology.source !== undefined && !['manual', 'ikuai'].includes(config.topology.source)) {
      throw new ConfigValidationError('topology.source must be manual or ikuai');
    }
    if (config.topology.refreshInterval !== undefined) {
      const interval = config.topology.refreshInterval;
      if (!Number.isInteger(interval) || interval < 5_000 || interval > 300_000) {
        throw new ConfigValidationError('topology.refreshInterval must be an integer between 5000 and 300000');
      }
    }
    for (const field of ['vmHostServiceId', 'dockerHostServiceId']) {
      if (config.topology[field] !== undefined && typeof config.topology[field] !== 'string') {
        throw new ConfigValidationError(`topology.${field} must be a string`);
      }
    }
    if (config.topology.hosts !== undefined) {
      if (!Array.isArray(config.topology.hosts)) {
        throw new ConfigValidationError('topology.hosts must be an array');
      }
      for (const [index, host] of config.topology.hosts.entries()) {
        if (!isObject(host)) {
          throw new ConfigValidationError(`topology.hosts[${index}] must be an object`);
        }
        requireString(host.serviceId, `topology.hosts[${index}].serviceId`);
        if (host.nodeType !== undefined && !['server', 'nas'].includes(host.nodeType)) {
          throw new ConfigValidationError(`topology.hosts[${index}].nodeType must be server or nas`);
        }
        if (host.serviceIds !== undefined) {
          if (!Array.isArray(host.serviceIds)) {
            throw new ConfigValidationError(`topology.hosts[${index}].serviceIds must be an array`);
          }
          for (const [serviceIndex, serviceId] of host.serviceIds.entries()) {
            requireString(serviceId, `topology.hosts[${index}].serviceIds[${serviceIndex}]`);
          }
        }
      }
    }
    const nodeIds = new Set();
    for (const [index, node] of (config.topology.nodes ?? []).entries()) {
      if (!isObject(node)) {
        throw new ConfigValidationError(`topology.nodes[${index}] must be an object`);
      }
      requireString(node.id, `topology.nodes[${index}].id`);
      requireString(node.label, `topology.nodes[${index}].label`);
      if (nodeIds.has(node.id)) {
        throw new ConfigValidationError(`Duplicate topology node id: ${node.id}`);
      }
      nodeIds.add(node.id);
      if (node.type !== undefined && ![
        'internet',
        'router',
        'nas',
        'server',
        'vm',
        'container',
        'client',
        'switch',
        'ap',
        'camera',
        'printer',
      ].includes(node.type)) {
        throw new ConfigValidationError(`topology.nodes[${index}].type is not supported`);
      }
      for (const coordinate of ['x', 'y']) {
        if (node[coordinate] !== undefined && (!Number.isFinite(node[coordinate]) || node[coordinate] < 0 || node[coordinate] > 100)) {
          throw new ConfigValidationError(`topology.nodes[${index}].${coordinate} must be between 0 and 100`);
        }
      }
    }
    for (const [index, link] of (config.topology.links ?? []).entries()) {
      if (!isObject(link)) {
        throw new ConfigValidationError(`topology.links[${index}] must be an object`);
      }
      requireString(link.source, `topology.links[${index}].source`);
      requireString(link.target, `topology.links[${index}].target`);
      if (!nodeIds.has(link.source) || !nodeIds.has(link.target)) {
        throw new ConfigValidationError(`topology.links[${index}] references an unknown node`);
      }
    }
  }

  return config;
}

export function normalizeConfig(defaults, config) {
  const hostDisplayName = config.settings?.hostDisplayName
    ?? defaults.settings?.hostDisplayName
    ?? '';
  const topologyDefaults = defaults.topology ?? DEFAULT_CONFIG.topology;
  const topologyConfig = config.topology ?? {};
  const services = clone(config.services ?? defaults.services ?? []).map((service) => {
    const normalized = {
      description: '',
      scope: 'internal',
      runtime: 'infrastructure',
      category: '其他',
      icon: 'default',
      iconUrl: '',
      iconAllowInsecureTls: false,
      favorite: false,
      check: { type: 'none' },
      ...service,
      externalUrl: service.externalUrl?.trim() || '',
      iconUrl: service.iconUrl?.trim() || '',
    };
    if (normalized.scope === 'external') {
      normalized.externalUrl = '';
      normalized.check = { type: 'none' };
    }
    return normalized;
  });
  const hostServiceIds = new Set(services
    .filter((service) => (
      service.scope === 'internal' && ['infrastructure', 'vm'].includes(service.runtime)
    ))
    .map((service) => service.id));
  const workloadServices = services.filter((service) => (
    service.scope === 'internal' && ['vm', 'docker'].includes(service.runtime)
  ));
  const workloadServiceIds = new Set(workloadServices.map((service) => service.id));
  const legacyHosts = (source) => {
    const vmHostServiceId = typeof source.vmHostServiceId === 'string'
      ? source.vmHostServiceId.trim()
      : '';
    const dockerHostServiceId = typeof source.dockerHostServiceId === 'string'
      ? source.dockerHostServiceId.trim()
      : '';
    return [
      ...(vmHostServiceId ? [{
        serviceId: vmHostServiceId,
        nodeType: 'server',
        serviceIds: workloadServices.filter((service) => service.runtime === 'vm').map((service) => service.id),
      }] : []),
      ...(dockerHostServiceId && dockerHostServiceId !== vmHostServiceId ? [{
        serviceId: dockerHostServiceId,
        nodeType: 'nas',
        serviceIds: workloadServices.filter((service) => service.runtime === 'docker').map((service) => service.id),
      }] : []),
    ];
  };
  const hasLegacyHostFields = topologyConfig.vmHostServiceId !== undefined
    || topologyConfig.dockerHostServiceId !== undefined;
  const requestedHosts = Array.isArray(topologyConfig.hosts)
    ? topologyConfig.hosts
    : hasLegacyHostFields
      ? legacyHosts(topologyConfig)
      : Array.isArray(topologyDefaults.hosts)
        ? topologyDefaults.hosts
        : legacyHosts(topologyDefaults);
  const claimedHostServiceIds = new Set();
  const claimedWorkloadServiceIds = new Set();
  const childServiceIdsByHost = new Map();
  const createsCycle = (hostServiceId, childServiceId) => {
    const pending = [childServiceId];
    const visited = new Set();
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === hostServiceId) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      pending.push(...(childServiceIdsByHost.get(current) ?? []));
    }
    return false;
  };
  const hosts = clone(requestedHosts).flatMap((host) => {
    const serviceId = typeof host?.serviceId === 'string' ? host.serviceId.trim() : '';
    if (!hostServiceIds.has(serviceId) || claimedHostServiceIds.has(serviceId)) return [];
    claimedHostServiceIds.add(serviceId);
    const serviceIds = (Array.isArray(host.serviceIds) ? host.serviceIds : [])
      .map((id) => typeof id === 'string' ? id.trim() : '')
      .filter((id) => {
        if (
          id === serviceId
          || !workloadServiceIds.has(id)
          || claimedWorkloadServiceIds.has(id)
          || createsCycle(serviceId, id)
        ) return false;
        claimedWorkloadServiceIds.add(id);
        return true;
      });
    childServiceIdsByHost.set(serviceId, serviceIds);
    return [{
      serviceId,
      nodeType: ['server', 'nas'].includes(host.nodeType) ? host.nodeType : 'server',
      serviceIds,
    }];
  });
  return {
    ...clone(defaults),
    ...clone(config),
    settings: {
      ...(defaults.settings ?? {}),
      ...(config.settings ?? {}),
      hostDisplayName: hostDisplayName.trim(),
    },
    services,
    topology: {
      source: topologyConfig.source ?? topologyDefaults.source ?? 'manual',
      refreshInterval: topologyConfig.refreshInterval
        ?? topologyDefaults.refreshInterval
        ?? 15_000,
      hosts,
      nodes: clone(topologyConfig.nodes ?? topologyDefaults.nodes ?? []).map((node) => ({
        type: 'server',
        x: 50,
        y: 50,
        ...node,
      })),
      links: clone(topologyConfig.links ?? topologyDefaults.links ?? []),
    },
  };
}

export class ConfigStore {
  constructor({
    dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data'),
    fileName = 'config.json',
    defaults = DEFAULT_CONFIG,
    defaultsFile = path.resolve(process.cwd(), 'config/default.json'),
    fsImpl = fs,
  } = {}) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, fileName);
    this.defaults = defaults;
    this.defaultsFile = defaultsFile;
    this.fs = fsImpl;
    this.backend = 'file';
    this.writeQueue = Promise.resolve();
    this.loadedDefaults = null;
  }

  async getDefaults() {
    if (!this.loadedDefaults) {
      this.loadedDefaults = (async () => {
        try {
          const raw = await this.fs.readFile(this.defaultsFile, 'utf8');
          const parsed = JSON.parse(raw);
          validateConfig(parsed);
          return parsed;
        } catch (error) {
          if (error.code !== 'ENOENT') {
            throw new Error(`Unable to read default config: ${error.message}`);
          }
          return this.defaults;
        }
      })();
    }
    return clone(await this.loadedDefaults);
  }

  async get() {
    const defaults = await this.getDefaults();
    try {
      const raw = await this.fs.readFile(this.filePath, 'utf8');
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        throw new Error(`Stored config is not valid JSON: ${error.message}`);
      }
      validateConfig(parsed);
      return normalizeConfig(defaults, parsed);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return normalizeConfig(defaults, {});
      }
      throw error;
    }
  }

  async put(config) {
    validateConfig(config);
    const defaults = await this.getDefaults();
    const normalized = normalizeConfig(defaults, config);

    const write = async () => {
      await this.fs.mkdir(this.dataDir, { recursive: true });
      const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      try {
        await this.fs.writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, {
          encoding: 'utf8',
          mode: 0o600,
        });
        await this.fs.rename(temporaryPath, this.filePath);
      } catch (error) {
        await this.fs.unlink(temporaryPath).catch(() => {});
        throw error;
      }
      return clone(normalized);
    };

    const result = this.writeQueue.then(write, write);
    this.writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

const CONFIG_TABLE = 'home_server_dashboard_config';

export class PostgresConfigStore extends ConfigStore {
  constructor({
    connectionString,
    connectionStringFile,
    pool,
    maxConnections = 5,
    connectionTimeoutMs = 5000,
    queryTimeoutMs = 5000,
    poolErrorHandler = () => {},
    ...configStoreOptions
  } = {}) {
    super(configStoreOptions);
    if (!pool && !connectionString && !connectionStringFile) {
      throw new Error('PostgreSQL storage requires DATABASE_URL or DATABASE_URL_FILE');
    }
    if (connectionString && connectionStringFile) {
      throw new Error('Set only one of DATABASE_URL or DATABASE_URL_FILE');
    }

    this.backend = 'postgresql';
    this.connectionString = connectionString;
    this.connectionStringFile = connectionStringFile;
    this.pool = pool || null;
    this.ownsPool = !pool;
    this.maxConnections = maxConnections;
    this.connectionTimeoutMs = connectionTimeoutMs;
    this.queryTimeoutMs = queryTimeoutMs;
    this.poolErrorHandler = poolErrorHandler;
    this.poolPromise = null;
    this.schemaPromise = null;
  }

  async getPool() {
    if (this.pool) {
      return this.pool;
    }
    if (!this.poolPromise) {
      this.poolPromise = (async () => {
        const connectionString = this.connectionStringFile
          ? (await this.fs.readFile(this.connectionStringFile, 'utf8')).trim()
          : this.connectionString;
        if (!connectionString) {
          throw new Error('PostgreSQL connection string is empty');
        }
        this.pool = new Pool({
          connectionString,
          max: this.maxConnections,
          connectionTimeoutMillis: this.connectionTimeoutMs,
          query_timeout: this.queryTimeoutMs,
          statement_timeout: this.queryTimeoutMs,
          application_name: 'home-server-dashboard',
        });
        this.pool.on('error', this.poolErrorHandler);
        return this.pool;
      })().catch((error) => {
        this.poolPromise = null;
        throw error;
      });
    }
    return this.poolPromise;
  }

  async initialize() {
    if (!this.schemaPromise) {
      this.schemaPromise = (async () => {
        const pool = await this.getPool();
        await pool.query(`
          CREATE TABLE IF NOT EXISTS ${CONFIG_TABLE} (
            id smallint PRIMARY KEY CHECK (id = 1),
            document jsonb NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT NOW()
          )
        `);
        await this.migrateLegacyFile(pool);
        return pool;
      })().catch((error) => {
        this.schemaPromise = null;
        throw error;
      });
    }
    return this.schemaPromise;
  }

  async migrateLegacyFile(pool) {
    const existing = await pool.query(`SELECT id FROM ${CONFIG_TABLE} WHERE id = 1`);
    if (existing.rows.length > 0) {
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(await this.fs.readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') {
        return;
      }
      if (error instanceof SyntaxError) {
        throw new Error(`Legacy config is not valid JSON: ${error.message}`);
      }
      throw error;
    }

    validateConfig(parsed);
    const normalized = normalizeConfig(await this.getDefaults(), parsed);
    await pool.query(
      `INSERT INTO ${CONFIG_TABLE} (id, document) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(normalized)],
    );
  }

  async get() {
    const pool = await this.initialize();
    const result = await pool.query(`SELECT document FROM ${CONFIG_TABLE} WHERE id = 1`);
    const defaults = await this.getDefaults();
    if (result.rows.length === 0) {
      return normalizeConfig(defaults, {});
    }

    const document = result.rows[0].document;
    try {
      validateConfig(document);
    } catch (error) {
      throw new Error(`Stored PostgreSQL config is invalid: ${error.message}`);
    }
    return normalizeConfig(defaults, document);
  }

  async put(config) {
    validateConfig(config);
    const normalized = normalizeConfig(await this.getDefaults(), config);
    const pool = await this.initialize();
    const result = await pool.query(`
      INSERT INTO ${CONFIG_TABLE} (id, document, updated_at)
      VALUES (1, $1::jsonb, NOW())
      ON CONFLICT (id) DO UPDATE
      SET document = EXCLUDED.document, updated_at = NOW()
      RETURNING document
    `, [JSON.stringify(normalized)]);
    return clone(result.rows[0].document);
  }

  async healthCheck() {
    const pool = await this.initialize();
    await pool.query('SELECT 1');
  }

  async close() {
    if (!this.ownsPool) {
      return;
    }
    const pool = this.pool || (this.poolPromise ? await this.poolPromise.catch(() => null) : null);
    await pool?.end();
  }
}
