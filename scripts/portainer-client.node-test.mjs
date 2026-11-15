import assert from 'node:assert/strict';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { exactStack, loadPortainerConfig, validatePortainerConfig } from './portainer-client.mjs';

const base = {
  baseUrl: 'https://192.168.123.15:9443',
  endpointId: 4,
  apiKey: 'p'.repeat(32),
  caFile: '/tmp/portainer-ca.pem',
  stackName: 'home-server-dashboard',
  lanOrigin: 'http://192.168.123.8:3000',
  imageRepository: 'ghcr.io/gexiaobin/home-server-dashboard',
};

test('validatePortainerConfig restricts the deployment boundary', () => {
  assert.equal(validatePortainerConfig(base).endpointId, 4);
  assert.throws(() => validatePortainerConfig({ ...base, baseUrl: 'https://portainer.example.com' }), /portainer_lan_https_required/);
  assert.throws(() => validatePortainerConfig({ ...base, stackName: 'another-stack' }), /portainer_stack_invalid/);
  assert.throws(() => validatePortainerConfig({ ...base, imageRepository: 'ghcr.io/example/other' }), /portainer_repository_invalid/);
});

test('loadPortainerConfig requires private file permissions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-portainer-'));
  const path = join(directory, 'portainer.json');
  await writeFile(path, JSON.stringify(base), { mode: 0o644 });
  await assert.rejects(loadPortainerConfig(path), /portainer_config_permissions_require_0600/);
  await chmod(path, 0o600);
  assert.equal((await loadPortainerConfig(path)).stackName, 'home-server-dashboard');
});

test('exactStack rejects ambiguous or cross-endpoint matches', () => {
  const config = validatePortainerConfig(base);
  const valid = { Id: 7, Name: 'home-server-dashboard', Type: 2, EndpointId: 4 };
  assert.equal(exactStack([valid], config), valid);
  assert.equal(exactStack([{ ...valid, EndpointId: 3 }], config), null);
  assert.throws(() => exactStack([valid, { ...valid, Id: 8 }], config), /portainer_stack_ambiguous/);
});
