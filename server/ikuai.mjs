import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_SECRET_BYTES = 16 * 1024;
const CLIENT_PAGE_SIZE = 500;
const MAX_CLIENTS = 2_000;

const API_PATHS = Object.freeze({
  system: '/api/v4.0/monitoring/system',
  clients: '/api/v4.0/monitoring/clients-online',
  downstream: `/api/v4.0/monitoring/downstream?TYPE=data&LIMIT=0%2C${CLIENT_PAGE_SIZE}&OFFSET=0`,
  interfaces: '/api/v4.0/monitoring/interfaces-physical',
});

export class IkuaiProviderError extends Error {
  constructor(message, code = 'IKUAI_UNAVAILABLE') {
    super(message);
    this.name = 'IkuaiProviderError';
    this.code = code;
  }
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new IkuaiProviderError('IKUAI_ALLOW_INSECURE_TLS must be true or false', 'IKUAI_MISCONFIGURED');
}

function parsePositiveInteger(value, fallback, field, minimum = 100, maximum = 60_000) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new IkuaiProviderError(`${field} must be an integer between ${minimum} and ${maximum}`, 'IKUAI_MISCONFIGURED');
  }
  return parsed;
}

function parseBaseUrl(value) {
  if (!value) {
    throw new IkuaiProviderError('iKuai API is not configured', 'IKUAI_NOT_CONFIGURED');
  }
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    throw new IkuaiProviderError('IKUAI_BASE_URL is invalid', 'IKUAI_MISCONFIGURED');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || !['', '/'].includes(parsed.pathname)) {
    throw new IkuaiProviderError('IKUAI_BASE_URL must be an HTTP(S) origin without credentials or a path', 'IKUAI_MISCONFIGURED');
  }
  parsed.pathname = '/';
  return parsed;
}

function validateToken(value) {
  if (value.length < 1
    || value.length > 4_096
    || !/^[A-Za-z0-9._~+\/-]+=*$/.test(value)) {
    throw new IkuaiProviderError(
      'iKuai API token contains unsupported characters or has an invalid length',
      'IKUAI_MISCONFIGURED',
    );
  }
  return value;
}

async function readToken(env, fsImpl) {
  const directToken = String(env.IKUAI_TOKEN || '');
  const tokenFile = String(env.IKUAI_TOKEN_FILE || '').trim();
  if (directToken && tokenFile) {
    throw new IkuaiProviderError('Set only one of IKUAI_TOKEN or IKUAI_TOKEN_FILE', 'IKUAI_MISCONFIGURED');
  }
  if (!directToken && !tokenFile) {
    throw new IkuaiProviderError('iKuai API token is not configured', 'IKUAI_NOT_CONFIGURED');
  }
  if (directToken) {
    return validateToken(directToken);
  }

  try {
    const metadata = await fsImpl.stat(tokenFile);
    if (!metadata.isFile() || metadata.size > MAX_SECRET_BYTES) {
      throw new Error('invalid token file');
    }
    const token = (await fsImpl.readFile(tokenFile, 'utf8')).trim();
    return validateToken(token);
  } catch {
    throw new IkuaiProviderError('Unable to read the iKuai API token file', 'IKUAI_MISCONFIGURED');
  }
}

function normalizeBareNil(value) {
  let result = '';
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      result += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      result += character;
      continue;
    }
    if (value.slice(index, index + 3) === 'nil') {
      const previous = value[index - 1] || '';
      const next = value[index + 3] || '';
      if (!/[A-Za-z0-9_]/.test(previous) && !/[A-Za-z0-9_]/.test(next)) {
        result += 'null';
        index += 2;
        continue;
      }
    }
    result += character;
  }
  return result;
}

function validateBusinessResult(document) {
  const rawCode = document?.code ?? document?.Code;
  if (rawCode === undefined || rawCode === null || rawCode === '') return document;
  const code = Number(rawCode);
  if (code === 0 || code === 20_000) return document;
  const detail = text(document?.message ?? document?.Message ?? document?.msg, 160);
  throw new IkuaiProviderError(
    detail ? `iKuai API rejected the request: ${detail}` : `iKuai API rejected the request (code ${rawCode})`,
    [3_007, 1_008, 10_014].includes(code) ? 'IKUAI_AUTH_FAILED' : 'IKUAI_UNAVAILABLE',
  );
}

