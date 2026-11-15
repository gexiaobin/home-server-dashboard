import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { resolveGhcrImage, pullGhcrImage, validateCommit } from './ghcr-image.mjs';
import { createPortainerClient, loadPortainerConfig } from './portainer-client.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_PROJECT = 'home-server-dashboard';
const APP_SERVICE = 'dashboard';
const LOCK = 'home-server-dashboard-deployment-lock';
const ensure = (condition, code) => { if (!condition) throw new Error(code); };
const digestFile = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');

export function replaceDashboardImage(source, reference) {
  ensure(typeof source === 'string' && /^ghcr\.io\/gexiaobin\/home-server-dashboard@sha256:[a-f0-9]{64}$/.test(reference), 'deployment_image_reference_invalid');
  const lines = source.split('\n');
  const servicesIndex = lines.findIndex((line) => /^services:\s*$/.test(line));
  ensure(servicesIndex >= 0, 'deployment_services_missing');
  const dashboardIndex = lines.findIndex((line, index) => index > servicesIndex && /^  dashboard:\s*$/.test(line));
  ensure(dashboardIndex >= 0, 'deployment_dashboard_missing');
  const nextServiceIndex = lines.findIndex((line, index) => index > dashboardIndex && /^  [A-Za-z0-9_-]+:\s*$/.test(line));
  const end = nextServiceIndex < 0 ? lines.length : nextServiceIndex;
  const imageIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => index > dashboardIndex && index < end && /^    image:\s*\S/.test(line))
    .map(({ index }) => index);
  ensure(imageIndexes.length === 1, 'deployment_dashboard_image_missing');
  lines[imageIndexes[0]] = `    image: "${reference}"`;
  return lines.join('\n');
}

