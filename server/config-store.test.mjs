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
        category: '其他',
        icon: 'default',
        favorite: false,
        ...config.services[0],
      }],
      topology: {
        nodes: [{ type: 'server', x: 50, y: 50, ...config.topology.nodes[0] }],
        links: [],
      },
    });
    expect(reloaded).toEqual(saved);
    expect(onDisk).toEqual(saved);
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