export function requestIkuaiJson(target, {
  token,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  allowInsecureTls = false,
  maxBytes = MAX_RESPONSE_BYTES,
} = {}) {
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
      agent: false,
      headers: {
        accept: 'application/json',
        'accept-encoding': 'identity',
        authorization: `Bearer ${token}`,
        'user-agent': 'home-server-dashboard/1.0',
      },
      ...(target.protocol === 'https:' ? { rejectUnauthorized: !allowInsecureTls } : {}),
    }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400) {
        response.destroy();
        finish(new IkuaiProviderError('iKuai API redirects are not allowed'));
        return;
      }
      if (status < 200 || status >= 300) {
        response.destroy();
        finish(new IkuaiProviderError(
          `iKuai API returned HTTP ${status}`,
          status === 401 || status === 403 ? 'IKUAI_AUTH_FAILED' : 'IKUAI_UNAVAILABLE',
        ));
        return;
      }

      const declaredLength = Number(response.headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        response.destroy();
        finish(new IkuaiProviderError('iKuai API response is too large'));
        return;
      }

      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > maxBytes) {
          response.destroy();
          finish(new IkuaiProviderError('iKuai API response is too large'));
          return;
        }
        chunks.push(bytes);
      });
      response.once('error', (error) => finish(new IkuaiProviderError(error.message)));
      response.once('end', () => {
        let document;
        try {
          const text = Buffer.concat(chunks).toString('utf8').trim();
          document = JSON.parse(normalizeBareNil(text));
          if (!document || typeof document !== 'object') {
            throw new Error('invalid response');
          }
        } catch {
          finish(new IkuaiProviderError('iKuai API returned invalid JSON'));
          return;
        }
        try {
          finish(null, validateBusinessResult(document));
        } catch (error) {
          finish(error instanceof IkuaiProviderError
            ? error
            : new IkuaiProviderError('iKuai API rejected the request'));
        }
      });
    });

    timer = setTimeout(() => request.destroy(new IkuaiProviderError(`iKuai API timed out after ${timeoutMs} ms`)), timeoutMs);
    request.once('error', (error) => finish(error instanceof IkuaiProviderError
      ? error
      : new IkuaiProviderError(error.message)));
    request.end();
  });
}

function envelope(document) {
  if (!document || typeof document !== 'object') return {};
  return document.results ?? document.data ?? document.Data ?? document;
}

function listFrom(document) {
  const value = envelope(document);
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.Data)) return value.Data;
  if (Array.isArray(document?.results?.data)) return document.results.data;
  return [];
}

function collectionFrom(document, name) {
  const value = envelope(document);
  if (Array.isArray(value)) return { data: value, total: null };
  if (Array.isArray(value?.data)) return { data: value.data, total: value.total };
  if (Array.isArray(value?.Data)) return { data: value.Data, total: value.total ?? value.Total };
  if (Array.isArray(document?.results?.data)) {
    return { data: document.results.data, total: document.results.total };
  }
  const total = number(value?.total ?? value?.Total, Number.NaN);
  if ((value?.data === null || value?.Data === null) && total === 0) {
    return { data: [], total: 0 };
  }
  throw new IkuaiProviderError(`iKuai ${name} response is missing its data collection`);
}

function systemInfoFrom(document) {
  const value = envelope(document);
  const sysinfo = value?.sysinfo ?? value?.system ?? value;
  if (!sysinfo || typeof sysinfo !== 'object' || Array.isArray(sysinfo)) {
    throw new IkuaiProviderError('iKuai system response is missing system information');
  }
  const expectedFields = ['hostname', 'ip_addr', 'cpu', 'memory', 'stream', 'verinfo', 'uptime'];
  if (!expectedFields.some((field) => Object.hasOwn(sysinfo, field))) {
    throw new IkuaiProviderError('iKuai system response is missing system information');
  }
  return sysinfo;
}