async function appInfo(client, { allowMissing = false } = {}) {
  const rows = await client.docker('GET', `/containers/json?all=1&filters=${encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.project=${APP_PROJECT}`, `com.docker.compose.service=${APP_SERVICE}`] }))}`);
  if (allowMissing && rows.length === 0) return null;
  ensure(rows.length === 1, 'deployment_exactly_one_app_required');
  return client.docker('GET', `/containers/${rows[0].Id}/json`);
}

function validateApp(info, config, { requireHealthy = true } = {}) {
  ensure(info?.Config?.Labels?.['com.docker.compose.project'] === APP_PROJECT && info.Config.Labels['com.docker.compose.service'] === APP_SERVICE, 'deployment_app_identity_invalid');
  ensure(info.HostConfig?.ReadonlyRootfs === true && info.HostConfig?.CapDrop?.includes('ALL') && info.HostConfig?.SecurityOpt?.includes('no-new-privileges:true'), 'deployment_app_isolation_invalid');
  const port = new URL(config.lanOrigin).port || '80';
  ensure(info.HostConfig?.PortBindings?.['3000/tcp']?.some((entry) => entry.HostPort === port), 'deployment_app_port_invalid');
  const destinations = new Set((info.Mounts || []).map((mount) => mount.Destination));
  for (const destination of ['/app/data', '/run/secrets/database_url', '/run/secrets/ikuai_token', '/host/proc', '/host/sys', '/host/storage/volume1', '/host/storage/volume2', '/host/storage/volume3', '/var/run/docker.sock']) ensure(destinations.has(destination), 'deployment_app_mount_invalid');
  if (requireHealthy) ensure(info.State?.Running && info.State?.Health?.Status === 'healthy', 'deployment_app_unhealthy');
  return info;
}

export async function waitHealthy(client, imageReference, { pause = delay } = {}) {
  const deadline = Date.now() + client.config.healthTimeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const info = await appInfo(client, { allowMissing: true });
    if (info) {
      validateApp(info, client.config, { requireHealthy: false });
      ensure(info.Config?.Image === imageReference, 'deployment_app_image_invalid');
      if (info.State?.Running && info.State?.Health?.Status === 'healthy') return info;
      if (info.State?.Status === 'dead' || (info.State?.Status === 'exited' && ![0, 143].includes(info.State?.ExitCode))) throw new Error('deployment_app_failed');
    }
    await pause(2_000);
  }
  throw new Error('deployment_health_timeout');
}

async function readConfig(origin) {
  const response = await fetch(`${origin}/api/config`, { signal: AbortSignal.timeout(15_000) });
  ensure(response.ok && response.headers.get('etag'), 'deployment_config_backup_failed');
  const text = await response.text();
  JSON.parse(text);
  return { text, etag: response.headers.get('etag') };
}

async function verifyProduction(config, expectedConfig) {
  const health = await fetch(`${config.lanOrigin}/api/health`, { signal: AbortSignal.timeout(15_000) });
  ensure(health.ok && (await health.json()).storage === 'postgresql', 'deployment_health_entry_failed');
  const current = await readConfig(config.lanOrigin);
  ensure(stableJson(current.text) === stableJson(expectedConfig.text), 'deployment_config_changed');
}

function stableJson(text) {
  const sort = (value) => Array.isArray(value)
    ? value.map(sort)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sort(value[key])]))
      : value;
  return JSON.stringify(sort(JSON.parse(text)));
}

const ambiguous = (error) => /^portainer_(?:request_|response_|output_|input_)/.test(error?.message || '') || /^portainer_http_5/.test(error?.message || '');

export async function deployPortainer(client, commit, {
  dryRun = false,
  backupRoot = resolve(ROOT, '.data/portainer-backups'),
  resolveImage = resolveGhcrImage,
  pullImage = pullGhcrImage,
  verify = verifyProduction,
} = {}) {
  validateCommit(commit);
  const config = client.config;
  const release = await resolveImage({ repository: config.imageRepository, commit, username: config.registryUsername, token: config.registryToken });
  const stack = await client.findStack(); ensure(stack, 'deployment_existing_stack_required');
  const source = await client.stackFile(stack); ensure(Array.isArray(stack.Env), 'deployment_stack_env_missing');
  const before = validateApp(await appInfo(client), config);
  const currentConfig = await readConfig(config.lanOrigin);
  if (dryRun) return { mode: 'dry-run', stackId: stack.Id, commit, image: release.reference, existingAppVerified: true };
  await pullImage(client, release, { username: config.registryUsername, token: config.registryToken });
  const next = replaceDashboardImage(source, release.reference);
  const directory = resolve(backupRoot, new Date().toISOString().replaceAll(/[:.]/g, '-'));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(resolve(directory, 'stack-before.json'), JSON.stringify({ stackId: stack.Id, endpointId: config.endpointId, image: before.Config.Image, compose: source, env: stack.Env }, null, 2), { flag: 'wx', mode: 0o600 });
  await writeFile(resolve(directory, 'config.json'), currentConfig.text, { flag: 'wx', mode: 0o600 });
  const lock = await client.docker('POST', `/containers/create?name=${LOCK}`, { body: { Image: before.Image, Cmd: ['node', '-e', 'process.exit(0)'], Labels: { 'io.home-server-dashboard.deployment-lock': randomUUID() }, HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'] } } });
  ensure(/^[a-f0-9]{64}$/.test(lock?.Id), 'deployment_lock_invalid');
  let stopped = false; let switched = false; let mutationInFlight = false; let releaseLock = true;
  try {
    const locked = validateApp(await appInfo(client), config);
    const lockedStack = await client.findStack();
    ensure(locked.Id === before.Id && locked.Image === before.Image && lockedStack?.Id === stack.Id && JSON.stringify(lockedStack.Env) === JSON.stringify(stack.Env) && await client.stackFile(lockedStack) === source, 'deployment_changed_during_preflight');
    const postgres = await client.docker('GET', `/containers/${encodeURIComponent(config.databaseContainer)}/json`);
    ensure(postgres.Name === `/${config.databaseContainer}` && postgres.State?.Running, 'deployment_postgres_identity_invalid');
    stopped = true; mutationInFlight = true; await client.docker('POST', `/containers/${before.Id}/stop?t=30`, { timeoutMs: 45_000 }); mutationInFlight = false;
    await client.exec(postgres.Id, ['pg_dump', '--host=/var/run/postgresql', '--username=postgres', `--dbname=${config.databaseName}`, '--no-owner', '--no-acl', '--format=custom', '--table=public.home_server_dashboard_config'], { outputFile: resolve(directory, 'config-table.dump'), timeoutMs: 180_000 });
    ensure((await stat(resolve(directory, 'config-table.dump'))).size > 0, 'deployment_database_backup_empty');
    await client.docker('GET', `/containers/${before.Id}/archive?path=%2Fapp%2Fdata`, { outputFile: resolve(directory, 'data.tar'), timeoutMs: 180_000 });
    const manifest = { createdAt: new Date().toISOString(), previousImage: before.Config.Image, nextImage: release.reference, commit, etag: currentConfig.etag, digests: { config: createHash('sha256').update(currentConfig.text).digest('hex'), database: await digestFile(resolve(directory, 'config-table.dump')), data: await digestFile(resolve(directory, 'data.tar')) } };
    await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
    switched = true; mutationInFlight = true; await client.updateStack(stack, next, stack.Env); mutationInFlight = false;
    await waitHealthy(client, release.reference);
    await verify(config, currentConfig);
    return { mode: 'deployed', stackId: stack.Id, commit, image: release.reference, backupDirectory: directory, health: 'healthy', configPreserved: true };
  } catch (error) {
    if (mutationInFlight && ambiguous(error)) { releaseLock = false; throw new Error('deployment_ambiguous_manual_check_required'); }
    if (switched) { try { await client.updateStack(stack, source, stack.Env); await waitHealthy(client, before.Config.Image); } catch { releaseLock = false; throw new Error('deployment_rollback_failed_manual_check_required'); } }
    else if (stopped) { try { await client.docker('POST', `/containers/${before.Id}/start`); } catch { releaseLock = false; throw new Error('deployment_restart_failed_manual_check_required'); } }
    throw error;
  } finally {
    if (releaseLock) await client.docker('DELETE', `/containers/${lock.Id}?v=1`).catch(() => { throw new Error('deployment_lock_cleanup_failed_manual_check_required'); });
  }
}

async function main() {
  let configPath = resolve(ROOT, '.data/deploy/portainer.json'); let commit; let inspect = false; let dryRun = false;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--config') configPath = resolve(args[++index] || '');
    else if (args[index] === '--commit') commit = args[++index];
    else if (args[index] === '--inspect') inspect = true;
    else if (args[index] === '--dry-run') dryRun = true;
    else throw new Error('deployment_usage_invalid');
  }
  const client = await createPortainerClient(await loadPortainerConfig(configPath));
  if (inspect) { const stack = await client.findStack(); const summary = { connection: 'verified', endpointId: client.config.endpointId, stackPresent: Boolean(stack) }; if (stack) { const info = validateApp(await appInfo(client), client.config); Object.assign(summary, { stackId: stack.Id, health: info.State.Health?.Status, image: info.Config.Image }); } console.log(JSON.stringify(summary)); return; }
  ensure(commit, 'deployment_commit_required');
  console.log(JSON.stringify(await deployPortainer(client, commit, { dryRun })));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(/^[a-z0-9_:.-]+$/.test(error.message) ? error.message : 'deployment_failed'); process.exitCode = 1; });
