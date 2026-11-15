import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deployPortainer, replaceDashboardImage } from './deploy-portainer.mjs';

const commit = 'a'.repeat(40);
const digest = `sha256:${'b'.repeat(64)}`;
const reference = `ghcr.io/gexiaobin/home-server-dashboard@${digest}`;
const compose = `services:\n  dashboard:\n    image: "ghcr.io/gexiaobin/home-server-dashboard@sha256:${'c'.repeat(64)}"\n    read_only: true\n  helper:\n    image: busybox\n`;

function fixture({ pullError } = {}) {
  const events = [];
  const app = {
    Id: '1'.repeat(64), Image: '2'.repeat(64),
    Config: { Image: `ghcr.io/gexiaobin/home-server-dashboard@sha256:${'c'.repeat(64)}`, Labels: { 'com.docker.compose.project': 'home-server-dashboard', 'com.docker.compose.service': 'dashboard' } },
    HostConfig: { ReadonlyRootfs: true, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'], PortBindings: { '3000/tcp': [{ HostPort: '3000' }] } },
    Mounts: ['/app/data', '/run/secrets/database_url', '/run/secrets/ikuai_token', '/host/proc', '/host/sys', '/host/storage/volume1', '/host/storage/volume2', '/host/storage/volume3', '/var/run/docker.sock'].map((Destination) => ({ Destination })),
    State: { Running: true, Health: { Status: 'healthy' } },
  };
  const stack = { Id: 9, Env: [], Name: 'home-server-dashboard', Type: 2, EndpointId: 4 };
  const client = {
    config: { imageRepository: 'ghcr.io/gexiaobin/home-server-dashboard', registryUsername: '', registryToken: '', healthTimeoutSeconds: 30, lanOrigin: 'http://192.168.123.8:3000', endpointId: 4, databaseContainer: 'postgresql', databaseName: 'postgres' },
    findStack: async () => stack,
    stackFile: async () => compose,
    updateStack: async () => { events.push('update'); },
    exec: async () => { events.push('backup'); if (pullError === 'backup') throw new Error('backup_failed'); },
    docker: async (method, path) => {
      events.push(`${method} ${path}`);
      if (path.startsWith('/containers/json')) return [{ Id: app.Id }];
      if (path === `/containers/${app.Id}/json`) return app;
      if (path === '/containers/postgresql/json') return { Id: '3'.repeat(64), Name: '/postgresql', State: { Running: true } };
      if (path.startsWith('/containers/create')) return { Id: '4'.repeat(64) };
      return null;
    },
  };
  return { client, events };
}

test('replaceDashboardImage changes only the dashboard service image', () => {
  const result = replaceDashboardImage(compose, reference);
  assert.match(result, new RegExp(`dashboard:\\n    image: "${reference}"`));
  assert.match(result, /helper:\n    image: busybox/);
});

test('dry-run validates production without pulling or mutating', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response('{"services":[]}', { status: 200, headers: { etag: '"one"' } });
  const { client, events } = fixture();
  const result = await deployPortainer(client, commit, {
    dryRun: true,
    resolveImage: async () => ({ commit, digest, reference }),
    pullImage: async () => { events.push('pull'); },
  });
  assert.equal(result.mode, 'dry-run');
  assert.equal(events.includes('pull'), false);
  assert.equal(events.some((event) => event.includes('/stop')), false);
});

test('pull failure leaves the running stack untouched', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response('{"services":[]}', { status: 200, headers: { etag: '"one"' } });
  const { client, events } = fixture();
  await assert.rejects(deployPortainer(client, commit, {
    backupRoot: await mkdtemp(join(tmpdir(), 'dashboard-deploy-')),
    resolveImage: async () => ({ commit, digest, reference }),
    pullImage: async () => { events.push('pull'); throw new Error('pull_failed'); },
  }), /pull_failed/);
  assert.equal(events.some((event) => event.includes('/stop')), false);
  assert.equal(events.includes('update'), false);
});