function text(value, maximum = 120) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function number(value, fallback = 0) {
  const parsed = Number(String(value ?? '').replace(/%$/, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizedMac(value) {
  return text(value, 32).toLowerCase().replace(/-/g, ':');
}

function identityKey(device) {
  const mac = normalizedMac(device.mac);
  if (mac) return `mac:${mac}`;
  const ip = text(device.ipAddress, 64);
  if (ip) return `ip:${ip}`;
  return `name:${text(device.label, 120)}`;
}

function anonymousId(prefix, value) {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 14)}`;
}

function inferNodeType(...values) {
  const value = values.filter(Boolean).join(' ').toLowerCase();
  if (/switch|交换机/.test(value)) return 'switch';
  if (/\bap\b|access point|无线/.test(value)) return 'ap';
  if (/camera|摄像|监控/.test(value)) return 'camera';
  if (/printer|打印/.test(value)) return 'printer';
  if (/router|gateway|ikuai|路由/.test(value)) return 'router';
  if (/nas|synology|qnap|群晖|威联通/.test(value)) return 'nas';
  if (/server|esxi|vmware|proxmox|服务器/.test(value)) return 'server';
  return 'client';
}

function downstreamDevice(item) {
  const label = text(item.name) || text(item.tagname) || text(item.ip_addr) || '未命名设备';
  return {
    label,
    type: inferNodeType(item.device, item.name, item.tagname),
    status: number(item.status, 0) === 1 ? 'up' : 'down',
    ipAddress: text(item.ip_addr, 64),
    mac: normalizedMac(item.mac),
    interface: text(item.access || item.interface, 64),
    deviceKind: text(item.device, 64),
  };
}

function onlineClient(item) {
  const label = text(item.comment)
    || text(item.termname)
    || text(item.hostname)
    || text(item.ip_addr, 64)
    || '未命名终端';
  return {
    label,
    type: inferNodeType(item.client_type, item.client_vendor, item.client_model, label),
    status: 'up',
    ipAddress: text(item.ip_addr, 64),
    mac: normalizedMac(item.mac),
    interface: text(item.interface || item.ssid, 64),
    uplinkDevice: text(item.uplink_dev, 120),
    uplinkAddress: normalizedMac(item.uplink_addr),
    vendor: text(item.client_vendor, 120),
    model: text(item.client_model, 120),
    clientType: text(item.client_type, 80),
    upload: number(item.upload),
    download: number(item.download),
    totalUp: number(item.total_up),
    totalDown: number(item.total_down),
    connectedAt: text(item.uptime, 80),
  };
}

function mergeDevices(downstream, clients) {
  const devices = [];
  const byMac = new Map();
  const byIp = new Map();

  const indexDevice = (device) => {
    if (device.mac) byMac.set(device.mac, device);
    if (device.ipAddress) byIp.set(device.ipAddress, device);
  };
  const merge = (incoming, fromClient) => {
    const existing = (incoming.mac && byMac.get(incoming.mac))
      || (incoming.ipAddress && byIp.get(incoming.ipAddress));
    if (!existing) {
      const created = { ...incoming };
      devices.push(created);
      indexDevice(created);
      return;
    }

    const existingLabel = existing.label;
    const existingType = existing.type;
    for (const [key, value] of Object.entries(incoming)) {
      if (value !== '' && value !== undefined && value !== null) existing[key] = value;
    }
    if (fromClient && incoming.label === incoming.ipAddress && existingLabel) {
      existing.label = existingLabel;
    }
    if (existingType && existingType !== 'client') existing.type = existingType;
    indexDevice(existing);
  };

  downstream.slice(0, MAX_CLIENTS).map(downstreamDevice).forEach((device) => merge(device, false));
  clients.slice(0, MAX_CLIENTS).map(onlineClient).forEach((device) => merge(device, true));
  return devices.map((device) => ({
    ...device,
    id: anonymousId('ikuai-device', identityKey(device)),
  }));
}

function positionNodes(nodes, parentById) {
  const memo = new Map();
  const depthFor = (id, visiting = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) return 2;
    const parent = parentById.get(id);
    if (!parent || parent === 'ikuai-router') return 2;
    visiting.add(id);
    const depth = Math.min(6, depthFor(parent, visiting) + 1);
    visiting.delete(id);
    memo.set(id, depth);
    return depth;
  };

  const levels = new Map();
  for (const node of nodes) {
    const depth = depthFor(node.id);
    const level = levels.get(depth) || [];
    level.push(node);
    levels.set(depth, level);
  }
  const maximumDepth = Math.max(2, ...levels.keys());
  for (const [depth, level] of levels) {
    level.sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'));
    level.forEach((node, index) => {
      node.x = ((index + 1) / (level.length + 1)) * 100;
      node.y = 48 + ((depth - 2) / Math.max(1, maximumDepth - 1)) * 44;
    });
  }
}

export function buildIkuaiTopology({
  system: systemDocument,
  clients: clientsDocument,
  downstream: downstreamDocument,
  interfaces: interfacesDocument,
  now = () => new Date(),
} = {}) {
  const sysinfo = systemInfoFrom(systemDocument);
  const clients = listFrom(clientsDocument);
  const downstream = listFrom(downstreamDocument);
  const devices = mergeDevices(downstream, clients);
  const interfacesEnvelope = envelope(interfacesDocument);
  const physicalInterfaces = interfacesEnvelope.ether_info && typeof interfacesEnvelope.ether_info === 'object'
    ? Object.values(interfacesEnvelope.ether_info)
    : [];
  const linkedInterfaces = physicalInterfaces.filter((item) => number(item?.link) === 1);
  const stream = sysinfo.stream && typeof sysinfo.stream === 'object' ? sysinfo.stream : {};
  const memory = sysinfo.memory && typeof sysinfo.memory === 'object' ? sysinfo.memory : {};
  const version = sysinfo.verinfo && typeof sysinfo.verinfo === 'object' ? sysinfo.verinfo : {};

  const internetNode = {
    id: 'ikuai-internet',
    label: 'Internet',
    type: 'internet',
    status: 'up',
    x: 50,
    y: 8,
  };
  const routerNode = {
    id: 'ikuai-router',
    label: text(sysinfo.hostname) || 'iKuai Router',
    type: 'router',
    status: 'up',
    x: 50,
    y: 27,
    ipAddress: text(sysinfo.ip_addr, 64),
    version: text(version.verstring || version.version, 120),
    model: text(version.modelname, 120),
    uptimeSeconds: number(sysinfo.uptime),
    cpuUsage: number(Array.isArray(sysinfo.cpu) ? sysinfo.cpu[0] : sysinfo.cpu),
    memoryUsage: number(memory.used),
    upload: number(stream.upload),
    download: number(stream.download),
    totalUp: number(stream.total_up),
    totalDown: number(stream.total_down),
  };

  const macToId = new Map(devices.filter((device) => device.mac).map((device) => [device.mac, device.id]));
  const parentById = new Map();
  const links = [{ source: internetNode.id, target: routerNode.id, label: 'WAN' }];
  for (const device of devices) {
    const candidateParent = device.uplinkAddress ? macToId.get(device.uplinkAddress) : null;
    const parent = candidateParent && candidateParent !== device.id ? candidateParent : routerNode.id;
    parentById.set(device.id, parent);
    links.push({
      source: parent,
      target: device.id,
      label: device.interface || undefined,
    });
  }
  positionNodes(devices, parentById);

  return {
    updatedAt: now().toISOString(),
    nodes: [internetNode, routerNode, ...devices],
    links,
    stats: {
      onlineClients: clients.length,
      knownDevices: devices.length,
      linkedInterfaces: linkedInterfaces.length,
      upload: number(stream.upload),
      download: number(stream.download),
    },
  };
}

export function createIkuaiTopologyProvider({
  env = process.env,
  fsImpl = fs,
  requestImpl = requestIkuaiJson,
  now = () => new Date(),
  logger = console,
} = {}) {
  let cached = null;
  let inFlight = null;

  function load(cacheTtlMs = DEFAULT_CACHE_TTL_MS) {
    const ttl = Math.max(5_000, Math.min(300_000, Number(cacheTtlMs) || DEFAULT_CACHE_TTL_MS));
    const currentTime = now().getTime();
    if (cached && currentTime - cached.fetchedAt < ttl) return Promise.resolve(cached.value);
    if (inFlight) return inFlight;

    inFlight = (async () => {
      const baseUrl = parseBaseUrl(env.IKUAI_BASE_URL);
      const token = await readToken(env, fsImpl);
      const timeoutMs = parsePositiveInteger(env.IKUAI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 'IKUAI_TIMEOUT_MS');
      const allowInsecureTls = parseBoolean(env.IKUAI_ALLOW_INSECURE_TLS, false);
      const requestOptions = { token, timeoutMs, allowInsecureTls };
      const request = (path) => requestImpl(new URL(path, baseUrl), requestOptions);
      const requestClients = async () => {
        const data = [];
        let total = Number.POSITIVE_INFINITY;
        for (let page = 1; data.length < total && data.length < MAX_CLIENTS; page += 1) {
          const query = new URLSearchParams({
            page: String(page),
            limit: String(CLIENT_PAGE_SIZE),
            order_by: 'download',
            order: 'desc',
          });
          const document = await request(`${API_PATHS.clients}?${query}`);
          const pageCollection = collectionFrom(document, 'online clients');
          const pageData = pageCollection.data;
          const reportedTotal = number(pageCollection.total, Number.NaN);
          total = Number.isFinite(reportedTotal)
            ? Math.min(MAX_CLIENTS, Math.max(data.length + pageData.length, reportedTotal))
            : Math.min(MAX_CLIENTS, data.length + (pageData.length < CLIENT_PAGE_SIZE
              ? pageData.length
              : CLIENT_PAGE_SIZE * 2));
          data.push(...pageData.slice(0, MAX_CLIENTS - data.length));
          if (pageData.length === 0 || pageData.length < CLIENT_PAGE_SIZE) break;
        }
        return { results: { total: Math.min(total, data.length), data } };
      };

      let system;
      let clients;
      try {
        [system, clients] = await Promise.all([
          request(API_PATHS.system),
          requestClients(),
        ]);
        systemInfoFrom(system);
      } catch (error) {
        throw error instanceof IkuaiProviderError
          ? error
          : new IkuaiProviderError('Unable to query the iKuai API');
      }

      const optional = async (name, path) => {
        try {
          return await request(path);
        } catch {
          logger.warn?.(`Unable to query optional iKuai ${name} endpoint`);
          return null;
        }
      };
      const [downstream, interfaces] = await Promise.all([
        optional('downstream', API_PATHS.downstream),
        optional('interfaces', API_PATHS.interfaces),
      ]);
      const value = buildIkuaiTopology({ system, clients, downstream, interfaces, now });
      cached = { fetchedAt: now().getTime(), value };
      return value;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return { load };
}

