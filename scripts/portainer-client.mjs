import https from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ensure = (condition, code) => { if (!condition) throw new Error(code); };
const ID = /^[a-f0-9]{12,64}$/;
const privateIPv4 = (value) => {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => /^(0|[1-9][0-9]*)$/.test(part) && Number(part) <= 255)
    && (parts[0] === '10' || (parts[0] === '172' && +parts[1] >= 16 && +parts[1] <= 31) || (parts[0] === '192' && parts[1] === '168'));
};

export function validatePortainerConfig(value) {
  const allowed = ['baseUrl', 'endpointId', 'apiKey', 'caFile', 'certificateSha256', 'stackName', 'lanOrigin', 'imageRepository', 'registryUsername', 'registryToken', 'healthTimeoutSeconds', 'databaseContainer', 'databaseName'];
  ensure(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every((key) => allowed.includes(key)), 'portainer_config_invalid');
  const config = { stackName: 'home-server-dashboard', imageRepository: 'ghcr.io/gexiaobin/home-server-dashboard', registryUsername: '', registryToken: '', healthTimeoutSeconds: 180, databaseContainer: 'postgresql', databaseName: 'postgres', ...value };
  let baseUrl;
  try { baseUrl = new URL(config.baseUrl); } catch { throw new Error('portainer_url_invalid'); }
  ensure(baseUrl.protocol === 'https:' && privateIPv4(baseUrl.hostname) && baseUrl.pathname === '/' && !baseUrl.username && !baseUrl.password && !baseUrl.search && !baseUrl.hash, 'portainer_lan_https_required');
  config.baseUrl = baseUrl.origin;
  ensure(Number.isSafeInteger(config.endpointId) && config.endpointId > 0, 'portainer_endpoint_invalid');
  ensure(typeof config.apiKey === 'string' && config.apiKey.length >= 20 && config.apiKey.length <= 1024 && !/[\s\0]/.test(config.apiKey), 'portainer_key_invalid');
  ensure(typeof config.caFile === 'string' && isAbsolute(config.caFile) && !/[\r\n\0]/.test(config.caFile), 'portainer_ca_required');
  if (config.certificateSha256 !== undefined) ensure(/^[a-f0-9]{64}$/.test(config.certificateSha256), 'portainer_certificate_pin_invalid');
  ensure(config.stackName === 'home-server-dashboard', 'portainer_stack_invalid');
  ensure(config.imageRepository === 'ghcr.io/gexiaobin/home-server-dashboard', 'portainer_repository_invalid');
  ensure(Boolean(config.registryUsername) === Boolean(config.registryToken), 'portainer_registry_credentials_incomplete');
  if (config.registryUsername) {
    ensure(/^[A-Za-z0-9_.-]{1,100}$/.test(config.registryUsername), 'portainer_registry_username_invalid');
    ensure(config.registryToken.length >= 20 && config.registryToken.length <= 1024 && !/[\s\0]/.test(config.registryToken), 'portainer_registry_token_invalid');
  }
  ensure(Number.isInteger(config.healthTimeoutSeconds) && config.healthTimeoutSeconds >= 30 && config.healthTimeoutSeconds <= 600, 'portainer_health_timeout_invalid');
  ensure(/^[a-z][a-z0-9_-]{0,62}$/.test(config.databaseContainer) && /^[a-z][a-z0-9_-]{0,62}$/.test(config.databaseName), 'portainer_database_identity_invalid');
  let origin;
  try { origin = new URL(config.lanOrigin); } catch { throw new Error('portainer_origin_invalid'); }
  ensure(origin.protocol === 'http:' && privateIPv4(origin.hostname) && origin.pathname === '/' && !origin.username && !origin.password && !origin.search && !origin.hash, 'portainer_lan_origin_required');
  config.lanOrigin = origin.origin;
  return config;
}

export async function loadPortainerConfig(path) {
  const info = await stat(path);
  ensure(info.isFile() && (info.mode & 0o077) === 0, 'portainer_config_permissions_require_0600');
  let value;
  try { value = JSON.parse(await readFile(path, 'utf8')); } catch { throw new Error('portainer_config_unreadable'); }
  return validatePortainerConfig(value);
}

export class DockerStdout extends Transform {
  constructor() { super(); this.pending = Buffer.alloc(0); this.remaining = 0; this.channel = 0; }
  _transform(chunk, encoding, done) {
    try {
      let bytes = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
      this.pending = Buffer.alloc(0);
      while (bytes.length) {
        if (!this.remaining) {
          if (bytes.length < 8) { this.pending = bytes; break; }
          ensure([1, 2].includes(bytes[0]) && bytes.subarray(1, 4).every((value) => value === 0), 'docker_stream_invalid');
          this.channel = bytes[0]; this.remaining = bytes.readUInt32BE(4); bytes = bytes.subarray(8);
          ensure(this.remaining <= 64 * 1024 * 1024, 'docker_frame_too_large');
          if (!this.remaining) continue;
        }
        const length = Math.min(bytes.length, this.remaining);
        if (this.channel === 1) this.push(bytes.subarray(0, length));
        bytes = bytes.subarray(length); this.remaining -= length;
      }
      done();
    } catch { done(new Error('docker_stream_invalid')); }
  }
  _flush(done) { done(this.pending.length || this.remaining ? new Error('docker_stream_truncated') : undefined); }
}

