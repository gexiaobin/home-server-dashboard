import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ConfigValidationError,
  DEFAULT_CONFIG,
  PostgresConfigStore,
} from './config-store.mjs';

const temporaryDirectories = [];

async function createTemporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-server-postgres-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createPool(initialDocument = null) {
  let document = structuredClone(initialDocument);
  const query = vi.fn(async (sql, parameters = []) => {
    const statement = sql.replace(/\s+/g, ' ').trim();
    if (statement.startsWith('CREATE TABLE')) {
      return { rows: [] };
    }
    if (statement.startsWith('SELECT id')) {
      return { rows: document ? [{ id: 1 }] : [] };
    }
    if (statement.startsWith('SELECT document')) {
      return { rows: document ? [{ document: structuredClone(document) }] : [] };
    }
    if (statement.startsWith('INSERT INTO')) {
      if (!document || statement.includes('DO UPDATE')) {
        document = JSON.parse(parameters[0]);
      }
      return { rows: statement.includes('RETURNING document') ? [{ document: structuredClone(document) }] : [] };
    }
    if (statement === 'SELECT 1') {
      return { rows: [{ value: 1 }] };
    }
    throw new Error(`Unexpected SQL in test: ${statement}`);
  });
  return {
    query,
    readDocument: () => structuredClone(document),
  };
}

function createStore(pool, dataDir) {
  return new PostgresConfigStore({
    pool,
    dataDir,
    defaults: DEFAULT_CONFIG,
    defaultsFile: path.join(dataDir, 'missing-defaults.json'),
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('PostgresConfigStore', () => {
  it('creates its schema and returns defaults when the table has no row', async () => {
    const dataDir = await createTemporaryDirectory();
    const pool = createPool();
    const store = createStore(pool, dataDir);

    await expect(store.get()).resolves.toEqual(DEFAULT_CONFIG);
    expect(pool.query.mock.calls.some(([sql]) => sql.includes('CREATE TABLE IF NOT EXISTS'))).toBe(true);
  });

  it('normalizes and atomically upserts configuration', async () => {
    const dataDir = await createTemporaryDirectory();
    const pool = createPool();
    const store = createStore(pool, dataDir);
    const input = {
      settings: { title: 'PostgreSQL dashboard', refreshInterval: 10_000 },
      services: [{
        id: 'nas',
        name: 'NAS',
        url: 'https://nas.local',
        externalUrl: 'https://nas.example.com/dsm?launch=files#shared',
      }],
      topology: { nodes: [{ id: 'nas', label: 'NAS' }], links: [] },
    };

    const saved = await store.put(input);
    await expect(store.get()).resolves.toEqual(saved);
    expect(pool.readDocument()).toEqual(saved);
    expect(saved.services[0]).toMatchObject({
      scope: 'internal',
      runtime: 'infrastructure',
      category: '其他',
      check: { type: 'none' },
      externalUrl: input.services[0].externalUrl,
    });
    expect((await store.get()).services[0].externalUrl).toBe(input.services[0].externalUrl);
    expect(pool.readDocument().services[0].externalUrl).toBe(input.services[0].externalUrl);
  });

  it('does not store iKuai deployment secrets inside PostgreSQL JSONB', async () => {
    const dataDir = await createTemporaryDirectory();
    const pool = createPool();
    const store = createStore(pool, dataDir);

    const saved = await store.put({
      topology: {
        source: 'ikuai',
        refreshInterval: 30_000,
        baseUrl: 'http://router.invalid',
        token: 'must-not-be-persisted',
      },
    });

    expect(saved.topology).toEqual({
      source: 'ikuai',
      refreshInterval: 30_000,
      vmHostServiceId: '',
      dockerHostServiceId: '',
      nodes: [],
      links: [],
    });
    expect(JSON.stringify(pool.readDocument())).not.toContain('must-not-be-persisted');
    expect(JSON.stringify(pool.readDocument())).not.toContain('router.invalid');
  });

  it('normalizes legacy PostgreSQL services without rewriting the stored document', async () => {
    const dataDir = await createTemporaryDirectory();
    const legacyDocument = {
      settings: { title: 'Legacy dashboard', refreshInterval: 5000 },
      services: [{ id: 'nas', name: 'NAS', url: 'https://nas.home.arpa:5001' }],
      topology: { nodes: [], links: [] },
    };
    const pool = createPool(legacyDocument);
    const store = createStore(pool, dataDir);

    const config = await store.get();

    expect(config.services[0]).toMatchObject({
      id: 'nas',
      url: 'https://nas.home.arpa:5001',
      externalUrl: '',
      scope: 'internal',
      runtime: 'infrastructure',
      iconAllowInsecureTls: false,
    });
    expect(pool.readDocument()).toEqual(legacyDocument);
  });

  it('migrates a legacy config file only when the database row is empty', async () => {
    const dataDir = await createTemporaryDirectory();
    const pool = createPool();
    await writeFile(path.join(dataDir, 'config.json'), JSON.stringify({
      settings: { title: 'Migrated', refreshInterval: 5000 },
      services: [{ id: 'nas', name: 'NAS', url: 'https://nas.home.arpa:5001' }],
      topology: { nodes: [], links: [] },
    }));

    const store = createStore(pool, dataDir);
    await expect(store.get()).resolves.toMatchObject({ settings: { title: 'Migrated' } });
    expect(pool.readDocument()).toMatchObject({ settings: { title: 'Migrated' } });
    expect(pool.readDocument().services[0]).toMatchObject({
      externalUrl: '',
      scope: 'internal',
      runtime: 'infrastructure',
    });
  });

  it('stores external bookmarks in canonical normalized form', async () => {
    const dataDir = await createTemporaryDirectory();
    const pool = createPool();
    const store = createStore(pool, dataDir);

    const saved = await store.put({
      services: [{
        id: 'jd-cloud',
        name: 'JD Cloud',
        url: 'https://console.jdcloud.com/',
        externalUrl: 'https://legacy.example.com/',
        scope: 'external',
        runtime: 'infrastructure',
        check: { type: 'tcp', host: 'console.jdcloud.com', port: 443 },
      }],
    });

    expect(saved.services[0]).toMatchObject({
      url: 'https://console.jdcloud.com/',
      externalUrl: '',
      scope: 'external',
      runtime: 'infrastructure',
      check: { type: 'none' },
    });
    expect(pool.readDocument()).toEqual(saved);
  });

  it('rejects invalid configuration before writing to PostgreSQL', async () => {
    const dataDir = await createTemporaryDirectory();
    const pool = createPool();
    const store = createStore(pool, dataDir);

    await expect(store.put({
      services: [
        { id: 'duplicate', name: 'One', url: 'http://one.local' },
        { id: 'duplicate', name: 'Two', url: 'http://two.local' },
      ],
    })).rejects.toBeInstanceOf(ConfigValidationError);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('uses the database for readiness checks', async () => {
    const dataDir = await createTemporaryDirectory();
    const pool = createPool();
    const store = createStore(pool, dataDir);

    await store.healthCheck();
    expect(pool.query.mock.calls.some(([sql]) => sql === 'SELECT 1')).toBe(true);
  });
});
