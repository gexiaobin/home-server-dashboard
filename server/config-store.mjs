import { promises as fs } from 'node:fs';
import path from 'node:path';

export const DEFAULT_CONFIG = Object.freeze({
  settings: Object.freeze({
    title: 'Home Server',
    location: 'Home network',
    refreshInterval: 5000,
  }),
  services: Object.freeze([]),
  topology: Object.freeze({
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
      if (service.description !== undefined && typeof service.description !== 'string') {
        throw new ConfigValidationError(`services[${index}].description must be a string`);
      }
      if (service.category !== undefined && typeof service.category !== 'string') {
        throw new ConfigValidationError(`services[${index}].category must be a string`);
      }
      if (service.icon !== undefined && typeof service.icon !== 'string') {
        throw new ConfigValidationError(`services[${index}].icon must be a string`);
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
      if (node.type !== undefined && !['internet', 'router', 'nas', 'server', 'vm', 'container', 'client'].includes(node.type)) {
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

function mergeWithDefaults(defaults, config) {
  return {
    ...clone(defaults),
    ...clone(config),
    settings: {
      ...(defaults.settings ?? {}),
      ...(config.settings ?? {}),
    },
    services: clone(config.services ?? defaults.services ?? []).map((service) => ({
      description: '',
      category: '其他',
      icon: 'default',
      favorite: false,
      check: { type: 'none' },
      ...service,
    })),
    topology: {
      ...(defaults.topology ?? {}),
      ...(config.topology ?? {}),
      nodes: clone(config.topology?.nodes ?? defaults.topology?.nodes ?? []).map((node) => ({
        type: 'server',
        x: 50,
        y: 50,
        ...node,
      })),
      links: clone(config.topology?.links ?? defaults.topology?.links ?? []),
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
      return mergeWithDefaults(defaults, parsed);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return mergeWithDefaults(defaults, {});
      }
      throw error;
    }
  }

  async put(config) {
    validateConfig(config);
    const defaults = await this.getDefaults();
    const normalized = mergeWithDefaults(defaults, config);

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