export async function createPortainerClient(input, { requestImpl = https.request } = {}) {
  const config = validatePortainerConfig(input);
  const ca = await readFile(config.caFile);
  ensure(ca.includes(Buffer.from('-----BEGIN CERTIFICATE-----')), 'portainer_ca_invalid');
  const verifyServerIdentity = config.certificateSha256
    ? (_hostname, certificate) => certificate?.raw && createHash('sha256').update(certificate.raw).digest('hex') === config.certificateSha256 ? undefined : new Error('portainer_certificate_pin_mismatch')
    : checkServerIdentity;
  async function request(method, path, { body, headers = {}, responseType = 'json', outputFile, decodeDockerStream = false, timeoutMs = 120_000, maxBytes = 16 * 1024 * 1024 } = {}) {
    ensure(['GET', 'POST', 'PUT', 'DELETE'].includes(method) && path.startsWith('/api/') && !/[\r\n\0\\]/.test(path) && !path.includes('..'), 'portainer_request_invalid');
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const requestHeaders = { ...headers, 'X-API-Key': config.apiKey };
    if (payload) { requestHeaders['Content-Type'] = 'application/json'; requestHeaders['Content-Length'] = payload.length; }
    return new Promise((resolve, reject) => {
      let settled = false; let requestHandle;
      const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); if (error) requestHandle?.destroy(); error ? reject(error) : resolve(result); };
      const timer = setTimeout(() => finish(new Error('portainer_request_timeout')), timeoutMs); timer.unref?.();
      try {
        requestHandle = requestImpl(new URL(path, config.baseUrl), { method, headers: requestHeaders, ca, rejectUnauthorized: true, checkServerIdentity: verifyServerIdentity }, (response) => {
          if (response.statusCode < 200 || response.statusCode >= 300) { response.resume(); finish(new Error(`portainer_http_${response.statusCode || 0}`)); return; }
          const stream = decodeDockerStream ? response.pipe(new DockerStdout()) : response;
          if (outputFile) { const destination = createWriteStream(outputFile, { flags: 'wx', mode: 0o600 }); pipeline(stream, destination).then(() => finish(null, { status: response.statusCode }), () => finish(new Error('portainer_output_failed'))); return; }
          const chunks = []; let size = 0;
          stream.on('data', (part) => { size += part.length; if (size > maxBytes) { stream.destroy(); finish(new Error('portainer_response_limit')); } else chunks.push(part); });
          stream.on('error', () => finish(new Error('portainer_response_failed')));
          stream.on('end', () => { if (settled) return; const data = Buffer.concat(chunks); if (responseType === 'buffer') return finish(null, data); if (responseType === 'text') return finish(null, data.toString('utf8')); try { finish(null, data.length ? JSON.parse(data) : null); } catch { finish(new Error('portainer_response_invalid')); } });
        });
      } catch { finish(new Error('portainer_request_failed')); return; }
      requestHandle.on('error', (error) => finish(new Error(['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(error.code) ? 'portainer_tls_verification_failed' : 'portainer_request_failed')));
      requestHandle.end(payload);
    });
  }
  const docker = (method, path, options) => request(method, `/api/endpoints/${config.endpointId}/docker${path}`, options);
  async function exec(containerId, command, { outputFile, timeoutMs = 120_000, responseType = 'buffer', maxBytes } = {}) {
    ensure(ID.test(containerId) && Array.isArray(command) && command.length && command.every((value) => typeof value === 'string' && !value.includes('\0')), 'docker_exec_invalid');
    const created = await docker('POST', `/containers/${containerId}/exec`, { body: { AttachStdout: true, AttachStderr: true, AttachStdin: false, Tty: false, Cmd: command } });
    ensure(ID.test(created?.Id), 'docker_exec_identity_invalid');
    const result = await docker('POST', `/exec/${created.Id}/start`, { body: { Detach: false, Tty: false }, outputFile, decodeDockerStream: true, responseType, timeoutMs, maxBytes });
    const state = await docker('GET', `/exec/${created.Id}/json`);
    ensure(state.Running === false && state.ExitCode === 0, 'docker_exec_failed');
    return result;
  }
  async function findStack() { const stacks = await request('GET', '/api/stacks'); return exactStack(stacks, config); }
  async function stackFile(stack) { validateStack(stack, config); const result = await request('GET', `/api/stacks/${stack.Id}/file`); ensure(typeof result?.StackFileContent === 'string', 'portainer_stack_file_invalid'); return result.StackFileContent; }
  async function createStack(content, environment = []) {
    ensure(!await findStack(), 'portainer_stack_already_exists');
    const created = await request('POST', `/api/stacks/create/standalone/string?endpointId=${config.endpointId}`, { body: { Name: config.stackName, StackFileContent: content, Env: environment }, timeoutMs: 300_000 });
    return validateStack(created, config);
  }
  async function updateStack(stack, content, environment) { validateStack(stack, config); return request('PUT', `/api/stacks/${stack.Id}?endpointId=${config.endpointId}`, { body: { StackFileContent: content, Env: environment, Prune: false, PullImage: false }, timeoutMs: 300_000 }); }
  return { config, request, docker, exec, findStack, stackFile, createStack, updateStack };
}

export function validateStack(stack, config) { ensure(stack && Number.isSafeInteger(stack.Id) && stack.Id > 0 && stack.Name === config.stackName && stack.Type === 2 && stack.EndpointId === config.endpointId, 'portainer_stack_identity_mismatch'); return stack; }
export function exactStack(stacks, config) { ensure(Array.isArray(stacks), 'portainer_stacks_invalid'); const matches = stacks.filter((stack) => stack.Name === config.stackName && stack.EndpointId === config.endpointId); ensure(matches.length <= 1, 'portainer_stack_ambiguous'); return matches.length ? validateStack(matches[0], config) : null; }
