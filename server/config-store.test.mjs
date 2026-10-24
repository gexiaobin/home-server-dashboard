import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ConfigStore,
  ConfigValidationError,
  DEFAULT_CONFIG,
} from './config-store.mjs';

const temporaryDirectories = [];

async function createTemporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-server-config-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('ConfigStore', () => {
  it('returns defaults when no persisted config exists', async () => {
    const dataDir = await createTemporaryDirectory();
    const store = new ConfigStore({
      dataDir,
      defaults: DEFAULT_CONFIG,
      defaultsFile: path.join(dataDir, 'missing-defaults.json'),
    });

    await expect(store.get()).resolves.toEqual(DEFAULT_CONFIG);
  });

  it('preserves a host display name supplied by installation defaults', async () => {
    const dataDir = await createTemporaryDirectory();
    const defaults = {
      ...DEFAULT_CONFIG,
      settings: { ...DEFAULT_CONFIG.settings, hostDisplayName: 'Default NAS' },
    };
    const store = new ConfigStore({
      dataDir,
      defaults,
      defaultsFile: path.join(dataDir, 'missing-defaults.json'),
    });

    await expect(store.get()).resolves.toMatchObject({
      settings: { hostDisplayName: 'Default NAS' },
    });
  });

  it('persists normalized config that a fresh store instance can read', async () => {
    const dataDir = await createTemporaryDirectory();
    const options = {
      dataDir,
      defaults: DEFAULT_CONFIG,
      defaultsFile: path.join(dataDir, 'missing-defaults.json'),
    };
    const config = {
      settings: {
        title: 'My NAS',
        refreshInterval: 10_000,
      },
      services: [
        {
          id: 'photos',
          name: 'Photos',
          url: 'http://photos.home.arpa',
          externalUrl: 'https://photos.example.com/apps/photos?view=timeline#today',
          check: { type: 'http' },
        },
      ],
      topology: {
        nodes: [{ id: 'nas', label: 'NAS' }],
      },
    };

    const saved = await new ConfigStore(options).put(config);
    const reloaded = await new ConfigStore(options).get();
    const onDisk = JSON.parse(await readFile(path.join(dataDir, 'config.json'), 'utf8'));

    expect(saved).toEqual({
      settings: {
        ...DEFAULT_CONFIG.settings,
        ...config.settings,
      },
      services: [{
        description: '',
        scope: 'internal',
        runtime: 'infrastructure',
        category: '其他',
        icon: 'default',
        iconUrl: '',
        iconAllowInsecureTls: false,
        favorite: false,
        ...config.services[0],
      }],
      topology: {
        source: 'manual',
        refreshInterval: 15_000,
        hosts: [],
        nodes: [{ type: 'server', x: 50, y: 50, ...config.topology.nodes[0] }],
        links: [],
      },
    });
    expect(reloaded).toEqual(saved);
    expect(onDisk).toEqual(saved);
    expect(reloaded.services[0].externalUrl).toBe(config.services[0].externalUrl);
    expect(onDisk.services[0].externalUrl).toBe(config.services[0].externalUrl);
  });

  it('normalizes legacy services without an external URL', async () => {
    const dataDir = await createTemporaryDirectory();
    await mkdir(dataDir, { recursive: true });
    await writeFile(path.join(dataDir, 'config.json'), JSON.stringify({
      services: [{
        id: 'legacy-nas',
        name: 'Legacy NAS',
        url: 'https://nas.home.arpa:5001',
      }],
    }), 'utf8');
    const store = new ConfigStore({
      dataDir,
      defaults: DEFAULT_CONFIG,
      defaultsFile: path.join(dataDir, 'missing-defaults.json'),
    });

    const config = await store.get();

    expect(config.services[0]).toMatchObject({
      id: 'legacy-nas',
      url: 'https://nas.home.arpa:5001',
      externalUrl: '',
      scope: 'internal',
      runtime: 'infrastructure',
      iconUrl: '',
      iconAllowInsecureTls: false,
    });
    expect(config.settings.hostDisplayName).toBe('');
  });

  it('normalizes and validates the persisted host display name', async () => {
    const dataDir = await createTemporaryDirectory();
    const store = new ConfigStore({
      dataDir,
      defaultsFile: path.join(dataDir, 'missing-defaults.json'),
    });

    const saved = await store.put({ settings: { hostDisplayName: '  Synology DS920+  ' } });
    expect(saved.settings.hostDisplayName).toBe('Synology DS920+');

    await expect(store.put({ settings: { hostDisplayName: 920 } }))
      .rejects.toThrow('settings.hostDisplayName must be a string');
    await expect(store.put({ settings: { hostDisplayName: 'x'.repeat(101) } }))
      .rejects.toThrow('settings.hostDisplayName must be at most 100 characters');
  });

  it('persists a per-service insecure TLS opt-in for icon discovery', async () => {
    const dataDir = await createTemporaryDirectory();
    const store = new ConfigStore({
      dataDir,
      defaultsFile: path.join(dataDir, 'missing-defaults.json'),
    });

    const saved = await store.put({
      services: [{
        id: 'nas',
        name: 'NAS',
        url: 'https://nas.home.arpa:5001',
        iconAllowInsecureTls: true,
      }],
    });

    expect(saved.services[0].iconAllowInsecureTls).toBe(true);
    await expect(store.put({
      services: [{
        id: 'nas',
        name: 'NAS',
        url: 'https://nas.home.arpa:5001',
        iconAllowInsecureTls: 'yes',
      }],
    })).rejects.toThrow('services[0].iconAllowInsecureTls must be a boolean');
  });

  it('normalizes and validates an optional custom icon URL', async () => {
    const dataDir = await createTemporaryDirectory();
    const store = new ConfigStore({
      dataDir,
      defaultsFile: path.join(dataDir, 'missing-defaults.json'),
    });

    const saved = await store.put({
      services: [{
        id: 'cloud',
        name: 'Cloud',
        url: 'https://console.example.com',
        iconUrl: '  https://cdn.example.com/icon.png  ',
      }],
    });
    expect(saved.services[0].iconUrl).toBe('https://cdn.example.com/icon.png');

    await expect(store.put({
      services: [{
        id: 'cloud',
        name: 'Cloud',
        url: 'https://console.example.com',
        iconUrl: 'file:///etc/passwd',
      }],
    })).rejects.toThrow('services[0].iconUrl must use http or https');
  });

  it('accepts an empty external URL and validates non-empty external URLs', async () => {
    const dataDir = await createTemporaryDirectory();
    const store = new ConfigStore({
      dataDir,
      defaultsFile: path.join(dataDir, 'missing-defaults.json'),
    });

    const saved = await store.put({
      services: [{
        id: 'photos',
        name: 'Photos',
        url: 'http://photos.home.arpa',
        externalUrl: '   ',
      }],
    });
    expect(saved.services[0].externalUrl).toBe('');

    await expect(store.put({
      services: [{
        id: 'photos',
        name: 'Photos',
        url: 'http://photos.home.arpa',
        externalUrl: 'file:///etc/passwd',
      }],
    })).rejects.toThrow('services[0].externalUrl must use http or https');

    await expect(store.put({
      services: [{
        id: 'photos',
        name: 'Photos',
        url: 'http://photos.home.arpa',
        externalUrl: 123,
      }],
    })).rejects.toThrow('services[0].externalUrl must be a string');
  });

  it('normalizes external bookmarks to one public URL without health checks', async () => {
    const dataDir = await createTemporaryDirectory();
    const store = new ConfigStore({
      dataDir,
      defaultsFile: path.join(dataDir, 'missing-defaults.json'),
    });

    const saved = await store.put({
      services: [{
        id: 'aliyun',
        name: 'Alibaba Cloud',
        url: 'https://home.console.aliyun.com/',
        externalUrl: 'https://legacy.example.com/',
        scope: 'external',
        runtime: 'infrastructure',
        check: { type: 'http', url: 'https://home.console.aliyun.com/' },
      }],
    });

    expect(saved.services[0]).toMatchObject({
      url: 'https://home.console.aliyun.com/',
      externalUrl: '',
      scope: 'external',
      runtime: 'infrastructure',
      check: { type: 'none' },
    });
  });

  it('validates service scope and runtime classifications', async () => {
    const dataDir = await createTemporaryDirectory();
    const store = new ConfigStore({
      dataDir,
      defaultsFile: path.join(dataDir, 'missing-defaults.json'),
    });

    await expect(store.put({
      services: [{ id: 'bad-scope', name: 'Bad scope', url: 'https://example.com', scope: 'cloud' }],
    })).rejects.toThrow('services[0].scope must be internal or external');
    await expect(store.put({
      services: [{ id: 'bad-runtime', name: 'Bad runtime', url: 'https://example.com', runtime: 'link' }],
    })).rejects.toThrow('services[0].runtime must be infrastructure, vm, or docker');
  });

  it('rejects invalid input without creating a config file', async () => {
    const dataDir = await createTemporaryDirectory();
    const store = new ConfigStore({
      dataDir,
      defaultsFile: path.join(dataDir, 'missing-defaults.json'),
    });

    await expect(store.put({
      services: [
        { id: 'duplicate', name: 'One', url: 'http://one.local', check: { type: 'none' } },
        { id: 'duplicate', name: 'Two', url: 'http://two.local', check: { type: 'none' } },
      ],
    })).rejects.toBeInstanceOf(ConfigValidationError);
    await expect(readFile(path.join(dataDir, 'config.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects unsafe service URLs and invalid topology references', async () => {
    const dataDir = await createTemporaryDirectory();
    const store = new ConfigStore({
      dataDir,
      defaultsFile: path.join(dataDir, 'missing-defaults.json'),
    });

    await expect(store.put({
      services: [{ id: 'bad', name: 'Bad URL', url: 'file:///etc/passwd' }],
    })).rejects.toThrow('must use http or https');

    await expect(store.put({
      topology: {
        nodes: [{ id: 'nas', label: 'NAS' }],
        links: [{ source: 'nas', target: 'missing' }],
      },
    })).rejects.toThrow('references an unknown node');
  });

  it('normalizes and validates generic topology hosts', async () => {
    const dataDir = await createTemporaryDirectory();
    const store = new ConfigStore({
      dataDir,
      defaultsFile: path.join(dataDir, 'missing-defaults.json'),
    });

    const saved = await store.put({
      services: [
        {
          id: 'vmware-esxi',
          name: 'VMware ESXi',
          url: 'https://esxi.home.arpa',
          scope: 'internal',
          runtime: 'infrastructure',
        },
        {
          id: 'synology-dsm',
          name: 'Synology DSM',
          url: 'https://nas.home.arpa:5001',
          scope: 'internal',
          runtime: 'infrastructure',
        },
        {
          id: 'vm',
          name: 'Virtual machine',
          url: 'http://vm.home.arpa',
          scope: 'internal',
          runtime: 'vm',
        },
        {
          id: 'app',
          name: 'Docker app',
          url: 'http://app.home.arpa',
          scope: 'internal',
          runtime: 'docker',
        },
      ],
      topology: {
        source: 'ikuai',
        refreshInterval: 30_000,
        hosts: [
          { serviceId: '  vmware-esxi  ', nodeType: 'server', serviceIds: [' vm ', 'app'] },
          { serviceId: 'synology-dsm', nodeType: 'nas', serviceIds: ['app'] },
        ],
      },
    });
    expect(saved.topology).toMatchObject({
      source: 'ikuai',
      refreshInterval: 30_000,
      hosts: [
        { serviceId: 'vmware-esxi', nodeType: 'server', serviceIds: ['vm', 'app'] },
        { serviceId: 'synology-dsm', nodeType: 'nas', serviceIds: [] },
      ],
      nodes: [],
      links: [],
    });

    await expect(store.put({ topology: { source: 'router-password' } }))
      .rejects.toThrow('topology.source must be manual or ikuai');
    await expect(store.put({ topology: { refreshInterval: 1_000 } }))
      .rejects.toThrow('topology.refreshInterval must be an integer between 5000 and 300000');
    await expect(store.put({ topology: { hosts: [{ serviceId: 'host', nodeType: 'desktop' }] } }))
      .rejects.toThrow('topology.hosts[0].nodeType must be server or nas');
    await expect(store.put({ topology: { hosts: [{ serviceId: 'host', serviceIds: 'vm' }] } }))
      .rejects.toThrow('topology.hosts[0].serviceIds must be an array');
  });

  it('migrates legacy fixed host fields to generic hosts', async () => {
    const dataDir = await createTemporaryDirectory();
    const store = new ConfigStore({
      dataDir,
      defaultsFile: path.join(dataDir, 'missing-defaults.json'),
    });
    const services = [
      { id: 'hypervisor', name: 'Hypervisor', url: 'https://host.home.arpa', scope: 'internal', runtime: 'infrastructure' },
      { id: 'container-host', name: 'Container host', url: 'https://apps.home.arpa', scope: 'internal', runtime: 'infrastructure' },
      { id: 'vm', name: 'Virtual machine', url: 'http://vm.home.arpa', scope: 'internal', runtime: 'vm' },
      { id: 'app', name: 'Docker app', url: 'http://app.home.arpa', scope: 'internal', runtime: 'docker' },
    ];

    const saved = await store.put({
      services,
      topology: {
        vmHostServiceId: ' hypervisor ',
        dockerHostServiceId: 'container-host',
      },
    });

    expect(saved.topology.hosts).toEqual([
      { serviceId: 'hypervisor', nodeType: 'server', serviceIds: ['vm'] },
      { serviceId: 'container-host', nodeType: 'nas', serviceIds: ['app'] },
    ]);
    expect(saved.topology).not.toHaveProperty('vmHostServiceId');
    expect(saved.topology).not.toHaveProperty('dockerHostServiceId');
  });

  it('clears invalid and duplicate topology host associations without rejecting old config', async () => {
    const dataDir = await createTemporaryDirectory();
    await mkdir(dataDir, { recursive: true });
    const services = [
      {
        id: 'host',
        name: 'Infrastructure host',
        url: 'https://host.home.arpa',
        scope: 'internal',
        runtime: 'infrastructure',
      },
      {
        id: 'vm',
        name: 'Virtual machine',
        url: 'http://vm.home.arpa',
        scope: 'internal',
        runtime: 'vm',
      },
      {
        id: 'docker',
        name: 'Docker app',
        url: 'http://docker.home.arpa',
        scope: 'internal',
        runtime: 'docker',
      },
      {
        id: 'bookmark',
        name: 'Cloud bookmark',
        url: 'https://cloud.example.com',
        scope: 'external',
        runtime: 'infrastructure',
      },
    ];
    await writeFile(path.join(dataDir, 'config.json'), JSON.stringify({
      services,
      topology: {
        vmHostServiceId: 'vm',
        dockerHostServiceId: 'bookmark',
      },
    }), 'utf8');
    const store = new ConfigStore({
      dataDir,
      defaultsFile: path.join(dataDir, 'missing-defaults.json'),
    });

    await expect(store.get()).resolves.toMatchObject({
      topology: {
        hosts: [{ serviceId: 'vm', nodeType: 'server', serviceIds: [] }],
      },
    });

    const duplicate = await store.put({
      services,
      topology: {
        hosts: [
          { serviceId: 'host', nodeType: 'server', serviceIds: ['vm', 'vm', 'bookmark'] },
          { serviceId: 'host', nodeType: 'nas', serviceIds: ['docker'] },
        ],
      },
    });
    expect(duplicate.topology.hosts).toEqual([
      { serviceId: 'host', nodeType: 'server', serviceIds: ['vm'] },
    ]);
  });

  it('supports nested VM hosts and removes self-references and cycles', async () => {
    const dataDir = await createTemporaryDirectory();
    const store = new ConfigStore({
      dataDir,
      defaultsFile: path.join(dataDir, 'missing-defaults.json'),
    });
    const services = [
      { id: 'esxi', name: 'ESXi', url: 'https://esxi.home.arpa', scope: 'internal', runtime: 'infrastructure' },
      { id: 'fnos', name: 'fnOS', url: 'http://fnos.home.arpa', scope: 'internal', runtime: 'vm' },
      { id: 'istoreos', name: 'iStoreOS', url: 'http://istoreos.home.arpa', scope: 'internal', runtime: 'vm' },
      { id: 'app', name: 'Docker app', url: 'http://app.home.arpa', scope: 'internal', runtime: 'docker' },
    ];

    const saved = await store.put({
      services,
      topology: {
        hosts: [
          { serviceId: 'esxi', nodeType: 'server', serviceIds: ['fnos', 'istoreos'] },
          { serviceId: 'fnos', nodeType: 'nas', serviceIds: ['app', 'fnos'] },
          { serviceId: 'istoreos', nodeType: 'server', serviceIds: ['fnos'] },
        ],
      },
    });

    expect(saved.topology.hosts).toEqual([
      { serviceId: 'esxi', nodeType: 'server', serviceIds: ['fnos', 'istoreos'] },
      { serviceId: 'fnos', nodeType: 'nas', serviceIds: ['app'] },
      { serviceId: 'istoreos', nodeType: 'server', serviceIds: [] },
    ]);

    const cycle = await store.put({
      services,
      topology: {
        hosts: [
          { serviceId: 'fnos', nodeType: 'server', serviceIds: ['istoreos'] },
          { serviceId: 'istoreos', nodeType: 'server', serviceIds: ['fnos', 'app'] },
        ],
      },
    });
    expect(cycle.topology.hosts).toEqual([
      { serviceId: 'fnos', nodeType: 'server', serviceIds: ['istoreos'] },
      { serviceId: 'istoreos', nodeType: 'server', serviceIds: ['app'] },
    ]);
  });

  it('never persists deployment addresses or secrets from imported topology config', async () => {
    const dataDir = await createTemporaryDirectory();
    const store = new ConfigStore({
      dataDir,
      defaultsFile: path.join(dataDir, 'missing-defaults.json'),
    });

    const saved = await store.put({
      topology: {
        source: 'ikuai',
        refreshInterval: 15_000,
        baseUrl: 'http://router.invalid',
        token: 'must-not-be-persisted',
        password: 'must-not-be-persisted',
      },
    });
    const serialized = await readFile(path.join(dataDir, 'config.json'), 'utf8');

    expect(saved.topology).toEqual({
      source: 'ikuai',
      refreshInterval: 15_000,
      hosts: [],
      nodes: [],
      links: [],
    });
    expect(serialized).not.toContain('router.invalid');
    expect(serialized).not.toContain('must-not-be-persisted');
  });

  it('reports a corrupt persisted JSON document instead of silently replacing it', async () => {
    const dataDir = await createTemporaryDirectory();
    await mkdir(dataDir, { recursive: true });
    await writeFile(path.join(dataDir, 'config.json'), '{"services": [', 'utf8');
    const store = new ConfigStore({
      dataDir,
      defaultsFile: path.join(dataDir, 'missing-defaults.json'),
    });

    await expect(store.get()).rejects.toThrow('Stored config is not valid JSON');
  });
});
